use super::*;
use crate::{backup, cloud_snapshot, sync_transfer};
use serde_json::json;
use std::{
    fs,
    io::{self, BufRead, Write},
    path::PathBuf,
};

struct Kitchen {
    root: PathBuf,
}
impl Kitchen {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("chefish-sync-replay-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        Self { root }
    }
    fn open(&self) -> Connection {
        super::super::open(&self.root.join("kitchen.sqlite3")).unwrap()
    }
}
impl Drop for Kitchen {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn execute(conn: &mut Connection, command: Value) {
    super::super::execute(
        conn,
        &Uuid::new_v4().to_string(),
        serde_json::from_value(command).unwrap(),
    )
    .unwrap();
}
fn receive(name: &str) -> Value {
    json!({"type":"receive_lot","draft":{"name":name,"category":"未分类","quantity":"5","unit":"个","location":"冷藏","received":"2026-10-25","expires":null,"precision":"rough"}})
}
fn pair() -> (Kitchen, Connection, Kitchen, Connection) {
    let a = Kitchen::new();
    let mut ac = a.open();
    let b = Kitchen::new();
    execute(&mut ac, receive("鸡蛋"));
    backup::create(&ac, &b.root.join("kitchen.sqlite3")).unwrap();
    let mut bc = b.open();
    sync::strip_local_metadata(&bc).unwrap();
    sync::initialize(&bc).unwrap();
    let space = Uuid::new_v4().to_string();
    for c in [&mut ac, &mut bc] {
        let replica = state(c).unwrap().replica_id;
        bind(
            c,
            "alice",
            "alice@example.invalid",
            &space,
            watermark(c).unwrap(),
            &replica,
        )
        .unwrap();
    }
    (a, ac, b, bc)
}
fn bytes(conn: &Connection, op: &Operation) -> Vec<u8> {
    conn.query_row(
        "SELECT payload FROM local_sync_outbox WHERE operation_id=?1",
        [&op.id],
        |r| r.get(0),
    )
    .unwrap()
}
fn transfer(a: &mut Connection, b: &mut Connection) -> Operation {
    let op = outgoing(a, "alice").unwrap().unwrap();
    let raw = bytes(a, &op);
    assert!(accept(b, "alice", &op, &raw).unwrap());
    assert!(!accept(b, "alice", &op, &raw).unwrap());
    acknowledge(a, "alice", &op).unwrap();
    op
}
fn lots(conn: &Connection) -> Value {
    super::super::snapshot(conn).unwrap()["lots"].clone()
}
#[test]
fn steward_business_metadata_and_undo_replicate_without_private_messages() {
    let (_a, mut a, _b, mut b) = pair();
    let work = super::super::steward::entities(&a).unwrap();
    let lot = work.iter().find(|v| v["entityKind"] == "lot").unwrap();
    let entry = super::super::steward::MaintenanceEntry {
        entity_kind: "lot".into(),
        entity_id: lot["entityId"].as_str().unwrap().into(),
        signature: lot["signature"].as_str().unwrap().into(),
        category: None,
        tags: vec!["蛋类".into()],
        review_on: Some("2026-11-01".into()),
        suggested_location: None,
        basis: "合成库存预计复查".into(),
    };
    let operation = Uuid::new_v4().to_string();
    let revision = super::super::steward::revision(&a).unwrap();
    super::super::execute_background(
        &mut a,
        &operation,
        super::super::Command::MaintainKitchen {
            expected_revision: revision,
            entries: vec![entry],
        },
    )
    .unwrap();
    super::super::steward::put_item(
        &a,
        "private",
        "maintenance",
        "本机消息",
        "不应同步",
        json!({}),
    )
    .unwrap();
    transfer(&mut a, &mut b);
    assert_eq!(lots(&a), lots(&b));
    assert!(super::super::steward::state(&b).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        b.query_row("SELECT count(*) FROM local_steward_undo", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    super::super::execute(
        &mut a,
        &Uuid::new_v4().to_string(),
        super::super::Command::UndoMaintenance {
            operation_id: operation,
        },
    )
    .unwrap();
    transfer(&mut a, &mut b);
    assert_eq!(lots(&a), lots(&b));
}
#[test]
fn global_undo_replicates_recipe_history_and_inventory_without_copying_private_stack() {
    let (_aroot, mut a, _broot, mut b) = pair();
    let before = lots(&a);
    super::super::execute(
        &mut a,
        &Uuid::new_v4().to_string(),
        super::super::Command::CreateRecipe {
            draft: super::super::tests::draft(),
        },
    )
    .unwrap();
    transfer(&mut a, &mut b);
    let lot = &before[0];
    execute(
        &mut a,
        json!({"type":"change_lot","lot_id":lot["id"],"expected_version":1,"operation":"correct","quantity":"2","location":null,"reason":""}),
    );
    transfer(&mut a, &mut b);
    for _ in 0..2 {
        let latest = super::super::undo::status(&a).unwrap();
        execute(
            &mut a,
            json!({"type":"undo","operation_id":latest["operationId"]}),
        );
        transfer(&mut a, &mut b);
    }
    assert_eq!(lots(&a), before);
    assert_eq!(lots(&b), before);
    assert!(super::super::snapshot(&b).unwrap()["recipes"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(super::super::undo::status(&b).unwrap().is_null());
}
#[test]
fn global_undo_keeps_later_remote_references_and_rolls_back_on_conflict() {
    let (_aroot, mut a, _broot, mut b) = pair();
    super::super::execute(
        &mut a,
        &Uuid::new_v4().to_string(),
        super::super::Command::CreateRecipe {
            draft: super::super::tests::draft(),
        },
    )
    .unwrap();
    transfer(&mut a, &mut b);
    let s = super::super::snapshot(&b).unwrap();
    execute(
        &mut b,
        json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":s["recipes"][0]["revisionId"],"custom_title":null,"day":"2026-10-26","meal":"晚餐","servings":2}}),
    );
    transfer(&mut b, &mut a);
    let before = super::super::snapshot(&a).unwrap();
    let latest = super::super::undo::status(&a).unwrap();
    assert!(super::super::execute(
        &mut a,
        &Uuid::new_v4().to_string(),
        super::super::Command::Undo {
            operation_id: latest["operationId"].as_str().unwrap().into()
        }
    )
    .is_err());
    assert_eq!(super::super::snapshot(&a).unwrap(), before);
    assert_eq!(super::super::undo::status(&a).unwrap(), latest);
}

#[test]
fn ingredient_photo_survives_replication_and_cloud_snapshot_without_stock_changes() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let (aroot, mut a, broot, mut b) = pair();
    let before = super::super::snapshot(&a).unwrap();
    let id = before["ingredients"][0]["id"].as_str().unwrap();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
        .encode_image(&image::DynamicImage::ImageRgb8(
            image::RgbImage::from_pixel(2, 2, image::Rgb([255, 250, 240])),
        ))
        .unwrap();
    let photo = json!({"data":format!("data:image/jpeg;base64,{}",STANDARD.encode(jpeg)),"sourceUrl":"https://commons.wikimedia.org/wiki/File:Egg.jpg","author":"Synthetic fixture","license":"CC0","licenseUrl":"https://creativecommons.org/publicdomain/zero/1.0/","title":"Egg"});
    execute(
        &mut a,
        json!({"type":"set_ingredient_image","ingredient_id":id,"expected_source":null,"image":photo}),
    );
    transfer(&mut a, &mut b);
    assert_eq!(lots(&a), before["lots"]);
    assert_eq!(
        super::super::snapshot(&b).unwrap()["ingredients"][0]["image"],
        photo
    );
    // Seasonings can have no inventory ingredient ID, including brand aliases.
    a.execute(
        "INSERT INTO seasoning_supplies(name,missing) VALUES('品牌白砂糖',0)",
        [],
    )
    .unwrap();
    b.execute(
        "INSERT INTO seasoning_supplies(name,missing) VALUES('品牌白砂糖',0)",
        [],
    )
    .unwrap();
    execute(
        &mut a,
        json!({"type":"set_ingredient_image","ingredient_id":"seasoning:糖","expected_source":null,"image":photo}),
    );
    transfer(&mut a, &mut b);
    let seasoning_photo = |conn: &Connection| {
        super::super::seasonings::supplies(conn)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == "糖")
            .unwrap()["image"]
            .clone()
    };
    assert_eq!(seasoning_photo(&b), photo);
    let prepared = cloud_snapshot::prepare(&a, &aroot.root).unwrap();
    let mut incoming =
        cloud_snapshot::IncomingSnapshot::new(prepared.manifest.clone(), &broot.root).unwrap();
    for i in 0..prepared.manifest.chunks.len() {
        incoming
            .accept_chunk(i, &prepared.read_chunk(i).unwrap())
            .unwrap();
    }
    let restored = incoming.finish(&broot.root).unwrap();
    let conn = super::super::open(&restored.path).unwrap();
    assert_eq!(
        super::super::snapshot(&conn).unwrap()["ingredients"][0]["image"],
        photo
    );
    assert_eq!(lots(&conn), before["lots"]);
    assert_eq!(seasoning_photo(&conn), photo);
}

#[test]
fn inventory_edit_and_deletion_sync_with_business_settings_and_cannot_reappear() {
    let (_aroot, mut a, _broot, mut b) = pair();
    let lot = lots(&a)[0].clone();
    let lot_id = lot["id"].as_str().unwrap().to_string();
    execute(
        &mut a,
        json!({"type":"edit_lot","lot_id":lot_id,"expected_version":1,"draft":{"quantity":"3","unit":"个","location":"冷冻","received":"2026-10-20","expires":null,"precision":"rough","category":"自动分类"}}),
    );
    transfer(&mut a, &mut b);
    assert_eq!(lots(&a), lots(&b));
    execute(
        &mut b,
        json!({"type":"delete_lot","lot_id":lot_id,"expected_version":2}),
    );
    transfer(&mut b, &mut a);
    assert!(lots(&a).as_array().unwrap().is_empty());
    assert!(lots(&b).as_array().unwrap().is_empty());
    assert_eq!(
        a.query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [format!("inventory_deleted:{lot_id}")],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "1"
    );
    let prepared = cloud_snapshot::prepare(&a, &_aroot.root).unwrap();
    let mut incoming =
        cloud_snapshot::IncomingSnapshot::new(prepared.manifest.clone(), &_broot.root).unwrap();
    for i in 0..prepared.manifest.chunks.len() {
        incoming
            .accept_chunk(i, &prepared.read_chunk(i).unwrap())
            .unwrap();
    }
    let restored = incoming.finish(&_broot.root).unwrap();
    let conn = super::super::open(&restored.path).unwrap();
    assert!(lots(&conn).as_array().unwrap().is_empty());
}

#[test]
fn purchase_cooking_and_undo_replay_whole_groups_with_history_intact() {
    let (_aroot, mut a, _broot, mut b) = pair();
    let mut draft = super::super::tests::draft();
    draft.ingredients = vec![super::super::DraftIngredient {
        name: "鸡蛋".into(),
        quantity: "2".into(),
        unit: "个".into(),
    }];
    super::super::execute(
        &mut a,
        &Uuid::new_v4().to_string(),
        super::super::Command::CreateRecipe { draft },
    )
    .unwrap();
    transfer(&mut a, &mut b);
    execute(
        &mut a,
        json!({"type":"save_shopping","line_id":null,"expected_version":null,"draft":{"name":"鸡蛋","category":"未分类","quantity":"5","unit":"个"}}),
    );
    transfer(&mut a, &mut b);
    let line: (String, String, i64) = a
        .query_row(
            "SELECT id,ingredient_id,version FROM shopping_lines",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    execute(
        &mut a,
        json!({"type":"purchase_shopping","line_id":line.0,"expected_version":line.2,"ingredient_id":line.1,"unit":"个","week_start":null,"quantity":"5","location":"冷藏","received":"2026-10-25","expires":null}),
    );
    transfer(&mut a, &mut b);
    let snapshot = super::super::snapshot(&a).unwrap();
    let today = super::super::shopping::local_today(&a).unwrap();
    execute(
        &mut a,
        json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":snapshot["recipes"][0]["revisionId"],"custom_title":null,"day":today,"meal":"晚餐","servings":2}}),
    );
    transfer(&mut a, &mut b);
    let snapshot = super::super::snapshot(&a).unwrap();
    let plan = &snapshot["plans"][0];
    let lot = &snapshot["lots"][0];
    execute(
        &mut a,
        json!({"type":"complete_cooking","draft":{"plan_id":plan["id"],"expected_version":plan["version"],"expected_revision":snapshot["dataRevision"],"servings":2,"date":today,"note":"同步测试","acknowledged":true,"consumptions":[{"lot_id":lot["id"],"expected_version":lot["version"],"quantity":"2"}]}}),
    );
    transfer(&mut a, &mut b);
    assert_eq!(lots(&a), lots(&b));
    let plan = super::super::snapshot(&b).unwrap()["plans"][0].clone();
    execute(
        &mut b,
        json!({"type":"undo_cooking","plan_id":plan["id"],"expected_version":plan["version"]}),
    );
    transfer(&mut b, &mut a);
    let mut left = super::super::snapshot(&a).unwrap();
    let mut right = super::super::snapshot(&b).unwrap();
    left.as_object_mut().unwrap().remove("dataRevision");
    right.as_object_mut().unwrap().remove("dataRevision");
    assert_eq!(left, right);
    for c in [&a, &b] {
        assert_eq!(
            c.query_row("SELECT count(*) FROM cooking_sessions", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM cooking_undos", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}

#[test]
fn private_or_invalid_remote_rows_roll_back_all_earlier_changes() {
    let (_aroot, mut a, _broot, mut b) = pair();
    execute(&mut a, receive("苹果"));
    let original = outgoing(&a, "alice").unwrap().unwrap();
    let compressed = bytes(&a, &original);
    let mut decoder = GzDecoder::new(compressed.as_slice());
    let mut raw = String::new();
    decoder.read_to_string(&mut raw).unwrap();
    let source: Value = serde_json::from_str(&raw).unwrap();
    for setting in [false, true] {
        let mut payload = source.clone();
        if setting {
            payload["settings"]
                .as_array_mut()
                .unwrap()
                .push(json!({"key":"assistant_history_v1","before":null,"after":"PRIVATE"}));
        } else {
            payload["rows"].as_array_mut().unwrap().push(json!({"table":"app_settings","before":null,"after":{"key":"firebase_refresh_token","value":"PRIVATE"}}));
        }
        let mut encoder = flate2::GzBuilder::new()
            .mtime(0)
            .write(Vec::new(), flate2::Compression::default());
        encoder
            .write_all(&serde_json::to_vec(&payload).unwrap())
            .unwrap();
        let raw = encoder.finish().unwrap();
        let mut op = original.clone();
        op.sha256 = digest(&raw);
        op.bytes = raw.len();
        op.chunks = raw
            .chunks(CHUNK_BYTES)
            .map(|chunk| Chunk {
                hash: digest(chunk),
                bytes: chunk.len(),
            })
            .collect();
        let before = super::super::snapshot(&b).unwrap();
        assert_eq!(
            accept(&mut b, "alice", &op, &raw).unwrap_err().code,
            "SYNC_INVALID"
        );
        assert_eq!(super::super::snapshot(&b).unwrap(), before);
        assert_eq!(state(&b).unwrap().binding.unwrap().cursor, 0);
    }
}

#[test]
fn replicas_replay_real_ids_and_offline_disjoint_changes_without_echo() {
    let (_a, mut a, _b, mut b) = pair();
    execute(&mut a, receive("苹果"));
    execute(&mut b, receive("香蕉"));
    transfer(&mut a, &mut b);
    assert_eq!(state(&b).unwrap().queued_operations, 1);
    transfer(&mut b, &mut a);
    assert_eq!(lots(&a), lots(&b));
    assert_eq!(lots(&a).as_array().unwrap().len(), 3);
    assert_eq!(state(&a).unwrap().queued_operations, 0);
    assert_eq!(state(&b).unwrap().queued_operations, 0);
    assert_eq!(state(&a).unwrap().binding.unwrap().cursor, 2);
}
#[test]
fn same_row_conflict_rolls_back_then_explicit_cloud_choice_restores_convergence() {
    let (_a, mut a, broot, mut b) = pair();
    for (c, amount) in [(&mut a, "1"), (&mut b, "2")] {
        let lot = lots(c)[0].clone();
        execute(
            c,
            json!({"type":"change_lot","lot_id":lot["id"],"expected_version":lot["version"],"operation":"use","quantity":amount,"location":null,"reason":""}),
        );
    }
    let op = outgoing(&a, "alice").unwrap().unwrap();
    let raw = bytes(&a, &op);
    let before = super::super::snapshot(&b).unwrap();
    assert_eq!(
        accept(&mut b, "alice", &op, &raw).unwrap_err().code,
        "SYNC_CONFLICT"
    );
    assert_eq!(super::super::snapshot(&b).unwrap(), before);
    assert_eq!(state(&b).unwrap().binding.unwrap().cursor, 0);
    assert!(state(&b).unwrap().binding.unwrap().conflict.is_some());
    sync_transfer::safety(&b, &broot.root, "before-sync-conflict").unwrap();
    discard_pending(&mut b, "alice").unwrap();
    accept(&mut b, "alice", &op, &raw).unwrap();
    acknowledge(&mut a, "alice", &op).unwrap();
    assert_eq!(lots(&a), lots(&b));
    let history = b
        .query_row("SELECT id FROM inventory_events LIMIT 1", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap();
    assert!(b
        .execute("DELETE FROM inventory_events WHERE id=?1", [history])
        .is_err());
    let saved = fs::read_dir(broot.root.join("backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let safety = super::super::open(&saved).unwrap();
    assert_eq!(lots(&safety), before["lots"]);
}
#[test]
fn dietary_preferences_sync_without_overwriting_device_preferences_or_chat() {
    let (_a, mut a, _b, mut b) = pair();
    b.execute(
        "INSERT INTO app_settings(key,value) VALUES('assistant_history_v1','PRIVATE_CHAT')",
        [],
    )
    .unwrap();
    let mut prefs = preferences::load(&b).unwrap();
    prefs.start_page = "pantry".into();
    preferences::save(&mut b, prefs).unwrap();
    let mut prefs = preferences::load(&a).unwrap();
    prefs.default_servings = 5;
    preferences::save(&mut a, prefs).unwrap();
    transfer(&mut a, &mut b);
    let result = preferences::load(&b).unwrap();
    assert_eq!(result.default_servings, 5);
    assert_eq!(result.start_page, "pantry");
    assert_eq!(
        b.query_row(
            "SELECT value FROM app_settings WHERE key='assistant_history_v1'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "PRIVATE_CHAT"
    );
}
#[test]
fn owner_pause_sequence_and_corrupt_payload_guards_do_not_change_data() {
    let (_a, mut a, _b, mut b) = pair();
    execute(&mut a, receive("苹果"));
    let op = outgoing(&a, "alice").unwrap().unwrap();
    let raw = bytes(&a, &op);
    let before = super::super::snapshot(&b).unwrap();
    assert_eq!(
        accept(&mut b, "bob", &op, &raw).unwrap_err().code,
        "SYNC_ACCOUNT"
    );
    pause(&b, "alice", false).unwrap();
    assert_eq!(
        accept(&mut b, "alice", &op, &raw).unwrap_err().code,
        "SYNC_PAUSED"
    );
    pause(&b, "alice", true).unwrap();
    let mut gap = op.clone();
    gap.sequence = 2;
    assert_eq!(
        accept(&mut b, "alice", &gap, &raw).unwrap_err().code,
        "SYNC_GAP"
    );
    assert_eq!(
        accept(&mut b, "alice", &op, b"broken").unwrap_err().code,
        "SYNC_INVALID"
    );
    assert_eq!(super::super::snapshot(&b).unwrap(), before);
}
#[test]
fn baseline_watermark_keeps_edits_created_during_upload_and_restore_is_safe() {
    let aroot = Kitchen::new();
    let mut a = aroot.open();
    execute(&mut a, receive("鸡蛋"));
    let mut transfers = sync_transfer::Transfers::default();
    let baseline = transfers
        .prepare_baseline(&a, &aroot.root, "alice", "a@example.invalid", false)
        .unwrap();
    execute(&mut a, receive("苹果"));
    let space = Uuid::new_v4().to_string();
    transfers
        .bind_baseline(&mut a, "alice", &baseline.manifest.id, &space)
        .unwrap();
    assert_eq!(state(&a).unwrap().queued_operations, 1);
    let broot = Kitchen::new();
    let mut b = Some(broot.open());
    execute(b.as_mut().unwrap(), receive("本机旧库存"));
    let mut incoming =
        cloud_snapshot::IncomingSnapshot::new(baseline.manifest.clone(), &broot.root).unwrap();
    for i in 0..baseline.manifest.chunks.len() {
        incoming
            .accept_chunk(
                i,
                &transfers.snapshot.as_ref().unwrap().read_chunk(i).unwrap(),
            )
            .unwrap();
    }
    let staged = incoming.finish(&broot.root).unwrap();
    let before = lots(b.as_ref().unwrap());
    assert!(sync_transfer::restore_bind(
        &mut b,
        &staged,
        &broot.root,
        "alice",
        &"x".repeat(321),
        &space
    )
    .is_err());
    assert_eq!(lots(b.as_ref().unwrap()), before);
    sync_transfer::restore_bind(
        &mut b,
        &staged,
        &broot.root,
        "alice",
        "a@example.invalid",
        &space,
    )
    .unwrap();
    assert_ne!(
        state(&a).unwrap().replica_id,
        state(b.as_ref().unwrap()).unwrap().replica_id
    );
    transfer(&mut a, b.as_mut().unwrap());
    assert_eq!(lots(&a), lots(b.as_ref().unwrap()));
    assert!(fs::read_dir(broot.root.join("backups"))
        .unwrap()
        .next()
        .is_some());
}

// Opt-in stdin bridge for integration tests. Always creates its own temporary DB;
// no caller-supplied path, production app directory, credentials, or network.
#[test]
#[ignore = "test transport for two SQLite replicas and the Firestore emulator"]
fn bridge() {
    assert_eq!(
        std::env::var("CHEFISH_NATIVE_SYNC_TEST").as_deref(),
        Ok("1")
    );
    let root = Kitchen::new();
    let mut conn = Some(root.open());
    let mut transfers = sync_transfer::Transfers::default();
    let mut incoming: Option<cloud_snapshot::IncomingSnapshot> = None;
    let mut staged: Option<backup::StagedRestore> = None;
    println!("CHEFISH_SYNC:{}", json!({"ready":true}));
    io::stdout().flush().unwrap();
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        if line == "quit" {
            break;
        }
        let request: Value = serde_json::from_str(&line).unwrap();
        let action = request["action"].as_str().unwrap();
        let uid = request["uid"].as_str().unwrap_or("alice");
        let token = request["token"].as_str().unwrap_or("");
        let index = request["index"].as_u64().unwrap_or(0) as usize;
        let result = (|| -> Result<Value> {
            let c = conn.as_mut().unwrap();
            match action {
                "state" => Ok(serde_json::to_value(state(c)?).unwrap()),
                "snapshot" => super::super::snapshot(c),
                "execute" => {
                    super::super::execute(
                        c,
                        request["id"].as_str().unwrap(),
                        serde_json::from_value(request["command"].clone()).unwrap(),
                    )?;
                    Ok(Value::Null)
                }
                "baseline" => Ok(serde_json::to_value(transfers.prepare_baseline(
                    c,
                    &root.root,
                    uid,
                    "synthetic@example.invalid",
                    false,
                )?)
                .unwrap()),
                "baselineChunk" => Ok(json!(transfers
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .read_chunk(index)?)),
                "bindBaseline" => {
                    transfers.bind_baseline(c, uid, token, request["spaceId"].as_str().unwrap())?;
                    Ok(Value::Null)
                }
                "outgoing" => Ok(serde_json::to_value(outgoing(c, uid)?).unwrap()),
                "outgoingChunk" => Ok(json!(outgoing_chunk(
                    c,
                    uid,
                    request["operationId"].as_str().unwrap(),
                    index
                )?)),
                "beginIncoming" => Ok(json!(transfers.begin(
                    uid.into(),
                    serde_json::from_value(request["operation"].clone()).unwrap(),
                    &root.root
                )?)),
                "acceptChunk" => {
                    transfers.accept(uid, token, index, request["data"].as_str().unwrap())?;
                    Ok(Value::Null)
                }
                "finishIncoming" => Ok(json!(transfers.finish(c, uid, token)?)),
                "releaseIncoming" => {
                    transfers.release(uid, token);
                    Ok(Value::Null)
                }
                "acknowledge" => Ok(json!(acknowledge(
                    c,
                    uid,
                    &serde_json::from_value(request["operation"].clone()).unwrap()
                )?)),
                "pause" => {
                    pause(c, uid, request["enabled"].as_bool().unwrap())?;
                    Ok(Value::Null)
                }
                "resolveCloud" => {
                    sync_transfer::safety(c, &root.root, "before-sync-conflict")?;
                    discard_pending(c, uid)?;
                    Ok(Value::Null)
                }
                "downloadBegin" => {
                    incoming = Some(cloud_snapshot::IncomingSnapshot::new(
                        serde_json::from_value(request["manifest"].clone()).unwrap(),
                        &root.root,
                    )?);
                    Ok(json!(incoming.as_ref().unwrap().token))
                }
                "downloadChunk" => {
                    incoming
                        .as_mut()
                        .unwrap()
                        .accept_chunk(index, request["data"].as_str().unwrap())?;
                    Ok(Value::Null)
                }
                "downloadFinish" => {
                    let value = incoming.take().unwrap().finish(&root.root)?;
                    let preview = serde_json::to_value(&value.preview).unwrap();
                    staged = Some(value);
                    Ok(preview)
                }
                "connect" => {
                    sync_transfer::restore_bind(
                        &mut conn,
                        staged.as_ref().unwrap(),
                        &root.root,
                        uid,
                        "synthetic@example.invalid",
                        request["spaceId"].as_str().unwrap(),
                    )?;
                    Ok(Value::Null)
                }
                "restart" => {
                    drop(conn.take());
                    conn = Some(root.open());
                    Ok(Value::Null)
                }
                _ => Err(error("TEST_COMMAND", "Unknown test command")),
            }
        })();
        println!(
            "CHEFISH_SYNC:{}",
            match result {
                Ok(value) => json!({"value":value}),
                Err(e) => json!({"error":e}),
            }
        );
        io::stdout().flush().unwrap();
    }
}

#[test]
fn ai_amount_resolution_and_cooking_record_replay_without_changing_source_recipe() {
    use super::super::{cooking, ingredient_resolution, shopping};
    let (_aroot, mut a, _broot, mut b) = pair();
    let mut d = super::super::tests::draft();
    d.ingredients[0].quantity = "200".into();
    d.text_ingredients = vec![super::super::TextIngredient {
        name: "大蒜".into(),
        amount_text: "少许".into(),
    }];
    super::super::execute(
        &mut a,
        &Uuid::new_v4().to_string(),
        super::super::Command::CreateRecipe { draft: d },
    )
    .unwrap();
    transfer(&mut a, &mut b);
    let original = super::super::snapshot(&a).unwrap()["recipes"].clone();
    let rev = original[0]["revisionId"].as_str().unwrap();
    let work = ingredient_resolution::pending(&a).unwrap().unwrap();
    assert_eq!(work["revisionId"], rev);
    let entries = vec![
        ingredient_resolution::Entry {
            name: "西兰花".into(),
            quantity: "999".into(),
            unit: "g".into(),
            basis: "model mistake".into(),
        },
        ingredient_resolution::Entry {
            name: "蒜末".into(),
            quantity: "3".into(),
            unit: "g".into(),
            basis: "少许按3克估计".into(),
        },
    ];
    super::super::execute_background(
        &mut a,
        &Uuid::new_v4().to_string(),
        super::super::Command::ResolveIngredients {
            revision_id: rev.into(),
            entries,
        },
    )
    .unwrap();
    transfer(&mut a, &mut b);
    let requirements = ingredient_resolution::requirements(&b, rev).unwrap();
    assert_eq!(requirements.len(), 2);
    assert!(requirements.iter().any(|(_, q, _)| q == "200"));
    assert!(!requirements.iter().any(|(_, q, _)| q == "999"));
    assert_eq!(super::super::snapshot(&a).unwrap()["recipes"], original);
    let date = shopping::local_today(&a).unwrap();
    execute(
        &mut a,
        json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":rev,"custom_title":null,"day":date,"meal":"晚餐","servings":2}}),
    );
    transfer(&mut a, &mut b);
    let s = super::super::snapshot(&a).unwrap();
    let plan = s["plans"][0]["id"].as_str().unwrap();
    let preview = cooking::preview(&a, plan, 2, &date).unwrap();
    execute(
        &mut a,
        json!({"type":"complete_cooking","draft":{"plan_id":plan,"expected_version":1,"expected_revision":preview["revision"],"date":date,"servings":2,"note":"味道很好","record":"蔬菜用了少许，未记录入库","acknowledged":true,"consumptions":[]}}),
    );
    transfer(&mut a, &mut b);
    assert_eq!(
        cooking::session(&b, plan).unwrap()["record"],
        "蔬菜用了少许，未记录入库"
    );
    assert_eq!(cooking::session(&b, plan).unwrap()["note"], "味道很好");
}

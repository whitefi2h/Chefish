use super::*;
use crate::{
    backup,
    db::{self, Command},
};
use flate2::read::GzDecoder;
use std::{fs, io::Read, path::PathBuf};

struct Kitchen {
    root: PathBuf,
}
impl Kitchen {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("chefish-sync-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        Self { root }
    }
    fn open(&self) -> Connection {
        db::open(&self.root.join("kitchen.sqlite3")).unwrap()
    }
}
impl Drop for Kitchen {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn execute(conn: &mut Connection, command: Value) -> String {
    let request = Uuid::new_v4().to_string();
    db::execute(conn, &request, serde_json::from_value(command).unwrap()).unwrap();
    request
}
fn operation(conn: &Connection, id: &str) -> Value {
    let (compressed, sha): (Vec<u8>, String) = conn
        .query_row(
            "SELECT payload,payload_sha256 FROM local_sync_outbox WHERE operation_id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(format!("{:x}", Sha256::digest(&compressed)), sha);
    let mut raw = Vec::new();
    GzDecoder::new(compressed.as_slice())
        .read_to_end(&mut raw)
        .unwrap();
    serde_json::from_slice(&raw).unwrap()
}
fn receive() -> Value {
    json!({"type":"receive_lot","draft":{"name":"鸡蛋","category":"未分类","quantity":"5","unit":"个","location":"冷藏","received":"2026-10-25","expires":null,"precision":"rough"}})
}
fn change(lot: &Value, quantity: &str) -> Value {
    json!({"type":"change_lot","lot_id":lot["id"],"expected_version":lot["version"],"operation":"use","quantity":quantity,"location":null,"reason":""})
}
fn rows<'a>(value: &'a Value, table: &str) -> Vec<&'a Value> {
    value["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| row["table"] == table)
        .collect()
}

#[test]
fn capture_allowlist_covers_business_tables_but_excludes_local_and_private_tables() {
    let kitchen = Kitchen::new();
    let conn = kitchen.open();
    let mut actual = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('sqlite_sequence','schema_migrations','command_receipts','app_settings','local_sync_state','local_sync_outbox','local_sync_binding','local_sync_applied','local_undo_history') ORDER BY name").unwrap().query_map([],|row| row.get::<_,String>(0)).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap();
    let mut expected = TABLES
        .iter()
        .map(|name| name.to_string())
        .collect::<Vec<_>>();
    actual.sort();
    expected.sort();
    assert_eq!(actual, expected);
}

#[test]
fn queue_retains_generated_ids_precise_values_and_retry_identity_across_restart() {
    let kitchen = Kitchen::new();
    let mut conn = kitchen.open();
    let request = execute(&mut conn, receive());
    let first = operation(&conn, &request);
    let lots = db::snapshot(&conn).unwrap()["lots"].clone();
    let recorded_lot = rows(&first, "inventory_lots")[0]["after"].clone();
    assert_eq!(recorded_lot["id"], lots[0]["id"]);
    assert_eq!(recorded_lot["amount_decimal"], "5");
    assert_eq!(first["operationId"], request);
    assert_eq!(first["baseRevision"], "0");
    assert_eq!(first["resultRevision"], "1");
    let replica = status(&conn).unwrap().replica_id;
    assert_eq!(first["replicaId"], replica);
    db::execute(
        &mut conn,
        &request,
        serde_json::from_value(receive()).unwrap(),
    )
    .unwrap();
    assert_eq!(status(&conn).unwrap().queued_operations, 1);
    assert_eq!(operation(&conn, &request), first);
    drop(conn);
    let mut conn = kitchen.open();
    assert_eq!(status(&conn).unwrap().replica_id, replica);
    assert_eq!(operation(&conn, &request), first);
    assert!(db::execute(
        &mut conn,
        &request,
        Command::CreateRecipe {
            draft: db::tests::draft()
        }
    )
    .is_err());
    assert_eq!(status(&conn).unwrap().queued_operations, 1);
    assert_eq!(db::snapshot(&conn).unwrap()["lots"], lots);
    let change_request = execute(&mut conn, change(&lots[0], "2"));
    let second = operation(&conn, &change_request);
    let lot_change = rows(&second, "inventory_lots")[0];
    assert_eq!(lot_change["before"]["amount_decimal"], "5");
    assert_eq!(lot_change["after"]["amount_decimal"], "3");
    assert_eq!(rows(&second, "inventory_events").len(), 1);
}

#[test]
fn batch_failure_and_queue_write_failure_roll_back_every_business_write_and_receipt() {
    let kitchen = Kitchen::new();
    let mut conn = kitchen.open();
    let before = db::snapshot(&conn).unwrap();
    let batch:Command = serde_json::from_value(json!({"type":"batch","expected_revision":"0","commands":[receive(),{"type":"archive_recipe","recipe_id":"does-not-exist"}]})).unwrap();
    let request = Uuid::new_v4().to_string();
    assert!(db::execute(&mut conn, &request, batch).is_err());
    assert_eq!(db::snapshot(&conn).unwrap(), before);
    assert_eq!(status(&conn).unwrap().queued_operations, 0);
    conn.execute_batch("CREATE TRIGGER reject_outbox BEFORE INSERT ON local_sync_outbox BEGIN SELECT RAISE(ABORT,'synthetic outbox failure'); END;").unwrap();
    assert!(db::execute(
        &mut conn,
        &request,
        serde_json::from_value(receive()).unwrap()
    )
    .is_err());
    assert_eq!(db::snapshot(&conn).unwrap(), before);
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM command_receipts WHERE request_id=?1",
            [&request],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    conn.execute_batch("DROP TRIGGER reject_outbox").unwrap();
    db::execute(
        &mut conn,
        &request,
        serde_json::from_value(receive()).unwrap(),
    )
    .unwrap();
    assert_eq!(status(&conn).unwrap().queued_operations, 1);
    assert_eq!(rows(&operation(&conn, &request), "inventory_lots").len(), 1);
}

#[test]
fn one_step_purchase_and_cooking_each_produce_one_complete_operation_group() {
    let kitchen = Kitchen::new();
    let mut conn = kitchen.open();
    execute(
        &mut conn,
        json!({"type":"save_shopping","line_id":null,"expected_version":null,"draft":{"name":"鸡蛋","category":"未分类","quantity":"5","unit":"个"}}),
    );
    let line: (String, String, i64) = conn
        .query_row(
            "SELECT id,ingredient_id,version FROM shopping_lines",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    let purchase = execute(
        &mut conn,
        json!({"type":"purchase_shopping","line_id":line.0,"expected_version":line.2,"ingredient_id":line.1,"unit":"个","week_start":null,"quantity":"5","location":"冷藏","received":"2026-10-25","expires":null}),
    );
    let payload = operation(&conn, &purchase);
    for table in [
        "shopping_lines",
        "purchase_events",
        "shopping_combined_purchases",
        "shopping_receipts",
        "inventory_lots",
        "inventory_events",
    ] {
        assert!(!rows(&payload, table).is_empty(), "missing {table}");
    }
    let mut recipe = db::tests::draft();
    recipe.ingredients = vec![db::DraftIngredient {
        name: "鸡蛋".into(),
        quantity: "2".into(),
        unit: "个".into(),
    }];
    db::execute(
        &mut conn,
        &Uuid::new_v4().to_string(),
        Command::CreateRecipe { draft: recipe },
    )
    .unwrap();
    let snapshot = db::snapshot(&conn).unwrap();
    let today = db::shopping::local_today(&conn).unwrap();
    execute(
        &mut conn,
        json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":snapshot["recipes"][0]["revisionId"],"custom_title":null,"day":today,"meal":"晚餐","servings":2}}),
    );
    let snapshot = db::snapshot(&conn).unwrap();
    let plan = &snapshot["plans"][0];
    let lot = &snapshot["lots"][0];
    let count = status(&conn).unwrap().queued_operations;
    let cook = execute(
        &mut conn,
        json!({"type":"complete_cooking","draft":{"plan_id":plan["id"],"expected_version":plan["version"],"expected_revision":snapshot["dataRevision"],"servings":2,"date":today,"note":"测试","acknowledged":true,"consumptions":[{"lot_id":lot["id"],"expected_version":lot["version"],"quantity":"2"}]}}),
    );
    assert_eq!(status(&conn).unwrap().queued_operations, count + 1);
    let payload = operation(&conn, &cook);
    for table in [
        "planned_meals",
        "cooking_sessions",
        "cooking_consumptions",
        "inventory_lots",
        "inventory_events",
    ] {
        assert!(!rows(&payload, table).is_empty(), "missing {table}");
    }
}

#[test]
fn journal_excludes_chat_keys_and_device_preferences_and_skips_device_only_saves() {
    let kitchen = Kitchen::new();
    let mut conn = kitchen.open();
    conn.execute_batch("INSERT INTO app_settings(key,value) VALUES('assistant_history_v1','PRIVATE_CHAT'),('firebase_refresh_token','PRIVATE_TOKEN'),('seasoningXhidden:token','PRIVATE_TOKEN');").unwrap();
    let mut preferences = preferences::load(&conn).unwrap();
    preferences.start_page = "recipes".into();
    preferences.send_shortcut = "ctrlEnter".into();
    preferences.automatic_backup = false;
    preferences::save(&mut conn, preferences.clone()).unwrap();
    assert_eq!(status(&conn).unwrap().queued_operations, 0);
    preferences.taste = "少盐".into();
    preferences::save(&mut conn, preferences).unwrap();
    let op: String = conn
        .query_row("SELECT operation_id FROM local_sync_outbox", [], |row| {
            row.get(0)
        })
        .unwrap();
    let payload = operation(&conn, &op);
    assert!(payload["rows"].as_array().unwrap().is_empty());
    assert_eq!(payload["settings"][0]["after"]["taste"], "少盐");
    for forbidden in [
        "PRIVATE_CHAT",
        "PRIVATE_TOKEN",
        "startPage",
        "sendShortcut",
        "automaticBackup",
        "assistant_history",
        "firebase",
    ] {
        assert!(
            !payload.to_string().contains(forbidden),
            "leaked {forbidden}"
        );
    }
    assert_eq!(payload["settings"].as_array().unwrap().len(), 1);
}

#[test]
fn restore_rotates_replica_and_clears_old_queue_while_safety_backup_retains_it() {
    let kitchen = Kitchen::new();
    let mut conn = kitchen.open();
    execute(&mut conn, receive());
    let old_id = status(&conn).unwrap().replica_id;
    let source = kitchen.root.join("saved.sqlite3");
    backup::create(&conn, &source).unwrap();
    let staged = backup::preview(&source, &kitchen.root).unwrap();
    let safety = kitchen.root.join("safety.sqlite3");
    let mut active = Some(conn);
    backup::replace_live_database(&mut active, &staged.path, &safety).unwrap();
    let status = super::status(active.as_ref().unwrap()).unwrap();
    assert_ne!(status.replica_id, old_id);
    assert_eq!(status.queued_operations, 0);
    let safety = db::open(&safety).unwrap();
    assert_eq!(super::status(&safety).unwrap().replica_id, old_id);
    assert_eq!(super::status(&safety).unwrap().queued_operations, 1);
}

#[test]
fn version_eleven_migration_backs_up_and_keeps_business_data_without_backfilling_queue() {
    let kitchen = Kitchen::new();
    let mut conn = kitchen.open();
    execute(&mut conn, receive());
    let before = db::snapshot(&conn).unwrap();
    remove_for_legacy_fixture(&conn);
    conn.pragma_update(None, "user_version", 11).unwrap();
    drop(conn);
    let conn = kitchen.open();
    assert_eq!(db::snapshot(&conn).unwrap(), before);
    assert_eq!(status(&conn).unwrap().queued_operations, 0);
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        db::CURRENT_SCHEMA
    );
    assert!(fs::read_dir(&kitchen.root)
        .unwrap()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().contains("pre-v12-")));
}

#[test]
fn assistant_sandbox_does_not_queue_until_actual_confirmation_and_batch_stays_one_group() {
    let kitchen = Kitchen::new();
    let mut conn = kitchen.open();
    let store = crate::assistant::Proposals::default();
    let today = db::shopping::local_today(&conn).unwrap();
    let week = db::shopping::week(&conn, &today).unwrap();
    crate::assistant::prepare(&conn, &store, vec![receive()], "0", &week).unwrap();
    assert_eq!(status(&conn).unwrap().queued_operations, 0);
    assert!(db::snapshot(&conn).unwrap()["lots"]
        .as_array()
        .unwrap()
        .is_empty());
    let group = execute(
        &mut conn,
        json!({"type":"batch","expected_revision":"0","commands":[receive(),receive()]}),
    );
    assert_eq!(status(&conn).unwrap().queued_operations, 1);
    let payload = operation(&conn, &group);
    assert_eq!(rows(&payload, "inventory_lots").len(), 2);
    assert_eq!(rows(&payload, "inventory_events").len(), 2);
}

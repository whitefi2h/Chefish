use super::super::tests::{create, draft as recipe_draft, temp};
use super::*;

#[test]
fn draft_survives_restart_and_confirmation_is_idempotent() {
    let path = temp();
    let mut c = open(&path).unwrap();
    let (_, rev) = create(&mut c);
    let week = next_week(&c, &shopping::local_today(&c).unwrap()).unwrap();
    let d = start_draft(&c, &week).unwrap();
    let key = d["id"].as_str().unwrap().to_string();
    let d = save_draft(
        &c,
        &key,
        1,
        json!([{"role":"user","content":"周一两人"}]),
        vec![Slot {
            plan_id: None,
            recipe_revision_id: Some(rev),
            custom_title: None,
            day: week.clone(),
            meal: "晚餐".into(),
            servings: 2,
        }],
    )
    .unwrap();
    assert!(snapshot(&c).unwrap()["plans"]
        .as_array()
        .unwrap()
        .is_empty());
    drop(c);
    let mut c = open(&path).unwrap();
    assert_eq!(draft(&c, &key).unwrap(), d);
    let out = confirm_draft(&mut c, &key, 2).unwrap();
    assert!(out["items"].is_array());
    confirm_draft(&mut c, &key, 2).unwrap();
    assert_eq!(snapshot(&c).unwrap()["plans"].as_array().unwrap().len(), 1);
    // Simulate a crash after the business transaction but before local completion.
    c.execute(
        "UPDATE local_steward_drafts SET status='draft' WHERE id=?1",
        [&key],
    )
    .unwrap();
    confirm_draft(&mut c, &key, 2).unwrap();
    assert_eq!(snapshot(&c).unwrap()["plans"].as_array().unwrap().len(), 1);
}
#[test]
fn conflict_preserves_discussion_and_rebase_requires_new_generation() {
    let mut c = open(&temp()).unwrap();
    let (_, rev) = create(&mut c);
    let week = next_week(&c, &shopping::local_today(&c).unwrap()).unwrap();
    let d = start_draft(&c, &week).unwrap();
    let key = d["id"].as_str().unwrap();
    save_draft(
        &c,
        key,
        1,
        json!([{"role":"user","content":"不要重复"}]),
        vec![Slot {
            plan_id: None,
            recipe_revision_id: Some(rev.clone()),
            custom_title: None,
            day: week.clone(),
            meal: "晚餐".into(),
            servings: 2,
        }],
    )
    .unwrap();
    execute(
        &mut c,
        &id(),
        Command::SavePlan {
            plan_id: None,
            expected_version: None,
            draft: planner::PlanDraft {
                recipe_revision_id: Some(rev),
                custom_title: None,
                day: week,
                meal: "午餐".into(),
                servings: 2,
            },
        },
    )
    .unwrap();
    assert_eq!(
        confirm_draft(&mut c, key, 2).unwrap_err().code,
        "DRAFT_CONFLICT"
    );
    let saved = draft(&c, key).unwrap();
    assert_eq!(saved["slots"].as_array().unwrap().len(), 1);
    let rebased = rebase_draft(&c, key, 2).unwrap();
    assert_eq!(rebased["messages"], saved["messages"]);
    assert!(rebased["slots"].as_array().unwrap().is_empty());
}
#[test]
fn maintenance_is_incremental_reversible_and_does_not_replace_expiry() {
    let mut c = open(&temp()).unwrap();
    execute(
        &mut c,
        &id(),
        Command::ReceiveLot {
            draft: inventory::InventoryDraft {
                name: "鸡肉".into(),
                category: "自动分类".into(),
                quantity: "500".into(),
                unit: "g".into(),
                location: "未指定".into(),
                received: "2026-10-28".into(),
                expires: None,
                precision: "exact".into(),
            },
        },
    )
    .unwrap();
    let work = entities(&c).unwrap();
    let lot = work.iter().find(|w| w["entityKind"] == "lot").unwrap();
    let lot_id = lot["entityId"].as_str().unwrap();
    let entry = MaintenanceEntry {
        entity_kind: "lot".into(),
        entity_id: lot_id.into(),
        signature: lot["signature"].as_str().unwrap().into(),
        category: None,
        tags: vec!["禽肉".into()],
        review_on: Some("2026-10-30".into()),
        suggested_location: Some("冷藏".into()),
        basis: "假设新鲜未冷冻，预计复查".into(),
    };
    let request = id();
    let before_undo = undo::status(&c).unwrap();
    let revision = revision(&c).unwrap();
    execute_background(
        &mut c,
        &request,
        Command::MaintainKitchen {
            expected_revision: revision,
            entries: vec![entry],
        },
    )
    .unwrap();
    mark_checked(&c, &work).unwrap();
    assert!(entities(&c).unwrap().is_empty());
    assert_eq!(undo::status(&c).unwrap(), before_undo);
    let s = snapshot(&c).unwrap();
    assert!(s["lots"][0]["expires"].is_null());
    assert_eq!(s["lots"][0]["location"], "冷藏");
    assert_eq!(s["lots"][0]["quantity"], "500");
    assert_eq!(
        metadata(&c, "lot", lot_id).unwrap()["reviewOn"],
        "2026-10-30"
    );
    execute(
        &mut c,
        &id(),
        Command::UndoMaintenance {
            operation_id: request,
        },
    )
    .unwrap();
    assert_eq!(snapshot(&c).unwrap()["lots"][0]["location"], "未指定");
    assert!(metadata(&c, "lot", lot_id).unwrap()["reviewOn"].is_null());
    assert!(!entities(&c)
        .unwrap()
        .iter()
        .any(|v| v["entityId"] == lot_id));
}
#[test]
fn user_changes_prevent_maintenance_undo() {
    let mut c = open(&temp()).unwrap();
    create(&mut c);
    let work = entities(&c).unwrap();
    let row = work.iter().find(|v| v["entityKind"] == "recipe").unwrap();
    let entry = MaintenanceEntry {
        entity_kind: "recipe".into(),
        entity_id: row["entityId"].as_str().unwrap().into(),
        signature: row["signature"].as_str().unwrap().into(),
        category: None,
        tags: vec!["清炒".into()],
        review_on: None,
        suggested_location: None,
        basis: "根据做法".into(),
    };
    let request = id();
    let revision = revision(&c).unwrap();
    execute_background(
        &mut c,
        &request,
        Command::MaintainKitchen {
            expected_revision: revision,
            entries: vec![entry],
        },
    )
    .unwrap();
    c.execute("UPDATE app_settings SET value=json_set(value,'$.tags',json('[\"手动标签\"]')) WHERE key GLOB 'steward_meta:recipe:*'",[]).unwrap();
    assert_eq!(
        execute(
            &mut c,
            &id(),
            Command::UndoMaintenance {
                operation_id: request
            }
        )
        .unwrap_err()
        .code,
        "UNDO_CONFLICT"
    );
}
#[test]
fn quiet_mode_and_device_identity_gate_all_automatic_jobs() {
    let c = open(&temp()).unwrap();
    let mut s = Settings {
        enabled: true,
        ..Default::default()
    };
    save_settings(&c, s.clone()).unwrap();
    for k in [
        "weekly",
        "maintenance",
        "images",
        "ingredients",
        "recommendations",
    ] {
        assert!(allowed(&c, k).unwrap());
    }
    s.do_not_disturb = true;
    save_settings(&c, s.clone()).unwrap();
    for k in [
        "weekly",
        "maintenance",
        "images",
        "ingredients",
        "recommendations",
    ] {
        assert!(!allowed(&c, k).unwrap());
    }
    s.do_not_disturb = false;
    save_settings(&c, s).unwrap();
    c.execute("UPDATE local_sync_state SET replica_id=?1", [id()])
        .unwrap();
    assert!(!allowed(&c, "weekly").unwrap());
}
#[test]
fn restore_keeps_draft_but_cloud_snapshot_removes_private_collaboration() {
    let mut c = open(&temp()).unwrap();
    create(&mut c);
    let week = next_week(&c, &shopping::local_today(&c).unwrap()).unwrap();
    let d = start_draft(&c, &week).unwrap();
    let key = d["id"].as_str().unwrap();
    weekly_question(&c, &week).unwrap();
    save_settings(
        &c,
        Settings {
            enabled: true,
            ..Default::default()
        },
    )
    .unwrap();
    sync::reset(&mut c).unwrap();
    assert_eq!(draft(&c, key).unwrap()["status"], "draft");
    assert!(!settings(&c).unwrap().enabled);
    assert!(!state(&c).unwrap()["items"].as_array().unwrap().is_empty());
    sync::strip_local_metadata(&c).unwrap();
    sync::initialize(&c).unwrap();
    assert!(state(&c).unwrap()["items"].as_array().unwrap().is_empty());
    assert_eq!(
        c.query_row("SELECT count(*) FROM local_steward_drafts", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn approved_alias_and_specification_are_scoped_and_replicated() {
    let mut c = open(&temp()).unwrap();
    let mut d = recipe_draft();
    d.ingredients = vec![DraftIngredient {
        name: "香菇".into(),
        quantity: "100".into(),
        unit: "g".into(),
    }];
    execute(&mut c, &id(), Command::CreateRecipe { draft: d }).unwrap();
    let revision = revision(&c).unwrap();
    execute(
        &mut c,
        &id(),
        Command::SaveIngredientRule {
            expected_revision: revision,
            rule: IngredientRule {
                alias: "小包装香菇".into(),
                canonical: "香菇".into(),
                from_unit: Some("盒".into()),
                to_unit: Some("g".into()),
                factor: Some("200".into()),
            },
        },
    )
    .unwrap();
    assert_eq!(
        ingredient_standard::name_in(&c, "小包装香菇").unwrap(),
        "香菇"
    );
    assert_eq!(
        ingredient_standard::factor_in(&c, "小包装香菇", "盒", "g")
            .unwrap()
            .to_string(),
        "200"
    );
    assert!(ingredient_standard::factor_in(&c, "牛肉", "盒", "g").is_none());
    let values = sync::settings(&c).unwrap();
    assert!(values.keys().any(|k| k.starts_with("ingredient_rule:")));
    assert!(!values.contains_key("local_steward_settings"));
}
#[test]
fn different_unknown_packages_do_not_silently_cover_each_other() {
    let mut c = open(&temp()).unwrap();
    let mut d = recipe_draft();
    d.ingredients = vec![DraftIngredient {
        name: "混合菌菇".into(),
        quantity: "1".into(),
        unit: "盒".into(),
    }];
    execute(&mut c, &id(), Command::CreateRecipe { draft: d }).unwrap();
    let s = snapshot(&c).unwrap();
    let rev = s["recipes"][0]["revisionId"].as_str().unwrap();
    let today = shopping::local_today(&c).unwrap();
    let week = shopping::week(&c, &today).unwrap();
    execute(
        &mut c,
        &id(),
        Command::SavePlan {
            plan_id: None,
            expected_version: None,
            draft: planner::PlanDraft {
                recipe_revision_id: Some(rev.into()),
                custom_title: None,
                day: today.clone(),
                meal: "晚餐".into(),
                servings: 2,
            },
        },
    )
    .unwrap();
    execute(
        &mut c,
        &id(),
        Command::ReceiveLot {
            draft: inventory::InventoryDraft {
                name: "混合菌菇".into(),
                category: "未分类".into(),
                quantity: "1".into(),
                unit: "瓶".into(),
                location: "冷藏".into(),
                received: today,
                expires: None,
                precision: "rough".into(),
            },
        },
    )
    .unwrap();
    let f = shopping::forecast(&c, &week).unwrap();
    assert_eq!(f["items"][0]["remaining"], "1");
    assert_eq!(f["items"][0]["review"], true);
    assert_eq!(
        snapshot(&c).unwrap()["lots"][0]["steward"]["sourceUnit"],
        "瓶"
    );
}

#[test]
fn task_conversations_are_isolated_expire_after_thirty_days_and_leave_drafts() {
    let c = open(&temp()).unwrap();
    let task = put_item(&c, "test-task", "maintenance", "整理", "摘要", json!({})).unwrap();
    let task2 = put_item(
        &c,
        "test-task2",
        "maintenance",
        "另一任务",
        "摘要",
        json!({}),
    )
    .unwrap();
    let history = json!({"messages":[{"role":"user","content":"独立回复"}],"candidates":[]});
    crate::ai::save_task_history(&c, &task, &history).unwrap();
    assert_eq!(crate::ai::task_history(&c, &task).unwrap(), history);
    assert_eq!(
        crate::ai::task_history(&c, &task2).unwrap()["messages"],
        json!([])
    );
    assert_eq!(crate::ai::history(&c).unwrap()["messages"], json!([]));
    let week = next_week(&c, &shopping::local_today(&c).unwrap()).unwrap();
    let d = start_draft(&c, &week).unwrap();
    c.execute("UPDATE app_settings SET value=json_set(value,'$.updatedAt',unixepoch()-31*86400) WHERE key LIKE 'assistant_session:%'",[]).unwrap();
    c.execute("UPDATE local_steward_items SET status='done',created_at=datetime('now','-31 days') WHERE id=?1",[&task]).unwrap();
    assert_eq!(
        crate::ai::task_history(&c, &task).unwrap()["messages"],
        json!([])
    );
    assert!(!state(&c).unwrap()["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["id"] == task));
    assert_eq!(
        draft(&c, d["id"].as_str().unwrap()).unwrap()["status"],
        "draft"
    );
}
#[test]
fn recommendation_titles_deduplicate_and_legacy_questions_are_reduced() {
    assert!(same_dish(
        "麻婆豆腐",
        "厨师长教你：‘麻婆豆腐’的正宗做法，麻味十足"
    ));
    assert!(!same_dish("麻婆豆腐", "宫保鸡丁"));
    let c = open(&temp()).unwrap();
    put_item(&c,"legacy","maintenance","整理","technical",json!({"items":[{"name":"鸡蛋","entityId":"egg"},{"name":"AAA","entityId":"unknown"}],"questions":[{"entityId":"egg","question":"是否冷藏，何时购买？"},{"entityId":"unknown","question":"AAA是什么？"}]})).unwrap();
    let id=put_item(&c,"rec","recommendations","新菜","摘要",json!({"candidates":[{"title":"麻婆豆腐","url":"1"},{"title":"厨师长教你麻婆豆腐的正宗做法","url":"2"},{"title":"宫保鸡丁","url":"3"}]})).unwrap();
    let st = state(&c).unwrap();
    let rec = st["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == id)
        .unwrap();
    assert_eq!(rec["payload"]["candidates"].as_array().unwrap().len(), 2);
    let maintenance = st["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["kind"] == "maintenance")
        .unwrap();
    assert_eq!(
        maintenance["payload"]["questions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn manually_opened_menu_draft_reuses_one_persistent_task() {
    let c = open(&temp()).unwrap();
    let week = next_week(&c, &shopping::local_today(&c).unwrap()).unwrap();
    weekly_question(&c, &week).unwrap();
    let d = start_draft(&c, &week).unwrap();
    let task = attach_draft_task(&c, &d).unwrap();
    assert_eq!(attach_draft_task(&c, &d).unwrap(), task);
    let st = state(&c).unwrap();
    assert_eq!(st["items"].as_array().unwrap().len(), 1);
    assert_eq!(st["items"][0]["payload"]["draftId"], d["id"]);
}

#[test]
fn maintenance_reports_merge_legacy_duplicates_and_reuse_pending_task() {
    let c = open(&temp()).unwrap();
    let payload = json!({"items":[{"entityKind":"ingredient","entityId":"unknown","name":"AAA"}],"questions":[{"entityKind":"ingredient","entityId":"unknown","name":"AAA","reason":"unknown_identity","question":"AAA是什么？"}],"operations":[]});
    put_item(&c, "old1", "maintenance", "整理", "旧报告", payload.clone()).unwrap();
    put_item(&c, "old2", "maintenance", "整理", "旧报告", payload.clone()).unwrap();
    let st = state(&c).unwrap();
    let open = st["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["status"] == "open")
        .collect::<Vec<_>>();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0]["payload"]["questions"].as_array().unwrap().len(), 1);
    let task = open[0]["id"].as_str().unwrap();
    maintenance_report(
        &c,
        "new-run",
        "报告",
        None,
        payload["questions"].as_array().unwrap().clone(),
        payload["items"].as_array().unwrap().clone(),
    )
    .unwrap();
    let st = state(&c).unwrap();
    assert_eq!(
        st["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|i| i["status"] == "open")
            .count(),
        1
    );
    mark(&c, task, "done").unwrap();
    assert!(state(&c).unwrap()["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|i| i["status"] != "open"));
    assert!(state(&c).unwrap()["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["id"] == task));
}

#[test]
fn old_replied_maintenance_and_its_duplicate_leave_pending() {
    let c = open(&temp()).unwrap();
    let p = json!({"items":[],"questions":[{"entityKind":"ingredient","entityId":"unknown","name":"AAA","reason":"unknown_identity"}],"operations":[]});
    let task = put_item(&c, "replied", "maintenance", "整理", "报告", p.clone()).unwrap();
    put_item(&c, "duplicate", "maintenance", "整理", "报告", p).unwrap();
    crate::ai::save_task_history(&c,&task,&json!({"messages":[{"role":"user","content":"AAA是黄瓜"},{"role":"assistant","content":"已补充"}],"candidates":[],"proposal":null})).unwrap();
    assert!(state(&c).unwrap()["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|i| i["status"] != "open"));
}

use super::super::tests::{draft as recipe_draft, temp};
use super::*;
fn recipe(conn: &mut Connection, n: &str, servings: i64) -> (String, String) {
    let mut draft = recipe_draft();
    draft.ingredients[0].quantity = n.into();
    draft.servings = servings;
    execute(conn, &id(), Command::CreateRecipe { draft }).unwrap();
    let s = snapshot(conn).unwrap();
    let r = s["recipes"].as_array().unwrap().last().unwrap();
    (
        r["revisionId"].as_str().unwrap().into(),
        r["requirements"][0]["ingredientId"]
            .as_str()
            .unwrap()
            .into(),
    )
}
fn plan(conn: &mut Connection, rev: &str, day: &str, servings: i64) {
    execute(
        conn,
        &id(),
        Command::SavePlan {
            plan_id: None,
            expected_version: None,
            draft: planner::PlanDraft {
                recipe_revision_id: Some(rev.into()),
                custom_title: None,
                day: day.into(),
                meal: "晚餐".into(),
                servings,
            },
        },
    )
    .unwrap();
}
fn stock(conn: &mut Connection, n: &str, expires: Option<&str>, precision: &str, u: &str) {
    execute(
        conn,
        &id(),
        Command::ReceiveLot {
            draft: InventoryDraft {
                name: "西兰花".into(),
                category: "未分类".into(),
                quantity: n.into(),
                unit: u.into(),
                location: "冷藏".into(),
                received: "2026-01-01".into(),
                expires: expires.map(str::to_string),
                precision: precision.into(),
            },
        },
    )
    .unwrap();
}
fn view(conn: &Connection, scope: &str) -> Value {
    forecast_inner(conn, scope, &local_today(conn).unwrap()).unwrap()
}
fn manual(conn: &mut Connection) -> String {
    execute(
        conn,
        &id(),
        Command::SaveShopping {
            line_id: None,
            expected_version: None,
            draft: ManualDraft {
                name: "测试采购苹果".into(),
                category: "未分类".into(),
                quantity: "100".into(),
                unit: "g".into(),
            },
        },
    )
    .unwrap();
    conn.query_row(
        "SELECT id FROM shopping_lines WHERE source='manual' ORDER BY rowid DESC LIMIT 1",
        [],
        |r| r.get(0),
    )
    .unwrap()
}
fn buy_cmd(conn: &Connection, key: &str, n: &str, version: i64) -> Command {
    let ingredient = conn
        .query_row(
            "SELECT ingredient_id FROM shopping_lines WHERE id=?1",
            [key],
            |r| r.get(0),
        )
        .unwrap();
    Command::BuyShopping {
        line_id: Some(key.into()),
        expected_version: version,
        ingredient_id: ingredient,
        unit: "g".into(),
        week_start: None,
        quantity: n.into(),
    }
}
fn receipt(conn: &Connection, key: &str, n: &str, version: i64) -> Command {
    Command::ReceiveShopping {
        line_id: key.into(),
        expected_version: version,
        quantity: n.into(),
        location: "冷冻".into(),
        received: local_today(conn).unwrap(),
        expires: Some("2099-12-31".into()),
    }
}
#[test]
fn chronological_fefo_reserves_once_across_weeks_without_changing_stock() {
    let mut c = open(&temp()).unwrap();
    let (r, _) = recipe(&mut c, "300", 2);
    let (r2, _) = recipe(&mut c, "250", 2);
    stock(&mut c, "400", Some("2099-12-31"), "exact", "g");
    plan(&mut c, &r, "2099-01-05", 2);
    plan(&mut c, &r2, "2099-01-07", 2);
    plan(&mut c, &r2, "2099-01-12", 2);
    let before = snapshot(&c).unwrap();
    let first = view(&c, "2099-01-05");
    assert_eq!(first["items"][0]["required"], "550");
    assert_eq!(first["items"][0]["covered"], "400");
    assert_eq!(first["items"][0]["shortage"], "150");
    let next = view(&c, "2099-01-12");
    assert_eq!(next["items"][0]["covered"], "0");
    assert_eq!(next["items"][0]["remaining"], "250");
    assert_eq!(snapshot(&c).unwrap(), before);
}
#[test]
fn cooking_date_expiry_unknown_rough_units_and_future_receipts_require_review() {
    let mut c = open(&temp()).unwrap();
    let (r, _) = recipe(&mut c, "300", 2);
    stock(&mut c, "100", Some("2099-01-06"), "exact", "g");
    stock(&mut c, "100", Some("2099-12-31"), "exact", "g");
    stock(&mut c, "900", None, "exact", "g");
    stock(&mut c, "900", Some("2099-12-31"), "rough", "g");
    stock(&mut c, "900", Some("2099-12-31"), "exact", "个");
    plan(&mut c, &r, "2099-01-07", 2);
    let v = view(&c, "2099-01-05");
    assert_eq!(v["items"][0]["covered"], "100");
    assert_eq!(v["items"][0]["shortage"], "200");
    assert_eq!(v["items"][0]["review"], true);
    c.execute("UPDATE inventory_lots SET received_on='2099-01-06' WHERE amount_decimal='100' AND expires_on='2099-12-31'",[]).unwrap();
    assert_eq!(view(&c, "2099-01-05")["items"][0]["covered"], "0");
}
#[test]
fn earlier_valid_batch_is_used_before_later_expiry() {
    let mut c = open(&temp()).unwrap();
    let (r, _) = recipe(&mut c, "100", 2);
    stock(&mut c, "100", Some("2099-01-30"), "exact", "g");
    stock(&mut c, "100", Some("2099-01-06"), "exact", "g");
    plan(&mut c, &r, "2099-01-05", 2);
    plan(&mut c, &r, "2099-01-12", 2);
    assert_eq!(view(&c, "2099-01-12")["items"][0]["covered"], "100");
}
#[test]
fn scale_rounds_up_per_plan_and_custom_seasoning_are_reviewed() {
    let mut c = open(&temp()).unwrap();
    let (r, _) = recipe(&mut c, "1", 3);
    plan(&mut c, &r, "2099-01-05", 1);
    plan(&mut c, &r, "2099-01-06", 1);
    execute(
        &mut c,
        &id(),
        Command::SavePlan {
            plan_id: None,
            expected_version: None,
            draft: planner::PlanDraft {
                recipe_revision_id: None,
                custom_title: Some("临时菜".into()),
                day: "2099-01-07".into(),
                meal: "早餐".into(),
                servings: 2,
            },
        },
    )
    .unwrap();
    let v = view(&c, "2099-01-05");
    assert_eq!(v["items"][0]["required"], "0.666668");
    assert_eq!(v["reviewNotes"].as_array().unwrap().len(), 3);
    assert_eq!(view(&c, "2026-01-05")["items"], json!([]));
}
#[test]
fn partial_purchases_multiple_receipts_idempotency_and_restart() {
    let path = temp();
    let mut c = open(&path).unwrap();
    let key = manual(&mut c);
    let before = inventory::lots(&c).unwrap();
    let command = buy_cmd(&c, &key, "30", 1);
    execute(&mut c, &id(), command).unwrap();
    let command = buy_cmd(&c, &key, "40", 2);
    execute(&mut c, &id(), command).unwrap();
    assert_eq!(inventory::lots(&c).unwrap(), before);
    let request = id();
    let command = receipt(&c, &key, "50", 3);
    execute(&mut c, &request, command.clone()).unwrap();
    execute(&mut c, &request, command).unwrap();
    assert_eq!(inventory::lots(&c).unwrap().len(), 1);
    let v = view(&c, "2099-01-05");
    assert_eq!(v["items"][0]["purchased"], "70");
    assert_eq!(v["items"][0]["received"], "50");
    assert_eq!(v["items"][0]["unreceived"], "20");
    assert_eq!(v["items"][0]["remaining"], "30");
    let command = receipt(&c, &key, "20", 4);
    execute(&mut c, &id(), command).unwrap();
    assert_eq!(inventory::lots(&c).unwrap().len(), 2);
    let before = view(&c, "2099-01-05");
    let s = snapshot(&c).unwrap();
    drop(c);
    let c = open(&path).unwrap();
    assert_eq!(view(&c, "2099-01-05"), before);
    assert_eq!(snapshot(&c).unwrap(), s);
    assert!(c.execute("DELETE FROM purchase_events", []).is_err());
    assert!(c
        .execute("UPDATE shopping_receipts SET amount_decimal='9'", [])
        .is_err());
}
#[test]
fn receipt_failure_over_receipt_stale_version_and_invalid_inputs_leave_no_partial_write() {
    let mut c = open(&temp()).unwrap();
    let key = manual(&mut c);
    let command = buy_cmd(&c, &key, "70", 1);
    execute(&mut c, &id(), command).unwrap();
    let before = view(&c, "2099-01-05");
    let s = snapshot(&c).unwrap();
    for (n, version) in [("71", 2), ("1", 1), ("0", 2), ("0.0000001", 2)] {
        let cmd = receipt(&c, &key, n, version);
        assert!(execute(&mut c, &id(), cmd).is_err());
        assert_eq!(view(&c, "2099-01-05"), before);
        assert_eq!(snapshot(&c).unwrap(), s);
    }
    let cmd = Command::ReceiveShopping {
        line_id: key.clone(),
        expected_version: 2,
        quantity: "10".into(),
        location: "冷冻".into(),
        received: local_today(&c).unwrap(),
        expires: Some("1900-01-01".into()),
    };
    // Test through normal validation without modifying receipts.
    assert!(execute(&mut c, &id(), cmd).is_err());
    c.execute_batch("CREATE TRIGGER reject_receipt BEFORE INSERT ON shopping_receipts BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
    let cmd = receipt(&c, &key, "10", 2);
    assert!(execute(&mut c, &id(), cmd).is_err());
    assert_eq!(snapshot(&c).unwrap(), s);
    assert_eq!(view(&c, "2099-01-05"), before);
}
#[test]
fn menu_recalculation_preserves_purchase_manual_and_hidden_intent() {
    let mut c = open(&temp()).unwrap();
    let (rev, ingredient) = recipe(&mut c, "300", 2);
    plan(&mut c, &rev, "2099-01-05", 2);
    manual(&mut c);
    let cmd = Command::BuyShopping {
        line_id: None,
        expected_version: 0,
        ingredient_id: ingredient.clone(),
        unit: "g".into(),
        week_start: Some("2099-01-05".into()),
        quantity: "200".into(),
    };
    let request = id();
    execute(&mut c, &request, cmd.clone()).unwrap();
    execute(&mut c, &request, cmd).unwrap();
    let plan_id = snapshot(&c).unwrap()["plans"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    execute(
        &mut c,
        &id(),
        Command::RemovePlan {
            plan_id,
            expected_version: 1,
        },
    )
    .unwrap();
    let v = view(&c, "2099-01-05");
    let row = v["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["source"] == "plan")
        .unwrap();
    assert_eq!(row["purchased"], "200");
    assert_eq!(row["surplus"], true);
    assert_eq!(row["required"], "0");
    plan(&mut c, &rev, "2099-01-05", 2);
    execute(
        &mut c,
        &id(),
        Command::HideShopping {
            week_start: "2099-01-05".into(),
            ingredient_id: ingredient,
            unit: "g".into(),
        },
    )
    .unwrap();
    let v = view(&c, "2099-01-05");
    let row = v["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["source"] == "plan")
        .unwrap();
    assert_eq!(row["remaining"], "0");
    assert_eq!(row["purchased"], "200");
    execute(
        &mut c,
        &id(),
        Command::RefreshShopping {
            week_start: "2099-01-05".into(),
        },
    )
    .unwrap();
    let v = view(&c, "2099-01-05");
    assert!(v["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["remaining"] == "100"));
    assert_eq!(view(&c, "2099-01-12")["items"].as_array().unwrap().len(), 1);
}
#[test]
fn receipt_undo_restores_unreceived_and_preserves_purchase_history() {
    let mut c = open(&temp()).unwrap();
    let key = manual(&mut c);
    let cmd = buy_cmd(&c, &key, "10", 1);
    execute(&mut c, &id(), cmd).unwrap();
    let cmd = receipt(&c, &key, "10", 2);
    execute(&mut c, &id(), cmd).unwrap();
    let lot = inventory::lots(&c).unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    execute(
        &mut c,
        &id(),
        Command::UndoInventory {
            lot_id: lot.clone(),
            expected_version: 1,
        },
    )
    .unwrap();
    let v = view(&c, "2099-01-05");
    assert_eq!(v["items"][0]["received"], "0");
    assert_eq!(v["items"][0]["unreceived"], "10");
    assert_eq!(v["items"][0]["purchased"], "10");
    let command = receipt(&c, &key, "10", 4);
    execute(&mut c, &id(), command).unwrap();
    let new_lot = inventory::lots(&c)
        .unwrap()
        .into_iter()
        .find(|r| r["quantity"] == "10")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        execute(
            &mut c,
            &id(),
            Command::SaveShopping {
                line_id: Some(key),
                expected_version: Some(5),
                draft: ManualDraft {
                    name: "改名".into(),
                    category: "未分类".into(),
                    quantity: "1".into(),
                    unit: "g".into()
                }
            }
        )
        .unwrap_err()
        .code,
        "PURCHASE_RECORDED"
    );
    execute(
        &mut c,
        &id(),
        Command::ChangeLot {
            lot_id: new_lot.clone(),
            expected_version: 1,
            operation: "use".into(),
            quantity: "1".into(),
            location: None,
            reason: "".into(),
        },
    )
    .unwrap();
    execute(
        &mut c,
        &id(),
        Command::UndoInventory {
            lot_id: new_lot,
            expected_version: 2,
        },
    )
    .unwrap();
}
#[test]
fn memo_persists_and_stale_revision_does_not_overwrite() {
    let path = temp();
    let mut c = open(&path).unwrap();
    let before = snapshot(&c).unwrap();
    execute(
        &mut c,
        &id(),
        Command::SaveShoppingMemo {
            memo: "挑新鲜的".into(),
            expected_revision: before["dataRevision"].as_str().unwrap().into(),
        },
    )
    .unwrap();
    assert!(execute(
        &mut c,
        &id(),
        Command::SaveShoppingMemo {
            memo: "旧草稿".into(),
            expected_revision: "0".into()
        }
    )
    .is_err());
    drop(c);
    let c = open(&path).unwrap();
    assert_eq!(snapshot(&c).unwrap()["memo"], "挑新鲜的");
}
#[test]
fn schema_four_migration_keeps_recipe_inventory_plans_and_creates_backup() {
    let path = temp();
    let mut c = open(&path).unwrap();
    let (rev, _) = recipe(&mut c, "300", 2);
    stock(&mut c, "100", None, "exact", "g");
    plan(&mut c, &rev, "2099-01-05", 2);
    let before = snapshot(&c).unwrap();
    super::super::tests::downgrade_cooking(&c);
    c.execute_batch("DROP TABLE shopping_combined_purchases; DROP TABLE shopping_receipt_undos; DROP TABLE shopping_receipts; DROP TABLE purchase_events; DROP TABLE shopping_lines; DROP TABLE shopping_suppressions; DELETE FROM app_settings WHERE key='shopping_memo'; DELETE FROM schema_migrations WHERE version>=5; PRAGMA user_version=4;").unwrap();
    drop(c);
    let c = open(&path).unwrap();
    assert_eq!(snapshot(&c).unwrap(), before);
    let prefix = format!("{}.pre-v5-", path.file_stem().unwrap().to_string_lossy());
    assert!(std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(|e| e.ok())
        .any(|e| e.file_name().to_string_lossy().starts_with(&prefix)));
}

fn purchase_cmd(
    c: &Connection,
    key: Option<String>,
    ingredient: String,
    scope: Option<String>,
    version: i64,
    n: &str,
    expires: Option<String>,
) -> Command {
    Command::PurchaseShopping {
        line_id: key,
        expected_version: version,
        ingredient_id: ingredient,
        unit: "g".into(),
        week_start: scope,
        quantity: n.into(),
        location: "常温".into(),
        received: local_today(c).unwrap(),
        expires,
    }
}

#[test]
fn household_purchase_stocks_once_survives_restart_and_undo_cancels_both() {
    let path = temp();
    let mut c = open(&path).unwrap();
    let key = manual(&mut c);
    let ingredient: String = c
        .query_row(
            "SELECT ingredient_id FROM shopping_lines WHERE id=?1",
            [&key],
            |r| r.get(0),
        )
        .unwrap();
    let cmd = purchase_cmd(&c, Some(key.clone()), ingredient, None, 1, "0.123456", None);
    let request = id();
    execute(&mut c, &request, cmd.clone()).unwrap();
    execute(&mut c, &request, cmd).unwrap();
    let lots = inventory::lots(&c).unwrap();
    assert_eq!(lots.len(), 1);
    assert_eq!(lots[0]["quantity"], "0.123456");
    assert_eq!(lots[0]["location"], "常温");
    assert!(lots[0]["expires"].is_null());
    let lot = lots[0]["id"].as_str().unwrap().to_string();
    drop(c);
    let mut c = open(&path).unwrap();
    let v = view(&c, "2099-01-05");
    assert_eq!(v["items"][0]["purchased"], "0.123456");
    assert_eq!(v["items"][0]["received"], "0.123456");
    assert_eq!(v["items"][0]["unreceived"], "0");
    execute(
        &mut c,
        &id(),
        Command::UndoInventory {
            lot_id: lot.clone(),
            expected_version: 1,
        },
    )
    .unwrap();
    let v = view(&c, "2099-01-05");
    assert_eq!(v["items"][0]["purchased"], "0");
    assert_eq!(v["items"][0]["received"], "0");
    assert_eq!(v["items"][0]["unreceived"], "0");
    assert!(v["items"][0]["history"]
        .as_array()
        .unwrap()
        .iter()
        .any(|h| h["kind"] == "undo_purchase"));
    assert!(execute(
        &mut c,
        &id(),
        Command::UndoInventory {
            lot_id: lot,
            expected_version: 2
        }
    )
    .is_err());
}

#[test]
fn household_purchase_failure_rolls_back_purchase_lot_receipt_and_revision() {
    let mut c = open(&temp()).unwrap();
    let key = manual(&mut c);
    let ingredient: String = c
        .query_row(
            "SELECT ingredient_id FROM shopping_lines WHERE id=?1",
            [&key],
            |r| r.get(0),
        )
        .unwrap();
    let before = snapshot(&c).unwrap();
    for expiry in [Some("2000-01-01".into()), None] {
        if expiry.is_none() {
            c.execute_batch("CREATE TRIGGER fail_receipt BEFORE INSERT ON shopping_receipts BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        }
        let cmd = purchase_cmd(
            &c,
            Some(key.clone()),
            ingredient.clone(),
            None,
            1,
            "10",
            expiry,
        );
        assert!(execute(&mut c, &id(), cmd).is_err());
        assert_eq!(snapshot(&c).unwrap(), before);
        for table in [
            "purchase_events",
            "shopping_receipts",
            "shopping_combined_purchases",
            "inventory_lots",
        ] {
            assert_eq!(
                c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }
    assert!(serde_json::from_value::<Command>(json!({"type":"buy_shopping","line_id":key,"expected_version":1,"ingredient_id":ingredient,"unit":"g","week_start":null,"quantity":"10"})).is_err());
}

#[test]
fn household_purchase_with_unknown_expiry_fulfils_own_item_without_covering_other_weeks() {
    let mut c = open(&temp()).unwrap();
    let (revision, ingredient) = recipe(&mut c, "100", 2);
    plan(&mut c, &revision, "2099-01-05", 2);
    plan(&mut c, &revision, "2099-01-12", 2);
    let command = purchase_cmd(
        &c,
        None,
        ingredient,
        Some("2099-01-05".into()),
        0,
        "200",
        None,
    );
    execute(&mut c, &id(), command).unwrap();
    let v = view(&c, "2099-01-05");
    assert_eq!(v["items"][0]["remaining"], "0");
    assert_eq!(v["items"][0]["required"], "100");
    assert_eq!(v["items"][0]["purchased"], "200");
    assert_eq!(v["items"][0]["shortage"], "100"); // Stock-only gap; UI uses remaining purchase need.
    assert_eq!(v["items"][0]["covered"], "0");
    assert_eq!(v["items"][0]["review"], true);
    assert_eq!(view(&c, "2099-01-12")["items"][0]["remaining"], "100");
}

#[test]
fn schema_five_migration_preserves_old_pending_receipts_and_keeps_new_purchases_separate() {
    let path = temp();
    let mut c = open(&path).unwrap();
    let key = manual(&mut c);
    let command = buy_cmd(&c, &key, "70", 1);
    execute(&mut c, &id(), command).unwrap();
    let before = snapshot(&c).unwrap();
    super::super::tests::downgrade_cooking(&c);
    c.execute_batch("DROP TABLE shopping_combined_purchases; DELETE FROM schema_migrations WHERE version=6; PRAGMA user_version=5;").unwrap();
    drop(c);
    let mut c = open(&path).unwrap();
    assert_eq!(snapshot(&c).unwrap(), before);
    let ingredient: String = c
        .query_row(
            "SELECT ingredient_id FROM shopping_lines WHERE id=?1",
            [&key],
            |r| r.get(0),
        )
        .unwrap();
    let command = purchase_cmd(&c, Some(key.clone()), ingredient, None, 2, "30", None);
    execute(&mut c, &id(), command).unwrap();
    assert_eq!(view(&c, "2099-01-05")["items"][0]["unreceived"], "70");
    let new_received:String=c.query_row("SELECT r.amount_decimal FROM shopping_receipts r JOIN shopping_combined_purchases b ON b.purchase_id=r.purchase_id",[],|r|r.get(0)).unwrap();
    assert_eq!(new_received, "30");
    let command = receipt(&c, &key, "70", 4);
    execute(&mut c, &id(), command).unwrap();
    assert_eq!(view(&c, "2099-01-05")["items"][0]["unreceived"], "0");
}

#[test]
fn removing_purchased_manual_item_keeps_stock_and_history_after_restart() {
    let path = temp();
    let mut c = open(&path).unwrap();
    let key = manual(&mut c);
    let ingredient: String = c
        .query_row(
            "SELECT ingredient_id FROM shopping_lines WHERE id=?1",
            [&key],
            |r| r.get(0),
        )
        .unwrap();
    let command = purchase_cmd(&c, Some(key.clone()), ingredient, None, 1, "100", None);
    execute(&mut c, &id(), command).unwrap();
    let stock = inventory::lots(&c).unwrap();
    assert!(execute(
        &mut c,
        &id(),
        Command::RemoveShopping {
            line_id: key.clone(),
            expected_version: 1
        }
    )
    .is_err());
    execute(
        &mut c,
        &id(),
        Command::RemoveShopping {
            line_id: key.clone(),
            expected_version: 3,
        },
    )
    .unwrap();
    assert_eq!(inventory::lots(&c).unwrap(), stock);
    assert!(view(&c, "2099-01-05")["items"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        totals(&c, &key).unwrap(),
        (Decimal::from(100), Decimal::from(100))
    );
    drop(c);
    let c = open(&path).unwrap();
    assert_eq!(inventory::lots(&c).unwrap(), stock);
    assert!(view(&c, "2099-01-05")["items"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        totals(&c, &key).unwrap(),
        (Decimal::from(100), Decimal::from(100))
    );
}

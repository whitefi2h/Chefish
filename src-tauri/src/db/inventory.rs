use super::*;
use rust_decimal::Decimal;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InventoryDraft {
    pub name: String,
    pub category: String,
    pub quantity: String,
    pub unit: String,
    pub location: String,
    pub received: String,
    pub expires: Option<String>,
    pub precision: String,
}
fn decimal(value: &str) -> Result<Decimal> {
    let n =
        Decimal::from_str(value).map_err(|_| error("INVALID_QUANTITY", "数量必须是十进制数字"))?;
    if n < Decimal::ZERO || n > Decimal::from(100000) || n.scale() > 6 {
        return Err(error("INVALID_QUANTITY", "数量须为 0–100000，最多六位小数"));
    }
    Ok(n)
}
fn location(conn: &Connection, name: &str) -> Result<String> {
    conn.query_row(
        "SELECT id FROM storage_locations WHERE name=?1",
        [name],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| error("INVALID_INPUT", "库位不存在"))
}
struct Lot {
    amount: Decimal,
    location: String,
    version: i64,
}
fn lot(conn: &Connection, id: &str) -> Result<Lot> {
    let (amount, location, version): (String, String, i64) = conn
        .query_row(
            "SELECT amount_decimal,location_id,version FROM inventory_lots WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| error("NOT_FOUND", "批次不存在，请刷新"))?;
    Ok(Lot {
        amount: decimal(&amount)?,
        location,
        version,
    })
}
fn event(
    tx: &Transaction,
    lot_id: &str,
    kind: &str,
    before: &Lot,
    after: Decimal,
    target: &str,
    reason: &str,
    reversed: Option<&str>,
) -> Result<()> {
    if reason.chars().count() > 2000 {
        return Err(error("INVALID_INPUT", "说明超过长度限制"));
    }
    tx.execute("INSERT INTO inventory_events(id,lot_id,kind,before_amount,after_amount,before_location,after_location,after_version,reason,reversed_event_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", params![id(),lot_id,kind,before.amount.normalize().to_string(),after.normalize().to_string(),before.location,target,before.version+1,reason.trim(),reversed])?;
    Ok(())
}
pub fn receive(tx: &Transaction, draft: InventoryDraft) -> Result<()> {
    receive_batch(tx, draft, "手动购买").map(|_| ())
}
pub fn receive_batch(tx: &Transaction, draft: InventoryDraft, reason: &str) -> Result<String> {
    text(&draft.name, 120)?;
    let quantity = decimal(&draft.quantity)?;
    if quantity == Decimal::ZERO
        || !["g", "ml", "个", "片", "盒"].contains(&draft.unit.as_str())
        || !["exact", "rough"].contains(&draft.precision.as_str())
    {
        return Err(error("INVALID_INPUT", "请核对数量、单位和精度"));
    }
    if !valid_date(&draft.received)
        || draft
            .expires
            .as_ref()
            .is_some_and(|d| !valid_date(d) || d < &draft.received)
    {
        return Err(error(
            "INVALID_INPUT",
            "请核对购买日期和到期日期；未知到期日可留空",
        ));
    }
    let target = location(tx, &draft.location)?;
    let category = category(tx, "ingredient", &draft.category)?;
    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM ingredients WHERE name=?1",
            [draft.name.trim()],
            |r| r.get(0),
        )
        .optional()?;
    let ingredient = if let Some(existing) = existing {
        existing
    } else {
        let new_id = id();
        tx.execute(
            "INSERT INTO ingredients VALUES(?1,?2,?3)",
            params![new_id, draft.name.trim(), category],
        )?;
        new_id
    };
    let new_id = id();
    tx.execute(
        "INSERT INTO inventory_lots VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1)",
        params![
            new_id,
            ingredient,
            quantity.normalize().to_string(),
            draft.unit,
            target,
            draft.received,
            draft.expires,
            draft.precision
        ],
    )?;
    event(
        tx,
        &new_id,
        "receive",
        &Lot {
            amount: Decimal::ZERO,
            location: target.clone(),
            version: 0,
        },
        quantity,
        &target,
        reason,
        None,
    )?;
    Ok(new_id)
}
pub fn change(
    tx: &Transaction,
    id: &str,
    expected: i64,
    operation: &str,
    quantity: &str,
    target: Option<&str>,
    reason: &str,
) -> Result<()> {
    let before = lot(tx, id)?;
    if before.version != expected {
        return Err(error("STALE_REVISION", "批次已变化，请重新加载后核对数量"));
    }
    let n = decimal(quantity)?;
    let next = match operation {
        "correct" => n,
        "use" | "discard" => {
            if n == Decimal::ZERO {
                return Err(error("INVALID_QUANTITY", "使用或丢弃数量须大于零"));
            }
            if n > before.amount {
                return Err(error("INSUFFICIENT_STOCK", "本批次剩余量不足，未扣减"));
            }
            before.amount - n
        }
        "move" => before.amount,
        _ => return Err(error("INVALID_INPUT", "未知库存操作")),
    };
    let target = if operation == "move" {
        location(
            tx,
            target.ok_or_else(|| error("INVALID_INPUT", "请选择库位"))?,
        )?
    } else {
        before.location.clone()
    };
    if next == before.amount && target == before.location {
        return Err(error("NO_CHANGE", "数量和库位未变化，无需提交"));
    }
    tx.execute(
        "UPDATE inventory_lots SET amount_decimal=?1,location_id=?2,version=version+1 WHERE id=?3",
        params![next.normalize().to_string(), target, id],
    )?;
    event(tx, id, operation, &before, next, &target, reason, None)
}
pub fn set_expiry(
    tx: &Transaction,
    lot_id: &str,
    expected: i64,
    expires: Option<&str>,
    reason: &str,
) -> Result<()> {
    let before = lot(tx, lot_id)?;
    if before.version != expected {
        return Err(error("STALE_REVISION", "批次已变化，请刷新后重试"));
    }
    text(reason, 2000)?;
    let (received, previous): (String, Option<String>) = tx.query_row(
        "SELECT received_on,expires_on FROM inventory_lots WHERE id=?1",
        [lot_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if expires.is_some_and(|d| !valid_date(d) || d < received.as_str()) {
        return Err(error("INVALID_INPUT", "到期日期须有效且不早于购买日期"));
    }
    if previous.as_deref() == expires {
        return Err(error("NO_CHANGE", "到期日期未变化"));
    }
    tx.execute(
        "UPDATE inventory_lots SET expires_on=?1,version=version+1 WHERE id=?2",
        params![expires, lot_id],
    )?;
    event(
        tx,
        lot_id,
        "correct",
        &before,
        before.amount,
        &before.location,
        reason,
        None,
    )?;
    let event_id: String = tx.query_row(
        "SELECT id FROM inventory_events WHERE lot_id=?1 AND after_version=?2",
        params![lot_id, before.version + 1],
        |r| r.get(0),
    )?;
    // Existing event storage keeps quantity/location; retain the optional expiry for undo too.
    tx.execute(
        "INSERT INTO app_settings(key,value) VALUES(?1,?2)",
        params![
            format!("inventory_expiry_before:{event_id}"),
            serde_json::to_string(&previous).unwrap()
        ],
    )?;
    Ok(())
}
pub fn undo(tx: &Transaction, lot_id: &str, expected: i64) -> Result<()> {
    if lot(tx, lot_id)?.version != expected {
        return Err(error("STALE_REVISION", "食材已变化，请刷新后重试"));
    }
    let event_id: String = tx
        .query_row(
            "SELECT id FROM inventory_events WHERE lot_id=?1 ORDER BY after_version DESC LIMIT 1",
            [lot_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| error("NOT_FOUND", "没有可撤销的操作"))?;
    reverse(tx, &event_id, "撤销上次操作")
}
pub fn reverse(tx: &Transaction, event_id: &str, reason: &str) -> Result<()> {
    let cooking: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM cooking_consumptions WHERE event_id=?1)",
        [event_id],
        |r| r.get(0),
    )?;
    if cooking {
        return Err(error(
            "COOKING_EVENT",
            "这次使用属于烹饪记录，请在周菜单撤销整次烹饪",
        ));
    }
    reverse_inner(tx, event_id, reason)
}
pub(super) fn reverse_inner(tx: &Transaction, event_id: &str, reason: &str) -> Result<()> {
    let (lot_id,kind,amount,target,version):(String,String,String,String,i64)=tx.query_row("SELECT lot_id,kind,before_amount,before_location,after_version FROM inventory_events WHERE id=?1",[event_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?.ok_or_else(||error("NOT_FOUND","操作记录不存在"))?;
    let before = lot(tx, &lot_id)?;
    if kind == "reverse" || before.version != version {
        return Err(error(
            "STALE_REVISION",
            "只能撤销最后一次操作，请刷新后重试",
        ));
    }
    if kind == "receive" {
        shopping::undo_receipt(tx, &lot_id)?;
    }
    let prior_expiry: Option<String> = tx
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [format!("inventory_expiry_before:{event_id}")],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(prior) = prior_expiry {
        let expires: Option<String> = serde_json::from_str(&prior)
            .map_err(|_| error("DATABASE_ERROR", "到期日期撤销记录损坏"))?;
        tx.execute(
            "UPDATE inventory_lots SET expires_on=?1 WHERE id=?2",
            params![expires, lot_id],
        )?;
    }
    let next = decimal(&amount)?;
    tx.execute(
        "UPDATE inventory_lots SET amount_decimal=?1,location_id=?2,version=version+1 WHERE id=?3",
        params![next.normalize().to_string(), target, lot_id],
    )?;
    event(
        tx,
        &lot_id,
        "reverse",
        &before,
        next,
        &target,
        reason,
        Some(event_id),
    )
}
pub fn lots(conn: &Connection) -> Result<Vec<Value>> {
    let mut stmt=conn.prepare("SELECT l.id,l.ingredient_id,l.amount_decimal,l.unit,s.name,l.received_on,l.expires_on,l.precision,l.version FROM inventory_lots l JOIN storage_locations s ON s.id=l.location_id ORDER BY (l.amount_decimal='0'),l.expires_on IS NULL,l.expires_on,l.received_on,l.id")?;
    let rows=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"ingredientId":r.get::<_,String>(1)?,"quantity":r.get::<_,String>(2)?,"unit":r.get::<_,String>(3)?,"location":r.get::<_,String>(4)?,"received":r.get::<_,String>(5)?,"expires":r.get::<_,Option<String>>(6)?,"precision":r.get::<_,String>(7)?,"version":r.get::<_,i64>(8)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(rows)
}
pub fn events(conn: &Connection) -> Result<Vec<Value>> {
    let mut stmt=conn.prepare("SELECT e.id,e.lot_id,e.kind,e.before_amount,e.after_amount,a.name,b.name,e.after_version,e.reason,e.reversed_event_id,e.occurred_at FROM inventory_events e JOIN storage_locations a ON a.id=e.before_location JOIN storage_locations b ON b.id=e.after_location ORDER BY e.rowid DESC")?;
    let rows=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"lotId":r.get::<_,String>(1)?,"kind":r.get::<_,String>(2)?,"before":r.get::<_,String>(3)?,"after":r.get::<_,String>(4)?,"beforeLocation":r.get::<_,String>(5)?,"afterLocation":r.get::<_,String>(6)?,"afterVersion":r.get::<_,i64>(7)?,"reason":r.get::<_,String>(8)?,"reversedEventId":r.get::<_,Option<String>>(9)?,"occurredAt":r.get::<_,String>(10)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(rows)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("chefish-m2-{}.sqlite3", id()))
    }
    fn draft() -> InventoryDraft {
        InventoryDraft {
            name: "测试豆腐".into(),
            category: "未分类".into(),
            quantity: "0.3".into(),
            unit: "g".into(),
            location: "冷藏".into(),
            received: "2026-10-19".into(),
            expires: None,
            precision: "exact".into(),
        }
    }
    fn change_cmd(lot_id: &str, version: i64, op: &str, n: &str) -> Command {
        Command::ChangeLot {
            lot_id: lot_id.into(),
            expected_version: version,
            operation: op.into(),
            quantity: n.into(),
            location: Some("冷冻".into()),
            reason: "核对实物后记录".into(),
        }
    }
    fn make(conn: &mut Connection) -> String {
        execute(conn, &id(), Command::ReceiveLot { draft: draft() }).unwrap();
        lots(conn).unwrap()[0]["id"].as_str().unwrap().into()
    }
    #[test]
    fn expiry_update_preserves_stock_is_versioned_and_reversible() {
        let mut c = open(&temp()).unwrap();
        let lot_id = make(&mut c);
        let cmd = |version, expiry: Option<&str>| Command::SetLotExpiry {
            lot_id: lot_id.clone(),
            expected_version: version,
            expires: expiry.map(String::from),
            reason: "估计：完整未剥皮，冷藏；预计复查日期".into(),
        };
        assert!(execute(&mut c, &id(), cmd(1, Some("2026-10-18"))).is_err());
        execute(&mut c, &id(), cmd(1, Some("2026-11-02"))).unwrap();
        let rows = lots(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["quantity"], "0.3");
        assert_eq!(rows[0]["received"], "2026-10-19");
        assert_eq!(rows[0]["expires"], "2026-11-02");
        assert!(execute(&mut c, &id(), cmd(1, None)).is_err());
        execute(
            &mut c,
            &id(),
            Command::UndoInventory {
                lot_id: lot_id.clone(),
                expected_version: 2,
            },
        )
        .unwrap();
        assert!(lots(&c).unwrap()[0]["expires"].is_null());
        execute(&mut c, &id(), cmd(3, Some("2026-11-03"))).unwrap();
        execute(&mut c, &id(), cmd(4, None)).unwrap();
        execute(
            &mut c,
            &id(),
            Command::UndoInventory {
                lot_id,
                expected_version: 5,
            },
        )
        .unwrap();
        assert_eq!(lots(&c).unwrap()[0]["expires"], "2026-11-03");
    }
    #[test]
    fn quantity_operations_accept_empty_notes_and_keep_quantity_guards() {
        let mut c = open(&temp()).unwrap();
        let lot_id = make(&mut c);
        for (version, operation, quantity) in [
            (1, "correct", "0.4"),
            (2, "use", "0.1"),
            (3, "discard", "0.3"),
        ] {
            execute(
                &mut c,
                &id(),
                Command::ChangeLot {
                    lot_id: lot_id.clone(),
                    expected_version: version,
                    operation: operation.into(),
                    quantity: quantity.into(),
                    location: None,
                    reason: String::new(),
                },
            )
            .unwrap();
            assert_eq!(events(&c).unwrap()[0]["reason"], "");
        }
        assert_eq!(lots(&c).unwrap()[0]["quantity"], "0");
        let before = snapshot(&c).unwrap();
        for (operation, quantity, reason) in [
            ("discard", "1", "".to_string()),
            ("correct", "1", "x".repeat(2001)),
        ] {
            assert!(execute(
                &mut c,
                &id(),
                Command::ChangeLot {
                    lot_id: lot_id.clone(),
                    expected_version: 4,
                    operation: operation.into(),
                    quantity: quantity.into(),
                    location: None,
                    reason
                }
            )
            .is_err());
            assert_eq!(snapshot(&c).unwrap(), before);
        }
    }
    #[test]
    fn exact_quantities_events_and_restart_are_durable() {
        let path = temp();
        let mut conn = open(&path).unwrap();
        let lot_id = make(&mut conn);
        execute(&mut conn, &id(), change_cmd(&lot_id, 1, "use", "0.1")).unwrap();
        execute(&mut conn, &id(), change_cmd(&lot_id, 2, "discard", "0.1")).unwrap();
        execute(&mut conn, &id(), change_cmd(&lot_id, 3, "move", "0")).unwrap();
        assert_eq!(lots(&conn).unwrap()[0]["quantity"], "0.1");
        assert_eq!(events(&conn).unwrap().len(), 4);
        let before = snapshot(&conn).unwrap();
        drop(conn);
        let conn = open(&path).unwrap();
        assert_eq!(snapshot(&conn).unwrap(), before);
        assert_eq!(lots(&conn).unwrap()[0]["expires"], Value::Null);
        assert!(conn
            .execute("UPDATE inventory_events SET reason='edit'", [])
            .is_err());
    }
    #[test]
    fn duplicate_receipts_conflicts_and_insufficient_stock_do_not_write() {
        let mut conn = open(&temp()).unwrap();
        let request = id();
        let command = Command::ReceiveLot { draft: draft() };
        execute(&mut conn, &request, command.clone()).unwrap();
        execute(&mut conn, &request, command).unwrap();
        assert_eq!(lots(&conn).unwrap().len(), 1);
        let lot_id = lots(&conn).unwrap()[0]["id"].as_str().unwrap().to_string();
        let before = snapshot(&conn).unwrap();
        assert_eq!(
            execute(&mut conn, &id(), change_cmd(&lot_id, 0, "use", "0.1"))
                .unwrap_err()
                .code,
            "STALE_REVISION"
        );
        assert_eq!(
            execute(&mut conn, &id(), change_cmd(&lot_id, 1, "use", "0.4"))
                .unwrap_err()
                .code,
            "INSUFFICIENT_STOCK"
        );
        assert_eq!(snapshot(&conn).unwrap(), before);
    }
    #[test]
    fn correction_and_explicit_reverse_preserve_audit_chain() {
        let mut conn = open(&temp()).unwrap();
        let lot_id = make(&mut conn);
        execute(&mut conn, &id(), change_cmd(&lot_id, 1, "correct", "0.6")).unwrap();
        let rows = events(&conn).unwrap();
        let e = rows[0]["id"].as_str().unwrap();
        execute(
            &mut conn,
            &id(),
            Command::ReverseInventoryEvent {
                event_id: e.into(),
                reason: "误录纠正".into(),
            },
        )
        .unwrap();
        assert_eq!(lots(&conn).unwrap()[0]["quantity"], "0.3");
        assert_eq!(events(&conn).unwrap().len(), 3);
        assert!(execute(
            &mut conn,
            &id(),
            Command::ReverseInventoryEvent {
                event_id: e.into(),
                reason: "再点一次".into()
            }
        )
        .is_err());
        assert!(execute(
            &mut conn,
            &id(),
            Command::ReverseInventoryEvent {
                event_id: rows[1]["id"].as_str().unwrap().into(),
                reason: "更早流水".into()
            }
        )
        .is_err());
    }
    #[test]
    fn event_insert_failure_rolls_back_lot_and_new_ingredient() {
        let mut conn = open(&temp()).unwrap();
        conn.execute_batch("CREATE TRIGGER simulate_failure BEFORE INSERT ON inventory_events BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        let before = snapshot(&conn).unwrap();
        assert!(execute(&mut conn, &id(), Command::ReceiveLot { draft: draft() }).is_err());
        assert_eq!(before, snapshot(&conn).unwrap());
    }
    #[test]
    fn migration_from_v1_preserves_recipes_and_takes_backup() {
        let path = temp();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(include_str!("../../migrations/0001_recipes.sql"))
            .unwrap();
        conn.execute(
            "INSERT INTO categories VALUES('original','recipe','保留分类')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO recipes(id,category_id) VALUES('original-recipe','original')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO schema_migrations(version) VALUES(1)", [])
            .unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        drop(conn);
        let conn = open(&path).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT category_id FROM recipes WHERE id='original-recipe'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "original"
        );
        assert_eq!(
            conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            11
        );
        let prefix = path.file_stem().unwrap().to_str().unwrap();
        assert!(std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e
                .file_name()
                .to_string_lossy()
                .starts_with(&format!("{prefix}.pre-v2-"))));
    }
    #[test]
    fn multiple_lots_sort_fefo_and_changes_only_touch_selected_batch() {
        let mut conn = open(&temp()).unwrap();
        for expiry in [None, Some("2026-10-21"), Some("2026-10-20")] {
            let mut d = draft();
            d.expires = expiry.map(String::from);
            execute(&mut conn, &id(), Command::ReceiveLot { draft: d }).unwrap();
        }
        let rows = lots(&conn).unwrap();
        assert_eq!(rows[0]["expires"], "2026-10-20");
        assert_eq!(rows[1]["expires"], "2026-10-21");
        assert_eq!(rows[2]["expires"], Value::Null);
        execute(
            &mut conn,
            &id(),
            change_cmd(rows[0]["id"].as_str().unwrap(), 1, "use", "0.1"),
        )
        .unwrap();
        let changed = lots(&conn).unwrap();
        assert_eq!(changed[0]["quantity"], "0.2");
        assert_eq!(changed[1]["quantity"], "0.3");
        assert_eq!(changed[2]["quantity"], "0.3");
        assert_eq!(
            snapshot(&conn).unwrap()["ingredients"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn invalid_receipt_fields_leave_no_partial_data() {
        let mut conn = open(&temp()).unwrap();
        let before = snapshot(&conn).unwrap();
        for quantity in ["0", "-1", "NaN", "0.0000001", "100001"] {
            let mut d = draft();
            d.quantity = quantity.into();
            assert!(execute(&mut conn, &id(), Command::ReceiveLot { draft: d }).is_err());
            assert_eq!(snapshot(&conn).unwrap(), before);
        }
        let mut d = draft();
        d.expires = Some("2026-10-18".into());
        assert!(execute(&mut conn, &id(), Command::ReceiveLot { draft: d }).is_err());
        assert_eq!(snapshot(&conn).unwrap(), before);
    }
    #[test]
    fn undo_last_action_needs_no_reason_and_cannot_repeat() {
        let mut conn = open(&temp()).unwrap();
        let lot_id = make(&mut conn);
        execute(&mut conn, &id(), change_cmd(&lot_id, 1, "use", "0.1")).unwrap();
        let request = id();
        let command = Command::UndoInventory {
            lot_id: lot_id.clone(),
            expected_version: 2,
        };
        execute(&mut conn, &request, command.clone()).unwrap();
        execute(&mut conn, &request, command).unwrap();
        assert_eq!(lots(&conn).unwrap()[0]["quantity"], "0.3");
        assert_eq!(events(&conn).unwrap().len(), 3);
        assert!(execute(
            &mut conn,
            &id(),
            Command::UndoInventory {
                lot_id,
                expected_version: 3
            }
        )
        .is_err());
    }
    #[test]
    fn empty_lot_is_sorted_after_available_lots() {
        let mut conn = open(&temp()).unwrap();
        let first = make(&mut conn);
        make(&mut conn);
        execute(&mut conn, &id(), change_cmd(&first, 1, "use", "0.3")).unwrap();
        let rows = lots(&conn).unwrap();
        assert_eq!(rows[0]["quantity"], "0.3");
        assert_eq!(rows[1]["id"], first);
        assert_eq!(rows[1]["quantity"], "0");
    }
}

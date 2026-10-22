use super::*;
use rust_decimal::{Decimal, RoundingStrategy};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Consumption {
    pub lot_id: String,
    pub expected_version: i64,
    pub quantity: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompleteDraft {
    pub plan_id: String,
    pub expected_version: i64,
    pub expected_revision: String,
    pub servings: i64,
    pub date: String,
    pub note: String,
    pub acknowledged: bool,
    pub consumptions: Vec<Consumption>,
}
pub fn editable(conn: &Connection, key: &str) -> Result<()> {
    let done: bool = conn.query_row(
        "SELECT cooking_session_id IS NOT NULL FROM planned_meals WHERE id=?1",
        [key],
        |r| r.get(0),
    )?;
    if done {
        return Err(error(
            "ALREADY_COMPLETED",
            "这道菜已完成，请先撤销烹饪再修改菜单",
        ));
    }
    Ok(())
}
fn plan(conn: &Connection, key: &str) -> Result<(Option<String>, i64)> {
    conn.query_row(
        "SELECT recipe_revision_id,version FROM planned_meals WHERE id=?1 AND removed=0",
        [key],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| error("NOT_FOUND", "配餐不存在，请刷新"))
}
fn number(s: &str) -> Result<Decimal> {
    let n = Decimal::from_str(s).map_err(|_| error("INVALID_QUANTITY", "用量必须是十进制数"))?;
    if n < Decimal::ZERO || n > Decimal::from(100000) || n.scale() > 6 {
        return Err(error("INVALID_QUANTITY", "数量须为 0–100000，最多六位小数"));
    }
    Ok(n)
}
fn requirements(
    conn: &Connection,
    rev: Option<&str>,
    servings: i64,
) -> Result<BTreeMap<(String, String), Decimal>> {
    let mut result = BTreeMap::new();
    if let Some(rev) = rev {
        let standard: i64 = conn.query_row(
            "SELECT servings FROM recipe_revisions WHERE id=?1",
            [rev],
            |r| r.get(0),
        )?;
        let mut stmt=conn.prepare("SELECT ingredient_id,unit,amount_decimal FROM recipe_ingredients WHERE revision_id=?1 ORDER BY position")?;
        for row in stmt.query_map([rev], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (i, u, n) = row?;
            let name: String =
                conn.query_row("SELECT name FROM ingredients WHERE id=?1", [&i], |r| {
                    r.get(0)
                })?;
            if seasonings::is_seasoning(conn, rev, &name)? {
                continue;
            }
            *result.entry((i, u)).or_insert(Decimal::ZERO) +=
                (number(&n)? * Decimal::from(servings) / Decimal::from(standard))
                    .round_dp_with_strategy(6, RoundingStrategy::ToPositiveInfinity);
        }
    }
    Ok(result)
}
pub fn preview(conn: &Connection, key: &str, servings: i64, date: &str) -> Result<Value> {
    if !(1..=12).contains(&servings)
        || !valid_date(date)
        || date > shopping::local_today(conn)?.as_str()
    {
        return Err(error(
            "INVALID_INPUT",
            "请检查实际人数和烹饪日期，不能记录未来烹饪",
        ));
    }
    let (rev, version) = plan(conn, key)?;
    editable(conn, key)?;
    let mut rows = Vec::new();
    for ((ingredient, unit), required) in requirements(conn, rev.as_deref(), servings)? {
        let name: String = conn.query_row(
            "SELECT name FROM ingredients WHERE id=?1",
            [&ingredient],
            |r| r.get(0),
        )?;
        let mut left = required;
        let mut lots = Vec::new();
        for lot in inventory::lots(conn)? {
            if lot["ingredientId"] != ingredient
                || lot["unit"] != unit
                || number(lot["quantity"].as_str().unwrap())? == Decimal::ZERO
            {
                continue;
            }
            let expires = lot["expires"].as_str();
            let safe = expires.is_some_and(|d| d >= date) && lot["precision"] == "exact";
            let take = if expires.is_none_or(|d| d >= date) {
                left.min(number(lot["quantity"].as_str().unwrap())?)
            } else {
                Decimal::ZERO
            };
            left -= take;
            lots.push(json!({"id":lot["id"],"version":lot["version"],"available":lot["quantity"],"location":lot["location"],"expires":lot["expires"],"review":!safe,"suggested":take.normalize().to_string()}));
        }
        rows.push(json!({"ingredientId":ingredient,"name":name,"unit":unit,"required":required.normalize().to_string(),"missing":left.normalize().to_string(),"lots":lots}));
    }
    let revision: String = conn.query_row(
        "SELECT value FROM app_settings WHERE key='data_revision'",
        [],
        |r| r.get(0),
    )?;
    Ok(json!({"planVersion":version,"revision":revision,"rows":rows}))
}
pub fn complete(tx: &Transaction, d: CompleteDraft) -> Result<()> {
    if !d.acknowledged || d.note.chars().count() > 2000 || d.consumptions.len() > 500 {
        return Err(error(
            "INVALID_INPUT",
            "请核对实际消耗后确认，备注最多 2000 字",
        ));
    }
    let p = preview(tx, &d.plan_id, d.servings, &d.date)?;
    if p["revision"] != d.expected_revision || p["planVersion"] != d.expected_version {
        return Err(error(
            "STALE_REVISION",
            "菜单或库存已变化，请刷新建议后核对",
        ));
    }
    let (rev, _) = plan(tx, &d.plan_id)?;
    let requirements = requirements(tx, rev.as_deref(), d.servings)?;
    let session = id();
    let mut seen = BTreeSet::new();
    let mut totals = BTreeMap::new();
    for c in &d.consumptions {
        if !seen.insert(&c.lot_id) || number(&c.quantity)? == Decimal::ZERO {
            return Err(error("INVALID_INPUT", "请检查重复批次或零用量"));
        }
        let (ingredient, unit): (String, String) = tx.query_row(
            "SELECT ingredient_id,unit FROM inventory_lots WHERE id=?1",
            [&c.lot_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if !requirements.contains_key(&(ingredient.clone(), unit.clone())) {
            return Err(error("INVALID_INPUT", "批次不属于这道菜的食材或单位"));
        }
        *totals.entry((ingredient, unit)).or_insert(Decimal::ZERO) += number(&c.quantity)?;
    }
    let text_count: i64 = if let Some(rev) = rev.as_deref() {
        tx.query_row(
            "SELECT count(*) FROM recipe_text_ingredients WHERE revision_id=?1",
            [rev],
            |r| r.get(0),
        )?
    } else {
        0
    };
    let untracked = text_count > 0
        || requirements.is_empty()
        || requirements
            .iter()
            .any(|(k, v)| totals.get(k).copied().unwrap_or_default() < *v);
    tx.execute("INSERT INTO cooking_sessions(id,plan_id,recipe_revision_id,date,servings,note,untracked) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![session,d.plan_id,rev,d.date,d.servings,d.note.trim(),untracked])?;
    for c in &d.consumptions {
        inventory::change(
            tx,
            &c.lot_id,
            c.expected_version,
            "use",
            &c.quantity,
            None,
            "完成烹饪",
        )?;
        let event: String = tx.query_row(
            "SELECT id FROM inventory_events WHERE lot_id=?1 ORDER BY after_version DESC LIMIT 1",
            [&c.lot_id],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT INTO cooking_consumptions VALUES(?1,?2,?3,?4)",
            params![session, c.lot_id, c.quantity, event],
        )?;
    }
    tx.execute(
        "UPDATE planned_meals SET cooking_session_id=?1,version=version+1 WHERE id=?2",
        params![session, d.plan_id],
    )?;
    Ok(())
}
pub fn undo(tx: &Transaction, key: &str, expected: i64) -> Result<()> {
    let (_, version) = plan(tx, key)?;
    if version != expected {
        return Err(error("STALE_REVISION", "菜单已变化，请刷新"));
    }
    let session:String=tx.query_row("SELECT cooking_session_id FROM planned_meals WHERE id=?1 AND cooking_session_id IS NOT NULL",[key],|r|r.get(0)).optional()?.ok_or_else(||error("NOT_FOUND","没有可撤销的烹饪"))?;
    let mut stmt = tx.prepare("SELECT event_id FROM cooking_consumptions WHERE session_id=?1")?;
    let events = stmt
        .query_map([&session], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for event in events {
        inventory::reverse_inner(tx, &event, "撤销烹饪")?;
    }
    tx.execute(
        "INSERT INTO cooking_undos(session_id) VALUES(?1)",
        [&session],
    )?;
    tx.execute(
        "UPDATE planned_meals SET cooking_session_id=NULL,version=version+1 WHERE id=?1",
        [key],
    )?;
    Ok(())
}
pub fn session(conn: &Connection, key: &str) -> Result<Value> {
    let result=conn.query_row("SELECT s.id,s.date,s.servings,s.note,s.untracked FROM cooking_sessions s JOIN planned_meals p ON p.cooking_session_id=s.id WHERE p.id=?1",[key],|r|Ok(json!({"id":r.get::<_,String>(0)?,"date":r.get::<_,String>(1)?,"servings":r.get::<_,i64>(2)?,"note":r.get::<_,String>(3)?,"untracked":r.get::<_,bool>(4)?}))).optional()?;
    let mut result = result.unwrap_or(Value::Null);
    if !result.is_null() {
        let mut stmt=conn.prepare("SELECT i.name,c.quantity,l.unit FROM cooking_consumptions c JOIN inventory_lots l ON l.id=c.lot_id JOIN ingredients i ON i.id=l.ingredient_id WHERE c.session_id=?1 ORDER BY c.rowid")?;
        result["consumptions"]=Value::Array(stmt.query_map([result["id"].as_str().unwrap()],|r|Ok(json!({"name":r.get::<_,String>(0)?,"quantity":r.get::<_,String>(1)?,"unit":r.get::<_,String>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?);
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::super::tests::{draft as recipe_draft, temp};
    use super::*;
    fn setup() -> (std::path::PathBuf, Connection, String) {
        let path = temp();
        let mut c = open(&path).unwrap();
        let mut r = recipe_draft();
        r.ingredients[0].quantity = "100".into();
        r.servings = 2;
        execute(&mut c, &id(), Command::CreateRecipe { draft: r }).unwrap();
        let rev = snapshot(&c).unwrap()["recipes"][0]["revisionId"]
            .as_str()
            .unwrap()
            .to_string();
        let today = shopping::local_today(&c).unwrap();
        execute(
            &mut c,
            &id(),
            Command::SavePlan {
                plan_id: None,
                expected_version: None,
                draft: planner::PlanDraft {
                    recipe_revision_id: Some(rev),
                    custom_title: None,
                    day: today.clone(),
                    meal: "晚餐".into(),
                    servings: 2,
                },
            },
        )
        .unwrap();
        for (n, expiry) in [
            ("60", Some("2099-01-01")),
            ("90", Some("2099-02-01")),
            ("50", None),
        ] {
            execute(
                &mut c,
                &id(),
                Command::ReceiveLot {
                    draft: InventoryDraft {
                        name: "西兰花".into(),
                        category: "未分类".into(),
                        quantity: n.into(),
                        unit: "g".into(),
                        location: "冷藏".into(),
                        received: today.clone(),
                        expires: expiry.map(str::to_string),
                        precision: "exact".into(),
                    },
                },
            )
            .unwrap();
        }
        let key = planner::plans(&c).unwrap()[0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        (path, c, key)
    }
    fn draft(c: &Connection, key: &str) -> CompleteDraft {
        let date = shopping::local_today(c).unwrap();
        let p = preview(c, key, 2, &date).unwrap();
        let consumptions = p["rows"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|r| r["lots"].as_array().unwrap())
            .filter(|l| l["suggested"] != "0")
            .map(|l| Consumption {
                lot_id: l["id"].as_str().unwrap().into(),
                expected_version: l["version"].as_i64().unwrap(),
                quantity: l["suggested"].as_str().unwrap().into(),
            })
            .collect();
        CompleteDraft {
            plan_id: key.into(),
            expected_version: p["planVersion"].as_i64().unwrap(),
            expected_revision: p["revision"].as_str().unwrap().into(),
            servings: 2,
            date,
            note: "脆嫩".into(),
            acknowledged: true,
            consumptions,
        }
    }
    #[test]
    fn fefo_complete_is_atomic_idempotent_pinned_and_durable_then_undo_restores_all() {
        let (path, mut c, key) = setup();
        let before = inventory::lots(&c).unwrap();
        let d = draft(&c, &key);
        assert_eq!(d.consumptions.len(), 2);
        assert_eq!(d.consumptions[0].quantity, "60");
        assert_eq!(d.consumptions[1].quantity, "40");
        let request = id();
        execute(
            &mut c,
            &request,
            Command::CompleteCooking { draft: d.clone() },
        )
        .unwrap();
        execute(
            &mut c,
            &request,
            Command::CompleteCooking { draft: d.clone() },
        )
        .unwrap();
        let after = snapshot(&c).unwrap();
        assert_eq!(after["plans"][0]["cooking"]["servings"], 2);
        assert_eq!(after["plans"][0]["cooking"]["note"], "脆嫩");
        assert!(execute(&mut c, &id(), Command::CompleteCooking { draft: d }).is_err());
        let event = inventory::events(&c).unwrap()[0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            execute(
                &mut c,
                &id(),
                Command::ReverseInventoryEvent {
                    event_id: event,
                    reason: "".into()
                }
            )
            .unwrap_err()
            .code,
            "COOKING_EVENT"
        );
        assert!(execute(
            &mut c,
            &id(),
            Command::RemovePlan {
                plan_id: key.clone(),
                expected_version: 2
            }
        )
        .is_err());
        let monday = shopping::week(&c, &shopping::local_today(&c).unwrap()).unwrap();
        assert!(shopping::forecast(&c, &monday).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty());
        drop(c);
        let mut c = open(&path).unwrap();
        assert_eq!(snapshot(&c).unwrap(), after);
        execute(
            &mut c,
            &id(),
            Command::UndoCooking {
                plan_id: key.clone(),
                expected_version: 2,
            },
        )
        .unwrap();
        let lots = inventory::lots(&c).unwrap();
        for l in before {
            assert_eq!(
                lots.iter().find(|n| n["id"] == l["id"]).unwrap()["quantity"],
                l["quantity"]
            );
        }
        assert!(session(&c, &key).unwrap().is_null());
        assert!(execute(
            &mut c,
            &id(),
            Command::UndoCooking {
                plan_id: key,
                expected_version: 3
            }
        )
        .is_err());
    }
    #[test]
    fn invalid_stale_short_and_event_failure_leave_no_partial_consumption() {
        let (_, mut c, key) = setup();
        let d = draft(&c, &key);
        let before = snapshot(&c).unwrap();
        for mut bad in [d.clone(), d.clone(), d.clone(), d.clone()]
            .into_iter()
            .enumerate()
        {
            match bad.0 {
                0 => bad.1.acknowledged = false,
                1 => bad.1.consumptions[1].quantity = "1000".into(),
                2 => bad.1.expected_revision = "0".into(),
                _ => bad.1.consumptions.push(bad.1.consumptions[0].clone()),
            }
            assert!(execute(&mut c, &id(), Command::CompleteCooking { draft: bad.1 }).is_err());
            assert_eq!(snapshot(&c).unwrap(), before);
        }
        c.execute_batch("CREATE TRIGGER reject_cook BEFORE INSERT ON cooking_consumptions WHEN (SELECT count(*) FROM cooking_consumptions)>0 BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        assert!(execute(&mut c, &id(), Command::CompleteCooking { draft: d }).is_err());
        assert_eq!(snapshot(&c).unwrap(), before);
    }
    #[test]
    fn undo_conflict_does_not_restore_only_some_batches() {
        let (_, mut c, key) = setup();
        let d = draft(&c, &key);
        let changed = d.consumptions[1].lot_id.clone();
        execute(&mut c, &id(), Command::CompleteCooking { draft: d }).unwrap();
        execute(
            &mut c,
            &id(),
            Command::ChangeLot {
                lot_id: changed,
                expected_version: 2,
                operation: "use".into(),
                quantity: "1".into(),
                location: None,
                reason: "".into(),
            },
        )
        .unwrap();
        let before = snapshot(&c).unwrap();
        assert!(execute(
            &mut c,
            &id(),
            Command::UndoCooking {
                plan_id: key,
                expected_version: 2
            }
        )
        .is_err());
        assert_eq!(snapshot(&c).unwrap(), before);
    }
    #[test]
    fn recipe_usage_fills_unknown_date_lots_and_records_manual_short_usage() {
        let (_, mut c, key) = setup();
        let date = shopping::local_today(&c).unwrap();
        let p = preview(&c, &key, 4, &date).unwrap();
        assert_eq!(p["rows"][0]["required"], "200");
        assert_eq!(p["rows"][0]["missing"], "0");
        assert_eq!(p["rows"][0]["lots"][2]["suggested"], "50");
        let shortage = preview(&c, &key, 6, &date).unwrap();
        assert_eq!(shortage["rows"][0]["missing"], "100");
        let mut d = draft(&c, &key);
        d.servings = 4;
        d.consumptions.clear();
        execute(&mut c, &id(), Command::CompleteCooking { draft: d }).unwrap();
        assert_eq!(session(&c, &key).unwrap()["untracked"], true);
    }
    #[test]
    fn backdated_cooking_uses_current_stock_and_undo_restores_it() {
        let (_, mut c, key) = setup();
        let today = shopping::local_today(&c).unwrap();
        let date: String = c
            .query_row("SELECT date(?1, '-1 day')", [&today], |r| r.get(0))
            .unwrap();
        let before = inventory::lots(&c).unwrap();
        let p = preview(&c, &key, 2, &date).unwrap();
        assert_eq!(p["rows"][0]["lots"].as_array().unwrap().len(), 3);
        assert_eq!(p["rows"][0]["missing"], "0");
        let mut d = draft(&c, &key);
        d.date = date.clone();
        execute(&mut c, &id(), Command::CompleteCooking { draft: d }).unwrap();
        assert_eq!(session(&c, &key).unwrap()["date"], date);
        assert_eq!(
            inventory::lots(&c)
                .unwrap()
                .iter()
                .map(|l| number(l["quantity"].as_str().unwrap()).unwrap())
                .sum::<Decimal>(),
            Decimal::from(100)
        );
        execute(
            &mut c,
            &id(),
            Command::UndoCooking {
                plan_id: key,
                expected_version: 2,
            },
        )
        .unwrap();
        for lot in before {
            assert_eq!(
                inventory::lots(&c)
                    .unwrap()
                    .iter()
                    .find(|l| l["id"] == lot["id"])
                    .unwrap()["quantity"],
                lot["quantity"]
            );
        }
    }
    #[test]
    fn schema_six_upgrade_preserves_data_and_backs_up() {
        let (path, c, key) = setup();
        let before = snapshot(&c).unwrap();
        super::super::tests::downgrade_cooking(&c);
        c.execute_batch("PRAGMA user_version=6;").unwrap();
        drop(c);
        let c = open(&path).unwrap();
        assert_eq!(snapshot(&c).unwrap(), before);
        assert!(session(&c, &key).unwrap().is_null());
        let prefix = format!("{}.pre-v7-", path.file_stem().unwrap().to_string_lossy());
        assert!(std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with(&prefix)));
    }
}

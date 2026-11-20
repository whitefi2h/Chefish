use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LevelChange {
    pub lot_id: String,
    pub expected_version: i64,
    pub level: i64,
}
pub fn rough(conn: &Connection) -> Result<bool> {
    Ok(preferences::load(conn)?.inventory_mode == "rough")
}
pub fn get(conn: &Connection, lot: &str) -> Result<Option<Value>> {
    if conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 19 {
        return Ok(None);
    }
    Ok(conn.query_row("SELECT level,source,reference_servings FROM inventory_measurements WHERE lot_id=?1", [lot], |r| Ok(json!({"level":r.get::<_,i64>(0)?,"source":r.get::<_,String>(1)?,"referenceServings":r.get::<_,i64>(2)?}))).optional()?)
}
pub fn write(conn: &Connection, lot: &str, value: Option<&Value>) -> Result<()> {
    if let Some(value) = value {
        conn.execute("INSERT INTO inventory_measurements VALUES(?1,?2,?3,?4) ON CONFLICT(lot_id) DO UPDATE SET level=excluded.level,source=excluded.source,reference_servings=excluded.reference_servings",params![lot,value["level"].as_i64(),value["source"].as_str(),value["referenceServings"].as_i64()])?;
    } else {
        conn.execute("DELETE FROM inventory_measurements WHERE lot_id=?1", [lot])?;
    }
    Ok(())
}
pub fn attach(conn: &Connection, event: &str, lot: &str, next: Option<Value>) -> Result<()> {
    let before = get(conn, lot)?;
    write(conn, lot, next.as_ref())?;
    conn.execute(
        "INSERT INTO inventory_measurement_events VALUES(?1,?2,?3)",
        params![
            event,
            before.map(|v| v.to_string()),
            next.map(|v| v.to_string())
        ],
    )?;
    Ok(())
}
pub fn value(conn: &Connection, level: i64, source: &str) -> Result<Value> {
    if !(-1..=2).contains(&level) {
        return Err(error("INVALID_INPUT", "库存档位无效"));
    }
    Ok(
        json!({"level":level,"source":source,"referenceServings":preferences::load(conn)?.default_servings}),
    )
}
pub fn receive(tx: &Transaction, name: &str, category: &str, level: i64) -> Result<String> {
    let today = shopping::local_today(tx)?;
    let lot = inventory::receive_batch(
        tx,
        InventoryDraft {
            name: name.into(),
            category: category.into(),
            quantity: "1".into(),
            unit: "个".into(),
            location: "未指定".into(),
            received: today,
            expires: None,
            precision: "rough".into(),
        },
        "粗略入库",
    )?;
    let event: String = tx.query_row(
        "SELECT id FROM inventory_events WHERE lot_id=?1 ORDER BY after_version DESC LIMIT 1",
        [&lot],
        |r| r.get(0),
    )?;
    attach(tx, &event, &lot, Some(value(tx, level, "manual")?))?;
    Ok(lot)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn kitchen() -> Connection {
        let path = std::env::temp_dir().join(format!("chefish-level-{}.sqlite3", id()));
        let mut c = super::super::open(&path).unwrap();
        let mut prefs = preferences::load(&c).unwrap();
        prefs.inventory_mode = "rough".into();
        preferences::save(&mut c, prefs).unwrap();
        c
    }
    fn run(c: &mut Connection, command: Value) {
        execute(c, &id(), serde_json::from_value(command).unwrap()).unwrap();
    }
    #[test]
    fn levels_survive_restart_hide_historical_numbers_and_empty_is_distinct() {
        let mut c = kitchen();
        run(
            &mut c,
            json!({"type":"receive_level_lot","name":"青菜","category":"自动分类","level":1}),
        );
        let row = inventory_rows(&c).unwrap().remove(0);
        assert_eq!(row["quantity"], "0");
        assert_eq!(row["stockPresent"], true);
        assert_eq!(row["level"], 1);
        run(
            &mut c,
            json!({"type":"set_stock_level","change":{"lot_id":row["id"],"expected_version":1,"level":-1}}),
        );
        let row = inventory_rows(&c).unwrap().remove(0);
        assert_eq!(row["stockPresent"], false);
        assert!(execute(&mut c,&id(),serde_json::from_value(json!({"type":"set_stock_level","change":{"lot_id":row["id"],"expected_version":1,"level":2}})).unwrap()).is_err());
        let operation = undo::status(&c).unwrap()["operationId"]
            .as_str()
            .unwrap()
            .to_string();
        run(&mut c, json!({"type":"undo","operation_id":operation}));
        assert_eq!(inventory_rows(&c).unwrap()[0]["level"], 1);
    }
    #[test]
    fn checklist_purchase_is_atomic_idempotent_and_uses_today() {
        let mut c = kitchen();
        run(
            &mut c,
            json!({"type":"save_shopping","line_id":null,"expected_version":null,"draft":{"name":"鸡蛋","category":"肉禽蛋","quantity":"6","unit":"个"}}),
        );
        let week = shopping::week(&c, &shopping::local_today(&c).unwrap()).unwrap();
        let row = shopping::forecast(&c, &week).unwrap()["items"][0].clone();
        let command:Command=serde_json::from_value(json!({"type":"purchase_level_shopping","line_id":row["id"],"expected_version":row["version"],"ingredient_id":row["ingredientId"],"unit":row["unit"],"week_start":row["weekStart"]})).unwrap();
        let request = id();
        execute(&mut c, &request, command.clone()).unwrap();
        execute(&mut c, &request, command).unwrap();
        let lots = inventory_rows(&c).unwrap();
        assert_eq!(lots.len(), 1);
        assert_eq!(lots[0]["level"], 1);
        assert_eq!(lots[0]["received"], shopping::local_today(&c).unwrap());
        assert_eq!(lots[0]["location"], "未指定");
        assert!(lots[0]["expires"].is_null());
        assert_eq!(
            shopping::forecast(&c, &week).unwrap()["items"][0]["remaining"],
            "0"
        );
        let pending = steward::entities(&c).unwrap();
        assert!(pending.iter().any(|e| e["entityKind"] == "lot"));
    }
    #[test]
    fn cooking_level_changes_and_undo_preserve_the_original_level() {
        let mut c = kitchen();
        run(
            &mut c,
            json!({"type":"create_recipe","draft":{"name":"炒青菜","category":"家常菜","minutes":5,"servings":2,"subtitle":"","seasoning":"","ingredients":[{"name":"青菜","quantity":"200","unit":"g"}],"steps":["炒熟"]}}),
        );
        let revision = snapshot(&c).unwrap()["recipes"][0]["revisionId"].clone();
        let today = shopping::local_today(&c).unwrap();
        run(
            &mut c,
            json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":revision,"custom_title":null,"day":today,"meal":"晚餐","servings":2}}),
        );
        run(
            &mut c,
            json!({"type":"receive_level_lot","name":"青菜","category":"自动分类","level":2}),
        );
        let s = snapshot(&c).unwrap();
        let plan = s["plans"][0]["id"].as_str().unwrap();
        let lot = &s["lots"][0];
        let preview = cooking::preview(&c, plan, 2, &today).unwrap();
        assert_eq!(preview["rows"][0]["lots"][0]["level"], 2);
        run(
            &mut c,
            json!({"type":"complete_level_cooking","draft":{"plan_id":plan,"expected_version":preview["planVersion"],"expected_revision":preview["revision"],"servings":2,"date":today,"note":"","record":"","acknowledged":true,"consumptions":[]},"changes":[{"lot_id":lot["id"],"expected_version":lot["version"],"level":0}]}),
        );
        assert_eq!(inventory_rows(&c).unwrap()[0]["level"], 0);
        assert_eq!(
            cooking::session(&c, plan).unwrap()["consumptions"][0]["stockLevel"],
            0
        );
        let p = snapshot(&c).unwrap()["plans"][0].clone();
        run(
            &mut c,
            json!({"type":"undo_cooking","plan_id":plan,"expected_version":p["version"]}),
        );
        assert_eq!(inventory_rows(&c).unwrap()[0]["level"], 2);
    }
    #[test]
    fn returning_to_exact_requires_a_new_quantity_and_undo_restores_level() {
        let mut c = kitchen();
        run(
            &mut c,
            json!({"type":"receive_level_lot","name":"青菜","category":"自动分类","level":0}),
        );
        let row = inventory_rows(&c).unwrap()[0].clone();
        let mut prefs = preferences::load(&c).unwrap();
        prefs.inventory_mode = "exact".into();
        preferences::save(&mut c, prefs).unwrap();
        assert_eq!(inventory_rows(&c).unwrap()[0]["measurement"], "level");
        run(
            &mut c,
            json!({"type":"edit_lot","lot_id":row["id"],"expected_version":row["version"],"draft":{"quantity":"250","unit":"g","location":"冷藏","received":row["received"],"expires":null,"precision":"exact","category":"蔬菜菌菇"}}),
        );
        assert_eq!(inventory_rows(&c).unwrap()[0]["quantity"], "250");
        let operation = undo::status(&c).unwrap()["operationId"].clone();
        run(&mut c, json!({"type":"undo","operation_id":operation}));
        assert_eq!(inventory_rows(&c).unwrap()[0]["level"], 0);
    }
    #[test]
    fn rough_forecast_does_not_reuse_old_weights_or_treat_adequate_as_unlimited() {
        let mut c = kitchen();
        run(
            &mut c,
            json!({"type":"create_recipe","draft":{"name":"炒青菜","category":"家常菜","minutes":5,"servings":2,"subtitle":"","seasoning":"","ingredients":[{"name":"青菜","quantity":"200","unit":"g"}],"steps":["炒熟"]}}),
        );
        let today = shopping::local_today(&c).unwrap();
        run(
            &mut c,
            json!({"type":"receive_lot","draft":{"name":"青菜","category":"蔬菜菌菇","quantity":"700","unit":"g","location":"冷藏","received":today,"expires":null,"precision":"exact"}}),
        );
        let row = inventory_rows(&c).unwrap()[0].clone();
        let revision = snapshot(&c).unwrap()["recipes"][0]["revisionId"].clone();
        let base = shopping::week(&c, &today).unwrap();
        let week: String = c
            .query_row("SELECT date(?1,'+7 days')", [base], |r| r.get(0))
            .unwrap();
        run(
            &mut c,
            json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":revision,"custom_title":null,"day":week,"meal":"晚餐","servings":2}}),
        );
        let unestimated=shopping::forecast(&c,&week).unwrap();
        assert_eq!(unestimated["items"][0]["covered"],"0");
        assert_eq!(unestimated["items"][0]["remaining"],"200");
        run(
            &mut c,
            json!({"type":"set_stock_level","change":{"lot_id":row["id"],"expected_version":row["version"],"level":0}}),
        );
        let low = shopping::forecast(&c, &week).unwrap();
        assert_eq!(low["items"][0]["remaining"], "200");
        assert_eq!(low["items"][0]["covered"], "0");
        let row = inventory_rows(&c).unwrap()[0].clone();
        run(
            &mut c,
            json!({"type":"set_stock_level","change":{"lot_id":row["id"],"expected_version":row["version"],"level":1}}),
        );
        assert_eq!(
            shopping::forecast(&c, &week).unwrap()["items"][0]["roughCovered"],
            true
        );
        for offset in [1, 2] {
            let date: String = c
                .query_row(
                    "SELECT date(?1,?2)",
                    params![week, format!("+{offset} days")],
                    |r| r.get(0),
                )
                .unwrap();
            run(
                &mut c,
                json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":revision,"custom_title":null,"day":date,"meal":"晚餐","servings":2}}),
            );
        }
        let repeated = shopping::forecast(&c, &week).unwrap();
        assert_eq!(repeated["items"][0]["remaining"], "600");
        assert_eq!(repeated["items"][0]["roughCovered"], false);
    }
}

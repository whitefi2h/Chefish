use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LevelChange {
    pub lot_id: String,
    pub expected_version: i64,
    #[serde(default)]
    pub expected_stock_revision: Option<String>,
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
// Compare the actual stock state, not metadata edits or colliding device counters.
pub fn stock_revision(conn:&Connection,lot:&str)->Result<String> {
    if let Some(m)=get(conn,lot)? {return Ok(json!(["level",m["level"],m["referenceServings"]]).to_string());}
    let (amount,unit):(String,String)=conn.query_row("SELECT amount_decimal,unit FROM inventory_lots WHERE id=?1",[lot],|r|Ok((r.get(0)?,r.get(1)?)))?;
    Ok(json!(["exact",amount,unit]).to_string())
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
    fn compat_recipe(c:&mut Connection,name:&str,ingredient:&str)->Value {
        run(c,json!({"type":"create_recipe","draft":{"name":name,"category":"未分类","minutes":10,"servings":2,"subtitle":"","seasoning":"","ingredients":[{"name":ingredient,"quantity":"200","unit":"g"}],"steps":["煮熟"]}}));
        snapshot(c).unwrap()["recipes"].as_array().unwrap().iter().find(|r|r["name"]==name).unwrap()["revisionId"].clone()
    }
    fn compat_plan(c:&mut Connection,revision:&Value,day:&str,people:i64) {
        run(c,json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":revision,"custom_title":null,"day":day,"meal":"晚餐","servings":people}}));
    }
    #[test]
    fn compat_unrelated_people_do_not_change_coverage_and_review_is_not_expiry() {
        let mut c=kitchen();let today=shopping::local_today(&c).unwrap();
        let base=shopping::week(&c,&today).unwrap();let week:String=c.query_row("SELECT date(?1,'+7 days')",[base],|r|r.get(0)).unwrap();
        let greens=compat_recipe(&mut c,"青菜测试","青菜");compat_plan(&mut c,&greens,&week,2);
        run(&mut c,json!({"type":"receive_level_lot","name":"青菜","category":"自动分类","level":1}));
        let before=shopping::forecast(&c,&week).unwrap();
        let beef=compat_recipe(&mut c,"牛肉测试","牛肉");let next:String=c.query_row("SELECT date(?1,'+1 day')",[&week],|r|r.get(0)).unwrap();compat_plan(&mut c,&beef,&next,6);
        let after=shopping::forecast(&c,&week).unwrap();
        let line=|v:Value|v["items"].as_array().unwrap().iter().find(|r|r["name"]=="青菜").unwrap().clone();
        let a=line(before);let b=line(after);assert_eq!(a["remaining"],"0");assert_eq!(b["remaining"],"0");
        let later:String=c.query_row("SELECT date(?1,'+2 days')",[&week],|r|r.get(0)).unwrap();
        compat_plan(&mut c,&greens,&later,6);
        let large = line(shopping::forecast(&c,&week).unwrap());
        assert_eq!(large["maxPeople"],6);
        assert_eq!(large["remaining"],"800");
        let lot=inventory_rows(&c).unwrap()[0].clone();
        run(&mut c,json!({"type":"set_review_date","lot_id":lot["id"],"date":"2000-01-01"}));
        let reviewed=inventory_rows(&c).unwrap()[0].clone();assert_eq!(reviewed["steward"]["reviewOn"],"2000-01-01");assert!(reviewed["expires"].is_null());
    }
    #[test]
    fn compat_metadata_move_preserves_pending_rough_cooking() {
        let mut c=kitchen();let today=shopping::local_today(&c).unwrap();
        let rev=compat_recipe(&mut c,"青菜测试","青菜");compat_plan(&mut c,&rev,&today,2);
        run(&mut c,json!({"type":"receive_level_lot","name":"青菜","category":"自动分类","level":1}));
        let state=snapshot(&c).unwrap();let plan=state["plans"][0]["id"].as_str().unwrap();let lot=&state["lots"][0];let preview=cooking::preview(&c,plan,2,&today).unwrap();
        let command:Command=serde_json::from_value(json!({"type":"complete_level_cooking","draft":{"plan_id":plan,"expected_version":preview["planVersion"],"expected_revision":preview["revision"],"servings":2,"date":today,"note":"","record":"我的记录","acknowledged":true,"consumptions":[]},"changes":[{"lot_id":lot["id"],"expected_version":lot["version"],"expected_stock_revision":lot["stockRevision"],"level":0}]})).unwrap();
        run(&mut c,json!({"type":"change_lot","lot_id":lot["id"],"expected_version":lot["version"],"operation":"move","quantity":"0","location":"冷藏","reason":"AI推测库位"}));
        execute(&mut c,&id(),command).unwrap();assert_eq!(cooking::session(&c,plan).unwrap()["record"],"我的记录");assert_eq!(inventory_rows(&c).unwrap()[0]["location"],"冷藏");assert_eq!(inventory_rows(&c).unwrap()[0]["level"],0);
    }

    #[test]
    fn compat_actual_stock_change_rejects_cooking_atomically_and_fresh_choice_saves() {
        let mut c=kitchen();let today=shopping::local_today(&c).unwrap();
        let rev=compat_recipe(&mut c,"青菜测试","青菜");compat_plan(&mut c,&rev,&today,2);
        run(&mut c,json!({"type":"receive_level_lot","name":"青菜","category":"自动分类","level":1}));
        let s=snapshot(&c).unwrap();let plan=&s["plans"][0]["id"];let lot=&s["lots"][0];
        let p=cooking::preview(&c,plan.as_str().unwrap(),2,&today).unwrap();
        let mut command=json!({"type":"complete_level_cooking","draft":{"plan_id":plan,"expected_version":p["planVersion"],"expected_revision":p["revision"],"servings":2,"date":today,"note":"我的手记","record":"我的记录","acknowledged":true,"consumptions":[]},"changes":[{"lot_id":lot["id"],"expected_version":lot["version"],"expected_stock_revision":lot["stockRevision"],"level":-1}]});
        run(&mut c,json!({"type":"set_stock_level","change":{"lot_id":lot["id"],"expected_version":lot["version"],"level":2}}));
        let err=execute(&mut c,&id(),serde_json::from_value(command.clone()).unwrap()).unwrap_err();
        assert_eq!(err.code,"STALE_REVISION");
        assert!(cooking::session(&c,plan.as_str().unwrap()).unwrap().is_null());
        let fresh=inventory_rows(&c).unwrap()[0].clone();assert_eq!(fresh["level"],2);
        command["changes"][0]["expected_stock_revision"]=fresh["stockRevision"].clone();
        command["changes"][0]["expected_version"]=fresh["version"].clone();
        run(&mut c,command);
        assert_eq!(cooking::session(&c,plan.as_str().unwrap()).unwrap()["note"],"我的手记");
        assert_eq!(inventory_rows(&c).unwrap()[0]["level"],-1);
    }

    #[test]
    fn compat_extra_lot_refresh_and_exact_ai_context_preserve_bands() {
        let mut c=kitchen();let today=shopping::local_today(&c).unwrap();
        let rev=compat_recipe(&mut c,"青菜测试","青菜");compat_plan(&mut c,&rev,&today,2);
        for name in ["青菜","鸡蛋"] {run(&mut c,json!({"type":"receive_level_lot","name":name,"category":"自动分类","level":1}));}
        let s=snapshot(&c).unwrap();let plan=s["plans"][0]["id"].as_str().unwrap();
        let egg_id:String=c.query_row("SELECT l.id FROM inventory_lots l JOIN ingredients i ON i.id=l.ingredient_id WHERE i.name='鸡蛋'",[],|r|r.get(0)).unwrap();
        let before=cooking::preview_with_lots(&c,plan,2,&today,std::slice::from_ref(&egg_id)).unwrap();
        let egg=before["rows"].as_array().unwrap().iter().find(|r|r["name"]=="鸡蛋").unwrap()["lots"][0].clone();
        run(&mut c,json!({"type":"set_stock_level","change":{"lot_id":egg_id,"expected_version":egg["version"],"level":-1}}));
        let after=cooking::preview_with_lots(&c,plan,2,&today,&[egg_id]).unwrap();
        let fresh=&after["rows"].as_array().unwrap().iter().find(|r|r["name"]=="鸡蛋").unwrap()["lots"][0];
        assert_eq!(fresh["level"],-1);assert_ne!(fresh["stockRevision"],egg["stockRevision"]);
        let mut prefs=preferences::load(&c).unwrap();prefs.inventory_mode="exact".into();preferences::save(&mut c,prefs).unwrap();
        let context=crate::cooking_ai::context(&c,plan,2,&today).unwrap();
        assert!(context["stock"].as_array().unwrap().is_empty());
        assert_eq!(context["levelStock"][0]["name"],"青菜");
        assert_eq!(context["levelStock"][0]["level"],1);
        assert!(context["levelStock"][0].get("quantity").is_none());
    }

}

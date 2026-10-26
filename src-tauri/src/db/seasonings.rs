use super::*;
use std::collections::BTreeMap;

pub fn canonical(name: &str) -> String {
    let n = name.trim().replace('耗', "蚝");
    if n.ends_with("糖") {
        return "糖".into();
    }
    let names: Vec<String> =
        serde_json::from_str(include_str!("../../../src/domain/seasoningNames.json"))
            .expect("bundled seasoning vocabulary");
    names
        .into_iter()
        .filter(|s| n.ends_with(s))
        .max_by_key(|s| s.len())
        .unwrap_or(n)
}

pub fn common(name: &str) -> bool {
    let n = name.trim().replace('耗', "蚝");
    let names: Vec<String> =
        serde_json::from_str(include_str!("../../../src/domain/seasoningNames.json"))
            .expect("bundled seasoning vocabulary");
    names.iter().any(|s| n.ends_with(s)) || n == "油" || n == "醋"
}
pub fn kinds(conn: &Connection, rev: &str) -> Result<BTreeMap<String, bool>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT content FROM recipe_ingredient_kinds WHERE revision_id=?1",
            [rev],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|v| serde_json::from_str(&v).map_err(|_| error("DATABASE_ERROR", "配料类型无法读取")))
        .unwrap_or_else(|| Ok(BTreeMap::new()))
}
pub fn is_seasoning(conn: &Connection, rev: &str, name: &str) -> Result<bool> {
    Ok(kinds(conn, rev)?
        .get(name)
        .copied()
        .unwrap_or_else(|| common(name)))
}
pub fn supplies(conn: &Connection) -> Result<Value> {
    let mut stmt =
        conn.prepare("SELECT name,missing FROM seasoning_supplies ORDER BY missing DESC,name")?;
    let rows = stmt
        .query_map([], |r| {
            let name: String = r.get(0)?;
            Ok(json!({"id":name,"name":name,"missing":r.get::<_,bool>(1)?}))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut grouped = BTreeMap::<String, bool>::new();
    for row in rows {
        *grouped
            .entry(canonical(row["name"].as_str().unwrap()))
            .or_default() |= row["missing"] == true;
    }
    let mut rows = Vec::new();
    for (name, missing) in grouped {
        let hidden: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM app_settings WHERE key=?1 AND value='1')",
            [format!("seasoning_hidden:{}", name)],
            |r| r.get(0),
        )?;
        if !hidden {
            let mut item = json!({"id":name,"name":name,"missing":missing});
            let photo: Option<String> = conn
                .query_row(
                    "SELECT value FROM app_settings WHERE key=?1",
                    [format!("seasoning_image:{name}")],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(photo) = photo {
                item["image"] = serde_json::from_str(&photo)
                    .map_err(|_| error("DATABASE_ERROR", "调料图片无法读取"))?;
            }
            rows.push(item);
        }
    }
    rows.sort_by_key(|s| s["missing"] != true);
    Ok(json!(rows))
}
pub fn set(tx: &Transaction, name: &str, missing: bool, expected: &str) -> Result<()> {
    text(name, 120)?;
    let actual: String = tx.query_row(
        "SELECT value FROM app_settings WHERE key='data_revision'",
        [],
        |r| r.get(0),
    )?;
    if actual != expected {
        return Err(error("STALE_REVISION", "调料状态已变化，请刷新后重试"));
    }
    let name = canonical(name);
    tx.execute(
        "DELETE FROM app_settings WHERE key=?1",
        [format!("seasoning_hidden:{}", name)],
    )?;
    let mut stmt = tx.prepare("SELECT name FROM seasoning_supplies")?;
    let aliases = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    for alias in aliases {
        if canonical(&alias) == name {
            tx.execute(
                "UPDATE seasoning_supplies SET missing=?1 WHERE name=?2",
                params![missing, alias],
            )?;
        }
    }
    tx.execute("INSERT INTO seasoning_supplies(name,missing) VALUES(?1,?2) ON CONFLICT(name) DO UPDATE SET missing=excluded.missing", params![name,missing])?;
    Ok(())
}

pub fn remove(tx: &Transaction, name: &str, expected: &str) -> Result<()> {
    text(name, 120)?;
    let actual: String = tx.query_row(
        "SELECT value FROM app_settings WHERE key='data_revision'",
        [],
        |r| r.get(0),
    )?;
    if actual != expected {
        return Err(error("STALE_REVISION", "调料已更新，请刷新后重试"));
    }
    tx.execute("INSERT INTO app_settings(key,value) VALUES(?1,'1') ON CONFLICT(key) DO UPDATE SET value='1'",[format!("seasoning_hidden:{}",canonical(name))])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removal_survives_restart_and_recipe_resave_until_explicitly_added_again() {
        let path = super::super::tests::temp();
        let mut conn = open(&path).unwrap();
        conn.execute(
            "INSERT INTO seasoning_supplies(name,missing) VALUES('品牌生抽',1)",
            [],
        )
        .unwrap();
        let expected = snapshot(&conn).unwrap()["dataRevision"]
            .as_str()
            .unwrap()
            .to_string();
        execute(
            &mut conn,
            &id(),
            Command::RemoveSeasoning {
                name: "生抽".into(),
                expected_revision: expected,
            },
        )
        .unwrap();
        drop(conn);
        let mut conn = open(&path).unwrap();
        assert!(!supplies(&conn)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["name"] == "生抽"));
        conn.execute(
            "INSERT OR IGNORE INTO seasoning_supplies(name) VALUES('新品牌生抽')",
            [],
        )
        .unwrap();
        assert!(!supplies(&conn)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["name"] == "生抽"));
        let expected = snapshot(&conn).unwrap()["dataRevision"]
            .as_str()
            .unwrap()
            .to_string();
        execute(
            &mut conn,
            &id(),
            Command::SetSeasoning {
                name: "生抽".into(),
                missing: false,
                expected_revision: expected,
            },
        )
        .unwrap();
        assert!(supplies(&conn)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["name"] == "生抽" && s["missing"] == false));
    }
    #[test]
    fn spelling_and_brand_aliases_share_one_missing_flag() {
        let path = super::super::tests::temp();
        let mut conn = open(&path).unwrap();
        conn.execute(
            "INSERT INTO seasoning_supplies(name,missing) VALUES('味达美耗油',1)",
            [],
        )
        .unwrap();
        let rows = supplies(&conn).unwrap();
        assert_eq!(rows[0]["name"], "蚝油");
        assert_eq!(
            rows.as_array()
                .unwrap()
                .iter()
                .filter(|r| r["name"] == "蚝油")
                .count(),
            1
        );
        let revision = snapshot(&conn).unwrap()["dataRevision"]
            .as_str()
            .unwrap()
            .to_string();
        execute(
            &mut conn,
            &id(),
            Command::SetSeasoning {
                name: "蚝油".into(),
                missing: false,
                expected_revision: revision,
            },
        )
        .unwrap();
        assert!(supplies(&conn)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["missing"] == false));
    }
    #[test]
    fn version_ten_upgrade_keeps_recipe_amounts_and_backfills_seasonings() {
        let path = super::super::tests::temp();
        let mut conn = open(&path).unwrap();
        let mut d = super::super::tests::draft();
        d.ingredients.push(DraftIngredient {
            name: "味达美生抽".into(),
            quantity: "10".into(),
            unit: "ml".into(),
        });
        execute(&mut conn, &id(), Command::CreateRecipe { draft: d }).unwrap();
        let before = snapshot(&conn).unwrap();
        super::super::sync::remove_for_legacy_fixture(&conn);
        conn.execute_batch("DROP TABLE recipe_ingredient_kinds; DROP TABLE seasoning_supplies; DELETE FROM schema_migrations WHERE version=11; PRAGMA user_version=10;").unwrap();
        drop(conn);
        let conn = open(&path).unwrap();
        let after = snapshot(&conn).unwrap();
        assert_eq!(before["recipes"], after["recipes"]);
        assert_eq!(after["recipes"][0]["ingredientKinds"]["味达美生抽"], true);
        assert!(after["seasonings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["name"] == "生抽" && s["missing"] == false));
    }
    #[test]
    fn seasoning_does_not_generate_meal_demand_and_missing_state_survives_restart() {
        let path = super::super::tests::temp();
        let mut conn = open(&path).unwrap();
        let mut d = super::super::tests::draft();
        d.ingredients.push(DraftIngredient {
            name: "盐".into(),
            quantity: "2".into(),
            unit: "g".into(),
        });
        d.ingredients.push(DraftIngredient {
            name: "自制酱".into(),
            quantity: "10".into(),
            unit: "g".into(),
        });
        d.ingredient_kinds.insert("自制酱".into(), true);
        execute(&mut conn, &id(), Command::CreateRecipe { draft: d }).unwrap();
        let s = snapshot(&conn).unwrap();
        let today = shopping::local_today(&conn).unwrap();
        let week = shopping::week(&conn, &today).unwrap();
        execute(
            &mut conn,
            &id(),
            Command::SavePlan {
                plan_id: None,
                expected_version: None,
                draft: planner::PlanDraft {
                    recipe_revision_id: Some(
                        s["recipes"][0]["revisionId"].as_str().unwrap().into(),
                    ),
                    custom_title: None,
                    day: today.clone(),
                    meal: "晚餐".into(),
                    servings: 2,
                },
            },
        )
        .unwrap();
        let f = shopping::forecast(&conn, &week).unwrap();
        assert_eq!(f["items"].as_array().unwrap().len(), 1);
        assert_eq!(f["items"][0]["name"], "西兰花");
        let s = snapshot(&conn).unwrap();
        let p = cooking::preview(&conn, s["plans"][0]["id"].as_str().unwrap(), 2, &today).unwrap();
        assert_eq!(p["rows"].as_array().unwrap().len(), 1);
        execute(
            &mut conn,
            &id(),
            Command::SetSeasoning {
                name: "盐".into(),
                missing: true,
                expected_revision: s["dataRevision"].as_str().unwrap().into(),
            },
        )
        .unwrap();
        drop(conn);
        let mut conn = open(&path).unwrap();
        let s = snapshot(&conn).unwrap();
        assert_eq!(s["seasonings"][0]["name"], "盐");
        assert_eq!(s["seasonings"][0]["missing"], true);
        assert!(
            crate::assistant::shopping_copy(&conn, &week).unwrap()["text"]
                .as_str()
                .unwrap()
                .contains("调料：盐")
        );
        let stale = execute(
            &mut conn,
            &id(),
            Command::SetSeasoning {
                name: "盐".into(),
                missing: false,
                expected_revision: "0".into(),
            },
        );
        assert!(stale.is_err());
        assert!(common("味达美耗油"));
        assert!(!common("糖醋排骨"));
        assert!(!common("青椒"));
    }
}

use super::{error, Connection, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub default_servings: i64,
    pub taste: String,
    pub restrictions: String,
    pub equipment: String,
    pub start_page: String,
    pub send_shortcut: String,
    pub automatic_backup: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            default_servings: 2,
            taste: String::new(),
            restrictions: String::new(),
            equipment: String::new(),
            start_page: "planner".into(),
            send_shortcut: "enter".into(),
            automatic_backup: true,
        }
    }
}

pub fn load(conn: &Connection) -> Result<Preferences> {
    let encoded: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key='preferences_v1'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let value = match encoded {
        Some(value) => serde_json::from_str(&value)
            .map_err(|_| error("PREFERENCES_INVALID", "设置内容无法读取，请从备份恢复")),
        None => Ok(Preferences::default()),
    }?;
    validate(&value)?;
    Ok(value)
}

fn validate(value: &Preferences) -> Result<()> {
    if !(1..=12).contains(&value.default_servings)
        || !["home", "recipes", "pantry", "planner", "shopping"]
            .contains(&value.start_page.as_str())
        || !["enter", "ctrlEnter"].contains(&value.send_shortcut.as_str())
        || [&value.taste, &value.restrictions, &value.equipment]
            .iter()
            .any(|v| v.chars().count() > 2000)
    {
        return Err(error(
            "INVALID_PREFERENCES",
            "默认人数应为 1–12 人，每项偏好最多 2000 字",
        ));
    }
    Ok(())
}

pub fn save(conn: &mut Connection, mut value: Preferences) -> Result<()> {
    validate(&value)?;
    value.taste = value.taste.trim().to_owned();
    value.restrictions = value.restrictions.trim().to_owned();
    value.equipment = value.equipment.trim().to_owned();
    let encoded =
        serde_json::to_string(&value).map_err(|_| error("INVALID_PREFERENCES", "设置无法保存"))?;
    let tx = conn.transaction()?;
    let capture = super::sync::Capture::begin(&tx)?;
    tx.execute("INSERT INTO app_settings(key,value) VALUES('preferences_v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [encoded])?;
    tx.execute(
        "UPDATE app_settings SET value=CAST(value AS INTEGER)+1 WHERE key='data_revision'",
        [],
    )?;
    if let Some(capture) = capture {
        capture.finish(&uuid::Uuid::new_v4().to_string(), "save_dining_preferences")?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{assistant, db};
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn preferences_survive_restart_and_leave_recipe_and_existing_plan_unchanged() {
        let dir = std::env::temp_dir().join(format!("chefish-preferences-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.sqlite3");
        let mut conn = db::open(&path).unwrap();
        assert_eq!(load(&conn).unwrap(), Preferences::default());
        db::execute(&mut conn, &Uuid::new_v4().to_string(), serde_json::from_value(json!({"type":"create_recipe","draft":{"name":"测试菜","category":"家常菜","minutes":10,"servings":2,"subtitle":"","seasoning":"","ingredients":[{"name":"鸡蛋","quantity":"2","unit":"个"}],"steps":["炒熟"]}})).unwrap()).unwrap();
        let snapshot = db::snapshot(&conn).unwrap();
        let revision = snapshot["recipes"][0]["revisionId"].clone();
        db::execute(&mut conn, &Uuid::new_v4().to_string(), serde_json::from_value(json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":revision,"custom_title":null,"day":"2026-10-25","meal":"晚餐","servings":3}})).unwrap()).unwrap();
        let before = db::snapshot(&conn).unwrap();
        let expected = Preferences {
            default_servings: 5,
            taste: "少辣".into(),
            restrictions: "不吃花生".into(),
            equipment: "只有电磁炉".into(),
            automatic_backup: false,
            ..Preferences::default()
        };
        save(&mut conn, expected.clone()).unwrap();
        let after = db::snapshot(&conn).unwrap();
        assert_eq!(before["recipes"], after["recipes"]);
        assert_eq!(before["plans"], after["plans"]);
        let context = assistant::context(&conn, None).unwrap();
        assert_eq!(context["preferences"]["defaultServings"], 5);
        assert_eq!(context["preferences"]["restrictions"], "不吃花生");
        assert!(context["preferences"].get("startPage").is_none());
        drop(conn);
        let mut conn = db::open(&path).unwrap();
        assert_eq!(load(&conn).unwrap(), expected);
        save(&mut conn, Preferences::default()).unwrap();
        assert_eq!(load(&conn).unwrap().restrictions, "");
        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_preferences_do_not_replace_saved_settings() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);")
            .unwrap();
        let original = Preferences::default();
        save(&mut conn, original.clone()).unwrap();
        for invalid in [
            Preferences {
                default_servings: 0,
                ..original.clone()
            },
            Preferences {
                taste: "字".repeat(2001),
                ..original.clone()
            },
            Preferences {
                start_page: "unknown".into(),
                ..original.clone()
            },
        ] {
            assert!(save(&mut conn, invalid).is_err());
            assert_eq!(load(&conn).unwrap(), original);
        }
    }
}

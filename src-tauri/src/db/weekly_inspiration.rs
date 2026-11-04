use super::*;
pub fn current_week(c: &Connection) -> Result<String> {
    Ok(c.query_row(
        "SELECT date('now','localtime','-6 days','weekday 1')",
        [],
        |r| r.get(0),
    )?)
}
pub fn weeks(c: &Connection) -> Result<Value> {
    let mut out = serde_json::Map::new();
    for key in strings(
        c,
        "SELECT key FROM app_settings WHERE key GLOB 'inspiration_week:*'",
    )? {
        let raw: String =
            c.query_row("SELECT value FROM app_settings WHERE key=?1", [&key], |r| {
                r.get(0)
            })?;
        let ids: Vec<String> =
            serde_json::from_str(&raw).map_err(|_| error("DATABASE_ERROR", "周灵感无法读取"))?;
        let active = ids
            .into_iter()
            .filter(|id| {
                c.query_row(
                    "SELECT EXISTS(SELECT 1 FROM recipes WHERE id=?1 AND archived=0)",
                    [id],
                    |r| r.get::<_, bool>(0),
                )
                .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        out.insert(key[17..].into(), json!(active));
    }
    Ok(Value::Object(out))
}
pub fn current(c: &Connection) -> Result<Value> {
    Ok(weeks(c)?[current_week(c)?]
        .as_array()
        .map(|v| json!(v))
        .unwrap_or(json!([])))
}
pub fn set(c: &Connection, recipe: &str, enabled: bool, week: Option<String>) -> Result<()> {
    c.query_row("SELECT id FROM recipes WHERE id=?1", [recipe], |r| {
        r.get::<_, String>(0)
    })?;
    let week = week.unwrap_or(current_week(c)?);
    if !valid_date(&week)
        || c.query_row("SELECT strftime('%w',?1)", [&week], |r| {
            r.get::<_, String>(0)
        })? != "1"
    {
        return Err(error("INVALID_DATE", "周灵感须指定周一日期"));
    }
    let key = format!("inspiration_week:{week}");
    let raw: Option<String> = c
        .query_row("SELECT value FROM app_settings WHERE key=?1", [&key], |r| {
            r.get(0)
        })
        .optional()?;
    let mut ids: Vec<String> = raw
        .map(|s| serde_json::from_str(&s))
        .transpose()
        .map_err(|_| error("DATABASE_ERROR", "周灵感无法读取"))?
        .unwrap_or_default();
    ids.retain(|id| id != recipe);
    if enabled {
        ids.push(recipe.into());
    }
    c.execute("INSERT INTO app_settings VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,json!(ids).to_string()])?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn weeks_are_independent_survive_restart_and_undo() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let (r, _) = super::super::tests::create(&mut c);
        let request = id();
        execute(
            &mut c,
            &request,
            Command::Inspiration {
                recipe_id: r.clone(),
                enabled: true,
                week_start: Some("2026-10-26".into()),
            },
        )
        .unwrap();
        assert_eq!(weeks(&c).unwrap()["2026-10-26"], json!([r]));
        assert!(weeks(&c).unwrap()["2026-11-02"].is_null());
        drop(c);
        let mut c = open(&path).unwrap();
        execute(
            &mut c,
            &id(),
            Command::Undo {
                operation_id: request,
            },
        )
        .unwrap();
        assert!(weeks(&c).unwrap()["2026-10-26"].is_null());
    }
}

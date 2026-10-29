use super::*;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub name: String,
    pub quantity: String,
    pub unit: String,
    pub basis: String,
}
pub fn requirements(conn: &Connection, rev: &str) -> Result<Vec<(String, String, String)>> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [format!("ingredient_resolution:{rev}")],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(stored) = stored {
        let entries: Vec<Entry> = serde_json::from_str(&stored)
            .map_err(|_| error("DATABASE_ERROR", "食材整理记录无法读取"))?;
        return entries
            .into_iter()
            .map(|e| {
                Ok((
                    ingredient_standard::find(conn, &e.name)?
                        .ok_or_else(|| error("NOT_FOUND", "整理后的食材不存在"))?,
                    e.quantity,
                    e.unit,
                ))
            })
            .collect();
    }
    Ok(conn.prepare("SELECT ingredient_id,amount_decimal,unit FROM recipe_ingredients WHERE revision_id=?1 ORDER BY position")?.query_map([rev],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<std::result::Result<Vec<_>,_>>()?)
}
pub fn save(tx: &Transaction, rev: &str, entries: Vec<Entry>) -> Result<()> {
    if entries.is_empty() || entries.len() > 100 {
        return Err(error("INVALID_INPUT", "整理后的食材数量无效"));
    }
    tx.query_row("SELECT id FROM recipe_revisions WHERE id=?1", [rev], |r| {
        r.get::<_, String>(0)
    })?;
    let allowed = tx.prepare("SELECT i.name FROM recipe_ingredients r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.revision_id=?1 UNION SELECT name FROM recipe_text_ingredients WHERE revision_id=?1")?.query_map([rev],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?.into_iter().map(|n|ingredient_standard::name(&n)).collect::<std::collections::BTreeSet<_>>();
    let mut clean = Vec::new();
    for e in entries {
        let (name, quantity, unit, _) = ingredient_standard::amount(&e.name, &e.quantity, &e.unit)?;
        text(&name, 120)?;
        if !allowed.contains(&name) {
            return Err(error("INVALID_INPUT", "整理结果含菜谱之外的食材"));
        }
        shopping::quantity(&quantity)?;
        if !["g", "ml", "个", "片", "盒"].contains(&unit.as_str()) || e.basis.chars().count() > 500
        {
            return Err(error("INVALID_INPUT", "整理后的食材用量无效"));
        }
        if ingredient_standard::find(tx, &name)?.is_none() {
            let category =
                ensure_category(tx, "ingredient", &super::ingredient_category::infer(&name))?;
            tx.execute(
                "INSERT INTO ingredients VALUES(?1,?2,?3)",
                params![id(), name, category],
            )?;
        }
        clean.push(Entry {
            name,
            quantity,
            unit,
            basis: e.basis,
        });
    }
    // Clear recipe amounts are authoritative. AI fills textual amounts and resolves
    // unknown package sizes; it cannot silently rewrite already convertible amounts.
    let texts = tx
        .prepare("SELECT name FROM recipe_text_ingredients WHERE revision_id=?1")?
        .query_map([rev], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|n| ingredient_standard::name(&n))
        .collect::<std::collections::BTreeSet<_>>();
    let exact=tx.prepare("SELECT i.name,r.amount_decimal,r.unit FROM recipe_ingredients r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.revision_id=?1 ORDER BY r.position")?.query_map([rev],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let mut kept = std::collections::BTreeSet::new();
    for (raw, quantity, unit) in exact {
        let name = ingredient_standard::name(&raw);
        if texts.contains(&name) || seasonings::is_seasoning(tx, rev, &raw)? {
            continue;
        }
        let ingredient = ingredient_standard::find(tx, &raw)?
            .ok_or_else(|| error("NOT_FOUND", "菜谱食材不存在"))?;
        let mut mismatch = false;
        for lot in inventory::lots(tx)? {
            if ingredient_standard::matches(tx, lot["ingredientId"].as_str().unwrap(), &ingredient)?
                && ingredient_standard::factor_in(tx, &name, lot["unit"].as_str().unwrap(), &unit)
                    .is_none()
            {
                mismatch = true;
                break;
            }
        }
        if mismatch {
            continue;
        }
        if kept.insert(name.clone()) {
            clean.retain(|e| e.name != name);
        }
        clean.push(Entry {
            name,
            quantity,
            unit,
            basis: "保留菜谱明确用量".into(),
        });
    }
    for name in &allowed {
        if !seasonings::is_seasoning(tx, rev, name)? && !clean.iter().any(|e| &e.name == name) {
            return Err(error("INVALID_INPUT", "整理结果遗漏了菜谱食材"));
        }
    }
    tx.execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![format!("ingredient_resolution:{rev}"),serde_json::to_string(&clean).map_err(|_|error("INVALID_INPUT","整理结果无法保存"))?])?;
    Ok(())
}
pub fn pending(conn: &Connection) -> Result<Option<Value>> {
    let revisions=conn.prepare("SELECT v.id,v.name,v.servings FROM recipe_revisions v WHERE (EXISTS(SELECT 1 FROM recipes r WHERE r.current_revision_id=v.id AND r.archived=0) OR EXISTS(SELECT 1 FROM planned_meals p WHERE p.recipe_revision_id=v.id AND p.removed=0 AND p.cooking_session_id IS NULL)) AND NOT EXISTS(SELECT 1 FROM app_settings WHERE key='ingredient_resolution:'||v.id) ORDER BY EXISTS(SELECT 1 FROM planned_meals p WHERE p.recipe_revision_id=v.id AND p.removed=0 AND p.cooking_session_id IS NULL) DESC,v.rowid")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    for (rev, name, servings) in revisions {
        let texts=conn.prepare("SELECT name,amount_text FROM recipe_text_ingredients WHERE revision_id=?1 ORDER BY position")?.query_map([&rev],|r|Ok(json!({"name":r.get::<_,String>(0)?,"amountText":r.get::<_,String>(1)?})))?.collect::<std::result::Result<Vec<_>,_>>()?.into_iter().filter(|e|!seasonings::common(e["name"].as_str().unwrap())).collect::<Vec<_>>();
        let exact = requirements(conn, &rev)?
            .into_iter()
            .map(|(i, q, u)| {
                let n: String =
                    conn.query_row("SELECT name FROM ingredients WHERE id=?1", [i], |r| {
                        r.get(0)
                    })?;
                Ok(json!({"name":n,"quantity":q,"unit":u}))
            })
            .collect::<Result<Vec<_>>>()?;
        let lots = inventory::lots(conn)?;
        let stock = lots
            .into_iter()
            .map(|mut l| {
                let n: String = conn.query_row(
                    "SELECT name FROM ingredients WHERE id=?1",
                    [l["ingredientId"].as_str().unwrap()],
                    |r| r.get(0),
                )?;
                l["name"] = json!(n);
                Ok(l)
            })
            .collect::<Result<Vec<_>>>()?;
        let mismatch = exact.iter().any(|r| {
            stock.iter().any(|l| {
                ingredient_standard::name(l["name"].as_str().unwrap())
                    == ingredient_standard::name(r["name"].as_str().unwrap())
                    && ingredient_standard::factor_in(
                        conn,
                        r["name"].as_str().unwrap(),
                        l["unit"].as_str().unwrap(),
                        r["unit"].as_str().unwrap(),
                    )
                    .is_none()
            })
        });
        if !texts.is_empty() || mismatch {
            return Ok(Some(
                json!({"revisionId":rev,"recipe":name,"servings":servings,"ingredients":exact,"textIngredients":texts,"stock":stock}),
            ));
        }
    }
    Ok(None)
}

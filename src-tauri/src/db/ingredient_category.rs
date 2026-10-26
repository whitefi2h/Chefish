use super::*;
#[derive(Deserialize)]
struct Rule {
    category: String,
    names: Vec<String>,
}
pub fn infer(name: &str) -> String {
    let rules: Vec<Rule> = serde_json::from_str(include_str!(
        "../../../src/domain/ingredientCategories.json"
    ))
    .expect("bundled ingredient categories");
    rules
        .into_iter()
        .find(|rule| rule.names.iter().any(|word| name.contains(word)))
        .map(|rule| rule.category)
        .unwrap_or_else(|| "未分类".into())
}
pub fn resolve(tx: &Transaction, name: &str, choice: &str) -> Result<String> {
    if choice == "自动分类" {
        ensure_category(tx, "ingredient", &infer(name))
    } else {
        ensure_category(tx, "ingredient", choice)
    }
}
pub fn classify(tx: &Transaction, revision: &str) -> Result<()> {
    let current: String = tx.query_row(
        "SELECT value FROM app_settings WHERE key='data_revision'",
        [],
        |r| r.get(0),
    )?;
    if current != revision {
        return Err(error("STALE_REVISION", "库存已变化，请刷新后再分类"));
    }
    let items=tx.prepare("SELECT i.id,i.name FROM ingredients i JOIN categories c ON c.id=i.category_id WHERE c.name='未分类' AND EXISTS(SELECT 1 FROM inventory_lots l WHERE l.ingredient_id=i.id AND NOT EXISTS(SELECT 1 FROM app_settings s WHERE s.key='inventory_deleted:'||l.id))")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    for (id, name) in items {
        let inferred = infer(&name);
        if inferred == "未分类" {
            continue;
        }
        let category = ensure_category(tx, "ingredient", &inferred)?;
        tx.execute(
            "UPDATE ingredients SET category_id=?1 WHERE id=?2",
            params![category, id],
        )?;
    }
    Ok(())
}

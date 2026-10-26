use super::*;
use rust_decimal::Decimal;
use std::collections::BTreeMap;
use std::sync::OnceLock;
#[derive(Deserialize)]
struct Rule {
    name: String,
    aliases: Vec<String>,
    base: String,
    units: BTreeMap<String, i64>,
}
fn rules() -> &'static Vec<Rule> {
    static RULES: OnceLock<Vec<Rule>> = OnceLock::new();
    RULES.get_or_init(|| {
        serde_json::from_str(include_str!("../../../src/domain/ingredientStandards.json"))
            .expect("bundled ingredient standards")
    })
}
pub fn name(raw: &str) -> String {
    let raw = raw.trim();
    rules()
        .iter()
        .find(|r| {
            r.name.eq_ignore_ascii_case(raw)
                || r.aliases.iter().any(|a| a.eq_ignore_ascii_case(raw))
        })
        .map(|r| r.name.clone())
        .unwrap_or_else(|| raw.into())
}
pub fn amount(raw: &str, quantity: &str, unit: &str) -> Result<(String, String, String, bool)> {
    let canonical = name(raw);
    let n = Decimal::from_str(quantity)
        .map_err(|_| error("INVALID_QUANTITY", "数量必须是十进制数字"))?;
    if n < Decimal::ZERO || n > Decimal::from(100000) || n.scale() > 6 {
        return Err(error("INVALID_QUANTITY", "数量须为 0–100000，最多六位小数"));
    }
    let u = unit.trim();
    let lower = u.to_lowercase();
    let physical = match lower.as_str() {
        "g" | "克" | "公克" => Some(("g", 1)),
        "kg" | "千克" | "公斤" => Some(("g", 1000)),
        "斤" => Some(("g", 500)),
        "两" => Some(("g", 50)),
        "ml" | "毫升" => Some(("ml", 1)),
        "l" | "升" => Some(("ml", 1000)),
        _ => None,
    };
    if let Some((unit, factor)) = physical {
        return Ok((
            canonical,
            (n * Decimal::from(factor)).normalize().to_string(),
            unit.into(),
            false,
        ));
    }
    if !["个", "片", "盒"].contains(&u) {
        if let Some(rule) = rules().iter().find(|r| r.name == canonical) {
            if let Some(f) = rule.units.get(u) {
                return Ok((
                    canonical,
                    (n * Decimal::from(*f)).normalize().to_string(),
                    rule.base.clone(),
                    true,
                ));
            }
        }
    }
    let unit = match u {
        "包" | "袋" | "瓶" | "罐" => "盒",
        "颗" | "枚" | "根" | "只" | "头" | "瓣" | "枝" | "块" | "份" => "个",
        _ => u,
    };
    Ok((canonical, n.normalize().to_string(), unit.into(), false))
}
pub fn factor(raw: &str, from: &str, to: &str) -> Option<Decimal> {
    if from == to {
        return Some(Decimal::ONE);
    }
    let canonical = name(raw);
    let rule = rules().iter().find(|r| r.name == canonical)?;
    let f = |u: &str| {
        if u == rule.base {
            Some(Decimal::ONE)
        } else {
            rule.units.get(u).map(|n| Decimal::from(*n))
        }
    };
    Some(f(from)? / f(to)?)
}
pub fn base(raw: &str, quantity: &str, unit: &str) -> Result<(String, String, String, bool)> {
    let (n, q, u, estimated) = amount(raw, quantity, unit)?;
    if let Some(rule) = rules().iter().find(|r| r.name == n) {
        if let Some(f) = factor(&n, &u, &rule.base) {
            return Ok((
                n,
                (Decimal::from_str(&q).unwrap() * f).normalize().to_string(),
                rule.base.clone(),
                estimated || u != rule.base,
            ));
        }
    }
    Ok((n, q, u, estimated))
}
pub fn canonical_id(conn: &Connection, id: &str) -> Result<String> {
    let raw: String = conn.query_row("SELECT name FROM ingredients WHERE id=?1", [id], |r| {
        r.get(0)
    })?;
    Ok(find(conn, &raw)?.unwrap_or_else(|| id.into()))
}
pub fn find(conn: &Connection, raw: &str) -> Result<Option<String>> {
    let canonical = name(raw);
    let mut rows=conn.prepare("SELECT i.id,i.name FROM ingredients i ORDER BY EXISTS(SELECT 1 FROM inventory_lots l WHERE l.ingredient_id=i.id) DESC,i.name=?1 DESC,i.rowid")?;
    let entries = rows
        .query_map([&canonical], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(entries
        .into_iter()
        .find(|(_, n)| name(n) == canonical)
        .map(|(id, _)| id))
}
pub fn matches(conn: &Connection, left: &str, right: &str) -> Result<bool> {
    if left == right {
        return Ok(true);
    }
    let get = |id: &str| {
        conn.query_row("SELECT name FROM ingredients WHERE id=?1", [id], |r| {
            r.get::<_, String>(0)
        })
    };
    Ok(name(&get(left)?) == name(&get(right)?))
}
pub fn recipe(mut d: RecipeDraft) -> Result<RecipeDraft> {
    for item in &mut d.ingredients {
        let (n, q, u, _) = amount(&item.name, &item.quantity, &item.unit)?;
        item.name = n;
        item.quantity = q;
        item.unit = u;
    }
    for item in &mut d.text_ingredients {
        item.name = name(&item.name);
    }
    d.ingredient_kinds = d
        .ingredient_kinds
        .into_iter()
        .map(|(n, v)| (name(&n), v))
        .collect();
    Ok(d)
}
pub fn command(command: Command) -> Result<Command> {
    Ok(match command {
        Command::ReceiveLot { mut draft } => {
            let (n, q, u, estimated) = amount(&draft.name, &draft.quantity, &draft.unit)?;
            draft.name = n;
            draft.quantity = q;
            draft.unit = u;
            if estimated {
                draft.precision = "rough".into();
            }
            Command::ReceiveLot { draft }
        }
        Command::CreateRecipe { draft } => Command::CreateRecipe {
            draft: recipe(draft)?,
        },
        Command::ReviseRecipe {
            recipe_id,
            expected_revision_id,
            draft,
        } => Command::ReviseRecipe {
            recipe_id,
            expected_revision_id,
            draft: recipe(draft)?,
        },
        Command::SaveShopping {
            line_id,
            expected_version,
            mut draft,
        } => {
            let (n, q, u, _) = amount(&draft.name, &draft.quantity, &draft.unit)?;
            draft.name = n;
            draft.quantity = q;
            draft.unit = u;
            Command::SaveShopping {
                line_id,
                expected_version,
                draft,
            }
        }
        other => other,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aliases_counts_and_packages_cover_legacy_recipe_without_rewriting_history() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let mut d = super::super::tests::draft();
        d.ingredients = vec![
            DraftIngredient {
                name: "蒜末".into(),
                quantity: "10".into(),
                unit: "g".into(),
            },
            DraftIngredient {
                name: "蒜片".into(),
                quantity: "3".into(),
                unit: "片".into(),
            },
        ];
        execute(&mut c, &id(), Command::CreateRecipe { draft: d }).unwrap();
        let s = snapshot(&c).unwrap();
        let rev = s["recipes"][0]["revisionId"].as_str().unwrap();
        let today = shopping::local_today(&c).unwrap();
        execute(
            &mut c,
            &id(),
            Command::SavePlan {
                plan_id: None,
                expected_version: None,
                draft: planner::PlanDraft {
                    recipe_revision_id: Some(rev.into()),
                    custom_title: None,
                    day: today.clone(),
                    meal: "晚餐".into(),
                    servings: 2,
                },
            },
        )
        .unwrap();
        execute(
            &mut c,
            &id(),
            Command::ReceiveLot {
                draft: InventoryDraft {
                    name: "蒜头".into(),
                    category: "未分类".into(),
                    quantity: "4".into(),
                    unit: "个".into(),
                    location: "冷藏".into(),
                    received: today.clone(),
                    expires: None,
                    precision: "rough".into(),
                },
            },
        )
        .unwrap();
        // Simulate a pre-normalization name without altering IDs or quantities.
        c.execute("UPDATE ingredients SET name='蒜头' WHERE name='大蒜'", [])
            .unwrap();
        let before = snapshot(&c).unwrap();
        let week = shopping::week(&c, &today).unwrap();
        let f = shopping::forecast(&c, &week).unwrap();
        let rows = f["items"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["required"], "25");
        assert_eq!(rows[0]["remaining"], "0");
        let plan = before["plans"][0]["id"].as_str().unwrap();
        let p = cooking::preview(&c, plan, 2, &today).unwrap();
        assert_eq!(p["rows"][0]["lots"][0]["suggested"], "0.5");
        assert_eq!(snapshot(&c).unwrap(), before);
        // A purchase recorded in the former count unit still satisfies normalized demand.
        let ingredient = before["lots"][0]["ingredientId"].as_str().unwrap();
        c.execute("INSERT INTO shopping_lines(id,ingredient_id,unit,source,week_start,requested_decimal) VALUES('legacy-line',?1,'个','plan',?2,'0')",params![ingredient,week]).unwrap();
        c.execute("INSERT INTO purchase_events(id,line_id,amount_decimal) VALUES('legacy-purchase','legacy-line','1')",[]).unwrap();
        let f = shopping::forecast(&c, &week).unwrap();
        assert_eq!(f["items"].as_array().unwrap().len(), 1);
        assert_eq!(f["items"][0]["required"], "0.5");
        assert_eq!(f["items"][0]["remaining"], "0");

        assert_eq!(
            amount("Spaghetti", "2", "包").unwrap(),
            ("意大利面".into(), "1000".into(), "g".into(), true)
        );
        assert_eq!(amount("大蒜", "3", "瓣").unwrap().1, "15");
        assert_eq!(amount("水", "0.2", "L").unwrap().1, "200");
    }
}

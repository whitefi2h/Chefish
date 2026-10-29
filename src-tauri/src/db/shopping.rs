use super::*;
use rust_decimal::{Decimal, RoundingStrategy};
use std::collections::BTreeMap;

pub fn quantity(s: &str) -> Result<Decimal> {
    let n = Decimal::from_str(s).map_err(|_| error("INVALID_QUANTITY", "数量必须是十进制数字"))?;
    if n <= Decimal::ZERO || n > Decimal::from(100000) || n.scale() > 6 {
        return Err(error(
            "INVALID_QUANTITY",
            "数量须大于0且不超过100000，最多六位小数",
        ));
    }
    Ok(n)
}
fn number(s: &str) -> Result<Decimal> {
    Decimal::from_str(s).map_err(|_| error("DATABASE_ERROR", "数量记录无法读取"))
}
fn show(n: Decimal) -> String {
    n.normalize().to_string()
}
fn unit(s: &str) -> Result<()> {
    if !["g", "ml", "个", "片", "盒"].contains(&s) {
        return Err(error("INVALID_INPUT", "请选择支持的单位"));
    }
    Ok(())
}
pub fn validate_week(conn: &Connection, day: &str) -> Result<()> {
    if !valid_date(day) {
        return Err(error("INVALID_INPUT", "周日期无效"));
    }
    let monday: bool = conn.query_row("SELECT strftime('%w',?1)='1'", [day], |r| r.get(0))?;
    if !monday {
        return Err(error("INVALID_INPUT", "请选择周一作为清单起始日"));
    }
    Ok(())
}
pub(super) fn week(conn: &Connection, day: &str) -> Result<String> {
    Ok(conn.query_row(
        "SELECT date(?1,'-'||((CAST(strftime('%w',?1) AS INTEGER)+6)%7)||' days')",
        [day],
        |r| r.get(0),
    )?)
}
pub fn local_today(conn: &Connection) -> Result<String> {
    Ok(conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0))?)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualDraft {
    pub name: String,
    pub category: String,
    pub quantity: String,
    pub unit: String,
}
fn version(conn: &Connection, key: &str, expected: i64) -> Result<()> {
    let actual = conn
        .query_row(
            "SELECT version FROM shopping_lines WHERE id=?1 AND removed=0",
            [key],
            |r| r.get::<_, i64>(0),
        )
        .optional()?;
    if actual != Some(expected) {
        return Err(error("STALE_REVISION", "采购项目已更新，请刷新后核对数量"));
    }
    Ok(())
}
fn totals(conn: &Connection, key: &str) -> Result<(Decimal, Decimal)> {
    let mut stmt = conn.prepare("SELECT p.amount_decimal FROM purchase_events p WHERE line_id=?1 AND NOT EXISTS(SELECT 1 FROM shopping_combined_purchases b JOIN shopping_receipts r ON r.purchase_id=b.purchase_id JOIN shopping_receipt_undos u ON u.receipt_id=r.id WHERE b.purchase_id=p.id)")?;
    let bought = stmt
        .query_map([key], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .iter()
        .try_fold(Decimal::ZERO, |a, s| Ok::<_, ApiError>(a + number(s)?))?;
    let mut stmt=conn.prepare("SELECT r.amount_decimal FROM shopping_receipts r JOIN purchase_events p ON p.id=r.purchase_id WHERE p.line_id=?1 AND NOT EXISTS(SELECT 1 FROM shopping_receipt_undos u WHERE u.receipt_id=r.id)")?;
    let received = stmt
        .query_map([key], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .iter()
        .try_fold(Decimal::ZERO, |a, s| Ok::<_, ApiError>(a + number(s)?))?;
    Ok((bought, received))
}
pub fn save_manual(
    tx: &Transaction,
    key: Option<String>,
    expected: Option<i64>,
    draft: ManualDraft,
) -> Result<()> {
    text(&draft.name, 120)?;
    unit(&draft.unit)?;
    let n = quantity(&draft.quantity)?;
    let cat = category(tx, "ingredient", &draft.category)?;
    if let Some(ref key) = key {
        version(tx, key, expected.unwrap_or(0))?;
        let source: String = tx.query_row(
            "SELECT source FROM shopping_lines WHERE id=?1",
            [key],
            |r| r.get(0),
        )?;
        if source != "manual" || totals(tx, key)?.0 > Decimal::ZERO {
            return Err(error(
                "PURCHASE_RECORDED",
                "已购买的项目保留原记录，请另加一项",
            ));
        }
    } else if expected.is_some() {
        return Err(error("INVALID_INPUT", "新增项目无需版本号"));
    }
    let ingredient = ingredient_standard::find(tx, &draft.name)?;
    let ingredient = match ingredient {
        Some(i) => i,
        None => {
            let i = id();
            tx.execute(
                "INSERT INTO ingredients VALUES(?1,?2,?3)",
                params![i, draft.name.trim(), cat],
            )?;
            i
        }
    };
    if let Some(key) = key {
        tx.execute("UPDATE shopping_lines SET ingredient_id=?1,unit=?2,requested_decimal=?3,version=version+1 WHERE id=?4",params![ingredient,draft.unit,show(n),key])?;
    } else {
        tx.execute("INSERT INTO shopping_lines(id,ingredient_id,unit,source,week_start,requested_decimal) VALUES(?1,?2,?3,'manual',NULL,?4)",params![id(),ingredient,draft.unit,show(n)])?;
    }
    Ok(())
}
pub fn buy(
    tx: &Transaction,
    key: Option<String>,
    expected: i64,
    ingredient: &str,
    u: &str,
    scope: Option<String>,
    amount: &str,
) -> Result<(String, String)> {
    let n = quantity(amount)?;
    unit(u)?;
    let key = if let Some(key) = key {
        version(tx, &key, expected)?;
        let (i, stored_unit, stored_week): (String, String, Option<String>) = tx.query_row(
            "SELECT ingredient_id,unit,week_start FROM shopping_lines WHERE id=?1",
            [&key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        if i != ingredient || stored_unit != u || stored_week != scope {
            return Err(error("INVALID_INPUT", "采购项目与当前选择不一致"));
        }
        key
    } else {
        let scope = scope
            .as_ref()
            .ok_or_else(|| error("INVALID_INPUT", "请选择菜单周或手动采购项目"))?;
        validate_week(tx, scope)?;
        if expected != 0 {
            return Err(error("STALE_REVISION", "采购项目已变化"));
        }
        let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM shopping_lines WHERE week_start=?1 AND ingredient_id=?2 AND unit=?3 AND source='plan')",params![scope,ingredient,u],|r|r.get(0))?;
        if exists {
            return Err(error("STALE_REVISION", "这项采购已有记录，请刷新后重试"));
        }
        let today = local_today(tx)?;
        let preview = forecast_inner(tx, scope, &today)?;
        if !preview["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["ingredientId"] == ingredient && r["unit"] == u && r["source"] == "plan")
        {
            return Err(error("INVALID_INPUT", "这项计划需求已不存在，请刷新"));
        }
        let key = id();
        tx.execute("INSERT INTO shopping_lines(id,ingredient_id,unit,source,week_start,requested_decimal) VALUES(?1,?2,?3,'plan',?4,'0')",params![key,ingredient,u,scope])?;
        key
    };
    let purchase_id = id();
    tx.execute(
        "INSERT INTO purchase_events(id,line_id,amount_decimal) VALUES(?1,?2,?3)",
        params![purchase_id, key, show(n)],
    )?;
    tx.execute(
        "UPDATE shopping_lines SET version=version+1 WHERE id=?1",
        [&key],
    )?;
    Ok((key, purchase_id))
}
pub fn purchase(
    tx: &Transaction,
    key: Option<String>,
    expected: i64,
    ingredient: &str,
    u: &str,
    scope: Option<String>,
    amount: &str,
    location: &str,
    received: &str,
    expires: Option<String>,
) -> Result<()> {
    let (key, purchase_id) = buy(tx, key, expected, ingredient, u, scope, amount)?;
    tx.execute(
        "INSERT INTO shopping_combined_purchases VALUES(?1)",
        [&purchase_id],
    )?;
    let version: i64 = tx.query_row(
        "SELECT version FROM shopping_lines WHERE id=?1",
        [&key],
        |r| r.get(0),
    )?;
    receive_from(
        tx,
        &key,
        version,
        amount,
        location,
        received,
        expires,
        Some(&purchase_id),
    )
}
pub fn receive(
    tx: &Transaction,
    key: &str,
    expected: i64,
    amount: &str,
    location: &str,
    received: &str,
    expires: Option<String>,
) -> Result<()> {
    receive_from(tx, key, expected, amount, location, received, expires, None)
}
fn receive_from(
    tx: &Transaction,
    key: &str,
    expected: i64,
    amount: &str,
    location: &str,
    received: &str,
    expires: Option<String>,
    purchase: Option<&str>,
) -> Result<()> {
    version(tx, key, expected)?;
    let n = quantity(amount)?;
    let (bought, stocked) = totals(tx, key)?;
    if n > bought - stocked {
        return Err(error(
            "EXCESS_RECEIPT",
            "本次购买量超过已买待购买量，未写入",
        ));
    }
    if received > local_today(tx)?.as_str() {
        return Err(error("INVALID_INPUT", "收货日期不能晚于今天"));
    }
    let (name,category,u):(String,String,String)=tx.query_row("SELECT i.name,c.name,l.unit FROM shopping_lines l JOIN ingredients i ON i.id=l.ingredient_id JOIN categories c ON c.id=i.category_id WHERE l.id=?1",[key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    let lot_id = inventory::receive_batch(
        tx,
        InventoryDraft {
            name,
            category,
            quantity: show(n),
            unit: u,
            location: location.into(),
            received: received.into(),
            expires,
            precision: "exact".into(),
        },
        "采购收货",
    )?;
    let mut stmt = tx.prepare(
        "SELECT p.id,p.amount_decimal FROM purchase_events p WHERE line_id=?1 AND (?2 IS NULL OR p.id=?2) AND NOT EXISTS(SELECT 1 FROM shopping_combined_purchases b JOIN shopping_receipts r ON r.purchase_id=b.purchase_id JOIN shopping_receipt_undos u ON u.receipt_id=r.id WHERE b.purchase_id=p.id) ORDER BY occurred_at,rowid",
    )?;
    let rows = stmt
        .query_map(params![key, purchase], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut remaining = n;
    for (purchase, bought) in rows {
        let mut stmt =
            tx.prepare("SELECT r.amount_decimal FROM shopping_receipts r WHERE purchase_id=?1 AND NOT EXISTS(SELECT 1 FROM shopping_receipt_undos u WHERE u.receipt_id=r.id)")?;
        let received = stmt
            .query_map([&purchase], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .iter()
            .try_fold(Decimal::ZERO, |a, s| Ok::<_, ApiError>(a + number(s)?))?;
        let taken = remaining.min(number(&bought)? - received);
        if taken > Decimal::ZERO {
            tx.execute("INSERT INTO shopping_receipts(id,purchase_id,lot_id,amount_decimal) VALUES(?1,?2,?3,?4)",params![id(),purchase,lot_id,show(taken)])?;
            remaining -= taken;
        }
        if remaining == Decimal::ZERO {
            break;
        }
    }
    if remaining != Decimal::ZERO {
        return Err(error("DATABASE_ERROR", "收货分配失败，本次未购买"));
    }
    tx.execute(
        "UPDATE shopping_lines SET version=version+1 WHERE id=?1",
        [key],
    )?;
    Ok(())
}
pub fn remove(tx: &Transaction, key: &str, expected: i64) -> Result<()> {
    version(tx, key, expected)?;
    let source: String = tx.query_row(
        "SELECT source FROM shopping_lines WHERE id=?1",
        [key],
        |r| r.get(0),
    )?;
    if source != "manual" {
        return Err(error("PURCHASE_RECORDED", "计划需求应从本周清单移除"));
    }
    tx.execute(
        "UPDATE shopping_lines SET removed=1,version=version+1 WHERE id=?1",
        [key],
    )?;
    Ok(())
}
pub fn hide(tx: &Transaction, scope: &str, ingredient: &str, u: &str) -> Result<()> {
    validate_week(tx, scope)?;
    unit(u)?;
    tx.execute(
        "INSERT OR IGNORE INTO shopping_suppressions VALUES(?1,?2,?3)",
        params![scope, ingredient, u],
    )?;
    Ok(())
}

pub fn undo_receipt(tx: &Transaction, lot_id: &str) -> Result<()> {
    let mut stmt=tx.prepare("SELECT r.id,p.line_id FROM shopping_receipts r JOIN purchase_events p ON p.id=r.purchase_id WHERE r.lot_id=?1 AND NOT EXISTS(SELECT 1 FROM shopping_receipt_undos u WHERE u.receipt_id=r.id)")?;
    let rows = stmt
        .query_map([lot_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut lines = std::collections::BTreeSet::new();
    for (receipt, line) in rows {
        tx.execute(
            "INSERT INTO shopping_receipt_undos(id,receipt_id) VALUES(?1,?2)",
            params![id(), receipt],
        )?;
        lines.insert(line);
    }
    for line in lines {
        tx.execute(
            "UPDATE shopping_lines SET version=version+1 WHERE id=?1",
            [line],
        )?;
    }
    Ok(())
}

struct Stock {
    ingredient: String,
    unit: String,
    remaining: Decimal,
    expires: Option<String>,
    received: String,
    source_name: String,
    source_unit: String,
    estimated: bool,
}
#[derive(Default)]
struct Demand {
    required: Decimal,
    covered: Decimal,
    carried_purchase: Decimal,
    review: bool,
    estimated: bool,
    estimates: Vec<String>,
    sources: Vec<String>,
}
pub fn forecast(conn: &Connection, scope: &str) -> Result<Value> {
    validate_week(conn, scope)?;
    let tx = conn.unchecked_transaction()?;
    let today = local_today(&tx)?;
    let result = forecast_inner(&tx, scope, &today)?;
    tx.commit()?;
    Ok(result)
}
fn forecast_inner(conn: &Connection, scope: &str, today: &str) -> Result<Value> {
    let mut stmt=conn.prepare("SELECT ingredient_id,unit,amount_decimal,expires_on,received_on,COALESCE(json_extract((SELECT value FROM app_settings WHERE key='steward_meta:lot:'||l.id),'$.sourceName'),(SELECT name FROM ingredients WHERE id=l.ingredient_id)),COALESCE(json_extract((SELECT value FROM app_settings WHERE key='steward_meta:lot:'||l.id),'$.sourceUnit'),unit),precision='rough' FROM inventory_lots l WHERE NOT EXISTS(SELECT 1 FROM app_settings WHERE key='inventory_deleted:'||l.id) ORDER BY expires_on IS NULL,expires_on,received_on,rowid")?;
    let lots = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, bool>(7)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut stock = lots
        .into_iter()
        .map(
            |(ingredient, unit, n, expires, received, source_name, source_unit, estimated)| {
                Ok(Stock {
                    ingredient,
                    unit,
                    remaining: number(&n)?,
                    expires,
                    received,
                    source_name,
                    source_unit,
                    estimated,
                })
            },
        )
        .collect::<Result<Vec<_>>>()?;
    let mut stmt=conn.prepare("SELECT p.day,p.meal,p.servings,v.servings,v.id,v.name,p.custom_title FROM planned_meals p LEFT JOIN recipe_revisions v ON v.id=p.recipe_revision_id WHERE p.removed=0 AND p.cooking_session_id IS NULL AND p.day>=?1 ORDER BY p.day,CASE p.meal WHEN '早餐' THEN 0 WHEN '午餐' THEN 1 ELSE 2 END,p.sort_order,p.rowid")?;
    let plans = stmt
        .query_map([today], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<i64>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut demand: BTreeMap<(String, String), Demand> = BTreeMap::new();
    let mut review_notes = Vec::<String>::new();
    for (day, meal, servings, standard, revision, name, custom) in plans {
        let in_scope = week(conn, &day)? == scope;
        let Some(rev) = revision else {
            if in_scope {
                review_notes.push(format!(
                    "{} {} · {}：临时菜未录入用量",
                    day,
                    meal,
                    custom.unwrap_or_default()
                ));
            }
            continue;
        };
        let requirements = ingredient_resolution::requirements(conn, &rev)?;
        if in_scope {
            let seasoning: String = conn.query_row(
                "SELECT seasoning FROM recipe_revisions WHERE id=?1",
                [&rev],
                |r| r.get(0),
            )?;
            if !seasoning.trim().is_empty() {
                review_notes.push(format!(
                    "{} {} · {}：调味请自行核对（{}）",
                    day,
                    meal,
                    name.as_deref().unwrap_or_default(),
                    seasoning
                ));
            }
            let text_count: i64 = conn.query_row(
                "SELECT count(*) FROM recipe_text_ingredients WHERE revision_id=?1",
                [&rev],
                |r| r.get(0),
            )?;
            if text_count > 0 {
                review_notes.push(format!(
                    "{} {} · {}：有 {} 项原文用量，请按菜谱核对",
                    day,
                    meal,
                    name.as_deref().unwrap_or_default(),
                    text_count
                ));
            }
            if requirements.is_empty() {
                review_notes.push(format!(
                    "{} {} · {}：未录入食材用量",
                    day,
                    meal,
                    name.as_deref().unwrap_or_default()
                ));
            }
        }
        for (ingredient, n, u) in requirements {
            let raw_name: String = conn.query_row(
                "SELECT name FROM ingredients WHERE id=?1",
                [&ingredient],
                |r| r.get(0),
            )?;
            let source = super::steward::metadata(conn, "revision", &rev)?;
            let original = source["ingredients"].as_array().and_then(|rows| {
                rows.iter().find(|r| {
                    r["sourceName"].as_str().is_some_and(|n| {
                        ingredient_standard::name_in(conn, n).is_ok_and(|v| v == raw_name)
                    })
                })
            });
            let source_name = original
                .and_then(|r| r["sourceName"].as_str())
                .unwrap_or(&raw_name);
            let (_, n, u, mut standard_estimate) =
                ingredient_standard::base_in(conn, source_name, &n, &u)?;
            if original.is_some_and(|v| v["estimated"] == true) {
                standard_estimate = true;
            }
            let cached: Option<String> = conn
                .query_row(
                    "SELECT value FROM app_settings WHERE key=?1",
                    [format!("ingredient_resolution:{rev}")],
                    |r| r.get(0),
                )
                .optional()?;
            let estimates: Vec<String> = cached
                .and_then(|v| serde_json::from_str::<Vec<ingredient_resolution::Entry>>(&v).ok())
                .unwrap_or_default()
                .into_iter()
                .filter(|e| {
                    ingredient_standard::name(&e.name) == ingredient_standard::name(&raw_name)
                        && e.basis != "保留菜谱明确用量"
                })
                .map(|e| format!("{}：{} {}（{}）", e.name, e.quantity, e.unit, e.basis))
                .collect();
            let ingredient = ingredient_standard::canonical_id(conn, &ingredient)?;
            let ingredient_name: String = conn.query_row(
                "SELECT name FROM ingredients WHERE id=?1",
                [&ingredient],
                |r| r.get(0),
            )?;
            if seasonings::is_seasoning(conn, &rev, &ingredient_name)? {
                continue;
            }
            let required = (number(&n)? * Decimal::from(servings)
                / Decimal::from(standard.unwrap()))
            .round_dp_with_strategy(6, RoundingStrategy::ToPositiveInfinity);
            let mut remaining = required;
            let mut review = false;
            let mut stock_estimate = false;
            for lot in &mut stock {
                if !ingredient_standard::matches(conn, &lot.ingredient, &ingredient)?
                    || lot.remaining <= Decimal::ZERO
                    || lot.received.as_str() > today
                    || lot.expires.as_ref().is_some_and(|d| d < &day)
                {
                    continue;
                }
                if u == "盒" && lot.unit == "盒" && lot.source_unit != "盒" {
                    review = true;
                    continue;
                }
                let Some(factor) =
                    ingredient_standard::factor_in(conn, &lot.source_name, &lot.unit, &u)
                else {
                    review = true;
                    continue;
                };
                let take = remaining.min(lot.remaining * factor);
                if take > Decimal::ZERO && lot.estimated {
                    stock_estimate = true;
                }
                remaining -= take;
                lot.remaining -= take / factor;
            }
            if in_scope {
                let row = demand.entry((ingredient, u)).or_default();
                row.required += required;
                row.covered += required - remaining;
                row.review |= review;
                row.estimated |= standard_estimate || stock_estimate || !estimates.is_empty();
                for note in estimates {
                    if !row.estimates.contains(&note) {
                        row.estimates.push(note);
                    }
                }
                if standard_estimate {
                    let note = format!("{}含常见规格换算，请按实际包装或大小修改", raw_name);
                    if !row.estimates.contains(&note) {
                        row.estimates.push(note);
                    }
                }
                if stock_estimate {
                    let note = format!("{}的库存抵扣包含粗略数量", raw_name);
                    if !row.estimates.contains(&note) {
                        row.estimates.push(note);
                    }
                }
                if let Some(original) = original {
                    if original["estimated"] == true {
                        let note = format!(
                            "原始用量：{} {} {}",
                            original["sourceName"].as_str().unwrap_or(""),
                            original["quantity"].as_str().unwrap_or(""),
                            original["unit"].as_str().unwrap_or("")
                        );
                        if !row.estimates.contains(&note) {
                            row.estimates.push(note);
                        }
                    }
                }
                let source = format!("{} {} · {}", day, meal, name.as_deref().unwrap_or_default());
                if !row.sources.contains(&source) {
                    row.sources.push(source);
                }
            }
        }
    }
    let mut stmt=conn.prepare("SELECT l.id,l.ingredient_id,l.unit,l.source,l.requested_decimal,l.version FROM shopping_lines l WHERE l.removed=0 AND (l.source='manual' OR l.week_start=?1) ORDER BY l.rowid")?;
    let lines = stmt
        .query_map([scope], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut items = Vec::new();
    for (key, ingredient, u, source, requested, version) in &lines {
        let d = if source == "plan" {
            let raw: String = conn.query_row(
                "SELECT name FROM ingredients WHERE id=?1",
                [ingredient],
                |r| r.get(0),
            )?;
            let canonical = ingredient_standard::canonical_id(conn, ingredient)?;
            let (_, factor, base_unit, _) = ingredient_standard::base_in(conn, &raw, "1", u)?;
            let factor = number(&factor)?;
            let mut d = demand
                .remove(&(canonical.clone(), base_unit.clone()))
                .unwrap_or_default();
            d.required = (d.required / factor)
                .round_dp_with_strategy(6, RoundingStrategy::ToPositiveInfinity);
            d.covered = (d.covered / factor).round_dp(6);
            if d.required > Decimal::ZERO {
                for (other, other_ingredient, other_unit, other_source, _, _) in &lines {
                    if other == key
                        || other_source != "plan"
                        || ingredient_standard::canonical_id(conn, other_ingredient)? != canonical
                    {
                        continue;
                    }
                    let (_, other_factor, other_base, _) =
                        ingredient_standard::base_in(conn, &raw, "1", other_unit)?;
                    if other_base == base_unit {
                        let (bought, received) = totals(conn, other)?;
                        d.carried_purchase += (bought - received) * number(&other_factor)? / factor;
                    }
                }
            }
            d
        } else {
            Demand {
                required: number(requested)?,
                ..Default::default()
            }
        };
        items.push(item(
            conn,
            Some(key.clone()),
            *version,
            ingredient,
            u,
            source,
            scope,
            d,
        )?);
    }
    for ((ingredient, u), d) in demand {
        items.push(item(conn, None, 0, &ingredient, &u, "plan", scope, d)?);
    }
    let past: i64 = conn.query_row(
        "SELECT count(*) FROM planned_meals WHERE removed=0 AND day<?1",
        [today],
        |r| r.get(0),
    )?;
    Ok(
        json!({"weekStart":scope,"asOf":today,"items":items,"reviewNotes":review_notes,"pastPlanCount":past}),
    )
}
fn item(
    conn: &Connection,
    key: Option<String>,
    version: i64,
    ingredient: &str,
    u: &str,
    source: &str,
    scope: &str,
    d: Demand,
) -> Result<Value> {
    let (name,category):(String,String)=conn.query_row("SELECT i.name,c.name FROM ingredients i JOIN categories c ON c.id=i.category_id WHERE i.id=?1",[ingredient],|r|Ok((r.get(0)?,r.get(1)?)))?;
    let (purchased, received) = if let Some(ref key) = key {
        totals(conn, key)?
    } else {
        (Decimal::ZERO, Decimal::ZERO)
    };
    let outstanding = purchased - received;
    let shortage = (d.required - d.covered).max(Decimal::ZERO);
    let hidden=source=="plan" && conn.query_row("SELECT EXISTS(SELECT 1 FROM shopping_suppressions WHERE week_start=?1 AND ingredient_id=?2 AND unit=?3)",params![scope,ingredient,u],|r|r.get::<_,bool>(0))?;
    let remaining = if hidden {
        Decimal::ZERO
    } else {
        (shortage
            - if source == "manual" {
                purchased
            } else {
                outstanding + d.carried_purchase
            })
        .max(Decimal::ZERO)
    };
    let mut history = Vec::new();
    if let Some(ref key) = key {
        let mut stmt=conn.prepare("SELECT 'purchase',p.id,p.amount_decimal,p.occurred_at,NULL FROM purchase_events p WHERE p.line_id=?1 UNION ALL SELECT 'receive',r.id,r.amount_decimal,r.occurred_at,r.lot_id FROM shopping_receipts r JOIN purchase_events p ON p.id=r.purchase_id WHERE p.line_id=?1 UNION ALL SELECT CASE WHEN EXISTS(SELECT 1 FROM shopping_combined_purchases b WHERE b.purchase_id=p.id) THEN 'undo_purchase' ELSE 'undo_receive' END,u.id,r.amount_decimal,u.occurred_at,r.lot_id FROM shopping_receipt_undos u JOIN shopping_receipts r ON r.id=u.receipt_id JOIN purchase_events p ON p.id=r.purchase_id WHERE p.line_id=?1 ORDER BY 4,2")?;
        history=stmt.query_map([key],|r|Ok(json!({"kind":r.get::<_,String>(0)?,"id":r.get::<_,String>(1)?,"quantity":r.get::<_,String>(2)?,"at":r.get::<_,String>(3)?,"lotId":r.get::<_,Option<String>>(4)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    }
    Ok(
        json!({"id":key,"version":version,"ingredientId":ingredient,"name":ingredient_standard::name_in(conn,&name)?,"category":category,"unit":u,"source":source,"weekStart":if source=="plan"{Some(scope)}else{None},"required":show(d.required),"covered":show(d.covered),"shortage":show(shortage),"purchased":show(purchased),"received":show(received),"unreceived":show(outstanding),"remaining":show(remaining),"review":d.review,"estimated":d.estimated,"estimates":d.estimates,"hidden":hidden,"surplus":source=="plan" && outstanding>shortage,"sources":d.sources,"history":history}),
    )
}

#[cfg(test)]
#[path = "shopping_tests.rs"]
mod tests;

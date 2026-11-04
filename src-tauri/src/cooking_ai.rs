use crate::{
    ai,
    db::{self, ApiError, Result},
    Database,
};
use rust_decimal::Decimal;
use serde_json::{json, Value};
use std::{collections::BTreeMap, str::FromStr};
use tauri::Manager;
fn fail(message: &str) -> ApiError {
    ApiError {
        code: "COOKING_RECORD".into(),
        message: message.into(),
    }
}
pub fn context(conn: &rusqlite::Connection, id: &str, servings: i64, date: &str) -> Result<Value> {
    let preview = db::cooking::preview(conn, id, servings, date)?;
    let title:String=conn.query_row("SELECT coalesce(v.name,p.custom_title,'这道菜') FROM planned_meals p LEFT JOIN recipe_revisions v ON v.id=p.recipe_revision_id WHERE p.id=?1",[id],|r|r.get(0))?;
    let stock = db::inventory_rows(conn)?
        .into_iter()
        .filter(|l| {
            l["quantity"]
                .as_str()
                .and_then(|s| Decimal::from_str(s).ok())
                .is_some_and(|q| q > Decimal::ZERO)
        })
        .map(|mut l| {
            let name: String = conn.query_row(
                "SELECT name FROM ingredients WHERE id=?1",
                [l["ingredientId"].as_str().unwrap()],
                |r| r.get(0),
            )?;
            l["name"] = json!(name);
            l["canonicalName"] = json!(db::ingredient_standard::name(&name));
            l["aliases"] = json!(db::ingredient_standard::aliases(&name));
            l["expiredAtCooking"] = json!(l["expires"].as_str().is_some_and(|d| d < date));
            l["countGramsPerUnit"] = db::ingredient_standard::factor(&name, "个", "g")
                .map(|v| json!(v.normalize().to_string()))
                .unwrap_or(Value::Null);
            l["gramsPerUnit"] =
                db::ingredient_standard::factor(&name, l["unit"].as_str().unwrap(), "g")
                    .map(|v| json!(v.normalize().to_string()))
                    .unwrap_or(Value::Null);
            Ok(l)
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(json!({"preview":preview,"stock":stock,"recipe":title,"date":date,"servings":servings}))
}
pub fn interpret(input: &Value, record: &str) -> Result<Value> {
    let mut feedback = Value::Null;
    for _ in 0..2 {
        let output = ai::completion(
            include_str!("cooking_record_prompt.txt"),
            json!({"record":record,"kitchen":input,"lastValidation":feedback}),
        )?;
        match validate(input, &output) {
            Ok(quantities) => {
                let (summary, assumptions) = describe(input, &output, &quantities);
                return Ok(
                    json!({"quantities":quantities,"summary":summary,"assumptions":assumptions}),
                );
            }
            Err(e) => feedback = json!({"error":e.message}),
        }
    }
    Err(fail("暂未整理出有效用量，文字记录已保留，可以直接手动调整"))
}
fn validate(input: &Value, result: &Value) -> Result<BTreeMap<String, String>> {
    let rows = result["consumptions"]
        .as_array()
        .ok_or_else(|| fail("结果必须有consumptions数组"))?;
    let mut totals = BTreeMap::<String, Decimal>::new();
    let mut remaining_sources = BTreeMap::<String, Decimal>::new();
    for row in rows {
        if !matches!(
            row["usage"].as_str(),
            Some("all" | "quantity" | "estimated")
        ) {
            return Err(fail("每项消耗必须注明 usage：all 为用户明确全部用完，quantity 为明确数量或比例，estimated 为模糊估计。不能省略用户用量意图"));
        }
        let id = row["lotId"]
            .as_str()
            .or(row["lot_id"].as_str())
            .ok_or_else(|| fail("缺少库存批次ID"))?;
        let lot = input["stock"]
            .as_array()
            .unwrap()
            .iter()
            .find(|l| l["id"] == id)
            .ok_or_else(|| fail("只能使用提供的库存批次ID"))?;
        let raw = row["quantity"]
            .as_str()
            .map(String::from)
            .unwrap_or_else(|| row["quantity"].to_string());
        let mut n = Decimal::from_str(&raw).map_err(|_| fail("用量必须是数字"))?;
        if n < Decimal::ZERO || n.scale() > 6 {
            return Err(fail("用量不能为负数，最多6位小数"));
        }
        if row["usage"] == "all"
            && n != Decimal::from_str(lot["quantity"].as_str().unwrap()).unwrap()
        {
            return Err(fail("用户明确全部用完的批次必须扣完整现存量，不能按菜谱人数或预估量缩减。请以用户记录为准重新整理"));
        }
        if let (Some(q), Some(u)) = (row["sourceQuantity"].as_str(), row["sourceUnit"].as_str()) {
            let source = Decimal::from_str(q).map_err(|_| fail("原始用量须为十进制数字"))?;
            let name = lot["name"].as_str().unwrap_or("");
            let factor =
                db::ingredient_standard::factor(name, u, lot["unit"].as_str().unwrap_or(""))
                    .ok_or_else(|| {
                        fail("原始用量单位无法换算，请保留用户描述并说明所缺的换算依据")
                    })?;
            if source < Decimal::ZERO {
                return Err(fail("原始用量不得为负数"));
            }
            let key = format!(
                "{}|{}|{}",
                lot["ingredientId"]
                    .as_str()
                    .or(lot["name"].as_str())
                    .unwrap_or(id),
                u,
                source.normalize()
            );
            let left = remaining_sources.entry(key).or_insert(source);
            let already = totals.get(id).copied().unwrap_or_default();
            let available = Decimal::from_str(lot["quantity"].as_str().unwrap()).unwrap() - already;
            n = (*left * factor).round_dp(6).min(available);
            *left = (*left - n / factor).max(Decimal::ZERO);
        }
        let total = totals.entry(id.into()).or_default();
        *total += n;
        if *total > Decimal::from_str(lot["quantity"].as_str().unwrap()).unwrap() {
            return Err(fail("用量超过库存，按库存原单位重算；未入库部分只写文字"));
        }
    }
    Ok(totals
        .into_iter()
        .map(|(k, v)| (k, v.normalize().to_string()))
        .collect())
}
fn describe(
    input: &Value,
    output: &Value,
    quantities: &BTreeMap<String, String>,
) -> (String, Vec<String>) {
    let stock = input["stock"].as_array().unwrap();
    let mut notes = Vec::new();
    if output["consumptions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["usage"] == "estimated")
    {
        notes.extend(
            output["assumptions"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|s| s.as_str().map(str::to_string)),
        );
    }
    let parts = quantities.iter().filter(|(_, q)| q.as_str() != "0").map(|(id, q)| {
        let lot = stock.iter().find(|l| l["id"] == *id).unwrap();
        let name = lot["name"].as_str().unwrap_or("食材");
        let unit = lot["unit"].as_str().unwrap_or("");
        if lot["expiredAtCooking"] == true { notes.push(format!("{name}批次日期早于本次烹饪日期，仅按已经使用的记录记账。")); }
        if let Some(source) = output["consumptions"].as_array().unwrap().iter().find(|r| r["lotId"] == *id && r["sourceUnit"].is_string()) {
            let from = source["sourceUnit"].as_str().unwrap();
            let source_q = source["sourceQuantity"].as_str().unwrap_or("");
            if let (Ok(amount), Some(factor)) = (Decimal::from_str(source_q), db::ingredient_standard::factor(name, from, unit)) {
                let required = (amount * factor).round_dp(6).normalize();
                if from != unit { notes.push(format!("{name}{source_q}{from}按常见单体规格估计约{required}{unit}；以实际大小为准。")); }
                if required > Decimal::from_str(lot["quantity"].as_str().unwrap()).unwrap() { notes.push(format!("{name}记录用量约{required}{unit}，该批次库存仅{}{unit}，本次仅扣{q}{unit}，不足部分未入库。", lot["quantity"].as_str().unwrap())); }
            }
        }
        format!("{name}{q}{unit}")
    }).collect::<Vec<_>>();
    let summary = if parts.is_empty() {
        "未扣减库存，使用情况保留在烹饪记录中。".to_string()
    } else {
        format!("实际扣减：{}。", parts.join("、"))
    };
    for missing in output["untracked"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        notes.push(format!("{missing}未匹配到库存，仅保留文字记录。"));
    }
    (summary, notes)
}
#[tauri::command]
pub async fn kitchen_cooking_interpret(
    app: tauri::AppHandle,
    plan_id: String,
    servings: i64,
    date: String,
    record: String,
) -> Result<Value> {
    if record.trim().is_empty() || record.chars().count() > 4000 {
        return Err(fail("请填写4000字以内的烹饪记录"));
    }
    tauri::async_runtime::spawn_blocking(move||{
        let database=app.state::<Database>();
        for attempt in 0..2 {
        let (input,lineage)={let g=database.0.lock().map_err(|_|fail("数据库暂不可用"))?;let c=g.as_ref().ok_or_else(||fail("数据库暂不可用"))?;(context(c,&plan_id,servings,&date)?,db::sync::status(c)?.replica_id)};
        let mut result=interpret(&input,&record)?;
        let g=database.0.lock().map_err(|_|fail("数据库暂不可用"))?;let c=g.as_ref().ok_or_else(||fail("数据库暂不可用"))?;
        if db::sync::status(c)?.replica_id!=lineage{return Err(fail("厨房已变化，记录未写入"));}
        let current=context(c,&plan_id,servings,&date)?;
        let changed=result["quantities"].as_object().unwrap().keys().any(|id| {
            let before=input["stock"].as_array().unwrap().iter().find(|l|l["id"]==*id).unwrap();
            !current["stock"].as_array().unwrap().iter().any(|l|l["id"]==*id&&l["version"]==before["version"])
        });
        if changed {if attempt==0 {drop(g);continue;}return Err(fail("库存正在变化，文字记录仍保留，稍后可继续"));}
        let mut preview=current["preview"].clone();
        for (id,_) in result["quantities"].as_object().unwrap(){if !preview["rows"].as_array().unwrap().iter().any(|r|r["lots"].as_array().unwrap().iter().any(|l|l["id"]==*id)){
            let lot=current["stock"].as_array().unwrap().iter().find(|l|l["id"]==*id).unwrap();
            preview["rows"].as_array_mut().unwrap().push(json!({"ingredientId":lot["ingredientId"],"name":lot["name"],"unit":lot["unit"],"required":"0","missing":"0","lots":[{"id":id,"version":lot["version"],"available":lot["quantity"],"unit":lot["unit"],"factor":"1","location":lot["location"],"expires":lot["expires"],"review":lot["expiredAtCooking"],"suggested":"0"}]}));
        }}
        result["preview"]=preview;
        return Ok(result);
        }
        Err(fail("整理未完成，文字记录仍保留"))
    }).await.map_err(|_|fail("整理任务未完成，文字记录已保留"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_unit_consumption_is_bounded_and_duplicate_rows_cannot_overdraw() {
        let input = json!({"stock":[{"id":"garlic","quantity":"4"}]});
        let q = validate(
            &input,
            &json!({"consumptions":[{"lotId":"garlic","usage":"estimated","quantity":0.04}]}),
        )
        .unwrap();
        assert_eq!(q["garlic"], "0.04");
        assert!(validate(&input,&json!({"consumptions":[{"lotId":"garlic","usage":"quantity","quantity":"3"},{"lotId":"garlic","usage":"quantity","quantity":"2"}]})).is_err());
    }
    #[test]
    fn all_stock_usage_cannot_fall_back_to_recipe_amount() {
        let input =
            json!({"stock":[{"id":"chives","quantity":"125"},{"id":"eggs","quantity":"3"}]});
        assert!(validate(&input,&json!({"consumptions":[{"lotId":"chives","usage":"all","quantity":"50"},{"lotId":"eggs","usage":"all","quantity":"1.5"}]})).is_err());
        let q=validate(&input,&json!({"consumptions":[{"lotId":"chives","usage":"all","quantity":"125"},{"lotId":"eggs","usage":"all","quantity":"3"}]})).unwrap();
        assert_eq!(q["chives"], "125");
        assert_eq!(q["eggs"], "3");
    }
    #[test]
    fn half_a_piece_is_not_half_the_stock() {
        let input = json!({"stock":[{"id":"pepper","name":"青椒","ingredientId":"pepper","quantity":"2","unit":"个"}]});
        let corrected = validate(&input, &json!({"consumptions":[{"lotId":"pepper","usage":"quantity","sourceQuantity":"0.5","sourceUnit":"个","quantity":"1"}]})).unwrap();
        assert_eq!(corrected["pepper"], "0.5");
        let out = validate(&input, &json!({"consumptions":[{"lotId":"pepper","usage":"quantity","sourceQuantity":"0.5","sourceUnit":"个","quantity":"0.5"}]})).unwrap();
        assert_eq!(out["pepper"], "0.5");
    }
    #[test]
    #[ignore = "configured model with synthetic units and aliases only"]
    fn live_half_counts_and_beef_alias() {
        let input = json!({"recipe":"青椒洋葱炒牛肉","servings":1,"stock":[
            {"id":"onion","name":"洋葱","canonicalName":"洋葱","ingredientId":"onion","quantity":"2","unit":"g","gramsPerUnit":"1","countGramsPerUnit":"200"},
            {"id":"pepper","name":"青椒","canonicalName":"青椒","ingredientId":"pepper","quantity":"2","unit":"个","gramsPerUnit":"120","countGramsPerUnit":"120"},
            {"id":"beef","name":"牛肉","canonicalName":"牛肉","ingredientId":"beef","quantity":"125","unit":"g","gramsPerUnit":"1","countGramsPerUnit":null,"expiredAtCooking":true}
        ]});
        let out = interpret(&input, "洋葱用了半个，青椒用了半个，牛里脊用完。").unwrap();
        assert_eq!(out["quantities"]["onion"], "2");
        assert_eq!(out["quantities"]["pepper"], "0.5");
        assert_eq!(out["quantities"]["beef"], "125");
        println!("synthetic half-count result: {out}");
    }
    #[test]
    #[ignore = "live configured model, synthetic stock only"]
    fn live_explicit_record_overrides_recipe_estimates() {
        let input = json!({"recipe":"韭菜炒蛋","servings":1,"preview":{"rows":[{"name":"韭菜","required":"50","unit":"g"},{"name":"鸡蛋","required":"75","unit":"g"}]},"stock":[{"id":"chives","name":"韭菜","canonicalName":"韭菜","quantity":"125","unit":"g","gramsPerUnit":"1"},{"id":"eggs","name":"鸡蛋","canonicalName":"鸡蛋","quantity":"3","unit":"个","gramsPerUnit":"50"},{"id":"garlic","name":"大蒜","quantity":"4","unit":"个","gramsPerUnit":"50"}]});
        for record in [
            "韭菜和鸡蛋全部用完。",
            "韭菜和鸡蛋全部用完。",
            "韭菜和鸡蛋全部用完。",
            "韭菜全部用完，鸡蛋用了2个，还剩1个。",
            "韭菜用了一半，鸡蛋没用。",
        ] {
            let out = interpret(&input, record).unwrap();
            let q = &out["quantities"];
            if record == "韭菜和鸡蛋全部用完。" {
                assert_eq!(q["chives"], "125");
                assert_eq!(q["eggs"], "3");
            } else if record.contains("2个") {
                assert_eq!(q["chives"], "125");
                assert_eq!(q["eggs"], "2");
            } else {
                assert_eq!(q["chives"], "62.5");
                assert!(q["eggs"].is_null() || q["eggs"] == "0");
            }
            assert!(q["garlic"].is_null() || q["garlic"] == "0");
            println!("record={record}; result={out}");
        }
    }
    #[test]
    #[ignore = "explicit live configured model with synthetic cooking data"]
    fn live_text_cooking_record() {
        let input = json!({"recipe":"意大利肉酱面","servings":1,"stock":[
            {"id":"sauce","name":"意面酱","canonicalName":"意面酱","quantity":"100","unit":"g","gramsPerUnit":"1"},
            {"id":"garlic","name":"大蒜","canonicalName":"大蒜","quantity":"4","unit":"个","gramsPerUnit":"50"},
            {"id":"rosemary","name":"迷迭香","canonicalName":"迷迭香","quantity":"5","unit":"g","gramsPerUnit":"1"}]});
        let out = interpret(&input, "肉酱用完了，大蒜和迷迭香各用了一点点").unwrap();
        println!("synthetic cooking interpretation: {}", out);
        assert_eq!(out["quantities"]["sauce"], "100");
        let garlic = Decimal::from_str(out["quantities"]["garlic"].as_str().unwrap()).unwrap();
        assert!(garlic > Decimal::ZERO && garlic < Decimal::ONE);
    }
}

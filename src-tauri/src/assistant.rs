use crate::db;
use db::{ApiError, Command, Result};
use rusqlite::{backup::Backup, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use uuid::Uuid;

fn fail(code: &str, message: &str) -> ApiError {
    ApiError {
        code: code.into(),
        message: message.into(),
    }
}
pub struct Proposal {
    created: Instant,
    command: Command,
    request: String,
    destructive: bool,
}
#[derive(Default)]
pub struct Proposals(pub Mutex<HashMap<String, Proposal>>);

// Never send binary media or model credentials as conversational context.
fn without_media(v: &mut Value) {
    match v {
        Value::Object(o) => {
            o.remove("media");
            o.remove("image");
            for v in o.values_mut() {
                without_media(v);
            }
        }
        Value::Array(a) => {
            for v in a {
                without_media(v);
            }
        }
        _ => (),
    }
}
pub fn context(conn: &Connection, week: Option<&str>) -> Result<Value> {
    let today = db::shopping::local_today(conn)?;
    let week = match week {
        Some(s) => s.to_string(),
        None => conn.query_row(
            "SELECT date(?1,'-'||((CAST(strftime('%w',?1) AS INTEGER)+6)%7)||' days')",
            [&today],
            |r| r.get(0),
        )?,
    };
    let mut snapshot = db::snapshot(conn)?;
    without_media(&mut snapshot);
    fn compact(v: &mut Value) {
        match v {
            Value::Object(o) => {
                if let Some(steps) = o.remove("steps") {
                    o.insert(
                        "stepCount".into(),
                        json!(steps.as_array().map_or(0, Vec::len)),
                    );
                    o.remove("stepTitles");
                }
                for value in o.values_mut() {
                    compact(value);
                }
            }
            Value::Array(a) => {
                for value in a {
                    compact(value);
                }
            }
            _ => (),
        }
    }
    compact(&mut snapshot);
    Ok(
        json!({"today":today,"weekStart":week,"snapshot":snapshot,"shopping":db::shopping::forecast(conn,&week)?,"toolResults":[]}),
    )
}

// Resolve only an explicit "already bought / cross off" statement against actual pending items.
// Ambiguous names and quantities stay with the model for clarification.
pub fn purchase_intent(local: &Value, messages: &Value) -> Option<Vec<Value>> {
    let input = messages.as_array()?.last()?["content"].as_str()?;
    if input.contains('?')
        || input.contains('？')
        || input.contains("没买")
        || input.contains("还没")
        || input.chars().any(|c| c.is_ascii_digit())
    {
        return None;
    }
    if ![
        "买了",
        "买好了",
        "买齐了",
        "已购买",
        "已经买",
        "购入了",
        "勾掉",
        "勾选",
        "补齐了",
    ]
    .iter()
    .any(|s| input.contains(s))
    {
        return None;
    }
    let mut targets = input.to_string();
    for phrase in [
        "已经买好了",
        "已经买齐了",
        "已经买了",
        "已经买",
        "都买好了",
        "都买齐了",
        "都买了",
        "买好了",
        "买齐了",
        "买了",
        "已购买",
        "购入了",
        "补齐了",
        "帮我勾掉",
        "帮我勾选",
        "帮我",
        "把",
        "请",
        "已经",
        "都",
        "标记为已购买",
        "标记已购买",
    ] {
        targets = targets.replace(phrase, "");
    }
    let targets = targets
        .split(['和', '、', '，', ',', '。', '；', ';', '\n'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    if targets.is_empty() || targets.len() > 12 {
        return None;
    }
    let mut commands = Vec::new();
    let supplies = local["snapshot"]["seasonings"].as_array()?;
    let lines = local["shopping"]["items"].as_array()?;
    let revision = &local["snapshot"]["dataRevision"];
    let alias = |n: &str| match n {
        "蒜" | "大蒜" | "蒜末" => "蒜".to_string(),
        "鸡翅" | "鸡翅中" => "鸡翅".to_string(),
        _ => n.to_string(),
    };
    for target in targets {
        let matches = supplies
            .iter()
            .filter(|s| db::seasonings::canonical(target) == s["name"].as_str().unwrap_or(""))
            .collect::<Vec<_>>();
        if matches.len() == 1 {
            if matches[0]["missing"] == true {
                commands.push(json!({"type":"set_seasoning","name":matches[0]["name"],"missing":false,"expected_revision":revision}));
            }
            continue;
        }
        let matches = lines
            .iter()
            .filter(|l| {
                l["hidden"] != true
                    && l["remaining"].as_str().is_some_and(|n| n != "0")
                    && alias(target) == alias(l["name"].as_str().unwrap_or(""))
            })
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return None;
        }
        let l = matches[0];
        commands.push(json!({"type":"record_purchase","line_id":l["id"],"expected_version":l["version"],"ingredient_id":l["ingredientId"],"unit":l["unit"],"week_start":l["weekStart"],"quantity":l["remaining"]}));
    }
    let mut seen = std::collections::HashSet::new();
    commands.retain(|c| seen.insert(c.to_string()));
    Some(commands)
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Read {
    Recipe {
        id: String,
    },
    History {
        id: String,
    },
    Shopping {
        #[serde(rename = "weekStart")]
        week_start: String,
    },
    Cooking {
        id: String,
        servings: i64,
        date: String,
    },
}
pub fn read(conn: &Connection, value: Value) -> Result<Value> {
    let request: Read =
        serde_json::from_value(value).map_err(|_| fail("INVALID_TOOL", "读取参数不正确"))?;
    let mut out = match request {
        Read::Recipe { id } => db::recipe_history(conn, &id)?
            .as_array()
            .and_then(|v| v.first())
            .cloned()
            .ok_or_else(|| fail("NOT_FOUND", "菜谱不存在"))?,
        Read::History { id } => db::recipe_history(conn, &id)?,
        Read::Shopping { week_start } => db::shopping::forecast(conn, &week_start)?,
        Read::Cooking { id, servings, date } => db::cooking::preview(conn, &id, servings, &date)?,
    };
    without_media(&mut out);
    Ok(out)
}
fn destructive(c: &Command) -> bool {
    matches!(
        c,
        Command::DeleteRecipe { .. }
            | Command::RemoveSeasoning { .. }
            | Command::DeleteNote { .. }
            | Command::RemovePlan { .. }
            | Command::RemoveShopping { .. }
            | Command::HideShopping { .. }
            | Command::RemoveCategory { .. }
    ) || matches!(c,Command::ChangeLot{operation,..} if operation=="discard")
}
fn label(c: &Command) -> &'static str {
    match c {
        Command::RemoveSeasoning { .. } => "移除常备调料",
        Command::RecordPurchase { .. } => "标记已购买",
        Command::SetSeasoning { .. } => "更新调料余缺",
        Command::SavePlan { .. } => "安排或调整菜单",
        Command::RemovePlan { .. } => "移除菜单",
        Command::CreateRecipe { .. } => "创建菜谱",
        Command::ReviseRecipe { .. } => "更新菜谱版本",
        Command::DeleteRecipe { .. } => "删除菜谱",
        Command::ArchiveRecipe { .. } => "归档菜谱",
        Command::RestoreRecipe { .. } => "恢复菜谱",
        Command::Favorite { .. } => "调整收藏",
        Command::Inspiration { .. } => "调整周灵感",
        Command::CreateNote { .. } => "新增手记",
        Command::EditNote { .. } => "编辑手记",
        Command::DeleteNote { .. } => "删除手记",
        Command::ReceiveLot { .. } => "食材入库",
        Command::SetLotExpiry { .. } => "更新批次到期日期",
        Command::ChangeLot { operation, .. } => match operation.as_str() {
            "correct" => "校正库存剩余量",
            "use" => "使用食材",
            "discard" => "丢弃食材",
            "move" => "转移库位",
            _ => "调整库存",
        },
        Command::UndoInventory { .. } | Command::ReverseInventoryEvent { .. } => "撤销库存操作",
        Command::SaveShopping { .. } => "调整采购项目",
        Command::PurchaseShopping { .. } => "购买并入库",
        Command::ReceiveShopping { .. } => "采购收货",
        Command::RemoveShopping { .. } | Command::HideShopping { .. } => "移除采购项目",
        Command::RefreshShopping { .. } => "更新采购需求",
        Command::SaveShoppingMemo { .. } => "保存采购备忘",
        Command::CompleteCooking { .. } => "完成烹饪并记录消耗",
        Command::UndoCooking { .. } => "撤销烹饪",
        _ => "调整分类",
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    id: String,
    operations: Vec<String>,
    changes: Vec<Value>,
    destructive: bool,
    expected_revision: String,
}
fn item_name(snapshot: &Value, id: &Value) -> String {
    for key in ["recipes", "archivedRecipes", "ingredients"] {
        if let Some(rows) = snapshot[key].as_array() {
            if let Some(v) = rows.iter().find(|v| v["id"] == *id) {
                return v["name"].as_str().unwrap_or("").into();
            }
        }
    }
    "未命名项目".into()
}
fn display(v: &Value, snapshot: &Value, section: &str) -> String {
    if v.is_null() {
        return "无".into();
    }
    let s = |key: &str| {
        v[key].as_str().map(str::to_string).unwrap_or_else(|| {
            if v[key].is_null() {
                String::new()
            } else {
                v[key].to_string()
            }
        })
    };
    match section {
        "plans" => format!(
            "{} {} · {} · {}人{}",
            s("day"),
            s("meal"),
            v["recipeSnapshot"]["name"]
                .as_str()
                .or(v["customTitle"].as_str())
                .map(str::to_string)
                .unwrap_or_else(|| item_name(snapshot, &v["recipeId"])),
            s("servings"),
            if v["cooking"].is_object() {
                format!(
                    " · 已完成烹饪 · {} · 心得：{}",
                    v["cooking"]["date"].as_str().unwrap_or(""),
                    v["cooking"]["note"].as_str().unwrap_or("")
                )
            } else {
                String::new()
            }
        ),
        "lots" => format!(
            "{} · {} {} · {} · 购于{} · 到期{}",
            item_name(snapshot, &v["ingredientId"]),
            s("quantity"),
            s("unit"),
            s("location"),
            s("received"),
            v["expires"].as_str().unwrap_or("未记录")
        ),
        "ingredients" => format!("{} · {}", s("name"), s("category")),
        "seasonings" => format!(
            "{} · {}",
            s("name"),
            if v["missing"] == true {
                "缺少，需补购"
            } else {
                "备有"
            }
        ),
        "logs" => format!(
            "{} · {}\n{}",
            item_name(snapshot, &v["recipeId"]),
            s("date"),
            s("note")
        ),
        "recipes" | "archivedRecipes" => {
            let amounts = v["requirements"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|i| {
                            format!(
                                "{}：{} {} {}",
                                if v["ingredientKinds"][item_name(snapshot, &i["ingredientId"])]
                                    .as_bool()
                                    .unwrap_or(false)
                                {
                                    "调料"
                                } else {
                                    "食材"
                                },
                                item_name(snapshot, &i["ingredientId"]),
                                i["quantity"].as_str().unwrap_or(""),
                                i["unit"].as_str().unwrap_or("")
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("；")
                })
                .unwrap_or_default();
            let text = v["textIngredients"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|i| {
                            format!(
                                "{}：{} {}",
                                if v["ingredientKinds"][i["name"].as_str().unwrap_or("")]
                                    .as_bool()
                                    .unwrap_or(false)
                                {
                                    "调料"
                                } else {
                                    "食材"
                                },
                                i["name"].as_str().unwrap_or(""),
                                i["amountText"].as_str().unwrap_or("")
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("；")
                })
                .unwrap_or_default();
            format!(
                "{} · {} · {}分钟 · {}人\n{}\n{}；{}\n调味备注：{}\n{}\n步骤原图：{}张 · 封面：{}\n来源：{}",
                s("name"),
                s("category"),
                s("minutes"),
                s("servings"),
                s("subtitle"),
                amounts,
                text,
                s("seasoning"),
                v["steps"]
                    .as_array()
                    .map(|a| a
                        .iter()
                        .enumerate()
                        .map(|(i, b)| format!("{}. {}\n{}", i + 1, v["stepTitles"][i].as_str().unwrap_or(""),b.as_str().unwrap_or("")))
                        .collect::<Vec<_>>()
                        .join("\n"))
                    .unwrap_or_default(),
                v["media"]["steps"].as_array().map_or(0,Vec::len),
                if v["media"]["cover"].is_string(){"已保存"}else{"无"},
                v["source"]["url"].as_str().unwrap_or("原创或未记录")
            )
        }
        "shopping" => format!(
            "{} · 需求{} {} · 待买{} · {}",
            s("name"),
            s("required"),
            s("unit"),
            s("shortage"),
            s("status")
        ),
        _ => v
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| v.to_string()),
    }
}
fn changes(before: &Value, after: &Value) -> Vec<Value> {
    let mut result = Vec::new();
    for (key, title) in [
        ("recipes", "菜谱"),
        ("archivedRecipes", "归档菜谱"),
        ("plans", "菜单"),
        ("lots", "库存"),
        ("logs", "手记"),
        ("ingredients", "食材分类"),
        ("seasonings", "调料"),
    ] {
        let empty = Vec::new();
        let a = before[key].as_array().unwrap_or(&empty);
        let b = after[key].as_array().unwrap_or(&empty);
        for old in a {
            let new = b
                .iter()
                .find(|v| v["id"] == old["id"])
                .unwrap_or(&Value::Null);
            let x = display(old, before, key);
            let y = display(new, after, key);
            if x != y {
                result.push(json!({"section":title,"before":x,"after":y}));
            }
        }
        for new in b {
            if !a.iter().any(|v| v["id"] == new["id"]) {
                result.push(json!({"section":title,"before":"无","after":display(new,after,key)}));
            }
        }
    }
    for (key, title) in [
        ("favorites", "收藏"),
        ("inspiration", "周灵感"),
        ("recipeCategories", "菜谱分类"),
        ("ingredientCategories", "食材分类"),
        ("memo", "采购备忘"),
    ] {
        if before[key] != after[key] {
            let show = |s: &Value| {
                if ["favorites", "inspiration"].contains(&key) {
                    s[key]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .map(|id| item_name(s, id))
                                .collect::<Vec<_>>()
                                .join("、")
                        })
                        .unwrap_or_default()
                } else {
                    s[key].as_str().map(str::to_string).unwrap_or_else(|| {
                        s[key]
                            .as_array()
                            .map(|a| {
                                a.iter()
                                    .filter_map(Value::as_str)
                                    .collect::<Vec<_>>()
                                    .join("、")
                            })
                            .unwrap_or_default()
                    })
                }
            };
            result.push(json!({"section":title,"before":show(before),"after":show(after)}));
        }
    }
    result
}
pub fn prepare(
    conn: &Connection,
    store: &Proposals,
    raw: Vec<Value>,
    expected: &str,
    week: &str,
) -> Result<Preview> {
    if raw.is_empty() || raw.len() > 50 {
        return Err(fail("INVALID_TOOL", "提案需要1–50项操作"));
    }
    let commands: Vec<Command> = raw
        .into_iter()
        .map(serde_json::from_value)
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| fail("INVALID_TOOL", &format!("助手操作格式不正确：{}", e)))?;
    if commands.iter().any(|c| matches!(c, Command::Batch { .. })) {
        return Err(fail("INVALID_TOOL", "不支持嵌套提案"));
    }
    let before = db::snapshot(conn)?;
    if before["dataRevision"] != expected {
        return Err(fail("STALE_REVISION", "数据已变化，请重新生成提案"));
    }
    let mut sandbox = Connection::open_in_memory()?;
    Backup::new(conn, &mut sandbox)?.run_to_completion(100, Duration::from_millis(0), None)?;
    sandbox.execute_batch("PRAGMA foreign_keys=ON;")?;
    let request = Uuid::new_v4().to_string();
    let command = Command::Batch {
        expected_revision: expected.into(),
        commands: commands.clone(),
    };
    db::execute(&mut sandbox, &request, command.clone())?;
    let after = db::snapshot(&sandbox)?;
    let mut diff = changes(&before, &after);
    let shop_before = db::shopping::forecast(conn, week)?;
    let shop_after = db::shopping::forecast(&sandbox, week)?;
    if shop_before != shop_after {
        diff.push(json!({"section":"采购预测","before":shopping_text(&shop_before),"after":shopping_text(&shop_after)}));
    }
    for c in &commands {
        if let Command::SetLotExpiry { reason, .. } = c {
            diff.push(json!({"section":"日期依据","before":"","after":reason}));
        }
        if let Command::RecordPurchase {
            ingredient_id,
            quantity,
            unit,
            ..
        } = c
        {
            diff.push(json!({"section":"已购买","before":"","after":format!("{} · {} {}",item_name(&before,&json!(ingredient_id)),quantity,unit)}));
        }
    }
    // Include explicit command details for effects with no visible snapshot difference (e.g. category assignment).
    let operations = commands.iter().map(|c| label(c).to_string()).collect();
    let dangerous = commands.iter().any(destructive)
        || commands.iter().any(|c| {
            if let Command::SaveCategories { kind, entries, .. } = c {
                let key = if kind == "recipe" {
                    "recipeCategories"
                } else {
                    "ingredientCategories"
                };
                before[key].as_array().is_some_and(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .any(|name| !entries.iter().any(|e| e.original.as_deref() == Some(name)))
                })
            } else {
                false
            }
        });
    let id = Uuid::new_v4().to_string();
    let mut guard = store
        .0
        .lock()
        .map_err(|_| fail("AI_FAILED", "提案暂不可用"))?;
    guard.retain(|_, p| p.created.elapsed() < Duration::from_secs(1200));
    if guard.len() >= 32 {
        return Err(fail("AI_FAILED", "待确认提案太多，请重新打开应用"));
    }
    guard.insert(
        id.clone(),
        Proposal {
            created: Instant::now(),
            command,
            request,
            destructive: dangerous,
        },
    );
    Ok(Preview {
        id,
        operations,
        changes: diff,
        destructive: dangerous,
        expected_revision: expected.into(),
    })
}
fn shopping_text(v: &Value) -> String {
    let lines = v["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|i| i["hidden"] != true && i["remaining"].as_str().is_some_and(|n| n != "0"))
        .map(|i| {
            format!(
                "{} · 待购 {} {}",
                i["name"].as_str().unwrap_or(""),
                i["remaining"].as_str().unwrap_or(""),
                i["unit"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>();
    if lines.is_empty() {
        "无需额外采购食材".into()
    } else {
        lines.join("\n")
    }
}

pub fn pending(store: &Proposals, id: Option<&str>) -> Value {
    let mut value = id
        .and_then(|id| {
            store
                .0
                .lock()
                .ok()?
                .get(id)
                .filter(|p| p.created.elapsed() < Duration::from_secs(1200))
                .map(|p| serde_json::to_value(&p.command).unwrap_or(Value::Null))
        })
        .unwrap_or(Value::Null);
    without_media(&mut value);
    value
}

pub fn apply(
    conn: &mut Connection,
    store: &Proposals,
    id: &str,
    confirm_delete: bool,
) -> Result<()> {
    let guard = store
        .0
        .lock()
        .map_err(|_| fail("AI_FAILED", "提案暂不可用"))?;
    let p = guard
        .get(id)
        .filter(|p| p.created.elapsed() < Duration::from_secs(1200))
        .ok_or_else(|| fail("PROPOSAL_EXPIRED", "提案已过期或程序已重启，请重新生成"))?;
    if p.destructive && !confirm_delete {
        return Err(fail("CONFIRM_REQUIRED", "此提案含删除或丢弃，请再次确认"));
    }
    db::execute(conn, &p.request, p.command.clone())
}
pub fn original_recipe(conn: &Connection, id: &str) -> Result<Value> {
    db::recipe_history(conn, id)?
        .as_array()
        .and_then(|a| a.first())
        .cloned()
        .ok_or_else(|| fail("NOT_FOUND", "菜谱不存在"))
}
pub fn image_command(conn: &Connection, id: &str, media: Value) -> Result<Value> {
    let recipe = original_recipe(conn, id)?;
    let snapshot = db::snapshot(conn)?;
    let mut images = std::collections::BTreeMap::new();
    for row in recipe["media"]["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(media["steps"].as_array().into_iter().flatten())
    {
        if let Some(i) = row["sourceStep"].as_u64() {
            images.insert(i, row.clone());
        }
    }
    let ingredients = recipe["requirements"].as_array().unwrap().iter().map(|i|json!({"name":item_name(&snapshot,&i["ingredientId"]),"quantity":i["quantity"],"unit":i["unit"]})).collect::<Vec<_>>();
    Ok(
        json!({"type":"revise_recipe","recipe_id":id,"expected_revision_id":recipe["revisionId"],"draft":{
            "ingredientKinds":recipe["ingredientKinds"],"name":recipe["name"],"category":recipe["category"],"minutes":recipe["minutes"],"servings":recipe["servings"],"subtitle":recipe["subtitle"],"seasoning":recipe["seasoning"],"steps":recipe["steps"],"stepTitles":recipe["stepTitles"],"source":recipe["source"],"textIngredients":recipe["textIngredients"],"ingredients":ingredients,
            "media":{"cover":media.get("cover").filter(|v|!v.is_null()).unwrap_or(&recipe["media"]["cover"]),"steps":images.into_values().collect::<Vec<_>>()}
        }}),
    )
}
pub fn shopping_copy(conn: &Connection, week: &str) -> Result<Value> {
    let shopping = db::shopping::forecast(conn, week)?;
    let mut lines = shopping["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["hidden"] != true && i["remaining"].as_str().is_some_and(|s| s != "0"))
        .map(|i| {
            format!(
                "{} {} {}",
                i["name"].as_str().unwrap_or(""),
                i["remaining"].as_str().unwrap_or(""),
                i["unit"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>();
    for s in db::seasonings::supplies(conn)?.as_array().unwrap() {
        if s["missing"] == true {
            lines.push(format!(
                "调料：{}（缺少，需补购）",
                s["name"].as_str().unwrap_or("")
            ));
        }
    }
    Ok(
        json!({"title":format!("{} 本周待购清单",week),"text":if lines.is_empty(){"暂无待买项目".into()}else{lines.join("\n")}}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bought_intent_uses_pending_amounts_and_seasoning_flags_without_touching_stock() {
        let mut conn = seed();
        let store = Proposals::default();
        let create = json!({"type":"create_recipe","draft":{"name":"蒜香鸡翅","category":"家常菜","minutes":30,"servings":2,"subtitle":"","seasoning":"","ingredients":[{"name":"蒜末","quantity":"10","unit":"g"},{"name":"鸡翅中","quantity":"6","unit":"个"}],"steps":["烤熟"]}});
        db::execute(
            &mut conn,
            &Uuid::new_v4().to_string(),
            serde_json::from_value(create).unwrap(),
        )
        .unwrap();
        let s = db::snapshot(&conn).unwrap();
        let today = db::shopping::local_today(&conn).unwrap();
        db::execute(&mut conn,&Uuid::new_v4().to_string(),serde_json::from_value(json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":s["recipes"][1]["revisionId"],"custom_title":null,"day":today,"meal":"晚餐","servings":2}})).unwrap()).unwrap();
        let c = context(&conn, None).unwrap();
        let commands =
            purchase_intent(&c, &json!([{"role":"user","content":"蒜和鸡翅都买了"}])).unwrap();
        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0]["quantity"], "10");
        assert_eq!(commands[1]["quantity"], "6");
        let p = preview(&conn, &store, commands).unwrap();
        apply(&mut conn, &store, &p.id, false).unwrap();
        let after = context(&conn, None).unwrap();
        assert!(after["shopping"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["remaining"] == "0"));
        assert_eq!(db::snapshot(&conn).unwrap()["lots"], s["lots"]);
        let rev = revision(&conn);
        db::execute(
            &mut conn,
            &Uuid::new_v4().to_string(),
            Command::SetSeasoning {
                name: "蜂蜜".into(),
                missing: true,
                expected_revision: rev,
            },
        )
        .unwrap();
        let c = context(&conn, None).unwrap();
        let commands = purchase_intent(
            &c,
            &json!([{"role":"user","content":"醋和蜂蜜。已经买了，帮我勾掉"}]),
        )
        .unwrap();
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0]["name"], "蜂蜜");
        assert_eq!(commands[0]["missing"], false);
        assert!(
            purchase_intent(&c, &json!([{"role":"user","content":"蒜还没买，鸡翅买了"}])).is_none()
        );
        assert!(purchase_intent(&c, &json!([{"role":"user","content":"鸡翅买了12个"}])).is_none());
        assert!(purchase_intent(&c, &json!([{"role":"user","content":"买了豆腐"}])).is_none());
    }
    fn seed() -> Connection {
        let path =
            std::env::temp_dir().join(format!("chefish-assistant-{}.sqlite3", Uuid::new_v4()));
        let mut conn = db::open(&path).unwrap();
        db::execute(&mut conn,&Uuid::new_v4().to_string(),serde_json::from_value(json!({"type":"create_recipe","draft":{"name":"库存测试菜","category":"家常菜","minutes":15,"servings":2,"subtitle":"原简介","seasoning":"","ingredients":[{"name":"鸡蛋","quantity":"2","unit":"个"}],"textIngredients":[],"steps":["炒熟"],"stepTitles":["炒蛋"]}})).unwrap()).unwrap();
        conn
    }
    fn revision(conn: &Connection) -> String {
        db::snapshot(conn).unwrap()["dataRevision"]
            .as_str()
            .unwrap()
            .into()
    }
    fn preview(conn: &Connection, store: &Proposals, commands: Vec<Value>) -> Result<Preview> {
        let c = context(conn, None)?;
        prepare(
            conn,
            store,
            commands,
            &revision(conn),
            c["weekStart"].as_str().unwrap(),
        )
    }
    #[test]
    fn expiry_proposal_exposes_assumptions_and_only_updates_existing_lot_on_confirmation() {
        let mut conn = seed();
        db::execute(&mut conn, &Uuid::new_v4().to_string(), serde_json::from_value(json!({"type":"receive_lot","draft":{"name":"大蒜","category":"未分类","quantity":"5","unit":"个","location":"冷藏","received":"2026-10-22","expires":null,"precision":"rough"}})).unwrap()).unwrap();
        let before = db::snapshot(&conn).unwrap();
        let lot = &before["lots"][0];
        let store = Proposals::default();
        let reason = "估计：完整未剥皮大蒜、冷藏；预计复查日期2026-11-05，非包装有效期";
        let p = preview(&conn, &store, vec![json!({"type":"set_lot_expiry","lot_id":lot["id"],"expected_version":lot["version"],"expires":"2026-11-05","reason":reason})]).unwrap();
        assert!(p
            .changes
            .iter()
            .any(|v| v["section"] == "日期依据" && v["after"] == reason));
        assert_eq!(db::snapshot(&conn).unwrap(), before);
        apply(&mut conn, &store, &p.id, false).unwrap();
        let after = db::snapshot(&conn).unwrap();
        assert_eq!(after["lots"].as_array().unwrap().len(), 1);
        assert_eq!(after["lots"][0]["quantity"], "5");
        assert_eq!(after["lots"][0]["expires"], "2026-11-05");
    }
    #[test]
    fn local_context_and_full_recipe_read_exclude_media_and_expose_real_ids() {
        let conn = seed();
        let c = context(&conn, None).unwrap();
        assert!(c["today"].as_str().unwrap().len() == 10);
        assert!(c["snapshot"]["recipes"][0].get("steps").is_none());
        let id = c["snapshot"]["recipes"][0]["id"].clone();
        let full = read(&conn, json!({"kind":"recipe","id":id})).unwrap();
        assert_eq!(full["steps"][0], "炒熟");
        assert!(full.get("media").is_none());
        assert!(full.get("image").is_none());
        assert!(read(&conn, json!({"kind":"sql","query":"DROP TABLE recipes"})).is_err());
    }
    #[test]
    fn menu_proposal_is_read_only_atomic_and_retry_idempotent() {
        let mut conn = seed();
        let store = Proposals::default();
        let before = db::snapshot(&conn).unwrap();
        let c = context(&conn, None).unwrap();
        let rev = before["recipes"][0]["revisionId"].clone();
        let commands = vec![
            json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":rev,"custom_title":null,"day":c["today"],"meal":"晚餐","servings":2}}),
            json!({"type":"favorite","recipe_id":before["recipes"][0]["id"],"enabled":true}),
        ];
        let p = preview(&conn, &store, commands).unwrap();
        assert_eq!(db::snapshot(&conn).unwrap(), before);
        assert!(p.changes.iter().any(|v| v["section"] == "菜单"));
        apply(&mut conn, &store, &p.id, false).unwrap();
        apply(&mut conn, &store, &p.id, false).unwrap();
        let after = db::snapshot(&conn).unwrap();
        assert_eq!(after["plans"].as_array().unwrap().len(), 1);
        assert_eq!(after["favorites"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn invalid_second_action_and_stale_proposal_do_not_partially_write() {
        let mut conn = seed();
        let store = Proposals::default();
        let before = db::snapshot(&conn).unwrap();
        assert!(preview(
            &conn,
            &store,
            vec![
                json!({"type":"add_category","kind":"recipe","name":"新增分类"}),
                json!({"type":"favorite","recipe_id":"missing","enabled":true})
            ]
        )
        .is_err());
        assert_eq!(db::snapshot(&conn).unwrap(), before);
        let p = preview(
            &conn,
            &store,
            vec![json!({"type":"add_category","kind":"recipe","name":"提案分类"})],
        )
        .unwrap();
        db::execute(
            &mut conn,
            &Uuid::new_v4().to_string(),
            Command::AddCategory {
                kind: "recipe".into(),
                name: "其他操作".into(),
            },
        )
        .unwrap();
        assert_eq!(
            apply(&mut conn, &store, &p.id, false).unwrap_err().code,
            "STALE_REVISION"
        );
        assert!(!db::snapshot(&conn).unwrap()["recipeCategories"]
            .as_array()
            .unwrap()
            .contains(&json!("提案分类")));
    }
    #[test]
    fn deletion_requires_second_confirmation_and_expired_proposals_cannot_execute() {
        let mut conn = seed();
        let store = Proposals::default();
        let id = db::snapshot(&conn).unwrap()["recipes"][0]["id"].clone();
        let p = preview(
            &conn,
            &store,
            vec![json!({"type":"delete_recipe","recipe_id":id})],
        )
        .unwrap();
        assert!(p.destructive);
        assert_eq!(
            apply(&mut conn, &store, &p.id, false).unwrap_err().code,
            "CONFIRM_REQUIRED"
        );
        apply(&mut conn, &store, &p.id, true).unwrap();
        assert!(db::snapshot(&conn).unwrap()["recipes"]
            .as_array()
            .unwrap()
            .is_empty());
        store.0.lock().unwrap().get_mut(&p.id).unwrap().created =
            Instant::now() - Duration::from_secs(1300);
        assert_eq!(
            apply(&mut conn, &store, &p.id, true).unwrap_err().code,
            "PROPOSAL_EXPIRED"
        );
    }
    #[test]
    fn app_operations_inventory_notes_categories_and_shopping_share_validation() {
        let mut conn = seed();
        let store = Proposals::default();
        let c = context(&conn, None).unwrap();
        let id = c["snapshot"]["recipes"][0]["id"].clone();
        let p=preview(&conn,&store,vec![
            json!({"type":"receive_lot","draft":{"name":"鸡蛋","category":"肉禽蛋","quantity":"6","unit":"个","location":"冷藏","received":c["today"],"expires":null,"precision":"exact"}}),
            json!({"type":"create_note","recipe_id":id,"date":c["today"],"note":"下次少放盐"}),
            json!({"type":"save_shopping","line_id":null,"expected_version":null,"draft":{"name":"牛奶","category":"主食调味","quantity":"500","unit":"ml"}}),
            json!({"type":"add_category","kind":"recipe","name":"早餐新分类"}),
            json!({"type":"inspiration","recipe_id":id,"enabled":true})
        ]).unwrap();
        apply(&mut conn, &store, &p.id, false).unwrap();
        let after = db::snapshot(&conn).unwrap();
        assert_eq!(after["lots"].as_array().unwrap().len(), 1);
        assert_eq!(after["logs"][0]["note"], "下次少放盐");
        assert!(
            db::shopping::forecast(&conn, c["weekStart"].as_str().unwrap()).unwrap()["items"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v["name"] == "牛奶")
        );
    }
    #[test]
    fn batch_apply_rolls_back_even_without_preview_and_refuses_nested_batches() {
        let mut conn = seed();
        let before = db::snapshot(&conn).unwrap();
        let revision = revision(&conn);
        let command = Command::Batch {
            expected_revision: revision.clone(),
            commands: vec![
                Command::AddCategory {
                    kind: "recipe".into(),
                    name: "不能留下".into(),
                },
                Command::Favorite {
                    recipe_id: "missing".into(),
                    enabled: true,
                },
            ],
        };
        assert!(db::execute(&mut conn, &Uuid::new_v4().to_string(), command).is_err());
        assert_eq!(before, db::snapshot(&conn).unwrap());
        assert!(preview(
            &conn,
            &Proposals::default(),
            vec![json!({"type":"batch","expected_revision":revision,"commands":[]})]
        )
        .is_err());
    }
    #[test]
    fn cooking_and_undo_use_live_preview_and_keep_stock_exact() {
        let mut conn = seed();
        let store = Proposals::default();
        let c = context(&conn, None).unwrap();
        let p=preview(&conn,&store,vec![json!({"type":"receive_lot","draft":{"name":"鸡蛋","category":"肉禽蛋","quantity":"6","unit":"个","location":"冷藏","received":c["today"],"expires":null,"precision":"exact"}}),json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":c["snapshot"]["recipes"][0]["revisionId"],"custom_title":null,"day":c["today"],"meal":"晚餐","servings":2}})]).unwrap();
        apply(&mut conn, &store, &p.id, false).unwrap();
        let s = db::snapshot(&conn).unwrap();
        let plan = &s["plans"][0];
        let cooking = read(
            &conn,
            json!({"kind":"cooking","id":plan["id"],"servings":2,"date":c["today"]}),
        )
        .unwrap();
        let lot = &s["lots"][0];
        let p=preview(&conn,&store,vec![json!({"type":"complete_cooking","draft":{"plan_id":plan["id"],"expected_version":cooking["planVersion"],"expected_revision":cooking["revision"],"servings":2,"date":c["today"],"note":"火候不错","acknowledged":true,"consumptions":[{"lot_id":lot["id"],"expected_version":lot["version"],"quantity":"2"}]}})]).unwrap();
        assert!(p.changes.iter().any(|v| v["section"] == "库存"));
        apply(&mut conn, &store, &p.id, false).unwrap();
        let s = db::snapshot(&conn).unwrap();
        assert_eq!(s["lots"][0]["quantity"], "4");
        let p=preview(&conn,&store,vec![json!({"type":"undo_cooking","plan_id":s["plans"][0]["id"],"expected_version":s["plans"][0]["version"]})]).unwrap();
        apply(&mut conn, &store, &p.id, false).unwrap();
        assert_eq!(db::snapshot(&conn).unwrap()["lots"][0]["quantity"], "6");
    }
    #[test]
    fn image_only_revision_preserves_recipe_text_and_media_stays_off_model_context() {
        let conn = seed();
        let store = Proposals::default();
        let s = db::snapshot(&conn).unwrap();
        let id = s["recipes"][0]["id"].as_str().unwrap();
        let png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH9sAAAAASUVORK5CYII=";
        let cmd = image_command(
            &conn,
            id,
            json!({"cover":png,"steps":[{"sourceStep":1,"image":png}]}),
        )
        .unwrap();
        assert_eq!(cmd["draft"]["steps"], s["recipes"][0]["steps"]);
        let p = preview(&conn, &store, vec![cmd]).unwrap();
        assert!(p
            .changes
            .iter()
            .any(|v| v["after"].as_str().unwrap_or("").contains("步骤原图：1张")));
        assert!(!pending(&store, Some(&p.id)).to_string().contains("base64"));
    }
}

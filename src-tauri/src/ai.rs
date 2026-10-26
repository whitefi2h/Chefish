use crate::db::{ApiError, Result};
use reqwest::{blocking::Client, redirect::Policy};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io::Read, sync::Mutex, time::Duration};

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());
fn fail(code: &str, message: &str) -> ApiError {
    ApiError {
        code: code.into(),
        message: message.into(),
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub provider: String,
    pub model: String,
    pub timeout: u64,
    pub max_tokens: u32,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: "deepseek".into(),
            model: "deepseek-flash".into(),
            timeout: 90,
            max_tokens: 8192,
        }
    }
}
#[derive(Default, Serialize, Deserialize)]
struct Stored {
    settings: Settings,
    keys: BTreeMap<String, String>,
}
pub fn endpoint(provider: &str) -> Result<&'static str> {
    match provider {
        "deepseek" => Ok("https://api.deepseek.com/chat/completions"),
        "openai" => Ok("https://api.openai.com/v1/chat/completions"),
        "gemini" => Ok("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"),
        _ => Err(fail("INVALID_INPUT", "未知模型服务")),
    }
}
fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new("Chefish.AI", "settings-v1")
        .map_err(|_| fail("CREDENTIAL_ERROR", "无法访问 Windows 凭据管理器"))
}
fn load_unlocked() -> Result<Stored> {
    match entry()?.get_password() {
        Ok(value) => serde_json::from_str(&value)
            .map_err(|_| fail("CREDENTIAL_ERROR", "模型配置无法读取，请重新配置")),
        Err(keyring::Error::NoEntry) => Ok(Stored::default()),
        Err(_) => Err(fail(
            "CREDENTIAL_ERROR",
            "无法读取 Windows 凭据，请稍后重试",
        )),
    }
}
fn load() -> Result<Stored> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| fail("CREDENTIAL_ERROR", "配置暂时不可用"))?;
    load_unlocked()
}
pub fn status() -> Result<Value> {
    let stored = load()?;
    Ok(json!({"settings":stored.settings,"configured":stored.keys.keys().collect::<Vec<_>>()}))
}
pub fn save(settings: Settings, key: Option<String>, remove: bool) -> Result<Value> {
    validate_settings(&settings)?;
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| fail("CREDENTIAL_ERROR", "配置暂时不可用"))?;
    let mut stored = load_unlocked()?;
    if remove {
        stored.keys.remove(&settings.provider);
    }
    if let Some(key) = key.filter(|v| !v.trim().is_empty()) {
        if key.len() > 500 || key.chars().any(char::is_whitespace) {
            return Err(fail("INVALID_INPUT", "密钥格式不正确"));
        }
        stored.keys.insert(settings.provider.clone(), key);
    }
    stored.settings = settings;
    let data =
        serde_json::to_string(&stored).map_err(|_| fail("CREDENTIAL_ERROR", "无法保存配置"))?;
    entry()?
        .set_password(&data)
        .map_err(|_| fail("CREDENTIAL_ERROR", "无法写入 Windows 凭据，配置未保存"))?;
    Ok(json!({"settings":stored.settings,"configured":stored.keys.keys().collect::<Vec<_>>()}))
}
fn validate_settings(s: &Settings) -> Result<()> {
    endpoint(&s.provider)?;
    if s.model.trim().is_empty()
        || s.model.len() > 100
        || s.model.chars().any(char::is_whitespace)
        || !(10..=180).contains(&s.timeout)
        || !(512..=16384).contains(&s.max_tokens)
    {
        return Err(fail(
            "INVALID_INPUT",
            "请检查模型名称、超时（10–180 秒）和输出上限（512–16384）",
        ));
    }
    Ok(())
}
fn client(timeout: u64) -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(timeout))
        .connect_timeout(Duration::from_secs(8))
        .redirect(Policy::none())
        .build()
        .map_err(|_| fail("AI_NETWORK", "无法建立连接"))
}
fn post(client: &Client, url: &str, key: &str, body: &Value) -> Result<Value> {
    let response = client
        .post(url)
        .bearer_auth(key)
        .json(body)
        .send()
        .map_err(|_| fail("AI_NETWORK", "请求失败或超时，原内容已保留，可重试"))?;
    let status = response.status().as_u16();
    if status != 200 {
        return Err(fail(
            if status == 408 || status == 429 || status >= 500 {
                "AI_TRANSIENT"
            } else {
                "AI_HTTP"
            },
            match status {
                401 | 403 => "服务拒绝访问，请检查密钥和服务权限",
                402 => "服务余额不足",
                429 => "请求过于频繁，请稍后重试",
                404 => "服务或模型不可用，请检查模型名称",
                _ => "服务暂时不可用，原内容已保留",
            },
        ));
    }
    let mut bytes = Vec::new();
    response
        .take(2_000_001)
        .read_to_end(&mut bytes)
        .map_err(|_| fail("AI_NETWORK", "响应读取失败"))?;
    if bytes.len() > 2_000_000 {
        return Err(fail("AI_RESPONSE", "服务响应过大"));
    }
    serde_json::from_slice(&bytes).map_err(|_| fail("AI_RESPONSE", "服务未返回有效 JSON"))
}
fn key<'a>(s: &'a Stored, provider: &str) -> Result<&'a str> {
    s.keys.get(provider).map(String::as_str).ok_or_else(|| {
        fail(
            "AI_NOT_CONFIGURED",
            if provider == "deepseek" {
                "请先在模型设置中保存 DeepSeek 密钥；联网检索使用该密钥"
            } else {
                "请先在模型设置中保存当前服务的密钥"
            },
        )
    })
}
pub(crate) fn completion(system: &str, input: Value) -> Result<Value> {
    let stored = load()?;
    validate_settings(&stored.settings)?;
    let body = chat_body(&stored.settings, system, input);
    let client = client(stored.settings.timeout)?;
    let send = || {
        post(
            &client,
            endpoint(&stored.settings.provider)?,
            key(&stored, &stored.settings.provider)?,
            &body,
        )
    };
    let result = match send() {
        Err(e) if ["AI_NETWORK", "AI_TRANSIENT"].contains(&e.code.as_str()) => {
            std::thread::sleep(Duration::from_millis(500));
            send()?
        }
        other => other?,
    };
    decode_completion(result)
}
fn chat_body(s: &Settings, system: &str, input: Value) -> Value {
    let mut body = json!({"model":s.model,"messages":[{"role":"system","content":system},{"role":"user","content":input.to_string()}],"response_format":{"type":"json_object"},"stream":false});
    body[if s.provider == "openai" {
        "max_completion_tokens"
    } else {
        "max_tokens"
    }] = json!(s.max_tokens);
    if s.provider == "deepseek" {
        body["thinking"] = json!({"type":"disabled"});
    }
    body
}
fn decode_completion(v: Value) -> Result<Value> {
    if v["choices"][0]["finish_reason"] == "length" {
        return Err(fail(
            "AI_TRUNCATED",
            "输出达到上限，请提高输出上限或缩短正文后重试",
        ));
    }
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| fail("AI_RESPONSE", "模型返回空内容，请重试"))?;
    serde_json::from_str(content)
        .map_err(|_| fail("AI_RESPONSE", "模型输出格式无效，未保存任何内容"))
}
pub fn test_connection() -> Result<()> {
    let v = completion("Reply in json: {\"ok\":true}", json!({"test":true}))?;
    if v["ok"] != true {
        return Err(fail("AI_RESPONSE", "模型未按约定返回测试结果"));
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Route {
    #[serde(default)]
    pub limit: Option<usize>,
    pub message: String,
    pub action: String,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub candidate_id: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub commands: Vec<Value>,
    #[serde(default)]
    pub read: Option<Value>,
    #[serde(default)]
    pub page: Option<String>,
}
pub fn route(messages: Value, candidates: Value, local: Value) -> Result<Route> {
    if messages.to_string().len() > 20000 || candidates.to_string().len() > 25000 {
        return Err(fail("INVALID_INPUT", "对话过长，请开始新对话"));
    }
    if local.to_string().len() > 250000 {
        return Err(fail(
            "CONTEXT_TOO_LARGE",
            "本地数据过多，请先减少筛选范围或整理历史记录",
        ));
    }
    let result = completion(
        include_str!("assistant_prompt.txt"),
        json!({"messages":messages,"candidates":candidates,"local":local}),
    )?;
    let out: Route = serde_json::from_value(result)
        .map_err(|_| fail("AI_RESPONSE", "助手返回格式不正确，请重试"))?;
    if ![
        "search",
        "import",
        "none",
        "operate",
        "read",
        "navigate",
        "repair_images",
        "ingredient_image",
        "copy_shopping",
    ]
    .contains(&out.action.as_str())
        || out.message.chars().count() > 3000
    {
        return Err(fail("AI_RESPONSE", "助手返回了不支持的操作"));
    }
    Ok(out)
}
pub fn search(query: &str) -> Result<Value> {
    if query.trim().is_empty()
        || query.chars().count() > 80
        || query.contains(':')
        || query.contains('\n')
    {
        return Err(fail("INVALID_INPUT", "请使用不超过 80 字的菜名和偏好检索"));
    }
    // Prefer the site's own search; use the external engine only as an explicit fallback.
    for attempt in 0..3 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(500 * attempt));
        }
        match crate::site_search::search(query) {
            Ok(rows) if !rows.as_array().unwrap().is_empty() => return Ok(rows),
            Err(e) if e.code == "SITE_RATE_LIMIT" => break,
            _ => {}
        }
    }
    let stored = load()?;
    let client = client(stored.settings.timeout.min(30))?;
    let secret = key(&stored, "deepseek")?;
    search_with(
        query,
        |q| {
            post(
                &client,
                "https://api.deepseek.com/v1/tools/search",
                secret,
                &json!({"query":q,"count":10,"need_content":false}),
            )
        },
        |attempt| std::thread::sleep(Duration::from_millis(500 * attempt)),
    )
}
fn search_with(
    mut_query: &str,
    mut request: impl FnMut(&str) -> Result<Value>,
    mut wait: impl FnMut(u64),
) -> Result<Value> {
    let queries = [
        format!("{} site:xiachufang.com", mut_query),
        format!(
            "{} 做法 site:www.xiachufang.com OR site:m.xiachufang.com",
            mut_query
        ),
        format!("下厨房 {} 菜谱", mut_query),
    ];
    for (index, query) in queries.iter().enumerate() {
        if index > 0 {
            wait(index as u64);
        }
        match request(query) {
            Ok(result) => {
                let rows = search_rows(&result)?;
                if !rows.as_array().unwrap().is_empty() {
                    return Ok(rows);
                }
            }
            Err(e) if index < 2 && ["AI_NETWORK", "AI_TRANSIENT"].contains(&e.code.as_str()) => {
                continue
            }
            Err(e) => return Err(e),
        }
    }
    Ok(json!([]))
}

fn search_rows(result: &Value) -> Result<Value> {
    let rows = result["results"]
        .as_array()
        .ok_or_else(|| fail("AI_RESPONSE", "搜索服务未返回有效结果"))?;
    let mut urls = std::collections::HashSet::new();
    let mut candidates = Vec::new();
    for row in rows {
        let Some(raw) = row["url"].as_str() else {
            continue;
        };
        let Ok(url) = crate::recipe_import::canonical_url(raw) else {
            continue;
        };
        if !urls.insert(url.clone()) {
            continue;
        }
        let title = row["title"]
            .as_str()
            .unwrap_or("下厨房菜谱")
            .chars()
            .take(160)
            .collect::<String>();
        let snippet = row["snippet"]
            .as_str()
            .or(row["summary"].as_str())
            .unwrap_or("")
            .chars()
            .take(500)
            .collect::<String>();
        candidates.push(json!({"id":uuid::Uuid::new_v4().to_string(),"url":url,"title":title,"snippet":snippet,"source":"deepseek","rating":label_number(&snippet,"综合评分").or_else(||label_number(&snippet,"评分")),"madeCount":made_count(&snippet),"author":null,"fetchedAt":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()}));
    }
    Ok(json!(candidates))
}
fn label_number(text: &str, label: &str) -> Option<f64> {
    let after = text.split_once(label)?.1.trim_start();
    let token: String = after
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if token.len() > 4 || token.split('.').nth(1).is_some_and(|v| v.len() > 2) {
        return None;
    }
    let n = token.parse::<f64>().ok()?;
    if (0.0..=10.0).contains(&n) {
        Some(n)
    } else {
        None
    }
}
fn made_count(text: &str) -> Option<u64> {
    let before = text.split_once("人做过")?.0.trim_end();
    let token: String = before
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    let prefix = before.strip_suffix(&token)?;
    if prefix.ends_with('.') || prefix.chars().last().is_some_and(|c| c.is_ascii_digit()) {
        return None;
    }
    token.parse().ok()
}
pub fn organize(content: String, url: String, categories: Vec<String>) -> Result<Value> {
    let url = crate::recipe_import::canonical_url(&url)?;
    if content.trim().is_empty()
        || content.chars().count() > 60000
        || categories.len() > 100
        || categories.iter().any(|v| v.chars().count() > 24)
    {
        return Err(fail(
            "INVALID_INPUT",
            "正文为空或过长（最多 60000 字），请保留菜谱正文后重试",
        ));
    }
    let result = completion(
        include_str!("recipe_prompt.txt"),
        json!({"sourceUrl":url,"categories":categories,"untrustedRecipeText":content}),
    )?;
    let mut result = result;
    prefer_source_ingredients(&mut result, &content)?;
    organized_draft(result, url, categories)
}
// A visible ingredients table is authoritative. Step text may repeat quantities
// or use shorthand names, so it must not append another ingredient list.
fn prefer_source_ingredients(result: &mut Value, content: &str) -> Result<()> {
    let input = serde_json::from_str::<Value>(content).unwrap_or(Value::Null);
    let Some(rows) = input["ingredientRows"].as_array().filter(|v| !v.is_empty()) else {
        return Ok(());
    };
    if rows.len() > 100 {
        return Err(fail("INVALID_INPUT", "来源食材超过100项"));
    }
    let Some(draft) = result["draft"].as_object_mut() else {
        return Ok(());
    };
    let mut exact = Vec::new();
    let mut text = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut raw = Vec::new();
    for row in rows {
        let name = row["name"].as_str().unwrap_or("").trim();
        let amount = row["amountText"].as_str().unwrap_or("").trim();
        if name.is_empty()
            || name.chars().count() > 120
            || amount.is_empty()
            || amount.chars().count() > 200
        {
            return Err(fail("INVALID_INPUT", "来源食材格式不正确"));
        }
        if !seen.insert((name.to_string(), amount.to_string())) {
            continue;
        }
        raw.push(format!("{} {}", name, amount));
        let end = amount
            .find(|c: char| !c.is_ascii_digit() && c != '.')
            .unwrap_or(amount.len());
        let (quantity, unit) = amount.split_at(end);
        if !quantity.is_empty() && !unit.trim().is_empty() {
            exact.push(json!({"name":name,"quantity":quantity,"unit":unit.trim()}));
        } else {
            text.push(json!({"name":name,"amountText":amount}));
        }
    }
    draft.insert("ingredients".into(), json!(exact));
    draft.insert("textIngredients".into(), json!(text));
    // All listed seasonings already belong to the one ingredients list.
    if let Some(source) = draft.get_mut("source").and_then(Value::as_object_mut) {
        source.insert("ingredientText".into(), json!(raw));
    }
    Ok(())
}
fn organized_draft(mut result: Value, url: String, categories: Vec<String>) -> Result<Value> {
    // Images come from the source page downloader, never from model-generated data.
    if let Some(draft) = result.get_mut("draft").and_then(Value::as_object_mut) {
        draft.remove("media");
    }
    let quantity_warnings = normalize_ai_ingredients(&mut result)?;
    let mut draft: crate::db::RecipeDraft =
        serde_json::from_value(result.get("draft").cloned().unwrap_or(Value::Null))
            .map_err(|_| fail("AI_RESPONSE", "菜谱整理结果格式不正确，原文已保留"))?;
    if !categories.contains(&draft.category) {
        draft.category = "未分类".into();
    }
    draft.allow_source_duplicate = false;
    for name in draft
        .ingredients
        .iter()
        .map(|i| i.name.trim())
        .chain(draft.text_ingredients.iter().map(|i| i.name.trim()))
    {
        draft
            .ingredient_kinds
            .entry(name.to_string())
            .or_insert_with(|| crate::db::seasonings::common(name));
    }
    let source = draft
        .source
        .as_mut()
        .ok_or_else(|| fail("AI_RESPONSE", "整理结果缺少来源"))?;
    source.url = url;
    crate::db::validate(&draft)?;
    if source_too_long(draft.source.as_ref().unwrap()) {
        return Err(fail("AI_RESPONSE", "整理结果来源信息过长"));
    }
    let mut warnings = result["warnings"]
        .as_array()
        .map(|v| {
            v.iter()
                .filter_map(Value::as_str)
                .map(|v| v.chars().take(300).collect::<String>())
                .take(10)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    warnings.extend(quantity_warnings);
    Ok(json!({"draft":draft,"warnings":warnings}))
}
// Model output is an editable proposal. Preserve unsupported amounts as text rather
// than relaxing the exact-quantity contract used by shopping and inventory.
fn normalize_ai_ingredients(result: &mut Value) -> Result<Vec<String>> {
    use rust_decimal::Decimal;
    use std::str::FromStr;
    let draft = result
        .get_mut("draft")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| fail("AI_RESPONSE", "菜谱整理结果格式不正确，原文已保留"))?;
    let items = draft
        .get("ingredients")
        .and_then(Value::as_array)
        .ok_or_else(|| fail("AI_RESPONSE", "整理结果缺少食材清单，原文已保留"))?
        .clone();
    let mut text = match draft.get("textIngredients") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => items.clone(),
        _ => return Err(fail("AI_RESPONSE", "原文用量格式不正确，原文已保留")),
    };
    if items.len() + text.len() > 100 {
        return Err(fail("AI_RESPONSE", "整理结果食材超过100项，原文已保留"));
    }
    let mut exact = Vec::new();
    let mut warnings = Vec::new();
    for item in items {
        let name = item["name"]
            .as_str()
            .map(str::trim)
            .filter(|n| !n.is_empty() && n.chars().count() <= 120)
            .ok_or_else(|| fail("AI_RESPONSE", "整理结果含无效食材名称，原文已保留"))?;
        let raw_quantity = match &item["quantity"] {
            Value::String(s) => s.trim().to_string(),
            Value::Number(n) => n.to_string(),
            Value::Null => String::new(),
            _ => return Err(fail("AI_RESPONSE", "整理结果用量格式不正确，原文已保留")),
        };
        let unit = item["unit"].as_str().unwrap_or("").trim();
        let (canonical, multiplier) = match unit {
            "g" | "G" | "克" | "公克" => ("g", 1),
            "kg" | "KG" | "千克" | "公斤" => ("g", 1000),
            "ml" | "mL" | "ML" | "毫升" => ("ml", 1),
            "l" | "L" | "升" => ("ml", 1000),
            "个" | "片" | "盒" => (unit, 1),
            _ => ("", 1),
        };
        let number = Decimal::from_str(&raw_quantity)
            .ok()
            .and_then(|n| n.checked_mul(Decimal::from(multiplier)))
            .map(|n| n.normalize())
            .filter(|n| {
                *n > Decimal::ZERO
                    && *n <= Decimal::from(100000)
                    && n.scale() <= 6
                    && !canonical.is_empty()
            });
        if let Some(number) = number {
            let (name, quantity, unit, _) =
                crate::db::ingredient_standard::amount(name, &number.to_string(), canonical)?;
            exact.push(json!({"name":name,"quantity":quantity,"unit":unit}));
        } else {
            let amount = if raw_quantity.is_empty() {
                if unit.is_empty() {
                    "未注明用量".to_string()
                } else {
                    unit.to_string()
                }
            } else {
                format!("{} {}", raw_quantity, unit).trim().to_string()
            };
            if amount.chars().count() > 200 {
                return Err(fail("AI_RESPONSE", "整理结果用量文字过长，原文已保留"));
            }
            if !text.iter().any(|v| {
                v["name"].as_str() == Some(name) && v["amountText"].as_str() == Some(&amount)
            }) {
                if let Ok((name, quantity, unit, _)) =
                    crate::db::ingredient_standard::amount(name, &raw_quantity, unit)
                {
                    if ["g", "ml", "个", "片", "盒"].contains(&unit.as_str())
                        && Decimal::from_str(&quantity).is_ok_and(|n| n > Decimal::ZERO)
                    {
                        exact.push(json!({"name":name,"quantity":quantity,"unit":unit}));
                        continue;
                    }
                }
                text.push(
                    json!({"name":crate::db::ingredient_standard::name(name),"amountText":amount}),
                );
            }
            warnings.push(format!("{}：用量保留原文，采购时由 AI 自动整理。", name));
        }
    }
    let mut seen = std::collections::HashSet::new();
    exact.retain(|v| seen.insert(v.to_string()));
    let mut seen_text = std::collections::HashSet::new();
    text.retain(|v| seen_text.insert(v.to_string()));
    draft.insert("ingredients".into(), json!(exact));
    draft.insert("textIngredients".into(), json!(text));
    Ok(warnings)
}
fn source_too_long(s: &crate::db::RecipeSource) -> bool {
    s.author.chars().count() > 120
        || s.ingredient_text.len() > 100
        || s.ingredient_text.iter().any(|v| v.chars().count() > 200)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_table_overrides_step_duplicates_and_keeps_unsupported_units() {
        let mut result = json!({"draft":{"ingredients":[{"name":"蒜末","quantity":"3","unit":"片"}],
            "textIngredients":[{"name":"生抽","amountText":"一勺"},{"name":"盐","amountText":"少许"}],
            "source":{"ingredientText":[]}}});
        let rows = json!({"ingredientRows":[
            {"name":"瘦肉","amountText":"150克"}, {"name":"青椒","amountText":"3个"},
            {"name":"蒜末","amountText":"3瓣"}, {"name":"味达美生抽","amountText":"2勺"},
            {"name":"味达美蚝油","amountText":"1勺"}, {"name":"料酒","amountText":"1勺"},
            {"name":"生粉","amountText":"2勺"}, {"name":"盐","amountText":"2克"}, {"name":"糖","amountText":"5克"}]});
        prefer_source_ingredients(&mut result, &rows.to_string()).unwrap();
        normalize_ai_ingredients(&mut result).unwrap();
        assert_eq!(result["draft"]["ingredients"].as_array().unwrap().len(), 5);
        assert_eq!(
            result["draft"]["textIngredients"].as_array().unwrap().len(),
            4
        );
        assert_eq!(
            result["draft"]["ingredients"][2],
            json!({"name":"大蒜","quantity":"15","unit":"g"})
        );
        assert!(!result["draft"]["textIngredients"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["name"] == "生抽" || i["name"] == "盐"));
    }
    #[test]
    fn identical_model_rows_are_not_counted_twice_but_distinct_amounts_survive() {
        let mut result = json!({"draft":{"ingredients":[
            {"name":"盐","quantity":"2","unit":"g"}, {"name":"盐","quantity":"2","unit":"克"},
            {"name":"盐","quantity":"1","unit":"g"}],"textIngredients":[
            {"name":"油","amountText":"适量"}, {"name":"油","amountText":"适量"}]}});
        normalize_ai_ingredients(&mut result).unwrap();
        assert_eq!(result["draft"]["ingredients"].as_array().unwrap().len(), 2);
        assert_eq!(
            result["draft"]["textIngredients"].as_array().unwrap().len(),
            1
        );
    }
    #[test]
    fn model_amounts_are_normalized_or_preserved_without_blocking_preview() {
        let result = json!({"draft":{
            "name":"测试菜","category":"家常菜","minutes":20,"servings":2,
            "subtitle":"","seasoning":"","steps":["炒熟"],"stepTitles":["炒熟"],
            "source":{"url":"https://www.xiachufang.com/recipe/1/","author":"作者","ingredientText":["油适量","盐3小勺"]},
            "ingredients":[
                {"name":"肉","quantity":0.5,"unit":"千克"},
                {"name":"水","quantity":"0.2","unit":"L"},
                {"name":"蛋","quantity":"2.0000000","unit":"个"},
                {"name":"盐","quantity":"3","unit":"小勺"},
                {"name":"油","quantity":"适量","unit":"g"},
                {"name":"葱","quantity":"0","unit":"g"},
                {"name":"姜","quantity":"0.1234567","unit":"g"},
                {"name":"糖","quantity":"1/2","unit":"杯"},
                {"name":"醋","quantity":null,"unit":""}
            ]},"warnings":[]});
        let out = organized_draft(
            result,
            "https://www.xiachufang.com/recipe/2/".into(),
            vec!["家常菜".into()],
        )
        .unwrap();
        assert_eq!(out["draft"]["ingredients"][0]["quantity"], "500");
        assert_eq!(out["draft"]["ingredients"][1]["quantity"], "200");
        assert_eq!(out["draft"]["ingredients"][2]["quantity"], "2");
        assert_eq!(out["draft"]["textIngredients"].as_array().unwrap().len(), 6);
        assert_eq!(
            out["draft"]["textIngredients"][3]["amountText"],
            "0.1234567 g"
        );
        assert_eq!(out["draft"]["source"]["ingredientText"][0], "油适量");
        assert_eq!(
            out["draft"]["source"]["url"],
            "https://www.xiachufang.com/recipe/2/"
        );
        assert_eq!(out["warnings"].as_array().unwrap().len(), 6);
    }
    #[test]
    fn malformed_model_ingredients_still_fail_without_discarding_rows() {
        assert!(normalize_ai_ingredients(
            &mut json!({"draft":{"ingredients":[{"name":"","quantity":"1","unit":"g"}]}})
        )
        .is_err());
        assert!(normalize_ai_ingredients(
            &mut json!({"draft":{"ingredients":[{"name":"盐","quantity":{},"unit":"g"}]}})
        )
        .is_err());
    }
    #[test]
    fn search_never_uses_relevance_score_as_recipe_rating_and_rejects_fake_hosts() {
        let out=search_rows(&json!({"results":[{"url":"https://m.xiachufang.com/recipe/123/","title":"菜","snippet":"综合评分 8.9 · 118 人做过","rerank_score":3},{"url":"https://evil.test/recipe/1/"},{"url":"https://www.xiachufang.com/recipe/124/","title":"另一道","snippet":"评分 8.9118 人做过"}]})).unwrap();
        assert_eq!(out.as_array().unwrap().len(), 2);
        assert_eq!(out[0]["rating"], 8.9);
        assert_eq!(out[0]["madeCount"], 118);
        assert!(out[1]["rating"].is_null());
        assert!(out[1]["madeCount"].is_null());
    }
    #[test]
    fn transport_keeps_secrets_out_of_http_errors() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = [0; 4096];
            let _ = stream.read(&mut bytes);
            stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 16\r\nConnection: close\r\n\r\nsecret-echo-test").unwrap();
        });
        let e = post(
            &client(10).unwrap(),
            &format!("http://{}", address),
            "test-key-never-real",
            &json!({}),
        )
        .unwrap_err();
        assert_eq!(e.code, "AI_HTTP");
        assert!(!e.message.contains("secret"));
        server.join().unwrap();
    }
    #[test]
    fn search_retries_empty_and_transient_but_not_authentication_and_preserves_order() {
        let mut calls = Vec::new();
        let mut waits = 0;
        let out=search_with("家常菜",|q|{calls.push(q.to_string());if calls.len()==1 {return Err(fail("AI_TRANSIENT","busy"));}if calls.len()==2{return Ok(json!({"results":[]}));}Ok(json!({"results":[{"url":"https://www.xiachufang.com/recipe/1/","snippet":"评分 7.0"},{"url":"https://www.xiachufang.com/recipe/2/","snippet":"评分 9.0"}]}))},|_|waits+=1).unwrap();
        assert_eq!(calls.len(), 3);
        assert_eq!(waits, 2);
        assert!(calls[0].ends_with("site:xiachufang.com"));
        assert_eq!(out[0]["url"], "https://www.xiachufang.com/recipe/1/");
        let mut calls = 0;
        assert!(search_with(
            "菜",
            |_| {
                calls += 1;
                Err(fail("AI_HTTP", "auth"))
            },
            |_| {}
        )
        .is_err());
        assert_eq!(calls, 1);
    }
    #[test]
    fn chat_history_survives_reopen_and_manual_clear_does_not_touch_recipes() {
        let path =
            std::env::temp_dir().join(format!("chefish-history-{}.sqlite3", uuid::Uuid::new_v4()));
        let conn = crate::db::open(&path).unwrap();
        let h = json!({"messages":[{"role":"user","content":"找烤翅"}],"candidates":[{"id":"stable","url":"https://www.xiachufang.com/recipe/1/"}],"input":"继续","pendingUrl":"","pasted":""});
        save_history(&conn, &h).unwrap();
        drop(conn);
        let conn = crate::db::open(&path).unwrap();
        assert_eq!(history(&conn).unwrap(), h);
        save_history(
            &conn,
            &json!({"messages":[],"candidates":[],"input":"","pendingUrl":"","pasted":""}),
        )
        .unwrap();
        assert_eq!(history(&conn).unwrap()["messages"], json!([]));
        assert!(save_history(&conn, &json!({"messages":"bad","candidates":[]})).is_err());
    }
    #[test]
    fn provider_endpoints_are_fixed_and_settings_bounded() {
        for p in ["deepseek", "openai", "gemini"] {
            assert!(endpoint(p).unwrap().starts_with("https://"));
        }
        assert!(endpoint("http://localhost").is_err());
        let mut s = Settings::default();
        s.timeout = 1;
        assert!(validate_settings(&s).is_err());
    }
    #[test]
    fn responses_reject_truncated_empty_and_non_json() {
        for v in [
            json!({}),
            json!({"choices":[{"finish_reason":"length","message":{"content":"{}"}}]}),
            json!({"choices":[{"message":{"content":"not json"}}]}),
        ] {
            assert!(decode_completion(v).is_err());
        }
        assert_eq!(
            decode_completion(json!({"choices":[{"message":{"content":"{\"ok\":true}"}}]}))
                .unwrap()["ok"],
            true
        );
    }
    #[test]
    fn provider_payloads_use_their_token_parameter() {
        let mut s = Settings::default();
        assert_eq!(
            chat_body(&s, "json", json!({}))["thinking"]["type"],
            "disabled"
        );
        s.provider = "openai".into();
        assert!(chat_body(&s, "json", json!({}))
            .get("max_completion_tokens")
            .is_some());
    }
}

pub fn history(conn: &rusqlite::Connection) -> Result<Value> {
    use rusqlite::OptionalExtension;
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key='assistant_history_v1'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    match value {
        Some(v) => serde_json::from_str(&v)
            .map_err(|_| fail("HISTORY_ERROR", "聊天记录无法读取，请重试或手动清除")),
        None => Ok(json!({"messages":[],"candidates":[],"input":"","pendingUrl":"","pasted":""})),
    }
}
pub fn save_history(conn: &rusqlite::Connection, value: &Value) -> Result<()> {
    let encoded = value.to_string();
    if encoded.len() > 2_000_000
        || !value["messages"].is_array()
        || !value["candidates"].is_array()
        || value["messages"].as_array().unwrap().len() > 1000
        || value["candidates"].as_array().unwrap().len() > 50
    {
        return Err(fail("HISTORY_ERROR", "聊天记录过长，请清除后开始新对话"));
    }
    conn.execute("INSERT INTO app_settings(key,value) VALUES('assistant_history_v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[encoded])?;
    Ok(())
}

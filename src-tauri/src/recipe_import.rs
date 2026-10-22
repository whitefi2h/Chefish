use crate::db::{ApiError, Result};
use reqwest::{blocking::Client, redirect::Policy, Url};
use std::{io::Read, time::Duration};

fn failure(code: &str, message: &str) -> ApiError {
    ApiError {
        code: code.into(),
        message: message.into(),
    }
}
pub fn canonical_url(value: &str) -> Result<String> {
    let u = Url::parse(value.trim())
        .map_err(|_| failure("INVALID_URL", "请粘贴完整的下厨房菜谱链接"))?;
    let parts: Vec<_> = u.path().trim_matches('/').split('/').collect();
    if u.scheme() != "https"
        || ![
            Some("www.xiachufang.com"),
            Some("m.xiachufang.com"),
            Some("xiachufang.com"),
        ]
        .contains(&u.host_str())
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some()
        || parts.len() != 2
        || parts[0] != "recipe"
        || parts[1].is_empty()
        || parts[1].len() > 20
        || !parts[1].bytes().all(|c| c.is_ascii_digit())
    {
        return Err(failure(
            "INVALID_URL",
            "目前支持 https://www.xiachufang.com/recipe/数字编号/ 链接",
        ));
    }
    Ok(format!("https://www.xiachufang.com/recipe/{}/", parts[1]))
}
pub fn fetch(value: &str) -> Result<String> {
    crate::site_access::check()?;
    let url = canonical_url(value)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(8))
        .redirect(Policy::none())
        .user_agent("Chefish/0.1 recipe-import")
        .build()
        .map_err(|_| failure("IMPORT_FAILED", "无法建立网页连接"))?;
    let response = client.get(url).send().map_err(|_| {
        failure(
            "IMPORT_FAILED",
            "网页暂时无法读取，请稍后重试，或导入本地 HTML",
        )
    })?;
    if crate::site_access::is_limited(response.status()) {
        return Err(crate::site_access::rate_limited(
            response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok()),
        ));
    }
    if !response.status().is_success() {
        return Err(failure(
            "SITE_REFUSED",
            "网站未提供菜谱内容，可导入你自行保存的 HTML 文件",
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type.to_ascii_lowercase().contains("text/html") {
        return Err(failure(
            "IMPORT_FAILED",
            "返回内容不是网页，请改用本地 HTML",
        ));
    }
    let mut bytes = Vec::new();
    response
        .take(2_000_001)
        .read_to_end(&mut bytes)
        .map_err(|_| failure("IMPORT_FAILED", "网页读取未完成，请重试"))?;
    if bytes.len() > 2_000_000 {
        return Err(failure("IMPORT_TOO_LARGE", "网页需小于 2 MB"));
    }
    let html = String::from_utf8(bytes).map_err(|_| {
        failure(
            "IMPORT_FAILED",
            "网页不是 UTF-8 编码，请使用 UTF-8 HTML 文件",
        )
    })?;
    validate_document(&html)?;
    Ok(html)
}
fn validate_document(html: &str) -> Result<()> {
    use scraper::{Html, Selector};
    let root = Html::parse_document(html);
    let visible = root
        .select(&Selector::parse("h1.page-title, h1[itemprop=name]").unwrap())
        .next()
        .is_some()
        && root
            .select(&Selector::parse(".ings, .steps").unwrap())
            .next()
            .is_some();
    fn recipe(value: &serde_json::Value) -> bool {
        if value["@type"] == "Recipe" {
            return value.get("recipeIngredient").is_some()
                || value.get("recipeInstructions").is_some();
        }
        if let Some(a) = value.as_array() {
            return a.iter().any(recipe);
        }
        value.get("@graph").is_some_and(recipe)
    }
    let structured = root
        .select(&Selector::parse("script[type='application/ld+json']").unwrap())
        .any(|e| {
            serde_json::from_str::<serde_json::Value>(&e.inner_html())
                .ok()
                .is_some_and(|v| recipe(&v))
        });
    if !visible && !structured {
        return Err(failure(
            "SITE_CONTENT",
            "下厨房返回了异常内容或验证页，未取得菜谱正文；请稍后重试，或提供正常显示的 HTML。",
        ));
    }
    Ok(())
}
#[cfg(test)]
mod response_tests {
    use super::*;
    #[test]
    fn refuses_garbled_or_challenge_responses_before_ai() {
        for html in [
            "访问频率太高，请稍后重试",
            "聼块柿椎馄淹 佩铸扔",
            "<html><h1>请完成验证</h1></html>",
        ] {
            assert_eq!(validate_document(html).unwrap_err().code, "SITE_CONTENT");
        }
        assert!(validate_document(
            "<h1 class='page-title'>菜谱</h1><div class='steps'><li>炒熟</li></div>"
        )
        .is_ok());
        assert!(validate_document(r#"<script type="application/ld+json">{"@type":"Recipe","recipeIngredient":["鸡蛋 4个"]}</script>"#).is_ok());
    }
}
pub fn verify(value: &str) -> Result<serde_json::Value> {
    let url = canonical_url(value)?;
    let html = fetch(&url)?;
    metadata(&html, &url)
}
fn metadata(html: &str, url: &str) -> Result<serde_json::Value> {
    use scraper::{Html, Selector};
    use serde_json::{json, Value};
    let root = Html::parse_document(html);
    fn find_recipe(v: &Value) -> Option<&Value> {
        if let Some(rows) = v.as_array() {
            return rows.iter().find_map(find_recipe);
        }
        let kind = &v["@type"];
        if kind == "Recipe"
            || kind
                .as_array()
                .is_some_and(|a| a.iter().any(|t| t == "Recipe"))
        {
            return Some(v);
        }
        if v.is_object() {
            return v.get("@graph").and_then(find_recipe);
        }
        None
    }
    fn text(root: &Html, selector: &str) -> Option<String> {
        root.select(&Selector::parse(selector).ok()?)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty())
    }
    let mut structured = None;
    for el in root.select(&Selector::parse("script[type='application/ld+json']").unwrap()) {
        if let Ok(v) = serde_json::from_str::<Value>(&el.inner_html()) {
            if let Some(r) = find_recipe(&v) {
                structured = Some(r.clone());
                break;
            }
        }
    }
    let data = structured.unwrap_or(Value::Null);
    let title = data["name"]
        .as_str()
        .map(str::to_string)
        .or_else(|| text(&root, "h1.page-title, h1[itemprop=name]"));
    let title = title
        .filter(|v| v.chars().count() <= 160)
        .ok_or_else(|| failure("VERIFY_UNAVAILABLE", "网页未返回可核验的菜谱正文"))?;
    let author = data["author"]["name"]
        .as_str()
        .or(data["author"].as_str())
        .or(data["author"][0]["name"].as_str())
        .map(str::to_string)
        .or_else(|| text(&root, ".author .name, [itemprop=author] [itemprop=name]"));
    let rating = data["aggregateRating"]["ratingValue"]
        .as_f64()
        .or_else(|| {
            data["aggregateRating"]["ratingValue"]
                .as_str()?
                .parse()
                .ok()
        })
        .or_else(|| text(&root, ".score.number")?.parse().ok())
        .filter(|v| (0.0..=10.0).contains(v));
    // Rating count and cooked-by count describe different facts; never substitute one for the other.
    let rating_count = data["aggregateRating"]["ratingCount"].as_u64().or_else(|| {
        data["aggregateRating"]["ratingCount"]
            .as_str()?
            .parse()
            .ok()
    });
    let made =
        text(&root, ".cooked .number").and_then(|s| s.replace(',', "").trim().parse::<u64>().ok());
    Ok(
        json!({"url":url,"title":title,"author":author,"rating":rating,"madeCount":made,"ratingCount":rating_count,"verifiedAt":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verifies_recipe_fields_without_confusing_rating_and_cooked_counts() {
        let html = r#"<h1 class="page-title">原页菜名</h1><div class="author"><span class="name">作者甲</span></div><script type="application/ld+json">{"@graph":[{"@type":"Recipe","name":"蜜汁烤翅","author":{"name":"作者乙"},"aggregateRating":{"ratingValue":"8.8","ratingCount":"123"}}]}</script><span class="cooked"><b class="number">456</b></span>"#;
        let v = metadata(html, "https://www.xiachufang.com/recipe/1/").unwrap();
        assert_eq!(v["title"], "蜜汁烤翅");
        assert_eq!(v["author"], "作者乙");
        assert_eq!(v["rating"], 8.8);
        assert_eq!(v["ratingCount"], 123);
        assert_eq!(v["madeCount"], 456);
        assert!(metadata("<h1>请验证</h1>", "https://www.xiachufang.com/recipe/1/").is_err());
    }
    #[test]
    fn only_public_recipe_links_are_accepted_and_tracking_is_removed() {
        assert_eq!(
            canonical_url("https://m.xiachufang.com/recipe/12345/?from=share#x").unwrap(),
            "https://www.xiachufang.com/recipe/12345/"
        );
        for u in [
            "http://www.xiachufang.com/recipe/1/",
            "https://127.0.0.1/recipe/1/",
            "file:///a",
            "https://www.xiachufang.com.evil.test/recipe/1/",
            "https://user@www.xiachufang.com/recipe/1/",
            "https://www.xiachufang.com:444/recipe/1/",
            "https://www.xiachufang.com/recipe/no/",
            "https://www.xiachufang.com/recipe/1/other",
        ] {
            assert!(canonical_url(u).is_err(), "{u}");
        }
    }
}

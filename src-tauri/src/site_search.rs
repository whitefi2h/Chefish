use crate::db::{ApiError, Result};
use reqwest::{blocking::Client, redirect::Policy, Url};
use scraper::{Html, Selector};
use serde_json::{json, Value};
use std::{io::Read, time::Duration};

fn fail(message: &str) -> ApiError {
    ApiError {
        code: "SITE_SEARCH".into(),
        message: message.into(),
    }
}
pub fn search(query: &str) -> Result<Value> {
    crate::site_access::check()?;
    let mut url = Url::parse("https://www.xiachufang.com/search/").unwrap();
    url.query_pairs_mut()
        .append_pair("keyword", query)
        .append_pair("cat", "1001");
    let client = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .user_agent("Chefish/0.1 recipe-search")
        .build()
        .map_err(|_| fail("无法建立站内搜索连接"))?;
    let response = client
        .get(url)
        .send()
        .map_err(|_| fail("下厨房站内搜索暂时无法连接"))?;
    if crate::site_access::is_limited(response.status()) {
        return Err(crate::site_access::rate_limited(
            response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok()),
        ));
    }
    if !response.status().is_success() {
        return Err(fail("下厨房暂未提供站内搜索内容"));
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase()
        .contains("text/html")
    {
        return Err(fail("站内搜索返回内容不是网页"));
    }
    let mut bytes = Vec::new();
    response
        .take(2_000_001)
        .read_to_end(&mut bytes)
        .map_err(|_| fail("站内搜索读取未完成"))?;
    if bytes.len() > 2_000_000 {
        return Err(fail("站内搜索页面过大"));
    }
    let html = String::from_utf8(bytes).map_err(|_| fail("站内搜索编码无法识别"))?;
    parse(&html)
}
fn parse(html: &str) -> Result<Value> {
    let root = Html::parse_document(html);
    let select = |s: &str| Selector::parse(s).unwrap();
    if root.select(&select(".search-result-list")).next().is_none() {
        return Err(fail("下厨房搜索页暂不可读取，可能需要在浏览器完成验证"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut rows = Vec::new();
    for card in root.select(&select(".search-result-list .recipe")) {
        let Some(link) = card.select(&select(".name a[href]")).next() else {
            continue;
        };
        let Some(raw) = link.value().attr("href") else {
            continue;
        };
        let Ok(absolute) = Url::parse("https://www.xiachufang.com").unwrap().join(raw) else {
            continue;
        };
        let Ok(url) = crate::recipe_import::canonical_url(absolute.as_str()) else {
            continue;
        };
        if !seen.insert(url.clone()) {
            continue;
        }
        let text = |s: &str| {
            card.select(&select(s)).next().map(|e| {
                e.text()
                    .collect::<String>()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            })
        };
        let title = link
            .text()
            .collect::<String>()
            .trim()
            .chars()
            .take(160)
            .collect::<String>();
        if title.is_empty() {
            continue;
        }
        // On the search page both the rating and the cooked count use class "score".
        let stats = text(".stats").unwrap_or_default();
        let numbers: Vec<String> = card
            .select(&select(".stats .score"))
            .map(|e| e.text().collect::<String>().trim().to_string())
            .collect();
        let rating = if stats.contains("综合评分") {
            numbers
                .first()
                .and_then(|s| s.parse::<f64>().ok())
                .filter(|n| (0.0..=10.0).contains(n))
        } else {
            None
        };
        let made = if stats.contains("做过") {
            numbers
                .last()
                .filter(|_| numbers.len() > 1 || rating.is_none())
                .and_then(|s| s.replace(',', "").parse::<u64>().ok())
        } else {
            None
        };
        rows.push(json!({"id":uuid::Uuid::new_v4().to_string(),"url":url,"title":title,
            "snippet":text(".ing").unwrap_or_default().chars().take(500).collect::<String>(),
            "rating":rating,"madeCount":made,"author":text(".author"),"source":"xiachufang",
            "siteRank":rows.len()+1,"fetchedAt":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()}));
    }
    // This is popularity within the returned first page, not an invented site-wide ranking.
    rows.sort_by(|a, b| b["madeCount"].as_u64().cmp(&a["madeCount"].as_u64()));
    rows.truncate(10);
    Ok(json!(rows))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_cards_preserve_metadata_and_rank_popularity() {
        let out = parse(r#"<a href='/recipe/99/'>unrelated</a><div class='search-result-list'>
          <div class='recipe'><p class='name'><a href='/recipe/1/'>高分</a></p><p class='stats'>综合评分 <span class='score'>9.9</span>（<span class='score'>2</span> 做过）</p><p class='author'>甲</p></div>
          <div class='recipe'><p class='name'><a href='/recipe/2/'>人气</a></p><p class='stats'>综合评分 <span class='score'>8.0</span>（<span class='score'>1,234</span> 做过）</p><p class='author'>乙</p></div>
          <div class='recipe'><p class='name'><a href='https://evil.test/recipe/3/'>恶意</a></p></div>
          <div class='recipe'><p class='name'><a href='/recipe/4/'>未知</a></p></div></div>"#).unwrap();
        assert_eq!(out.as_array().unwrap().len(), 3);
        assert_eq!(out[0]["title"], "人气");
        assert_eq!(out[0]["madeCount"], 1234);
        assert_eq!(out[0]["rating"], 8.0);
        assert_eq!(out[0]["siteRank"], 2);
        assert_eq!(out[2]["madeCount"], Value::Null);
        assert!(parse("<html>验证码</html>").is_err());
    }
    #[test]
    #[ignore = "live public search; run explicitly"]
    fn live_site_search() {
        let result = search("鸡翅").unwrap();
        assert!(!result.as_array().unwrap().is_empty());
        println!("{}", result);
    }
}

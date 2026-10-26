use crate::db::{ApiError, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{blocking::Client, redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{io::Read, time::Duration};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Media {
    pub cover: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_credit: Option<Credit>,
    pub steps: Vec<StepImage>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Credit {
    pub source_url: String,
    pub author: String,
    pub license: String,
    pub license_url: String,
    pub title: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StepImage {
    pub image: String,
    pub source_step: u32,
}
fn fail(message: &str) -> ApiError {
    ApiError {
        code: "IMPORT_IMAGE".into(),
        message: message.into(),
    }
}
fn image_url(raw: &str) -> Result<Url> {
    let value = if raw.starts_with("//") {
        format!("https:{}", raw)
    } else {
        raw.to_owned()
    };
    let mut url = Url::parse(&value).map_err(|_| fail("图片链接无效"))?;
    if url.scheme() != "https"
        || !url.host_str().is_some_and(|h| h.ends_with(".chuimg.com"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(fail("只读取下厨房图片服务器的 HTTPS 图片"));
    }
    url.set_query(Some("imageView2/2/w/900/q/75"));
    url.set_fragment(None);
    Ok(url)
}
fn mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}
fn download(client: &Client, raw: &str) -> Result<String> {
    let response = client
        .get(image_url(raw)?)
        .send()
        .map_err(|_| fail("图片下载失败"))?;
    if !response.status().is_success() {
        return Err(fail("图片服务器暂未提供图片"));
    }
    let mut bytes = Vec::new();
    response
        .take(750_001)
        .read_to_end(&mut bytes)
        .map_err(|_| fail("图片下载未完成"))?;
    if bytes.len() > 750_000 {
        return Err(fail("图片超过750 KB，已跳过"));
    }
    let kind = mime(&bytes).ok_or_else(|| fail("图片格式暂不支持"))?;
    Ok(format!("data:{};base64,{}", kind, STANDARD.encode(bytes)))
}
pub fn validate(media: &Media) -> Result<()> {
    if let Some(credit) = &media.cover_credit {
        crate::ingredient_images::source_url(&credit.source_url)?;
    }
    if media.steps.len() > 50 {
        return Err(fail("步骤原图最多50张"));
    }
    for data in media
        .cover
        .iter()
        .chain(media.steps.iter().map(|s| &s.image))
    {
        if data.len() > 1_000_100 {
            return Err(fail("图片过大"));
        }
        let (header, body) = data.split_once(',').ok_or_else(|| fail("图片内容无效"))?;
        let bytes = STANDARD.decode(body).map_err(|_| fail("图片编码无效"))?;
        if bytes.len() > 750_000
            || !mime(&bytes).is_some_and(|m| header == format!("data:{};base64", m))
        {
            return Err(fail("图片格式无效"));
        }
    }
    if media
        .steps
        .iter()
        .any(|s| s.source_step == 0 || s.source_step > 50)
    {
        return Err(fail("原步骤编号无效"));
    }
    Ok(())
}
pub fn import(content: &str) -> Result<Value> {
    let value: Value = serde_json::from_str(content).unwrap_or(Value::Null);
    let mut sources = value["imageSources"].clone();
    // Older saved assistant drafts already contain Recipe JSON-LD, but not imageSources.
    if sources.is_null() {
        fn recipe(v: &Value) -> Option<&Value> {
            if v["@type"] == "Recipe" {
                return Some(v);
            }
            if let Some(a) = v.as_array() {
                return a.iter().find_map(recipe);
            }
            v.get("@graph").and_then(recipe)
        }
        if let Some(items) = value["structured"].as_array() {
            for item in items {
                if let Some(v) = item
                    .as_str()
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                {
                    if let Some(r) = recipe(&v) {
                        let img = &r["image"];
                        let raw = img
                            .as_str()
                            .or_else(|| img["url"].as_str())
                            .or_else(|| img[0].as_str());
                        if let Some(raw) = raw {
                            sources = json!({"cover":raw,"steps":[]});
                            break;
                        }
                    }
                }
            }
        }
    }
    if sources.is_null() {
        return Ok(json!({"media":null,"warnings":[]}));
    }
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(6))
        .connect_timeout(Duration::from_secs(4))
        .user_agent("Chefish/0.1 recipe-images")
        .build()
        .map_err(|_| fail("无法建立图片连接"))?;
    let mut media = Media::default();
    let mut warnings = Vec::new();
    if let Some(raw) = sources["cover"].as_str() {
        match download(&client, raw) {
            Ok(data) => media.cover = Some(data),
            Err(_) => warnings.push("封面图片暂未下载成功，文字仍可导入".to_string()),
        }
    }
    if let Some(steps) = sources["steps"].as_array() {
        let mut consecutive_failures = 0;
        for step in steps.iter().take(50) {
            let Some(raw) = step["url"].as_str() else {
                continue;
            };
            let Some(index) = step["sourceStep"].as_u64().filter(|i| *i > 0 && *i <= 50) else {
                continue;
            };
            match download(&client, raw) {
                Ok(image) => {
                    consecutive_failures = 0;
                    media.steps.push(StepImage {
                        image,
                        source_step: index as u32,
                    })
                }
                Err(_) => {
                    consecutive_failures += 1;
                    warnings.push(format!("原步骤 {} 图片暂未下载成功", index));
                    if consecutive_failures >= 3 {
                        warnings
                            .push("图片连续下载失败，已暂停后续图片请求，可稍后补充原图。".into());
                        break;
                    }
                }
            }
        }
        if steps.len() > 50 {
            warnings.push("步骤原图较多，本次保存前50张".into());
        }
    }
    validate(&media)?;
    let media = if media.cover.is_none() && media.steps.is_empty() {
        None
    } else {
        Some(media)
    };
    Ok(json!({"media":media,"warnings":warnings}))
}
pub fn sources_from_html(html: &str) -> Value {
    use scraper::{Html, Selector};
    fn image(value: &Value) -> Option<&str> {
        value
            .as_str()
            .or_else(|| value.get("url").and_then(Value::as_str))
            .or_else(|| value.get(0).and_then(image))
    }
    fn recipe(v: &Value) -> Option<&Value> {
        if v["@type"] == "Recipe"
            || v["@type"]
                .as_array()
                .is_some_and(|a| a.iter().any(|x| x == "Recipe"))
        {
            return Some(v);
        }
        if let Some(a) = v.as_array() {
            return a.iter().find_map(recipe);
        }
        v.get("@graph").and_then(recipe)
    }
    let root = Html::parse_document(html);
    let selector = |s: &str| Selector::parse(s).unwrap();
    let mut cover = None;
    for script in root.select(&selector("script[type='application/ld+json']")) {
        if let Ok(value) = serde_json::from_str::<Value>(&script.inner_html()) {
            if let Some(raw) = recipe(&value).and_then(|r| image(&r["image"])) {
                cover = Some(raw.to_string());
                break;
            }
        }
    }
    let image_attr = |e: scraper::ElementRef| {
        e.value()
            .attr("data-src")
            .or_else(|| e.value().attr("data-original"))
            .or_else(|| e.value().attr("data-lazy-src"))
            .or_else(|| e.value().attr("src"))
            .map(str::to_string)
    };
    if cover.is_none() {
        cover = root
            .select(&selector(".recipe-cover img"))
            .next()
            .and_then(image_attr);
    }
    let mut steps = Vec::new();
    for (index, step) in root.select(&selector(".steps li")).enumerate().take(50) {
        if let Some(raw) = step.select(&selector("img")).next().and_then(image_attr) {
            if !raw.starts_with("data:") {
                steps.push(json!({"url":raw,"sourceStep":index+1}));
            }
        }
    }
    json!({"cover":cover,"steps":steps})
}
pub fn from_recipe(url: &str) -> Result<Value> {
    let html = crate::recipe_import::fetch(url)?;
    let sources = sources_from_html(&html);
    import(&json!({"imageSources":sources}).to_string())
}
pub fn import_with_source(content: &str, url: Option<&str>) -> Result<Value> {
    let value: Value = serde_json::from_str(content).unwrap_or(Value::Null);
    if value.get("imageSources").is_none() {
        if let Some(url) = url {
            match from_recipe(url) {
                Ok(value) if !value["media"].is_null() => return Ok(value),
                Err(e) => {
                    let mut result = import(content)?;
                    result["warnings"]
                        .as_array_mut()
                        .unwrap()
                        .push(json!(format!("步骤原图暂未补齐：{}", e.message)));
                    return Ok(result);
                }
                _ => {}
            }
        }
    }
    import(content)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_all_original_steps_from_fresh_html_including_lazy_images() {
        let mut html = String::from(
            r#"<script type="application/ld+json">{"@type":"Recipe","image":"https://i2.chuimg.com/cover.jpg"}</script><div class="steps">"#,
        );
        for n in 1..=14 {
            html.push_str(&format!("<li><p>步骤 {}</p><img data-original='https://i2.chuimg.com/{}.jpg' src='data:image/png;base64,AAAA'></li>",n,n));
        }
        html.push_str("</div><img src='https://evil.test/unrelated'>");
        let result = sources_from_html(&html);
        assert_eq!(result["steps"].as_array().unwrap().len(), 14);
        assert_eq!(result["steps"][13]["sourceStep"], 14);
        assert_eq!(result["steps"][13]["url"], "https://i2.chuimg.com/14.jpg");
    }
    #[test]
    fn image_hosts_and_binary_formats_are_restricted() {
        assert!(image_url("https://i2.chuimg.com/test.jpg").is_ok());
        for url in [
            "http://i2.chuimg.com/a.jpg",
            "https://i2.chuimg.com.evil.test/a.jpg",
            "https://localhost/a.jpg",
            "https://user@i2.chuimg.com/a.jpg",
        ] {
            assert!(image_url(url).is_err());
        }
        assert!(validate(&Media {
            cover_credit: None,
            cover: Some("data:image/svg+xml;base64,PHN2Zz4=".into()),
            steps: vec![]
        })
        .is_err());
        assert!(validate(&Media {
            cover_credit: None,
            cover: Some(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(b"\x89PNG\r\n\x1a\n")
            )),
            steps: vec![]
        })
        .is_ok());
    }
    #[test]
    #[ignore = "live public image download; run explicitly"]
    fn live_cover_download() {
        let value=import(&json!({"imageSources":{"cover":"https://i2.chuimg.com/36ce5c0bc6c0454caec5ce2cdb52fb90_1280w_1024h.jpg","steps":[]}}).to_string()).unwrap();
        assert!(value["media"]["cover"]
            .as_str()
            .is_some_and(|s| s.starts_with("data:image/")));
        println!(
            "downloaded cover bytes (encoded): {}",
            value["media"]["cover"].as_str().unwrap().len()
        );
    }
}

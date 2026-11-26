use crate::db::{ApiError, Result};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
static RETRY_AT: Mutex<Option<Instant>> = Mutex::new(None);
fn limited(seconds: u64) -> ApiError {
    ApiError {
        code: "SITE_RATE_LIMIT".into(),
        message: format!(
            "下厨房限制了访问频率，请约 {} 秒后重试；也可导入浏览器中正常显示的 HTML。",
            seconds
        ),
    }
}
pub fn check() -> Result<()> {
    if let Ok(guard) = RETRY_AT.lock() {
        if let Some(at) = *guard {
            if at > Instant::now() {
                return Err(limited(
                    at.saturating_duration_since(Instant::now()).as_secs() + 1,
                ));
            }
        }
    }
    Ok(())
}
pub fn rate_limited(retry_after: Option<&str>) -> ApiError {
    let seconds = retry_after
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(60)
        .clamp(30, 300);
    if let Ok(mut guard) = RETRY_AT.lock() {
        *guard = Some(Instant::now() + Duration::from_secs(seconds));
    }
    limited(seconds)
}
pub fn is_limited(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinguishes_rate_limits() {
        assert!(is_limited(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(!is_limited(reqwest::StatusCode::FORBIDDEN));
        assert!(!is_limited(reqwest::StatusCode::OK));
    }
    #[test]
    fn pauses_requests_after_server_rate_limit() {
        assert_eq!(rate_limited(Some("30")).code, "SITE_RATE_LIMIT");
        assert_eq!(check().unwrap_err().code, "SITE_RATE_LIMIT");
        *RETRY_AT.lock().unwrap() = None;
        assert!(check().is_ok());
    }
}

pub fn verification_required() -> ApiError {
    ApiError {code:"SITE_VERIFICATION".into(),message:"下厨房需要在站内窗口完成验证后继续读取".into()}
}

pub fn is_verification_url(url: &reqwest::Url) -> bool {
    url.path().trim_end_matches('/') == "/auth/humancheck_captcha"
}

pub fn is_verification_document(root: &scraper::Html) -> bool {
    let selector = scraper::Selector::parse("title, h1, h2, p, div, span").unwrap();
    root.select(&selector).any(|element| {
        !element.children().any(|node| node.value().is_element())
            && matches!(
                element.text().collect::<String>().trim(),
                "请滑动完成验证" | "滑动验证"
            )
    })
}

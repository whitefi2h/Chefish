use crate::db::{ApiError, Result};
use reqwest::Url;
use serde_json::{json, Value};
use tauri::Manager;
const LABEL: &str = "xiachufang-reader";
fn error(message: &str) -> ApiError {
    ApiError {
        code: "SITE_BROWSER".into(),
        message: message.into(),
    }
}
fn allowed(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && [
            Some("www.xiachufang.com"),
            Some("m.xiachufang.com"),
            Some("xiachufang.com"),
            Some("hanwuji.xiachufang.com"),
        ]
        .contains(&url.host_str())
}
fn target(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| error("下厨房链接无效"))?;
    if !allowed(&url) {
        return Err(error("仅支持下厨房站内页面"));
    }
    if url.path() == "/search/"
        && url
            .query_pairs()
            .any(|(k, v)| k == "keyword" && !v.trim().is_empty() && v.chars().count() <= 80)
    {
        return Ok(url);
    }
    Url::parse(&crate::recipe_import::canonical_url(raw)?).map_err(|_| error("菜谱链接无效"))
}
fn same_page(expected: &Url, actual: &Url) -> bool {
    if !allowed(actual) {
        return false;
    }
    if expected.path() == "/search/" {
        actual.path() == "/search/"
            && expected.query_pairs().find(|(k, _)| k == "keyword")
                == actual.query_pairs().find(|(k, _)| k == "keyword")
    } else {
        crate::recipe_import::canonical_url(actual.as_str())
            .ok()
            .as_deref()
            == Some(expected.as_str())
    }
}
fn main_only(window: &tauri::WebviewWindow) -> Result<()> {
    if window.label() != "main" {
        return Err(error("该操作只能从厨房主窗口发起"));
    }
    Ok(())
}
#[tauri::command]
pub async fn kitchen_site_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    url: String,
) -> Result<()> {
    main_only(&window)?;
    let url = target(&url)?;
    if let Some(browser) = app.get_webview_window(LABEL) {
        browser
            .navigate(url)
            .map_err(|_| error("无法打开站内页面"))?;
        browser.show().map_err(|_| error("无法显示站内窗口"))?;
        let _ = browser.set_focus();
        return Ok(());
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| error("无法定位站内会话目录"))?
        .join("xiachufang-session");
    std::fs::create_dir_all(&directory).map_err(|_| error("无法保存站内会话"))?;
    tauri::WebviewWindowBuilder::new(&app, LABEL, tauri::WebviewUrl::External(url))
        .title("下厨房 · 完成验证后返回 Chefish 继续")
        .inner_size(1080.0, 800.0)
        .data_directory(directory)
        .on_navigation(allowed)
        .build()
        .map_err(|_| error("无法打开下厨房窗口"))?;
    Ok(())
}
async fn capture(browser: &tauri::WebviewWindow) -> Result<Value> {
    let (send, recv) = std::sync::mpsc::sync_channel(1);
    browser.eval_with_callback("(()=>({url:location.href,html:document.documentElement.outerHTML.slice(0,2000001)}))()",move |result|{let _=send.try_send(result);})
        .map_err(|_|error("页面暂未准备好，请稍后继续"))?;
    let raw = tauri::async_runtime::spawn_blocking(move || {
        recv.recv_timeout(std::time::Duration::from_secs(10))
    })
    .await
    .map_err(|_| error("页面读取中断"))?
    .map_err(|_| error("页面读取超时，请重试"))?;
    serde_json::from_str(&raw).map_err(|_| error("页面暂未准备好"))
}
#[tauri::command]
pub async fn kitchen_site_read(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    url: String,
    mode: String,
) -> Result<Value> {
    main_only(&window)?;
    let expected = target(&url)?;
    if !["recipe", "verify", "search"].contains(&mode.as_str()) {
        return Err(error("读取方式无效"));
    }
    let browser = app
        .get_webview_window(LABEL)
        .ok_or_else(|| error("下厨房窗口已关闭，请重新打开"))?;
    let data = capture(&browser).await?;
    let actual =
        Url::parse(data["url"].as_str().unwrap_or("")).map_err(|_| error("页面地址无效"))?;
    if !same_page(&expected, &actual) {
        return Err(error(
            "请在下厨房窗口完成验证，并返回原来的菜谱或搜索页后继续",
        ));
    }
    let html = data["html"]
        .as_str()
        .ok_or_else(|| error("页面正文未准备好"))?;
    if html.len() > 2_000_000 {
        return Err(error("网页需小于2MB"));
    }
    let result = if mode == "search" && expected.path() == "/search/" {
        crate::site_search::parse(html)?
    } else if mode != "search" && expected.path() != "/search/" {
        crate::recipe_import::validate_document(html)?;
        if mode == "verify" {
            crate::recipe_import::metadata(html, expected.as_str())?
        } else {
            json!(html)
        }
    } else {
        return Err(error("页面与读取方式不匹配"));
    };
    let _ = browser.hide();
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reader_is_restricted_to_the_requested_public_page() {
        let recipe = target("https://www.xiachufang.com/recipe/107076587/").unwrap();
        assert!(same_page(
            &recipe,
            &Url::parse("https://m.xiachufang.com/recipe/107076587/?from=share").unwrap()
        ));
        for url in [
            "https://evil.test/recipe/107076587/",
            "https://www.xiachufang.com/recipe/107431912/",
            "https://www.xiachufang.com/auth/humancheck_captcha/",
        ] {
            assert!(!same_page(&recipe, &Url::parse(url).unwrap()));
        }
        for url in [
            "http://www.xiachufang.com/recipe/1/",
            "https://evil.xiachufang.com/recipe/1/",
            "https://user@www.xiachufang.com/recipe/1/",
            "https://www.xiachufang.com:444/recipe/1/",
        ] {
            assert!(target(url).is_err());
        }
        let search = target("https://www.xiachufang.com/search/?keyword=鸡蛋&cat=1001").unwrap();
        assert!(!same_page(
            &search,
            &target("https://www.xiachufang.com/search/?keyword=牛肉&cat=1001").unwrap()
        ));
    }
    #[test]
    #[ignore = "requires installed Windows WebView2; isolated native smoke"]
    fn native_dom_capture_and_remote_ipc_isolation() {
        use std::{
            io::{Read, Write},
            sync::{
                atomic::{AtomicBool, Ordering},
                Arc,
            },
        };
        static CALLED: AtomicBool = AtomicBool::new(false);
        #[tauri::command]
        fn probe_sensitive() {
            CALLED.store(true, Ordering::SeqCst);
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let stopped = Arc::new(AtomicBool::new(false));
        let stop = stopped.clone();
        let server = std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                if let Ok((mut stream, _)) = listener.accept() {
                    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
                    let mut buf = [0; 4096];
                    let _ = stream.read(&mut buf);
                    let body = r#"<html><body><h1 class='page-title'>原生读取测试</h1><div class='steps'>炒熟</div><script>window.__TAURI_INTERNALS__.invoke('probe_sensitive').then(()=>document.body.dataset.acl='allowed').catch(()=>document.body.dataset.acl='blocked');</script></body></html>"#;
                    let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
            }
        });
        let mut context = tauri::generate_context!();
        context.config_mut().identifier = format!("com.chefish.site-test.{}", uuid::Uuid::new_v4());
        context.config_mut().app.windows.clear();
        let (send, recv) = std::sync::mpsc::sync_channel(1);
        let exit = tauri::Builder::default()
            .any_thread()
            .invoke_handler(tauri::generate_handler![probe_sensitive])
            .setup(move |app| {
                let window = tauri::WebviewWindowBuilder::new(
                    app,
                    "isolated-remote",
                    tauri::WebviewUrl::External(url.parse().unwrap()),
                )
                .visible(false)
                .build()?;
                let handle = app.handle().clone();
                let deadline = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(20));
                    deadline.exit(1);
                });
                tauri::async_runtime::spawn(async move {
                    for _ in 0..40 {
                        if let Ok(data) = capture(&window).await {
                            if data["html"]
                                .as_str()
                                .is_some_and(|h| h.contains("data-acl=\"blocked\""))
                            {
                                let _ = send.try_send(data);
                                handle.exit(0);
                                return;
                            }
                        }
                        tauri::async_runtime::spawn_blocking(|| {
                            std::thread::sleep(std::time::Duration::from_millis(200))
                        })
                        .await
                        .unwrap();
                    }
                    handle.exit(1);
                });
                Ok(())
            })
            .build(context)
            .unwrap()
            .run_return(|_, _| {});
        assert_eq!(exit, 0);
        stopped.store(true, Ordering::SeqCst);
        server.join().unwrap();
        let data = recv
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("native capture or remote ACL failed");
        assert!(data["html"].as_str().unwrap().contains("原生读取测试"));
        assert!(!CALLED.load(Ordering::SeqCst));
    }
}

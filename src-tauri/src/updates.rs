use serde::{Deserialize, Serialize};
use std::time::Duration;

const PROJECT: &str = "https://github.com/whitefi2h/Chefish";

#[derive(Deserialize)]
struct Asset {
    name: String,
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    body: Option<String>,
    assets: Vec<Asset>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    version: String,
    notes: String,
    can_install: bool,
}

#[tauri::command]
pub async fn app_latest_release() -> Result<Option<LatestRelease>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let release: Release = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("Chefish/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| "无法准备版本检查")?
            .get("https://api.github.com/repos/whitefi2h/Chefish/releases/latest")
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|_| "暂时无法连接 GitHub，请稍后重试或打开版本发布页")?
            .json()
            .map_err(|_| "无法读取版本信息")?;
        let version = release.tag_name.trim_start_matches('v');
        let latest = semver::Version::parse(version).map_err(|_| "发布版本号无效")?;
        let current = semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
        Ok((latest > current).then(|| LatestRelease {
            version: version.to_owned(),
            notes: release.body.unwrap_or_default(),
            can_install: release.assets.iter().any(|a| a.name == "latest.json"),
        }))
    })
    .await
    .map_err(|_| "版本检查未完成")?
}

#[tauri::command]
pub fn app_open_project(releases: bool) -> Result<(), String> {
    open::that(if releases {
        format!("{PROJECT}/releases")
    } else {
        PROJECT.into()
    })
    .map_err(|_| "无法打开浏览器，请访问 github.com/whitefi2h/Chefish".to_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "opt-in public GitHub connectivity check; does not open a kitchen or install anything"]
    fn public_github_release_check() {
        tauri::async_runtime::block_on(super::app_latest_release()).unwrap();
    }
}

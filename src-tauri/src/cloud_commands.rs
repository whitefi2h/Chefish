use crate::{
    backup,
    cloud_snapshot::{self, IncomingSnapshot, Manifest, PreparedSnapshot},
    db::{ApiError, Result},
    Database, RestorePreview,
};
use std::sync::Mutex;
use tauri::{Manager, State};

#[derive(Default)]
pub struct Transfers {
    upload: Mutex<Option<PreparedSnapshot>>,
    download: Mutex<Option<IncomingSnapshot>>,
}
fn fail() -> ApiError {
    ApiError {
        code: "CLOUD_TRANSFER".into(),
        message: "云备份任务已失效，请重试".into(),
    }
}
fn cache(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    app.path().app_cache_dir().map_err(|_| fail())
}

#[tauri::command]
pub async fn cloud_backup_prepare(app: tauri::AppHandle) -> Result<Manifest> {
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        let transfers = app.state::<Transfers>();
        let mut slot = transfers.upload.lock().map_err(|_| fail())?;
        let guard = database.0.lock().map_err(|_| fail())?;
        let conn = guard.as_ref().ok_or_else(fail)?;
        let prepared = cloud_snapshot::prepare(conn, &cache(&app)?)?;
        let manifest = prepared.manifest.clone();
        *slot = Some(prepared);
        Ok(manifest)
    })
    .await
    .map_err(|_| fail())?
}
#[tauri::command]
pub fn cloud_backup_read_chunk(
    transfers: State<Transfers>,
    token: String,
    index: usize,
) -> Result<String> {
    let slot = transfers.upload.lock().map_err(|_| fail())?;
    slot.as_ref()
        .filter(|s| s.manifest.id == token)
        .ok_or_else(fail)?
        .read_chunk(index)
}
#[tauri::command]
pub fn cloud_backup_begin_download(
    app: tauri::AppHandle,
    transfers: State<Transfers>,
    manifest: Manifest,
) -> Result<String> {
    let incoming = IncomingSnapshot::new(manifest, &cache(&app)?)?;
    let token = incoming.token.clone();
    *transfers.download.lock().map_err(|_| fail())? = Some(incoming);
    Ok(token)
}
#[tauri::command]
pub fn cloud_backup_accept_chunk(
    transfers: State<Transfers>,
    token: String,
    index: usize,
    data: String,
) -> Result<()> {
    let mut slot = transfers.download.lock().map_err(|_| fail())?;
    slot.as_mut()
        .filter(|s| s.token == token)
        .ok_or_else(fail)?
        .accept_chunk(index, &data)
}
#[tauri::command]
pub async fn cloud_backup_finish_download(
    app: tauri::AppHandle,
    token: String,
) -> Result<backup::Preview> {
    tauri::async_runtime::spawn_blocking(move || {
        let transfers = app.state::<Transfers>();
        let restore = app.state::<RestorePreview>();
        let incoming = {
            let mut slot = transfers.download.lock().map_err(|_| fail())?;
            if !slot.as_ref().is_some_and(|s| s.token == token) {
                return Err(fail());
            }
            slot.take().ok_or_else(fail)?
        };
        let root = app.path().app_data_dir().map_err(|_| fail())?;
        let staged = incoming.finish(&root)?;
        let preview = staged.preview.clone();
        let mut slot = restore.0.lock().map_err(|_| fail())?;
        if let Some(previous) = slot.replace(staged) {
            let _ = std::fs::remove_file(previous.path);
        }
        Ok(preview)
    })
    .await
    .map_err(|_| fail())?
}
#[tauri::command]
pub fn cloud_backup_release(transfers: State<Transfers>, token: String) -> Result<()> {
    let mut upload = transfers.upload.lock().map_err(|_| fail())?;
    if upload.as_ref().is_some_and(|s| s.manifest.id == token) {
        upload.take();
    }
    let mut download = transfers.download.lock().map_err(|_| fail())?;
    if download.as_ref().is_some_and(|s| s.token == token) {
        download.take();
    }
    Ok(())
}

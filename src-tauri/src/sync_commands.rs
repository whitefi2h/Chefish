use crate::{
    assistant,
    db::{replication, ApiError, Result},
    sync_transfer, Database, RestorePreview,
};
use std::sync::Mutex;
use tauri::{Manager, State};
#[derive(Default)]
pub struct Transfers(pub Mutex<sync_transfer::Transfers>);
fn fail() -> ApiError {
    ApiError {
        code: "SYNC_STATE".into(),
        message: "同步暂不可用，请重试".into(),
    }
}
#[tauri::command]
pub fn sync_state(database: State<Database>) -> Result<replication::State> {
    let g = database.0.lock().map_err(|_| fail())?;
    replication::state(g.as_ref().ok_or_else(fail)?)
}
#[tauri::command]
pub fn sync_pause(database: State<Database>, uid: String, enabled: bool) -> Result<()> {
    let g = database.0.lock().map_err(|_| fail())?;
    replication::pause(g.as_ref().ok_or_else(fail)?, &uid, enabled)
}
#[tauri::command]
pub async fn sync_prepare_baseline(
    app: tauri::AppHandle,
    uid: String,
    email: String,
    transfer_owner: bool,
) -> Result<sync_transfer::Baseline> {
    tauri::async_runtime::spawn_blocking(move || {
        let transfers = app.state::<Transfers>();
        let database = app.state::<Database>();
        let mut transfers = transfers.0.lock().map_err(|_| fail())?;
        let g = database.0.lock().map_err(|_| fail())?;
        let conn = g.as_ref().ok_or_else(fail)?;
        if transfer_owner {
            sync_transfer::safety(
                conn,
                &app.path().app_data_dir().map_err(|_| fail())?,
                "before-account-copy",
            )?;
        }
        transfers.prepare_baseline(
            conn,
            &app.path().app_cache_dir().map_err(|_| fail())?,
            &uid,
            &email,
            transfer_owner,
        )
    })
    .await
    .map_err(|_| fail())?
}
#[tauri::command]
pub fn sync_baseline_chunk(
    transfers: State<Transfers>,
    token: String,
    index: usize,
) -> Result<String> {
    let g = transfers.0.lock().map_err(|_| fail())?;
    g.snapshot
        .as_ref()
        .filter(|v| v.manifest.id == token)
        .ok_or_else(fail)?
        .read_chunk(index)
}
#[tauri::command]
pub fn sync_baseline_release(transfers: State<Transfers>, token: String) -> Result<()> {
    let mut g = transfers.0.lock().map_err(|_| fail())?;
    if g.snapshot.as_ref().is_some_and(|v| v.manifest.id == token) {
        g.snapshot = None;
    }
    Ok(())
}
#[tauri::command]
pub fn sync_bind_baseline(
    transfers: State<Transfers>,
    database: State<Database>,
    uid: String,
    token: String,
    space_id: String,
) -> Result<()> {
    let mut t = transfers.0.lock().map_err(|_| fail())?;
    let mut g = database.0.lock().map_err(|_| fail())?;
    t.bind_baseline(g.as_mut().ok_or_else(fail)?, &uid, &token, &space_id)
}
#[tauri::command]
pub async fn sync_connect(
    app: tauri::AppHandle,
    uid: String,
    email: String,
    space_id: String,
    token: String,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let restore = app.state::<RestorePreview>();
        let database = app.state::<Database>();
        let proposals = app.state::<assistant::Proposals>();
        let mut r = restore.0.lock().map_err(|_| fail())?;
        let staged = r
            .as_ref()
            .filter(|v| v.preview.token == token && v.preserve_local_settings)
            .ok_or_else(fail)?;
        let mut g = database.0.lock().map_err(|_| fail())?;
        sync_transfer::restore_bind(
            &mut g,
            staged,
            &app.path().app_data_dir().map_err(|_| fail())?,
            &uid,
            &email,
            &space_id,
        )?;
        if let Some(staged) = r.take() {
            let _ = std::fs::remove_file(staged.path);
        }
        if let Ok(mut pending) = proposals.0.lock() {
            pending.clear();
        }
        Ok(())
    })
    .await
    .map_err(|_| fail())?
}
#[tauri::command]
pub fn sync_outgoing(
    database: State<Database>,
    uid: String,
) -> Result<Option<replication::Operation>> {
    let g = database.0.lock().map_err(|_| fail())?;
    replication::outgoing(g.as_ref().ok_or_else(fail)?, &uid)
}
#[tauri::command]
pub fn sync_outgoing_chunk(
    database: State<Database>,
    uid: String,
    operation_id: String,
    index: usize,
) -> Result<String> {
    let g = database.0.lock().map_err(|_| fail())?;
    replication::outgoing_chunk(g.as_ref().ok_or_else(fail)?, &uid, &operation_id, index)
}
#[tauri::command]
pub fn sync_begin_incoming(
    app: tauri::AppHandle,
    transfers: State<Transfers>,
    uid: String,
    operation: replication::Operation,
) -> Result<String> {
    let mut g = transfers.0.lock().map_err(|_| fail())?;
    g.begin(
        uid,
        operation,
        &app.path().app_cache_dir().map_err(|_| fail())?,
    )
}
#[tauri::command]
pub fn sync_accept_chunk(
    transfers: State<Transfers>,
    uid: String,
    token: String,
    index: usize,
    data: String,
) -> Result<()> {
    transfers
        .0
        .lock()
        .map_err(|_| fail())?
        .accept(&uid, &token, index, &data)
}
#[tauri::command]
pub async fn sync_finish_incoming(
    app: tauri::AppHandle,
    uid: String,
    token: String,
) -> Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let transfers = app.state::<Transfers>();
        let database = app.state::<Database>();
        let mut t = transfers.0.lock().map_err(|_| fail())?;
        let mut g = database.0.lock().map_err(|_| fail())?;
        t.finish(g.as_mut().ok_or_else(fail)?, &uid, &token)
    })
    .await
    .map_err(|_| fail())?
}
#[tauri::command]
pub fn sync_release_incoming(
    transfers: State<Transfers>,
    uid: String,
    token: String,
) -> Result<()> {
    transfers
        .0
        .lock()
        .map_err(|_| fail())?
        .release(&uid, &token);
    Ok(())
}
#[tauri::command]
pub async fn sync_acknowledge(
    app: tauri::AppHandle,
    uid: String,
    operation: replication::Operation,
) -> Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        let mut g = database.0.lock().map_err(|_| fail())?;
        replication::acknowledge(g.as_mut().ok_or_else(fail)?, &uid, &operation)
    })
    .await
    .map_err(|_| fail())?
}
#[tauri::command]
pub async fn sync_resolve_cloud(app: tauri::AppHandle, uid: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        let mut g = database.0.lock().map_err(|_| fail())?;
        let conn = g.as_mut().ok_or_else(fail)?;
        replication::assert_owner(conn, &uid, false)?;
        sync_transfer::safety(
            conn,
            &app.path().app_data_dir().map_err(|_| fail())?,
            "before-sync-conflict",
        )?;
        replication::discard_pending(conn, &uid)
    })
    .await
    .map_err(|_| fail())?
}

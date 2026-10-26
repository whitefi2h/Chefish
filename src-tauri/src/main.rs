#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod ai;
mod assistant;
mod assistant_commands;
mod backup;
mod cloud_commands;
mod cloud_snapshot;
mod cooking_ai;
mod db;
mod ingredient_images;
mod ingredient_resolver;
mod recipe_images;
mod recipe_import;
mod site_access;
mod site_search;
mod sync_commands;
mod sync_transfer;
use std::sync::Mutex;
use tauri::Manager;
struct Database(Mutex<Option<rusqlite::Connection>>, String);
#[derive(Default)]
struct RestorePreview(Mutex<Option<backup::StagedRestore>>);
#[tauri::command]
fn kitchen_sync_status(database: tauri::State<Database>) -> db::Result<db::sync::Status> {
    let guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库暂不可用".into(),
    })?;
    let conn = guard.as_ref().ok_or_else(|| db::ApiError {
        code: "BOOTSTRAP_FAILED".into(),
        message: database.1.clone(),
    })?;
    db::sync::status(conn)
}
#[tauri::command]
fn kitchen_preferences_save(
    database: tauri::State<Database>,
    preferences: db::preferences::Preferences,
) -> db::Result<()> {
    let mut guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库暂不可用".into(),
    })?;
    let conn = guard.as_mut().ok_or_else(|| db::ApiError {
        code: "BOOTSTRAP_FAILED".into(),
        message: database.1.clone(),
    })?;
    db::preferences::save(conn, preferences)
}

#[tauri::command]
fn kitchen_backup_status(app: tauri::AppHandle) -> db::Result<serde_json::Value> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| db::ApiError {
            code: "BACKUP_PATH".into(),
            message: "无法定位备份目录".into(),
        })?
        .join("backups");
    std::fs::create_dir_all(&dir).map_err(|_| db::ApiError {
        code: "BACKUP_PATH".into(),
        message: "无法读取备份目录".into(),
    })?;
    let files: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|_| db::ApiError {
            code: "BACKUP_PATH".into(),
            message: "无法读取备份目录".into(),
        })?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().is_some_and(|s| s == "sqlite3"))
        .filter_map(|entry| {
            entry
                .metadata()
                .ok()
                .filter(|m| m.is_file())
                .and_then(|m| m.modified().ok())
        })
        .collect();
    let latest = files
        .iter()
        .max()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    Ok(serde_json::json!({"directory":dir.to_string_lossy(),"latest":latest,"count":files.len()}))
}

#[tauri::command]
fn kitchen_backup_open_folder(app: tauri::AppHandle) -> db::Result<()> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| db::ApiError {
            code: "BACKUP_PATH".into(),
            message: "无法定位备份目录".into(),
        })?
        .join("backups");
    std::fs::create_dir_all(&dir).map_err(|_| db::ApiError {
        code: "BACKUP_PATH".into(),
        message: "无法创建备份目录".into(),
    })?;
    open::that(dir).map_err(|_| db::ApiError {
        code: "BACKUP_PATH".into(),
        message: "无法打开备份目录".into(),
    })
}
#[tauri::command(async)]
fn kitchen_bootstrap(database: tauri::State<Database>) -> db::Result<serde_json::Value> {
    let guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库不可用，请重启应用".into(),
    })?;
    let conn = guard.as_ref().ok_or_else(|| db::ApiError {
        code: "BOOTSTRAP_FAILED".into(),
        message: database.1.clone(),
    })?;
    let mut snapshot = db::snapshot(conn)?;
    snapshot["undo"] = db::undo::status(conn)?;
    Ok(snapshot)
}
#[tauri::command(async)]
fn kitchen_execute(
    database: tauri::State<Database>,
    request_id: String,
    command: db::Command,
) -> db::Result<Option<serde_json::Value>> {
    let mut guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库不可用，请重启应用".into(),
    })?;
    let conn = guard.as_mut().ok_or_else(|| db::ApiError {
        code: "BOOTSTRAP_FAILED".into(),
        message: database.1.clone(),
    })?;
    let inline = matches!(&command, db::Command::ChangeLot { .. });
    let revision: String = conn.query_row(
        "SELECT value FROM app_settings WHERE key='data_revision'",
        [],
        |r| r.get(0),
    )?;
    db::execute(conn, &request_id, command)?;
    if inline {
        Ok(Some(db::inventory_update(conn, &revision)?))
    } else {
        Ok(None)
    }
}
#[tauri::command(async)]
fn kitchen_shopping(
    database: tauri::State<Database>,
    week_start: String,
) -> db::Result<serde_json::Value> {
    let guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库不可用，请重启应用".into(),
    })?;
    let conn = guard.as_ref().ok_or_else(|| db::ApiError {
        code: "BOOTSTRAP_FAILED".into(),
        message: database.1.clone(),
    })?;
    db::shopping::forecast(conn, &week_start)
}
#[tauri::command]
fn kitchen_cooking(
    database: tauri::State<Database>,
    plan_id: String,
    servings: i64,
    date: String,
) -> db::Result<serde_json::Value> {
    let guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库不可用".into(),
    })?;
    let conn = guard.as_ref().ok_or_else(|| db::ApiError {
        code: "BOOTSTRAP_FAILED".into(),
        message: database.1.clone(),
    })?;
    db::cooking::preview(conn, &plan_id, servings, &date)
}
#[tauri::command]
fn kitchen_recipe_history(
    database: tauri::State<Database>,
    recipe_id: String,
) -> db::Result<serde_json::Value> {
    let guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库不可用，请重启应用".into(),
    })?;
    let conn = guard.as_ref().ok_or_else(|| db::ApiError {
        code: "BOOTSTRAP_FAILED".into(),
        message: database.1.clone(),
    })?;
    db::recipe_history(conn, &recipe_id)
}
#[tauri::command]
fn kitchen_backup_create(database: tauri::State<Database>) -> db::Result<Option<String>> {
    let Some(path) = rfd::FileDialog::new()
        .set_file_name("Chefish-本地备份.sqlite3")
        .add_filter("Chefish 本地备份", &["sqlite3"])
        .save_file()
    else {
        return Ok(None);
    };
    let guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库暂不可用".into(),
    })?;
    let conn = guard.as_ref().ok_or_else(|| db::ApiError {
        code: "BOOTSTRAP_FAILED".into(),
        message: database.1.clone(),
    })?;
    backup::create(conn, &path)?;
    Ok(Some(
        path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("备份文件")
            .to_owned(),
    ))
}
#[tauri::command]
fn kitchen_backup_preview(
    app: tauri::AppHandle,
    restore: tauri::State<RestorePreview>,
) -> db::Result<Option<backup::Preview>> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Chefish 本地备份", &["sqlite3", "db"])
        .pick_file()
    else {
        return Ok(None);
    };
    let stage_dir = app.path().app_data_dir().map_err(|_| db::ApiError {
        code: "RESTORE_STAGE".into(),
        message: "无法定位恢复暂存目录".into(),
    })?;
    let staged = backup::preview(&path, &stage_dir)?;
    let public_preview = staged.preview.clone();
    let mut slot = restore.0.lock().map_err(|_| db::ApiError {
        code: "RESTORE_STAGE".into(),
        message: "恢复预览不可用，请重试".into(),
    })?;
    if let Some(previous) = slot.replace(staged) {
        let _ = std::fs::remove_file(previous.path);
    }
    Ok(Some(public_preview))
}
#[tauri::command]
fn kitchen_backup_restore(
    app: tauri::AppHandle,
    database: tauri::State<Database>,
    restore: tauri::State<RestorePreview>,
    proposals: tauri::State<assistant::Proposals>,
    token: String,
) -> db::Result<()> {
    let mut staged_guard = restore.0.lock().map_err(|_| db::ApiError {
        code: "RESTORE_STAGE".into(),
        message: "恢复预览已失效，请重新选择备份".into(),
    })?;
    let staged = staged_guard
        .as_ref()
        .filter(|s| s.preview.token == token)
        .ok_or_else(|| db::ApiError {
            code: "RESTORE_STAGE".into(),
            message: "恢复预览已失效，请重新选择备份".into(),
        })?;
    let dir = app.path().app_data_dir().map_err(|_| db::ApiError {
        code: "RESTORE_BACKUP".into(),
        message: "无法定位本机数据目录".into(),
    })?;
    let safety_dir = dir.join("backups");
    std::fs::create_dir_all(&safety_dir).map_err(|_| db::ApiError {
        code: "RESTORE_BACKUP".into(),
        message: "无法准备恢复前安全备份".into(),
    })?;
    let safety_path = safety_dir.join(format!("before-restore-{}.sqlite3", uuid::Uuid::new_v4()));
    let mut db_guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库暂不可用".into(),
    })?;
    if staged.preserve_local_settings {
        let live = db_guard.as_ref().ok_or_else(|| db::ApiError {
            code: "DATABASE_ERROR".into(),
            message: "数据库暂不可用".into(),
        })?;
        cloud_snapshot::preserve_local_settings(live, &staged.path)?;
    }
    backup::replace_live_database(&mut db_guard, &staged.path, &safety_path)?;
    if let Ok(mut pending) = proposals.0.lock() {
        pending.clear();
    }
    if let Some(staged) = staged_guard.take() {
        let _ = std::fs::remove_file(staged.path);
    }
    Ok(())
}
#[tauri::command]
fn kitchen_backup_cancel(restore: tauri::State<RestorePreview>) -> db::Result<()> {
    let mut slot = restore.0.lock().map_err(|_| db::ApiError {
        code: "RESTORE_STAGE".into(),
        message: "无法取消恢复预览".into(),
    })?;
    if let Some(staged) = slot.take() {
        let _ = std::fs::remove_file(staged.path);
    }
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let result = (|| -> std::result::Result<_, String> {
                let dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|_| "无法定位应用数据目录")?;
                std::fs::create_dir_all(&dir).map_err(|_| "无法创建应用数据目录")?;
                db::open(&dir.join("chefish.sqlite3")).map_err(|e| e.message)
            })();
            let database = match result {
                Ok(conn) => {
                    if let Ok(dir) = app.path().app_data_dir() {
                        let _ = backup::automatic(&conn, &dir);
                    }
                    Database(Mutex::new(Some(conn)), String::new())
                }
                Err(message) => Database(Mutex::new(None), message),
            };
            app.manage(database);
            app.manage(RestorePreview::default());
            app.manage(cloud_commands::Transfers::default());
            app.manage(sync_commands::Transfers::default());
            app.manage(assistant::Proposals::default());
            app.manage(ingredient_images::Jobs::default());
            app.manage(ingredient_resolver::Jobs::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ingredient_images::kitchen_ingredient_images,
            ingredient_images::kitchen_open_image_source,
            kitchen_bootstrap,
            kitchen_sync_status,
            sync_commands::sync_state,
            sync_commands::sync_pause,
            sync_commands::sync_prepare_baseline,
            sync_commands::sync_baseline_chunk,
            sync_commands::sync_baseline_release,
            sync_commands::sync_bind_baseline,
            sync_commands::sync_connect,
            sync_commands::sync_outgoing,
            sync_commands::sync_outgoing_chunk,
            sync_commands::sync_begin_incoming,
            sync_commands::sync_accept_chunk,
            sync_commands::sync_finish_incoming,
            sync_commands::sync_release_incoming,
            sync_commands::sync_acknowledge,
            sync_commands::sync_resolve_cloud,
            kitchen_preferences_save,
            kitchen_backup_status,
            kitchen_backup_open_folder,
            kitchen_execute,
            kitchen_shopping,
            kitchen_cooking,
            kitchen_recipe_history,
            kitchen_backup_create,
            kitchen_backup_preview,
            kitchen_backup_restore,
            kitchen_backup_cancel,
            cloud_commands::cloud_backup_prepare,
            cloud_commands::cloud_backup_read_chunk,
            cloud_commands::cloud_backup_begin_download,
            cloud_commands::cloud_backup_accept_chunk,
            cloud_commands::cloud_backup_finish_download,
            cloud_commands::cloud_backup_release,
            kitchen_import_url,
            kitchen_import_images,
            kitchen_recipe_images,
            kitchen_recipe_cover,
            ingredient_resolver::kitchen_resolve_ingredients,
            cooking_ai::kitchen_cooking_interpret,
            kitchen_ai_settings,
            kitchen_ai_save_settings,
            kitchen_ai_test,
            kitchen_ai_route,
            kitchen_ai_apply,
            kitchen_ai_search,
            kitchen_ai_organize,
            kitchen_ai_history,
            kitchen_ai_save_history,
            kitchen_ai_verify,
            kitchen_open_recipe
        ])
        .run(tauri::generate_context!())
        .expect("Chefish failed to start");
}
#[tauri::command]
async fn kitchen_import_url(url: String) -> db::Result<String> {
    tauri::async_runtime::spawn_blocking(move || recipe_import::fetch(&url))
        .await
        .map_err(|_| db::ApiError {
            code: "IMPORT_FAILED".into(),
            message: "网页读取中断，请重试".into(),
        })?
}
#[tauri::command]
async fn kitchen_import_images(
    content: String,
    url: Option<String>,
) -> db::Result<serde_json::Value> {
    if content.len() > 2_000_000 {
        return Err(db::ApiError {
            code: "IMPORT_TOO_LARGE".into(),
            message: "图片来源信息过长".into(),
        });
    }
    ai_block(move || recipe_images::import_with_source(&content, url.as_deref())).await
}
#[tauri::command]
async fn kitchen_recipe_images(url: String) -> db::Result<serde_json::Value> {
    ai_block(move || recipe_images::from_recipe(&url)).await
}
#[tauri::command]
async fn kitchen_recipe_cover(
    name: String,
    preference: String,
    previous: Option<String>,
) -> db::Result<serde_json::Value> {
    if name.trim().is_empty() || name.len() > 400 || preference.len() > 2000 {
        return Err(db::ApiError {
            code: "INVALID_INPUT".into(),
            message: "请填写菜谱名称和简短的图片偏好".into(),
        });
    }
    ai_block(move || ingredient_images::recipe_cover(&name, &preference, previous.as_deref())).await
}

async fn ai_block<T: Send + 'static>(
    f: impl FnOnce() -> db::Result<T> + Send + 'static,
) -> db::Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| db::ApiError {
            code: "AI_FAILED".into(),
            message: "请求中断，原内容已保留".into(),
        })?
}
#[tauri::command]
async fn kitchen_ai_settings() -> db::Result<serde_json::Value> {
    ai_block(ai::status).await
}
#[tauri::command]
async fn kitchen_ai_save_settings(
    settings: ai::Settings,
    key: Option<String>,
    remove: bool,
) -> db::Result<serde_json::Value> {
    ai_block(move || ai::save(settings, key, remove)).await
}
#[tauri::command]
async fn kitchen_ai_test() -> db::Result<()> {
    ai_block(ai::test_connection).await
}
#[tauri::command]
async fn kitchen_ai_route(
    app: tauri::AppHandle,
    database: tauri::State<'_, Database>,
    proposals: tauri::State<'_, assistant::Proposals>,
    messages: serde_json::Value,
    candidates: serde_json::Value,
    week_start: Option<String>,
    proposal_id: Option<String>,
) -> db::Result<serde_json::Value> {
    let mut local = {
        let guard = database.0.lock().map_err(|_| db::ApiError {
            code: "DATABASE_ERROR".into(),
            message: "数据库不可用".into(),
        })?;
        assistant::context(
            guard.as_ref().ok_or_else(|| db::ApiError {
                code: "DATABASE_ERROR".into(),
                message: database.1.clone(),
            })?,
            week_start.as_deref(),
        )?
    };
    local["pendingProposal"] = assistant::pending(&proposals, proposal_id.as_deref());
    let mut revision = local["snapshot"]["dataRevision"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let week = local["weekStart"].as_str().unwrap_or("").to_string();
    if let Some(commands) = assistant::purchase_intent(&local, &messages) {
        if commands.is_empty() {
            return Ok(
                serde_json::json!({"action":"none","message":"这些调料已经是备有状态，无需再勾选。"}),
            );
        }
        let guard = database.0.lock().map_err(|_| db::ApiError {
            code: "DATABASE_ERROR".into(),
            message: "数据库不可用".into(),
        })?;
        let conn = guard.as_ref().ok_or_else(|| db::ApiError {
            code: "DATABASE_ERROR".into(),
            message: database.1.clone(),
        })?;
        let proposal = assistant::prepare(conn, &proposals, commands, &revision, &week)?;
        return Ok(
            serde_json::json!({"action":"operate","message":"已按当前待购量整理，确认后标记已购买。","proposal":proposal}),
        );
    }
    let mut corrections = 0;
    let mut refreshes = 0;
    for _ in 0..8 {
        let m = messages.clone();
        let c = candidates.clone();
        let l = local.clone();
        let route = ai_block(move || ai::route(m, c, l)).await?;
        if route.action == "read" {
            let request = route.read.clone().unwrap_or(serde_json::Value::Null);
            let value = {
                let guard = database.0.lock().map_err(|_| db::ApiError {
                    code: "DATABASE_ERROR".into(),
                    message: "数据库不可用".into(),
                })?;
                let conn = guard.as_ref().ok_or_else(|| db::ApiError {
                    code: "DATABASE_ERROR".into(),
                    message: database.1.clone(),
                })?;
                match assistant::read(conn, request.clone()) {
                    Ok(v) => v,
                    Err(e) => serde_json::json!({"error":e}),
                }
            };
            local["toolResults"]
                .as_array_mut()
                .unwrap()
                .push(serde_json::json!({"request":request,"result":value}));
            continue;
        }
        let mut out = serde_json::to_value(&route).map_err(|_| db::ApiError {
            code: "AI_RESPONSE".into(),
            message: "助手响应无法读取".into(),
        })?;
        if route.action == "ingredient_image" {
            let id = route.candidate_id.clone().unwrap_or_default();
            let instruction = route.query.clone().unwrap_or_default();
            ai_block(move || ingredient_images::run(&app, Some(id), instruction)).await?;
            return Ok(
                serde_json::json!({"action":"none","message":"食材图片已更换，同名食材的所有批次都会使用这张图片。","dataChanged":true}),
            );
        }
        if route.action == "copy_shopping" {
            let guard = database.0.lock().map_err(|_| db::ApiError {
                code: "DATABASE_ERROR".into(),
                message: "数据库不可用".into(),
            })?;
            let conn = guard.as_ref().ok_or_else(|| db::ApiError {
                code: "DATABASE_ERROR".into(),
                message: database.1.clone(),
            })?;
            out["copy"] = assistant::shopping_copy(conn, route.query.as_deref().unwrap_or(&week))?;
        }
        if route.action == "repair_images" {
            let recipe_id = route.query.clone().unwrap_or_default();
            let original = {
                let guard = database.0.lock().map_err(|_| db::ApiError {
                    code: "DATABASE_ERROR".into(),
                    message: "数据库不可用".into(),
                })?;
                assistant::original_recipe(
                    guard.as_ref().ok_or_else(|| db::ApiError {
                        code: "DATABASE_ERROR".into(),
                        message: database.1.clone(),
                    })?,
                    &recipe_id,
                )?
            };
            let url = original["source"]["url"]
                .as_str()
                .ok_or_else(|| db::ApiError {
                    code: "NO_SOURCE".into(),
                    message: "这份菜谱没有可补图的来源链接".into(),
                })?
                .to_string();
            let images = ai_block(move || recipe_images::from_recipe(&url)).await?;
            if !images["media"].is_object() {
                return Err(db::ApiError {
                    code: "IMPORT_IMAGE".into(),
                    message: format!("原图暂未取得：{}", images["warnings"]),
                });
            }
            let guard = database.0.lock().map_err(|_| db::ApiError {
                code: "DATABASE_ERROR".into(),
                message: "数据库不可用".into(),
            })?;
            let conn = guard.as_ref().ok_or_else(|| db::ApiError {
                code: "DATABASE_ERROR".into(),
                message: database.1.clone(),
            })?;
            let command = assistant::image_command(conn, &recipe_id, images["media"].clone())?;
            out["proposal"] = serde_json::to_value(assistant::prepare(
                conn,
                &proposals,
                vec![command],
                &revision,
                &week,
            )?)
            .unwrap();
            out["action"] = serde_json::json!("operate");
        }
        if route.action == "operate" {
            let guard = database.0.lock().map_err(|_| db::ApiError {
                code: "DATABASE_ERROR".into(),
                message: "数据库不可用".into(),
            })?;
            let conn = guard.as_ref().ok_or_else(|| db::ApiError {
                code: "DATABASE_ERROR".into(),
                message: database.1.clone(),
            })?;
            let preview =
                assistant::prepare(conn, &proposals, route.commands.clone(), &revision, &week);
            match preview {
                Ok(preview) => out["proposal"] = serde_json::to_value(preview).unwrap(),
                Err(e) if e.code == "STALE_REVISION" && refreshes < 2 => {
                    refreshes += 1;
                    local = assistant::context(conn, Some(&week))?;
                    local["pendingProposal"] =
                        assistant::pending(&proposals, proposal_id.as_deref());
                    revision = local["snapshot"]["dataRevision"].as_str().unwrap().into();
                    continue;
                }
                Err(e)
                    if corrections < 2
                        && !["STALE_REVISION", "DATABASE_ERROR", "DATABASE_BUSY"]
                            .contains(&e.code.as_str()) =>
                {
                    corrections += 1;
                    local["toolResults"].as_array_mut().unwrap().push(serde_json::json!({"request":{"kind":"validate_proposal","commands":route.commands},"result":{"error":e,"instruction":"仅修正操作格式和无效参数，保留用户意图。每项用type指定命令名，绝不能用operation指定receive_lot等命令。quantity用字符串。receive_lot只包含draft，draft内name/category/quantity/unit/location/received/expires/precision，包袋可交给程序统一。不要丢掉有效操作。save_plan字段plan_id,expected_version,draft内部recipe_revision_id,custom_title,day,meal,servings，不能用camelCase；不要增加未定义字段。返回完整的替代commands，不要声称已执行。"}}));
                    continue;
                }
                Err(e) => {
                    return Err(if e.code == "INVALID_TOOL" {
                        db::ApiError {
                            code: e.code,
                            message: "模型提案经自动纠正仍无法执行，请换种说法重试；数据未修改。"
                                .into(),
                        }
                    } else {
                        e
                    })
                }
            }
        }
        out.as_object_mut().unwrap().remove("commands");
        return Ok(out);
    }
    Err(db::ApiError {
        code: "AI_TOOL_LIMIT".into(),
        message: "需要查询的数据较多，请缩小问题范围后重试".into(),
    })
}
#[tauri::command]
fn kitchen_ai_apply(
    database: tauri::State<Database>,
    proposals: tauri::State<assistant::Proposals>,
    proposal_id: String,
    confirm_delete: bool,
) -> db::Result<()> {
    let mut guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库不可用".into(),
    })?;
    let conn = guard.as_mut().ok_or_else(|| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: database.1.clone(),
    })?;
    assistant::apply(conn, &proposals, &proposal_id, confirm_delete)
}
#[tauri::command]
async fn kitchen_ai_search(query: String, limit: Option<usize>) -> db::Result<serde_json::Value> {
    ai_block(move || {
        let mut result = ai::search(&query)?;
        if let Some(rows) = result.as_array_mut() {
            rows.truncate(limit.unwrap_or(3).clamp(1, 50));
        }
        Ok(result)
    })
    .await
}
#[tauri::command]
async fn kitchen_ai_organize(
    content: String,
    url: String,
    categories: Vec<String>,
) -> db::Result<serde_json::Value> {
    ai_block(move || ai::organize(content, url, categories)).await
}

#[tauri::command]
fn kitchen_ai_history(database: tauri::State<Database>) -> db::Result<serde_json::Value> {
    let guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "无法读取聊天记录".into(),
    })?;
    let conn = guard.as_ref().ok_or_else(|| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库不可用".into(),
    })?;
    ai::history(conn)
}
#[tauri::command]
fn kitchen_ai_save_history(
    database: tauri::State<Database>,
    history: serde_json::Value,
) -> db::Result<()> {
    let guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "无法保存聊天记录".into(),
    })?;
    let conn = guard.as_ref().ok_or_else(|| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库不可用".into(),
    })?;
    ai::save_history(conn, &history)
}
#[tauri::command]
async fn kitchen_ai_verify(url: String) -> db::Result<serde_json::Value> {
    ai_block(move || recipe_import::verify(&url)).await
}
#[tauri::command]
async fn kitchen_open_recipe(url: String) -> db::Result<()> {
    ai_block(move || {
        let safe = recipe_import::canonical_url(&url)?;
        open::that(safe).map_err(|_| db::ApiError {
            code: "OPEN_FAILED".into(),
            message: "无法启动默认浏览器，可复制链接后打开".into(),
        })
    })
    .await
}

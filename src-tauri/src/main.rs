#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod ai;
mod assistant;
mod db;
mod recipe_images;
mod recipe_import;
mod site_access;
mod site_search;
use std::sync::Mutex;
use tauri::Manager;
struct Database(Mutex<Option<rusqlite::Connection>>, String);
#[tauri::command]
fn kitchen_bootstrap(database: tauri::State<Database>) -> db::Result<serde_json::Value> {
    let guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库不可用，请重启应用".into(),
    })?;
    let conn = guard.as_ref().ok_or_else(|| db::ApiError {
        code: "BOOTSTRAP_FAILED".into(),
        message: database.1.clone(),
    })?;
    db::snapshot(conn)
}
#[tauri::command]
fn kitchen_execute(
    database: tauri::State<Database>,
    request_id: String,
    command: db::Command,
) -> db::Result<()> {
    let mut guard = database.0.lock().map_err(|_| db::ApiError {
        code: "DATABASE_ERROR".into(),
        message: "数据库不可用，请重启应用".into(),
    })?;
    let conn = guard.as_mut().ok_or_else(|| db::ApiError {
        code: "BOOTSTRAP_FAILED".into(),
        message: database.1.clone(),
    })?;
    db::execute(conn, &request_id, command)
}
#[tauri::command]
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
                Ok(conn) => Database(Mutex::new(Some(conn)), String::new()),
                Err(message) => Database(Mutex::new(None), message),
            };
            app.manage(database);
            app.manage(assistant::Proposals::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            kitchen_bootstrap,
            kitchen_execute,
            kitchen_shopping,
            kitchen_cooking,
            kitchen_recipe_history,
            kitchen_import_url,
            kitchen_import_images,
            kitchen_recipe_images,
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
    let revision = local["snapshot"]["dataRevision"]
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
    for _ in 0..6 {
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
                Err(e)
                    if corrections < 2
                        && !["STALE_REVISION", "DATABASE_ERROR", "DATABASE_BUSY"]
                            .contains(&e.code.as_str()) =>
                {
                    corrections += 1;
                    local["toolResults"].as_array_mut().unwrap().push(serde_json::json!({"request":{"kind":"validate_proposal","commands":route.commands},"result":{"error":e,"instruction":"仅修正操作格式和无效参数，保留用户意图。save_plan字段plan_id,expected_version,draft内部recipe_revision_id,custom_title,day,meal,servings，不能用camelCase；不要增加未定义字段。返回完整的替代commands，不要声称已执行。"}}));
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

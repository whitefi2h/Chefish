use crate::db::{self, ApiError, Result};
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

const CURRENT_SCHEMA: i64 = 11;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub token: String,
    pub schema_version: i64,
    pub recipes: i64,
    pub inventory_lots: i64,
    pub planned_meals: i64,
    pub cooking_sessions: i64,
    pub file_name: String,
}

#[derive(Debug)]
pub struct StagedRestore {
    pub path: PathBuf,
    pub preview: Preview,
}

fn fail(code: &str, message: impl Into<String>) -> ApiError {
    ApiError {
        code: code.into(),
        message: message.into(),
    }
}

fn sqlite_ok(conn: &Connection) -> Result<()> {
    let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(fail("BACKUP_INVALID", "备份数据库完整性检查失败"));
    }
    let foreign_key_error: Option<String> = conn
        .query_row("PRAGMA foreign_key_check", [], |r| r.get::<_, String>(0))
        .optional()?;
    if foreign_key_error.is_some() {
        return Err(fail("BACKUP_INVALID", "备份中存在无效的数据引用"));
    }
    Ok(())
}

use rusqlite::OptionalExtension;

fn has_table(conn: &Connection, name: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |r| r.get(0),
    )?)
}

fn table_count(conn: &Connection, table: &str) -> Result<i64> {
    if !has_table(conn, table)? {
        return Ok(0);
    }
    let sql = format!("SELECT count(*) FROM {table}");
    Ok(conn.query_row(&sql, [], |r| r.get(0))?)
}

fn inspect(path: &Path) -> Result<(i64, i64, i64, i64, i64)> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| {
        fail(
            "BACKUP_INVALID",
            "无法读取备份文件；请选择 Chefish SQLite 备份",
        )
    })?;
    sqlite_ok(&conn).map_err(|_| fail("BACKUP_INVALID", "备份数据库完整性检查失败"))?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if !(1..=CURRENT_SCHEMA).contains(&version) {
        return Err(fail(
            "BACKUP_VERSION",
            if version > CURRENT_SCHEMA {
                "备份来自较新版本的 Chefish，当前版本不能恢复"
            } else {
                "备份缺少可识别的 Chefish 数据结构"
            },
        ));
    }
    if !has_table(&conn, "recipes")? || !has_table(&conn, "recipe_revisions")? {
        return Err(fail("BACKUP_INVALID", "备份缺少菜谱数据表"));
    }
    Ok((
        version,
        table_count(&conn, "recipes")?,
        table_count(&conn, "inventory_lots")?,
        table_count(&conn, "planned_meals")?,
        table_count(&conn, "cooking_sessions")?,
    ))
}

pub fn create(conn: &Connection, target: &Path) -> Result<()> {
    let parent = target
        .parent()
        .ok_or_else(|| fail("BACKUP_PATH", "备份位置无效"))?;
    fs::create_dir_all(parent).map_err(|_| fail("BACKUP_WRITE", "无法创建备份目录"))?;
    let temporary = target.with_file_name(format!(".chefish-backup-{}.tmp", Uuid::new_v4()));
    let outcome = (|| {
        let mut destination = Connection::open(&temporary)?;
        Backup::new(conn, &mut destination)?.run_to_completion(
            128,
            Duration::from_millis(10),
            None,
        )?;
        sqlite_ok(&destination)?;
        drop(destination);
        let previous = target.with_file_name(format!(".chefish-replaced-{}.tmp", Uuid::new_v4()));
        let had_previous = target.exists();
        if had_previous {
            fs::rename(target, &previous)
                .map_err(|_| fail("BACKUP_WRITE", "无法安全替换已有备份文件"))?;
        }
        if let Err(_) = fs::rename(&temporary, target) {
            if had_previous {
                let _ = fs::rename(&previous, target);
            }
            return Err(fail("BACKUP_WRITE", "无法保存备份文件"));
        }
        if had_previous {
            let _ = fs::remove_file(previous);
        }
        Ok(())
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    outcome
}

pub fn automatic(conn: &Connection, data_dir: &Path) -> Result<()> {
    if !db::preferences::load(conn)?.automatic_backup {
        return Ok(());
    }
    let day: String = conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0))?;
    let dir = data_dir.join("backups");
    fs::create_dir_all(&dir).map_err(|_| fail("BACKUP_WRITE", "无法创建自动备份目录"))?;
    let target = dir.join(format!("auto-{day}.sqlite3"));
    if !target.exists() {
        create(conn, &target)?;
    }
    Ok(())
}

pub fn preview(path: &Path, staging_dir: &Path) -> Result<StagedRestore> {
    inspect(path)?;
    fs::create_dir_all(staging_dir).map_err(|_| fail("RESTORE_STAGE", "无法准备恢复预览"))?;
    let staged = staging_dir.join(format!(".restore-{}.sqlite3", Uuid::new_v4()));
    let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    create(&source, &staged)?;
    drop(source);
    let (version, recipes, inventory_lots, planned_meals, cooking_sessions) = inspect(&staged)?;
    let migrated = db::open(&staged);
    match migrated {
        Ok(conn) => {
            sqlite_ok(&conn)?;
            db::preferences::load(&conn)?;
            drop(conn);
        }
        Err(e) => {
            let _ = fs::remove_file(&staged);
            return Err(fail(
                "RESTORE_UNSUPPORTED",
                format!("该备份无法安全恢复：{}", e.message),
            ));
        }
    }
    let token = Uuid::new_v4().to_string();
    Ok(StagedRestore {
        path: staged,
        preview: Preview {
            token,
            schema_version: version,
            recipes,
            inventory_lots,
            planned_meals,
            cooking_sessions,
            file_name: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("备份文件")
                .to_owned(),
        },
    })
}

pub fn replace_live_database(
    current: &mut Option<Connection>,
    staged_path: &Path,
    safety_backup: &Path,
) -> Result<()> {
    let active = current
        .as_mut()
        .ok_or_else(|| fail("DATABASE_ERROR", "本机数据库不可用，无法恢复"))?;
    create(active, safety_backup)?;
    let staged = db::open(staged_path)?;
    let result = Backup::new(&staged, active)
        .and_then(|backup| backup.run_to_completion(128, Duration::from_millis(10), None));
    if result.is_err() || sqlite_ok(active).is_err() {
        let safety = Connection::open(safety_backup)?;
        Backup::new(&safety, active)?.run_to_completion(128, Duration::from_millis(10), None)?;
        return Err(fail(
            "RESTORE_REPLACE",
            "恢复未能完整写入，已还原恢复前数据库",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, Command, DraftIngredient, RecipeDraft};

    fn temp(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("chefish-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir.join("data.sqlite3")
    }

    fn cleanup_database(path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    fn recipe(name: &str) -> RecipeDraft {
        RecipeDraft {
            ingredient_kinds: Default::default(),
            media: Some(crate::recipe_images::Media {
                cover: Some("data:image/png;base64,iVBORw0KGgo=".into()),
                steps: vec![crate::recipe_images::StepImage {
                    image: "data:image/png;base64,iVBORw0KGgo=".into(),
                    source_step: 1,
                }],
            }),
            text_ingredients: vec![],
            source: None,
            allow_source_duplicate: false,
            step_titles: vec![],
            name: name.into(),
            category: "家常菜".into(),
            minutes: 10,
            servings: 2,
            subtitle: "测试".into(),
            seasoning: "盐".into(),
            ingredients: vec![DraftIngredient {
                name: "番茄".into(),
                quantity: "1".into(),
                unit: "个".into(),
            }],
            steps: vec!["切好".into()],
        }
    }

    #[test]
    fn snapshot_includes_embedded_images_and_preview_reports_contents() {
        let live = temp("backup-live");
        let export = temp("backup-export");
        let stage_dir = temp("backup-stage-dir");
        let mut conn = db::open(&live).unwrap();
        db::execute(
            &mut conn,
            &Uuid::new_v4().to_string(),
            Command::CreateRecipe {
                draft: recipe("备份菜谱"),
            },
        )
        .unwrap();
        create(&conn, &export).unwrap();
        drop(conn);
        let staged = preview(&export, &stage_dir).unwrap();
        assert_eq!(staged.preview.recipes, 1);
        let conn = Connection::open(&staged.path).unwrap();
        let media: String = conn
            .query_row("SELECT content FROM recipe_media", [], |r| r.get(0))
            .unwrap();
        assert!(media.contains("data:image/png;base64"));
        assert_eq!(
            conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        drop(conn);
        cleanup_database(&live);
        cleanup_database(&export);
        cleanup_database(&stage_dir);
    }

    #[test]
    fn invalid_backup_does_not_touch_live_database() {
        let bad = temp("backup-invalid");
        let stage = temp("backup-invalid-stage");
        fs::write(&bad, b"not sqlite").unwrap();
        assert_eq!(preview(&bad, &stage).unwrap_err().code, "BACKUP_INVALID");
        cleanup_database(&bad);
        cleanup_database(&stage);
    }

    #[test]
    fn incompatible_backup_is_rejected_before_restore() {
        let newer = temp("backup-newer");
        let stage = temp("backup-newer-stage");
        let conn = db::open(&newer).unwrap();
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA + 1)
            .unwrap();
        drop(conn);
        assert_eq!(preview(&newer, &stage).unwrap_err().code, "BACKUP_VERSION");
        cleanup_database(&newer);
        cleanup_database(&stage);
    }

    #[test]
    fn automatic_backup_obeys_setting_and_runs_once_per_day() {
        let path = temp("automatic-setting");
        let dir = path.parent().unwrap();
        let mut conn = db::open(&path).unwrap();
        let mut preferences = db::preferences::Preferences {
            automatic_backup: false,
            ..Default::default()
        };
        db::preferences::save(&mut conn, preferences.clone()).unwrap();
        automatic(&conn, dir).unwrap();
        assert!(!dir.join("backups").exists());
        preferences.automatic_backup = true;
        db::preferences::save(&mut conn, preferences).unwrap();
        automatic(&conn, dir).unwrap();
        automatic(&conn, dir).unwrap();
        assert_eq!(fs::read_dir(dir.join("backups")).unwrap().count(), 1);
        drop(conn);
        cleanup_database(&path);
    }

    #[test]
    fn failed_restore_leaves_live_database_intact() {
        let live = temp("restore-failure-live");
        let staged = temp("restore-failure-stage");
        let safety = temp("restore-failure-safety");
        let mut current = Some(db::open(&live).unwrap());
        db::execute(
            current.as_mut().unwrap(),
            &Uuid::new_v4().to_string(),
            Command::CreateRecipe {
                draft: recipe("原有数据"),
            },
        )
        .unwrap();
        fs::write(&staged, b"broken staged database").unwrap();
        assert!(replace_live_database(&mut current, &staged, &safety).is_err());
        let snapshot = db::snapshot(current.as_ref().unwrap()).unwrap();
        let names = snapshot["recipes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["原有数据"]);
        assert_eq!(inspect(&safety).unwrap().1, 1);
        drop(current);
        cleanup_database(&live);
        cleanup_database(&staged);
        cleanup_database(&safety);
    }

    #[test]
    fn restore_keeps_pre_restore_snapshot_and_replaces_database() {
        let live = temp("restore-live");
        let source = temp("restore-source");
        let stage_dir = temp("restore-stage");
        let safety = temp("restore-safety");
        let mut current = Some(db::open(&live).unwrap());
        db::execute(
            current.as_mut().unwrap(),
            &Uuid::new_v4().to_string(),
            Command::CreateRecipe {
                draft: recipe("旧数据"),
            },
        )
        .unwrap();
        let source_conn = db::open(&source).unwrap();
        let mut source_conn = source_conn;
        db::execute(
            &mut source_conn,
            &Uuid::new_v4().to_string(),
            Command::CreateRecipe {
                draft: recipe("恢复数据"),
            },
        )
        .unwrap();
        let export = temp("restore-export");
        create(&source_conn, &export).unwrap();
        drop(source_conn);
        let staged = preview(&export, &stage_dir).unwrap();
        replace_live_database(&mut current, &staged.path, &safety).unwrap();
        let names = db::snapshot(current.as_ref().unwrap()).unwrap()["recipes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["恢复数据"]);
        assert_eq!(inspect(&safety).unwrap().1, 1);
        drop(current);
        cleanup_database(&live);
        cleanup_database(&source);
        cleanup_database(&export);
        cleanup_database(&safety);
        cleanup_database(&stage_dir);
    }
}

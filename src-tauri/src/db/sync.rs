//! Local transaction journal for incremental multi-device sync.
//! Row results retain generated IDs; replaying command text would create new IDs.
use super::{error, preferences, Connection, Result};
use flate2::{Compression, GzBuilder};
use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Write};
use uuid::Uuid;

pub(super) const TABLES: &[&str] = &[
    "categories",
    "ingredients",
    "recipes",
    "recipe_revisions",
    "recipe_ingredients",
    "recipe_steps",
    "favorite_recipes",
    "inspiration_recipes",
    "cooking_notes",
    "storage_locations",
    "inventory_lots",
    "inventory_events",
    "planned_meals",
    "shopping_lines",
    "purchase_events",
    "shopping_receipts",
    "shopping_suppressions",
    "shopping_receipt_undos",
    "shopping_combined_purchases",
    "cooking_sessions",
    "cooking_consumptions",
    "cooking_undos",
    "recipe_sources",
    "recipe_text_ingredients",
    "recipe_media",
    "recipe_ingredient_kinds",
    "seasoning_supplies",
];

fn exists(conn: &Connection) -> Result<bool> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_sync_outbox')", [], |row| row.get(0))?)
}

pub fn initialize(conn: &Connection) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO local_sync_state(singleton,replica_id) VALUES(1,?1)",
        [Uuid::new_v4().to_string()],
    )?;
    Ok(())
}

// A restore starts a new replica lineage. The old queue remains recoverable in
// the before-restore backup and must not be uploaded against the restored data.
pub fn reset(conn: &mut Connection) -> Result<()> {
    if !exists(conn)? {
        return Ok(());
    }
    let tx = conn.transaction()?;
    strip_local_metadata(&tx)?;
    initialize(&tx)?;
    tx.commit()?;
    Ok(())
}

pub fn strip_local_metadata(conn: &Connection) -> Result<()> {
    if conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='local_sync_binding')",
        [],
        |r| r.get::<_, bool>(0),
    )? {
        conn.execute_batch("DELETE FROM local_sync_binding; DELETE FROM local_sync_applied;")?;
    }
    if exists(conn)? {
        conn.execute_batch("DELETE FROM local_sync_outbox; DELETE FROM local_sync_state; DELETE FROM sqlite_sequence WHERE name='local_sync_outbox';")?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub replica_id: String,
    pub queued_operations: i64,
    pub queued_bytes: i64,
}

pub fn status(conn: &Connection) -> Result<Status> {
    let replica_id = conn.query_row(
        "SELECT replica_id FROM local_sync_state WHERE singleton=1",
        [],
        |row| row.get(0),
    )?;
    let (queued_operations, queued_bytes) = conn.query_row(
        "SELECT count(*),coalesce(sum(length(payload)),0) FROM local_sync_outbox",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(Status {
        replica_id,
        queued_operations,
        queued_bytes,
    })
}

pub(super) fn settings(conn: &Connection) -> Result<BTreeMap<String, Value>> {
    let mut stmt = conn.prepare("SELECT key,value FROM app_settings WHERE key='shopping_memo' OR key GLOB 'seasoning_hidden:*' OR key GLOB 'inventory_expiry_before:*' ORDER BY key")?;
    let mut values = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, Value::String(row.get(1)?)))
        })?
        .collect::<std::result::Result<BTreeMap<_, _>, _>>()?;
    let preferences = preferences::load(conn)?;
    values.insert("preferences_v1".into(), json!({"defaultServings":preferences.default_servings,"taste":preferences.taste,"restrictions":preferences.restrictions,"equipment":preferences.equipment}));
    Ok(values)
}

fn initialize_capture(conn: &Connection) -> Result<()> {
    let ready: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_temp_master WHERE name='sync_capture_context')",
        [],
        |row| row.get(0),
    )?;
    if ready {
        return Ok(());
    }
    conn.execute_batch("CREATE TEMP TABLE sync_capture_context(active INTEGER NOT NULL); INSERT INTO sync_capture_context VALUES(0); CREATE TEMP TABLE sync_capture_rows(sequence INTEGER PRIMARY KEY,table_name TEXT NOT NULL,before_json TEXT,after_json TEXT);")?;
    for table in TABLES {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{table}\")"))?;
        let columns = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, i64>(5)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if columns.is_empty() {
            return Err(error("SYNC_SCHEMA", "同步记录缺少业务表，当前操作未保存"));
        }
        if !columns.iter().any(|(_, pk)| *pk > 0) {
            return Err(error("SYNC_SCHEMA", "同步记录缺少稳定主键，当前操作未保存"));
        }
        let object = |prefix: &str| {
            format!(
                "json_object({})",
                columns
                    .iter()
                    .map(|(name, _)| format!(
                        "'{}',{prefix}.\"{}\"",
                        name.replace('\'', "''"),
                        name.replace('"', "\"\"")
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        };
        let old = object("OLD");
        let new = object("NEW");
        for (suffix, event, before, after, changed) in [
            (
                "insert",
                "INSERT",
                "NULL".to_string(),
                new.clone(),
                "1".to_string(),
            ),
            (
                "update",
                "UPDATE",
                old.clone(),
                new.clone(),
                format!("{old} IS NOT {new}"),
            ),
            ("delete", "DELETE", old, "NULL".to_string(), "1".to_string()),
        ] {
            // Table identifiers come only from TABLES; values remain JSON data.
            conn.execute_batch(&format!("CREATE TEMP TRIGGER sync_{table}_{suffix} AFTER {event} ON main.\"{table}\" WHEN (SELECT active FROM sync_capture_context)=1 AND ({changed}) BEGIN INSERT INTO sync_capture_rows(table_name,before_json,after_json) VALUES('{table}',{before},{after}); END;"))?;
        }
    }
    Ok(())
}

pub struct Capture<'a> {
    conn: &'a Connection,
    before_settings: BTreeMap<String, Value>,
    base_revision: String,
}

impl<'a> Capture<'a> {
    pub fn begin(conn: &'a Connection) -> Result<Option<Self>> {
        // Minimal unit fixtures and old-schema backup clones have no journal.
        if !exists(conn)? {
            return Ok(None);
        }
        initialize_capture(conn)?;
        let before_settings = settings(conn)?;
        let base_revision = revision(conn)?;
        conn.execute_batch(
            "DELETE FROM sync_capture_rows; UPDATE sync_capture_context SET active=1;",
        )?;
        Ok(Some(Self {
            conn,
            before_settings,
            base_revision,
        }))
    }

    pub fn finish(self, operation_id: &str, command_type: &str) -> Result<()> {
        let conn = self.conn;
        conn.execute("UPDATE sync_capture_context SET active=0", [])?;
        let mut stmt = conn.prepare(
            "SELECT table_name,before_json,after_json FROM sync_capture_rows ORDER BY sequence",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(stmt);
        let parse = |value: Option<String>| -> Result<Value> {
            value
                .map(|encoded| {
                    serde_json::from_str(&encoded)
                        .map_err(|_| error("SYNC_RECORD", "无法记录同步操作，当前操作未保存"))
                })
                .transpose()
                .map(|value| value.unwrap_or(Value::Null))
        };
        let rows = rows
            .into_iter()
            .map(|(table, before, after)| {
                Ok(json!({"table":table,"before":parse(before)?,"after":parse(after)?}))
            })
            .collect::<Result<Vec<_>>>()?;
        let after_settings = settings(conn)?;
        let mut keys = self
            .before_settings
            .keys()
            .chain(after_settings.keys())
            .collect::<Vec<_>>();
        keys.sort();
        keys.dedup();
        let settings = keys.into_iter().filter(|key| self.before_settings.get(*key) != after_settings.get(*key)).map(|key| json!({"key":key,"before":self.before_settings.get(key),"after":after_settings.get(key)})).collect::<Vec<_>>();
        if !rows.is_empty() || !settings.is_empty() {
            initialize(conn)?;
            let replica_id: String = conn.query_row(
                "SELECT replica_id FROM local_sync_state WHERE singleton=1",
                [],
                |row| row.get(0),
            )?;
            let schema_version: i64 =
                conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
            let result_revision = revision(conn)?;
            let payload = serde_json::to_vec(&json!({"formatVersion":1,"schemaVersion":schema_version,"operationId":operation_id,"replicaId":replica_id,"baseRevision":self.base_revision,"resultRevision":result_revision,"rows":rows,"settings":settings})).map_err(|_| error("SYNC_RECORD", "无法记录同步操作，当前操作未保存"))?;
            let mut encoder = GzBuilder::new()
                .mtime(0)
                .operating_system(255)
                .write(Vec::new(), Compression::fast());
            encoder
                .write_all(&payload)
                .map_err(|_| error("SYNC_RECORD", "同步操作压缩失败，当前操作未保存"))?;
            let compressed = encoder
                .finish()
                .map_err(|_| error("SYNC_RECORD", "同步操作压缩失败，当前操作未保存"))?;
            let sha256 = format!("{:x}", Sha256::digest(&compressed));
            conn.execute("INSERT INTO local_sync_outbox(operation_id,replica_id,command_type,base_revision,result_revision,format_version,payload,payload_sha256) VALUES(?1,?2,?3,?4,?5,1,?6,?7)", params![operation_id,replica_id,command_type,self.base_revision,result_revision,compressed,sha256])?;
        }
        conn.execute("DELETE FROM sync_capture_rows", [])?;
        Ok(())
    }
}

fn revision(conn: &Connection) -> Result<String> {
    Ok(conn.query_row(
        "SELECT value FROM app_settings WHERE key='data_revision'",
        [],
        |row| row.get(0),
    )?)
}

#[cfg(test)]
pub fn remove_for_legacy_fixture(conn: &Connection) {
    let names = conn
        .prepare("SELECT name FROM sqlite_temp_master WHERE type='trigger' AND name GLOB 'sync_*'")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    for name in names {
        conn.execute_batch(&format!(
            "DROP TRIGGER temp.\"{}\"",
            name.replace('"', "\"\"")
        ))
        .unwrap();
    }
    conn.execute_batch("DROP TABLE IF EXISTS temp.sync_capture_rows; DROP TABLE IF EXISTS temp.sync_capture_context; DROP TABLE local_sync_outbox; DROP TABLE local_sync_state; DELETE FROM schema_migrations WHERE version=12;").unwrap();
    conn.execute_batch("DROP TABLE IF EXISTS local_sync_binding; DROP TABLE IF EXISTS local_sync_applied; DELETE FROM schema_migrations WHERE version=13;").unwrap();
}

#[cfg(test)]
#[path = "sync_tests.rs"]
mod tests;

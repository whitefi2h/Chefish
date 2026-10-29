use super::{error, preferences, sync, Connection, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use flate2::read::GzDecoder;
use rusqlite::{
    params, params_from_iter, types::Value as SqlValue, OptionalExtension, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Read;
use uuid::Uuid;

pub const CHUNK_BYTES: usize = 256 * 1024;
pub const MAX_OPERATION_BYTES: usize = 512 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Chunk {
    pub hash: String,
    pub bytes: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Operation {
    pub id: String,
    pub replica_id: String,
    pub space_id: String,
    pub sequence: i64,
    pub format_version: i64,
    pub schema_version: i64,
    pub sha256: String,
    pub bytes: usize,
    pub chunks: Vec<Chunk>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub uid: String,
    pub email: String,
    pub space_id: String,
    pub cursor: i64,
    pub enabled: bool,
    pub conflict: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub replica_id: String,
    pub queued_operations: i64,
    pub queued_bytes: i64,
    pub binding: Option<Binding>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Payload {
    #[serde(default)]
    undo: bool,
    format_version: i64,
    schema_version: i64,
    operation_id: String,
    replica_id: String,
    base_revision: String,
    result_revision: String,
    rows: Vec<RowChange>,
    settings: Vec<SettingChange>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RowChange {
    table: String,
    before: Value,
    after: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SettingChange {
    key: String,
    before: Value,
    after: Value,
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn validate_uid(uid: &str) -> Result<()> {
    if uid.is_empty()
        || uid.len() > 128
        || !uid
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
    {
        return Err(error("SYNC_ACCOUNT", "账户标识无效"));
    }
    Ok(())
}
pub fn state(conn: &Connection) -> Result<State> {
    let base = sync::status(conn)?;
    let binding=conn.query_row("SELECT uid,email,space_id,cursor,enabled,conflict FROM local_sync_binding WHERE singleton=1",[],|r|Ok(Binding {uid:r.get(0)?,email:r.get(1)?,space_id:r.get(2)?,cursor:r.get(3)?,enabled:r.get(4)?,conflict:r.get(5)?})).optional()?;
    Ok(State {
        replica_id: base.replica_id,
        queued_operations: base.queued_operations,
        queued_bytes: base.queued_bytes,
        binding,
    })
}
pub fn assert_owner(conn: &Connection, uid: &str, allow_unbound: bool) -> Result<Option<Binding>> {
    validate_uid(uid)?;
    let binding = state(conn)?.binding;
    if binding.as_ref().is_some_and(|b| b.uid != uid) || (!allow_unbound && binding.is_none()) {
        return Err(error(
            "SYNC_ACCOUNT",
            "本机厨房与当前账户不一致，请先明确连接或复制厨房",
        ));
    }
    Ok(binding)
}
fn active(conn: &Connection, uid: &str) -> Result<Binding> {
    let binding = assert_owner(conn, uid, false)?.unwrap();
    if !binding.enabled {
        return Err(error("SYNC_PAUSED", "自动同步已暂停"));
    }
    Ok(binding)
}
pub fn bind(
    conn: &mut Connection,
    uid: &str,
    email: &str,
    space: &str,
    watermark: i64,
    replica: &str,
) -> Result<()> {
    validate_uid(uid)?;
    Uuid::parse_str(space).map_err(|_| error("SYNC_INVALID", "云端厨房标识无效"))?;
    if email.len() > 320 || watermark < 0 || sync::status(conn)?.replica_id != replica {
        return Err(error("SYNC_STALE", "本机厨房已变化，请重新连接"));
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute(
        "DELETE FROM local_sync_outbox WHERE sequence<=?1",
        [watermark],
    )?;
    tx.execute("DELETE FROM local_sync_applied", [])?;
    tx.execute("INSERT INTO local_sync_binding(singleton,uid,email,space_id,cursor,enabled,conflict) VALUES(1,?1,?2,?3,0,1,NULL) ON CONFLICT(singleton) DO UPDATE SET uid=excluded.uid,email=excluded.email,space_id=excluded.space_id,cursor=0,enabled=1,conflict=NULL",params![uid,email,space])?;
    tx.commit()?;
    Ok(())
}
pub fn pause(conn: &Connection, uid: &str, enabled: bool) -> Result<()> {
    assert_owner(conn, uid, false)?;
    conn.execute(
        "UPDATE local_sync_binding SET enabled=?1 WHERE singleton=1",
        [enabled],
    )?;
    Ok(())
}
pub fn watermark(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT coalesce(max(sequence),0) FROM local_sync_outbox",
        [],
        |r| r.get(0),
    )?)
}

impl Operation {
    pub fn validate(&self) -> Result<()> {
        if Uuid::parse_str(&self.id).is_err()
            || Uuid::parse_str(&self.replica_id).is_err()
            || Uuid::parse_str(&self.space_id).is_err()
            || self.sequence < 1
            || self.format_version != 1
            || !(12..=super::CURRENT_SCHEMA).contains(&self.schema_version)
            || !valid_hash(&self.sha256)
            || self.bytes == 0
            || self.bytes > MAX_OPERATION_BYTES
            || self.chunks.len() != self.bytes.div_ceil(CHUNK_BYTES)
        {
            return Err(error("SYNC_INVALID", "同步操作清单无效"));
        }
        for (i, c) in self.chunks.iter().enumerate() {
            if !valid_hash(&c.hash) || c.bytes != (self.bytes - i * CHUNK_BYTES).min(CHUNK_BYTES) {
                return Err(error("SYNC_INVALID", "同步分块清单无效"));
            }
        }
        Ok(())
    }
}
pub fn outgoing(conn: &Connection, uid: &str) -> Result<Option<Operation>> {
    let binding = active(conn, uid)?;
    let row=conn.query_row("SELECT operation_id,replica_id,payload,payload_sha256 FROM local_sync_outbox ORDER BY sequence LIMIT 1",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Vec<u8>>(2)?,r.get::<_,String>(3)?))).optional()?;
    let Some((id, replica_id, payload, sha256)) = row else {
        return Ok(None);
    };
    if digest(&payload) != sha256 || replica_id != sync::status(conn)?.replica_id {
        return Err(error("SYNC_INVALID", "本机同步队列校验失败"));
    }
    let op = Operation {
        id,
        replica_id,
        space_id: binding.space_id,
        sequence: binding.cursor + 1,
        format_version: 1,
        schema_version: decode(&payload)?.schema_version,
        sha256,
        bytes: payload.len(),
        chunks: payload
            .chunks(CHUNK_BYTES)
            .map(|c| Chunk {
                hash: digest(c),
                bytes: c.len(),
            })
            .collect(),
    };
    op.validate()?;
    Ok(Some(op))
}
pub fn outgoing_chunk(conn: &Connection, uid: &str, id: &str, index: usize) -> Result<String> {
    active(conn, uid)?;
    if index >= MAX_OPERATION_BYTES.div_ceil(CHUNK_BYTES) {
        return Err(error("SYNC_INVALID", "分块编号无效"));
    }
    let bytes: Vec<u8> = conn.query_row(
        "SELECT substr(payload,?2,?3) FROM local_sync_outbox WHERE operation_id=?1",
        params![id, (index * CHUNK_BYTES + 1) as i64, CHUNK_BYTES as i64],
        |r| r.get(0),
    )?;
    if bytes.is_empty() {
        return Err(error("SYNC_INVALID", "同步操作已变化"));
    }
    Ok(STANDARD.encode(bytes))
}
fn decode(bytes: &[u8]) -> Result<Payload> {
    let mut raw = Vec::new();
    GzDecoder::new(bytes)
        .take(MAX_OPERATION_BYTES as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(|_| error("SYNC_INVALID", "同步操作解压失败"))?;
    if raw.len() > MAX_OPERATION_BYTES {
        return Err(error("SYNC_INVALID", "同步操作超过大小限制"));
    }
    let p: Payload =
        serde_json::from_slice(&raw).map_err(|_| error("SYNC_INVALID", "同步操作格式无效"))?;
    if p.undo && p.schema_version < 14 {
        return Err(error("SYNC_INVALID", "撤销操作需要较新数据库版本"));
    }
    if p.format_version != 1
        || !(12..=super::CURRENT_SCHEMA).contains(&p.schema_version)
        || Uuid::parse_str(&p.operation_id).is_err()
        || Uuid::parse_str(&p.replica_id).is_err()
        || p.base_revision.parse::<u64>().is_err()
        || p.result_revision.parse::<u64>().is_err()
    {
        return Err(error("SYNC_INVALID", "同步操作版本无效"));
    }
    Ok(p)
}

fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
fn sql_value(value: &Value) -> Result<SqlValue> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::String(v) => Ok(SqlValue::Text(v.clone())),
        Value::Number(v) if v.is_i64() => Ok(SqlValue::Integer(v.as_i64().unwrap())),
        Value::Number(v) if v.is_f64() => Ok(SqlValue::Real(v.as_f64().unwrap())),
        _ => Err(error("SYNC_INVALID", "同步字段类型无效")),
    }
}
fn immutable(table: &str) -> bool {
    matches!(
        table,
        "recipe_revisions"
            | "recipe_ingredients"
            | "recipe_steps"
            | "recipe_sources"
            | "recipe_text_ingredients"
            | "recipe_media"
            | "recipe_ingredient_kinds"
            | "inventory_events"
            | "purchase_events"
            | "shopping_receipts"
            | "shopping_receipt_undos"
            | "shopping_combined_purchases"
            | "cooking_sessions"
            | "cooking_consumptions"
            | "cooking_undos"
    )
}
fn patch_row(conn: &Connection, row: &RowChange, inverse: bool, remote: bool) -> Result<()> {
    if !sync::TABLES.contains(&row.table.as_str()) {
        return Err(error("SYNC_INVALID", "同步操作包含不允许的数据表"));
    }
    if remote && immutable(&row.table) && !row.before.is_null() {
        return Err(error("SYNC_INVALID", "同步操作试图改写不可变历史"));
    }
    let (before, after) = if inverse {
        (&row.after, &row.before)
    } else {
        (&row.before, &row.after)
    };
    if before.is_null() && after.is_null() {
        return Err(error("SYNC_INVALID", "同步操作缺少行内容"));
    }
    let columns = conn
        .prepare(&format!("PRAGMA table_info({})", quote(&row.table)))?
        .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, i64>(5)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let keys = columns
        .iter()
        .filter(|(_, pk)| *pk > 0)
        .map(|(n, _)| n)
        .collect::<Vec<_>>();
    if keys.is_empty() {
        return Err(error("SYNC_INVALID", "同步行缺少主键"));
    }
    for value in [before, after].into_iter().filter(|v| !v.is_null()) {
        let object = value
            .as_object()
            .ok_or_else(|| error("SYNC_INVALID", "同步行无效"))?;
        if object.len() != columns.len()
            || columns.iter().any(|(n, _)| !object.contains_key(n))
            || keys.iter().any(|k| object[*k].is_null())
        {
            return Err(error("SYNC_INVALID", "同步行结构不匹配"));
        }
        for value in object.values() {
            sql_value(value)?;
        }
    }
    let identity = if before.is_null() { after } else { before };
    if !before.is_null() && !after.is_null() && keys.iter().any(|k| before[*k] != after[*k]) {
        return Err(error("SYNC_INVALID", "同步不能修改对象标识"));
    }
    let condition = keys
        .iter()
        .map(|n| format!("{} IS ?", quote(n)))
        .collect::<Vec<_>>()
        .join(" AND ");
    let args = keys
        .iter()
        .map(|n| sql_value(&identity[*n]))
        .collect::<Result<Vec<_>>>()?;
    let object = format!(
        "json_object({})",
        columns
            .iter()
            .map(|(n, _)| format!("'{}',{}", n.replace('\'', "''"), quote(n)))
            .collect::<Vec<_>>()
            .join(",")
    );
    let current: Option<String> = conn
        .query_row(
            &format!(
                "SELECT {object} FROM {} WHERE {condition}",
                quote(&row.table)
            ),
            params_from_iter(args.iter()),
            |r| r.get(0),
        )
        .optional()?;
    let current = current
        .map(|s| serde_json::from_str::<Value>(&s))
        .transpose()
        .map_err(|_| error("SYNC_INVALID", "本机行无法解析"))?
        .unwrap_or(Value::Null);
    if &current != before {
        return Err(error(
            "SYNC_CONFLICT",
            "另一台设备与本机修改了同一条厨房记录，已暂停同步",
        ));
    }
    if after.is_null() {
        conn.execute(
            &format!("DELETE FROM {} WHERE {condition}", quote(&row.table)),
            params_from_iter(args.iter()),
        )?;
    } else if before.is_null() {
        let values = columns
            .iter()
            .map(|(n, _)| sql_value(&after[n]))
            .collect::<Result<Vec<_>>>()?;
        conn.execute(
            &format!(
                "INSERT INTO {} ({}) VALUES({})",
                quote(&row.table),
                columns
                    .iter()
                    .map(|(n, _)| quote(n))
                    .collect::<Vec<_>>()
                    .join(","),
                vec!["?"; columns.len()].join(",")
            ),
            params_from_iter(values.iter()),
        )?;
    } else {
        let mut values = columns
            .iter()
            .map(|(n, _)| sql_value(&after[n]))
            .collect::<Result<Vec<_>>>()?;
        values.extend(args);
        conn.execute(
            &format!(
                "UPDATE {} SET {} WHERE {condition}",
                quote(&row.table),
                columns
                    .iter()
                    .map(|(n, _)| format!("{}=?", quote(n)))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            params_from_iter(values.iter()),
        )?;
    }
    Ok(())
}
fn patch_setting(conn: &Connection, change: &SettingChange, inverse: bool) -> Result<()> {
    if change.key != "preferences_v1"
        && change.key != "shopping_memo"
        && !change.key.starts_with("seasoning_hidden:")
        && !change.key.starts_with("inventory_expiry_before:")
        && !change.key.starts_with("inventory_deleted:")
        && !change.key.starts_with("inventory_properties_before:")
        && !change.key.starts_with("ingredient_image:")
        && !change.key.starts_with("seasoning_image:")
        && !change.key.starts_with("cooking_record:")
        && !change.key.starts_with("ingredient_resolution:")
        && !change.key.starts_with("steward_meta:")
        && !change.key.starts_with("ingredient_rule:")
    {
        return Err(error("SYNC_INVALID", "同步操作包含本机私有设置"));
    }
    let (before, after) = if inverse {
        (&change.after, &change.before)
    } else {
        (&change.before, &change.after)
    };
    let values = sync::settings(conn)?;
    let current = values.get(&change.key).unwrap_or(&Value::Null);
    if current != before {
        return Err(error(
            "SYNC_CONFLICT",
            "两台设备修改了同一项厨房偏好，已暂停同步",
        ));
    }
    if change.key == "preferences_v1" {
        let map = after
            .as_object()
            .ok_or_else(|| error("SYNC_INVALID", "用餐偏好无效"))?;
        if map.len() != 4
            || !["defaultServings", "taste", "restrictions", "equipment"]
                .iter()
                .all(|k| map.contains_key(*k))
        {
            return Err(error("SYNC_INVALID", "同步偏好包含不允许的字段"));
        }
        let mut preferences = preferences::load(conn)?;
        preferences.default_servings = map["defaultServings"]
            .as_i64()
            .ok_or_else(|| error("SYNC_INVALID", "人数无效"))?;
        preferences.taste = map["taste"]
            .as_str()
            .ok_or_else(|| error("SYNC_INVALID", "偏好无效"))?
            .into();
        preferences.restrictions = map["restrictions"]
            .as_str()
            .ok_or_else(|| error("SYNC_INVALID", "偏好无效"))?
            .into();
        preferences.equipment = map["equipment"]
            .as_str()
            .ok_or_else(|| error("SYNC_INVALID", "偏好无效"))?
            .into();
        preferences::validate(&preferences)?;
        conn.execute("INSERT INTO app_settings(key,value) VALUES('preferences_v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&preferences).map_err(|_|error("SYNC_INVALID","偏好无效"))?])?;
    } else if after.is_null() {
        conn.execute("DELETE FROM app_settings WHERE key=?1", [&change.key])?;
    } else {
        let value = after
            .as_str()
            .ok_or_else(|| error("SYNC_INVALID", "设置值无效"))?;
        conn.execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![change.key,value])?;
    }
    Ok(())
}
fn patch(conn: &Connection, p: &Payload, inverse: bool, remote: bool) -> Result<()> {
    if inverse {
        for setting in p.settings.iter().rev() {
            patch_setting(conn, setting, true)?;
        }
        for row in p.rows.iter().rev() {
            patch_row(conn, row, true, false)?;
        }
    } else {
        for row in &p.rows {
            patch_row(conn, row, false, remote && !p.undo)?;
        }
        for setting in &p.settings {
            patch_setting(conn, setting, false)?;
        }
    }
    Ok(())
}
// Only immutable-history triggers are suspended, inside the same transaction.
// Remote payloads are separately forbidden from updating/deleting those rows.
fn suspend_history(conn: &Connection) -> Result<Vec<String>> {
    let triggers=conn.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' AND (name GLOB '*_no_update' OR name GLOB '*_no_delete')")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let mut restore = Vec::new();
    for (name, table, sql) in triggers {
        if immutable(&table) {
            conn.execute_batch(&format!("DROP TRIGGER {}", quote(&name)))?;
            restore.push(sql);
        }
    }
    Ok(restore)
}
pub(super) fn undo_payload(conn: &Connection, bytes: &[u8]) -> Result<()> {
    let payload = decode(bytes)?;
    let triggers = suspend_history(conn)?;
    patch(conn, &payload, true, false)?;
    for trigger in triggers {
        conn.execute_batch(&trigger)?;
    }
    Ok(())
}
fn pending(conn: &Connection) -> Result<Vec<(String, String, Payload)>> {
    let rows = conn
        .prepare(
            "SELECT operation_id,payload_sha256,payload FROM local_sync_outbox ORDER BY sequence",
        )?
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Vec<u8>>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(id, sha, bytes)| {
            if digest(&bytes) != sha {
                return Err(error("SYNC_INVALID", "本机同步队列损坏"));
            }
            let p = decode(&bytes)?;
            if p.operation_id != id {
                return Err(error("SYNC_INVALID", "本机操作标识不匹配"));
            }
            Ok((id, sha, p))
        })
        .collect()
}
pub fn accept(conn: &mut Connection, uid: &str, op: &Operation, bytes: &[u8]) -> Result<bool> {
    op.validate()?;
    if bytes.len() != op.bytes || digest(bytes) != op.sha256 {
        return Err(error("SYNC_INVALID", "同步操作校验失败"));
    }
    let payload = decode(bytes)?;
    if payload.operation_id != op.id
        || payload.replica_id != op.replica_id
        || payload.schema_version != op.schema_version
    {
        return Err(error("SYNC_INVALID", "同步操作与清单不一致"));
    }
    let binding = active(conn, uid)?;
    if binding.space_id != op.space_id {
        return Err(error("SYNC_STALE", "云端厨房已变化"));
    }
    if op.sequence <= binding.cursor {
        let known: Option<(String, String)> = conn
            .query_row(
                "SELECT operation_id,sha256 FROM local_sync_applied WHERE sequence=?1",
                [op.sequence],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if known == Some((op.id.clone(), op.sha256.clone())) {
            return Ok(false);
        }
        return Err(error("SYNC_INVALID", "云端序列发生变化"));
    }
    if op.sequence != binding.cursor + 1 {
        return Err(error("SYNC_GAP", "同步操作不连续，请重新拉取"));
    }
    let result = (|| -> Result<()> {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
        let triggers = suspend_history(&tx)?;
        let waiting = pending(&tx)?;
        for (_, _, p) in waiting.iter().rev() {
            patch(&tx, p, true, false)?;
        }
        if let Some((_, sha, _)) = waiting.iter().find(|(id, _, _)| id == &op.id) {
            if sha != &op.sha256 {
                return Err(error("SYNC_INVALID", "同一操作的内容发生变化"));
            }
        }
        patch(&tx, &payload, false, true)?;
        for (id, _, p) in &waiting {
            if id != &op.id {
                patch(&tx, p, false, false)?;
            }
        }
        for trigger in triggers {
            tx.execute_batch(&trigger)?;
        }
        tx.execute(
            "DELETE FROM local_sync_outbox WHERE operation_id=?1",
            [&op.id],
        )?;
        tx.execute(
            "INSERT INTO local_sync_applied(sequence,operation_id,sha256) VALUES(?1,?2,?3)",
            params![op.sequence, op.id, op.sha256],
        )?;
        tx.execute(
            "UPDATE local_sync_binding SET cursor=?1,conflict=NULL WHERE singleton=1",
            [op.sequence],
        )?;
        tx.execute(
            "UPDATE app_settings SET value=CAST(value AS INTEGER)+1 WHERE key='data_revision'",
            [],
        )?;
        tx.commit()?;
        Ok(())
    })();
    match result {
        Ok(()) => Ok(true),
        Err(e) => {
            let e = if e.code == "DATABASE_ERROR" {
                error(
                    "SYNC_CONFLICT",
                    "同步操作与当前厨房记录或约束冲突，已暂停同步",
                )
            } else {
                e
            };
            if e.code == "SYNC_CONFLICT" {
                conn.execute(
                    "UPDATE local_sync_binding SET conflict=?1 WHERE singleton=1",
                    [&e.message],
                )?;
            }
            Err(e)
        }
    }
}
pub fn acknowledge(conn: &mut Connection, uid: &str, op: &Operation) -> Result<bool> {
    let bytes: Vec<u8> = conn.query_row(
        "SELECT payload FROM local_sync_outbox WHERE operation_id=?1",
        [&op.id],
        |r| r.get(0),
    )?;
    accept(conn, uid, op, &bytes)
}
pub fn discard_pending(conn: &mut Connection, uid: &str) -> Result<()> {
    assert_owner(conn, uid, false)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
    let triggers = suspend_history(&tx)?;
    for (_, _, p) in pending(&tx)?.iter().rev() {
        patch(&tx, p, true, false)?;
    }
    for trigger in triggers {
        tx.execute_batch(&trigger)?;
    }
    tx.execute("DELETE FROM local_sync_outbox", [])?;
    tx.execute(
        "UPDATE local_sync_binding SET conflict=NULL,enabled=1 WHERE singleton=1",
        [],
    )?;
    tx.execute(
        "UPDATE app_settings SET value=CAST(value AS INTEGER)+1 WHERE key='data_revision'",
        [],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
#[path = "replication_tests.rs"]
mod tests;

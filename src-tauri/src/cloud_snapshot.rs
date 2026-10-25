use crate::{
    backup,
    db::{ApiError, Result},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use flate2::{read::GzDecoder, Compression, GzBuilder};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const CHUNK_BYTES: usize = 256 * 1024;
pub const MAX_SNAPSHOT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_COMPRESSED_CHUNK: usize = CHUNK_BYTES + 8192;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChunkReference {
    pub hash: String,
    pub compressed_bytes: usize,
    pub raw_bytes: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub format_version: u32,
    pub schema_version: i64,
    pub created_at: u64,
    pub size_bytes: u64,
    pub sha256: String,
    pub includes_chat: bool,
    pub chunks: Vec<ChunkReference>,
}

struct ScratchDirectory(PathBuf);
impl ScratchDirectory {
    fn new(root: &Path) -> Result<Self> {
        fs::create_dir_all(root).map_err(|_| fail("无法创建云备份暂存目录"))?;
        let path = root.join(format!("cloud-transfer-{}", Uuid::new_v4()));
        fs::create_dir(&path).map_err(|_| fail("无法创建云备份暂存目录"))?;
        Ok(Self(path))
    }
    fn chunk_path(&self, index: usize) -> PathBuf {
        self.0.join(format!("chunk-{index}"))
    }
}
impl Drop for ScratchDirectory {
    fn drop(&mut self) {
        if let Ok(entries) = fs::read_dir(&self.0) {
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|t| t.is_file()) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        let _ = fs::remove_dir(&self.0);
    }
}

pub struct PreparedSnapshot {
    pub manifest: Manifest,
    scratch: ScratchDirectory,
}

pub struct IncomingSnapshot {
    pub manifest: Manifest,
    pub token: String,
    scratch: ScratchDirectory,
    received: Vec<bool>,
}

fn fail(message: &str) -> ApiError {
    ApiError {
        code: "CLOUD_BACKUP_INVALID".into(),
        message: message.into(),
    }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl Manifest {
    pub fn validate(&self) -> Result<()> {
        if self.format_version != 1
            || !(1..=backup::CURRENT_SCHEMA).contains(&self.schema_version)
            || Uuid::parse_str(&self.id).is_err()
            || self.includes_chat
            || self.size_bytes == 0
            || self.size_bytes > MAX_SNAPSHOT_BYTES
            || !valid_hash(&self.sha256)
            || self.chunks.len() != self.size_bytes.div_ceil(CHUNK_BYTES as u64) as usize
        {
            return Err(fail("云备份格式、版本或大小不受支持"));
        }
        for (index, chunk) in self.chunks.iter().enumerate() {
            let raw_bytes =
                (self.size_bytes - (index * CHUNK_BYTES) as u64).min(CHUNK_BYTES as u64) as usize;
            if !valid_hash(&chunk.hash)
                || chunk.raw_bytes != raw_bytes
                || chunk.compressed_bytes == 0
                || chunk.compressed_bytes > MAX_COMPRESSED_CHUNK
            {
                return Err(fail("云备份分块清单无效"));
            }
        }
        Ok(())
    }
}

pub fn prepare(conn: &Connection, root: &Path) -> Result<PreparedSnapshot> {
    let scratch = ScratchDirectory::new(root)?;
    let path = scratch.0.join("snapshot.sqlite3");
    backup::create(conn, &path)?;
    let mut snapshot = Connection::open(&path)?;
    // Scrub the clone, then VACUUM so deleted chat/token bytes cannot remain in free pages.
    snapshot.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; DELETE FROM app_settings WHERE key NOT IN ('data_revision','shopping_memo','preferences_v1') AND key NOT GLOB 'seasoning_hidden:*' AND key NOT GLOB 'inventory_expiry_before:*';")?;
    let mut preferences = crate::db::preferences::load(&snapshot)?;
    let defaults = crate::db::preferences::Preferences::default();
    preferences.start_page = defaults.start_page;
    preferences.send_shortcut = defaults.send_shortcut;
    preferences.automatic_backup = defaults.automatic_backup;
    crate::db::preferences::save(&mut snapshot, preferences)?;
    crate::db::sync::strip_local_metadata(&snapshot)?;
    snapshot.execute_batch("VACUUM;")?;
    let schema_version = snapshot.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    drop(snapshot);
    let size_bytes = fs::metadata(&path)
        .map_err(|_| fail("无法读取云备份快照"))?
        .len();
    if size_bytes == 0 || size_bytes > MAX_SNAPSHOT_BYTES {
        return Err(fail("云备份目前支持最大 512 MiB 的本地快照"));
    }
    let mut file = fs::File::open(&path).map_err(|_| fail("无法读取云备份快照"))?;
    let mut digest = Sha256::new();
    let mut chunks = Vec::new();
    let mut buffer = vec![0u8; CHUNK_BYTES];
    loop {
        let mut count = 0;
        while count < buffer.len() {
            let read = file
                .read(&mut buffer[count..])
                .map_err(|_| fail("读取云备份快照中断"))?;
            if read == 0 {
                break;
            }
            count += read;
        }
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
        let mut encoder = GzBuilder::new()
            .mtime(0)
            .operating_system(255)
            .write(Vec::new(), Compression::fast());
        encoder
            .write_all(&buffer[..count])
            .map_err(|_| fail("云备份压缩失败"))?;
        let compressed = encoder.finish().map_err(|_| fail("云备份压缩失败"))?;
        fs::write(scratch.chunk_path(chunks.len()), &compressed)
            .map_err(|_| fail("云备份暂存失败"))?;
        chunks.push(ChunkReference {
            hash: hash(&compressed),
            compressed_bytes: compressed.len(),
            raw_bytes: count,
        });
    }
    let manifest = Manifest {
        id: Uuid::new_v4().to_string(),
        format_version: 1,
        schema_version,
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        size_bytes,
        sha256: format!("{:x}", digest.finalize()),
        includes_chat: false,
        chunks,
    };
    manifest.validate()?;
    Ok(PreparedSnapshot { manifest, scratch })
}

impl PreparedSnapshot {
    pub fn read_chunk(&self, index: usize) -> Result<String> {
        if index >= self.manifest.chunks.len() {
            return Err(fail("云备份分块编号无效"));
        }
        let bytes = fs::read(self.scratch.chunk_path(index))
            .map_err(|_| fail("云备份暂存文件已失效，请重新备份"))?;
        if hash(&bytes) != self.manifest.chunks[index].hash {
            return Err(fail("云备份暂存文件校验失败"));
        }
        Ok(STANDARD.encode(bytes))
    }
}

impl IncomingSnapshot {
    pub fn new(manifest: Manifest, root: &Path) -> Result<Self> {
        manifest.validate()?;
        let received = vec![false; manifest.chunks.len()];
        Ok(Self {
            manifest,
            token: Uuid::new_v4().to_string(),
            scratch: ScratchDirectory::new(root)?,
            received,
        })
    }
    pub fn accept_chunk(&mut self, index: usize, encoded: &str) -> Result<()> {
        let reference = self
            .manifest
            .chunks
            .get(index)
            .ok_or_else(|| fail("云备份分块编号无效"))?;
        if encoded.len() > MAX_COMPRESSED_CHUNK.div_ceil(3) * 4 {
            return Err(fail("云备份分块超过大小限制"));
        }
        let compressed = STANDARD
            .decode(encoded)
            .map_err(|_| fail("云备份分块编码无效"))?;
        if compressed.len() != reference.compressed_bytes || hash(&compressed) != reference.hash {
            return Err(fail("云备份分块校验失败，请重新下载"));
        }
        let mut raw = Vec::new();
        GzDecoder::new(compressed.as_slice())
            .take(reference.raw_bytes as u64 + 1)
            .read_to_end(&mut raw)
            .map_err(|_| fail("云备份分块解压失败"))?;
        if raw.len() != reference.raw_bytes {
            return Err(fail("云备份分块解压大小无效"));
        }
        fs::write(self.scratch.chunk_path(index), raw).map_err(|_| fail("云备份下载暂存失败"))?;
        self.received[index] = true;
        Ok(())
    }
    pub fn finish(self, staging_root: &Path) -> Result<backup::StagedRestore> {
        if self.received.iter().any(|received| !received) {
            return Err(fail("云备份尚未下载完整，当前数据未修改"));
        }
        let path = self.scratch.0.join("snapshot.sqlite3");
        let mut destination = fs::File::create(&path).map_err(|_| fail("无法准备云备份预览"))?;
        let mut digest = Sha256::new();
        for index in 0..self.manifest.chunks.len() {
            let bytes = fs::read(self.scratch.chunk_path(index))
                .map_err(|_| fail("云备份下载文件不完整"))?;
            digest.update(&bytes);
            destination
                .write_all(&bytes)
                .map_err(|_| fail("无法准备云备份预览"))?;
        }
        destination
            .sync_all()
            .map_err(|_| fail("云备份暂存写入失败"))?;
        drop(destination);
        if format!("{:x}", digest.finalize()) != self.manifest.sha256 {
            return Err(fail("云备份整体校验失败，当前数据未修改"));
        }
        let conn = Connection::open(&path)?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version != self.manifest.schema_version {
            return Err(fail("云备份版本与清单不一致"));
        }
        drop(conn);
        let mut staged = backup::preview(&path, staging_root)?;
        staged.preview.file_name = "云端厨房备份".into();
        staged.preserve_local_settings = true;
        Ok(staged)
    }
}

// Called under the live database lock immediately before replacement, so edits
// to chat or device preferences made while previewing are retained as well.
pub fn preserve_local_settings(live: &Connection, path: &Path) -> Result<()> {
    let mut staged = crate::db::open(path)?;
    let device = crate::db::preferences::load(live)?;
    let mut preferences = crate::db::preferences::load(&staged)?;
    preferences.start_page = device.start_page;
    preferences.send_shortcut = device.send_shortcut;
    preferences.automatic_backup = device.automatic_backup;
    crate::db::preferences::save(&mut staged, preferences)?;
    let history: Option<String> = live
        .query_row(
            "SELECT value FROM app_settings WHERE key='assistant_history_v1'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    staged.execute(
        "DELETE FROM app_settings WHERE key='assistant_history_v1'",
        [],
    )?;
    if let Some(history) = history {
        staged.execute(
            "INSERT INTO app_settings(key,value) VALUES('assistant_history_v1',?1)",
            [history],
        )?;
    }
    // Even a backup uploaded by an older client cannot import unknown session settings.
    staged.execute("DELETE FROM app_settings WHERE key NOT IN ('data_revision','shopping_memo','preferences_v1','assistant_history_v1') AND key NOT GLOB 'seasoning_hidden:*' AND key NOT GLOB 'inventory_expiry_before:*'", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("chefish-cloud-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn cloud_snapshot_scrubs_chat_and_session_bytes_preserves_images_and_never_writes_live_database(
    ) {
        let root = root();
        let mut live = crate::db::open(&root.join("live.sqlite3")).unwrap();
        let chat = "PRIVATE_CHAT_MARKER_MUST_NOT_LEAVE_DEVICE_93b0".repeat(500);
        live.execute(
            "INSERT INTO app_settings(key,value) VALUES('assistant_history_v1',?1)",
            [&chat],
        )
        .unwrap();
        live.execute("INSERT INTO app_settings(key,value) VALUES('firebase_refresh_token','PRIVATE_TOKEN_MARKER_84c7')", []).unwrap();
        live.execute("INSERT INTO app_settings(key,value) VALUES('seasoningXhidden:session','PRIVATE_TOKEN_MARKER_lookalike')", []).unwrap();
        let image = "data:image/png;base64,iVBORw0KGgo=";
        crate::db::execute(&mut live, &Uuid::new_v4().to_string(), serde_json::from_value(json!({"type":"create_recipe","draft":{"name":"云备份测试菜","category":"家常菜","minutes":10,"servings":2,"subtitle":"","seasoning":"","ingredients":[],"steps":["洗净"],"media":{"cover":image,"steps":[{"image":image,"sourceStep":1}]}}})).unwrap()).unwrap();
        let before = crate::db::snapshot(&live).unwrap();
        let replica = crate::db::sync::status(&live).unwrap();
        assert_eq!(replica.queued_operations, 1);
        let prepared = prepare(&live, &root.join("cache")).unwrap();
        let raw = fs::read(prepared.scratch.0.join("snapshot.sqlite3")).unwrap();
        assert!(!raw
            .windows(replica.replica_id.len())
            .any(|window| window == replica.replica_id.as_bytes()));
        let sanitized = Connection::open(prepared.scratch.0.join("snapshot.sqlite3")).unwrap();
        assert_eq!(
            sanitized
                .query_row("SELECT count(*) FROM local_sync_outbox", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            sanitized
                .query_row("SELECT count(*) FROM local_sync_state", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        drop(sanitized);
        assert!(!raw
            .windows(b"PRIVATE_CHAT_MARKER".len())
            .any(|w| w == b"PRIVATE_CHAT_MARKER"));
        assert!(!raw
            .windows(b"PRIVATE_TOKEN_MARKER".len())
            .any(|w| w == b"PRIVATE_TOKEN_MARKER"));
        let mut incoming =
            IncomingSnapshot::new(prepared.manifest.clone(), &root.join("download")).unwrap();
        for index in 0..prepared.manifest.chunks.len() {
            let bytes = prepared.read_chunk(index).unwrap();
            incoming.accept_chunk(index, &bytes).unwrap();
            incoming.accept_chunk(index, &bytes).unwrap();
        }
        let staged = incoming.finish(&root.join("staged")).unwrap();
        let restored = crate::db::open(&staged.path).unwrap();
        let after = crate::db::snapshot(&restored).unwrap();
        assert_eq!(after["recipes"][0]["media"]["cover"], image);
        assert_eq!(after["recipes"][0]["media"]["steps"][0]["image"], image);
        assert_eq!(crate::db::snapshot(&live).unwrap(), before);
        assert_eq!(
            live.query_row(
                "SELECT value FROM app_settings WHERE key='assistant_history_v1'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            chat
        );
        drop(restored);
        drop(live);
        drop(prepared);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn snapshot_manifest_accepts_more_than_128_mib_through_512_mib_and_rejects_larger() {
        for (size_bytes, allowed) in [
            (128_u64 * 1024 * 1024 + 1, true),
            (512 * 1024 * 1024, true),
            (512 * 1024 * 1024 + 1, false),
        ] {
            let chunks = (0..size_bytes.div_ceil(CHUNK_BYTES as u64))
                .map(|index| ChunkReference {
                    hash: "a".repeat(64),
                    compressed_bytes: 4,
                    raw_bytes: (size_bytes - index * CHUNK_BYTES as u64).min(CHUNK_BYTES as u64)
                        as usize,
                })
                .collect();
            let manifest = Manifest {
                id: Uuid::new_v4().to_string(),
                format_version: 1,
                schema_version: backup::CURRENT_SCHEMA,
                created_at: 1,
                size_bytes,
                sha256: "b".repeat(64),
                includes_chat: false,
                chunks,
            };
            assert_eq!(manifest.validate().is_ok(), allowed, "size {size_bytes}");
        }
    }

    #[test]
    fn incomplete_corrupt_or_oversized_downloads_cannot_become_restore_previews() {
        let root = root();
        let live = crate::db::open(&root.join("live.sqlite3")).unwrap();
        let prepared = prepare(&live, &root.join("cache")).unwrap();
        let mut incoming =
            IncomingSnapshot::new(prepared.manifest.clone(), &root.join("download")).unwrap();
        assert!(incoming
            .accept_chunk(0, &STANDARD.encode(b"corrupt"))
            .is_err());
        assert!(incoming.finish(&root.join("staged")).is_err());
        let mut invalid = prepared.manifest.clone();
        invalid.size_bytes = MAX_SNAPSHOT_BYTES + 1;
        assert!(IncomingSnapshot::new(invalid, &root.join("download")).is_err());
        let mut invalid = prepared.manifest.clone();
        invalid.includes_chat = true;
        assert!(IncomingSnapshot::new(invalid, &root.join("download")).is_err());
        drop(prepared);
        drop(live);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cloud_restore_retains_latest_local_chat_and_device_settings_with_a_safety_backup() {
        let root = root();
        let mut source = crate::db::open(&root.join("source.sqlite3")).unwrap();
        let mut cloud_preferences = crate::db::preferences::Preferences::default();
        cloud_preferences.taste = "少盐".into();
        cloud_preferences.start_page = "recipes".into();
        crate::db::preferences::save(&mut source, cloud_preferences).unwrap();
        let prepared = prepare(&source, &root.join("cache")).unwrap();
        let mut incoming =
            IncomingSnapshot::new(prepared.manifest.clone(), &root.join("download")).unwrap();
        for index in 0..prepared.manifest.chunks.len() {
            incoming
                .accept_chunk(index, &prepared.read_chunk(index).unwrap())
                .unwrap();
        }
        let staged = incoming.finish(&root.join("staged")).unwrap();
        let raw = crate::db::open(&staged.path).unwrap();
        assert_eq!(
            crate::db::preferences::load(&raw).unwrap().start_page,
            "planner"
        );
        drop(raw);
        let mut local = crate::db::open(&root.join("local.sqlite3")).unwrap();
        let mut device = crate::db::preferences::Preferences::default();
        device.start_page = "pantry".into();
        device.send_shortcut = "ctrlEnter".into();
        device.automatic_backup = false;
        crate::db::preferences::save(&mut local, device).unwrap();
        local.execute("INSERT INTO app_settings(key,value) VALUES('assistant_history_v1','latest local chat')", []).unwrap();
        preserve_local_settings(&local, &staged.path).unwrap();
        let safety = root.join("safety.sqlite3");
        let mut active = Some(local);
        backup::replace_live_database(&mut active, &staged.path, &safety).unwrap();
        let live = active.as_ref().unwrap();
        let prefs = crate::db::preferences::load(live).unwrap();
        assert_eq!(prefs.taste, "少盐");
        assert_eq!(prefs.start_page, "pantry");
        assert_eq!(prefs.send_shortcut, "ctrlEnter");
        assert!(!prefs.automatic_backup);
        assert_eq!(
            live.query_row(
                "SELECT value FROM app_settings WHERE key='assistant_history_v1'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "latest local chat"
        );
        let safety_conn = crate::db::open(&safety).unwrap();
        assert_eq!(
            crate::db::preferences::load(&safety_conn).unwrap().taste,
            ""
        );
        drop(safety_conn);
        drop(active);
        drop(source);
        drop(prepared);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn multi_chunk_download_checks_whole_digest_and_bounds_decompression() {
        let root = root();
        let live = crate::db::open(&root.join("live.sqlite3")).unwrap();
        // Synthetic high-entropy payload exercises the transport across chunk boundaries.
        live.execute("UPDATE app_settings SET value=lower(hex(randomblob(400000))) WHERE key='shopping_memo'", []).unwrap();
        let prepared = prepare(&live, &root.join("cache")).unwrap();
        assert!(prepared.manifest.chunks.len() > 1);
        let mut wrong = prepared.manifest.clone();
        wrong.sha256 = "0".repeat(64);
        let mut incoming = IncomingSnapshot::new(wrong, &root.join("download")).unwrap();
        for index in 0..prepared.manifest.chunks.len() {
            incoming
                .accept_chunk(index, &prepared.read_chunk(index).unwrap())
                .unwrap();
        }
        assert!(incoming.finish(&root.join("staged")).is_err());
        let mut oversized = GzBuilder::new().write(Vec::new(), Compression::fast());
        oversized.write_all(&vec![0; CHUNK_BYTES + 1]).unwrap();
        let bytes = oversized.finish().unwrap();
        let mut wrong = prepared.manifest.clone();
        wrong.chunks[0].hash = hash(&bytes);
        wrong.chunks[0].compressed_bytes = bytes.len();
        let mut incoming = IncomingSnapshot::new(wrong, &root.join("download")).unwrap();
        assert!(incoming.accept_chunk(0, &STANDARD.encode(bytes)).is_err());
        drop(incoming);
        drop(prepared);
        drop(live);
        fs::remove_dir_all(root).unwrap();
    }
}

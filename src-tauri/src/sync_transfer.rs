use crate::{
    backup,
    cloud_snapshot::{self, Manifest, PreparedSnapshot, ScratchDirectory},
    db::{self, replication, ApiError, Result},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::Connection;
use serde::Serialize;
use std::{fs, io::Read, path::Path};
use uuid::Uuid;

fn fail() -> ApiError {
    ApiError {
        code: "SYNC_TRANSFER".into(),
        message: "同步传输已失效，请重试".into(),
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub manifest: Manifest,
    pub watermark: i64,
    pub replica_id: String,
}
struct BaselineTicket {
    id: String,
    uid: String,
    email: String,
    watermark: i64,
    replica: String,
}
pub struct Incoming {
    pub token: String,
    pub uid: String,
    pub operation: replication::Operation,
    scratch: ScratchDirectory,
    received: Vec<bool>,
}
#[derive(Default)]
pub struct Transfers {
    pub snapshot: Option<PreparedSnapshot>,
    baseline: Option<BaselineTicket>,
    pub incoming: Option<Incoming>,
}
impl Transfers {
    pub fn prepare_baseline(
        &mut self,
        conn: &Connection,
        root: &Path,
        uid: &str,
        email: &str,
        transfer_owner: bool,
    ) -> Result<Baseline> {
        replication::validate_uid(uid)?;
        if !transfer_owner {
            replication::assert_owner(conn, uid, true)?;
        }
        let status = replication::state(conn)?;
        let watermark = replication::watermark(conn)?;
        let prepared = cloud_snapshot::prepare(conn, root)?;
        let manifest = prepared.manifest.clone();
        self.baseline = Some(BaselineTicket {
            id: manifest.id.clone(),
            uid: uid.into(),
            email: email.into(),
            watermark,
            replica: status.replica_id.clone(),
        });
        self.snapshot = Some(prepared);
        Ok(Baseline {
            manifest,
            watermark,
            replica_id: status.replica_id,
        })
    }
    pub fn bind_baseline(
        &mut self,
        conn: &mut Connection,
        uid: &str,
        id: &str,
        space: &str,
    ) -> Result<()> {
        let ticket = self
            .baseline
            .as_ref()
            .filter(|t| t.id == id && t.uid == uid)
            .ok_or_else(fail)?;
        replication::bind(
            conn,
            uid,
            &ticket.email,
            space,
            ticket.watermark,
            &ticket.replica,
        )?;
        self.baseline = None;
        Ok(())
    }
    pub fn begin(
        &mut self,
        uid: String,
        operation: replication::Operation,
        root: &Path,
    ) -> Result<String> {
        replication::validate_uid(&uid)?;
        operation.validate()?;
        let token = Uuid::new_v4().to_string();
        self.incoming = Some(Incoming {
            token: token.clone(),
            uid,
            received: vec![false; operation.chunks.len()],
            operation,
            scratch: ScratchDirectory::new(root)?,
        });
        Ok(token)
    }
    pub fn accept(&mut self, uid: &str, token: &str, index: usize, data: &str) -> Result<()> {
        let incoming = self
            .incoming
            .as_mut()
            .filter(|v| v.uid == uid && v.token == token)
            .ok_or_else(fail)?;
        let chunk = incoming.operation.chunks.get(index).ok_or_else(fail)?;
        if data.len() > replication::CHUNK_BYTES.div_ceil(3) * 4 {
            return Err(fail());
        }
        let bytes = STANDARD.decode(data).map_err(|_| fail())?;
        if bytes.len() != chunk.bytes || replication::digest(&bytes) != chunk.hash {
            return Err(fail());
        }
        fs::write(incoming.scratch.chunk_path(index), bytes).map_err(|_| fail())?;
        incoming.received[index] = true;
        Ok(())
    }
    pub fn finish(&mut self, conn: &mut Connection, uid: &str, token: &str) -> Result<bool> {
        if !self
            .incoming
            .as_ref()
            .is_some_and(|v| v.uid == uid && v.token == token)
        {
            return Err(fail());
        }
        let incoming = self.incoming.take().ok_or_else(fail)?;
        if incoming.received.iter().any(|v| !v) {
            return Err(fail());
        }
        let mut bytes = Vec::with_capacity(incoming.operation.bytes);
        for index in 0..incoming.operation.chunks.len() {
            let mut file =
                fs::File::open(incoming.scratch.chunk_path(index)).map_err(|_| fail())?;
            file.read_to_end(&mut bytes).map_err(|_| fail())?;
        }
        replication::accept(conn, uid, &incoming.operation, &bytes)
    }
    pub fn release(&mut self, uid: &str, token: &str) {
        if self
            .incoming
            .as_ref()
            .is_some_and(|v| v.uid == uid && v.token == token)
        {
            self.incoming = None;
        }
    }
}
pub fn safety(conn: &Connection, root: &Path, label: &str) -> Result<()> {
    let dir = root.join("backups");
    fs::create_dir_all(&dir).map_err(|_| fail())?;
    backup::create(
        conn,
        &dir.join(format!("{label}-{}.sqlite3", Uuid::new_v4())),
    )
}
pub fn restore_bind(
    current: &mut Option<Connection>,
    staged: &backup::StagedRestore,
    root: &Path,
    uid: &str,
    email: &str,
    space: &str,
) -> Result<()> {
    replication::validate_uid(uid)?;
    Uuid::parse_str(space).map_err(|_| fail())?;
    if email.len() > 320 {
        return Err(fail());
    }
    let live = current.as_ref().ok_or_else(fail)?;
    cloud_snapshot::preserve_local_settings(live, &staged.path)?;
    let dir = root.join("backups");
    fs::create_dir_all(&dir).map_err(|_| fail())?;
    backup::replace_live_database(
        current,
        &staged.path,
        &dir.join(format!("before-sync-connect-{}.sqlite3", Uuid::new_v4())),
    )?;
    let conn = current.as_mut().ok_or_else(fail)?;
    let replica = db::sync::status(conn)?.replica_id;
    replication::bind(conn, uid, email, space, 0, &replica)
}

CREATE TABLE local_sync_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    replica_id TEXT NOT NULL
);
CREATE TABLE local_sync_outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    replica_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    base_revision TEXT NOT NULL,
    result_revision TEXT NOT NULL,
    format_version INTEGER NOT NULL CHECK(format_version = 1),
    payload BLOB NOT NULL,
    payload_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS local_steward_runs (
 run_key TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS local_steward_items (
 id TEXT PRIMARY KEY, unique_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'open', unread INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS local_steward_drafts (
 id TEXT PRIMARY KEY, week_start TEXT NOT NULL, messages TEXT NOT NULL DEFAULT '[]',
 slots TEXT NOT NULL DEFAULT '[]', baseline TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'draft', request_id TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS local_steward_checked (entity_key TEXT PRIMARY KEY, signature TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS local_steward_undo (
 operation_id TEXT PRIMARY KEY, payload BLOB NOT NULL, undone INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO storage_locations VALUES('unspecified','未指定');

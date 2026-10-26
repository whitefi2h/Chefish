CREATE TABLE local_undo_history (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 operation_id TEXT NOT NULL UNIQUE,
 command_type TEXT NOT NULL,
 payload BLOB NOT NULL,
 undone INTEGER NOT NULL DEFAULT 0 CHECK(undone IN (0,1))
);

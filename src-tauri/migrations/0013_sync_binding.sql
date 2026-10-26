CREATE TABLE local_sync_binding (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 uid TEXT NOT NULL,
 email TEXT NOT NULL,
 space_id TEXT NOT NULL,
 cursor INTEGER NOT NULL CHECK(cursor>=0),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 conflict TEXT
);
CREATE TABLE local_sync_applied (
 sequence INTEGER PRIMARY KEY CHECK(sequence>0),
 operation_id TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL
);

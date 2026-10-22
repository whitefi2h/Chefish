CREATE TABLE cooking_sessions(
 id TEXT PRIMARY KEY,
 plan_id TEXT NOT NULL REFERENCES planned_meals(id),
 recipe_revision_id TEXT REFERENCES recipe_revisions(id),
 date TEXT NOT NULL,
 servings INTEGER NOT NULL CHECK(servings BETWEEN 1 AND 12),
 note TEXT NOT NULL,
 untracked INTEGER NOT NULL CHECK(untracked IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE cooking_consumptions(
 session_id TEXT NOT NULL REFERENCES cooking_sessions(id),
 lot_id TEXT NOT NULL REFERENCES inventory_lots(id),
 quantity TEXT NOT NULL,
 event_id TEXT NOT NULL UNIQUE REFERENCES inventory_events(id),
 PRIMARY KEY(session_id,lot_id)
);
CREATE TABLE cooking_undos(
 session_id TEXT PRIMARY KEY REFERENCES cooking_sessions(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE planned_meals ADD COLUMN cooking_session_id TEXT REFERENCES cooking_sessions(id);
CREATE TRIGGER cooking_no_update BEFORE UPDATE ON cooking_sessions BEGIN SELECT RAISE(ABORT,'immutable cooking'); END;
CREATE TRIGGER cooking_no_delete BEFORE DELETE ON cooking_sessions BEGIN SELECT RAISE(ABORT,'immutable cooking'); END;
CREATE TRIGGER consumptions_no_update BEFORE UPDATE ON cooking_consumptions BEGIN SELECT RAISE(ABORT,'immutable cooking'); END;
CREATE TRIGGER consumptions_no_delete BEFORE DELETE ON cooking_consumptions BEGIN SELECT RAISE(ABORT,'immutable cooking'); END;

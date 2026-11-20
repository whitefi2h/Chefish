CREATE TABLE IF NOT EXISTS inventory_measurements(lot_id TEXT PRIMARY KEY REFERENCES inventory_lots(id), level INTEGER NOT NULL CHECK(level BETWEEN -1 AND 2), source TEXT NOT NULL, reference_servings INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_measurement_events(event_id TEXT PRIMARY KEY REFERENCES inventory_events(id), before_json TEXT, after_json TEXT);

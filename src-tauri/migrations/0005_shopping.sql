CREATE TABLE shopping_lines(
 id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
 unit TEXT NOT NULL CHECK(unit IN ('g','ml','个','片','盒')),
 source TEXT NOT NULL CHECK(source IN ('manual','plan')), week_start TEXT,
 requested_decimal TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1)),
 CHECK((source='manual' AND week_start IS NULL) OR (source='plan' AND week_start IS NOT NULL))
);
CREATE UNIQUE INDEX shopping_plan_key ON shopping_lines(week_start,ingredient_id,unit) WHERE source='plan';
CREATE TABLE purchase_events(id TEXT PRIMARY KEY,line_id TEXT NOT NULL REFERENCES shopping_lines(id),amount_decimal TEXT NOT NULL,occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE shopping_receipts(id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES purchase_events(id),lot_id TEXT NOT NULL REFERENCES inventory_lots(id),amount_decimal TEXT NOT NULL,occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE shopping_suppressions(week_start TEXT NOT NULL,ingredient_id TEXT NOT NULL REFERENCES ingredients(id),unit TEXT NOT NULL,PRIMARY KEY(week_start,ingredient_id,unit));
CREATE TRIGGER purchases_no_update BEFORE UPDATE ON purchase_events BEGIN SELECT RAISE(ABORT,'immutable purchase'); END;
CREATE TRIGGER purchases_no_delete BEFORE DELETE ON purchase_events BEGIN SELECT RAISE(ABORT,'immutable purchase'); END;
CREATE TRIGGER receipts_no_update BEFORE UPDATE ON shopping_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON shopping_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
CREATE INDEX purchase_line ON purchase_events(line_id);
CREATE INDEX receipt_purchase ON shopping_receipts(purchase_id);
CREATE INDEX receipt_lot ON shopping_receipts(lot_id);
INSERT INTO app_settings VALUES('shopping_memo','');

CREATE TABLE shopping_receipt_undos(id TEXT PRIMARY KEY,receipt_id TEXT NOT NULL UNIQUE REFERENCES shopping_receipts(id),occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TRIGGER receipt_undos_no_update BEFORE UPDATE ON shopping_receipt_undos BEGIN SELECT RAISE(ABORT,'immutable receipt undo'); END;
CREATE TRIGGER receipt_undos_no_delete BEFORE DELETE ON shopping_receipt_undos BEGIN SELECT RAISE(ABORT,'immutable receipt undo'); END;

-- Purchases made with the household one-step flow have exactly one receipt.
-- Undoing that receipt also cancels the corresponding purchase quantity.
CREATE TABLE shopping_combined_purchases(purchase_id TEXT PRIMARY KEY REFERENCES purchase_events(id));
CREATE TRIGGER shopping_combined_purchases_no_update BEFORE UPDATE ON shopping_combined_purchases BEGIN SELECT RAISE(ABORT,'immutable purchase link'); END;
CREATE TRIGGER shopping_combined_purchases_no_delete BEFORE DELETE ON shopping_combined_purchases BEGIN SELECT RAISE(ABORT,'immutable purchase link'); END;

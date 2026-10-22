ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE categories SET sort_order=rowid;

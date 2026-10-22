CREATE TABLE recipe_sources(revision_id TEXT PRIMARY KEY REFERENCES recipe_revisions(id), url TEXT NOT NULL, author TEXT NOT NULL, ingredient_text TEXT NOT NULL);
CREATE INDEX recipe_source_url ON recipe_sources(url);
CREATE TRIGGER recipe_sources_no_update BEFORE UPDATE ON recipe_sources BEGIN SELECT RAISE(ABORT,'immutable source'); END;
CREATE TRIGGER recipe_sources_no_delete BEFORE DELETE ON recipe_sources BEGIN SELECT RAISE(ABORT,'immutable source'); END;

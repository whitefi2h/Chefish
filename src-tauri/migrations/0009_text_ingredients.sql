CREATE TABLE recipe_text_ingredients(revision_id TEXT NOT NULL REFERENCES recipe_revisions(id),position INTEGER NOT NULL,name TEXT NOT NULL,amount_text TEXT NOT NULL,PRIMARY KEY(revision_id,position));
CREATE TRIGGER recipe_text_ingredients_no_update BEFORE UPDATE ON recipe_text_ingredients BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER recipe_text_ingredients_no_delete BEFORE DELETE ON recipe_text_ingredients BEGIN SELECT RAISE(ABORT,'immutable revision'); END;

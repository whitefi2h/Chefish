CREATE TABLE planned_meals(
 id TEXT PRIMARY KEY,
 recipe_revision_id TEXT REFERENCES recipe_revisions(id),
 custom_title TEXT,
 day TEXT NOT NULL,
 meal TEXT NOT NULL CHECK(meal IN ('早餐','午餐','晚餐')),
 servings INTEGER NOT NULL CHECK(servings BETWEEN 1 AND 12),
 sort_order INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1)),
 CHECK((recipe_revision_id IS NOT NULL AND custom_title IS NULL) OR
       (recipe_revision_id IS NULL AND custom_title IS NOT NULL AND length(trim(custom_title)) BETWEEN 1 AND 120))
);
CREATE INDEX planned_meal_date ON planned_meals(day,meal,sort_order);

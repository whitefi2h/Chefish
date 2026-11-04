use super::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    pub id: String,
    pub group: String,
    pub label: String,
    pub aliases: Vec<String>,
    pub broader_ids: Vec<String>,
    pub enabled: bool,
    pub deleted: bool,
    pub builtin: bool,
    pub default_enabled: bool,
    pub section: String,
    pub description: String,
    pub position: usize,
}
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub tag_ids: Vec<String>,
    pub legacy: Vec<String>,
    pub origin: String,
}
fn put(c: &Connection, key: &str, value: &impl Serialize) -> Result<()> {
    c.execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,serde_json::to_string(value).unwrap()])?;
    Ok(())
}
pub fn builtins() -> Vec<Definition> {
    let data: Value = serde_json::from_str(include_str!(
        "../../../resources/recipe-tags/catalog.v1.json"
    ))
    .unwrap();
    data["tags"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(position, t)| Definition {
            id: t["id"].as_str().unwrap().into(),
            group: t["group"].as_str().unwrap().into(),
            label: t["label"].as_str().unwrap().into(),
            aliases: serde_json::from_value(t["aliases"].clone()).unwrap(),
            broader_ids: serde_json::from_value(t["broaderIds"].clone()).unwrap(),
            enabled: t["defaultEnabled"].as_bool().unwrap(),
            default_enabled: t["defaultEnabled"].as_bool().unwrap(),
            deleted: false,
            builtin: true,
            section: t["section"].as_str().unwrap().into(),
            description: t["description"].as_str().unwrap_or("").into(),
            position,
        })
        .collect()
}
pub fn definitions(c: &Connection) -> Result<Vec<Definition>> {
    let mut q = c.prepare("SELECT value FROM app_settings WHERE key GLOB 'recipe_tag_def:*'")?;
    let mut out = q
        .query_map([], |r| r.get::<_, String>(0))?
        .map(|s| serde_json::from_str(&s?).map_err(|_| error("DATABASE_ERROR", "标签目录无法读取")))
        .collect::<Result<Vec<Definition>>>()?;
    out.sort_by_key(|t| t.position);
    Ok(out)
}
pub fn assignment(c: &Connection, recipe: &str) -> Result<Assignment> {
    let raw: Option<String> = c
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [format!("recipe_tag_links:{recipe}")],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|s| serde_json::from_str(&s).map_err(|_| error("DATABASE_ERROR", "菜谱标签无法读取")))
        .unwrap_or_else(|| Ok(Assignment::default()))
}
fn match_legacy<'a>(defs: &'a [Definition], name: &str) -> Option<&'a Definition> {
    let name = if name == "西式料理" {
        "西餐"
    } else {
        name
    };
    let hits = defs
        .iter()
        .filter(|t| {
            !t.deleted
                && (t.label.eq_ignore_ascii_case(name)
                    || t.aliases.iter().any(|a| a.eq_ignore_ascii_case(name)))
        })
        .collect::<Vec<_>>();
    if hits.len() == 1 {
        Some(hits[0])
    } else {
        defs.iter().find(|t| !t.deleted && t.label == name)
    }
}
pub fn migrate(c: &Connection) -> Result<()> {
    for def in builtins() {
        c.execute(
            "INSERT OR IGNORE INTO app_settings(key,value) VALUES(?1,?2)",
            params![
                format!("recipe_tag_def:{}", def.id),
                serde_json::to_string(&def).unwrap()
            ],
        )?;
    }
    let defs = definitions(c)?;
    let mut stmt =
        c.prepare("SELECT r.id,c.name FROM recipes r JOIN categories c ON c.id=r.category_id")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (id, category) in rows {
        let mut values = vec![category];
        let meta = steward::metadata(c, "recipe", &id)?;
        values.extend(
            meta["tags"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|t| t.as_str().map(str::to_string)),
        );
        let mut a = Assignment {
            origin: "migration".into(),
            ..Default::default()
        };
        for name in values {
            if name.trim().is_empty() || name == "未分类" {
                continue;
            }
            if let Some(t) = match_legacy(&defs, &name) {
                if !a.tag_ids.contains(&t.id) {
                    a.tag_ids.push(t.id.clone())
                }
            } else if !a.legacy.contains(&name) {
                a.legacy.push(name)
            }
        }
        put(c, &format!("recipe_tag_links:{id}"), &a)?;
    }
    let mut stmt =
        c.prepare("SELECT key,value FROM app_settings WHERE key GLOB 'steward_meta:*'")?;
    let old = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (key, raw) in old {
        let mut v: Value =
            serde_json::from_str(&raw).map_err(|_| error("DATABASE_ERROR", "旧标签无法迁移"))?;
        if let Some(o) = v.as_object_mut() {
            if let Some(tags) = o.remove("tags") {
                o.insert("legacyTags".into(), tags);
            }
            o.remove("tagsOrigin");
        }
        put(c, &key, &v)?;
    }
    Ok(())
}
// Remove the retired AI vocabulary, including words already mapped during v16 migration.
// Keep manual selections and original recipe categories.
pub fn remove_old_ai_tags(c: &Connection) -> Result<()> {
    let defs = definitions(c)?;
    for recipe in strings(c, "SELECT id FROM recipes")? {
        let category:String=c.query_row("SELECT cat.name FROM recipes r JOIN categories cat ON cat.id=r.category_id WHERE r.id=?1",[&recipe],|r|r.get(0))?;
        let mut meta = steward::metadata(c, "recipe", &recipe)?;
        let words = meta["legacyTags"]
            .as_array()
            .or(meta["tags"].as_array())
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect::<Vec<_>>();
        let mut a = assignment(c, &recipe)?;
        a.legacy
            .retain(|word| word == &category || !words.contains(word));
        if a.origin == "migration" || a.origin == "ai" {
            let original = match_legacy(&defs, &category).map(|t| t.id.clone());
            let obsolete = words
                .iter()
                .filter_map(|w| match_legacy(&defs, w).map(|t| t.id.clone()))
                .collect::<Vec<_>>();
            a.tag_ids
                .retain(|id| Some(id) == original.as_ref() || !obsolete.contains(id));
        }
        put(c, &format!("recipe_tag_links:{recipe}"), &a)?;
        if let Some(o) = meta.as_object_mut() {
            o.remove("legacyTags");
            o.remove("tags");
            o.remove("tagsOrigin");
        }
        put(c, &format!("steward_meta:recipe:{recipe}"), &meta)?;
    }
    Ok(())
}
fn check_revision(c: &Connection, expected: &str) -> Result<()> {
    if c.query_row(
        "SELECT value FROM app_settings WHERE key='data_revision'",
        [],
        |r| r.get::<_, String>(0),
    )? != expected
    {
        return Err(error(
            "STALE_REVISION",
            "标签或关联内容已变化，请重新打开后重试",
        ));
    }
    Ok(())
}
fn valid_ids(c: &Connection, ids: &[String], enabled_only: bool) -> Result<()> {
    let defs = definitions(c)?;
    for id in ids {
        if !defs
            .iter()
            .any(|t| t.id == *id && !t.deleted && (!enabled_only || t.enabled))
        {
            return Err(error(
                "INVALID_TAG",
                "请从现有且可用的标签目录选择；管家只能使用已开启标签",
            ));
        }
    }
    Ok(())
}
pub fn set(c: &Connection, recipe: &str, ids: Vec<String>, origin: &str) -> Result<()> {
    c.query_row("SELECT id FROM recipes WHERE id=?1", [recipe], |r| {
        r.get::<_, String>(0)
    })?;
    valid_ids(c, &ids, false)?;
    let mut a = assignment(c, recipe)?;
    if origin == "ai" {
        let defs = definitions(c)?;
        if ids.iter().any(|id| {
            !a.tag_ids.contains(id) && !defs.iter().any(|t| t.id == *id && t.enabled && !t.deleted)
        }) {
            return Err(error("INVALID_TAG", "管家只能新增已开启标签"));
        }
    }
    if origin == "ai" && a.origin == "user" {
        return Ok(());
    }
    a.tag_ids = ids
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    a.origin = origin.into();
    put(c, &format!("recipe_tag_links:{recipe}"), &a)
}
pub fn save_assignment(
    c: &Connection,
    expected: &str,
    recipe: &str,
    ids: Vec<String>,
) -> Result<()> {
    check_revision(c, expected)?;
    set(c, recipe, ids, "user")
}
pub fn from_draft(
    c: &Connection,
    recipe: &str,
    ids: &Option<Vec<String>>,
    category: &str,
    fresh: bool,
) -> Result<()> {
    if let Some(ids) = ids {
        // A newly created, unlabelled recipe remains eligible for maintenance.
        set(
            c,
            recipe,
            ids.clone(),
            if fresh && ids.is_empty() {
                "migration"
            } else {
                "user"
            },
        )?
    } else if fresh {
        let defs = definitions(c)?;
        let mut a = Assignment {
            origin: "migration".into(),
            ..Default::default()
        };
        if let Some(t) = match_legacy(&defs, category) {
            a.tag_ids.push(t.id.clone())
        } else if category != "未分类" {
            a.legacy.push(category.into())
        }
        put(c, &format!("recipe_tag_links:{recipe}"), &a)?;
    }
    Ok(())
}
pub fn save_definitions(c: &Connection, expected: &str, entries: Vec<Definition>) -> Result<()> {
    check_revision(c, expected)?;
    let old = definitions(c)?;
    let mut all = old
        .iter()
        .map(|t| (t.id.clone(), t.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut seen = BTreeSet::new();
    for mut t in entries {
        text(&t.label, 24)?;
        if !seen.insert(t.id.clone())
            || !["cuisine", "trait", "method", "custom"].contains(&t.group.as_str())
        {
            return Err(error("INVALID_TAG", "标签类型或 ID 无效"));
        }
        if let Some(prev) = all.get(&t.id) {
            if prev.group != t.group {
                return Err(error(
                    "INVALID_TAG",
                    "已有标签不能直接更改类型，请新建标签并迁移",
                ));
            }
            t.builtin = prev.builtin;
            t.default_enabled = prev.default_enabled;
            t.position = prev.position;
            if prev.label != t.label && !t.aliases.contains(&prev.label) {
                t.aliases.push(prev.label.clone())
            }
        } else {
            Uuid::parse_str(t.id.strip_prefix("user.").unwrap_or(""))
                .map_err(|_| error("INVALID_TAG", "自定义标签 ID 无效"))?;
            t.builtin = false;
            t.default_enabled = false;
            t.position = all.len();
        }
        t.label = t.label.trim().into();
        if t.aliases.len() > 30
            || t.aliases
                .iter()
                .any(|a| a.trim().is_empty() || a.chars().count() > 60)
            || t.description.chars().count() > 1000
        {
            return Err(error("INVALID_TAG", "标签名称、别名或说明过长"));
        }
        all.insert(t.id.clone(), t);
    }
    let mut names = BTreeSet::new();
    fn visit(
        id: &str,
        all: &BTreeMap<String, Definition>,
        path: &mut BTreeSet<String>,
    ) -> Result<()> {
        if !path.insert(id.into()) {
            return Err(error("INVALID_TAG", "上级标签不能循环引用"));
        }
        let t = &all[id];
        for parent in &t.broader_ids {
            let p = all
                .get(parent)
                .ok_or_else(|| error("INVALID_TAG", "上级标签不存在"))?;
            if p.group != t.group {
                return Err(error("INVALID_TAG", "上级标签须属于同一类型"));
            }
            visit(parent, all, path)?;
        }
        path.remove(id);
        Ok(())
    }
    for t in all.values() {
        if !t.deleted && !names.insert((t.group.clone(), t.label.to_lowercase())) {
            return Err(error("INVALID_TAG", "同类型标签名称不能重复"));
        }
        visit(&t.id, &all, &mut BTreeSet::new())?;
    }
    for id in seen {
        put(c, &format!("recipe_tag_def:{id}"), &all[&id])?
    }
    Ok(())
}
pub fn reset_visibility(c: &Connection, expected: &str) -> Result<()> {
    check_revision(c, expected)?;
    for mut t in definitions(c)? {
        if t.builtin && !t.deleted {
            t.enabled = t.default_enabled;
            put(c, &format!("recipe_tag_def:{}", t.id), &t)?
        }
    }
    Ok(())
}
pub fn merge(c: &Connection, expected: &str, source: &str, target: &str) -> Result<()> {
    check_revision(c, expected)?;
    valid_ids(c, &[source.into(), target.into()], false)?;
    let defs = definitions(c)?;
    let mut from = defs.iter().find(|t| t.id == source).unwrap().clone();
    let to = defs.iter().find(|t| t.id == target).unwrap();
    if source == target || from.group != to.group {
        return Err(error("INVALID_TAG", "只能合并同类型的不同标签"));
    }
    fn descends_from(defs: &[Definition], id: &str, parent: &str) -> bool {
        defs.iter().find(|t| t.id == id).is_some_and(|t| {
            t.broader_ids
                .iter()
                .any(|p| p == parent || descends_from(defs, p, parent))
        })
    }
    if descends_from(&defs, target, source) {
        return Err(error(
            "INVALID_TAG",
            "不能合并到自己的下级标签，请先调整上下级关系",
        ));
    }
    for id in strings(c, "SELECT id FROM recipes")? {
        let mut a = assignment(c, &id)?;
        if a.tag_ids.iter().any(|v| v == source) {
            a.tag_ids.retain(|v| v != source);
            if !a.tag_ids.contains(&target.to_string()) {
                a.tag_ids.push(target.into())
            }
            put(c, &format!("recipe_tag_links:{id}"), &a)?
        }
    }
    for mut t in defs {
        if t.broader_ids.contains(&source.to_string()) {
            t.broader_ids.retain(|v| v != source);
            if t.id != target && !t.broader_ids.contains(&target.to_string()) {
                t.broader_ids.push(target.into())
            }
            put(c, &format!("recipe_tag_def:{}", t.id), &t)?
        }
    }
    from.deleted = true;
    from.enabled = false;
    put(c, &format!("recipe_tag_def:{source}"), &from)
}
pub fn resolve_legacy(
    c: &Connection,
    expected: &str,
    name: &str,
    target: Option<String>,
) -> Result<()> {
    check_revision(c, expected)?;
    if let Some(id) = &target {
        valid_ids(c, &[id.clone()], false)?
    }
    for recipe in strings(c, "SELECT id FROM recipes")? {
        let mut a = assignment(c, &recipe)?;
        if a.legacy.iter().any(|n| n == name) {
            a.legacy.retain(|n| n != name);
            if let Some(id) = &target {
                if !a.tag_ids.contains(id) {
                    a.tag_ids.push(id.clone())
                }
                a.origin = "user".into();
            }
            put(c, &format!("recipe_tag_links:{recipe}"), &a)?
        }
    }
    Ok(())
}
pub fn enable_for_maintenance(c: &Connection, ids: &[String]) -> Result<()> {
    for mut t in definitions(c)? {
        if ids.contains(&t.id) && !t.deleted && !t.enabled {
            t.enabled = true;
            put(c, &format!("recipe_tag_def:{}", t.id), &t)?;
        }
    }
    Ok(())
}
pub fn refine_catalog(c: &Connection) -> Result<()> {
    let catalog: Value = serde_json::from_str(include_str!(
        "../../../resources/recipe-tags/catalog.v1.json"
    ))
    .unwrap();
    let retired = catalog["retiredPresets"].as_object().unwrap();
    let defs = definitions(c)?;
    for preset in builtins() {
        if let Some(old) = defs.iter().find(|t| t.id == preset.id) {
            if old.builtin {
                let mut updated = old.clone();
                updated.broader_ids = preset.broader_ids;
                put(c, &format!("recipe_tag_def:{}", old.id), &updated)?;
            }
        } else {
            put(c, &format!("recipe_tag_def:{}", preset.id), &preset)?;
        }
    }
    for (id, parent) in retired {
        if !defs.iter().any(|t| t.id == *id && t.builtin) {
            continue;
        }
        for recipe in strings(c, "SELECT id FROM recipes")? {
            let mut a = assignment(c, &recipe)?;
            if a.tag_ids.contains(id) {
                a.tag_ids.retain(|v| v != id);
                let target = parent.as_str().unwrap().to_string();
                if !a.tag_ids.contains(&target) {
                    a.tag_ids.push(target);
                }
                put(c, &format!("recipe_tag_links:{recipe}"), &a)?;
            }
        }
        for t in definitions(c)? {
            if t.broader_ids.contains(id) {
                let mut t = t;
                t.broader_ids.retain(|v| v != id);
                t.broader_ids.push(parent.as_str().unwrap().into());
                t.broader_ids.sort();
                t.broader_ids.dedup();
                put(c, &format!("recipe_tag_def:{}", t.id), &t)?;
            }
        }
        c.execute(
            "DELETE FROM app_settings WHERE key=?1",
            [format!("recipe_tag_def:{id}")],
        )?;
    }
    Ok(())
}
pub fn ai_catalog(c: &Connection) -> Result<Value> {
    Ok(json!(definitions(c)?.into_iter().map(|t|json!({"id":t.id,"group":t.group,"label":t.label,"aliases":t.aliases,"broaderIds":t.broader_ids,"enabled":t.enabled,"deleted":t.deleted})).collect::<Vec<_>>()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refined_presets_migrate_old_links_and_keep_user_tags() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let (recipe, _) = super::super::tests::create(&mut c);
        let mut old = builtins()[0].clone();
        old.id = "cuisine.thai".into();
        old.label = "泰国菜".into();
        old.broader_ids = vec!["cuisine.southeast-asian".into()];
        put(&c, "recipe_tag_def:cuisine.thai", &old).unwrap();
        let mut custom = old.clone();
        custom.id = "user.local".into();
        custom.builtin = false;
        put(&c, "recipe_tag_def:user.local", &custom).unwrap();
        set(&c, &recipe, vec![old.id.clone(), custom.id.clone()], "user").unwrap();
        c.pragma_update(None, "user_version", 17).unwrap();
        drop(c);
        let c = open(&path).unwrap();
        let defs = definitions(&c).unwrap();
        assert!(!defs.iter().any(|t| t.id == old.id));
        assert!(defs.iter().any(|t| t.id == custom.id));
        assert!(assignment(&c, &recipe)
            .unwrap()
            .tag_ids
            .contains(&"cuisine.southeast-asian".into()));
        assert_eq!(
            defs.iter()
                .find(|t| t.id == "cuisine.japanese")
                .unwrap()
                .broader_ids,
            vec!["cuisine.international"]
        );
        let mut custom = custom;
        custom.id = format!("user.{}", id());
        custom.label = "周末待试".into();
        custom.aliases.clear();
        custom.group = "custom".into();
        custom.broader_ids = vec![];
        let expected = steward::revision(&c).unwrap();
        save_definitions(&c, &expected, vec![custom]).unwrap();
    }
    #[test]
    fn enabling_tags_rechecks_previously_maintained_recipes() {
        let mut c = open(&super::super::tests::temp()).unwrap();
        let (recipe, _) = super::super::tests::create(&mut c);
        let work = steward::entities(&c).unwrap();
        let row = work.iter().find(|v| v["entityId"] == recipe).unwrap();
        c.execute(
            "INSERT INTO local_steward_checked VALUES(?1,?2)",
            params![
                format!("recipe:{recipe}"),
                row["signature"].as_str().unwrap()
            ],
        )
        .unwrap();
        assert!(!steward::entities(&c)
            .unwrap()
            .iter()
            .any(|v| v["entityId"] == recipe));
        let mut tag = definitions(&c)
            .unwrap()
            .into_iter()
            .find(|t| t.id == "cuisine.sichuan")
            .unwrap();
        tag.enabled = true;
        let expected = steward::revision(&c).unwrap();
        execute(
            &mut c,
            &id(),
            Command::SaveRecipeTagDefinitions {
                expected_revision: expected,
                entries: vec![tag],
            },
        )
        .unwrap();
        assert!(steward::entities(&c)
            .unwrap()
            .iter()
            .any(|v| v["entityId"] == recipe));
    }
    #[test]
    fn legacy_migration_removes_ai_words_and_preserves_original_category() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let (recipe, _) = super::super::tests::create(&mut c);
        c.execute(
            "INSERT OR REPLACE INTO app_settings(key,value) VALUES(?1,?2)",
            params![
                format!("steward_meta:recipe:{recipe}"),
                json!({"tags":["川菜","早餐","私房特别菜"]}).to_string()
            ],
        )
        .unwrap();
        c.pragma_update(None, "user_version", 15).unwrap();
        drop(c);
        let c = open(&path).unwrap();
        let a = assignment(&c, &recipe).unwrap();
        assert!(a.tag_ids.contains(&"trait.home".into()));
        assert!(!a.tag_ids.contains(&"cuisine.sichuan".into()));
        assert!(a.legacy.is_empty());
        assert!(steward::metadata(&c, "recipe", &recipe).unwrap()["tags"].is_null());
        assert!(serde_json::from_value::<Command>(json!({"type":"set_steward_tags","kind":"recipe","entity_id":recipe,"tags":["自由标签"]})).is_err());
        assert_eq!(definitions(&c).unwrap().len(), 101);
    }
    #[test]
    fn version_sixteen_cleanup_preserves_manual_choices_and_retires_global_inspiration() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let (recipe, _) = super::super::tests::create(&mut c);
        super::super::tests::create(&mut c);
        let manual: String = c
            .query_row("SELECT id FROM recipes WHERE id<>?1", [&recipe], |r| {
                r.get(0)
            })
            .unwrap();
        for (id, origin) in [(&recipe, "migration"), (&manual, "user")] {
            put(
                &c,
                &format!("recipe_tag_links:{id}"),
                &json!({
                    "tagIds":["trait.home","cuisine.sichuan"],
                    "legacy":["番茄"],"origin":origin
                }),
            )
            .unwrap();
            put(
                &c,
                &format!("steward_meta:recipe:{id}"),
                &json!({
                    "legacyTags":["川菜","番茄"], "other":"保留"
                }),
            )
            .unwrap();
        }
        c.execute(
            "INSERT INTO inspiration_recipes(recipe_id) VALUES(?1)",
            [&recipe],
        )
        .unwrap();
        c.pragma_update(None, "user_version", 16).unwrap();
        drop(c);
        let c = open(&path).unwrap();
        let a = assignment(&c, &recipe).unwrap();
        assert_eq!(a.tag_ids, vec!["trait.home"]);
        assert!(a.legacy.is_empty());
        assert!(assignment(&c, &manual)
            .unwrap()
            .tag_ids
            .contains(&"cuisine.sichuan".into()));
        let meta = steward::metadata(&c, "recipe", &recipe).unwrap();
        assert!(meta["legacyTags"].is_null());
        assert_eq!(meta["other"], "保留");
        assert_eq!(weekly_inspiration::current(&c).unwrap(), json!([]));
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM inspiration_recipes", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn definition_edits_assignments_undo_and_restart_share_the_existing_journal() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let (recipe, _) = super::super::tests::create(&mut c);
        let rev = |c: &Connection| {
            c.query_row(
                "SELECT value FROM app_settings WHERE key='data_revision'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
        };
        let mut tag = definitions(&c)
            .unwrap()
            .into_iter()
            .find(|t| t.id == "cuisine.sichuan")
            .unwrap();
        tag.enabled = true;
        tag.label = "四川风味".into();
        let expected = rev(&c);
        execute(
            &mut c,
            &id(),
            Command::SaveRecipeTagDefinitions {
                expected_revision: expected,
                entries: vec![tag.clone()],
            },
        )
        .unwrap();
        let expected = rev(&c);
        execute(
            &mut c,
            &id(),
            Command::SetRecipeTags {
                expected_revision: expected,
                recipe_id: recipe.clone(),
                tag_ids: vec![tag.id.clone()],
            },
        )
        .unwrap();
        let expected = rev(&c);
        let request = id();
        tag.deleted = true;
        execute(
            &mut c,
            &request,
            Command::SaveRecipeTagDefinitions {
                expected_revision: expected,
                entries: vec![tag.clone()],
            },
        )
        .unwrap();
        execute(
            &mut c,
            &id(),
            Command::Undo {
                operation_id: request,
            },
        )
        .unwrap();
        let def = definitions(&c)
            .unwrap()
            .into_iter()
            .find(|t| t.id == tag.id)
            .unwrap();
        assert!(!def.deleted);
        assert!(def.aliases.contains(&"川菜".into()));
        let expected = rev(&c);
        execute(
            &mut c,
            &id(),
            Command::ResetRecipeTagVisibility {
                expected_revision: expected,
            },
        )
        .unwrap();
        assert_eq!(
            assignment(&c, &recipe).unwrap().tag_ids,
            vec![tag.id.clone()]
        );
        drop(c);
        let c = open(&path).unwrap();
        assert_eq!(assignment(&c, &recipe).unwrap().origin, "user");
        assert!(
            !definitions(&c)
                .unwrap()
                .into_iter()
                .find(|t| t.id == tag.id)
                .unwrap()
                .enabled
        );
        assert!(set(&c, &recipe, vec!["not-a-real-tag".into()], "ai").is_err());
    }
    #[test]
    fn cycles_are_atomic_and_ai_cannot_overwrite_manual_tag_choices() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let (recipe, _) = super::super::tests::create(&mut c);
        set(&c, &recipe, vec!["trait.home".into()], "user").unwrap();
        set(&c, &recipe, vec!["method.stir-fry".into()], "ai").unwrap();
        assert_eq!(assignment(&c, &recipe).unwrap().tag_ids, vec!["trait.home"]);
        let before = definitions(&c).unwrap();
        let mut root = before
            .iter()
            .find(|t| t.id == "cuisine.chinese")
            .unwrap()
            .clone();
        root.broader_ids = vec!["cuisine.sichuan".into()];
        let revision = c
            .query_row(
                "SELECT value FROM app_settings WHERE key='data_revision'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        assert!(execute(
            &mut c,
            &id(),
            Command::SaveRecipeTagDefinitions {
                expected_revision: revision,
                entries: vec![root]
            }
        )
        .is_err());
        assert_eq!(
            serde_json::to_value(definitions(&c).unwrap()).unwrap(),
            serde_json::to_value(before).unwrap()
        );
    }
}

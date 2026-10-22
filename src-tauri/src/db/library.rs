use super::*;
use std::collections::BTreeSet;
#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    #[test]
    fn editable_step_titles_and_delete_survive_restart_without_touching_history() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let (recipe, first) = super::super::tests::create(&mut c);
        let old = recipe_history(&c, &recipe).unwrap()[0].clone();
        let mut draft = super::super::tests::draft();
        draft.steps = vec!["一行\n另一行".into(), "装盘".into()];
        draft.step_titles = vec!["小火慢煎".into(), "".into()];
        execute(
            &mut c,
            &id(),
            Command::ReviseRecipe {
                recipe_id: recipe.clone(),
                expected_revision_id: first,
                draft,
            },
        )
        .unwrap();
        let history = recipe_history(&c, &recipe).unwrap();
        assert_eq!(history[0]["stepTitles"], json!(["小火慢煎", ""]));
        assert_eq!(history[0]["steps"], json!(["一行\n另一行", "装盘"]));
        assert_eq!(history[1], old);
        let request = id();
        execute(
            &mut c,
            &request,
            Command::DeleteRecipe {
                recipe_id: recipe.clone(),
            },
        )
        .unwrap();
        execute(
            &mut c,
            &request,
            Command::DeleteRecipe {
                recipe_id: recipe.clone(),
            },
        )
        .unwrap();
        assert_eq!(snapshot(&c).unwrap()["recipes"], json!([]));
        drop(c);
        let c = open(&path).unwrap();
        assert_eq!(recipe_history(&c, &recipe).unwrap(), history);
        assert_eq!(snapshot(&c).unwrap()["lots"], json!([]));
    }
    #[test]
    fn version_browser_archive_restore_and_restart_preserve_originals() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let (recipe, first) = super::super::tests::create(&mut c);
        execute(
            &mut c,
            &id(),
            Command::CreateNote {
                recipe_id: recipe.clone(),
                date: "2026-10-20".into(),
                note: "原手记".into(),
            },
        )
        .unwrap();
        let mut next = super::super::tests::draft();
        next.name = "新版西兰花".into();
        next.ingredients[0].quantity = "200".into();
        execute(
            &mut c,
            &id(),
            Command::ReviseRecipe {
                recipe_id: recipe.clone(),
                expected_revision_id: first.clone(),
                draft: next,
            },
        )
        .unwrap();
        let history = recipe_history(&c, &recipe).unwrap();
        assert_eq!(history[0]["revisionNumber"], 2);
        assert_eq!(history[1]["revisionId"], first);
        assert_eq!(history[1]["requirements"][0]["quantity"], "0.123456");
        assert_eq!(recipe_history(&c, &id()).unwrap_err().code, "NOT_FOUND");
        execute(
            &mut c,
            &id(),
            Command::ArchiveRecipe {
                recipe_id: recipe.clone(),
            },
        )
        .unwrap();
        let archived = snapshot(&c).unwrap();
        assert_eq!(archived["recipes"], json!([]));
        assert_eq!(archived["archivedRecipes"][0]["name"], "新版西兰花");
        assert_eq!(archived["logs"][0]["revisionId"], first);
        assert_eq!(recipe_history(&c, &recipe).unwrap(), history);
        drop(c);
        let mut c = open(&path).unwrap();
        assert_eq!(snapshot(&c).unwrap(), archived);
        let request = id();
        execute(
            &mut c,
            &request,
            Command::RestoreRecipe {
                recipe_id: recipe.clone(),
            },
        )
        .unwrap();
        execute(
            &mut c,
            &request,
            Command::RestoreRecipe {
                recipe_id: recipe.clone(),
            },
        )
        .unwrap();
        let restored = snapshot(&c).unwrap();
        assert_eq!(restored["recipes"][0]["name"], "新版西兰花");
        assert_eq!(restored["archivedRecipes"], json!([]));
        assert_eq!(restored["logs"], archived["logs"]);
        assert_eq!(restored["lots"], archived["lots"]);
        assert_eq!(recipe_history(&c, &recipe).unwrap(), history);
        assert_eq!(
            execute(&mut c, &id(), Command::RestoreRecipe { recipe_id: recipe })
                .unwrap_err()
                .code,
            "NOT_FOUND"
        );
        assert_eq!(snapshot(&c).unwrap(), restored);
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CategoryEdit {
    pub original: Option<String>,
    pub name: String,
}
pub fn save_categories(
    tx: &Transaction,
    kind: &str,
    revision: &str,
    entries: Vec<CategoryEdit>,
) -> Result<()> {
    if !["recipe", "ingredient"].contains(&kind) || entries.len() > 100 {
        return Err(error("INVALID_INPUT", "分类无效或超过100项"));
    }
    let current: String = tx.query_row(
        "SELECT value FROM app_settings WHERE key='data_revision'",
        [],
        |r| r.get(0),
    )?;
    if current != revision {
        return Err(error(
            "STALE_REVISION",
            "分类或关联内容已变化，请重新打开分类管理",
        ));
    }
    let mut stmt = tx.prepare("SELECT id,name FROM categories WHERE kind=?1")?;
    let old = stmt
        .query_map([kind], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut names = BTreeSet::new();
    let mut originals = BTreeSet::new();
    for e in &entries {
        category_name(&e.name)?;
        if !names.insert(e.name.trim().to_string()) {
            return Err(error("INVALID_INPUT", "分类名称不能重复"));
        }
        if let Some(o) = &e.original {
            if !originals.insert(o.clone())
                || !old.iter().any(|(_, n)| n == o)
                || (o == "未分类" && e.name.trim() != "未分类")
            {
                return Err(error("INVALID_INPUT", "分类来源无效"));
            }
        }
    }
    if !entries
        .iter()
        .any(|e| e.original.as_deref() == Some("未分类") && e.name.trim() == "未分类")
    {
        return Err(error("INVALID_INPUT", "请保留未分类"));
    }
    let fallback = category(tx, kind, "未分类")?;
    let table = if kind == "recipe" {
        "recipes"
    } else {
        "ingredients"
    };
    for (key, name) in &old {
        if !originals.contains(name) {
            tx.execute(
                &format!("UPDATE {table} SET category_id=?1 WHERE category_id=?2"),
                params![fallback, key],
            )?;
            tx.execute("DELETE FROM categories WHERE id=?1", [key])?;
        } else if name != "未分类" {
            tx.execute(
                "UPDATE categories SET name=?1 WHERE id=?2",
                params![format!("__{}", &id()[..22]), key],
            )?;
        }
    }
    for (position, e) in entries.iter().enumerate() {
        if let Some(o) = &e.original {
            let key = &old.iter().find(|(_, n)| n == o).unwrap().0;
            tx.execute(
                "UPDATE categories SET name=?1,sort_order=?2 WHERE id=?3",
                params![e.name.trim(), position as i64, key],
            )?;
        } else {
            tx.execute(
                "INSERT INTO categories(id,kind,name,sort_order) VALUES(?1,?2,?3,?4)",
                params![id(), kind, e.name.trim(), position as i64],
            )?;
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn category_batch_is_atomic_preserves_links_and_survives_restart() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let (recipe, _) = super::super::tests::create(&mut c);
        let before = snapshot(&c).unwrap();
        let revision = before["dataRevision"].as_str().unwrap().to_string();
        let bad = vec![
            CategoryEdit {
                original: Some("未分类".into()),
                name: "未分类".into(),
            },
            CategoryEdit {
                original: Some("家常菜".into()),
                name: "未分类".into(),
            },
        ];
        assert!(execute(
            &mut c,
            &id(),
            Command::SaveCategories {
                kind: "recipe".into(),
                expected_revision: revision.clone(),
                entries: bad
            }
        )
        .is_err());
        assert_eq!(snapshot(&c).unwrap(), before);
        let entries = vec![
            CategoryEdit {
                original: Some("家常菜".into()),
                name: "工作日晚餐".into(),
            },
            CategoryEdit {
                original: Some("未分类".into()),
                name: "未分类".into(),
            },
            CategoryEdit {
                original: None,
                name: "汤羹".into(),
            },
        ];
        execute(
            &mut c,
            &id(),
            Command::SaveCategories {
                kind: "recipe".into(),
                expected_revision: revision.clone(),
                entries: entries.clone(),
            },
        )
        .unwrap();
        assert!(execute(
            &mut c,
            &id(),
            Command::SaveCategories {
                kind: "recipe".into(),
                expected_revision: revision,
                entries
            }
        )
        .is_err());
        drop(c);
        let mut c = open(&path).unwrap();
        let s = snapshot(&c).unwrap();
        assert_eq!(
            s["recipeCategories"],
            json!(["工作日晚餐", "未分类", "汤羹"])
        );
        assert_eq!(s["recipes"][0]["category"], "工作日晚餐");
        assert_eq!(s["recipes"][0]["id"], recipe);
        execute(
            &mut c,
            &id(),
            Command::SaveCategories {
                kind: "recipe".into(),
                expected_revision: s["dataRevision"].as_str().unwrap().into(),
                entries: vec![CategoryEdit {
                    original: Some("未分类".into()),
                    name: "未分类".into(),
                }],
            },
        )
        .unwrap();
        assert_eq!(snapshot(&c).unwrap()["recipes"][0]["category"], "未分类");
    }
    #[test]
    fn notes_edit_delete_conflicts_and_restart_do_not_touch_inventory() {
        let path = super::super::tests::temp();
        let mut c = open(&path).unwrap();
        let (recipe, _) = super::super::tests::create(&mut c);
        let inventory = inventory::lots(&c).unwrap();
        execute(
            &mut c,
            &id(),
            Command::CreateNote {
                recipe_id: recipe,
                date: "2026-10-20".into(),
                note: "少盐".into(),
            },
        )
        .unwrap();
        let note = snapshot(&c).unwrap()["logs"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        execute(
            &mut c,
            &id(),
            Command::EditNote {
                note_id: note.clone(),
                expected_note: "少盐".into(),
                note: "更少盐".into(),
            },
        )
        .unwrap();
        assert!(execute(
            &mut c,
            &id(),
            Command::DeleteNote {
                note_id: note.clone(),
                expected_note: "少盐".into()
            }
        )
        .is_err());
        drop(c);
        let mut c = open(&path).unwrap();
        assert_eq!(snapshot(&c).unwrap()["logs"][0]["note"], "更少盐");
        execute(
            &mut c,
            &id(),
            Command::DeleteNote {
                note_id: note,
                expected_note: "更少盐".into(),
            },
        )
        .unwrap();
        assert_eq!(inventory::lots(&c).unwrap(), inventory);
        drop(c);
        let c = open(&path).unwrap();
        assert_eq!(snapshot(&c).unwrap()["logs"], json!([]));
    }
}

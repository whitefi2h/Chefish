use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanDraft {
    pub recipe_revision_id: Option<String>,
    pub custom_title: Option<String>,
    pub day: String,
    pub meal: String,
    pub servings: i64,
}

pub fn save(
    tx: &Transaction,
    plan_id: Option<String>,
    expected: Option<i64>,
    draft: PlanDraft,
) -> Result<()> {
    if !valid_date(&draft.day)
        || !["早餐", "午餐", "晚餐"].contains(&draft.meal.as_str())
        || !(1..=12).contains(&draft.servings)
    {
        return Err(error("INVALID_INPUT", "请检查配餐日期、餐次和用餐人数"));
    }
    if let Some(ref key) = plan_id {
        super::cooking::editable(tx, key)?;
    }
    let previous = if let Some(ref key) = plan_id {
        Some(tx.query_row("SELECT recipe_revision_id,day,meal,sort_order,version FROM planned_meals WHERE id=?1 AND removed=0", [key], |r| Ok((r.get::<_,Option<String>>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,i64>(4)?))).optional()?.ok_or_else(||error("STALE_REVISION", "这道菜的安排已移除，请刷新后重试"))?)
    } else {
        None
    };
    if previous.as_ref().map(|p| p.4) != expected {
        return Err(error(
            "STALE_REVISION",
            "菜单已在其他操作中更新，请刷新后重试",
        ));
    }
    match (&draft.recipe_revision_id, &draft.custom_title) {
        (Some(rev), None) => {
            let archived = tx.query_row("SELECT r.archived FROM recipe_revisions v JOIN recipes r ON r.id=v.recipe_id WHERE v.id=?1", [rev], |r|r.get::<_,i64>(0)).optional()?.ok_or_else(||error("INVALID_INPUT", "未找到这份菜谱版本"))?;
            if archived != 0 && previous.as_ref().and_then(|p| p.0.as_ref()) != Some(rev) {
                return Err(error("INVALID_INPUT", "已归档的菜谱不能新加入菜单"));
            }
        }
        (None, Some(title)) => text(title, 120)?,
        _ => return Err(error("INVALID_INPUT", "请选择菜谱或输入临时菜名")),
    }
    let order = match &previous {
        Some(p) if p.1 == draft.day && p.2 == draft.meal => p.3,
        _ => tx.query_row("SELECT COALESCE(MAX(sort_order),0)+1 FROM planned_meals WHERE day=?1 AND meal=?2 AND removed=0", params![draft.day,draft.meal], |r|r.get(0))?,
    };
    let title = draft.custom_title.map(|s| s.trim().to_string());
    if let Some(key) = plan_id {
        tx.execute("UPDATE planned_meals SET recipe_revision_id=?1,custom_title=?2,day=?3,meal=?4,servings=?5,sort_order=?6,version=version+1 WHERE id=?7", params![draft.recipe_revision_id,title,draft.day,draft.meal,draft.servings,order,key])?;
    } else {
        tx.execute("INSERT INTO planned_meals(id,recipe_revision_id,custom_title,day,meal,servings,sort_order) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![id(),draft.recipe_revision_id,title,draft.day,draft.meal,draft.servings,order])?;
    }
    Ok(())
}

pub fn remove(tx: &Transaction, key: &str, version: i64) -> Result<()> {
    super::cooking::editable(tx, key)?;
    if tx.execute("UPDATE planned_meals SET removed=1,version=version+1 WHERE id=?1 AND version=?2 AND removed=0", params![key,version])? != 1 {
        return Err(error("STALE_REVISION", "菜单已更新，请刷新后重试"));
    }
    Ok(())
}

pub fn plans(conn: &Connection) -> Result<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT p.id,v.recipe_id,p.recipe_revision_id,p.custom_title,p.day,p.meal,p.servings,p.version FROM planned_meals p LEFT JOIN recipe_revisions v ON v.id=p.recipe_revision_id WHERE p.removed=0 ORDER BY p.day,p.meal,p.sort_order,p.rowid")?;
    let rows = stmt.query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?,"recipeId":r.get::<_,Option<String>>(1)?.unwrap_or_default(),"recipeRevisionId":r.get::<_,Option<String>>(2)?,"customTitle":r.get::<_,Option<String>>(3)?,"day":r.get::<_,String>(4)?,"meal":r.get::<_,String>(5)?,"servings":r.get::<_,i64>(6)?,"version":r.get::<_,i64>(7)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    rows.into_iter()
        .map(|mut plan| {
            if let Some(rev) = plan["recipeRevisionId"].as_str() {
                let recipe = recipe_snapshot(conn, rev)?;
                plan["recipeSnapshot"] = recipe;
            }
            plan["cooking"] = super::cooking::session(conn, plan["id"].as_str().unwrap())?;
            Ok(plan)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::tests::{create, draft as recipe_draft, temp};
    use super::*;
    fn draft(revision: Option<String>) -> PlanDraft {
        PlanDraft {
            custom_title: if revision.is_none() {
                Some("清炒时蔬".into())
            } else {
                None
            },
            recipe_revision_id: revision,
            day: "2026-12-31".into(),
            meal: "晚餐".into(),
            servings: 2,
        }
    }
    fn save_command(draft: PlanDraft) -> Command {
        Command::SavePlan {
            plan_id: None,
            expected_version: None,
            draft,
        }
    }
    #[test]
    fn multi_dish_custom_idempotency_and_restart_leave_inventory_unchanged() {
        let path = temp();
        let mut conn = open(&path).unwrap();
        let (_, rev) = create(&mut conn);
        let before = snapshot(&conn).unwrap();
        let request = id();
        let cmd = save_command(draft(Some(rev)));
        execute(&mut conn, &request, cmd.clone()).unwrap();
        execute(&mut conn, &request, cmd).unwrap();
        execute(&mut conn, &id(), save_command(draft(None))).unwrap();
        let after = snapshot(&conn).unwrap();
        assert_eq!(after["plans"].as_array().unwrap().len(), 2);
        assert_eq!(after["recipes"], before["recipes"]);
        assert_eq!(after["lots"], before["lots"]);
        assert_eq!(after["inventoryEvents"], before["inventoryEvents"]);
        assert_eq!(
            after["plans"][0]["recipeSnapshot"]["requirements"][0]["quantity"],
            "0.123456"
        );
        drop(conn);
        let conn = open(&path).unwrap();
        assert_eq!(snapshot(&conn).unwrap(), after);
    }
    #[test]
    fn revision_pinned_after_edit_and_archive_cross_week_move_and_remove() {
        let mut conn = open(&temp()).unwrap();
        let (recipe, rev) = create(&mut conn);
        execute(&mut conn, &id(), save_command(draft(Some(rev.clone())))).unwrap();
        let original = plans(&conn).unwrap()[0].clone();
        let mut edit = recipe_draft();
        edit.name = "新版本菜名".into();
        edit.ingredients[0].quantity = "100".into();
        execute(
            &mut conn,
            &id(),
            Command::ReviseRecipe {
                recipe_id: recipe.clone(),
                expected_revision_id: rev.clone(),
                draft: edit,
            },
        )
        .unwrap();
        execute(
            &mut conn,
            &id(),
            Command::ArchiveRecipe { recipe_id: recipe },
        )
        .unwrap();
        assert_eq!(plans(&conn).unwrap()[0], original);
        let key = original["id"].as_str().unwrap().to_string();
        let mut moved = draft(Some(rev.clone()));
        moved.day = "2027-01-05".into();
        moved.servings = 4;
        execute(
            &mut conn,
            &id(),
            Command::SavePlan {
                plan_id: Some(key.clone()),
                expected_version: Some(1),
                draft: moved,
            },
        )
        .unwrap();
        let after = plans(&conn).unwrap();
        assert_eq!(after[0]["day"], "2027-01-05");
        assert_eq!(after[0]["version"], 2);
        assert_eq!(after[0]["recipeSnapshot"], original["recipeSnapshot"]);
        assert!(execute(&mut conn, &id(), save_command(draft(Some(rev)))).is_err());
        assert!(execute(
            &mut conn,
            &id(),
            Command::RemovePlan {
                plan_id: key.clone(),
                expected_version: 1
            }
        )
        .is_err());
        execute(
            &mut conn,
            &id(),
            Command::RemovePlan {
                plan_id: key,
                expected_version: 2,
            },
        )
        .unwrap();
        assert!(plans(&conn).unwrap().is_empty());
    }
    #[test]
    fn invalid_and_conflicting_plans_roll_back_and_never_change_stock() {
        let mut conn = open(&temp()).unwrap();
        let (_, rev) = create(&mut conn);
        execute(&mut conn, &id(), save_command(draft(Some(rev)))).unwrap();
        let before = snapshot(&conn).unwrap();
        for invalid in [
            PlanDraft {
                day: "2026-02-30".into(),
                ..draft(None)
            },
            PlanDraft {
                servings: 0,
                ..draft(None)
            },
            PlanDraft {
                meal: "夜宵".into(),
                ..draft(None)
            },
            PlanDraft {
                custom_title: Some(" ".into()),
                ..draft(None)
            },
            PlanDraft {
                recipe_revision_id: Some(id()),
                custom_title: None,
                ..draft(None)
            },
        ] {
            assert!(execute(&mut conn, &id(), save_command(invalid)).is_err());
            assert_eq!(snapshot(&conn).unwrap(), before);
        }
        let key = before["plans"][0]["id"].as_str().unwrap().to_string();
        assert_eq!(
            execute(
                &mut conn,
                &id(),
                Command::SavePlan {
                    plan_id: Some(key),
                    expected_version: Some(99),
                    draft: draft(None)
                }
            )
            .unwrap_err()
            .code,
            "STALE_REVISION"
        );
        assert_eq!(snapshot(&conn).unwrap(), before);
        conn.execute_batch("CREATE TRIGGER reject_plan BEFORE INSERT ON planned_meals BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        assert!(execute(&mut conn, &id(), save_command(draft(None))).is_err());
        assert_eq!(snapshot(&conn).unwrap(), before);
    }
    #[test]
    fn migration_from_three_preserves_all_existing_data_and_backs_up() {
        let path = temp();
        let mut conn = open(&path).unwrap();
        create(&mut conn);
        let before = snapshot(&conn).unwrap();
        super::super::tests::downgrade_cooking(&conn);
        conn.execute_batch("DROP TABLE shopping_combined_purchases; DROP TABLE shopping_receipt_undos; DROP TABLE shopping_receipts; DROP TABLE purchase_events; DROP TABLE shopping_lines; DROP TABLE shopping_suppressions; DELETE FROM app_settings WHERE key='shopping_memo'; DROP TABLE planned_meals; DELETE FROM schema_migrations WHERE version>=4; PRAGMA user_version=3;").unwrap();
        drop(conn);
        let conn = open(&path).unwrap();
        assert_eq!(snapshot(&conn).unwrap(), before);
        let prefix = format!("{}.pre-v4-", path.file_stem().unwrap().to_string_lossy());
        let backup = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with(&prefix));
        assert!(backup);
    }
}

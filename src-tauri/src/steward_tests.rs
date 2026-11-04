use super::*;
#[test]
fn schedule_collapses_missed_periods_and_does_not_repeat_completed_slots() {
    let c = db::open(&std::env::temp_dir().join(format!(
        "chefish-steward-live-{}.sqlite3",
        uuid::Uuid::new_v4()
    )))
    .unwrap();
    data::save_settings(
        &c,
        data::Settings {
            enabled: true,
            ..Default::default()
        },
    )
    .unwrap();
    let early = due_at(&c, "2026-10-31", "17:59").unwrap();
    assert!(!early.iter().any(|(_, k)| k == "weekly"));
    let due = due_at(&c, "2026-10-31", "18:00").unwrap();
    let (key, _) = due.iter().find(|(_, k)| k == "weekly").unwrap();
    c.execute(
        "INSERT INTO local_steward_runs(run_key,kind,status) VALUES(?1,'weekly','done')",
        [key],
    )
    .unwrap();
    assert!(!due_at(&c, "2026-11-01", "20:00")
        .unwrap()
        .iter()
        .any(|(_, k)| k == "weekly"));
    assert!(!due_at(&c, "2026-11-02", "20:00")
        .unwrap()
        .iter()
        .any(|(_, k)| k == "weekly"));
    assert_eq!(
        due_at(&c, "2026-11-05", "20:00")
            .unwrap()
            .iter()
            .filter(|(_, k)| k == "maintenance")
            .count(),
        1
    );
}

#[test]
#[ignore = "live configured model, synthetic kitchen only"]
fn live_persistent_menu_and_incremental_maintenance() {
    let mut c = db::open(&std::env::temp_dir().join(format!(
        "chefish-steward-live-{}.sqlite3",
        uuid::Uuid::new_v4()
    )))
    .unwrap();
    let command = json!({"type":"create_recipe","draft":{"name":"清炒西兰花","category":"家常菜","minutes":15,"servings":2,"subtitle":"合成菜谱","seasoning":"","ingredients":[{"name":"西兰花","quantity":"300","unit":"g"}],"steps":["洗净切好炒熟"]}});
    db::execute(
        &mut c,
        &uuid::Uuid::new_v4().to_string(),
        serde_json::from_value(command).unwrap(),
    )
    .unwrap();
    let rev = db::snapshot(&c).unwrap()["recipes"][0]["revisionId"]
        .as_str()
        .unwrap()
        .to_string();
    let week = data::next_week(&c, &db::shopping::local_today(&c).unwrap()).unwrap();
    let d = data::start_draft(&c, &week).unwrap();
    let key = d["id"].as_str().unwrap();
    let local = assistant::context(&c, Some(&week)).unwrap();
    let mut d = d.clone();
    d["messages"] = json!([{"role":"user","content":"只安排周一晚餐，两人，用现有的清炒西兰花。"}]);
    let result = ai::completion(
        include_str!("steward_plan_prompt.txt"),
        json!({"local":local,"draft":d}),
    )
    .unwrap();
    let slots: Vec<data::Slot> = serde_json::from_value(result["slots"].clone()).unwrap();
    assert_eq!(slots.len(), 1);
    assert_eq!(slots[0].recipe_revision_id.as_deref(), Some(rev.as_str()));
    assert_eq!(slots[0].day, week);
    data::save_draft(&c,key,1,json!([{"role":"user","content":"只安排周一晚餐，两人"},{"role":"assistant","content":result["message"]}]),slots).unwrap();
    let current = data::draft(&c, key).unwrap();
    assert_eq!(data::plan_commands(&c, &current).unwrap().len(), 1);
    for name in ["鸡蛋", "Spaghetti", "AAA"] {
        db::execute(
            &mut c,
            &uuid::Uuid::new_v4().to_string(),
            serde_json::from_value(json!({"type":"receive_lot","draft":{"name":name,"category":"未分类","quantity":"1","unit":"个","location":if name=="鸡蛋" {"冷藏"} else {"未指定"},"received":"2026-10-28","expires":null,"precision":"rough"}})).unwrap(),
        )
        .unwrap();
    }
    let items = data::entities(&c).unwrap();
    let result = ai::completion(
        include_str!("steward_maintenance_prompt.txt"),
        json!({"today":"2026-10-28","allowEstimates":true,"items":items}),
    )
    .unwrap();
    let entries: Vec<data::MaintenanceEntry> =
        serde_json::from_value(result["entries"].clone()).unwrap();
    let questions = result["questions"].as_array().unwrap();
    assert!(questions.len() <= 3);
    for q in questions {
        assert_eq!(q["reason"], "unknown_identity");
        let row = items
            .iter()
            .find(|v| v["entityKind"] == q["entityKind"] && v["entityId"] == q["entityId"])
            .unwrap();
        assert_eq!(row["data"]["name"], "AAA");
    }

    assert_eq!(entries.len(), items.len());
    let revision = data::revision(&c).unwrap();
    db::execute_background(
        &mut c,
        &uuid::Uuid::new_v4().to_string(),
        db::Command::MaintainKitchen {
            expected_revision: revision,
            entries,
        },
    )
    .unwrap();
    println!(
        "live synthetic menu and maintenance validated; {}",
        result["summary"]
    );
}

#[test]
fn weekly_conversation_calls_real_tools_before_reply_without_changing_slots() {
    let draft = json!({"slots":[{"customTitle":"原菜单"}]});
    let mut tools = Vec::new();
    let out = plan_turn(json!({"draft":draft,"toolResults":[]}), |input| {
        if input["toolResults"].as_array().unwrap().is_empty() {
            Ok(json!({"action":"search","query":"玉米排骨汤"}))
        } else {
            assert_eq!(input["toolResults"][0]["result"][0]["title"],"玉米排骨汤");
            Ok(json!({"action":"reply","message":"已找到真实来源","updatePlan":false,"slots":input["draft"]["slots"]}))
        }
    }, |kind, request| {
        tools.push((kind.to_string(), request["query"].as_str().unwrap().to_string()));
        Ok(json!([{"title":"玉米排骨汤","url":"https://www.xiachufang.com/recipe/1/"}]))
    }).unwrap();
    assert_eq!(
        tools,
        vec![("search".to_string(), "玉米排骨汤".to_string())]
    );
    assert_eq!(out["slots"], draft["slots"]);
    assert_eq!(out["updatePlan"], false);
}

#[test]
#[ignore = "configured model and public recipe search, synthetic menu only"]
fn live_weekly_search_keeps_existing_menu() {
    let draft = json!({"weekStart":"2026-11-02","messages":[{"role":"user","content":"去搜玉米排骨汤，只推荐做法和来源，不要修改菜单。"}],"slots":[],"baseline":[]});
    let mut searched = false;
    let out = plan_turn(json!({"local":{"today":"2026-11-01","snapshot":{"recipes":[],"lots":[],"ingredients":[]},"preferences":{"defaultServings":1}},"draft":draft,"toolResults":[]}), |input| ai::completion(&weekly_prompt(),input), |kind, request| {
        assert_eq!(kind,"search"); searched = true;
        let rows = ai::search(request["query"].as_str().unwrap())?;
        assert!(!rows.as_array().unwrap().is_empty());
        Ok(rows)
    }).unwrap();
    assert!(searched);
    assert_eq!(out["updatePlan"], false);
    assert_eq!(out["action"], "reply");
    println!("synthetic weekly search reply: {}", out["message"]);
}

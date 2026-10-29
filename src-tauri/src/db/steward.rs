//! Persistent local collaboration; only business metadata enters replication.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    pub owner: String,
    pub do_not_disturb: bool,
    pub autostart: bool,
    pub weekly: bool,
    pub weekly_notify: bool,
    pub weekly_day: u8,
    pub weekly_time: String,
    pub maintenance: bool,
    pub maintenance_notify: bool,
    pub maintenance_time: String,
    pub recommendations: bool,
    pub recommendations_notify: bool,
    pub recommendations_day: u8,
    pub recommendations_time: String,
    pub recommendation_interval: u8,
    pub meals: Vec<String>,
    pub allow_estimates: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            owner: String::new(),
            do_not_disturb: false,
            autostart: false,
            weekly: true,
            weekly_notify: true,
            weekly_day: 6,
            weekly_time: "18:00".into(),
            maintenance: true,
            maintenance_notify: true,
            maintenance_time: "09:00".into(),
            recommendations: true,
            recommendations_notify: true,
            recommendations_day: 3,
            recommendations_time: "18:00".into(),
            recommendation_interval: 7,
            meals: vec!["晚餐".into()],
            allow_estimates: true,
        }
    }
}
pub fn settings(c: &Connection) -> Result<Settings> {
    let raw: Option<String> = c
        .query_row(
            "SELECT value FROM app_settings WHERE key='local_steward_settings'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    match raw {
        Some(v) => {
            serde_json::from_str(&v).map_err(|_| error("STEWARD_SETTINGS", "管家设置无法读取"))
        }
        None => Ok(Settings::default()),
    }
}
pub fn save_settings(c: &Connection, mut s: Settings) -> Result<()> {
    let valid_time = |t: &str| {
        t.len() == 5
            && t.as_bytes()[2] == b':'
            && t[..2].parse::<u8>().is_ok_and(|h| h < 24)
            && t[3..].parse::<u8>().is_ok_and(|m| m < 60)
    };
    if s.weekly_day > 6
        || s.recommendations_day > 6
        || ![1, 7, 14].contains(&s.recommendation_interval)
        || ![&s.weekly_time, &s.maintenance_time, &s.recommendations_time]
            .iter()
            .all(|t| t.is_ascii() && valid_time(t))
        || s.meals.is_empty()
        || s.meals.len() > 3
        || s.meals
            .iter()
            .any(|m| !["早餐", "午餐", "晚餐"].contains(&m.as_str()))
    {
        return Err(error("INVALID_INPUT", "请检查管家的时间、频率和餐次"));
    }
    if s.enabled {
        s.owner = sync::status(c)?.replica_id;
    }
    c.execute("INSERT INTO app_settings(key,value) VALUES('local_steward_settings',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&s).unwrap()])?;
    Ok(())
}
pub fn allowed(c: &Connection, kind: &str) -> Result<bool> {
    let s = settings(c)?;
    Ok(s.enabled
        && !s.do_not_disturb
        && s.owner == sync::status(c)?.replica_id
        && match kind {
            "weekly" => s.weekly,
            "maintenance" | "images" | "ingredients" => s.maintenance,
            "recommendations" => s.recommendations,
            _ => false,
        })
}
pub fn revision(c: &Connection) -> Result<String> {
    Ok(c.query_row(
        "SELECT value FROM app_settings WHERE key='data_revision'",
        [],
        |r| r.get(0),
    )?)
}
fn check_revision(c: &Connection, expected: &str) -> Result<()> {
    if revision(c)? != expected {
        return Err(error(
            "STALE_REVISION",
            "厨房数据已变化，请刷新后继续；草稿仍保留",
        ));
    }
    Ok(())
}
pub fn metadata(c: &Connection, kind: &str, id: &str) -> Result<Value> {
    let raw: Option<String> = c
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [format!("steward_meta:{kind}:{id}")],
            |r| r.get(0),
        )
        .optional()?;
    Ok(raw
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or(json!({})))
}
pub fn put_item(
    c: &Connection,
    key: &str,
    kind: &str,
    title: &str,
    body: &str,
    payload: Value,
) -> Result<String> {
    c.execute("INSERT INTO local_steward_items(id,unique_key,kind,title,body,payload) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(unique_key) DO UPDATE SET title=excluded.title,body=excluded.body,unread=CASE WHEN body!=excluded.body OR payload!=excluded.payload THEN 1 ELSE unread END,payload=excluded.payload WHERE local_steward_items.status='open'",params![id(),key,kind,title,body,payload.to_string()])?;
    Ok(c.query_row(
        "SELECT id FROM local_steward_items WHERE unique_key=?1",
        [key],
        |r| r.get(0),
    )?)
}
pub fn state(c: &Connection) -> Result<Value> {
    crate::ai::expire_task_history(c)?;
    // Older clients saved replies without moving the task out of pending.
    c.execute("UPDATE local_steward_items SET status='done',unread=0 WHERE status='open' AND EXISTS(SELECT 1 FROM app_settings a WHERE a.key='assistant_session:'||local_steward_items.id AND json_extract(a.value,'$.history.messages[#-1].role')='assistant' AND json_extract(a.value,'$.history.proposal') IS NULL AND NOT EXISTS(SELECT 1 FROM json_each(a.value,'$.history.candidates')) AND EXISTS(SELECT 1 FROM json_each(a.value,'$.history.messages') m WHERE json_extract(m.value,'$.role')='user'))",[])?;

    let mut q=c.prepare("SELECT id,kind,title,body,payload,status,unread,created_at FROM local_steward_items WHERE status='open' OR rowid IN (SELECT rowid FROM local_steward_items WHERE status!='open' AND (created_at >= datetime('now','-30 days') OR EXISTS(SELECT 1 FROM app_settings a WHERE a.key='assistant_session:'||local_steward_items.id)) ORDER BY rowid DESC) ORDER BY created_at DESC,rowid DESC")?;
    let mut items=q.query_map([],|r| {let raw:String=r.get(4)?;Ok(json!({"id":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"title":r.get::<_,String>(2)?,"body":r.get::<_,String>(3)?,"payload":serde_json::from_str::<Value>(&raw).unwrap_or(json!({})),"status":r.get::<_,String>(5)?,"unread":r.get::<_,i64>(6)?!=0,"createdAt":r.get::<_,String>(7)?}))})?.collect::<std::result::Result<Vec<_>,_>>()?;
    for item in &mut items {
        if item["kind"] == "recommendations" {
            if let Some(rows) = item["payload"]["candidates"].as_array_mut() {
                let mut titles = Vec::<String>::new();
                rows.retain(|v| {
                    let title = v["title"].as_str().unwrap_or("");
                    if titles.iter().any(|t| same_dish(t, title)) {
                        false
                    } else {
                        titles.push(title.to_string());
                        true
                    }
                });
            }
        }
        if item["kind"] == "maintenance" {
            let rows = item["payload"]["items"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            if let Some(questions) = item["payload"]["questions"].as_array_mut() {
                questions.retain(|q| {
                    q["reason"] == "unknown_identity"
                        || rows.iter().any(|r| {
                            r["entityId"] == q["entityId"]
                                && ambiguous_name(r["name"].as_str().unwrap_or(""))
                        })
                });
                questions.truncate(3);
            }
        }
        if let Some(rows) = item["payload"]["items"].as_array_mut() {
            for row in rows {
                if let (Some(kind), Some(key)) =
                    (row["entityKind"].as_str(), row["entityId"].as_str())
                {
                    row["metadata"] = metadata(c, kind, key)?;
                }
            }
        }
        if let Some(operations) = item["payload"]["operations"].as_array().cloned() {
            let mut active = Vec::new();
            for op in operations {
                if let Some(op) = op.as_str() {
                    if c.query_row("SELECT EXISTS(SELECT 1 FROM local_steward_undo WHERE operation_id=?1 AND undone=0)",[op],|r|r.get::<_,bool>(0))?{active.push(json!(op));}
                }
            }
            item["payload"]["operations"] = json!(active);
        }
    }
    let handled = items
        .iter()
        .filter(|v| {
            v["kind"] == "maintenance"
                && v["status"] != "open"
                && v["payload"]["mergedInto"].is_null()
        })
        .map(|v| question_keys(&v["payload"]))
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>();
    for item in &mut items {
        let keys = question_keys(&item["payload"]);
        if item["kind"] == "maintenance"
            && item["status"] == "open"
            && !keys.is_empty()
            && handled.contains(&keys)
        {
            c.execute(
                "UPDATE local_steward_items SET status='done',unread=0 WHERE id=?1",
                [item["id"].as_str().unwrap()],
            )?;
            item["status"] = json!("done");
            item["unread"] = json!(false);
        }
    }
    // Upgrade older per-run reports to one pending maintenance conversation.
    let pending = items
        .iter()
        .enumerate()
        .filter(|(_, v)| {
            v["kind"] == "maintenance" && v["status"] == "open" && v["payload"]["items"].is_array()
        })
        .map(|(i, _)| i)
        .collect::<Vec<_>>();
    if pending.len() > 1 {
        let mut canonical = pending[0];
        for &i in &pending {
            if c.query_row(
                "SELECT EXISTS(SELECT 1 FROM app_settings WHERE key=?1)",
                [format!(
                    "assistant_session:{}",
                    items[i]["id"].as_str().unwrap()
                )],
                |r| r.get::<_, bool>(0),
            )? {
                canonical = i;
                break;
            }
        }
        let mut payload = json!({"items":[],"questions":[],"operations":[]});
        for &i in &pending {
            merge_report(&mut payload, &items[i]["payload"]);
        }
        let key = items[canonical]["id"].as_str().unwrap().to_string();
        c.execute(
            "UPDATE local_steward_items SET payload=?1 WHERE id=?2",
            params![payload.to_string(), key],
        )?;
        items[canonical]["payload"] = payload;
        for &i in &pending {
            if i != canonical {
                items[i]["payload"]["mergedInto"] = json!(key);
                c.execute(
                    "UPDATE local_steward_items SET status='done',unread=0,payload=?2 WHERE id=?1",
                    params![
                        items[i]["id"].as_str().unwrap(),
                        items[i]["payload"].to_string()
                    ],
                )?;
                items[i]["status"] = json!("done");
                items[i]["unread"] = json!(false);
            }
        }
    }
    let runs=c.prepare("SELECT kind,status,error FROM local_steward_runs WHERE status IN ('retry','blocked') ORDER BY rowid DESC LIMIT 10")?.query_map([],|r|Ok(json!({"kind":r.get::<_,String>(0)?,"status":r.get::<_,String>(1)?,"error":r.get::<_,String>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(
        json!({"settings":settings(c)?,"deviceId":sync::status(c)?.replica_id,"items":items,"runs":runs}),
    )
}
pub fn maintenance_report(
    c: &Connection,
    key: &str,
    body: &str,
    operation: Option<&str>,
    questions: Vec<Value>,
    items: Vec<Value>,
) -> Result<()> {
    let pending: Option<String>=c.query_row("SELECT unique_key FROM local_steward_items WHERE kind='maintenance' AND status='open' AND json_type(payload,'$.items')='array' ORDER BY rowid DESC LIMIT 1",[],|r|r.get(0)).optional()?;
    let key = pending.as_deref().unwrap_or(key);
    let old: Option<String> = c
        .query_row(
            "SELECT payload FROM local_steward_items WHERE unique_key=?1",
            [key],
            |r| r.get(0),
        )
        .optional()?;
    let mut payload = old
        .and_then(|v| serde_json::from_str::<Value>(&v).ok())
        .unwrap_or(json!({"operations":[],"questions":[],"items":[]}));
    merge_report(
        &mut payload,
        &json!({"operations":operation.into_iter().collect::<Vec<_>>(),"questions":questions,"items":items}),
    );
    let _ = body;
    let summary = format!(
        "已检查并整理 {} 项厨房信息，{} 项食材需要辨认。",
        payload["items"].as_array().unwrap().len(),
        payload["questions"].as_array().unwrap().len()
    );
    put_item(c, key, "maintenance", "厨房整理结果", &summary, payload)?;
    Ok(())
}
pub fn save_tags(tx: &Transaction, kind: &str, key: &str, tags: Vec<String>) -> Result<()> {
    let table = match kind {
        "recipe" => "recipes",
        "ingredient" => "ingredients",
        "lot" => "inventory_lots",
        _ => return Err(error("INVALID_INPUT", "标签对象无效")),
    };
    if tags.len() > 12
        || tags
            .iter()
            .any(|t| t.trim().is_empty() || t.chars().count() > 24)
    {
        return Err(error("INVALID_INPUT", "标签最多12个，每个24字以内"));
    }
    tx.query_row(&format!("SELECT id FROM {table} WHERE id=?1"), [key], |r| {
        r.get::<_, String>(0)
    })?;
    let mut meta = metadata(tx, kind, key)?;
    meta["tags"] = json!(tags);
    meta["tagsOrigin"] = json!("user");
    tx.execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![format!("steward_meta:{kind}:{key}"),meta.to_string()])?;
    Ok(())
}
pub fn mark(c: &Connection, item_id: &str, status: &str) -> Result<()> {
    if !["open", "done", "dismissed", "read"].contains(&status) {
        return Err(error("INVALID_INPUT", "消息状态无效"));
    }
    c.execute("UPDATE local_steward_items SET unread=0,status=CASE WHEN ?1='read' THEN status ELSE ?1 END WHERE id=?2",params![status,item_id])?;
    if status == "dismissed" {
        c.execute("UPDATE local_steward_drafts SET status='cancelled' WHERE id=(SELECT json_extract(payload,'$.draftId') FROM local_steward_items WHERE id=?1) AND status='draft'",[item_id])?;
    }
    Ok(())
}
pub fn next_week(c: &Connection, today: &str) -> Result<String> {
    Ok(c.query_row(
        "SELECT date(?1,'+'||(7-((CAST(strftime('%w',?1) AS INTEGER)+6)%7))||' days')",
        [today],
        |r| r.get(0),
    )?)
}
pub fn weekly_question(c: &Connection, week: &str) -> Result<()> {
    shopping::validate_week(c, week)?;
    let lots = inventory::lots(c)?;
    let names = lots
        .iter()
        .filter(|l| l["quantity"] != "0")
        .take(4)
        .filter_map(|l| {
            c.query_row(
                "SELECT name FROM ingredients WHERE id=?1",
                [l["ingredientId"].as_str().unwrap_or("")],
                |r| r.get::<_, String>(0),
            )
            .ok()
        })
        .collect::<Vec<_>>()
        .join("、");
    let body = if names.is_empty() {
        "下周菜单要开始安排了。有没有特别想吃的？哪几天不在家吃饭？也可以告诉我人数、口味和时间要求。".into()
    } else {
        format!("下周菜单要开始安排了。库存里有{names}，可以优先考虑。有没有特别想吃的，或者哪几天不在家吃饭？")
    };
    put_item(
        c,
        &format!("weekly:{week}"),
        "weekly",
        &format!("安排 {week} 开始的一周"),
        &body,
        json!({"weekStart":week}),
    )?;
    Ok(())
}
fn week_plans(c: &Connection, week: &str) -> Result<Value> {
    let end: String = c.query_row("SELECT date(?1,'+6 days')", [week], |r| r.get(0))?;
    Ok(json!(planner::plans(c)?
        .into_iter()
        .filter(|p| p["day"]
            .as_str()
            .is_some_and(|d| d >= week && d <= end.as_str()))
        .map(|mut p| {
            p.as_object_mut().unwrap().remove("recipeSnapshot");
            p
        })
        .collect::<Vec<_>>()))
}
pub fn draft(c: &Connection, draft_id: &str) -> Result<Value> {
    c.query_row("SELECT id,week_start,messages,slots,baseline,version,status FROM local_steward_drafts WHERE id=?1",[draft_id],|r| {
        let parse=|i|->rusqlite::Result<Value>{let v:String=r.get(i)?;Ok(serde_json::from_str(&v).unwrap_or(Value::Null))};
        Ok(json!({"id":r.get::<_,String>(0)?,"weekStart":r.get::<_,String>(1)?,"messages":parse(2)?,"slots":parse(3)?,"baseline":parse(4)?,"version":r.get::<_,i64>(5)?,"status":r.get::<_,String>(6)?}))
    }).map_err(Into::into)
}
pub fn start_draft(c: &Connection, week: &str) -> Result<Value> {
    shopping::validate_week(c, week)?;
    if let Some(key)=c.query_row("SELECT id FROM local_steward_drafts WHERE week_start=?1 AND status='draft' ORDER BY rowid DESC LIMIT 1",[week],|r|r.get::<_,String>(0)).optional()? {return draft(c,&key);}
    let key = id();
    c.execute(
        "INSERT INTO local_steward_drafts(id,week_start,baseline,request_id) VALUES(?1,?2,?3,?4)",
        params![key, week, week_plans(c, week)?.to_string(), id()],
    )?;
    draft(c, &key)
}
pub fn attach_draft_task(c: &Connection, d: &Value) -> Result<String> {
    let week = d["weekStart"].as_str().unwrap();
    let existing: Option<(String,String)>=c.query_row("SELECT unique_key,body FROM local_steward_items WHERE kind='weekly' AND status='open' AND json_extract(payload,'$.weekStart')=?1 ORDER BY rowid DESC LIMIT 1",[week],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let (key, body) = existing.unwrap_or_else(|| {
        (
            format!("draft:{}", d["id"].as_str().unwrap()),
            "这周想吃些什么？也可以告诉我人数、口味和不在家吃饭的日子。".into(),
        )
    });
    put_item(
        c,
        &key,
        "weekly",
        "每周菜单规划",
        &body,
        json!({"weekStart":week,"draftId":d["id"]}),
    )
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Slot {
    pub plan_id: Option<String>,
    pub recipe_revision_id: Option<String>,
    pub custom_title: Option<String>,
    pub day: String,
    pub meal: String,
    pub servings: i64,
}
pub fn save_draft(
    c: &Connection,
    key: &str,
    version: i64,
    messages: Value,
    slots: Vec<Slot>,
) -> Result<Value> {
    let current = draft(c, key)?;
    if current["status"] != "draft" {
        return Err(error("STALE_REVISION", "这份草稿已经完成或取消"));
    }
    if slots.len() > 50 {
        return Err(error("INVALID_INPUT", "每次最多安排50道菜"));
    }
    let week = current["weekStart"].as_str().unwrap();
    let end: String = c.query_row("SELECT date(?1,'+6 days')", [week], |r| r.get(0))?;
    let baseline = current["baseline"].as_array().unwrap();
    let mut seen = std::collections::HashSet::new();
    for s in &slots {
        if !valid_date(&s.day)
            || s.day.as_str() < week
            || s.day > end
            || !["早餐", "午餐", "晚餐"].contains(&s.meal.as_str())
            || !(1..=12).contains(&s.servings)
        {
            return Err(error("INVALID_INPUT", "草稿含无效日期、餐次或人数"));
        }
        match (&s.recipe_revision_id, &s.custom_title) {
            (Some(rev), None) => {
                let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM recipe_revisions v JOIN recipes r ON r.id=v.recipe_id WHERE v.id=?1 AND r.archived=0)",[rev],|r|r.get(0))?;
                if !exists {
                    return Err(error("INVALID_INPUT", "草稿引用的菜谱已不存在或归档"));
                }
            }
            (None, Some(title)) => text(title, 120)?,
            _ => return Err(error("INVALID_INPUT", "请选择真实菜谱或明确的临时菜名")),
        }
        if let Some(id) = &s.plan_id {
            if !seen.insert(id)
                || !baseline
                    .iter()
                    .any(|p| p["id"] == *id && p["cooking"].is_null())
            {
                return Err(error(
                    "INVALID_INPUT",
                    "不能修改不属于该草稿或已经完成的菜单",
                ));
            }
        }
    }
    if !messages.is_array() || messages.to_string().len() > 200_000 {
        return Err(error("INVALID_INPUT", "草稿对话过长"));
    }
    if c.execute("UPDATE local_steward_drafts SET messages=?1,slots=?2,version=version+1 WHERE id=?3 AND version=?4 AND status='draft'",params![messages.to_string(),serde_json::to_string(&slots).unwrap(),key,version])?!=1 {return Err(error("STALE_REVISION","草稿已更新，请重新打开"));}
    draft(c, key)
}
pub fn plan_commands(c: &Connection, d: &Value) -> Result<Vec<Command>> {
    let week = d["weekStart"].as_str().unwrap();
    if week_plans(c, week)? != d["baseline"] {
        return Err(error(
            "DRAFT_CONFLICT",
            "正式菜单已有变化。草稿仍保留，请先查看最新菜单并重新核对。",
        ));
    }
    let slots: Vec<Slot> = serde_json::from_value(d["slots"].clone())
        .map_err(|_| error("INVALID_INPUT", "草稿无法读取"))?;
    if slots.is_empty() {
        return Err(error("INVALID_INPUT", "请先生成菜单草稿"));
    }
    let baseline = d["baseline"].as_array().unwrap();
    let mut out = Vec::new();
    for s in &slots {
        let previous = s
            .plan_id
            .as_ref()
            .and_then(|key| baseline.iter().find(|p| p["id"] == *key));
        let changed = previous.is_none_or(|p| {
            p["recipeRevisionId"] != json!(s.recipe_revision_id)
                || p["customTitle"] != json!(s.custom_title)
                || p["day"] != s.day
                || p["meal"] != s.meal
                || p["servings"] != s.servings
        });
        if changed {
            out.push(Command::SavePlan {
                plan_id: s.plan_id.clone(),
                expected_version: previous.and_then(|p| p["version"].as_i64()),
                draft: planner::PlanDraft {
                    recipe_revision_id: s.recipe_revision_id.clone(),
                    custom_title: s.custom_title.clone(),
                    day: s.day.clone(),
                    meal: s.meal.clone(),
                    servings: s.servings,
                },
            });
        }
    }
    for p in baseline {
        if p["cooking"].is_null()
            && !slots
                .iter()
                .any(|s| s.plan_id.as_deref() == p["id"].as_str())
        {
            out.push(Command::RemovePlan {
                plan_id: p["id"].as_str().unwrap().into(),
                expected_version: p["version"].as_i64().unwrap(),
            });
        }
    }
    Ok(out)
}
pub fn confirm_draft(c: &mut Connection, key: &str, version: i64) -> Result<Value> {
    let d = draft(c, key)?;
    let request: String = c.query_row(
        "SELECT request_id FROM local_steward_drafts WHERE id=?1",
        [key],
        |r| r.get(0),
    )?;
    let committed: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM command_receipts WHERE request_id=?1)",
        [&request],
        |r| r.get(0),
    )?;
    if committed {
        c.execute(
            "UPDATE local_steward_drafts SET status='confirmed' WHERE id=?1",
            [key],
        )?;
        return shopping::forecast(c, d["weekStart"].as_str().unwrap());
    }
    if d["status"] == "confirmed" {
        return shopping::forecast(c, d["weekStart"].as_str().unwrap());
    }
    if d["status"] != "draft" || d["version"] != version {
        return Err(error("STALE_REVISION", "草稿已更新或取消，请重新打开"));
    }
    let commands = plan_commands(c, &d)?;
    if !commands.is_empty() {
        execute(
            c,
            &request,
            Command::Batch {
                expected_revision: revision(c)?,
                commands,
            },
        )?;
    }
    // The receipt survives a crash between business commit and local status update.
    c.execute(
        "UPDATE local_steward_drafts SET status='confirmed' WHERE id=?1",
        [key],
    )?;
    c.execute("UPDATE local_steward_items SET status='done',unread=0 WHERE json_extract(payload,'$.draftId')=?1 OR unique_key=?2",params![key,format!("weekly:{}",d["weekStart"].as_str().unwrap())])?;
    shopping::forecast(c, d["weekStart"].as_str().unwrap())
}
pub fn rebase_draft(c: &Connection, key: &str, version: i64) -> Result<Value> {
    let d = draft(c, key)?;
    if d["status"] != "draft" || d["version"] != version {
        return Err(error("STALE_REVISION", "草稿已变化"));
    }
    // Keep the discussion, but regenerate slots against the current official week.
    c.execute(
        "UPDATE local_steward_drafts SET baseline=?1,slots='[]',version=version+1 WHERE id=?2",
        params![
            week_plans(c, d["weekStart"].as_str().unwrap())?.to_string(),
            key
        ],
    )?;
    draft(c, key)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaintenanceEntry {
    pub entity_kind: String,
    pub entity_id: String,
    pub signature: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub review_on: Option<String>,
    #[serde(default)]
    pub suggested_location: Option<String>,
    pub basis: String,
}
fn inspection_rows(c: &Connection) -> Result<Value> {
    let mut recipes=c.prepare("SELECT r.id,v.id,v.name,c.name,v.minutes,v.servings,v.subtitle FROM recipes r JOIN recipe_revisions v ON v.id=r.current_revision_id JOIN categories c ON c.id=r.category_id WHERE r.archived=0 ORDER BY r.rowid")?.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"revisionId":r.get::<_,String>(1)?,"name":r.get::<_,String>(2)?,"category":r.get::<_,String>(3)?,"minutes":r.get::<_,i64>(4)?,"servings":r.get::<_,i64>(5)?,"subtitle":r.get::<_,String>(6)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    for row in &mut recipes {
        let rev = row["revisionId"].as_str().unwrap();
        let names=c.prepare("SELECT i.name FROM recipe_ingredients v JOIN ingredients i ON i.id=v.ingredient_id WHERE v.revision_id=?1 UNION SELECT name FROM recipe_text_ingredients WHERE revision_id=?1")?.query_map([rev],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let steps = c
            .prepare(
                "SELECT body FROM recipe_steps WHERE revision_id=?1 ORDER BY position LIMIT 10",
            )?
            .query_map([rev], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        row["ingredients"] = json!(names);
        row["steps"] = json!(steps
            .into_iter()
            .map(|s| s.chars().take(300).collect::<String>())
            .collect::<Vec<_>>());
    }
    let ingredients=c.prepare("SELECT i.id,i.name,c.name FROM ingredients i JOIN categories c ON c.id=i.category_id ORDER BY i.rowid")?.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"category":r.get::<_,String>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(json!({"recipes":recipes,"ingredients":ingredients,"lots":inventory::lots(c)?}))
}
pub fn entities(c: &Connection) -> Result<Vec<Value>> {
    let s = inspection_rows(c)?;
    let mut out = Vec::new();
    for (kind, key) in [
        ("recipe", "recipes"),
        ("ingredient", "ingredients"),
        ("lot", "lots"),
    ] {
        if let Some(rows) = s[key].as_array() {
            for row in rows {
                let mut v = row.clone();
                if let Some(o) = v.as_object_mut() {
                    o.remove("media");
                    o.remove("image");
                    o.remove("events");
                }
                if kind == "lot" && row["quantity"] == "0" {
                    continue;
                }
                let entity_id = row["id"].as_str().unwrap_or("");
                v.as_object_mut().unwrap().remove("steward");
                if kind == "lot" {
                    v["name"] = json!(c.query_row(
                        "SELECT name FROM ingredients WHERE id=?1",
                        [row["ingredientId"].as_str().unwrap_or("")],
                        |r| r.get::<_, String>(0)
                    )?);
                }
                let signature = format!(
                    "inspection-v2:{}",
                    match kind {
                        "recipe" => json!([v["revisionId"], v["category"]]).to_string(),
                        "ingredient" => json!([v["name"], v["category"]]).to_string(),
                        _ => v.to_string(),
                    }
                );
                let checked: Option<String> = c
                    .query_row(
                        "SELECT signature FROM local_steward_checked WHERE entity_key=?1",
                        [format!("{kind}:{entity_id}")],
                        |r| r.get(0),
                    )
                    .optional()?;
                if checked.as_deref() != Some(&signature) {
                    out.push(json!({"entityKind":kind,"entityId":entity_id,"signature":signature,"data":v,"metadata":metadata(c,kind,entity_id)?}));
                }
            }
        }
    }
    Ok(out)
}
pub fn maintain(tx: &Transaction, expected: &str, entries: Vec<MaintenanceEntry>) -> Result<()> {
    check_revision(tx, expected)?;
    if entries.len() > 30 {
        return Err(error("INVALID_INPUT", "一次最多整理30项"));
    }
    let available = entities(tx)?;
    for e in entries {
        let original = available
            .iter()
            .find(|v| {
                v["entityKind"] == e.entity_kind
                    && v["entityId"] == e.entity_id
                    && v["signature"] == e.signature
            })
            .ok_or_else(|| error("STALE_REVISION", "待整理记录已变化"))?;
        if e.tags.len() > 12
            || e.tags
                .iter()
                .any(|t| t.trim().is_empty() || t.chars().count() > 24)
            || e.basis.chars().count() > 500
            || e.review_on.as_ref().is_some_and(|d| !valid_date(d))
        {
            return Err(error("INVALID_INPUT", "整理信息无效"));
        }
        let previous = metadata(tx, &e.entity_kind, &e.entity_id)?;
        let mut meta = previous.clone();
        if previous["tags"].is_null() && !e.tags.is_empty() {
            meta["tags"] = json!(e.tags);
        }
        if e.entity_kind == "lot" && settings(tx)?.allow_estimates {
            if original["data"]["expires"].is_null()
                && previous["reviewOn"].is_null()
                && previous["reviewOrigin"] != "user"
                && e.review_on.is_some()
            {
                meta["reviewOn"] = json!(e.review_on);
            }
            if let Some(location) = e.suggested_location {
                if !["冷藏", "冷冻", "常温"].contains(&location.as_str()) {
                    return Err(error("INVALID_INPUT", "推测库位无效"));
                }
                if original["data"]["location"] == "未指定"
                    && previous["suggestedLocation"].is_null()
                {
                    meta["suggestedLocation"] = json!(location);
                    inventory::change(
                        tx,
                        &e.entity_id,
                        original["data"]["version"].as_i64().unwrap(),
                        "move",
                        "0",
                        Some(&location),
                        &format!("AI推测：{}", e.basis),
                    )?;
                }
            }
        }
        if let Some(cat) = e.category {
            category_name(&cat)?;
            if e.entity_kind != "lot"
                && original["data"]["category"] == "未分类"
                && previous["categoryOrigin"] != "user"
            {
                let category = ensure_category(tx, &e.entity_kind, &cat)?;
                let table = if e.entity_kind == "recipe" {
                    "recipes"
                } else {
                    "ingredients"
                };
                tx.execute(
                    &format!("UPDATE {table} SET category_id=?1 WHERE id=?2"),
                    params![category, e.entity_id],
                )?;
                meta["categoryOrigin"] = json!("ai");
            }
        }
        if meta != previous {
            meta["origin"] = json!("ai");
            meta["basis"] = json!(e.basis);
            tx.execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![format!("steward_meta:{}:{}",e.entity_kind,e.entity_id),meta.to_string()])?;
        }
    }
    Ok(())
}
pub fn mark_checked(c: &Connection, work: &[Value]) -> Result<()> {
    let current = entities(c)?;
    for v in work {
        let key = format!(
            "{}:{}",
            v["entityKind"].as_str().unwrap(),
            v["entityId"].as_str().unwrap()
        );
        let signature = current
            .iter()
            .find(|n| n["entityKind"] == v["entityKind"] && n["entityId"] == v["entityId"])
            .unwrap_or(v)["signature"]
            .as_str()
            .unwrap();
        c.execute("INSERT INTO local_steward_checked VALUES(?1,?2) ON CONFLICT(entity_key) DO UPDATE SET signature=excluded.signature",params![key,signature])?;
    }
    Ok(())
}
pub fn recipe_source(c: &Connection, recipe: &str, raw: &RecipeDraft) -> Result<()> {
    let rev: String = c.query_row(
        "SELECT current_revision_id FROM recipes WHERE id=?1",
        [recipe],
        |r| r.get(0),
    )?;
    let rows=raw.ingredients.iter().map(|i|{
        let estimated=ingredient_standard::amount(&i.name,&i.quantity,&i.unit).is_ok_and(|v|v.3);
        json!({"name":ingredient_standard::name(&i.name),"sourceName":i.name,"quantity":i.quantity,"unit":i.unit,"estimated":estimated})
    }).collect::<Vec<_>>();
    c.execute(
        "INSERT INTO app_settings(key,value) VALUES(?1,?2)",
        params![
            format!("steward_meta:revision:{rev}"),
            json!({"ingredients":rows}).to_string()
        ],
    )?;
    Ok(())
}
pub fn undo(tx: &Transaction, key: &str) -> Result<()> {
    let payload: Option<Vec<u8>> = tx
        .query_row(
            "SELECT payload FROM local_steward_undo WHERE operation_id=?1 AND undone=0",
            [key],
            |r| r.get(0),
        )
        .optional()?;
    let payload = payload.ok_or_else(|| error("STALE_UNDO", "这次整理已撤销或没有可撤销修改"))?;
    tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
    replication::undo_payload(tx, &payload)
        .map_err(|_| error("UNDO_CONFLICT", "整理涉及的记录已有后续修改，本次未撤销"))?;
    tx.execute(
        "UPDATE local_steward_undo SET undone=1 WHERE operation_id=?1",
        [key],
    )?;
    let receipt: String = tx.query_row(
        "SELECT payload FROM command_receipts WHERE request_id=?1",
        [key],
        |r| r.get(0),
    )?;
    let receipt: Value =
        serde_json::from_str(&receipt).map_err(|_| error("DATABASE_ERROR", "整理凭据无法读取"))?;
    let entries = receipt["entries"]
        .as_array()
        .ok_or_else(|| error("DATABASE_ERROR", "整理凭据缺少对象"))?;
    let restored = entities(tx)?
        .into_iter()
        .filter(|v| {
            entries
                .iter()
                .any(|e| e["entityKind"] == v["entityKind"] && e["entityId"] == v["entityId"])
        })
        .collect::<Vec<_>>();
    mark_checked(tx, &restored)?;
    Ok(())
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IngredientRule {
    pub alias: String,
    pub canonical: String,
    pub from_unit: Option<String>,
    pub to_unit: Option<String>,
    pub factor: Option<String>,
}
pub fn save_rule(tx: &Transaction, expected: &str, rule: IngredientRule) -> Result<()> {
    check_revision(tx, expected)?;
    text(&rule.alias, 120)?;
    text(&rule.canonical, 120)?;
    if ingredient_standard::find(tx, &rule.canonical)?.is_none() {
        return Err(error("INVALID_INPUT", "目标食材不存在"));
    }
    if rule.factor.is_some() != (rule.from_unit.is_some() && rule.to_unit.is_some()) {
        return Err(error("INVALID_INPUT", "规格换算必须填写两个单位和数量"));
    }
    if let Some(f) = &rule.factor {
        shopping::quantity(f)?;
        if rule
            .from_unit
            .as_ref()
            .is_none_or(|u| !["个", "片", "盒", "g", "ml"].contains(&u.as_str()))
            || rule
                .to_unit
                .as_ref()
                .is_none_or(|u| !["个", "片", "盒", "g", "ml"].contains(&u.as_str()))
            || rule.from_unit == rule.to_unit
        {
            return Err(error("INVALID_INPUT", "换算单位无效"));
        }
    }
    let key = format!(
        "ingredient_rule:{}:{}",
        rule.alias,
        rule.from_unit.as_deref().unwrap_or("name")
    );
    tx.execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,serde_json::to_string(&rule).unwrap()])?;
    if rule.from_unit.is_some() {
        let alias = IngredientRule {
            from_unit: None,
            to_unit: None,
            factor: None,
            ..rule.clone()
        };
        tx.execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![format!("ingredient_rule:{}:name",rule.alias),serde_json::to_string(&alias).unwrap()])?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "steward_tests.rs"]
mod tests;

pub fn same_dish(a: &str, b: &str) -> bool {
    let normalize = |s: &str| {
        s.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    let (a, b) = (normalize(a), normalize(b));
    !a.is_empty()
        && (a == b
            || (a.chars().count().min(b.chars().count()) >= 3
                && (a.contains(&b) || b.contains(&a))))
}
fn ambiguous_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= 8
        && name
            .chars()
            .all(|c| c.is_ascii_digit() || c.is_ascii_uppercase())
}

fn merge_report(target: &mut Value, source: &Value) {
    for field in ["items", "questions", "operations"] {
        if let Some(rows) = source[field].as_array() {
            let out = target[field].as_array_mut().unwrap();
            for row in rows {
                let duplicate = out.iter().any(|old| {
                    if field == "operations" {
                        old == row
                    } else {
                        old["entityKind"] == row["entityKind"] && old["entityId"] == row["entityId"]
                    }
                });
                if !duplicate && (field != "questions" || out.len() < 3) {
                    out.push(row.clone());
                }
            }
        }
    }
}

fn question_keys(payload: &Value) -> Vec<String> {
    let mut keys = payload["questions"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|q| json!([q["entityKind"], q["entityId"], q["name"]]).to_string())
        .collect::<Vec<_>>();
    keys.sort();
    keys.dedup();
    keys
}

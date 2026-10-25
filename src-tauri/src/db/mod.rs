use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::Path, str::FromStr, time::Duration};
use uuid::Uuid;
pub mod cooking;
mod inventory;
mod library;
mod planner;
pub mod preferences;
pub mod seasonings;
pub mod shopping;
pub mod sync;
pub const CURRENT_SCHEMA: i64 = 12;
use inventory::InventoryDraft;

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, ApiError>;
impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        let code = match &e {
            rusqlite::Error::SqliteFailure(err, _)
                if err.code == rusqlite::ErrorCode::DatabaseBusy =>
            {
                "DATABASE_BUSY"
            }
            _ => "DATABASE_ERROR",
        };
        Self {
            code: code.into(),
            message: "本地数据库操作失败，未确认保存；请保留草稿后重试。".into(),
        }
    }
}
fn error(code: &str, message: &str) -> ApiError {
    ApiError {
        code: code.into(),
        message: message.into(),
    }
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn text(value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > max {
        return Err(error("INVALID_INPUT", "文字为空或超过长度限制"));
    }
    Ok(())
}
fn category_name(value: &str) -> Result<()> {
    text(value, 24)?;
    if ["全部菜谱", "我的收藏", "已归档", "全部类别", "全部位置"].contains(&value.trim())
    {
        return Err(error("INVALID_INPUT", "分类名称与筛选项冲突"));
    }
    Ok(())
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftIngredient {
    pub name: String,
    pub quantity: String,
    pub unit: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecipeSource {
    pub url: String,
    pub author: String,
    pub ingredient_text: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextIngredient {
    pub name: String,
    pub amount_text: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecipeDraft {
    #[serde(default)]
    pub ingredient_kinds: std::collections::BTreeMap<String, bool>,
    #[serde(default)]
    pub media: Option<crate::recipe_images::Media>,
    #[serde(default)]
    pub text_ingredients: Vec<TextIngredient>,
    #[serde(default)]
    pub source: Option<RecipeSource>,
    #[serde(default)]
    pub allow_source_duplicate: bool,
    #[serde(default)]
    pub step_titles: Vec<String>,
    pub name: String,
    pub category: String,
    pub minutes: i64,
    pub servings: i64,
    pub subtitle: String,
    pub seasoning: String,
    pub ingredients: Vec<DraftIngredient>,
    pub steps: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    SetLotExpiry {
        lot_id: String,
        expected_version: i64,
        expires: Option<String>,
        reason: String,
    },
    RemoveSeasoning {
        name: String,
        expected_revision: String,
    },
    RecordPurchase {
        line_id: Option<String>,
        expected_version: i64,
        ingredient_id: String,
        unit: String,
        week_start: Option<String>,
        quantity: String,
    },
    SetSeasoning {
        name: String,
        missing: bool,
        expected_revision: String,
    },
    Batch {
        expected_revision: String,
        commands: Vec<Command>,
    },
    CompleteCooking {
        draft: cooking::CompleteDraft,
    },
    UndoCooking {
        plan_id: String,
        expected_version: i64,
    },
    SaveShopping {
        line_id: Option<String>,
        expected_version: Option<i64>,
        draft: shopping::ManualDraft,
    },
    #[cfg(test)]
    #[serde(skip_deserializing)]
    BuyShopping {
        line_id: Option<String>,
        expected_version: i64,
        ingredient_id: String,
        unit: String,
        week_start: Option<String>,
        quantity: String,
    },
    PurchaseShopping {
        line_id: Option<String>,
        expected_version: i64,
        ingredient_id: String,
        unit: String,
        week_start: Option<String>,
        quantity: String,
        location: String,
        received: String,
        expires: Option<String>,
    },
    ReceiveShopping {
        line_id: String,
        expected_version: i64,
        quantity: String,
        location: String,
        received: String,
        expires: Option<String>,
    },
    RemoveShopping {
        line_id: String,
        expected_version: i64,
    },
    HideShopping {
        week_start: String,
        ingredient_id: String,
        unit: String,
    },
    RefreshShopping {
        week_start: String,
    },
    SaveShoppingMemo {
        memo: String,
        expected_revision: String,
    },
    SavePlan {
        plan_id: Option<String>,
        expected_version: Option<i64>,
        draft: planner::PlanDraft,
    },
    RemovePlan {
        plan_id: String,
        expected_version: i64,
    },
    MoveCategory {
        kind: String,
        name: String,
        direction: i64,
    },
    UndoInventory {
        lot_id: String,
        expected_version: i64,
    },
    ReceiveLot {
        draft: InventoryDraft,
    },
    ChangeLot {
        lot_id: String,
        expected_version: i64,
        operation: String,
        quantity: String,
        location: Option<String>,
        reason: String,
    },
    ReverseInventoryEvent {
        event_id: String,
        reason: String,
    },
    CreateRecipe {
        draft: RecipeDraft,
    },
    ReviseRecipe {
        recipe_id: String,
        expected_revision_id: String,
        draft: RecipeDraft,
    },
    ArchiveRecipe {
        recipe_id: String,
    },
    DeleteRecipe {
        recipe_id: String,
    },
    RestoreRecipe {
        recipe_id: String,
    },
    Favorite {
        recipe_id: String,
        enabled: bool,
    },
    Inspiration {
        recipe_id: String,
        enabled: bool,
    },
    SaveCategories {
        kind: String,
        expected_revision: String,
        entries: Vec<library::CategoryEdit>,
    },
    EditNote {
        note_id: String,
        expected_note: String,
        note: String,
    },
    DeleteNote {
        note_id: String,
        expected_note: String,
    },
    CreateNote {
        recipe_id: String,
        date: String,
        note: String,
    },
    AddCategory {
        kind: String,
        name: String,
    },
    RenameCategory {
        kind: String,
        old: String,
        name: String,
    },
    RemoveCategory {
        kind: String,
        name: String,
    },
    AssignCategory {
        kind: String,
        entity_id: String,
        name: String,
    },
}
pub fn open(path: &Path) -> Result<Connection> {
    let mut connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
    )?;
    migrate(&mut connection, path)?;
    sync::initialize(&connection)?;
    Ok(connection)
}
fn migrate(connection: &mut Connection, path: &Path) -> Result<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > CURRENT_SCHEMA {
        return Err(error(
            "NEWER_SCHEMA",
            "数据库版本高于当前程序，请使用较新版本；未重建数据库。",
        ));
    }
    if version == 0 {
        let tables: i64 = connection.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |r| r.get(0),
        )?;
        if tables > 0 {
            return Err(error("UNKNOWN_SCHEMA", "发现未知数据结构，拒绝自动覆盖。"));
        }
        if path.exists() && path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            let backup_path = path.with_extension(format!("pre-migration-{}.sqlite3", id()));
            connection.backup("main", &backup_path, None)?;
        }
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("../../migrations/0001_recipes.sql"))?;
        for (kind, names) in [
            (
                "recipe",
                vec!["家常菜", "西式料理", "轻食沙拉", "早餐", "未分类"],
            ),
            (
                "ingredient",
                vec!["肉禽蛋", "蔬菜菌菇", "主食调味", "未分类"],
            ),
        ] {
            for name in names {
                tx.execute(
                    "INSERT INTO categories(id,kind,name) VALUES(?1,?2,?3)",
                    params![id(), kind, name],
                )?;
            }
        }
        tx.execute("INSERT INTO schema_migrations(version) VALUES(1)", [])?;
        tx.pragma_update(None, "user_version", 1)?;
        tx.commit()?;
    }
    if version < 2 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v2-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("../../migrations/0002_inventory.sql"))?;
        tx.execute("INSERT INTO schema_migrations(version) VALUES(2)", [])?;
        tx.pragma_update(None, "user_version", 2)?;
        tx.commit()?;
    }
    if version < 3 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v3-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("../../migrations/0003_category_order.sql"))?;
        tx.execute("INSERT INTO schema_migrations(version) VALUES(3)", [])?;
        tx.pragma_update(None, "user_version", 3)?;
        tx.commit()?;
    }
    if version < 4 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v4-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("../../migrations/0004_planner.sql"))?;
        tx.execute("INSERT INTO schema_migrations(version) VALUES(4)", [])?;
        tx.pragma_update(None, "user_version", 4)?;
        tx.commit()?;
    }
    if version < 5 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v5-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("../../migrations/0005_shopping.sql"))?;
        tx.execute("INSERT INTO schema_migrations(version) VALUES(5)", [])?;
        tx.pragma_update(None, "user_version", 5)?;
        tx.commit()?;
    }
    if version < 6 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v6-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("../../migrations/0006_purchase_stock.sql"))?;
        tx.execute("INSERT INTO schema_migrations(version) VALUES(6)", [])?;
        tx.pragma_update(None, "user_version", 6)?;
        tx.commit()?;
    }
    if version < 7 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v7-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("../../migrations/0007_cooking.sql"))?;
        tx.execute("INSERT INTO schema_migrations(version) VALUES(7)", [])?;
        tx.pragma_update(None, "user_version", 7)?;
        tx.commit()?;
    }
    if version < 8 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v8-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("../../migrations/0008_recipe_sources.sql"))?;
        tx.execute("INSERT INTO schema_migrations(version) VALUES(8)", [])?;
        tx.pragma_update(None, "user_version", 8)?;
        tx.commit()?;
    }
    if version < 9 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v9-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("../../migrations/0009_text_ingredients.sql"))?;
        tx.execute("INSERT INTO schema_migrations(version) VALUES(9)", [])?;
        tx.pragma_update(None, "user_version", 9)?;
        tx.commit()?;
    }
    if version < 10 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v10-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS recipe_media (revision_id TEXT PRIMARY KEY REFERENCES recipe_revisions(id), content TEXT NOT NULL);")?;
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES(10)",
            [],
        )?;
        tx.pragma_update(None, "user_version", 10)?;
        tx.commit()?;
    }
    if version < 11 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v11-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS recipe_ingredient_kinds(revision_id TEXT PRIMARY KEY REFERENCES recipe_revisions(id),content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS seasoning_supplies(name TEXT PRIMARY KEY,missing INTEGER NOT NULL DEFAULT 0 CHECK(missing IN (0,1)));")?;
        for name in ["盐", "糖", "生抽", "老抽", "蚝油", "料酒", "醋", "食用油"] {
            tx.execute(
                "INSERT OR IGNORE INTO seasoning_supplies(name) VALUES(?1)",
                [name],
            )?;
        }
        let mut stmt = tx.prepare(
            "SELECT name FROM ingredients UNION SELECT name FROM recipe_text_ingredients",
        )?;
        let names = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(stmt);
        for name in names {
            if seasonings::common(&name) {
                tx.execute(
                    "INSERT OR IGNORE INTO seasoning_supplies(name) VALUES(?1)",
                    [name],
                )?;
            }
        }
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES(11)",
            [],
        )?;
        tx.pragma_update(None, "user_version", 11)?;
        tx.commit()?;
    }
    if version < 12 {
        connection.backup(
            "main",
            path.with_extension(format!("pre-v12-{}.sqlite3", id())),
            None,
        )?;
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("../../migrations/0012_sync_outbox.sql"))?;
        tx.execute("INSERT INTO schema_migrations(version) VALUES(12)", [])?;
        tx.pragma_update(None, "user_version", 12)?;
        tx.commit()?;
    }
    Ok(())
}
fn category(conn: &Connection, kind: &str, name: &str) -> Result<String> {
    category_name(name)?;
    if !["recipe", "ingredient"].contains(&kind) {
        return Err(error("INVALID_INPUT", "未知分类类型"));
    }
    conn.query_row(
        "SELECT id FROM categories WHERE kind=?1 AND name=?2",
        params![kind, name.trim()],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| error("NOT_FOUND", "分类不存在，请刷新"))
}
fn ensure_category(conn: &Connection, kind: &str, name: &str) -> Result<String> {
    match category(conn, kind, name) {
        Ok(value) => Ok(value),
        Err(e) if e.code == "NOT_FOUND" => {
            let value = id();
            conn.execute(
                "INSERT INTO categories(id,kind,name,sort_order) VALUES(?1,?2,?3,(SELECT COALESCE(MAX(sort_order),0)+1 FROM categories))",
                params![value, kind, name.trim()],
            )?;
            Ok(value)
        }
        Err(e) => Err(e),
    }
}
fn current(conn: &Connection, recipe: &str) -> Result<String> {
    conn.query_row(
        "SELECT current_revision_id FROM recipes WHERE id=?1 AND archived=0",
        [recipe],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| error("NOT_FOUND", "菜谱不存在或已归档"))
}
pub(crate) fn validate(draft: &RecipeDraft) -> Result<()> {
    if let Some(media) = &draft.media {
        crate::recipe_images::validate(media)?;
    }
    text(&draft.name, 120)?;
    category_name(&draft.category)?;
    if !(1..=1440).contains(&draft.minutes)
        || !(1..=12).contains(&draft.servings)
        || draft.steps.is_empty()
        || draft.steps.len() > 50
        || (!draft.step_titles.is_empty() && draft.step_titles.len() != draft.steps.len())
        || draft.step_titles.iter().any(|s| s.chars().count() > 120)
        || draft.ingredients.len() > 100
        || draft.subtitle.chars().count() > 2000
        || draft.seasoning.chars().count() > 2000
    {
        return Err(error("INVALID_INPUT", "菜谱字段超出限制"));
    }
    if draft.text_ingredients.len() + draft.ingredients.len() > 100 {
        return Err(error("INVALID_INPUT", "食材最多100项"));
    }
    for item in &draft.text_ingredients {
        text(&item.name, 120)?;
        text(&item.amount_text, 200)?;
    }
    for step in &draft.steps {
        text(step, 2000)?;
    }
    for item in &draft.ingredients {
        text(&item.name, 120)?;
        let number = rust_decimal::Decimal::from_str(&item.quantity)
            .map_err(|_| error("INVALID_QUANTITY", "用量必须是有效十进制字符串"))?;
        if number <= rust_decimal::Decimal::ZERO
            || number > rust_decimal::Decimal::from(100000)
            || number.scale() > 6
            || ![
                'g'.to_string(),
                "ml".into(),
                "个".into(),
                "片".into(),
                "盒".into(),
            ]
            .contains(&item.unit)
        {
            return Err(error(
                "INVALID_QUANTITY",
                "用量须大于零、至多六位小数，单位须受支持",
            ));
        }
    }
    Ok(())
}
fn save_recipe(tx: &Transaction, recipe: Option<(&str, &str)>, draft: &RecipeDraft) -> Result<()> {
    validate(draft)?;
    if let Some(source) = &draft.source {
        crate::recipe_import::canonical_url(&source.url)?;
        if source.author.chars().count() > 120
            || source.ingredient_text.len() > 100
            || source
                .ingredient_text
                .iter()
                .any(|v| v.chars().count() > 200)
        {
            return Err(error("INVALID_INPUT", "来源信息过长"));
        }
        if recipe.is_none() && !draft.allow_source_duplicate {
            let count:i64 = tx.query_row("SELECT count(*) FROM recipes r JOIN recipe_sources s ON s.revision_id=r.current_revision_id WHERE r.archived=0 AND s.url=?1", [crate::recipe_import::canonical_url(&source.url)?], |r|r.get(0))?;
            if count > 0 {
                return Err(error(
                    "SOURCE_EXISTS",
                    "已有同来源菜谱，请选择更新已有菜谱或另存副本",
                ));
            }
        }
    }
    let category = ensure_category(tx, "recipe", &draft.category)?;
    let recipe_id = recipe.map(|r| r.0.to_string()).unwrap_or_else(id);
    let number = if let Some((_, expected)) = recipe {
        if current(tx, &recipe_id)? != expected {
            return Err(error(
                "STALE_REVISION",
                "菜谱已变化，请刷新后重试，草稿未覆盖",
            ));
        }
        tx.query_row(
            "SELECT max(revision_number)+1 FROM recipe_revisions WHERE recipe_id=?1",
            [&recipe_id],
            |r| r.get::<_, i64>(0),
        )?
    } else {
        tx.execute(
            "INSERT INTO recipes(id,category_id) VALUES(?1,?2)",
            params![recipe_id, category],
        )?;
        1
    };
    let revision = id();
    tx.execute("INSERT INTO recipe_revisions(id,recipe_id,revision_number,name,subtitle,minutes,servings,seasoning) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![revision,recipe_id,number,draft.name.trim(),draft.subtitle,draft.minutes,draft.servings,draft.seasoning])?;
    if let Some(source) = &draft.source {
        tx.execute(
            "INSERT INTO recipe_sources VALUES(?1,?2,?3,?4)",
            params![
                revision,
                crate::recipe_import::canonical_url(&source.url)?,
                source.author,
                serde_json::to_string(&source.ingredient_text)
                    .map_err(|_| error("INVALID_INPUT", "来源用量无效"))?
            ],
        )?;
    } else if let Some((_, expected)) = recipe {
        tx.execute("INSERT INTO recipe_sources SELECT ?1,url,author,ingredient_text FROM recipe_sources WHERE revision_id=?2", params![revision,expected])?;
    }
    if let Some(media) = &draft.media {
        tx.execute(
            "INSERT INTO recipe_media VALUES(?1,?2)",
            params![
                revision,
                serde_json::to_string(media).map_err(|_| error("INVALID_INPUT", "图片内容无效"))?
            ],
        )?;
    } else if let Some((_, expected)) = recipe {
        tx.execute(
            "INSERT INTO recipe_media SELECT ?1,content FROM recipe_media WHERE revision_id=?2",
            params![revision, expected],
        )?;
    }
    if draft.ingredient_kinds.len() > 100
        || draft
            .ingredient_kinds
            .keys()
            .any(|k| k.trim().is_empty() || k.chars().count() > 120)
    {
        return Err(error("INVALID_INPUT", "配料类型格式不正确"));
    }
    tx.execute(
        "INSERT INTO recipe_ingredient_kinds VALUES(?1,?2)",
        params![
            revision,
            serde_json::to_string(&draft.ingredient_kinds).unwrap()
        ],
    )?;
    for name in draft
        .ingredients
        .iter()
        .map(|i| i.name.trim())
        .chain(draft.text_ingredients.iter().map(|i| i.name.trim()))
    {
        if draft
            .ingredient_kinds
            .get(name)
            .copied()
            .unwrap_or_else(|| seasonings::common(name))
        {
            tx.execute(
                "INSERT OR IGNORE INTO seasoning_supplies(name) VALUES(?1)",
                [name],
            )?;
        }
    }
    for (position, item) in draft.text_ingredients.iter().enumerate() {
        tx.execute(
            "INSERT INTO recipe_text_ingredients VALUES(?1,?2,?3,?4)",
            params![
                revision,
                position as i64,
                item.name.trim(),
                item.amount_text.trim()
            ],
        )?;
    }
    for (position, item) in draft.ingredients.iter().enumerate() {
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM ingredients WHERE name=?1",
                [item.name.trim()],
                |r| r.get(0),
            )
            .optional()?;
        let ingredient = if let Some(value) = existing {
            value
        } else {
            let value = id();
            let cat = ensure_category(tx, "ingredient", "未分类")?;
            tx.execute(
                "INSERT INTO ingredients VALUES(?1,?2,?3)",
                params![value, item.name.trim(), cat],
            )?;
            value
        };
        let decimal = rust_decimal::Decimal::from_str(&item.quantity)
            .map_err(|_| error("INVALID_QUANTITY", "用量无效"))?
            .normalize()
            .to_string();
        tx.execute(
            "INSERT INTO recipe_ingredients VALUES(?1,?2,?3,?4,?5)",
            params![revision, position as i64, ingredient, decimal, item.unit],
        )?;
    }
    for (position, step) in draft.steps.iter().enumerate() {
        let body = if let Some(title) = draft.step_titles.get(position) {
            format!(
                "\u{001e}chefish-step-v1:{}",
                json!({"title":title.trim(),"body":step.trim()})
            )
        } else {
            step.trim().to_string()
        };
        tx.execute(
            "INSERT INTO recipe_steps VALUES(?1,?2,?3)",
            params![revision, position as i64, body],
        )?;
    }
    tx.execute(
        "UPDATE recipes SET current_revision_id=?1,category_id=?2 WHERE id=?3",
        params![revision, category, recipe_id],
    )?;
    Ok(())
}
pub fn execute(connection: &mut Connection, request_id: &str, command: Command) -> Result<()> {
    Uuid::parse_str(request_id).map_err(|_| error("INVALID_INPUT", "请求 ID 无效"))?;
    let payload =
        serde_json::to_string(&command).map_err(|_| error("INVALID_INPUT", "命令无法解析"))?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(previous) = tx
        .query_row(
            "SELECT payload FROM command_receipts WHERE request_id=?1",
            [request_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        if previous != payload {
            return Err(error("DUPLICATE_REQUEST", "请求 ID 已用于其他操作"));
        }
        return Ok(());
    }
    #[derive(Deserialize)]
    struct CommandTag {
        #[serde(rename = "type")]
        kind: String,
    }
    let command_type: CommandTag =
        serde_json::from_str(&payload).map_err(|_| error("INVALID_INPUT", "操作类型无法解析"))?;
    let capture = sync::Capture::begin(&tx)?;
    apply(&tx, command)?;
    tx.execute(
        "INSERT INTO command_receipts(request_id,payload) VALUES(?1,?2)",
        params![request_id, payload],
    )?;
    tx.execute(
        "UPDATE app_settings SET value=CAST(value AS INTEGER)+1 WHERE key='data_revision'",
        [],
    )?;
    if let Some(capture) = capture {
        capture.finish(request_id, &command_type.kind)?;
    }
    tx.commit()?;
    Ok(())
}
fn apply(tx: &Transaction, command: Command) -> Result<()> {
    match command {
        Command::RemoveSeasoning {
            name,
            expected_revision,
        } => seasonings::remove(tx, &name, &expected_revision)?,
        Command::RecordPurchase {
            line_id,
            expected_version,
            ingredient_id,
            unit,
            week_start,
            quantity,
        } => {
            shopping::buy(
                tx,
                line_id,
                expected_version,
                &ingredient_id,
                &unit,
                week_start,
                &quantity,
            )?;
        }
        Command::SetSeasoning {
            name,
            missing,
            expected_revision,
        } => seasonings::set(tx, &name, missing, &expected_revision)?,
        Command::Batch {
            expected_revision,
            commands,
        } => {
            let revision: String = tx.query_row(
                "SELECT value FROM app_settings WHERE key='data_revision'",
                [],
                |r| r.get(0),
            )?;
            if revision != expected_revision {
                return Err(error("STALE_REVISION", "数据已变化，请重新生成提案"));
            }
            if commands.is_empty()
                || commands.len() > 50
                || commands.iter().any(|c| matches!(c, Command::Batch { .. }))
            {
                return Err(error("INVALID_INPUT", "操作数量须为1–50项，不能嵌套"));
            }
            for command in commands {
                apply(tx, command)?;
            }
        }
        Command::CompleteCooking { draft } => cooking::complete(&tx, draft)?,
        Command::UndoCooking {
            plan_id,
            expected_version,
        } => cooking::undo(&tx, &plan_id, expected_version)?,
        Command::SaveShopping {
            line_id,
            expected_version,
            draft,
        } => shopping::save_manual(&tx, line_id, expected_version, draft)?,
        #[cfg(test)]
        Command::BuyShopping {
            line_id,
            expected_version,
            ingredient_id,
            unit,
            week_start,
            quantity,
        } => {
            shopping::buy(
                &tx,
                line_id,
                expected_version,
                &ingredient_id,
                &unit,
                week_start,
                &quantity,
            )?;
        }
        Command::PurchaseShopping {
            line_id,
            expected_version,
            ingredient_id,
            unit,
            week_start,
            quantity,
            location,
            received,
            expires,
        } => shopping::purchase(
            &tx,
            line_id,
            expected_version,
            &ingredient_id,
            &unit,
            week_start,
            &quantity,
            &location,
            &received,
            expires,
        )?,
        Command::ReceiveShopping {
            line_id,
            expected_version,
            quantity,
            location,
            received,
            expires,
        } => shopping::receive(
            &tx,
            &line_id,
            expected_version,
            &quantity,
            &location,
            &received,
            expires,
        )?,
        Command::RemoveShopping {
            line_id,
            expected_version,
        } => shopping::remove(&tx, &line_id, expected_version)?,
        Command::HideShopping {
            week_start,
            ingredient_id,
            unit,
        } => shopping::hide(&tx, &week_start, &ingredient_id, &unit)?,
        Command::RefreshShopping { week_start } => {
            shopping::validate_week(&tx, &week_start)?;
            tx.execute(
                "DELETE FROM shopping_suppressions WHERE week_start=?1",
                [week_start],
            )?;
        }
        Command::SaveShoppingMemo {
            memo,
            expected_revision,
        } => {
            if memo.chars().count() > 4000 {
                return Err(error("INVALID_INPUT", "备忘最多4000字"));
            }
            let revision: String = tx.query_row(
                "SELECT value FROM app_settings WHERE key='data_revision'",
                [],
                |r| r.get(0),
            )?;
            if revision != expected_revision {
                return Err(error("STALE_REVISION", "内容已更新，请核对后重新保存备忘"));
            }
            tx.execute(
                "UPDATE app_settings SET value=?1 WHERE key='shopping_memo'",
                [memo],
            )?;
        }
        Command::SavePlan {
            plan_id,
            expected_version,
            draft,
        } => planner::save(&tx, plan_id, expected_version, draft)?,
        Command::RemovePlan {
            plan_id,
            expected_version,
        } => planner::remove(&tx, &plan_id, expected_version)?,
        Command::UndoInventory {
            lot_id,
            expected_version,
        } => inventory::undo(&tx, &lot_id, expected_version)?,
        Command::MoveCategory {
            kind,
            name,
            direction,
        } => {
            if ![-1, 1].contains(&direction) {
                return Err(error("INVALID_INPUT", "排序方向无效"));
            }
            let category_id = category(&tx, &kind, &name)?;
            let mut stmt = tx.prepare(
                "SELECT id,sort_order FROM categories WHERE kind=?1 ORDER BY sort_order,rowid",
            )?;
            let rows = stmt
                .query_map([&kind], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let index = rows
                .iter()
                .position(|r| r.0 == category_id)
                .ok_or_else(|| error("NOT_FOUND", "分类不存在"))?;
            let other = index as i64 + direction;
            if other < 0 || other >= rows.len() as i64 {
                return Err(error("NO_CHANGE", "分类已在边界位置"));
            }
            let adjacent = &rows[other as usize];
            tx.execute(
                "UPDATE categories SET sort_order=?1 WHERE id=?2",
                params![adjacent.1, category_id],
            )?;
            tx.execute(
                "UPDATE categories SET sort_order=?1 WHERE id=?2",
                params![rows[index].1, adjacent.0],
            )?;
        }
        Command::ReceiveLot { draft } => inventory::receive(&tx, draft)?,
        Command::SetLotExpiry {
            lot_id,
            expected_version,
            expires,
            reason,
        } => inventory::set_expiry(&tx, &lot_id, expected_version, expires.as_deref(), &reason)?,
        Command::ChangeLot {
            lot_id,
            expected_version,
            operation,
            quantity,
            location,
            reason,
        } => inventory::change(
            &tx,
            &lot_id,
            expected_version,
            &operation,
            &quantity,
            location.as_deref(),
            &reason,
        )?,
        Command::ReverseInventoryEvent { event_id, reason } => {
            inventory::reverse(&tx, &event_id, &reason)?
        }
        Command::CreateRecipe { draft } => save_recipe(&tx, None, &draft)?,
        Command::ReviseRecipe {
            recipe_id,
            expected_revision_id,
            draft,
        } => save_recipe(&tx, Some((&recipe_id, &expected_revision_id)), &draft)?,
        Command::ArchiveRecipe { recipe_id } | Command::DeleteRecipe { recipe_id } => {
            current(&tx, &recipe_id)?;
            tx.execute("UPDATE recipes SET archived=1 WHERE id=?1", [recipe_id])?;
        }
        Command::RestoreRecipe { recipe_id } => {
            if tx.execute(
                "UPDATE recipes SET archived=0 WHERE id=?1 AND archived=1",
                [recipe_id],
            )? != 1
            {
                return Err(error("NOT_FOUND", "菜谱不存在或未归档"));
            }
        }
        Command::Favorite { recipe_id, enabled } => {
            toggle(&tx, "favorite_recipes", &recipe_id, enabled)?
        }
        Command::Inspiration { recipe_id, enabled } => {
            toggle(&tx, "inspiration_recipes", &recipe_id, enabled)?
        }
        Command::SaveCategories {
            kind,
            expected_revision,
            entries,
        } => library::save_categories(&tx, &kind, &expected_revision, entries)?,
        Command::EditNote {
            note_id,
            expected_note,
            note,
        } => {
            text(&note, 2000)?;
            if tx.execute(
                "UPDATE cooking_notes SET note=?1 WHERE id=?2 AND note=?3",
                params![note.trim(), note_id, expected_note],
            )? != 1
            {
                return Err(error("STALE_REVISION", "笔记已变化，请重新打开后编辑"));
            }
        }
        Command::DeleteNote {
            note_id,
            expected_note,
        } => {
            if tx.execute(
                "DELETE FROM cooking_notes WHERE id=?1 AND note=?2",
                params![note_id, expected_note],
            )? != 1
            {
                return Err(error("STALE_REVISION", "笔记已变化，请重新打开后删除"));
            }
        }
        Command::CreateNote {
            recipe_id,
            date,
            note,
        } => {
            text(&note, 2000)?;
            if !valid_date(&date) {
                return Err(error("INVALID_INPUT", "笔记日期无效"));
            }
            let revision = current(&tx, &recipe_id)?;
            tx.execute("INSERT INTO cooking_notes(id,recipe_id,recipe_revision_id,date,note) VALUES(?1,?2,?3,?4,?5)",params![id(),recipe_id,revision,date,note.trim()])?;
        }
        Command::AddCategory { kind, name } => {
            category_name(&name)?;
            if !["recipe", "ingredient"].contains(&kind.as_str()) {
                return Err(error("INVALID_INPUT", "未知分类类型"));
            }
            tx.execute(
                "INSERT INTO categories(id,kind,name,sort_order) VALUES(?1,?2,?3,(SELECT COALESCE(MAX(sort_order),0)+1 FROM categories))",
                params![id(), kind, name.trim()],
            )
            .map_err(|_| error("CATEGORY_EXISTS", "分类名称已存在"))?;
        }
        Command::RenameCategory { kind, old, name } => {
            if old == "未分类" {
                return Err(error("INVALID_INPUT", "未分类为保留分类"));
            }
            category_name(&name)?;
            let cat = category(&tx, &kind, &old)?;
            tx.execute(
                "UPDATE categories SET name=?1 WHERE id=?2",
                params![name.trim(), cat],
            )
            .map_err(|_| error("CATEGORY_EXISTS", "分类名称已存在"))?;
        }
        Command::RemoveCategory { kind, name } => {
            if name == "未分类" {
                return Err(error("INVALID_INPUT", "不能移除未分类"));
            }
            let from = category(&tx, &kind, &name)?;
            let to = ensure_category(&tx, &kind, "未分类")?;
            let table = if kind == "recipe" {
                "recipes"
            } else {
                "ingredients"
            };
            tx.execute(
                &format!("UPDATE {table} SET category_id=?1 WHERE category_id=?2"),
                params![to, from],
            )?;
            tx.execute("DELETE FROM categories WHERE id=?1", [from])?;
        }
        Command::AssignCategory {
            kind,
            entity_id,
            name,
        } => {
            let cat = category(&tx, &kind, &name)?;
            let table = if kind == "recipe" {
                "recipes"
            } else {
                "ingredients"
            };
            if tx.execute(
                &format!("UPDATE {table} SET category_id=?1 WHERE id=?2"),
                params![cat, entity_id],
            )? != 1
            {
                return Err(error("NOT_FOUND", "要归类的内容不存在"));
            }
        }
    }
    Ok(())
}
fn strings(conn: &Connection, sql: &str) -> Result<Vec<String>> {
    let mut statement = conn.prepare(sql)?;
    let rows = statement
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<Vec<String>, _>>()?;
    Ok(rows)
}
pub fn snapshot(conn: &Connection) -> Result<Value> {
    let tx = conn.unchecked_transaction()?;
    let value = snapshot_inner(&tx)?;
    tx.commit()?;
    Ok(value)
}
fn snapshot_inner(conn: &Connection) -> Result<Value> {
    let revisions = strings(
        conn,
        "SELECT current_revision_id FROM recipes WHERE archived=0 ORDER BY rowid",
    )?;
    let recipes = revisions
        .iter()
        .map(|rev| recipe_snapshot(conn, rev))
        .collect::<Result<Vec<_>>>()?;
    let archived = strings(
        conn,
        "SELECT current_revision_id FROM recipes WHERE archived=1 ORDER BY rowid DESC",
    )?
    .iter()
    .map(|rev| recipe_snapshot(conn, rev))
    .collect::<Result<Vec<_>>>()?;
    let mut stmt=conn.prepare("SELECT i.id,i.name,c.name FROM ingredients i JOIN categories c ON c.id=i.category_id ORDER BY i.rowid")?;
    let ingredients=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"category":r.get::<_,String>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let mut stmt=conn.prepare("SELECT n.id,n.recipe_id,n.recipe_revision_id,n.date,n.note FROM cooking_notes n JOIN recipes r ON r.id=n.recipe_id ORDER BY n.rowid DESC")?;
    let logs=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"recipeId":r.get::<_,String>(1)?,"revisionId":r.get::<_,String>(2)?,"date":r.get::<_,String>(3)?,"note":r.get::<_,String>(4)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let revision: String = conn.query_row(
        "SELECT value FROM app_settings WHERE key='data_revision'",
        [],
        |r| r.get(0),
    )?;
    let mut result = json!({"recipes":recipes,"recipeCategories":strings(conn,"SELECT name FROM categories WHERE kind='recipe' ORDER BY sort_order,rowid")?,"ingredientCategories":strings(conn,"SELECT name FROM categories WHERE kind='ingredient' ORDER BY sort_order,rowid")?,"ingredients":ingredients,"favorites":strings(conn,"SELECT f.recipe_id FROM favorite_recipes f JOIN recipes r ON r.id=f.recipe_id WHERE r.archived=0")?,"inspiration":strings(conn,"SELECT f.recipe_id FROM inspiration_recipes f JOIN recipes r ON r.id=f.recipe_id WHERE r.archived=0")?,"logs":logs,"lots":inventory::lots(conn)?,"inventoryEvents":inventory::events(conn)?,"plans":planner::plans(conn)?,"shopping":[],"memo":conn.query_row("SELECT value FROM app_settings WHERE key='shopping_memo'",[],|r|r.get::<_,String>(0))?,"hiddenNeeds":[],"dataRevision":revision});
    result["archivedRecipes"] = json!(archived);
    result["seasonings"] = seasonings::supplies(conn)?;
    result["preferences"] = json!(preferences::load(conn)?);
    Ok(result)
}

pub fn recipe_history(conn: &Connection, recipe: &str) -> Result<Value> {
    let tx = conn.unchecked_transaction()?;
    let mut stmt = tx.prepare(
        "SELECT id FROM recipe_revisions WHERE recipe_id=?1 ORDER BY revision_number DESC",
    )?;
    let ids = stmt
        .query_map([recipe], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if ids.is_empty() {
        return Err(error("NOT_FOUND", "菜谱不存在"));
    }
    let rows = ids
        .iter()
        .map(|rev| recipe_snapshot(&tx, rev))
        .collect::<Result<Vec<_>>>()?;
    drop(stmt);
    tx.commit()?;
    Ok(json!(rows))
}
fn recipe_snapshot(conn: &Connection, rev: &str) -> Result<Value> {
    let mut recipe = conn.query_row("SELECT r.id,v.id,v.revision_number,v.name,c.name,v.subtitle,v.minutes,v.servings,v.seasoning FROM recipe_revisions v JOIN recipes r ON r.id=v.recipe_id JOIN categories c ON c.id=r.category_id WHERE v.id=?1", [rev], |r| Ok(json!({"id":r.get::<_,String>(0)?,"revisionId":r.get::<_,String>(1)?,"revisionNumber":r.get::<_,i64>(2)?,"name":r.get::<_,String>(3)?,"category":r.get::<_,String>(4)?,"subtitle":r.get::<_,String>(5)?,"minutes":r.get::<_,i64>(6)?,"servings":r.get::<_,i64>(7)?,"seasoning":r.get::<_,String>(8)?,"image":"placeholder"})))?;
    let media: Option<String> = conn
        .query_row(
            "SELECT content FROM recipe_media WHERE revision_id=?1",
            [rev],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(raw) = media {
        let data: Value =
            serde_json::from_str(&raw).map_err(|_| error("DATABASE_ERROR", "图片内容无法读取"))?;
        if let Some(cover) = data["cover"].as_str() {
            recipe["image"] = json!(cover);
        }
        recipe["media"] = data;
    }
    let mut req = conn.prepare("SELECT ingredient_id,amount_decimal,unit FROM recipe_ingredients WHERE revision_id=?1 ORDER BY position")?;
    recipe["requirements"] = json!(req.query_map([rev], |r|Ok(json!({"ingredientId":r.get::<_,String>(0)?,"quantity":r.get::<_,String>(1)?,"unit":r.get::<_,String>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?);
    let mut steps =
        conn.prepare("SELECT body FROM recipe_steps WHERE revision_id=?1 ORDER BY position")?;
    let stored = steps
        .query_map([rev], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut bodies = Vec::new();
    let mut titles = Vec::new();
    for body in stored {
        if let Some(encoded) = body.strip_prefix("\u{001e}chefish-step-v1:") {
            let parsed: Value = serde_json::from_str(encoded)
                .map_err(|_| error("DATABASE_ERROR", "步骤内容无法读取"))?;
            bodies.push(
                parsed["body"]
                    .as_str()
                    .ok_or_else(|| error("DATABASE_ERROR", "步骤内容无法读取"))?
                    .to_string(),
            );
            titles.push(parsed["title"].as_str().unwrap_or("").to_string());
        } else {
            bodies.push(body);
            titles.push(String::new());
        }
    }
    let source: Option<(String, String, String)> = conn
        .query_row(
            "SELECT url,author,ingredient_text FROM recipe_sources WHERE revision_id=?1",
            [rev],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    if let Some((url, author, raw)) = source {
        let ingredient_text: Vec<String> =
            serde_json::from_str(&raw).map_err(|_| error("DATABASE_ERROR", "来源用量无法读取"))?;
        recipe["source"] = json!(RecipeSource {
            url,
            author,
            ingredient_text
        });
    }
    let mut text_items=conn.prepare("SELECT name,amount_text FROM recipe_text_ingredients WHERE revision_id=?1 ORDER BY position")?;
    recipe["textIngredients"] = json!(text_items
        .query_map([rev], |r| Ok(
            json!({"name":r.get::<_,String>(0)?,"amountText":r.get::<_,String>(1)?})
        ))?
        .collect::<std::result::Result<Vec<_>, _>>()?);
    let mut kinds = seasonings::kinds(conn, rev)?;
    let mut names = conn.prepare("SELECT i.name FROM recipe_ingredients r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.revision_id=?1 UNION SELECT name FROM recipe_text_ingredients WHERE revision_id=?1")?;
    for name in names.query_map([rev], |r| r.get::<_, String>(0))? {
        let name = name?;
        kinds
            .entry(name.clone())
            .or_insert_with(|| seasonings::common(&name));
    }
    recipe["ingredientKinds"] = json!(kinds);
    recipe["steps"] = json!(bodies);
    recipe["stepTitles"] = json!(titles);
    Ok(recipe)
}

fn toggle(tx: &Transaction, table: &str, recipe: &str, enabled: bool) -> Result<()> {
    current(tx, recipe)?;
    if enabled {
        tx.execute(
            &format!("INSERT OR IGNORE INTO {table} VALUES(?1)"),
            [recipe],
        )?;
    } else {
        tx.execute(&format!("DELETE FROM {table} WHERE recipe_id=?1"), [recipe])?;
    }
    Ok(())
}
fn valid_date(date: &str) -> bool {
    if date.len() != 10 || !date.is_ascii() || &date[4..5] != "-" || &date[7..8] != "-" {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        date[0..4].parse::<u32>(),
        date[5..7].parse::<u32>(),
        date[8..10].parse::<u32>(),
    ) else {
        return false;
    };
    if !(1900..=2100).contains(&year) || !(1..=12).contains(&month) {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max = match month {
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    day >= 1 && day <= max
}
#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn downgrade_cooking(c: &Connection) {
        sync::remove_for_legacy_fixture(c);
        c.execute_batch("DROP TABLE recipe_text_ingredients; DELETE FROM schema_migrations WHERE version=9; DROP TABLE recipe_sources; DELETE FROM schema_migrations WHERE version=8; ALTER TABLE planned_meals DROP COLUMN cooking_session_id; DROP TABLE cooking_consumptions; DROP TABLE cooking_undos; DROP TABLE cooking_sessions; DELETE FROM schema_migrations WHERE version=7;").unwrap();
    }
    pub(super) fn temp() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("chefish-m1-{}.sqlite3", id()))
    }
    pub(super) fn draft() -> RecipeDraft {
        RecipeDraft {
            ingredient_kinds: Default::default(),
            media: None,
            text_ingredients: vec![],
            source: None,
            allow_source_duplicate: false,
            step_titles: vec![],
            name: "清炒西兰花".into(),
            category: "家常菜".into(),
            minutes: 15,
            servings: 2,
            subtitle: "测试".into(),
            seasoning: "盐少许".into(),
            ingredients: vec![DraftIngredient {
                name: "西兰花".into(),
                quantity: "0.123456".into(),
                unit: "g".into(),
            }],
            steps: vec!["洗净炒熟".into()],
        }
    }
    #[test]
    fn imported_images_are_revision_pinned_and_survive_restart() {
        let path = temp();
        let mut conn = open(&path).unwrap();
        let mut d = draft();
        let image = "data:image/png;base64,iVBORw0KGgo=".to_string();
        d.media = Some(crate::recipe_images::Media {
            cover: Some(image.clone()),
            steps: vec![crate::recipe_images::StepImage {
                image: image.clone(),
                source_step: 2,
            }],
        });
        execute(&mut conn, &id(), Command::CreateRecipe { draft: d }).unwrap();
        let original = snapshot(&conn).unwrap()["recipes"][0].clone();
        let mut next = draft();
        next.name = "修改菜名".into();
        execute(
            &mut conn,
            &id(),
            Command::ReviseRecipe {
                recipe_id: original["id"].as_str().unwrap().into(),
                expected_revision_id: original["revisionId"].as_str().unwrap().into(),
                draft: next,
            },
        )
        .unwrap();
        drop(conn);
        let conn = open(&path).unwrap();
        let current = snapshot(&conn).unwrap()["recipes"][0].clone();
        assert_eq!(current["image"], image);
        assert_eq!(current["media"]["steps"][0]["sourceStep"], 2);
        assert_eq!(
            recipe_snapshot(&conn, original["revisionId"].as_str().unwrap()).unwrap(),
            original
        );
        sync::remove_for_legacy_fixture(&conn);
        conn.execute_batch("DROP TABLE recipe_media; DELETE FROM schema_migrations WHERE version=10; PRAGMA user_version=9;").unwrap();
        drop(conn);
        let conn = open(&path).unwrap();
        assert_eq!(snapshot(&conn).unwrap()["recipes"][0]["name"], "修改菜名");
    }
    pub(super) fn create(conn: &mut Connection) -> (String, String) {
        execute(conn, &id(), Command::CreateRecipe { draft: draft() }).unwrap();
        let s = snapshot(conn).unwrap();
        (
            s["recipes"][0]["id"].as_str().unwrap().into(),
            s["recipes"][0]["revisionId"].as_str().unwrap().into(),
        )
    }
    #[test]
    fn empty_library_and_migration_are_repeatable() {
        let path = temp();
        let conn = open(&path).unwrap();
        let s = snapshot(&conn).unwrap();
        assert_eq!(s["recipes"], json!([]));
        assert_eq!(s["lots"], json!([]));
        let cat: String = conn
            .query_row(
                "SELECT id FROM categories WHERE name='家常菜'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        drop(conn);
        let conn = open(&path).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT id FROM categories WHERE name='家常菜'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            cat
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM schema_migrations", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            CURRENT_SCHEMA
        );
    }
    #[test]
    fn import_source_is_pinned_duplicate_requires_choice_and_survives_restart() {
        let path = temp();
        let mut conn = open(&path).unwrap();
        let mut imported = draft();
        imported.source = Some(RecipeSource {
            url: "https://m.xiachufang.com/recipe/123/?tracking=1".into(),
            author: "测试作者".into(),
            ingredient_text: vec!["西兰花 300克".into(), "盐 适量".into()],
        });
        execute(
            &mut conn,
            &id(),
            Command::CreateRecipe {
                draft: imported.clone(),
            },
        )
        .unwrap();
        let before = snapshot(&conn).unwrap();
        let row = &before["recipes"][0];
        let recipe = row["id"].as_str().unwrap().to_string();
        let revision = row["revisionId"].as_str().unwrap().to_string();
        assert_eq!(
            row["source"]["url"],
            "https://www.xiachufang.com/recipe/123/"
        );
        assert_eq!(
            execute(
                &mut conn,
                &id(),
                Command::CreateRecipe {
                    draft: imported.clone()
                }
            )
            .unwrap_err()
            .code,
            "SOURCE_EXISTS"
        );
        assert_eq!(before, snapshot(&conn).unwrap());
        imported.allow_source_duplicate = true;
        execute(&mut conn, &id(), Command::CreateRecipe { draft: imported }).unwrap();
        let mut edited = draft();
        edited.name = "改过名字".into();
        execute(
            &mut conn,
            &id(),
            Command::ReviseRecipe {
                recipe_id: recipe,
                expected_revision_id: revision.clone(),
                draft: edited,
            },
        )
        .unwrap();
        assert!(conn
            .execute(
                "UPDATE recipe_sources SET author='bad' WHERE revision_id=?1",
                [revision]
            )
            .is_err());
        let expected = snapshot(&conn).unwrap();
        assert_eq!(
            expected["recipes"][0]["source"],
            expected["recipes"][1]["source"]
        );
        drop(conn);
        assert_eq!(expected, snapshot(&open(&path).unwrap()).unwrap());
    }
    #[test]
    fn schema_seven_source_migration_preserves_existing_recipes() {
        let path = temp();
        let mut conn = open(&path).unwrap();
        create(&mut conn);
        let before = snapshot(&conn).unwrap();
        sync::remove_for_legacy_fixture(&conn);
        conn.execute_batch("DROP TABLE recipe_text_ingredients; DELETE FROM schema_migrations WHERE version=9; DROP TABLE recipe_sources; DELETE FROM schema_migrations WHERE version=8; PRAGMA user_version=7;").unwrap();
        drop(conn);
        let conn = open(&path).unwrap();
        assert_eq!(before, snapshot(&conn).unwrap());
        assert_eq!(
            conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            CURRENT_SCHEMA
        );
    }
    #[test]
    fn text_ingredients_are_revision_pinned_and_survive_restart() {
        let path = temp();
        let mut conn = open(&path).unwrap();
        let mut d = draft();
        d.text_ingredients = vec![
            TextIngredient {
                name: "盐".into(),
                amount_text: "3小勺".into(),
            },
            TextIngredient {
                name: "油".into(),
                amount_text: "适量".into(),
            },
        ];
        execute(&mut conn, &id(), Command::CreateRecipe { draft: d.clone() }).unwrap();
        let first = snapshot(&conn).unwrap();
        let r = &first["recipes"][0];
        let recipe = r["id"].as_str().unwrap().to_string();
        let rev = r["revisionId"].as_str().unwrap().to_string();
        d.text_ingredients[0].amount_text = "1小勺".into();
        execute(
            &mut conn,
            &id(),
            Command::ReviseRecipe {
                recipe_id: recipe,
                expected_revision_id: rev.clone(),
                draft: d,
            },
        )
        .unwrap();
        assert_eq!(
            recipe_snapshot(&conn, &rev).unwrap()["textIngredients"][0]["amountText"],
            "3小勺"
        );
        assert!(conn
            .execute(
                "UPDATE recipe_text_ingredients SET amount_text='999' WHERE revision_id=?1",
                [rev]
            )
            .is_err());
        let expected = snapshot(&conn).unwrap();
        assert_eq!(
            expected["recipes"][0]["textIngredients"][0]["amountText"],
            "1小勺"
        );
        drop(conn);
        assert_eq!(expected, snapshot(&open(&path).unwrap()).unwrap());
    }
    #[test]
    fn restart_keeps_recipe_favorites_categories_notes_and_ids() {
        let path = temp();
        let mut conn = open(&path).unwrap();
        let (recipe, rev) = create(&mut conn);
        execute(
            &mut conn,
            &id(),
            Command::Favorite {
                recipe_id: recipe.clone(),
                enabled: true,
            },
        )
        .unwrap();
        execute(
            &mut conn,
            &id(),
            Command::Inspiration {
                recipe_id: recipe.clone(),
                enabled: true,
            },
        )
        .unwrap();
        execute(
            &mut conn,
            &id(),
            Command::CreateNote {
                recipe_id: recipe.clone(),
                date: "2026-10-19".into(),
                note: "少放盐".into(),
            },
        )
        .unwrap();
        execute(
            &mut conn,
            &id(),
            Command::RenameCategory {
                kind: "recipe".into(),
                old: "家常菜".into(),
                name: "快手菜".into(),
            },
        )
        .unwrap();
        let before = snapshot(&conn).unwrap();
        drop(conn);
        let conn = open(&path).unwrap();
        let after = snapshot(&conn).unwrap();
        assert_eq!(before, after);
        assert_eq!(after["recipes"][0]["id"], recipe);
        assert_eq!(after["logs"][0]["revisionId"], rev);
        assert_eq!(after["favorites"][0], recipe);
        assert_eq!(after["recipes"][0]["category"], "快手菜");
    }
    #[test]
    fn revisions_are_immutable_and_conflicts_do_not_write() {
        let mut conn = open(&temp()).unwrap();
        let (recipe, rev) = create(&mut conn);
        let mut next = draft();
        next.name = "第二版".into();
        execute(
            &mut conn,
            &id(),
            Command::ReviseRecipe {
                recipe_id: recipe.clone(),
                expected_revision_id: rev.clone(),
                draft: next.clone(),
            },
        )
        .unwrap();
        let before = snapshot(&conn).unwrap();
        next.category = "必须随冲突回滚的新分类".into();
        assert_eq!(
            execute(
                &mut conn,
                &id(),
                Command::ReviseRecipe {
                    recipe_id: recipe,
                    expected_revision_id: rev.clone(),
                    draft: next
                }
            )
            .unwrap_err()
            .code,
            "STALE_REVISION"
        );
        assert_eq!(before, snapshot(&conn).unwrap());
        assert!(conn
            .execute("UPDATE recipe_revisions SET name='bad' WHERE id=?1", [rev])
            .is_err());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM recipe_revisions", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn retries_are_idempotent_and_request_reuse_is_rejected() {
        let mut conn = open(&temp()).unwrap();
        let request = id();
        let cmd = Command::CreateRecipe { draft: draft() };
        execute(&mut conn, &request, cmd.clone()).unwrap();
        execute(&mut conn, &request, cmd).unwrap();
        assert_eq!(
            snapshot(&conn).unwrap()["recipes"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            execute(
                &mut conn,
                &request,
                Command::AddCategory {
                    kind: "recipe".into(),
                    name: "other".into()
                }
            )
            .unwrap_err()
            .code,
            "DUPLICATE_REQUEST"
        );
    }
    #[test]
    fn invalid_input_rolls_back_whole_transaction() {
        let mut conn = open(&temp()).unwrap();
        let before = snapshot(&conn).unwrap();
        let mut invalid = draft();
        invalid.ingredients[0].quantity = "-1".into();
        assert!(execute(&mut conn, &id(), Command::CreateRecipe { draft: invalid }).is_err());
        assert_eq!(before, snapshot(&conn).unwrap());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM command_receipts", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn exact_decimal_and_category_identity_survive_changes() {
        let mut conn = open(&temp()).unwrap();
        let (recipe, _) = create(&mut conn);
        assert_eq!(
            conn.query_row("SELECT amount_decimal FROM recipe_ingredients", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "0.123456"
        );
        let cat: String = conn
            .query_row(
                "SELECT id FROM categories WHERE name='家常菜'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        execute(
            &mut conn,
            &id(),
            Command::RenameCategory {
                kind: "recipe".into(),
                old: "家常菜".into(),
                name: "新分类".into(),
            },
        )
        .unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT category_id FROM recipes WHERE id=?1",
                [recipe],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            cat
        );
        execute(
            &mut conn,
            &id(),
            Command::RemoveCategory {
                kind: "recipe".into(),
                name: "新分类".into(),
            },
        )
        .unwrap();
        assert_eq!(snapshot(&conn).unwrap()["recipes"][0]["category"], "未分类");
    }
    #[test]
    fn archive_preserves_revisions_and_notes() {
        let mut conn = open(&temp()).unwrap();
        let (recipe, _) = create(&mut conn);
        execute(
            &mut conn,
            &id(),
            Command::CreateNote {
                recipe_id: recipe.clone(),
                date: "2026-10-19".into(),
                note: "保留".into(),
            },
        )
        .unwrap();
        execute(
            &mut conn,
            &id(),
            Command::ArchiveRecipe { recipe_id: recipe },
        )
        .unwrap();
        assert_eq!(snapshot(&conn).unwrap()["recipes"], json!([]));
        assert_eq!(
            conn.query_row("SELECT count(*) FROM cooking_notes", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM recipe_revisions", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn corrupt_future_or_unknown_schema_is_never_rebuilt() {
        let damaged = temp();
        std::fs::write(&damaged, b"not a SQLite database").unwrap();
        assert!(open(&damaged).is_err());
        assert_eq!(std::fs::read(&damaged).unwrap(), b"not a SQLite database");
        let path = temp();
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        drop(conn);
        assert_eq!(open(&path).unwrap_err().code, "NEWER_SCHEMA");
        let path = temp();
        let conn = Connection::open(&path).unwrap();
        conn.execute("CREATE TABLE private_data(value TEXT)", [])
            .unwrap();
        drop(conn);
        assert_eq!(open(&path).unwrap_err().code, "UNKNOWN_SCHEMA");
    }
    #[test]
    fn date_validation_handles_local_calendar_days() {
        assert!(valid_date("2028-02-29"));
        assert!(!valid_date("2026-02-29"));
        assert!(!valid_date("2026-13-01"));
        assert!(!valid_date("2026-10-19T00:00:00Z"));
    }
    #[test]
    fn locked_database_reports_failure_without_mutation() {
        let path = temp();
        let first = open(&path).unwrap();
        let mut second = open(&path).unwrap();
        second.busy_timeout(Duration::ZERO).unwrap();
        let before = snapshot(&second).unwrap();
        first.execute_batch("BEGIN IMMEDIATE").unwrap();
        let failure =
            execute(&mut second, &id(), Command::CreateRecipe { draft: draft() }).unwrap_err();
        assert_eq!(failure.code, "DATABASE_BUSY");
        first.execute_batch("ROLLBACK").unwrap();
        assert_eq!(snapshot(&second).unwrap(), before);
    }
    #[test]
    fn category_order_is_durable_and_new_categories_append() {
        let path = temp();
        let mut conn = open(&path).unwrap();
        execute(
            &mut conn,
            &id(),
            Command::MoveCategory {
                kind: "ingredient".into(),
                name: "肉禽蛋".into(),
                direction: 1,
            },
        )
        .unwrap();
        let before = snapshot(&conn).unwrap();
        drop(conn);
        let mut conn = open(&path).unwrap();
        assert_eq!(snapshot(&conn).unwrap(), before);
        assert_eq!(before["ingredientCategories"][0], "蔬菜菌菇");
        execute(
            &mut conn,
            &id(),
            Command::AddCategory {
                kind: "ingredient".into(),
                name: "甜品材料".into(),
            },
        )
        .unwrap();
        let after = snapshot(&conn).unwrap();
        assert_eq!(
            after["ingredientCategories"]
                .as_array()
                .unwrap()
                .last()
                .unwrap(),
            "甜品材料"
        );
        let old = after.clone();
        assert!(execute(
            &mut conn,
            &id(),
            Command::MoveCategory {
                kind: "ingredient".into(),
                name: "蔬菜菌菇".into(),
                direction: -1
            }
        )
        .is_err());
        assert_eq!(snapshot(&conn).unwrap(), old);
    }
}

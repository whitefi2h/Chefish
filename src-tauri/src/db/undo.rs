use super::*;

pub fn status(conn: &Connection) -> Result<Value> {
    if conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 14 {
        return Ok(Value::Null);
    }
    let entry:Option<(String,String)>=conn.query_row("SELECT operation_id,command_type FROM local_undo_history WHERE undone=0 ORDER BY sequence DESC LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    Ok(entry
        .map(|(id, kind)| json!({"operationId":id,"label":label(&kind)}))
        .unwrap_or(Value::Null))
}
fn label(kind: &str) -> &str {
    match kind {
        "create_recipe" => "创建菜谱",
        "revise_recipe" => "编辑菜谱",
        "delete_recipe" | "archive_recipe" => "删除菜谱",
        "restore_recipe" => "恢复菜谱",
        "save_plan" => "菜单安排",
        "remove_plan" => "移除菜单",
        "receive_lot" | "receive_shopping" => "食材入库",
        "change_lot" | "edit_lot" | "set_lot_expiry" => "调整库存",
        "delete_lot" => "删除库存",
        "complete_cooking" => "完成烹饪",
        "undo_cooking" => "撤销烹饪",
        "set_seasoning" | "remove_seasoning" => "调整调料",
        "set_ingredient_image" => "更换食材图片",
        "favorite" => "收藏菜谱",
        "inspiration" => "调整周灵感",
        "save_categories" | "add_category" | "rename_category" | "remove_category"
        | "move_category" | "assign_category" => "调整分类",
        "create_note" | "edit_note" | "delete_note" => "编辑厨房手记",
        "save_dining_preferences" => "修改用餐偏好",
        "batch" => "助手操作",
        _ => "厨房操作",
    }
}
pub fn record(conn: &Connection, id: &str, kind: &str, payload: &[u8]) -> Result<()> {
    if conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 14 {
        return Ok(());
    }
    if matches!(kind, "undo" | "background_image") {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO local_undo_history(operation_id,command_type,payload) VALUES(?1,?2,?3)",
        params![id, kind, payload],
    )?;
    conn.execute("DELETE FROM local_undo_history WHERE sequence IN (SELECT sequence FROM (SELECT sequence,row_number() OVER(ORDER BY sequence DESC) AS n,sum(length(payload)) OVER(ORDER BY sequence DESC) AS bytes FROM local_undo_history) WHERE n>50 OR (n>1 AND bytes>67108864))",[])?;
    Ok(())
}
pub fn apply(tx: &Transaction, operation_id: &str) -> Result<()> {
    let latest = status(tx)?;
    if latest["operationId"] != operation_id {
        return Err(error("STALE_UNDO", "可撤销的操作已变化，请刷新后重试"));
    }
    let payload: Vec<u8> = tx.query_row(
        "SELECT payload FROM local_undo_history WHERE operation_id=?1",
        [operation_id],
        |r| r.get(0),
    )?;
    tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
    super::replication::undo_payload(tx, &payload).map_err(|e| {
        if e.code == "SYNC_CONFLICT" || e.code == "DATABASE_ERROR" {
            error("UNDO_CONFLICT", "相关记录已有后续修改，当前操作未撤销")
        } else {
            e
        }
    })?;
    tx.execute(
        "UPDATE local_undo_history SET undone=1 WHERE operation_id=?1",
        [operation_id],
    )?;
    Ok(())
}
#[cfg(test)]
#[path = "undo_tests.rs"]
mod tests;

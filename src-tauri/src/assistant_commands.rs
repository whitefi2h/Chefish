use serde_json::{json, Value};
// Accept common model spelling differences; never invent IDs or drop business fields.
pub fn normalize(mut value: Value) -> Value {
    let Some(o) = value.as_object_mut() else {
        return value;
    };
    if !o.contains_key("type") {
        for field in ["operation", "action", "command"] {
            if o.get(field)
                .and_then(Value::as_str)
                .is_some_and(|v| v.contains('_') || ["favorite", "inspiration"].contains(&v))
            {
                let kind = o.remove(field).unwrap();
                o.insert("type".into(), kind);
                break;
            }
        }
    }
    for (camel, snake) in [
        ("lotId", "lot_id"),
        ("expectedVersion", "expected_version"),
        ("expectedRevision", "expected_revision"),
        ("recipeId", "recipe_id"),
        ("expectedRevisionId", "expected_revision_id"),
        ("planId", "plan_id"),
        ("lineId", "line_id"),
        ("ingredientId", "ingredient_id"),
        ("weekStart", "week_start"),
        ("eventId", "event_id"),
        ("noteId", "note_id"),
    ] {
        if !o.contains_key(snake) {
            if let Some(v) = o.remove(camel) {
                o.insert(snake.into(), v);
            }
        }
    }
    let kind = o
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if let Some(draft) = o.get_mut("draft").and_then(Value::as_object_mut) {
        if kind == "receive_lot" {
            draft.entry("category").or_insert(json!("自动分类"));
            draft.entry("expires").or_insert(Value::Null);
            draft.entry("precision").or_insert(json!("rough"));
        }
        for key in ["quantity"] {
            if let Some(v) = draft.get(key).filter(|v| v.is_number()).cloned() {
                draft.insert(key.into(), json!(v.to_string()));
            }
        }
    }
    if kind == "change_lot" {
        o.entry("reason").or_insert(json!(""));
        o.entry("location").or_insert(Value::Null);
    }
    for key in ["quantity"] {
        if let Some(v) = o.get(key).filter(|v| v.is_number()).cloned() {
            o.insert(key.into(), json!(v.to_string()));
        }
    }
    value
}

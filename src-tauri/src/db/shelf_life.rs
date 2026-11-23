use super::*;

// Conservative app defaults, not package dates. Unknown location assumes refrigeration.
// Reference: https://www.foodsafety.gov/food-safety-charts/cold-food-storage-charts
pub fn estimate(c: &Connection, name: &str, storage: &str, received: &str) -> Result<(String, String)> {
    let contains = |words: &[&str]| words.iter().any(|word| name.contains(word));
    let category = ingredient_category::infer(name);
    let dry = contains(&["大米", "小米", "糙米", "燕麦", "面粉", "意面", "意大利面", "粉丝", "挂面", "干香菇", "干木耳", "干银耳", "干辣椒", "淀粉"]);
    let perishable = contains(&["肉", "排骨", "鸡翅", "鸡腿", "鸡胸", "鱼", "虾", "蟹", "贝", "奶", "豆腐", "熟", "剩菜"]);
    let assumed = if storage == "未指定" { "冷藏" } else { storage };
    let days = if assumed == "冷冻" { 30 }
        else if seasonings::common(name) { 180 }
        else if dry { 90 }
        else if assumed != "冷藏" && perishable { 0 }
        else if contains(&["熟", "剩菜"]) { 3 }
        else if contains(&["鸡蛋", "鸭蛋", "鹌鹑蛋"]) && assumed == "冷藏" { 21 }
        else if category == "肉禽蛋" || category == "水产海鲜" { 1 }
        else if category == "豆制品" { 3 }
        else if category == "乳品饮料" { 5 }
        else if contains(&["菠菜", "青菜", "生菜", "油麦菜", "香菜", "韭菜", "菇", "蘑菇"]) { 3 }
        else if contains(&["土豆", "洋葱", "大蒜", "生姜", "胡萝卜", "南瓜"]) { 14 }
        else if category == "水果" || category == "蔬菜菌菇" { 7 }
        else { 3 };
    let date: String = c.query_row("SELECT date(?1,?2)", params![received, format!("+{days} days")], |r| r.get(0))?;
    let storage_basis = if storage == "未指定" { "库位未指定，按常见冷藏条件" } else { storage };
    Ok((date, format!("按{name}、{storage_basis}及购买日期{received}估算，保存期{days}天")))
}

pub fn mark_estimated(c: &Connection, lot: &str, date: &str, basis: &str) -> Result<()> {
    let mut meta = steward::metadata(c, "lot", lot)?;
    meta["estimatedExpires"] = json!(date);
    meta["expiryBasis"] = json!(basis);
    meta["expiryOrigin"] = json!("estimated");
    c.execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![format!("steward_meta:lot:{lot}"),meta.to_string()])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn receipt_estimates_both_modes_preserves_given_dates_and_has_no_review_command() {
        let path=std::env::temp_dir().join(format!("chefish-expiry-{}.sqlite3",id()));
        let mut c=open(&path).unwrap();
        let received="2026-11-01";
        let command=json!({"type":"receive_lot","draft":{"name":"鸡肉","category":"自动分类","quantity":"500","unit":"g","location":"冷藏","received":received,"expires":null,"precision":"exact"}});
        execute(&mut c,&id(),serde_json::from_value(command.clone()).unwrap()).unwrap();
        let lot=inventory::lots(&c).unwrap()[0].clone();
        assert_eq!(lot["expires"],"2026-11-02");assert_eq!(lot["version"],1);
        assert_eq!(lot["steward"]["estimatedExpires"],lot["expires"]);
        execute(&mut c,&id(),serde_json::from_value(json!({"type":"set_lot_expiry","lot_id":lot["id"],"expected_version":1,"expires":"2026-11-03","reason":"包装日期"})).unwrap()).unwrap();
        let manual=inventory::lots(&c).unwrap()[0].clone();assert_ne!(manual["steward"]["estimatedExpires"],manual["expires"]);
        let mut supplied=command;supplied["draft"]["expires"]=json!("2026-12-01");
        execute(&mut c,&id(),serde_json::from_value(supplied).unwrap()).unwrap();
        assert!(inventory::lots(&c).unwrap().iter().any(|l|l["expires"]=="2026-12-01" && l["steward"]["estimatedExpires"].is_null()));
        let mut prefs=preferences::load(&c).unwrap();prefs.inventory_mode="rough".into();preferences::save(&mut c,prefs).unwrap();
        execute(&mut c,&id(),serde_json::from_value(json!({"type":"receive_level_lot","name":"青菜","category":"自动分类","level":1})).unwrap()).unwrap();
        let greens=inventory::lots(&c).unwrap().into_iter().find(|l|l["measurement"]=="level").unwrap();
        assert!(greens["expires"].is_string());assert_eq!(greens["steward"]["estimatedExpires"],greens["expires"]);
        assert!(serde_json::from_value::<Command>(json!({"type":"set_review_date","lot_id":lot["id"],"date":"2026-12-01"})).is_err());
    }
    #[test]
    fn estimates_start_at_purchase_date_and_follow_storage() {
        let c=Connection::open_in_memory().unwrap();
        for (name,storage,date) in [("鸡翅","冷藏","2026-11-02"),("鸡翅","冷冻","2026-12-01"),("鸡蛋","冷藏","2026-11-22"),("青菜","未指定","2026-11-04"),("大米","常温","2027-01-30")] {
            assert_eq!(estimate(&c,name,storage,"2026-11-01").unwrap().0,date);
        }
    }
    #[test]
    fn legacy_review_is_projected_as_expiry_and_keeps_fefo_without_rewriting_history() {
        let path=std::env::temp_dir().join(format!("chefish-legacy-expiry-{}.sqlite3",id()));
        let mut c=open(&path).unwrap();
        for expiry in [Some("2026-12-31"),None] {
            execute(&mut c,&id(),serde_json::from_value(json!({"type":"receive_lot","draft":{"name":"青菜","category":"自动分类","quantity":"500","unit":"g","location":"冷藏","received":"2026-11-01","expires":expiry,"precision":"exact"}})).unwrap()).unwrap();
        }
        let legacy=inventory::lots(&c).unwrap().into_iter().find(|l|l["steward"]["estimatedExpires"].is_string()).unwrap()["id"].as_str().unwrap().to_owned();
        c.execute("UPDATE inventory_lots SET expires_on=NULL WHERE id=?1",[&legacy]).unwrap();
        c.execute("UPDATE app_settings SET value=?1 WHERE key=?2",params![json!({"reviewOn":"2026-11-10","reviewOrigin":"user"}).to_string(),format!("steward_meta:lot:{legacy}")]).unwrap();
        let rows=inventory::lots(&c).unwrap();
        assert_eq!(rows[0]["id"],legacy);assert_eq!(rows[0]["expires"],"2026-11-04");assert_eq!(rows[0]["quantity"],"500");
        assert!(rows[0]["steward"].get("reviewOn").is_none());assert!(rows[0]["steward"].get("reviewOrigin").is_none());
        let stored:Option<String>=c.query_row("SELECT expires_on FROM inventory_lots WHERE id=?1",[legacy],|r|r.get(0)).unwrap();assert!(stored.is_none());
    }
}

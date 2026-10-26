use super::*;
use crate::db::{self, tests::draft};
fn perform(c: &mut Connection, value: Value) {
    db::execute(
        c,
        &Uuid::new_v4().to_string(),
        serde_json::from_value(value).unwrap(),
    )
    .unwrap();
}
fn view(c: &Connection) -> Value {
    let mut s = db::snapshot(c).unwrap();
    s.as_object_mut().unwrap().remove("dataRevision");
    s
}
fn undo(c: &mut Connection) {
    let latest = status(c).unwrap();
    perform(
        c,
        json!({"type":"undo","operation_id":latest["operationId"]}),
    );
}

#[test]
fn saved_recipe_menu_and_inventory_actions_undo_in_order_across_restart() {
    let path = super::super::tests::temp();
    let mut c = db::open(&path).unwrap();
    let empty = view(&c);
    db::execute(
        &mut c,
        &Uuid::new_v4().to_string(),
        Command::CreateRecipe { draft: draft() },
    )
    .unwrap();
    let recipe = view(&c);
    perform(
        &mut c,
        json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":recipe["recipes"][0]["revisionId"],"custom_title":null,"day":"2026-10-26","meal":"晚餐","servings":2}}),
    );
    let menu = view(&c);
    perform(
        &mut c,
        json!({"type":"receive_lot","draft":{"name":"西兰花","category":"未分类","quantity":"300","unit":"g","location":"冷藏","received":"2026-10-26","expires":null,"precision":"rough"}}),
    );
    let stock = view(&c);
    let lot = &stock["lots"][0];
    perform(
        &mut c,
        json!({"type":"change_lot","lot_id":lot["id"],"expected_version":1,"operation":"correct","quantity":"200","location":null,"reason":""}),
    );
    drop(c);
    let mut c = db::open(&path).unwrap();
    undo(&mut c);
    assert_eq!(view(&c), stock);
    undo(&mut c);
    assert_eq!(view(&c), menu);
    undo(&mut c);
    assert_eq!(view(&c), recipe);
    undo(&mut c);
    assert_eq!(view(&c), empty);
    assert!(status(&c).unwrap().is_null());
    db::execute(
        &mut c,
        &Uuid::new_v4().to_string(),
        Command::CreateRecipe { draft: draft() },
    )
    .unwrap();
}

#[test]
fn undo_cooking_restores_stock_and_completion_as_one_action() {
    let mut c = db::open(&super::super::tests::temp()).unwrap();
    db::execute(
        &mut c,
        &Uuid::new_v4().to_string(),
        Command::CreateRecipe { draft: draft() },
    )
    .unwrap();
    let s = db::snapshot(&c).unwrap();
    let today = db::shopping::local_today(&c).unwrap();
    perform(
        &mut c,
        json!({"type":"save_plan","plan_id":null,"expected_version":null,"draft":{"recipe_revision_id":s["recipes"][0]["revisionId"],"custom_title":null,"day":today,"meal":"晚餐","servings":2}}),
    );
    perform(
        &mut c,
        json!({"type":"receive_lot","draft":{"name":"西兰花","category":"未分类","quantity":"300","unit":"g","location":"冷藏","received":today,"expires":null,"precision":"rough"}}),
    );
    let before = view(&c);
    let s = db::snapshot(&c).unwrap();
    perform(
        &mut c,
        json!({"type":"complete_cooking","draft":{"plan_id":s["plans"][0]["id"],"expected_version":1,"expected_revision":s["dataRevision"],"servings":2,"date":today,"note":"全局撤销测试","acknowledged":true,"consumptions":[{"lot_id":s["lots"][0]["id"],"expected_version":1,"quantity":"100"}]}}),
    );
    assert!(!view(&c)["plans"][0]["cooking"].is_null());
    undo(&mut c);
    assert_eq!(view(&c), before);
}
#[test]
fn recipe_cover_removal_and_undo_keep_original_media_and_credit() {
    let mut c = db::open(&super::super::tests::temp()).unwrap();
    let mut recipe = draft();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
        .encode_image(&image::DynamicImage::ImageRgb8(
            image::RgbImage::from_pixel(2, 2, image::Rgb([220, 40, 20])),
        ))
        .unwrap();
    use base64::{engine::general_purpose::STANDARD, Engine};
    let data = format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg));
    recipe.media = Some(crate::recipe_images::Media {
        cover: Some(data.clone()),
        cover_credit: Some(crate::recipe_images::Credit {
            source_url: "https://commons.wikimedia.org/wiki/File:Test_dish.jpg".into(),
            author: "Synthetic".into(),
            license: "CC0".into(),
            license_url: "".into(),
            title: "Test dish".into(),
        }),
        steps: vec![crate::recipe_images::StepImage {
            image: data,
            source_step: 1,
        }],
    });
    db::execute(
        &mut c,
        &Uuid::new_v4().to_string(),
        Command::CreateRecipe {
            draft: recipe.clone(),
        },
    )
    .unwrap();
    let before = view(&c);
    let current = &before["recipes"][0];
    recipe.media = Some(crate::recipe_images::Media::default());
    db::execute(
        &mut c,
        &Uuid::new_v4().to_string(),
        Command::ReviseRecipe {
            recipe_id: current["id"].as_str().unwrap().into(),
            expected_revision_id: current["revisionId"].as_str().unwrap().into(),
            draft: recipe,
        },
    )
    .unwrap();
    assert_eq!(view(&c)["recipes"][0]["image"], "placeholder");
    undo(&mut c);
    assert_eq!(view(&c), before);
}

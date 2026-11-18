//! 联网冒烟测试，默认不跑：cargo test --lib live -- --ignored --nocapture

use std::sync::Arc;

use crate::appapi::AppApi;
use crate::util::{self, str_of};
use crate::{chapters, webapi};

#[test]
#[ignore]
fn live_全链路() {
    let dir = std::env::temp_dir().join(format!("fanqie-live-{}", std::process::id()));
    util::init_root(dir.clone());
    // 设备注册走 i.snssdk.com，部分网络环境下握手会被掐断；有旧版已注册的设备就直接沿用
    if let Some(home) = std::env::var_os("HOME") {
        let old = std::path::Path::new(&home).join("Library/Application Support/fanqie-desktop/data/device.json");
        if old.exists() {
            std::fs::create_dir_all(dir.join("data")).unwrap();
            std::fs::copy(old, dir.join("data/device.json")).unwrap();
        }
    }
    tauri::async_runtime::block_on(async {
        let api = Arc::new(AppApi::new());

        let r = api.search_books("三体").await.expect("App 搜索");
        let books = r["books"].as_array().unwrap();
        assert!(!books.is_empty(), "搜索无结果");
        println!("搜索 {} 本，首本：{}", books.len(), books[0]["title"]);
        let book_id = str_of(&books[0]["id"]);

        let detail = webapi::get_book_detail(&book_id).await;
        println!("详情：{} / {}", detail["title"], detail["author"]);
        assert!(detail["title"].as_str().map_or(false, |s| !s.is_empty()));

        let chs = webapi::get_chapters(&book_id).await;
        let arr = chs.as_array().unwrap();
        assert!(arr.len() > 3, "目录为空");
        chapters::register_book(&book_id, arr.iter().map(|c| str_of(&c["id"])).collect());
        let first = str_of(&arr[0]["id"]);
        println!("目录 {} 章，首章 id={} {}", arr.len(), first, arr[0]["title"]);

        let ch = chapters::get_chapter(api.clone(), &first).await.expect("正文");
        println!("正文 {} 段，首段：{}", ch.para_idx.len(), ch.content.lines().next().unwrap_or(""));
        assert!(!ch.content.is_empty());
        // 第二章应已被预取进缓存
        let t = std::time::Instant::now();
        let second = str_of(&arr[1]["id"]);
        chapters::get_chapter(api.clone(), &second).await.expect("第二章");
        println!("第二章耗时 {:?}（预取命中应远小于 6s）", t.elapsed());

        let long = chapters::get_chapter(api.clone(), &str_of(&arr[10]["id"])).await.expect("第十一章");
        assert!(long.content.chars().count() > 200, "正文过短");
        println!("第十一章 {} 字", long.content.chars().count());

        let stats = api.comment_stats(&first, "").await.expect("段评统计");
        println!("段评统计 {} 段有评论", stats.as_object().unwrap().len());

        let tones = api.audio_tones(&book_id).await.expect("音色");
        println!("音色 {} 个", tones.as_array().unwrap().len());

        let rank = webapi::get_ranking("1_2_1141", 0).await;
        println!("排行 {} 本，首本：{}", rank["books"].as_array().unwrap().len(), rank["books"][0]["title"]);
        assert!(!rank["books"].as_array().unwrap().is_empty());
        let top = webapi::get_ranking("top", 0).await;
        println!("巅峰榜 {} 本", top["books"].as_array().unwrap().len());
        let rec = webapi::get_recommend().await;
        println!("首页推荐 {} 组", rec.as_array().unwrap().len());
        assert!(!rec.as_array().unwrap().is_empty());
        println!("表情 {} 个", webapi::get_emojis().await.as_object().unwrap().len());
        println!("网页搜索兜底 {} 本", webapi::search("三体", 0).await["books"].as_array().unwrap().len());
    });
    let _ = std::fs::remove_dir_all(dir);
}

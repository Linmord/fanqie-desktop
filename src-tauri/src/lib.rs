#![recursion_limit = "512"]

mod account;
mod appapi;
mod chapters;
mod crypto;
mod fontdecode;
mod store;
mod updater;
mod util;
mod webapi;
#[cfg(test)]
mod live_test;

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{Manager, State, Theme, WebviewWindow, WindowEvent};
use tokio::sync::Mutex;

use appapi::AppApi;
use util::{str_of, truthy, R};

type Api<'a> = State<'a, Arc<AppApi>>;

// ---------------------------------------------------------------- 搜索 / 详情 / 正文
#[tauri::command]
async fn api_search(api: Api<'_>, query: String, page: Option<i64>) -> R<Value> {
    // 网页搜索页是客户端渲染，SSR 拿不到结果，优先走 App 搜索接口
    match api.search_books(&query).await {
        Ok(v) => Ok(v),
        Err(e) => {
            eprintln!("App 搜索失败，回退 Web 搜索: {e}");
            Ok(webapi::search(&query, page.unwrap_or(0)).await)
        }
    }
}

#[tauri::command]
async fn api_book_detail(book_id: String) -> R<Value> {
    Ok(webapi::get_book_detail(&book_id).await)
}

#[tauri::command]
async fn api_chapters(book_id: String) -> R<Value> {
    let chapters = webapi::get_chapters(&book_id).await;
    let ids = chapters.as_array().map(|a| a.iter().map(|c| str_of(&c["id"])).collect()).unwrap_or_default();
    chapters::register_book(&book_id, ids);
    Ok(chapters)
}

// 优先 App API，无章节限制且无字体加密
#[tauri::command]
async fn api_chapter_content(api: Api<'_>, item_id: String) -> R<Value> {
    match chapters::get_chapter(api.inner().clone(), &item_id).await {
        Ok(d) => Ok(json!({ "content": d.content, "fontCss": "", "paraIdx": d.para_idx })),
        Err(e) => {
            eprintln!("App API 失败，回退 Web API: {e}");
            Ok(webapi::get_chapter_content(&item_id).await)
        }
    }
}

// ---------------------------------------------------------------- 段评
#[tauri::command]
async fn comment_stats(api: Api<'_>, item_id: String) -> R<Value> {
    api.comment_stats(&item_id, &account::get_cookie_header()).await
}

#[tauri::command]
async fn comment_list(
    api: Api<'_>,
    item_id: String,
    book_id: String,
    para_index: i64,
    cursor: Option<String>,
    sort: Option<i64>,
) -> R<Value> {
    let cookie = account::get_cookie_header();
    api.comment_list(&item_id, &book_id, para_index, &cursor.unwrap_or_default(), sort.unwrap_or(1), &cookie).await
}

#[tauri::command]
async fn comment_replies(api: Api<'_>, comment_id: String, cursor: Option<String>) -> R<Value> {
    api.comment_replies(&comment_id, &cursor.unwrap_or_default(), &account::get_cookie_header()).await
}

#[tauri::command]
async fn comment_add(
    api: Api<'_>,
    item_id: String,
    book_id: String,
    para_index: i64,
    para_text: String,
    text: String,
) -> R<Value> {
    api.comment_add(&item_id, &book_id, para_index, &para_text, &text, &account::get_cookie_header()).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn comment_reply(
    api: Api<'_>,
    item_id: String,
    book_id: String,
    para_index: i64,
    para_text: String,
    root_id: String,
    to_user_id: String,
    text: String,
    to_reply_id: Option<String>,
) -> R<Value> {
    let cookie = account::get_cookie_header();
    api.reply_add(&item_id, &book_id, para_index, &para_text, &root_id, &to_user_id, &text, &to_reply_id.unwrap_or_default(), &cookie)
        .await
}

#[tauri::command]
async fn comment_digg(
    api: Api<'_>,
    book_id: String,
    id: String,
    like: bool,
    is_reply: bool,
    service_id: Option<i64>,
) -> R<()> {
    api.comment_digg(&book_id, &id, like, is_reply, service_id.unwrap_or(1), &account::get_cookie_header()).await
}

#[tauri::command]
async fn comment_emojis() -> R<Value> {
    Ok(webapi::get_emojis().await)
}

// ---------------------------------------------------------------- 听书
#[tauri::command]
async fn audio_tones(api: Api<'_>, book_id: String) -> R<Value> {
    api.audio_tones(&book_id).await
}

#[tauri::command]
async fn audio_play_info(api: Api<'_>, item_id: String, tone_id: Value) -> R<Value> {
    api.audio_play_info(&item_id, &str_of(&tone_id)).await
}

#[tauri::command]
async fn audio_timepoints(api: Api<'_>, book_id: String, item_id: String, tone_id: Value) -> R<Value> {
    api.audio_timepoints(&book_id, &item_id, &str_of(&tone_id)).await
}

#[tauri::command]
async fn audio_narration(api: Api<'_>, book_id: String, item_id: String, abook_id: String) -> R<Value> {
    api.audio_narration(&book_id, &item_id, &abook_id).await
}

// ---------------------------------------------------------------- 分类 / 排行 / 推荐
#[tauri::command]
async fn api_categories() -> R<Value> {
    Ok(webapi::get_categories())
}

#[tauri::command]
async fn api_ranking(rank_id: Option<String>, page: Option<i64>) -> R<Value> {
    Ok(webapi::get_ranking(&rank_id.unwrap_or_else(|| "1_2_1141".into()), page.unwrap_or(0)).await)
}

#[tauri::command]
async fn api_recommend() -> R<Value> {
    Ok(webapi::get_recommend().await)
}

// ---------------------------------------------------------------- 书架 / 设置
#[tauri::command]
async fn store_get_bookshelf() -> R<Value> {
    Ok(store::get_bookshelf())
}

#[tauri::command]
async fn store_add_to_bookshelf(item: Value) -> R<Value> {
    Ok(store::add_to_bookshelf(item))
}

#[tauri::command]
async fn store_remove_from_bookshelf(book_id: String) -> R<Value> {
    Ok(store::remove_from_bookshelf(&book_id))
}

#[tauri::command]
async fn store_update_bookshelf_item(book_id: String, data: Value) -> R<Value> {
    Ok(store::update_bookshelf_item(&book_id, data))
}

#[tauri::command]
async fn store_replace_bookshelf(items: Value) -> R<Value> {
    Ok(store::replace_bookshelf(items))
}

#[tauri::command]
async fn store_get_settings() -> R<Value> {
    Ok(store::get_settings())
}

#[tauri::command]
async fn store_save_settings(settings: Value) -> R<Value> {
    Ok(store::save_settings(settings))
}

// ---------------------------------------------------------------- 番茄账号
#[tauri::command]
async fn account_get_qrcode() -> R<Value> {
    account::get_qrcode().await
}

#[tauri::command]
async fn account_check_qrcode(token: String) -> R<Value> {
    account::check_qrcode(&token).await
}

#[tauri::command]
async fn account_get_user() -> R<Value> {
    Ok(account::get_user().await)
}

#[tauri::command]
async fn account_logout() -> R<()> {
    account::logout().await;
    Ok(())
}

#[tauri::command]
async fn account_get_cloud_shelf() -> R<Value> {
    let mut shelf = account::get_cloud_shelf().await?;
    let Some(items) = shelf.as_array_mut() else { return Ok(shelf) };

    // 书架详情接口不带作者：先用本地缓存，缺的再并发查网页详情补全；失败不影响书架本身
    let cached: HashMap<String, Value> = store::get_bookshelf()
        .as_array()
        .map(|a| a.iter().map(|i| (str_of(&i["book"]["id"]), i["book"].clone())).collect())
        .unwrap_or_default();
    for item in items.iter_mut() {
        let book = &mut item["book"];
        let Some(c) = cached.get(&str_of(&book["id"])) else { continue };
        if truthy(&c["author"]) {
            if !truthy(&book["author"]) {
                book["author"] = c["author"].clone();
            }
            if !truthy(&book["category"]) {
                book["category"] = if truthy(&c["category"]) { c["category"].clone() } else { json!("") };
            }
            if !truthy(&book["wordCount"]) {
                book["wordCount"] = if truthy(&c["wordCount"]) { c["wordCount"].clone() } else { json!(0) };
            }
        }
    }

    let queue: VecDeque<String> = items
        .iter()
        .filter(|i| !truthy(&i["book"]["author"]))
        .map(|i| str_of(&i["book"]["id"]))
        .collect();
    let queue = Arc::new(Mutex::new(queue));
    let details: Arc<Mutex<HashMap<String, Value>>> = Arc::new(Mutex::new(HashMap::new()));
    let workers: Vec<_> = (0..8)
        .map(|_| {
            let (queue, details) = (queue.clone(), details.clone());
            tauri::async_runtime::spawn(async move {
                loop {
                    let Some(id) = queue.lock().await.pop_front() else { break };
                    let d = webapi::get_book_detail(&id).await;
                    if truthy(&d) {
                        details.lock().await.insert(id, d);
                    }
                }
            })
        })
        .collect();
    for w in workers {
        let _ = w.await;
    }
    let details = details.lock().await;
    for item in items.iter_mut() {
        let book = &mut item["book"];
        let Some(d) = details.get(&str_of(&book["id"])) else { continue };
        book["author"] = if truthy(&d["author"]) { d["author"].clone() } else { json!("") };
        for k in ["category", "wordCount", "latestChapter"] {
            if !truthy(&book[k]) {
                book[k] = if truthy(&d[k]) { d[k].clone() } else if k == "wordCount" { json!(0) } else { json!("") };
            }
        }
    }
    drop(details);
    Ok(shelf)
}

#[tauri::command]
async fn account_add_to_cloud_shelf(book_id: String) -> R<()> {
    account::add_to_cloud_shelf(&book_id).await
}

#[tauri::command]
async fn account_remove_from_cloud_shelf(book_id: String) -> R<()> {
    account::remove_from_cloud_shelf(&book_id).await
}

#[tauri::command]
async fn account_update_cloud_progress(book_id: String, item_id: String, index: i64, progress: f64) -> R<()> {
    account::update_cloud_progress(&book_id, &item_id, index, progress).await
}

// ---------------------------------------------------------------- 外观
/// 窗口底色与页面主题一致，避免启动和切换明暗时闪一下别的颜色
fn paint_window(window: &WebviewWindow) {
    let dark = match store::get_appearance().as_str() {
        "dark" => true,
        "light" => false,
        _ => window.theme().map(|t| t == Theme::Dark).unwrap_or(false),
    };
    let color = if dark { tauri::window::Color(0x26, 0x26, 0x24, 0xFF) } else { tauri::window::Color(0xFA, 0xF9, 0xF5, 0xFF) };
    let _ = window.set_background_color(Some(color));
}

fn apply_appearance(app: &tauri::AppHandle, mode: &str) {
    // 外观模式交给系统主题，页面里的 prefers-color-scheme 会跟着变
    let theme = match mode {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    };
    app.set_theme(theme);
    if let Some(w) = app.get_webview_window("main") {
        paint_window(&w);
    }
}

#[tauri::command]
async fn app_get_appearance() -> R<String> {
    Ok(store::get_appearance())
}

#[tauri::command]
async fn app_set_appearance(app: tauri::AppHandle, mode: String) -> R<String> {
    let saved = store::save_appearance(&mode)?;
    apply_appearance(&app, &saved);
    Ok(saved)
}

macro_rules! handlers {
    ($($extra:ident),*) => {
        tauri::generate_handler![
            api_search,
            api_book_detail,
            api_chapters,
            api_chapter_content,
            comment_stats,
            comment_list,
            comment_replies,
            comment_add,
            comment_reply,
            comment_digg,
            comment_emojis,
            audio_tones,
            audio_play_info,
            audio_timepoints,
            audio_narration,
            api_categories,
            api_ranking,
            api_recommend,
            store_get_bookshelf,
            store_add_to_bookshelf,
            store_remove_from_bookshelf,
            store_update_bookshelf_item,
            store_replace_bookshelf,
            store_get_settings,
            store_save_settings,
            account_get_qrcode,
            account_check_qrcode,
            account_get_user,
            account_logout,
            account_get_cloud_shelf,
            account_add_to_cloud_shelf,
            account_remove_from_cloud_shelf,
            account_update_cloud_progress,
            app_get_appearance,
            $($extra),*
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(AppApi::new()))
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            util::init_root(root.clone());
            // 旧版（Electron）的数据目录叫 fanqie-desktop，与新目录同级
            if let Some(parent) = root.parent() {
                store::migrate_legacy(&parent.join("fanqie-desktop").join("data"));
            }

            let handle = app.handle().clone();
            apply_appearance(&handle, &store::get_appearance());
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::ThemeChanged(_)) {
                        paint_window(&w);
                    }
                });
            }

            std::thread::spawn(chapters::prune);
            updater::check(handle);
            Ok(())
        })
        .invoke_handler(handlers!(app_set_appearance))
        .run(tauri::generate_context!())
        .expect("启动失败");
}

#[cfg(test)]
mod ipc_test {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::webview::InvokeRequest;

    fn invoke(webview: &tauri::WebviewWindow<tauri::test::MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|b| b.deserialize::<Value>().unwrap())
    }

    /// native.ts 里每个命令传的参数名，必须和 Rust 命令签名（snake_case → camelCase）一一对应：
    /// 不带任何参数调用，错误信息会点名缺的第一个参数
    #[test]
    fn 前端参数名与命令签名一致() {
        let dir = std::env::temp_dir().join(format!("fanqie-ipc-{}", std::process::id()));
        util::init_root(dir.clone());
        let app = mock_builder()
            .manage(Arc::new(AppApi::new()))
            .invoke_handler(handlers!())
            .build(mock_context(noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();

        // 命令 → 第一个必填参数（前端传的名字）
        let first_required = [
            ("api_search", "query"), ("api_book_detail", "bookId"), ("api_chapters", "bookId"),
            ("api_chapter_content", "itemId"), ("comment_stats", "itemId"), ("comment_list", "itemId"),
            ("comment_replies", "commentId"), ("comment_add", "itemId"), ("comment_reply", "itemId"),
            ("comment_digg", "bookId"), ("audio_tones", "bookId"), ("audio_play_info", "itemId"),
            ("audio_timepoints", "bookId"), ("audio_narration", "bookId"),
            ("store_add_to_bookshelf", "item"), ("store_remove_from_bookshelf", "bookId"),
            ("store_update_bookshelf_item", "bookId"), ("store_replace_bookshelf", "items"),
            ("store_save_settings", "settings"), ("account_check_qrcode", "token"),
            ("account_add_to_cloud_shelf", "bookId"), ("account_remove_from_cloud_shelf", "bookId"),
            ("account_update_cloud_progress", "bookId"), 
        ];
        for (cmd, key) in first_required {
            let err = invoke(&webview, cmd, json!({})).expect_err(cmd);
            assert!(err.to_string().contains(key), "{cmd} 的错误应点名 {key}，实际：{err}");
        }

        // 后面几个参数名：补齐前面的，逐个核对
        let all = [
            ("comment_list", vec!["itemId", "bookId", "paraIndex"]),
            ("comment_add", vec!["itemId", "bookId", "paraIndex", "paraText", "text"]),
            ("comment_reply", vec!["itemId", "bookId", "paraIndex", "paraText", "rootId", "toUserId", "text"]),
            ("comment_digg", vec!["bookId", "id", "like", "isReply"]),
            ("audio_play_info", vec!["itemId", "toneId"]),
            ("audio_timepoints", vec!["bookId", "itemId", "toneId"]),
            ("audio_narration", vec!["bookId", "itemId", "abookId"]),
            ("store_update_bookshelf_item", vec!["bookId", "data"]),
            ("account_update_cloud_progress", vec!["bookId", "itemId", "index", "progress"]),
        ];
        for (cmd, keys) in all {
            let mut body = serde_json::Map::new();
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    // 前一个键补上，错误应推进到下一个键
                    let prev = keys[i - 1];
                    let v = match prev {
                        "paraIndex" | "index" => json!(1),
                        "like" | "isReply" => json!(true),
                        "progress" => json!(0.5),
                        "data" => json!({}),
                        "toneId" => json!(1),
                        _ => json!("x"),
                    };
                    body.insert(prev.to_string(), v);
                }
                let err = invoke(&webview, cmd, Value::Object(body.clone())).expect_err(cmd);
                assert!(err.to_string().contains(k), "{cmd}：缺 {k} 时错误应点名它，实际：{err}");
            }
        }

        // 本地存储命令端到端走一遍
        let item = json!({ "book": { "id": "42", "title": "测试" }, "progress": 0 });
        let shelf = invoke(&webview, "store_add_to_bookshelf", json!({ "item": item })).unwrap();
        assert_eq!(shelf[0]["book"]["id"], "42");
        let shelf = invoke(&webview, "store_update_bookshelf_item", json!({ "bookId": "42", "data": { "progress": 0.5 } })).unwrap();
        assert_eq!(shelf[0]["progress"], 0.5);
        assert!(shelf[0]["updatedAt"].as_str().unwrap().ends_with('Z'));
        let shelf = invoke(&webview, "store_remove_from_bookshelf", json!({ "bookId": "42" })).unwrap();
        assert_eq!(shelf, json!([]));
        let settings = invoke(&webview, "store_get_settings", json!({})).unwrap();
        assert_eq!(settings["fontSize"], 18);
        assert_eq!(invoke(&webview, "api_categories", json!({})).unwrap()[0]["name"], "男频");
        let _ = std::fs::remove_dir_all(dir);
    }
}

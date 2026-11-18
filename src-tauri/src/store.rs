//! 本地书架与设置的 JSON 存储。

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::util::{data_dir, str_of, R};

// 多个命令可能同时读写同一个文件
static LOCK: Mutex<()> = Mutex::new(());

fn read_json(name: &str, fallback: Value) -> Value {
    std::fs::read_to_string(data_dir().join(name))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(fallback)
}

fn write_json(name: &str, data: &Value) {
    let dir = data_dir();
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(text) = serde_json::to_string_pretty(data) {
        let _ = std::fs::write(dir.join(name), text);
    }
}

fn shelf_ids_eq(item: &Value, book_id: &str) -> bool {
    str_of(&item["book"]["id"]) == book_id
}

fn read_shelf() -> Vec<Value> {
    match read_json("bookshelf.json", json!([])) {
        Value::Array(a) => a,
        _ => vec![],
    }
}

pub fn get_bookshelf() -> Value {
    let _g = LOCK.lock().unwrap();
    Value::Array(read_shelf())
}

pub fn add_to_bookshelf(item: Value) -> Value {
    let _g = LOCK.lock().unwrap();
    let mut shelf = read_shelf();
    let id = str_of(&item["book"]["id"]);
    if shelf.iter().any(|b| shelf_ids_eq(b, &id)) {
        return Value::Array(shelf);
    }
    shelf.insert(0, item);
    let out = Value::Array(shelf);
    write_json("bookshelf.json", &out);
    out
}

pub fn remove_from_bookshelf(book_id: &str) -> Value {
    let _g = LOCK.lock().unwrap();
    let shelf: Vec<Value> = read_shelf().into_iter().filter(|b| !shelf_ids_eq(b, book_id)).collect();
    let out = Value::Array(shelf);
    write_json("bookshelf.json", &out);
    out
}

pub fn update_bookshelf_item(book_id: &str, data: Value) -> Value {
    let _g = LOCK.lock().unwrap();
    let mut shelf = read_shelf();
    if let Some(item) = shelf.iter_mut().find(|b| shelf_ids_eq(b, book_id)) {
        if let (Some(dst), Some(src)) = (item.as_object_mut(), data.as_object()) {
            for (k, v) in src {
                dst.insert(k.clone(), v.clone());
            }
            dst.insert("updatedAt".into(), json!(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)));
        }
        let out = Value::Array(shelf);
        write_json("bookshelf.json", &out);
        return out;
    }
    Value::Array(shelf)
}

pub fn replace_bookshelf(items: Value) -> Value {
    let _g = LOCK.lock().unwrap();
    write_json("bookshelf.json", &items);
    items
}

fn default_settings() -> Value {
    json!({
        "fontSize": 18, "lineHeight": 1.8, "pageWidth": 720,
        "theme": "auto", "fontFamily": "serif", "readingMode": "scroll",
    })
}

pub fn get_settings() -> Value {
    let _g = LOCK.lock().unwrap();
    read_json("settings.json", default_settings())
}

pub fn save_settings(settings: Value) -> Value {
    let _g = LOCK.lock().unwrap();
    write_json("settings.json", &settings);
    settings
}

const APPEARANCES: [&str; 3] = ["system", "light", "dark"];

/// 全应用外观：跟随系统 / 浅色 / 深色，单独存一个文件，不和阅读设置互相覆盖
pub fn get_appearance() -> String {
    let _g = LOCK.lock().unwrap();
    let mode = str_of(&read_json("appearance.json", json!("system")));
    if APPEARANCES.contains(&mode.as_str()) { mode } else { "system".into() }
}

pub fn save_appearance(mode: &str) -> R<String> {
    let _g = LOCK.lock().unwrap();
    let value = if APPEARANCES.contains(&mode) { mode } else { "system" };
    write_json("appearance.json", &json!(value));
    Ok(value.to_string())
}

/// 首次启动时把旧版（Electron）数据目录里的书架、设置、设备信息拷过来。云登录态是加密存的，带不过来，需重新扫码
pub fn migrate_legacy(old_dir: &std::path::Path) {
    let dir = data_dir();
    if dir.join("bookshelf.json").exists() || !old_dir.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    for name in ["bookshelf.json", "settings.json", "appearance.json", "device.json"] {
        let src = old_dir.join(name);
        if src.exists() && !dir.join(name).exists() {
            let _ = std::fs::copy(&src, dir.join(name));
        }
    }
}

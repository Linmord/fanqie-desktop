//! 番茄账号：扫码登录（用番茄小说 App 扫码）+ 云书架 / 阅读进度同步。
//!
//! 登录走字节 passport 网页扫码流程，拿到 sessionid 等 Cookie；
//! 书架与进度走官方 reading/bookapi 接口（fanqienovel.com 域，只认 Cookie，不需要签名）。
//! Cookie 存在应用数据目录的 data/account.json（仅当前用户可读）。

use std::collections::BTreeMap;
use std::sync::Mutex;

use regex::Regex;
use serde_json::{json, Value};

use crate::util::{self, data_dir, form_encode, num, num_json, str_of, truthy, Req, R, WEB_UA};

const BASE: &str = "https://fanqienovel.com";
const LOGIN_PAGE: &str = "https://fanqienovel.com/main/writer/login";
const SHELF_PARAMS: &str = "aid=1967&iid=0&version_code=57700&update_version_code=57700";
const SESSION_KEYS: [&str; 3] = ["sessionid", "sessionid_ss", "sid_tt"];

#[derive(Default)]
struct Account {
    jar: BTreeMap<String, String>,
    user: Option<Value>,
    loaded: bool,
}

static ACCOUNT: Mutex<Option<Account>> = Mutex::new(None);

fn with<T>(f: impl FnOnce(&mut Account) -> T) -> T {
    let mut guard = ACCOUNT.lock().unwrap();
    let acc = guard.get_or_insert_with(Account::default);
    if !acc.loaded {
        acc.loaded = true;
        if let Ok(text) = std::fs::read_to_string(data_dir().join("account.json")) {
            if let Ok(saved) = serde_json::from_str::<Value>(&text) {
                if let Some(jar) = saved["jar"].as_object() {
                    acc.jar = jar.iter().map(|(k, v)| (k.clone(), str_of(v))).collect();
                }
                acc.user = Some(saved["user"].clone()).filter(|u| truthy(u));
            }
        }
    }
    f(acc)
}

fn has_session_in(acc: &Account) -> bool {
    SESSION_KEYS.iter().any(|k| acc.jar.get(*k).map_or(false, |v| !v.is_empty()))
}

fn has_session() -> bool {
    with(|a| has_session_in(a))
}

fn persist() {
    let text = with(|a| json!({ "jar": a.jar, "user": a.user }).to_string());
    let dir = data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("account.json");
    if std::fs::write(&file, text).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
        }
    }
}

fn clear() {
    with(|a| {
        a.jar.clear();
        a.user = None;
    });
    let _ = std::fs::remove_file(data_dir().join("account.json"));
}

// ---------------------------------------------------------------- HTTP
fn merge_cookies(headers: &reqwest::header::HeaderMap) {
    static MAX_AGE0: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let max_age0 = MAX_AGE0.get_or_init(|| Regex::new(r"(?i)^\s*max-age=0\s*$").unwrap());
    with(|acc| {
        for line in headers.get_all(reqwest::header::SET_COOKIE) {
            let Ok(line) = line.to_str() else { continue };
            let mut parts = line.split(';');
            let pair = parts.next().unwrap_or("");
            let Some(i) = pair.find('=') else { continue };
            let name = pair[..i].trim().to_string();
            let value = pair[i + 1..].trim().to_string();
            let expired = parts.any(|a| max_age0.is_match(a));
            if value.is_empty() || expired {
                acc.jar.remove(&name);
            } else {
                acc.jar.insert(name, value);
            }
        }
    });
}

fn cookie_header_raw() -> String {
    with(|a| a.jar.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; "))
}

struct Opts<'a> {
    body: Option<Value>,
    manual: bool,
    referer: &'a str,
}

impl Default for Opts<'static> {
    fn default() -> Self {
        Opts { body: None, manual: false, referer: "https://fanqienovel.com/" }
    }
}

async fn request(url: &str, opts: Opts<'_>) -> R<util::Resp> {
    let mut req = Req::get(url)
        .header("User-Agent", WEB_UA)
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .header("Referer", opts.referer)
        .header("Origin", BASE);
    let cookie = cookie_header_raw();
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }
    if let Some(csrf) = with(|a| a.jar.get("passport_csrf_token").cloned()) {
        req = req.header("x-tt-passport-csrf-token", csrf);
    }
    if let Some(body) = opts.body {
        req = req
            .header("Content-Type", "application/json;charset=UTF-8")
            .post(serde_json::to_vec(&body).map_err(|e| e.to_string())?);
    }
    if opts.manual {
        req = req.manual_redirect();
    }
    let res = req.send().await?;
    merge_cookies(&res.headers);
    Ok(res)
}

async fn request_json(url: &str, opts: Opts<'_>) -> R<Value> {
    let res = request(url, opts).await?;
    serde_json::from_slice(&res.body).map_err(|_| format!("接口返回非 JSON（HTTP {}）", res.status))
}

fn passport_query(extra: &[(&str, String)]) -> String {
    let mut pairs: Vec<(String, String)> = [
        ("passport_jssdk_version", "3.0.16"),
        ("passport_jssdk_type", "normal"),
        ("aid", "2503"),
        ("language", "zh"),
        ("account_sdk_source", "web"),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    pairs.extend(extra.iter().map(|(k, v)| (k.to_string(), v.clone())));
    form_encode(&pairs)
}

// ---------------------------------------------------------------- 登录
/// App 接口也认网页登录的 Cookie（段评点赞、发评论用）；未登录返回空串
pub fn get_cookie_header() -> String {
    if has_session() { cookie_header_raw() } else { String::new() }
}

/// 申请登录二维码：返回 { token, image(dataURL), expireTime(秒) }
pub async fn get_qrcode() -> R<Value> {
    with(|a| {
        a.jar.clear();
        a.user = None;
    });
    request(LOGIN_PAGE, Opts { referer: LOGIN_PAGE, ..Default::default() }).await?;
    let json = request_json(
        &format!("{BASE}/passport/web/get_qrcode/?{}", passport_query(&[("need_logo", "true".into()), ("next", format!("{BASE}/"))])),
        Opts { referer: LOGIN_PAGE, ..Default::default() },
    )
    .await?;
    let d = &json["data"];
    if str_of(&json["message"]) != "success" || !truthy(&d["token"]) || !truthy(&d["qrcode"]) {
        let why = if truthy(&d["description"]) {
            str_of(&d["description"])
        } else if truthy(&json["message"]) {
            str_of(&json["message"])
        } else {
            "未知错误".into()
        };
        return Err(format!("获取二维码失败：{why}"));
    }
    Ok(json!({
        "token": d["token"],
        "image": format!("data:image/png;base64,{}", str_of(&d["qrcode"])),
        "expireTime": num_json(num(&d["expire_time"])),
    }))
}

/// 手动跟随重定向，保留每一跳的 Set-Cookie（sessionid 可能在任意一跳下发）
async fn follow_redirects(first: &str) {
    let mut url = first.to_string();
    for _ in 0..6 {
        if url.is_empty() {
            break;
        }
        let Ok(res) = request(&url, Opts { manual: true, referer: LOGIN_PAGE, ..Default::default() }).await else { return };
        if has_session() {
            return;
        }
        url = res
            .headers
            .get(reqwest::header::LOCATION)
            .and_then(|l| l.to_str().ok())
            .and_then(|loc| url::Url::parse(&url).ok().and_then(|base| base.join(loc).ok()))
            .map(|u| u.to_string())
            .unwrap_or_default();
    }
}

/// 轮询扫码状态：
///   new 等待扫码 / scanned 已扫码待确认 / expired 已过期 / success 登录成功（附带 user）
pub async fn check_qrcode(token: &str) -> R<Value> {
    let res = request(
        &format!("{BASE}/passport/web/check_qrconnect/?{}", passport_query(&[("token", token.to_string()), ("next", format!("{BASE}/"))])),
        Opts { manual: true, referer: LOGIN_PAGE, ..Default::default() },
    )
    .await?;
    // 302 时没有 body
    let data = serde_json::from_slice::<Value>(&res.body).map(|v| v["data"].clone()).unwrap_or(Value::Null);
    let status = str_of(&data["status"]);

    if !has_session() && (status == "confirmed" || status == "success") && truthy(&data["redirect_url"]) {
        follow_redirects(&str_of(&data["redirect_url"])).await;
    }
    if has_session() {
        persist();
        return Ok(json!({ "status": "success", "user": get_user().await }));
    }
    if status == "expired" {
        return Ok(json!({ "status": "expired" }));
    }
    if status == "scanned" {
        return Ok(json!({ "status": "scanned" }));
    }
    if truthy(&data["error_code"]) && status != "new" {
        let msg = if truthy(&data["description"]) {
            str_of(&data["description"])
        } else {
            format!("登录失败（{}）", str_of(&data["error_code"]))
        };
        return Ok(json!({ "status": "error", "message": msg }));
    }
    Ok(json!({ "status": "new" }))
}

/// 当前登录用户：{ id, name, avatar }，未登录返回 null
pub async fn get_user() -> Value {
    if !has_session() {
        return Value::Null;
    }
    // 番茄自己的资料（App 里的昵称和头像），passport 账号信息里只有字节默认昵称
    if let Ok(json) = request_json(&format!("{BASE}/api/user/info/v2"), Opts::default()).await {
        let d = &json["data"];
        if num(&json["code"]) == 0.0 && truthy(&d["id"]) {
            let user = json!({
                "id": str_of(&d["id"]),
                "name": if truthy(&d["name"]) { str_of(&d["name"]) } else { "番茄用户".into() },
                "avatar": str_of(&d["avatar"]),
                "isVip": truthy(&d["isVip"]),
            });
            with(|a| a.user = Some(user));
            persist();
        } else if str_of(&json["message"]).contains("登录") {
            // 登录态已失效
            logout().await;
            return Value::Null;
        }
    }
    // 网络失败时沿用本地缓存的用户信息
    with(|a| a.user.clone()).unwrap_or(Value::Null)
}

pub async fn logout() {
    if has_session() {
        let _ = request(&format!("{BASE}/passport/web/logout/?{}", passport_query(&[])), Opts::default()).await;
    }
    clear();
}

// ---------------------------------------------------------------- 云书架
fn ensure_login() -> R<()> {
    if has_session() { Ok(()) } else { Err("未登录番茄账号".into()) }
}

fn check_code(json: &Value, action: &str) -> R<()> {
    let code = num(&json["code"]);
    if code == 0.0 {
        return Ok(());
    }
    // 101108 无用户信息 / 101119 获取书架失败（未登录）
    if code == 101108.0 || code == 101119.0 {
        return Err("番茄登录已失效，请重新登录".into());
    }
    let why = if truthy(&json["message"]) { str_of(&json["message"]) } else { str_of(&json["code"]) };
    Err(format!("{action}失败：{why}"))
}

fn normalize_cover(url: &str) -> String {
    // 带签名的封面次日过期，换成无签名 CDN 地址
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(novel-(?:pic|static)/[^~?#]+)").unwrap());
    match re.captures(url) {
        Some(m) => format!("https://p6-novel.byteimg.com/{}~tplv-shrink:320:0.image", &m[1]),
        None => url.to_string(),
    }
}

fn iso(ms: f64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms as i64)
        .unwrap_or_default()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 拉取云书架（按加入顺序），附带每本书的云端阅读进度。
/// 返回 [{ book, lastReadChapterId, lastReadChapterTitle, progress, addedAt, updatedAt }]
pub async fn get_cloud_shelf() -> R<Value> {
    ensure_login()?;
    let info = request_json(&format!("{BASE}/reading/bookapi/bookshelf/info/v:version/?{SHELF_PARAMS}"), Opts::default()).await?;
    check_code(&info, "获取书架")?;
    let d = &info["data"];
    let list = if d.is_array() { d } else { &d["book_shelf_info"] };
    let shelf: Vec<Value> = list
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[])
        .iter()
        .filter(|b| truthy(&b["book_id"]) && (if b["book_type"].is_null() { "0".to_string() } else { str_of(&b["book_type"]) }) == "0")
        .cloned()
        .collect();
    if shelf.is_empty() {
        return Ok(json!([]));
    }

    let progress_json = request_json(&format!("{BASE}/api/reader/book/progress"), Opts::default()).await.unwrap_or(Value::Null);
    let progress_map: BTreeMap<String, Value> = progress_json["data"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[])
        .iter()
        .map(|p| (str_of(&p["book_id"]), p.clone()))
        .collect();

    let mut details: BTreeMap<String, Value> = BTreeMap::new();
    // multidetail 一次最多取 50 本
    for chunk in shelf.chunks(50) {
        let books: Vec<Value> = chunk
            .iter()
            .map(|b| {
                let id = str_of(&b["book_id"]);
                let item_id = progress_map.get(&id).map(|p| str_of(&p["item_id"])).filter(|s| !s.is_empty()).unwrap_or_else(|| "0".into());
                json!({ "book_id": id, "item_id": item_id })
            })
            .collect();
        let json = request_json(
            &format!("{BASE}/api/bookshelf/multidetail"),
            Opts { body: Some(json!({ "books": books })), ..Default::default() },
        )
        .await?;
        for item in json["data"]["detail_list"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
            details.insert(str_of(&item["book_id"]), item.clone());
        }
    }

    let now = chrono::Utc::now().timestamp_millis() as f64;
    let out: Vec<Value> = shelf
        .iter()
        .map(|s| {
            let id = str_of(&s["book_id"]);
            let item = details.get(&id).cloned().unwrap_or(Value::Null);
            let progress = progress_map.get(&id).cloned().unwrap_or(Value::Null);
            let added = num(&s["add_shelf_time"]) * 1000.0;
            let added_ms = if added > 0.0 { added } else { now };
            let read = num(&progress["read_timestamp"]) * 1000.0;
            let read_ms = if read > 0.0 { read } else { added_ms };
            let item_id = if truthy(&progress["item_id"]) && str_of(&progress["item_id"]) != "0" { str_of(&progress["item_id"]) } else { String::new() };
            let read_progress = num(&progress["read_progress"]);
            // 服务端进度是万分比，本地统一用 0~1
            let ratio = (read_progress / if read_progress > 1.0 { 10000.0 } else { 1.0 }).min(1.0);
            let pick = |a: &Value, b: &Value| if truthy(a) { str_of(a) } else { str_of(b) };
            json!({
                "book": {
                    "id": id,
                    "title": str_of(&item["book_name"]),
                    "author": str_of(&item["author"]),
                    "cover": normalize_cover(&str_of(&item["thumb_url"])),
                    "description": pick(&item["abstract"], &item["book_abstract_v2"]),
                    "category": str_of(&item["category"]),
                    "wordCount": num_json(num(&item["word_number"])),
                    "status": if str_of(&item["creation_status"]) == "0" { "已完结" } else { "连载中" },
                    "latestChapter": str_of(&item["last_chapter_title"]),
                },
                "lastReadChapterId": item_id,
                "lastReadChapterTitle": if item_id.is_empty() { String::new() } else { str_of(&item["item_show_title"]) },
                "progress": ratio,
                "addedAt": iso(added_ms),
                "updatedAt": iso(read_ms),
            })
        })
        .collect();
    Ok(Value::Array(out))
}

pub async fn add_to_cloud_shelf(book_id: &str) -> R<()> {
    ensure_login()?;
    let body = json!({
        "identify_data": [{ "asterisked": false, "modify_time": chrono::Utc::now().timestamp_millis(), "book_type": 0, "book_id": book_id }],
        "add_book_source": 0,
    });
    let json = request_json(
        &format!("{BASE}/reading/bookapi/bookshelf/add/v:version?{SHELF_PARAMS}"),
        Opts { body: Some(body), ..Default::default() },
    )
    .await?;
    check_code(&json, "加入书架")
}

pub async fn remove_from_cloud_shelf(book_id: &str) -> R<()> {
    ensure_login()?;
    let json = request_json(
        &format!("{BASE}/reading/bookapi/bookshelf/delete/v:version?{SHELF_PARAMS}"),
        Opts { body: Some(json!({ "identify_data": [{ "book_id": book_id }] })), ..Default::default() },
    )
    .await?;
    check_code(&json, "移出书架")
}

/// 上报阅读进度：item_id 为章节 id，progress 为整书进度（0~1）
pub async fn update_cloud_progress(book_id: &str, item_id: &str, index: i64, progress: f64) -> R<()> {
    ensure_login()?;
    let body = json!({
        "book_id": book_id,
        "item_id": item_id,
        // 服务端用万分比存整书进度
        "read_progress": (progress * 10000.0).round() as i64,
        "index": index,
        "read_timestamp": chrono::Utc::now().timestamp().to_string(),
        "genre_type": 0,
    });
    let json = request_json(&format!("{BASE}/api/reader/book/update_progress"), Opts { body: Some(body), ..Default::default() }).await?;
    check_code(&json, "同步进度")
}

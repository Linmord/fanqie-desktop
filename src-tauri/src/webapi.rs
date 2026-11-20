//! 番茄网页端（fanqienovel.com）接口：搜索兜底、详情、目录、分类、排行、首页推荐、段评表情。

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};

use rand::Rng;
use regex::Regex;
use serde_json::{json, Value};
use tokio::sync::OnceCell;

use crate::fontdecode::decode_text;
use crate::util::{or, str_of, truthy, Req, R, WEB_UA};

const WEB_HOST: &str = "https://fanqienovel.com";

/// 对应 JS 的 encodeURI：保留 URL 保留字符，其余非 ASCII 和不安全字符转 %XX
fn encode_uri(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for b in path.bytes() {
        let keep = b.is_ascii_alphanumeric()
            || b"-_.!~*'();/?:@&=+$,#[]%".contains(&b);
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

async fn web_request(path: &str) -> R<(String, reqwest::header::HeaderMap)> {
    let cookie = format!("novel_web_id={}", rand::thread_rng().gen::<u64>());
    let url = format!("{WEB_HOST}{}", encode_uri(path));
    let res = Req::get(&url)
        .header("User-Agent", WEB_UA)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .header("Cookie", cookie)
        .timeout(15)
        .compress()
        .send()
        .await?;
    Ok((res.text(), res.headers))
}

/// 取页面里的 window.__INITIAL_STATE__，按花括号配对截出 JSON
fn extract_state(html: &str) -> Option<Value> {
    const MARKER: &str = "window.__INITIAL_STATE__=";
    let start = html.find(MARKER)? + MARKER.len();
    let bytes = html.as_bytes();
    let mut depth: i64 = 0;
    let mut end = start;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if b == b'{' {
            depth += 1;
        } else if b == b'}' {
            depth -= 1;
        }
        if depth == 0 {
            end = i + 1;
            break;
        }
    }
    static UNDEF: OnceLock<Regex> = OnceLock::new();
    let undef = UNDEF.get_or_init(|| Regex::new(r"\bundefined\b").unwrap());
    let raw = undef.replace_all(&html[start..end], "null");
    serde_json::from_str(&raw).ok()
}

fn normalize_web_book(raw: &Value) -> Option<Value> {
    if !truthy(raw) {
        return None;
    }
    let status_ongoing = raw["creationStatus"].as_i64() == Some(0) && raw["creationStatus"].is_number()
        || raw["creation_status"].as_str() == Some("0");
    Some(json!({
        "id": str_of(or(&[&raw["bookId"], &raw["book_id"], &Value::Null])),
        "title": str_of(or(&[&raw["bookName"], &raw["book_name"], &Value::Null])),
        "author": str_of(&raw["author"]),
        "cover": str_of(or(&[&raw["thumbUri"], &raw["thumbUrl"], &raw["thumb_url"], &Value::Null])),
        "description": str_of(&raw["abstract"]),
        "category": str_of(&raw["category"]),
        "wordCount": or(&[&raw["wordNumber"], &raw["word_number"], &raw["word_count"], &json!(0)]).clone(),
        "status": if status_ongoing { "连载中" } else { "已完结" },
        "latestChapter": str_of(or(&[&raw["lastChapterTitle"], &raw["last_chapter_title"], &Value::Null])),
    }))
}

fn empty_result() -> Value {
    json!({ "books": [], "total": 0, "hasMore": false })
}

fn clean_content(html: &str) -> String {
    static IMG: OnceLock<Regex> = OnceLock::new();
    static BLOCK: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static NL: OnceLock<Regex> = OnceLock::new();
    let img = IMG.get_or_init(|| Regex::new(r"<img[^>]*>").unwrap());
    let block = BLOCK.get_or_init(|| Regex::new(r"(?i)</?(p|div|br|header|footer|section)[^>]*>").unwrap());
    let tag = TAG.get_or_init(|| Regex::new(r"<[^>]+>").unwrap());
    let nl = NL.get_or_init(|| Regex::new(r"\n{3,}").unwrap());
    let s = img.replace_all(html, "");
    let s = block.replace_all(&s, "\n");
    let s = tag.replace_all(&s, "");
    nl.replace_all(&s, "\n\n").trim().to_string()
}

/// 网页搜索：搜索页是客户端渲染，SSR 常拿不到结果，退而在首页推荐里按书名/作者过滤
pub async fn search(query: &str, _page: i64) -> Value {
    let run = async {
        let (html, _) = web_request(&format!("/search/{query}")).await?;
        let Some(state) = extract_state(&html) else { return Ok::<Value, String>(empty_result()) };

        let list = state["search"]["searchBookList"].as_array().cloned().unwrap_or_default();
        if !list.is_empty() {
            let books: Vec<Value> = list.iter().filter_map(normalize_web_book).collect();
            let total = if truthy(&state["search"]["total"]) { state["search"]["total"].clone() } else { json!(books.len()) };
            let has_more = books.len() >= 10;
            return Ok(json!({ "books": books, "total": total, "hasMore": has_more }));
        }

        // 搜索页面可能没有 SSR 数据，从首页推荐里搜索
        let (home_html, _) = web_request("/").await?;
        let Some(home_state) = extract_state(&home_html) else { return Ok(empty_result()) };
        let home = &home_state["home"];
        let q = query.to_lowercase();
        let mut seen: Vec<String> = vec![];
        let mut unique: Vec<Value> = vec![];
        for key in ["boyList", "girlList", "readRankList", "newRankList", "topRankList", "weekList"] {
            for b in home[key].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
                let name = str_of(or(&[&b["bookName"], &b["book_name"], &Value::Null])).to_lowercase();
                let author = str_of(&b["author"]).to_lowercase();
                if !(name.contains(&q) || author.contains(&q)) {
                    continue;
                }
                if let Some(book) = normalize_web_book(b) {
                    let id = str_of(&book["id"]);
                    if !seen.contains(&id) {
                        seen.push(id);
                        unique.push(book);
                    }
                }
            }
        }
        let n = unique.len();
        Ok(json!({ "books": unique, "total": n, "hasMore": false }))
    };
    match run.await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Search error: {e}");
            empty_result()
        }
    }
}

// 书页 HTML 很大，详情页要同时取详情和目录、进阅读页又取一次目录；同一本书 10 分钟内共用一次请求
const PAGE_TTL: Duration = Duration::from_secs(10 * 60);
type PageCell = Arc<OnceCell<Result<Value, String>>>;

fn page_cache() -> &'static StdMutex<HashMap<String, (Instant, PageCell)>> {
    static CACHE: OnceLock<StdMutex<HashMap<String, (Instant, PageCell)>>> = OnceLock::new();
    CACHE.get_or_init(|| StdMutex::new(HashMap::new()))
}

async fn get_page_state(book_id: &str) -> R<Value> {
    let cell: PageCell = {
        let mut cache = page_cache().lock().unwrap();
        cache.retain(|_, (at, _)| at.elapsed() < PAGE_TTL);
        cache.entry(book_id.to_string()).or_insert_with(|| (Instant::now(), Arc::new(OnceCell::new()))).1.clone()
    };
    let result = cell
        .get_or_init(|| async {
            let (html, _) = web_request(&format!("/page/{book_id}")).await?;
            match extract_state(&html) {
                Some(state) if truthy(&state["page"]) => Ok(state),
                _ => Err("书页解析失败".to_string()),
            }
        })
        .await
        .clone();
    // 失败的不留，下次重新请求
    if result.is_err() {
        page_cache().lock().unwrap().remove(book_id);
    }
    result
}

pub async fn get_book_detail(book_id: &str) -> Value {
    match get_page_state(book_id).await {
        Ok(state) => normalize_web_book(&state["page"]).unwrap_or(Value::Null),
        Err(e) => {
            eprintln!("BookDetail error: {e}");
            Value::Null
        }
    }
}

pub async fn get_chapters(book_id: &str) -> Value {
    let state = match get_page_state(book_id).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Chapters error: {e}");
            return json!([]);
        }
    };
    let page = &state["page"];
    let mut chapters: Vec<Value> = vec![];
    let mut index = 0;
    for vol in page["chapterListWithVolume"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        for ch in vol.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
            if truthy(&ch["itemId"]) {
                chapters.push(json!({
                    "id": str_of(&ch["itemId"]),
                    "title": if truthy(&ch["title"]) { str_of(&ch["title"]) } else { format!("第{}章", index + 1) },
                    "bookId": book_id,
                    "index": index,
                    "isVip": truthy(&ch["needPay"]),
                }));
                index += 1;
            }
        }
    }
    if chapters.is_empty() {
        if let Some(ids) = page["itemIds"].as_array() {
            for (i, id) in ids.iter().enumerate() {
                chapters.push(json!({
                    "id": str_of(id), "title": format!("第{}章", i + 1), "bookId": book_id, "index": i, "isVip": false,
                }));
            }
        }
    }
    Value::Array(chapters)
}

async fn fetch_buffer(url: &str) -> R<Vec<u8>> {
    Ok(Req::get(url).header("User-Agent", WEB_UA).timeout(15).send().await?.body)
}

async fn inline_font_css(css: &str) -> String {
    if css.is_empty() {
        return String::new();
    }
    static URL_RE: OnceLock<Regex> = OnceLock::new();
    let url_re = URL_RE
        .get_or_init(|| Regex::new(r#"url\(["']?(https?://[^"')]+\.(?:woff2?|otf|ttf))["']?\)"#).unwrap());
    let mut result = css.to_string();
    for m in url_re.captures_iter(css) {
        let whole = &m[0];
        let url = &m[1];
        match fetch_buffer(url).await {
            Ok(buf) => {
                let ext = url.rsplit('.').next().unwrap_or("woff2");
                let mime = match ext {
                    "otf" => "font/otf".to_string(),
                    "ttf" => "font/ttf".to_string(),
                    e => format!("font/{e}"),
                };
                let data_url = format!("data:{mime};base64,{}", crate::crypto::base64_encode(&buf));
                result = result.replacen(whole, &format!("url(\"{data_url}\")"), 1);
            }
            Err(e) => eprintln!("Font fetch failed: {e}"),
        }
    }
    result
}

/// 网页正文（App 接口失败时的兜底）：带字体加密，由前端按返回的 fontCss 解码
pub async fn get_chapter_content(item_id: &str) -> Value {
    let run = async {
        let (body, headers) = web_request(&format!("/reader/{item_id}")).await?;
        let state = extract_state(&body);
        let Some(chapter) = state.as_ref().map(|s| &s["reader"]["chapterData"]).filter(|c| truthy(c)) else {
            return Ok::<Value, String>(json!({ "content": "", "fontCss": "" }));
        };
        let content = clean_content(&str_of(&chapter["content"]));
        let header_css = headers.get("x-tt-zhal").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let raw_css = if !header_css.is_empty() { header_css } else { str_of(&state.as_ref().unwrap()["common"]["css"]) };
        let font_css = inline_font_css(&raw_css).await;
        Ok(json!({ "content": content, "fontCss": font_css }))
    };
    run.await.unwrap_or_else(|e| {
        eprintln!("ChapterContent error: {e}");
        json!({ "content": "", "fontCss": "" })
    })
}

// 排行榜分类（取自 fanqienovel.com/rank 的 rankCategoryTypeList）
const RANK_MALE: [(&str, &str); 19] = [
    ("1141", "西方奇幻"), ("1140", "东方仙侠"), ("8", "科幻末世"), ("261", "都市日常"),
    ("124", "都市修真"), ("1014", "都市高武"), ("273", "历史古代"), ("27", "战神赘婿"),
    ("263", "都市种田"), ("258", "传统玄幻"), ("272", "历史脑洞"), ("539", "悬疑脑洞"),
    ("262", "都市脑洞"), ("257", "玄幻脑洞"), ("751", "悬疑灵异"), ("504", "抗战谍战"),
    ("746", "游戏体育"), ("718", "动漫衍生"), ("1016", "男频衍生"),
];
const RANK_FEMALE: [(&str, &str); 18] = [
    ("1139", "古风世情"), ("8", "科幻末世"), ("746", "游戏体育"), ("1015", "女频衍生"),
    ("248", "玄幻言情"), ("23", "种田"), ("79", "年代"), ("267", "现言脑洞"),
    ("246", "宫斗宅斗"), ("539", "悬疑脑洞"), ("253", "古言脑洞"), ("24", "快穿"),
    ("749", "青春甜宠"), ("745", "星光璀璨"), ("747", "女频悬疑"), ("750", "职场婚恋"),
    ("748", "豪门总裁"), ("1017", "民国言情"),
];

/// 分组 id 即性别参数（1 男频 / 0 女频）；同一分类号在男女频下是不同的榜单
pub fn get_categories() -> Value {
    let children = |list: &[(&str, &str)]| -> Vec<Value> {
        list.iter().map(|(id, name)| json!({ "id": id, "name": name })).collect()
    };
    json!([
        { "id": "1", "name": "男频", "children": children(&RANK_MALE) },
        { "id": "0", "name": "女频", "children": children(&RANK_FEMALE) },
    ])
}

const RANK_PAGE_SIZE: i64 = 30;

/// rank_id 与官网排行页路径一致：性别_榜单_分类，如 "1_2_1141"（榜单 2 阅读榜 / 1 新书榜）；
/// "top" 是官网首页的番茄巅峰榜（综合得分排行，共 30 本、不分页，文字是明文）
pub async fn get_ranking(rank_id: &str, page: i64) -> Value {
    let run = async {
        if rank_id == "top" {
            let (json_text, _) = web_request("/api/author/misc/top_book_list/v1/?limit=200&offset=0").await?;
            let v: Value = serde_json::from_str(&json_text).map_err(|e| e.to_string())?;
            let books: Vec<Value> =
                v["book_list"].as_array().map(|a| a.as_slice()).unwrap_or(&[]).iter().filter_map(normalize_web_book).collect();
            let n = books.len();
            return Ok::<Value, String>(json!({ "books": books, "total": n, "hasMore": false }));
        }
        let mut parts = rank_id.split('_');
        let (gender, mold, cid) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        let offset = page * RANK_PAGE_SIZE;
        let (json_text, _) = web_request(&format!(
            "/api/rank/category/list?app_id=2503&rank_list_type=3&offset={offset}&limit={RANK_PAGE_SIZE}&category_id={cid}&rank_version=&gender={gender}&rankMold={mold}"
        ))
        .await?;
        let v: Value = serde_json::from_str(&json_text).map_err(|e| e.to_string())?;
        let data = &v["data"];
        let list = data["book_list"].as_array().cloned().unwrap_or_default();
        let books: Vec<Value> = list
            .iter()
            .filter_map(|raw| {
                let mut r = raw.clone();
                for k in ["bookName", "author", "abstract", "lastChapterTitle"] {
                    if let Some(s) = raw[k].as_str() {
                        r[k] = Value::String(decode_text(s));
                    }
                }
                normalize_web_book(&r)
            })
            .collect();
        let total = crate::util::num(&data["total_num"]) as i64;
        Ok(json!({ "books": books, "total": total, "hasMore": offset + (list.len() as i64) < total }))
    };
    run.await.unwrap_or_else(|e| {
        eprintln!("Ranking error: {e}");
        empty_result()
    })
}

// 官网首页的推荐模块（服务端渲染，文字是明文）
const RECOMMEND_SECTIONS: [(&str, &str); 4] =
    [("weekList", "本周推荐"), ("editorList", "编辑推荐"), ("boyList", "男频精选"), ("girlList", "女频精选")];

pub async fn get_recommend() -> Value {
    let run = async {
        let (html, _) = web_request("/").await?;
        let state = extract_state(&html).unwrap_or(Value::Null);
        let home = &state["home"];
        let sections: Vec<Value> = RECOMMEND_SECTIONS
            .iter()
            .map(|(key, title)| {
                let books: Vec<Value> =
                    home[*key].as_array().map(|a| a.as_slice()).unwrap_or(&[]).iter().filter_map(normalize_web_book).collect();
                (title, books)
            })
            .filter(|(_, books)| !books.is_empty())
            .map(|(title, books)| json!({ "title": title, "books": books }))
            .collect();
        Ok::<Value, String>(Value::Array(sections))
    };
    run.await.unwrap_or_else(|e| {
        eprintln!("Recommend error: {e}");
        json!([])
    })
}

// ------------------------------------------------------------------ 段评表情
// 番茄没有公开的表情接口，借用抖音网页版的表情图（同属字节，名称大多一致）
const EMOJI_ALIASES: [(&str, &str); 6] = [
    ("[吃瓜]", "[吃瓜群众]"), ("[酷]", "[酷拽]"), ("[哭]", "[流泪]"), ("[笑]", "[微笑]"), ("[爱慕]", "[色]"), ("[盯]", "[看]"),
];

static EMOJIS: OnceCell<Value> = OnceCell::const_new();

/// { '[偷笑]': 图片地址 }；拉取失败返回空表，下次再试
pub async fn get_emojis() -> Value {
    if let Some(v) = EMOJIS.get() {
        return v.clone();
    }
    let fetch = async {
        let buf = fetch_buffer("https://www.douyin.com/aweme/v1/web/emoji/list").await?;
        let v: Value = serde_json::from_slice(&buf).map_err(|e| e.to_string())?;
        let mut map = serde_json::Map::new();
        for e in v["emoji_list"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
            let url = &e["emoji_url"]["url_list"][0];
            if truthy(&e["display_name"]) && truthy(url) {
                map.insert(str_of(&e["display_name"]), url.clone());
            }
        }
        for (name, target) in EMOJI_ALIASES {
            if !map.contains_key(name) {
                if let Some(u) = map.get(target).cloned() {
                    map.insert(name.to_string(), u);
                }
            }
        }
        if map.is_empty() {
            return Err("表情列表为空".to_string());
        }
        Ok(Value::Object(map))
    };
    match fetch.await {
        Ok(v) => EMOJIS.get_or_init(|| async { v }).await.clone(),
        Err(e) => {
            eprintln!("Emoji error: {e}");
            json!({})
        }
    }
}

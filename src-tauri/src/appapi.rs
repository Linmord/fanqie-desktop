//! 番茄 APP 接口（reading.snssdk.com）客户端：设备注册 → 密钥交换 → 签名请求 → 解密正文，
//! 以及段评、搜索、听书。移植自 Jees996/fanqie-novel-downloader 的 appapi.py。

use std::collections::HashMap;
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use rand::Rng;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::sync::Mutex;

use crate::crypto::{
    aes_cbc_decrypt, aes_cbc_encrypt, base64_decode, base64_encode, sign_request, tt_encrypt, SHARED_KEY,
};
use crate::util::{self, form_encode, num, num_json, str_of, truthy, Req, R};

const AID: &str = "1967";
const APP_BASE: &str = "https://reading.snssdk.com/reading";
// 段评接口在这个域名上明显更快（约 0.5s，reading.snssdk.com 要 3s+）
const COMMENT_HOST: &str = "https://api5-normal-sinfonlinec.fqnovel.com";
const COMMENT_BASE: &str = "https://api5-normal-sinfonlinec.fqnovel.com/novel/commentapi";
const APP_UA: &str = "com.dragon.read";
const REGISTER_URL: &str = "https://i.snssdk.com/service/2/device_register/?tt_data=a";

const ANDROID_VERSIONS: [(&str, u32); 6] = [("9", 29), ("10", 30), ("11", 31), ("12", 32), ("13", 33), ("14", 34)];
const DEVICE_MODELS: [&str; 21] = [
    "RMX1931", "MI8", "Honor10", "P30", "V1921A", "Redmi Note 7", "Redmi K20 Pro", "MI 9", "Mi 10 Pro",
    "SM-G9750", "Pixel 6", "HD1910", "M2011K2C", "LIO-AN00", "VOG-TL00", "PCLM10", "GM1900", "Pixel 7 Pro",
    "Pixel 6a", "SM-N9760", "POCO F1",
];
const DEVICE_BRANDS: [&str; 12] = [
    "realme", "Xiaomi", "Huawei", "OPPO", "vivo", "samsung", "OnePlus", "google", "Redmi", "HONOR", "motorola", "POCO",
];

const TIMEOUT: u64 = 30;
const INTERVAL: Duration = Duration::from_secs(6);
const BATCH_SIZE: usize = 30;
const MAX_DEVICES: u32 = 3;

// ------------------------------------------------------------------ 设备
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Device {
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub install_id: String,
    #[serde(default)]
    pub device_type: String,
    #[serde(default)]
    pub device_brand: String,
}

#[derive(Serialize, Deserialize, Default)]
struct DeviceCache {
    #[serde(default)]
    device: Device,
    #[serde(default)]
    key: String,
    #[serde(default)]
    key_version: Value,
    #[serde(default)]
    updated_at: u64,
}

#[derive(Default)]
struct State {
    device: Option<Device>,
    key: Option<Vec<u8>>,
    key_version: Value,
    devices_made: u32,
}

#[derive(Clone)]
struct Ready {
    device: Device,
    key: Vec<u8>,
}

pub struct AppApi {
    state: Mutex<State>,
    last_request: StdMutex<Option<Instant>>,
}

fn cache_path() -> std::path::PathBuf {
    util::data_dir().join("device.json")
}

fn rand_hex(k: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..k).map(|_| char::from(b"0123456789abcdef"[rng.gen_range(0..16)])).collect()
}

fn uuid() -> String {
    let mut b: [u8; 16] = rand::thread_rng().gen();
    b[6] = (b[6] & 0x0F) | 0x40;
    b[8] = (b[8] & 0x3F) | 0x80;
    let h = hex::encode(b);
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

fn ipv6_unique_local() -> String {
    let mut addr = format!("fd{}", rand_hex(2));
    for _ in 0..7 {
        addr.push(':');
        addr.push_str(&rand_hex(4));
    }
    addr
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn build_register_body() -> Value {
    let mut rng = rand::thread_rng();
    let (os_version, os_api) = ANDROID_VERSIONS[rng.gen_range(0..ANDROID_VERSIONS.len())];
    let brand = DEVICE_BRANDS[rng.gen_range(0..DEVICE_BRANDS.len())];
    let model = DEVICE_MODELS[rng.gen_range(0..DEVICE_MODELS.len())];
    let gen_time = now_ms();
    let rom_version = format!(
        "coloros__{}.{:06}.{:08} release-keys",
        rand_hex(4).to_uppercase(),
        rng.gen_range(0..1_000_000u32),
        rng.gen_range(0..100_000_000u32)
    );
    json!({
        "magic_tag": "ss_app_log",
        "header": {
            "display_name": "番茄免费小说", "aid": 1967, "channel": "43536163a",
            "package": "com.dragon.read", "sdk_version": "3.7.0-rc.25-fanqie-xiaoshuo",
            "sdk_target_version": 29, "git_hash": "711d1a7", "density_dpi": 240,
            "display_density": "hdpi", "resolution": "720x1280", "language": "zh",
            "timezone": 8, "access": "wifi", "not_request_sender": 0,
            "carrier": "CHINA MOBILE", "mcc_mnc": "46000", "region": "CN",
            "tz_name": "Asia/Shanghai", "tz_offset": 28800, "sim_region": "cn",
            "sim_serial_number": [], "oaid_may_support": false,
            "device_platform": "android",
            "custom": { "host_bit": 32, "dragon_device_type": 0 },
            "pre_installed_channel": "", "is_system_app": 0, "sdk_flavor": "china",
            "guest_mode": 0, "os": "Android", "os_version": os_version, "os_api": os_api,
            "device_model": model,
            "device_brand": brand, "device_manufacturer": brand, "cpu_abi": "arm64-v8a",
            "release_build": rand_hex(7), "cdid": uuid(),
            "sig_hash": "a4a27c2633195374c15651ffc3c4a497", "openudid": rand_hex(20),
            "clientudid": uuid(), "req_id": uuid(),
            "rom": rand_hex(14).to_uppercase(), "rom_version": rom_version,
            "apk_first_install_time": gen_time - rng.gen_range(0..365u64) * 86_400_000,
            "ipv6_list": [
                { "type": "client_anpi", "value": "::1" },
                { "type": "client_anpi", "value": ipv6_unique_local() },
                { "type": "client_anpi", "value": ipv6_unique_local() },
            ],
        },
        "_gen_time": gen_time,
    })
}

/// 公共查询参数；extra 里与默认同名的键原位覆盖（与原 JS 对象展开顺序一致）
fn build_query(device: &Device, extra: &[(&str, String)]) -> String {
    let mut params: Vec<(String, String)> = vec![
        ("iid".into(), device.install_id.clone()),
        ("device_id".into(), device.device_id.clone()),
        ("ac".into(), "wifi".into()),
        ("channel".into(), "43536163a".into()),
        ("aid".into(), AID.into()),
        ("app_name".into(), "novelapp".into()),
        ("version_code".into(), "70132".into()),
        ("version_name".into(), "7.0.1.32".into()),
        ("device_platform".into(), "android".into()),
        ("os".into(), "android".into()),
        ("ssmix".into(), "a".into()),
        ("os_version".into(), "10".into()),
        (
            "device_type".into(),
            if device.device_type.is_empty() { "P30".into() } else { device.device_type.clone() },
        ),
        (
            "device_brand".into(),
            if device.device_brand.is_empty() { "realme".into() } else { device.device_brand.clone() },
        ),
        ("update_version_code".into(), "70132".into()),
        ("manifest_version_code".into(), "70132".into()),
        ("pv_player".into(), "70132".into()),
    ];
    for (k, v) in extra {
        match params.iter_mut().find(|(pk, _)| pk == k) {
            Some(slot) => slot.1 = v.clone(),
            None => params.push((k.to_string(), v.clone())),
        }
    }
    form_encode(&params)
}

/// 设备号转 16 字节大端十六进制后按字节反转
fn reverse_hex(device_id: &str) -> R<String> {
    let n: u128 = device_id.parse().map_err(|_| format!("设备号不是数字：{device_id}"))?;
    let be = format!("{n:032x}");
    let bytes = hex::decode(&be).map_err(|e| e.to_string())?;
    Ok(hex::encode(bytes.iter().rev().copied().collect::<Vec<u8>>()))
}

// ------------------------------------------------------------------ 正文解析
pub struct Chapter {
    pub paragraphs: Vec<String>,
    pub para_idx: Vec<i64>,
}

fn clean_fragment(fragment: &str) -> String {
    static TAG: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static WS: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let tag = TAG.get_or_init(|| Regex::new(r"<[^>]+>").unwrap());
    let ws = WS.get_or_init(|| Regex::new(r"[ \t\r\x0c\x0b\u{a0}]+").unwrap());
    let text = tag.replace_all(fragment, "").into_owned();
    let text = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ");
    let text = text.replace(['\u{200b}', '\u{feff}'], "").replace('\u{3000}', " ");
    ws.replace_all(&text, " ").trim().to_string()
}

pub fn parse_chapter_xhtml(xhtml: &str) -> Chapter {
    static STYLE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static H1: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static P: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static IDX: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static BLK: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let style = STYLE.get_or_init(|| Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap());
    let h1 = H1.get_or_init(|| Regex::new(r"(?is)<h1[^>]*>(.*?)</h1>").unwrap());
    let p = P.get_or_init(|| Regex::new(r"(?is)<p(\s[^>]*)?>(.*?)</p>").unwrap());
    let idx_re = IDX.get_or_init(|| Regex::new(r#"\sidx="(\d+)""#).unwrap());
    let blk = BLK.get_or_init(|| Regex::new(r"(?is)<blk(?:\s[^>]*)?>(.*?)</blk>").unwrap());

    let mut out = Chapter { paragraphs: vec![], para_idx: vec![] };
    if xhtml.is_empty() {
        return out;
    }
    let xhtml = style.replace_all(xhtml, "").into_owned();
    let title = h1.captures(&xhtml).map(|m| clean_fragment(&m[1])).unwrap_or_default();

    // para_idx 是段落在原文里的 idx 属性，段评按它定位；没有时记 -1
    for m in p.captures_iter(&xhtml) {
        let text = clean_fragment(&m[2]);
        if text.is_empty() {
            continue;
        }
        let idx = m
            .get(1)
            .and_then(|a| idx_re.captures(a.as_str()))
            .and_then(|c| c[1].parse::<i64>().ok())
            .unwrap_or(-1);
        out.paragraphs.push(text);
        out.para_idx.push(idx);
    }
    if out.paragraphs.is_empty() {
        for m in blk.captures_iter(&xhtml) {
            let text = clean_fragment(&m[1]);
            if !text.is_empty() && text != title {
                out.paragraphs.push(text);
                out.para_idx.push(-1);
            }
        }
    }
    out
}

// ------------------------------------------------------------------ 段评
fn https_(u: &Value) -> String {
    let s = str_of(u);
    match s.strip_prefix("http://") {
        Some(rest) => format!("https://{rest}"),
        None => s,
    }
}

// 配图：web_uri 是 300 宽的缩略图，web_url 是原图；动图（image_type 2）只有一个 dynamic_url
fn comment_images(content: &Value) -> Value {
    let list = content["image_data_list"]["image_data"].as_array().cloned().unwrap_or_default();
    let items: Vec<Value> = list
        .iter()
        .filter_map(|im| {
            let pick = |vs: &[&Value]| str_of(util::or(vs));
            let url = https_(&Value::String(pick(&[&im["dynamic_url"], &im["web_url"], &im["web_uri"]])));
            let thumb_src = https_(&Value::String(pick(&[&im["dynamic_url"], &im["web_uri"]])));
            if url.is_empty() {
                return None;
            }
            let thumb = if thumb_src.is_empty() { url.clone() } else { thumb_src };
            Some(json!({ "thumb": thumb, "url": url, "width": num_json(num(&im["width"])), "height": num_json(num(&im["height"])) }))
        })
        .collect();
    Value::Array(items)
}

// 回复里的 comment_id 是它所属的一级评论，自己的 id 在 reply_id
fn flatten_comment(c: &Value, is_reply: bool) -> Value {
    let cm = if truthy(&c["common"]) { &c["common"] } else { &c["Common"] };
    let user = &cm["user_info"];
    let base = &user["base_info"];
    let tag = &user["user_tag"];
    let stat = if truthy(&c["stat"]) { &c["stat"] } else { &c["Stat"] };
    let reply_to = &c["reply_to_user_info"]["base_info"];
    let own_id = if is_reply { util::or(&[&c["reply_id"], &c["comment_id"]]) } else { &c["comment_id"] };
    let own_id = if truthy(own_id) { own_id } else { &c["comment_id"] };
    let titles: Vec<Value> = tag["user_title_info"]
        .as_array()
        .map(|a| a.iter().map(|t| &t["zh_title"]).filter(|t| truthy(t)).cloned().collect())
        .unwrap_or_default();
    let service_id = num(&cm["service_id"]);
    json!({
        "id": str_of(own_id),
        "isReply": is_reply,
        "userId": str_of(util::or(&[&user["user_id"], &base["user_id"], &Value::Null])),
        "serviceId": num_json(if service_id == 0.0 { 1.0 } else { service_id }),
        "liked": truthy(&c["user_action"]["user_digg"]),
        "text": if truthy(&cm["content"]["text"]) { cm["content"]["text"].clone() } else { json!("") },
        "images": comment_images(&cm["content"]),
        "time": num_json(num(&cm["create_timestamp"])),
        "userName": if truthy(&base["user_name"]) { base["user_name"].clone() } else { json!("番茄用户") },
        // 头像多是 http 地址，页面 CSP 只放行 https 图片；这些图床都支持 https
        "avatar": https_(&base["user_avatar"]),
        "isAuthor": truthy(&tag["is_author"]),
        "isVip": truthy(&tag["is_vip"]),
        "titles": titles,
        "diggCount": num_json(num(&stat["digg_count"])),
        "replyCount": num_json(num(&stat["reply_count"])),
        "authorLiked": truthy(&c["user_action"]["author"]),
        "replyTo": if truthy(&reply_to["user_name"]) { reply_to["user_name"].clone() } else { json!("") },
    })
}

fn para_business(book_id: &str, para_index: i64, para_text: &str) -> Value {
    json!({
        "book_id": book_id,
        "item_version": "0",
        "para_content": para_text,
        "pos_v1": {
            "start_para_index": para_index, "end_para_index": para_index,
            // JS 的 length 按 UTF-16 码元计
            "start_word_pos": 0, "end_word_pos": para_text.encode_utf16().count(),
            "start_media_index": 0, "end_media_index": 0,
        },
    })
}

fn parse_json(body: &[u8]) -> R<Value> {
    serde_json::from_slice(body).map_err(|e| format!("响应不是有效 JSON：{e}"))
}

// ------------------------------------------------------------------ 客户端
impl AppApi {
    pub fn new() -> Self {
        AppApi { state: Mutex::new(State::default()), last_request: StdMutex::new(None) }
    }

    // ----- 缓存
    fn load_cache(st: &mut State) -> bool {
        let Ok(text) = std::fs::read_to_string(cache_path()) else { return false };
        let Ok(data) = serde_json::from_str::<DeviceCache>(&text) else { return false };
        if data.device.device_id.is_empty() || data.device.install_id.is_empty() {
            return false;
        }
        st.device = Some(data.device);
        if !data.key.is_empty() {
            if let Ok(k) = hex::decode(&data.key) {
                st.key = Some(k);
                st.key_version = data.key_version;
            }
        }
        true
    }

    fn save_cache(st: &State) {
        let payload = DeviceCache {
            device: st.device.clone().unwrap_or_default(),
            key: st.key.as_ref().map(hex::encode).unwrap_or_default(),
            key_version: st.key_version.clone(),
            updated_at: now_ms() / 1000,
        };
        let path = cache_path();
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(&payload) {
            let _ = std::fs::write(path, text);
        }
    }

    // ----- 注册
    async fn register_device(st: &mut State) -> R<Device> {
        let body = build_register_body();
        let plain = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
        let encrypted = tt_encrypt(&plain)?;
        let res = Req::get(REGISTER_URL)
            .header("User-Agent", "okhttp/4.10.0")
            .header("Content-Type", "application/octet-stream; tt-data=a")
            .post(encrypted)
            .timeout(TIMEOUT)
            .send()
            .await?;
        let payload = parse_json(&res.body)?;
        if !truthy(&payload["device_id_str"]) || !truthy(&payload["install_id_str"]) {
            return Err("匿名设备注册失败：响应缺少 device_id / install_id".into());
        }
        st.devices_made += 1;
        Ok(Device {
            device_id: str_of(&payload["device_id_str"]),
            install_id: str_of(&payload["install_id_str"]),
            device_type: str_of(&body["header"]["device_model"]),
            device_brand: str_of(&body["header"]["device_brand"]),
        })
    }

    async fn register_key(st: &mut State) -> R<()> {
        let device = st.device.clone().ok_or("尚未注册设备")?;
        let url = format!("{APP_BASE}/crypt/registerkey?{}", build_query(&device, &[]));
        const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let iv: Vec<u8> = {
            let mut rng = rand::thread_rng();
            (0..16).map(|_| CHARS[rng.gen_range(0..CHARS.len())]).collect()
        };
        let data: Vec<u8> = hex::decode(reverse_hex(&device.device_id)?).map_err(|e| e.to_string())?[..8].to_vec();
        let mut content = iv.clone();
        content.extend(aes_cbc_encrypt(&SHARED_KEY, &iv, &data)?);
        let body = serde_json::to_vec(&json!({ "content": base64_encode(&content) })).map_err(|e| e.to_string())?;
        let res = Req::get(&url)
            .headers(sign_request(&url, Some(&body)))
            .header("User-Agent", APP_UA)
            .header("Accept", "*/*")
            .header("Content-Type", "application/json; charset=utf-8")
            .post(body)
            .timeout(TIMEOUT)
            .send()
            .await?;
        let payload = parse_json(&res.body)?;
        let data_obj = &payload["data"];
        if !truthy(&data_obj["key"]) {
            return Err("正文密钥注册失败：响应缺少 key".into());
        }
        let raw = base64_decode(&str_of(&data_obj["key"]))?;
        if raw.len() < 16 {
            return Err("正文密钥注册失败：key 长度异常".into());
        }
        st.key = Some(aes_cbc_decrypt(&SHARED_KEY, &raw[..16], &raw[16..])?);
        st.key_version = data_obj["keyver"].clone();
        Ok(())
    }

    async fn ready(&self) -> R<Ready> {
        let mut st = self.state.lock().await;
        if st.device.is_none() || st.key.is_none() {
            if st.device.is_none() && !Self::load_cache(&mut st) {
                let d = Self::register_device(&mut st).await?;
                st.device = Some(d);
            }
            if st.key.is_none() {
                Self::register_key(&mut st).await?;
            }
            Self::save_cache(&st);
        }
        Ok(Ready { device: st.device.clone().unwrap(), key: st.key.clone().unwrap() })
    }

    /// 启动时预热：提前注册设备和正文密钥，避免用户第一次读书时才等这两次请求
    pub async fn warm(&self) {
        if let Err(e) = self.ready().await {
            eprintln!("预热设备注册失败，留待首次使用时重试: {e}");
        }
    }

    async fn recover_device(&self) -> R<()> {
        let mut st = self.state.lock().await;
        if st.devices_made >= MAX_DEVICES {
            return Err("APP 接口持续返回空响应，设备注册次数已达上限".into());
        }
        let d = Self::register_device(&mut st).await?;
        st.device = Some(d);
        st.key = None;
        Self::register_key(&mut st).await?;
        Self::save_cache(&st);
        Ok(())
    }

    async fn reset_key(&self) -> R<()> {
        let mut st = self.state.lock().await;
        st.key = None;
        Self::register_key(&mut st).await?;
        Self::save_cache(&st);
        Ok(())
    }

    // ----- 请求
    async fn throttle(&self) {
        let wait = {
            let last = self.last_request.lock().unwrap();
            last.map(|t| INTERVAL.saturating_sub(t.elapsed())).unwrap_or_default()
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }

    async fn signed_get(&self, url: &str, timeout: u64) -> R<util::Resp> {
        Req::get(url)
            .headers(sign_request(url, None))
            .header("User-Agent", APP_UA)
            .header("Accept", "*/*")
            .timeout(timeout)
            .send()
            .await
    }

    async fn fetch_batch(&self, item_ids: &[String], book_id: &str) -> R<HashMap<String, String>> {
        let rd = self.ready().await?;
        self.throttle().await;
        let url = format!(
            "{APP_BASE}/reader/batch_full/v?{}",
            build_query(
                &rd.device,
                &[
                    ("item_ids", item_ids.join(",")),
                    ("book_id", if book_id.is_empty() { "0".into() } else { book_id.to_string() }),
                    ("novel_text_type", "1".into()),
                    ("req_type", "1".into()),
                ],
            )
        );
        let res = self.signed_get(&url, TIMEOUT).await?;
        *self.last_request.lock().unwrap() = Some(Instant::now());
        if res.status != 200 {
            return Err(format!("章节接口返回 HTTP {}", res.status));
        }
        if res.body.is_empty() {
            return Err("章节接口返回空响应（设备可能被作废）".into());
        }
        let payload = parse_json(&res.body)?;
        let data = payload["data"].as_object().filter(|d| !d.is_empty());
        let Some(data) = data else {
            return Err("章节接口返回空响应（设备可能被作废）".into());
        };

        let mut result = HashMap::new();
        let mut invalid = 0;
        for (item_id, item) in data {
            let content = str_of(&item["content"]);
            if content.is_empty() || content == "Invalid" {
                if content == "Invalid" {
                    invalid += 1;
                }
                continue;
            }
            let raw = base64_decode(&content)?;
            if raw.len() < 16 {
                continue;
            }
            let mut plain = aes_cbc_decrypt(&rd.key, &raw[..16], &raw[16..])?;
            if item["compress_status"].as_i64() == Some(1) {
                use std::io::Read;
                let mut out = Vec::new();
                flate2::read::GzDecoder::new(&plain[..]).read_to_end(&mut out).map_err(|e| format!("gunzip 失败：{e}"))?;
                plain = out;
            }
            result.insert(item_id.clone(), String::from_utf8_lossy(&plain).into_owned());
        }
        if result.is_empty() && invalid > 0 {
            return Err("正文密钥失效，需要重新注册".into());
        }
        Ok(result)
    }

    /// 批量取章节正文 xhtml：{ 章节 id → xhtml }。拿不到的章节不在结果里
    pub async fn fetch_chapters(
        &self,
        item_ids: &[String],
        book_id: &str,
        max_rounds: usize,
    ) -> R<HashMap<String, String>> {
        let mut pending: Vec<String> = item_ids.iter().filter(|s| !s.is_empty()).cloned().collect();
        let mut result = HashMap::new();
        if pending.is_empty() {
            return Ok(result);
        }
        for rnd in 0..max_rounds.max(1) {
            if pending.is_empty() {
                break;
            }
            if rnd > 0 {
                tokio::time::sleep(INTERVAL.max(Duration::from_secs(8))).await;
            }
            let mut still_missing = vec![];
            for (n, batch) in pending.chunks(BATCH_SIZE).enumerate() {
                if n > 0 {
                    self.throttle().await;
                }
                let got = match self.fetch_batch(batch, book_id).await {
                    Ok(g) => g,
                    Err(e) if e.contains("空响应") => {
                        tokio::time::sleep(Duration::from_secs(15)).await;
                        self.recover_device().await?;
                        self.fetch_batch(batch, book_id).await?
                    }
                    Err(e) if e.contains("密钥失效") => {
                        self.reset_key().await?;
                        self.fetch_batch(batch, book_id).await?
                    }
                    Err(e) => return Err(e),
                };
                for id in batch {
                    if !got.contains_key(id) {
                        still_missing.push(id.clone());
                    }
                }
                result.extend(got);
            }
            pending = still_missing;
        }
        Ok(result)
    }

    // ----- 搜索（只取第一页；翻页需带上一页返回的 search_id 与 passback，前端暂未用到）
    pub async fn search_books(&self, query: &str) -> R<Value> {
        let rd = self.ready().await?;
        let url = format!(
            "{APP_BASE}/bookapi/search/page/v/?{}",
            build_query(&rd.device, &[("query", query.to_string()), ("offset", "0".into()), ("count", "10".into())])
        );
        let res = self.signed_get(&url, TIMEOUT).await?;
        if res.status != 200 || res.body.is_empty() {
            return Err(format!("搜索接口返回 HTTP {}", res.status));
        }
        let payload = parse_json(&res.body)?;
        if num(&payload["code"]) != 0.0 {
            return Err(format!("搜索接口错误：{}", str_of(&payload["message"])));
        }
        let books: Vec<Value> = payload["data"]
            .as_array()
            .map(|a| a.as_slice())
            .unwrap_or(&[])
            .iter()
            .filter_map(|cell| cell["book_data"].as_array().and_then(|d| d.first()))
            // book_type 为 1 的是有声书，没有文字正文
            .filter(|b| truthy(&b["book_id"]) && str_of(&b["book_type"]) != "1")
            .map(|b| {
                json!({
                    "id": str_of(&b["book_id"]),
                    "title": str_of(&b["book_name"]),
                    "author": str_of(&b["author"]),
                    "cover": str_of(&b["thumb_url"]),
                    "description": str_of(&b["abstract"]),
                    "category": str_of(&b["category"]),
                    "wordCount": num_json(num(&b["word_number"])),
                    "status": if str_of(&b["creation_status"]) == "0" { "已完结" } else { "连载中" },
                    "latestChapter": str_of(&b["last_chapter_title"]),
                })
            })
            .collect();
        let total = books.len();
        Ok(json!({ "books": books, "total": total, "hasMore": truthy(&payload["has_more"]) }))
    }

    // ----- 段评（不需要登录；签名只覆盖 URL，写操作才把 body 一起签）
    // 读接口带上 Cookie 才知道「我赞过没有」；写接口必须带
    async fn comment_call(&self, path: &str, body: Option<Value>, write: bool, host: &str, cookie: &str) -> R<Value> {
        let rd = self.ready().await?;
        if write && cookie.is_empty() {
            return Err("请先登录番茄账号".into());
        }
        let url = format!("{host}{path}?{}", build_query(&rd.device, &[("compliance_status", "0".into())]));
        let buf = body.map(|b| serde_json::to_vec(&b).unwrap_or_default());
        let mut req = Req::get(&url)
            .headers(sign_request(&url, if write { buf.as_deref() } else { None }))
            .header("User-Agent", APP_UA)
            .header("Accept", "*/*")
            .timeout(15);
        if !cookie.is_empty() {
            req = req.header("Cookie", cookie);
        }
        if let Some(b) = buf {
            req = req.header("Content-Type", "application/json; charset=utf-8").post(b);
        }
        let res = req.send().await?;
        if res.body.is_empty() {
            return Err("评论接口返回空响应".into());
        }
        let payload = parse_json(&res.body)?;
        let code = num(&payload["code"]);
        if code == 103006.0 {
            return Err("番茄登录已失效，请重新登录".into());
        }
        if code != 0.0 {
            return Err(if truthy(&payload["message"]) {
                str_of(&payload["message"])
            } else {
                format!("评论接口错误 {}", str_of(&payload["code"]))
            });
        }
        Ok(if truthy(&payload["data"]) { payload["data"].clone() } else { json!({}) })
    }

    /// { 段落idx: 评论数 }
    pub async fn comment_stats(&self, item_id: &str, cookie: &str) -> R<Value> {
        let data = self.comment_call(&format!("/idea/list/{item_id}/v1/"), None, false, COMMENT_BASE, cookie).await?;
        let mut stats = Map::new();
        if let Some(m) = data["data"].as_object() {
            for (idx, v) in m {
                let n = num(&v["count"]);
                if n > 0.0 {
                    stats.insert(idx.clone(), num_json(n));
                }
            }
        }
        Ok(Value::Object(stats))
    }

    /// sort：1 热门，3 最新
    pub async fn comment_list(
        &self,
        item_id: &str,
        book_id: &str,
        para_index: i64,
        cursor: &str,
        sort: i64,
        cookie: &str,
    ) -> R<Value> {
        let body = json!({
            "chapter_id": item_id, "comment_source": 2, "comment_type": 1, "group_type": 15,
            "count": 20, "sort": sort, "cursor": cursor,
            "business_param": { "book_id": book_id, "item_version": "0", "para_index": para_index },
        });
        let data = self.comment_call(&format!("/comment/list/{item_id}/v1/"), Some(body), false, COMMENT_BASE, cookie).await?;
        let info = &data["common_list_info"];
        let comments: Vec<Value> = data["data_list"]
            .as_array()
            .map(|a| a.as_slice())
            .unwrap_or(&[])
            .iter()
            .map(|x| &x["comment"])
            .filter(|c| truthy(c))
            .map(|c| flatten_comment(c, false))
            .collect();
        Ok(json!({
            "comments": comments,
            "cursor": str_of(&info["cursor"]),
            "hasMore": truthy(&info["has_more"]),
            "total": num_json(num(&info["total"])),
        }))
    }

    pub async fn comment_replies(&self, comment_id: &str, cursor: &str, cookie: &str) -> R<Value> {
        let body = json!({
            "comment_id": comment_id, "comment_source": 5, "comment_type": 1, "group_type": 15,
            "count": 20, "cursor": cursor,
        });
        let data = self.comment_call(&format!("/reply/list/{comment_id}/v1/"), Some(body), false, COMMENT_BASE, cookie).await?;
        let info = &data["common_list_info"];
        let replies: Vec<Value> = data["reply_list"]
            .as_array()
            .map(|a| a.as_slice())
            .unwrap_or(&[])
            .iter()
            .map(|r| flatten_comment(r, true))
            .collect();
        let cursor_out = if truthy(&info["cursor"]) { str_of(&info["cursor"]) } else { str_of(&data["cursor"]) };
        let has_more = if info["has_more"].is_null() { &data["has_more"] } else { &info["has_more"] };
        Ok(json!({ "replies": replies, "cursor": cursor_out, "hasMore": truthy(has_more) }))
    }

    pub async fn comment_add(
        &self,
        item_id: &str,
        book_id: &str,
        para_index: i64,
        para_text: &str,
        text: &str,
        cookie: &str,
    ) -> R<Value> {
        let body = json!({
            "text": text, "group_id": item_id, "group_type": 15, "data_type": 1, "comment_type": 0, "commit_source": 2,
            "business_param": para_business(book_id, para_index, para_text),
        });
        let data = self.comment_call("/comment/add/v1/", Some(body), true, COMMENT_BASE, cookie).await?;
        let c = if truthy(&data["comment_info"]) { &data["comment_info"] } else { &data["comment"] };
        if !truthy(c) {
            return Err("番茄没有确认段评发送结果，请稍后刷新查看".into());
        }
        Ok(flatten_comment(c, false))
    }

    /// to_reply_id 是被回复的那条回复（回复楼中楼时才有）
    #[allow(clippy::too_many_arguments)]
    pub async fn reply_add(
        &self,
        item_id: &str,
        book_id: &str,
        para_index: i64,
        para_text: &str,
        root_id: &str,
        to_user_id: &str,
        text: &str,
        to_reply_id: &str,
        cookie: &str,
    ) -> R<Value> {
        let mut body = json!({
            "text": text, "group_id": item_id, "group_type": 15, "data_type": 1, "commit_source": 8,
            "reply_to_comment_id": root_id,
            "reply_to_userid": to_user_id,
            "business_param": para_business(book_id, para_index, para_text),
        });
        if !to_reply_id.is_empty() {
            body["reply_to_replyid"] = json!(to_reply_id);
        }
        let data = self.comment_call("/reply/add/v1/", Some(body), true, COMMENT_BASE, cookie).await?;
        let r = if truthy(&data["reply"]) { &data["reply"] } else { &data["reply_info"] };
        if !truthy(r) {
            return Err("番茄没有确认回复发送结果，请稍后刷新查看".into());
        }
        Ok(flatten_comment(r, true))
    }

    /// digg_type：1 点赞 / 3 取消；target_type：1 评论 / 2 回复
    pub async fn comment_digg(
        &self,
        book_id: &str,
        id: &str,
        like: bool,
        is_reply: bool,
        service_id: i64,
        cookie: &str,
    ) -> R<()> {
        let body = json!({
            "book_id": book_id, "comment_id": id,
            "digg_type": if like { 1 } else { 3 }, "target_type": if is_reply { 2 } else { 1 },
            "service_id": if service_id == 0 { 1 } else { service_id },
        });
        self.comment_call("/reading/ugc/novel_comment/digg/v", Some(body), true, COMMENT_HOST, cookie).await?;
        Ok(())
    }

    // ----- 听书：番茄服务端合成的 AI 朗读，只需匿名设备签名
    async fn audio_call(&self, path: &str, extra: &[(&str, String)]) -> R<Value> {
        let rd = self.ready().await?;
        let url = format!("{APP_BASE}{path}?{}", build_query(&rd.device, extra));
        let res = self.signed_get(&url, 15).await?;
        // 有声书和章节 id 是超过 2^53 的裸数字，先转成字符串再解析，免得前端丢精度。
        // 只认未转义的 "key": 形式，嵌在字符串里的 JSON（\"key\":）不动
        static BIG: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        let big = BIG.get_or_init(|| Regex::new(r#""(\w+)":(\d{16,})([,}\]])"#).unwrap());
        let text = big.replace_all(&String::from_utf8_lossy(&res.body), r#""$1":"$2"$3"#).into_owned();
        if text.trim().is_empty() {
            return Err("听书接口返回空响应".into());
        }
        let payload: Value = serde_json::from_str(&text).map_err(|e| format!("听书接口响应无效：{e}"))?;
        let code = num(&payload["code"]);
        if code == 101019.0 {
            return Err("这个音色暂不支持本章，换一个试试".into());
        }
        if code != 0.0 {
            return Err(if truthy(&payload["message"]) {
                str_of(&payload["message"])
            } else {
                format!("听书接口错误 {}", str_of(&payload["code"]))
            });
        }
        Ok(payload)
    }

    /// 本书可用的音色：真人主播在前，AI 朗读按官方推荐顺序；key 里带上类型，播放时据此走不同接口
    pub async fn audio_tones(&self, book_id: &str) -> R<Value> {
        let payload = self.audio_call("/bookapi/audio/toneinfo/", &[("book_id", book_id.to_string())]).await?;
        let data = &payload["data"];
        let mut out: Vec<Value> = vec![];
        for t in data["audio_tones"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
            if !truthy(&t["abook_id"]) {
                continue;
            }
            let title = if truthy(&t["title"]) { str_of(&t["title"]) } else { "真人主播".into() };
            let title = title.strip_prefix("主播：").or_else(|| title.strip_prefix("主播:")).unwrap_or(&title).to_string();
            out.push(json!({ "key": format!("abook:{}", str_of(&t["abook_id"])), "kind": "narrator", "title": title, "description": "" }));
        }
        for t in data["tts_tones"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
            if !truthy(&t["id"]) {
                continue;
            }
            // 多角色音色官方只叫"升级版"之类，单独看不出是什么，补上说明
            let title = if truthy(&t["is_multi_tone"]) {
                format!("{}（多角色）", str_of(&t["title"]))
            } else if truthy(&t["title"]) {
                str_of(&t["title"])
            } else {
                format!("音色 {}", str_of(&t["id"]))
            };
            out.push(json!({ "key": str_of(&t["id"]), "kind": "tts", "title": title, "description": str_of(&t["description"]) }));
        }
        Ok(Value::Array(out))
    }

    /// 一章的音频地址（mp3，24 小时有效）
    pub async fn audio_play_info(&self, item_id: &str, tone_id: &str) -> R<Value> {
        let payload = self
            .audio_call(
                "/reader/audio/playinfo/",
                &[("item_ids", item_id.to_string()), ("tone_id", tone_id.to_string()), ("pv_player", "-1".into())],
            )
            .await?;
        let info = &payload["data"][0];
        if !truthy(&info["main_url"]) {
            return Err("这一章暂时没有音频".into());
        }
        if truthy(&info["is_encrypt"]) {
            return Err("这一章的音频已加密，暂不支持".into());
        }
        Ok(json!({ "url": str_of(&info["main_url"]), "backupUrl": str_of(&info["backup_url"]) }))
    }

    /// 音频时间轴：每句对应的段落（段评同款 idx，10000 是标题）和起止毫秒
    pub async fn audio_timepoints(&self, book_id: &str, item_id: &str, tone_id: &str) -> R<Value> {
        let payload = self
            .audio_call(
                "/reader/audio/timepoint/",
                &[
                    ("book_id", book_id.to_string()),
                    ("item_id", item_id.to_string()),
                    ("tone_id", tone_id.to_string()),
                    ("req_type", "1".into()),
                ],
            )
            .await?;
        let points: Vec<Value> = payload["data"]["time_points"]
            .as_array()
            .map(|a| a.as_slice())
            .unwrap_or(&[])
            .iter()
            .map(|t| {
                json!({
                    "start": num_json(num(&t["start_time"])), "end": num_json(num(&t["end_time"])),
                    "para": num_json(num(&t["start_para"])),
                })
            })
            .collect();
        Ok(Value::Array(points))
    }

    /// 真人主播：小说章节对应到有声书里的哪一章，以及每段从第几毫秒开始。
    /// 章节交界处偶尔有一段算到相邻音频里，取占多数的那个音频
    pub async fn audio_narration(&self, book_id: &str, item_id: &str, abook_id: &str) -> R<Value> {
        let payload = self
            .audio_call(
                "/reader/audio/timepoint/",
                &[
                    ("book_id", book_id.to_string()),
                    ("item_id", item_id.to_string()),
                    ("tone_id", "0".into()),
                    ("req_type", "3".into()),
                ],
            )
            .await?;
        let rows: Vec<Value> = payload["para_match_data"]["text_para_match_data"][abook_id]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut count: Vec<(String, usize)> = vec![];
        for r in &rows {
            let k = str_of(&r["item_id"]);
            match count.iter_mut().find(|(ck, _)| *ck == k) {
                Some(e) => e.1 += 1,
                None => count.push((k, 1)),
            }
        }
        let mut best: Option<&(String, usize)> = None;
        for e in &count {
            if best.map_or(true, |b| e.1 > b.1) {
                best = Some(e);
            }
        }
        let audio_id = best.map(|b| b.0.clone()).ok_or("主播还没录到这一章，可以换 AI 音色")?;
        let mut starts: Vec<(f64, f64)> = rows
            .iter()
            .filter(|r| str_of(&r["item_id"]) == audio_id)
            .map(|r| (num(&r["para"]), num(&r["start_time"])))
            .collect();
        starts.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        let points: Vec<Value> = starts
            .iter()
            .enumerate()
            .map(|(i, (para, start))| {
                let end = starts.get(i + 1).map(|n| num_json(n.1)).unwrap_or_else(|| json!(9007199254740991i64));
                json!({ "para": num_json(*para), "start": num_json(*start), "end": end })
            })
            .collect();
        let mut info = self.audio_play_info(&audio_id, "0").await?;
        info["points"] = Value::Array(points);
        Ok(info)
    }
}

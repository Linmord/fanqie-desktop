//! 公共工具：数据目录、JS 风格的 JSON 取值、HTTP 客户端。

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;

pub type R<T> = Result<T, String>;

pub const WEB_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---------------------------------------------------------------- 数据目录
static ROOT: OnceLock<PathBuf> = OnceLock::new();

pub fn init_root(root: PathBuf) {
    let _ = ROOT.set(root);
}

fn root() -> PathBuf {
    ROOT.get().cloned().unwrap_or_else(|| std::env::temp_dir().join("fanqie-desktop"))
}

/// 书架、设置、设备信息、账号
pub fn data_dir() -> PathBuf {
    root().join("data")
}

/// 章节正文缓存
pub fn chapter_cache_dir() -> PathBuf {
    root().join("cache").join("chapters")
}

// ---------------------------------------------------------------- JSON 取值（照 JS 的宽松语义）
/// JS 的 String(v)：字符串原样，数字按整数/小数写出，null 记空串
pub fn str_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

/// JS 的 Number(v) || 0
pub fn num(v: &Value) -> f64 {
    let n = match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.trim().parse::<f64>().unwrap_or(0.0),
        Value::Bool(true) => 1.0,
        _ => 0.0,
    };
    if n.is_nan() { 0.0 } else { n }
}

/// JS 的真值判断
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JS 的 a || b || c：取第一个真值，都不是则返回最后一个
pub fn or<'a>(vals: &[&'a Value]) -> &'a Value {
    for v in vals {
        if truthy(v) {
            return v;
        }
    }
    vals.last().copied().unwrap_or(&Value::Null)
}

/// 数字按 JS 的 Number() 转成 JSON 数值：整数优先，保持前端看到的是整数
pub fn num_json(f: f64) -> Value {
    if f.fract() == 0.0 && f.abs() < 9.0e15 {
        Value::from(f as i64)
    } else {
        serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
    }
}

// ---------------------------------------------------------------- HTTP
pub struct Resp {
    pub status: u16,
    pub headers: reqwest::header::HeaderMap,
    pub body: Vec<u8>,
}

impl Resp {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

fn build_client(follow: bool) -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(if follow { reqwest::redirect::Policy::default() } else { reqwest::redirect::Policy::none() })
        .connect_timeout(Duration::from_secs(15))
        .build()
        .expect("HTTP 客户端初始化失败")
}

fn client(follow: bool) -> &'static reqwest::Client {
    static FOLLOW: OnceLock<reqwest::Client> = OnceLock::new();
    static MANUAL: OnceLock<reqwest::Client> = OnceLock::new();
    if follow {
        FOLLOW.get_or_init(|| build_client(true))
    } else {
        MANUAL.get_or_init(|| build_client(false))
    }
}

pub struct Req<'a> {
    pub method: &'a str,
    pub url: &'a str,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub timeout: Duration,
    pub follow: bool,
}

impl<'a> Req<'a> {
    pub fn get(url: &'a str) -> Self {
        Req { method: "GET", url, headers: vec![], body: None, timeout: Duration::from_secs(15), follow: true }
    }

    pub fn header(mut self, k: &str, v: impl Into<String>) -> Self {
        self.headers.push((k.to_string(), v.into()));
        self
    }

    pub fn headers(mut self, hs: Vec<(String, String)>) -> Self {
        self.headers.extend(hs);
        self
    }

    pub fn post(mut self, body: Vec<u8>) -> Self {
        self.method = "POST";
        self.body = Some(body);
        self
    }

    pub fn timeout(mut self, secs: u64) -> Self {
        self.timeout = Duration::from_secs(secs);
        self
    }

    pub fn manual_redirect(mut self) -> Self {
        self.follow = false;
        self
    }

    pub async fn send(self) -> R<Resp> {
        let method = reqwest::Method::from_bytes(self.method.as_bytes()).map_err(|e| e.to_string())?;
        let mut rb = client(self.follow).request(method, self.url).timeout(self.timeout);
        for (k, v) in &self.headers {
            rb = rb.header(k.as_str(), v.as_str());
        }
        if let Some(b) = self.body {
            rb = rb.body(b);
        }
        let res = rb.send().await.map_err(|e| {
            if e.is_timeout() {
                return "timeout".to_string();
            }
            // 把底层原因（DNS、TLS 等）一并带上，只看顶层信息无法定位
            let mut msg = e.to_string();
            let mut src = std::error::Error::source(&e);
            while let Some(s) = src {
                msg.push_str(&format!(" <- {s}"));
                src = s.source();
            }
            msg
        })?;
        let status = res.status().as_u16();
        let headers = res.headers().clone();
        let body = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
        Ok(Resp { status, headers, body })
    }
}

/// 对应 JS 的 URLSearchParams.toString()
pub fn form_encode(pairs: &[(String, String)]) -> String {
    let mut s = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        s.append_pair(k, v);
    }
    s.finish()
}

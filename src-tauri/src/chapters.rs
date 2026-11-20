//! 正文缓存：内存 + 磁盘。App 接口两次请求之间要隔 6 秒，所以没缓存的章节顺带把后面几章一起取回来。

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::appapi::{parse_chapter_xhtml, AppApi};
use crate::util::{chapter_cache_dir, R};

/// 一次请求顺带取后面几章（接口单次最多 30 章）
const PREFETCH: usize = 4;
const MEM_SIZE: usize = 50;
/// 磁盘上最多留多少章，超出删最旧的
const DISK_SIZE: usize = 2000;

#[derive(Clone, Serialize, Deserialize)]
pub struct ChapterData {
    pub content: String,
    #[serde(rename = "paraIdx")]
    pub para_idx: Vec<i64>,
}

type Outcome = Option<Result<ChapterData, String>>;

#[derive(Default)]
struct Cache {
    /// 章节 id → 所属书和全书章节 id 列表，打开目录时登记，预取靠它找后面的章
    books: HashMap<String, (String, Arc<Vec<String>>)>,
    mem: HashMap<String, ChapterData>,
    mem_order: VecDeque<String>,
    inflight: HashMap<String, watch::Receiver<Outcome>>,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);

fn with<T>(f: impl FnOnce(&mut Cache) -> T) -> T {
    f(CACHE.lock().unwrap().get_or_insert_with(Cache::default))
}

fn file(id: &str) -> PathBuf {
    chapter_cache_dir().join(format!("{id}.json"))
}

fn remember(c: &mut Cache, id: &str, data: ChapterData) {
    c.mem_order.retain(|k| k != id);
    c.mem_order.push_back(id.to_string());
    c.mem.insert(id.to_string(), data);
    while c.mem_order.len() > MEM_SIZE {
        if let Some(old) = c.mem_order.pop_front() {
            c.mem.remove(&old);
        }
    }
}

fn read_cached(id: &str) -> Option<ChapterData> {
    if let Some(hit) = with(|c| c.mem.get(id).cloned()) {
        with(|c| remember(c, id, hit.clone()));
        return Some(hit);
    }
    let data: ChapterData = serde_json::from_str(&std::fs::read_to_string(file(id)).ok()?).ok()?;
    with(|c| remember(c, id, data.clone()));
    Some(data)
}

fn write_cached(id: &str, data: &ChapterData) {
    with(|c| remember(c, id, data.clone()));
    let dir = chapter_cache_dir();
    if std::fs::create_dir_all(&dir).is_ok() {
        if let Ok(text) = serde_json::to_string(data) {
            if let Err(e) = std::fs::write(file(id), text) {
                eprintln!("正文缓存写盘失败: {e}");
            }
        }
    }
}

fn to_data(xhtml: &str) -> Option<ChapterData> {
    let ch = parse_chapter_xhtml(xhtml);
    if ch.paragraphs.is_empty() {
        None
    } else {
        Some(ChapterData { content: ch.paragraphs.join("\n"), para_idx: ch.para_idx })
    }
}

/// 登记一本书的章节顺序
pub fn register_book(book_id: &str, chapter_ids: Vec<String>) {
    let ids = Arc::new(chapter_ids);
    with(|c| {
        for id in ids.iter() {
            c.books.insert(id.clone(), (book_id.to_string(), ids.clone()));
        }
    });
}

async fn wait(mut rx: watch::Receiver<Outcome>) -> R<ChapterData> {
    loop {
        if let Some(r) = rx.borrow_and_update().clone() {
            return r;
        }
        rx.changed().await.map_err(|_| "章节请求被中断".to_string())?;
    }
}

/// 取一章正文；没缓存时连同后面几章一次取回
pub async fn get_chapter(api: Arc<AppApi>, item_id: &str) -> R<ChapterData> {
    let id = item_id.to_string();
    if let Some(hit) = read_cached(&id) {
        return Ok(hit);
    }

    // 登记 inflight 与决定批次放在同一把锁里，避免两个请求同时发出同一章
    let started = {
        let mut guard = CACHE.lock().unwrap();
        let c = guard.get_or_insert_with(Cache::default);
        if let Some(rx) = c.inflight.get(&id) {
            Err(rx.clone())
        } else {
        let mut batch = vec![id.clone()];
        let mut book_id = String::new();
        if let Some((bid, ids)) = c.books.get(&id).cloned() {
            book_id = bid;
            if let Some(i) = ids.iter().position(|x| *x == id) {
                for next in ids.iter().skip(i + 1).take(PREFETCH) {
                    if !c.mem.contains_key(next) && !c.inflight.contains_key(next) && !file(next).exists() {
                        batch.push(next.clone());
                    }
                }
            }
        }
        let mut senders = vec![];
        let mut my_rx = None;
        for k in &batch {
            let (tx, rx) = watch::channel::<Outcome>(None);
            c.inflight.insert(k.clone(), rx.clone());
            if *k == id {
                my_rx = Some(rx);
            }
            senders.push((k.clone(), tx));
        }
        Ok((my_rx.unwrap(), batch, book_id, senders))
        }
    };
    let (rx, _batch, book_id, senders) = match started {
        Ok(s) => s,
        Err(rx) => return wait(rx).await,
    };

    tauri::async_runtime::spawn(async move {
        // 当前章单独先取、取到就返回：一次连后面几章一起请求，服务端耗时随章数明显增长
        // （实测同一本书 1 章 1~7s，5 章 6~24s），用户会白等预取的那几章
        let mut senders = senders;
        let pos = senders.iter().position(|(k, _)| *k == id).expect("当前章必在批次里");
        let (_, current_tx) = senders.remove(pos);
        let current: R<ChapterData> = match api.fetch_chapters(&[id.clone()], &book_id, 3).await {
            Ok(mut got) => match got.remove(&id).and_then(|x| to_data(&x)) {
                Some(data) => {
                    write_cached(&id, &data);
                    Ok(data)
                }
                None => Err("该章节未能获取正文".to_string()),
            },
            Err(e) => Err(e),
        };
        with(|c| c.inflight.remove(&id));
        let _ = current_tx.send(Some(current.clone()));

        // 后面几章在后台取，只试一轮，拿不到（如未购买）不影响当前章
        let mut out: HashMap<String, ChapterData> = HashMap::new();
        if current.is_ok() && !senders.is_empty() {
            let rest: Vec<String> = senders.iter().map(|(k, _)| k.clone()).collect();
            if let Ok(got) = api.fetch_chapters(&rest, &book_id, 1).await {
                for (k, xhtml) in got {
                    if let Some(data) = to_data(&xhtml) {
                        write_cached(&k, &data);
                        out.insert(k, data);
                    }
                }
            }
        }
        for (k, tx) in senders {
            let result = match (&current, out.get(&k)) {
                (_, Some(d)) => Ok(d.clone()),
                (Err(e), None) => Err(e.clone()),
                (Ok(_), None) => Err("预取未拿到".to_string()),
            };
            with(|c| c.inflight.remove(&k));
            let _ = tx.send(Some(result));
        }
    });

    wait(rx).await
}

/// 启动时清理：超出上限就删最旧的
pub fn prune() {
    let Ok(rd) = std::fs::read_dir(chapter_cache_dir()) else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    if files.len() <= DISK_SIZE {
        return;
    }
    files.sort_by_key(|(t, _)| *t);
    let excess = files.len() - DISK_SIZE;
    for (_, p) in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(p);
    }
}

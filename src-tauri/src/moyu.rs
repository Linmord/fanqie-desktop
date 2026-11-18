//! 摸鱼窗口：无边框、背景透明、置顶，只浮着几行正文。

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::store;
use crate::util::R;

static MAIN_WAS_FULLSCREEN: AtomicBool = AtomicBool::new(false);

// 上次的位置所在的显示器已经拔掉时，退回默认位置
fn saved_bounds(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    let b = store::get_moyu()["bounds"].clone();
    let (x, y, w, h) = (b["x"].as_f64()?, b["y"].as_f64()?, b["width"].as_f64()?, b["height"].as_f64()?);
    let visible = app.available_monitors().ok()?.iter().any(|m| {
        let s = m.scale_factor();
        let (mx, my) = (m.position().x as f64 / s, m.position().y as f64 / s);
        let (mw, mh) = (m.size().width as f64 / s, m.size().height as f64 / s);
        x < mx + mw && x + w > mx && y < my + mh && y + h > my
    });
    visible.then_some((x, y, w, h))
}

pub async fn open(app: AppHandle, book_id: String, chapter_id: String, para: i64) -> R<()> {
    if let Some(w) = app.get_webview_window("moyu") {
        let _ = w.set_focus();
        return Ok(());
    }
    let main = app.get_webview_window("main").ok_or("找不到主窗口")?;
    // 页面用 HashRouter，route 形如 /moyu/123/456?para=3
    let mut url = main.url().map_err(|e| e.to_string())?;
    url.set_fragment(Some(&format!("/moyu/{book_id}/{chapter_id}?para={para}")));

    let mut builder = WebviewWindowBuilder::new(&app, "moyu", WebviewUrl::External(url))
        .title("")
        .inner_size(420.0, 220.0)
        .min_inner_size(200.0, 80.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .minimizable(false)
        .maximizable(false)
        .fullscreen(false)
        .visible_on_all_workspaces(true)
        // 截图和共享屏幕时显示为空白
        .content_protected(true);
    if let Some((x, y, w, h)) = saved_bounds(&app) {
        builder = builder.position(x, y).inner_size(w, h);
    }
    let win = builder.build().map_err(|e| e.to_string())?;

    let w = win.clone();
    win.on_window_event(move |event| {
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            if let (Ok(p), Ok(s), Ok(f)) = (w.outer_position(), w.inner_size(), w.scale_factor()) {
                store::save_moyu(json!({
                    "bounds": { "x": p.x as f64 / f, "y": p.y as f64 / f, "width": s.width as f64 / f, "height": s.height as f64 / f }
                }));
            }
        }
    });

    // macOS 上直接隐藏全屏窗口会留下一个黑屏的空桌面，先退出全屏再藏，退出摸鱼时再全屏回去
    let was_full = main.is_fullscreen().unwrap_or(false);
    MAIN_WAS_FULLSCREEN.store(was_full, Ordering::Relaxed);
    if was_full {
        let _ = main.set_fullscreen(false);
        for _ in 0..30 {
            if !main.is_fullscreen().unwrap_or(false) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }
    let _ = main.hide();
    Ok(())
}

/// 退出摸鱼：主窗口回来，并跳到摸鱼窗口读到的位置
pub fn close(app: &AppHandle, chapter_id: String, para: i64) -> R<()> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        if MAIN_WAS_FULLSCREEN.swap(false, Ordering::Relaxed) {
            let _ = main.set_fullscreen(true);
        }
        let _ = main.emit("moyu:exit", json!({ "chapterId": chapter_id, "para": para }));
    }
    if let Some(w) = app.get_webview_window("moyu") {
        let _ = w.close();
    }
    Ok(())
}

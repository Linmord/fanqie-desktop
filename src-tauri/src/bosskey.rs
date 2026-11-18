//! 老板键：全局生效，在别的 App 里按也能藏起来。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const ACCELERATOR: &str = "Alt+Q";

static REGISTERED: AtomicBool = AtomicBool::new(false);
// macOS 上记是否藏着；其他平台记被藏起来的窗口，再按一次时只恢复这些
static MAC_HIDDEN: AtomicBool = AtomicBool::new(false);
static HIDDEN: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn is_registered() -> bool {
    REGISTERED.load(Ordering::Relaxed)
}

#[cfg(target_os = "macos")]
fn toggle(app: &AppHandle) {
    if MAC_HIDDEN.swap(false, Ordering::Relaxed) {
        let _ = app.set_dock_visibility(true);
        // 只恢复藏之前可见的窗口，不抢焦点
        let _ = app.show();
        return;
    }
    if !app.webview_windows().values().any(|w| w.is_visible().unwrap_or(false)) {
        return;
    }
    MAC_HIDDEN.store(true, Ordering::Relaxed);
    let _ = app.set_dock_visibility(false);
    // 等同 ⌘H：全屏窗口也能正确藏起来，焦点还给之前的 App
    let _ = app.hide();
}

#[cfg(not(target_os = "macos"))]
fn toggle(app: &AppHandle) {
    let mut hidden = HIDDEN.lock().unwrap();
    if !hidden.is_empty() {
        for label in hidden.drain(..) {
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.show();
            }
        }
        return;
    }
    for (label, w) in app.webview_windows() {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            hidden.push(label);
        }
    }
}

pub fn register(app: &AppHandle) {
    let _ = &HIDDEN;
    let result = app.global_shortcut().on_shortcut(ACCELERATOR, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            toggle(app);
        }
    });
    match result {
        Ok(()) => REGISTERED.store(true, Ordering::Relaxed),
        Err(e) => eprintln!("老板键 {ACCELERATOR} 注册失败，可能被其他 App 占用：{e}"),
    }
}

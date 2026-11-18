//! 启动时从 GitHub Release 检查更新：发现新版本就提示，确认后打开下载页。
//! 安装包没有代码签名，各平台都不做静默替换，由用户手动下载安装。

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;

use crate::util::Req;

const API: &str = "https://api.github.com/repos/MoYiC6/fanqie-desktop/releases/latest";
const RELEASES: &str = "https://github.com/MoYiC6/fanqie-desktop/releases/latest";

fn parse_version(v: &str) -> Vec<u64> {
    v.trim_start_matches('v').split('.').map(|p| p.split(|c: char| !c.is_ascii_digit()).next().unwrap_or("").parse().unwrap_or(0)).collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let (a, b) = (parse_version(latest), parse_version(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

pub fn check(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let current = app.package_info().version.to_string();
        let res = Req::get(API)
            .header("User-Agent", "fanqie-desktop")
            .header("Accept", "application/vnd.github+json")
            .timeout(15)
            .send()
            .await;
        let Ok(res) = res else { return };
        let Ok(release) = serde_json::from_slice::<Value>(&res.body) else { return };
        let tag = release["tag_name"].as_str().unwrap_or("");
        if tag.is_empty() || !is_newer(tag, &current) {
            return;
        }
        let version = tag.trim_start_matches('v').to_string();
        let handle = app.clone();
        app.dialog()
            .message(format!("当前版本 v{current}，前往 GitHub 下载新版安装包。"))
            .title(format!("发现新版本 v{version}"))
            .buttons(MessageDialogButtons::OkCancelCustom("去下载".into(), "稍后".into()))
            .show(move |ok| {
                if ok {
                    let _ = handle.opener().open_url(RELEASES, None::<&str>);
                }
            });
    });
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn 版本比较() {
        assert!(is_newer("v1.0.1", "1.0.0"));
        assert!(is_newer("v1.10.0", "1.9.9"));
        assert!(!is_newer("v1.0.0", "1.0.0"));
        assert!(!is_newer("v0.9.9", "1.0.0"));
    }
}

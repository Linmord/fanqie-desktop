## 更新内容

- 桌面框架从 Electron 换成 Tauri：安装包从约 127MB 缩到约 5MB，启动更快、占用更低。
- 升级后首次启动会自动带过书架、阅读设置、书签和摸鱼设置；登录状态需要重新扫码登录。
- 更新方式调整：启动时检查新版本并提示，确认后打开下载页，各平台都需手动下载安装。
- 摸鱼小窗无法再浮在其他 App 的全屏窗口之上。

## 下载

| 系统 | 文件 |
| --- | --- |
| macOS（Apple 芯片） | `*-mac-arm64.dmg` |
| macOS（Intel） | `*-mac-x64.dmg` |
| Windows | `*-win-x64.exe` |
| Linux | `*-linux-x86_64.AppImage` |

## 首次打开

安装包都没有做代码签名，首次打开需要手动放行：

- **macOS**：如果提示"无法验证开发者"，在「系统设置 → 隐私与安全性」里点"仍要打开"；如果提示"已损坏，无法打开"，在终端执行 `xattr -cr /Applications/番茄小说.app`。
- **Windows**：SmartScreen 拦截时，点"更多信息 → 仍要运行"。
- **Linux**：执行 `chmod +x fanqie-desktop-*.AppImage` 后运行。

## 免责声明

本项目是非官方第三方客户端，仅供学习与技术研究，严禁商用。使用前请阅读 [免责声明](https://github.com/MoYiC6/fanqie-desktop/blob/main/DISCLAIMER.md)。

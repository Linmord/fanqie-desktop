## 更新内容

- 新增自动更新：启动时检查 GitHub 上的新版本。Windows / Linux 自动下载，下载完提示重启安装；macOS 提示新版本并打开下载页。
- 从 1.0.1 及更早版本升级需要手动下载一次本版安装包，之后的版本就能收到更新提示。

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

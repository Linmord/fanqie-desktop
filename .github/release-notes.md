## 更新内容

- 首次加载更快：官网页面请求开启压缩，启动时后台预热首页推荐和设备注册，首页推荐用上次的结果先显示、后台再刷新。
- 读正文更快：当前章单独先取、取到就显示，后面几章在后台预取；从书架进入阅读页时，正文和目录同时请求。
- 修复正文密钥被服务端换掉后读不出正文、退回更慢网页接口的问题，现在会自动重新注册密钥并重试。

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

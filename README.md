# fanqie-desktop

> 一个非官方的番茄小说桌面客户端，支持 macOS / Windows / Linux，基于 Tauri 2 + React 构建，安装包只有几 MB。
>
> ⚠️ **仅供学习与技术研究，严禁商用。使用前请务必阅读 [免责声明](./DISCLAIMER.md)。**

## 功能

- **书城**：分类浏览、排行榜
- **搜索**：按书名 / 作者搜索（优先走 App 搜索接口，失败时回退网页搜索）
- **书籍详情**：简介、作者、字数、最新章节、完整目录
- **阅读器**：
  - 走 App 正文接口，正文为明文，无网页版字体加密
  - 字号、主题等阅读设置，本地持久化
  - 上一章 / 下一章，自动记录阅读进度
  - **段评**：查看每段的评论数，点开即可浏览热门 / 最新评论及回复
- **书架**：
  - 本地书架（未登录也可用）
  - **扫码登录**：用番茄小说 App 扫码，同步云书架和阅读进度

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面容器 | Tauri 2（系统 WebView + Rust 后端） |
| 前端 | React 18 · TypeScript · Vite 6 |
| UI | Ant Design 5 · Tailwind CSS 3 |
| 状态管理 | Zustand 5 |
| 打包 | Tauri bundler + GitHub Actions（macOS dmg · Windows 安装包 · Linux AppImage） |

## 项目结构

```
fanqie-desktop
├── src-tauri/                # 桌面端后端（Rust）
│   ├── src/lib.rs            # 窗口、外观与前端可调用的命令
│   ├── src/webapi.rs         # 网页端接口：详情、目录、分类、排行
│   ├── src/appapi.rs         # App 端接口：设备注册、签名、正文解密、段评、搜索、听书
│   ├── src/crypto.rs         # SM3 / Simon / Speck / AES 与 x-argus、x-ladon 签名
│   ├── src/account.rs        # 扫码登录、云书架、阅读进度同步
│   ├── src/chapters.rs       # 正文缓存与预取
│   ├── src/store.rs          # 本地书架与设置的 JSON 存储
│   └── tauri.conf.json
├── src/                      # 前端（React）
│   ├── pages/                # 首页 / 搜索 / 书架 / 详情 / 阅读器
│   ├── components/           # 布局、书卡、登录弹窗、段评抽屉
│   ├── stores/               # Zustand 状态
│   └── services/             # api.ts 统一入口，native.ts 通过 Tauri 命令调用 Rust
└── vite.config.ts
```

## 下载安装

到 [Releases](https://github.com/MoYiC6/fanqie-desktop/releases/latest) 下载对应平台的安装包：

| 系统 | 文件 |
| --- | --- |
| macOS（Apple 芯片） | `fanqie-desktop-<版本>-mac-arm64.dmg` |
| macOS（Intel） | `fanqie-desktop-<版本>-mac-x64.dmg` |
| Windows | `fanqie-desktop-<版本>-win-x64.exe` |
| Linux | `fanqie-desktop-<版本>-linux-x86_64.AppImage` |

安装包都没有做代码签名，首次打开需要手动放行：

- **macOS**：如果提示"无法验证开发者"，在「系统设置 → 隐私与安全性」里点"仍要打开"；如果提示"已损坏，无法打开"，在终端执行 `xattr -cr /Applications/番茄小说.app` 后再打开。
- **Windows**：SmartScreen 拦截时，点"更多信息 → 仍要运行"。
- **Linux**：先给 AppImage 加执行权限：`chmod +x fanqie-desktop-*.AppImage`。

## 从源码运行

环境要求：Node.js 18 及以上，以及 [Rust 工具链](https://www.rust-lang.org/tools/install)；Linux 还需要装 Tauri 的系统依赖，见 [官方文档](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/MoYiC6/fanqie-desktop.git
```

```bash
cd fanqie-desktop && npm install
```

开发模式（同时启动 Vite 和桌面窗口，首次会编译 Rust，需要几分钟）：

```bash
npm run dev
```

打包当前平台（产物输出到 `src-tauri/target/release/bundle/`）：

```bash
npm run build
```

推送 `v*` 格式的 tag 会触发 GitHub Actions，在三个平台上分别打包，并自动发布 Release。

## 数据存储

| 内容 | 位置 |
| --- | --- |
| 本地书架、阅读设置 | `<数据目录>/data/*.json` |
| 登录 Cookie | `<数据目录>/data/account.json`，文件权限仅当前用户可读 |
| App 接口设备注册信息 | `<数据目录>/data/device.json` |

`<数据目录>` 在 macOS 上是 `~/Library/Application Support/com.fanqie.desktop`，Windows 上是 `%APPDATA%\com.fanqie.desktop`，Linux 上是 `~/.local/share/com.fanqie.desktop`。

从 Electron 旧版升级时，首次启动会自动把旧目录（`fanqie-desktop`）里的书架、阅读设置和设备注册信息拷过来；登录 Cookie 是旧版加密保存的，带不过来，需要重新扫码登录。

## 常见问题

**正文加载失败，日志里出现 `tls handshake eof`？**

首次使用时，App 会向 `i.snssdk.com` 注册设备。部分代理软件的去广告规则会拦截这个域名，导致注册失败。请在代理规则中放行 `snssdk.com`，或临时关闭代理后再试。

## 参考的开源项目

本项目站在以下开源项目的肩膀上，在此致谢：

| 项目 | 许可证 | 用途 |
| --- | --- | --- |
| [Jees996/fanqie-novel-downloader](https://github.com/Jees996/fanqie-novel-downloader) | MIT | `src-tauri/src/appapi.rs`、`src-tauri/src/crypto.rs` 由其 `core/appapi.py` 移植为 Rust，包括设备注册、密钥交换、请求签名和正文 AES 解密流程。原版权声明保留在 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 中 |
| [naiyQAQ/fanqie-assistant](https://github.com/naiyQAQ/fanqie-assistant) | GPL-3.0 | 上述项目的 App 网关签名与加解密算法参考了它的公开实现，本项目间接受益 |

以及构建本项目所依赖的 [Tauri](https://github.com/tauri-apps/tauri)、[React](https://github.com/facebook/react)、[Vite](https://github.com/vitejs/vite)、[Ant Design](https://github.com/ant-design/ant-design)、[Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)、[Zustand](https://github.com/pmndrs/zustand) 等项目。

## 免责声明

本项目是**非官方**第三方客户端，与番茄小说及北京字节跳动科技有限公司无任何关联。本项目不存储、不分发任何小说内容，所有数据均由使用者设备直接向官方服务器请求获得。

本项目仅供个人学习与技术研究，**严禁用于商业用途或批量抓取、传播受版权保护的内容**。使用本项目产生的一切后果由使用者自行承担。请支持正版，支持作者。

完整条款见 [DISCLAIMER.md](./DISCLAIMER.md)。如有侵权，请通过 Issues 联系，核实后将第一时间处理。

## 许可证

[MIT](./LICENSE)

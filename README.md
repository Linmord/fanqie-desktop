# fanqie-desktop

> 一个非官方的番茄小说 macOS 桌面客户端，基于 Electron + React 构建。
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
| 桌面容器 | Electron 33 |
| 前端 | React 18 · TypeScript · Vite 6 |
| UI | Ant Design 5 · Tailwind CSS 3 |
| 状态管理 | Zustand 5 |
| 打包 | electron-builder（dmg / zip，arm64 + x64） |

## 项目结构

```
fanqie-desktop
├── electron/                 # 主进程
│   ├── main.js               # 窗口创建与 IPC 注册
│   ├── preload.js            # 向渲染进程暴露的安全 API
│   └── services/
│       ├── api.js            # 网页端接口：详情、目录、分类、排行
│       ├── appapi.js         # App 端接口：设备注册、签名、正文解密、段评、搜索
│       ├── account.js        # 扫码登录、云书架、阅读进度同步
│       └── store.js          # 本地书架与设置的 JSON 存储
├── src/                      # 渲染进程（React）
│   ├── pages/                # 首页 / 搜索 / 书架 / 详情 / 阅读器
│   ├── components/           # 布局、书卡、登录弹窗、段评抽屉
│   ├── stores/               # Zustand 状态
│   └── services/api.ts       # IPC 调用封装
├── electron-builder.yml
└── vite.config.ts
```

## 快速开始

环境要求：macOS、Node.js 18 及以上。

```bash
git clone https://github.com/MoYiC6/fanqie-desktop.git
```

```bash
cd fanqie-desktop && npm install
```

开发模式（同时启动 Vite 和 Electron）：

```bash
npm run dev
```

打包（产物输出到 `release/`）：

```bash
npm run build
```

> 打包产物未签名，首次打开时如提示"无法验证开发者"，请在「系统设置 → 隐私与安全性」中选择"仍要打开"。

## 数据存储

| 内容 | 位置 |
| --- | --- |
| 本地书架、阅读设置 | `~/Library/Application Support/<应用名>/data/*.json`（开发模式为 `fanqie-desktop`，打包后为 `番茄小说`） |
| 登录 Cookie | 同目录下 `account.bin`，经 Electron `safeStorage` 加密 |
| App 接口设备注册信息 | 同目录下 `device.json` |

## 参考的开源项目

本项目站在以下开源项目的肩膀上，在此致谢：

| 项目 | 许可证 | 用途 |
| --- | --- | --- |
| [Jees996/fanqie-novel-downloader](https://github.com/Jees996/fanqie-novel-downloader) | MIT | `electron/services/appapi.js` 由其 `core/appapi.py` 移植为 Node.js，包括设备注册、密钥交换、请求签名和正文 AES 解密流程。原版权声明保留在 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 中 |
| [naiyQAQ/fanqie-assistant](https://github.com/naiyQAQ/fanqie-assistant) | GPL-3.0 | 上述项目的 App 网关签名与加解密算法参考了它的公开实现，本项目间接受益 |

以及构建本项目所依赖的 [Electron](https://github.com/electron/electron)、[React](https://github.com/facebook/react)、[Vite](https://github.com/vitejs/vite)、[Ant Design](https://github.com/ant-design/ant-design)、[Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)、[Zustand](https://github.com/pmndrs/zustand)、[electron-builder](https://github.com/electron-userland/electron-builder) 等项目。

## 免责声明

本项目是**非官方**第三方客户端，与番茄小说及北京字节跳动科技有限公司无任何关联。本项目不存储、不分发任何小说内容，所有数据均由使用者设备直接向官方服务器请求获得。

本项目仅供个人学习与技术研究，**严禁用于商业用途或批量抓取、传播受版权保护的内容**。使用本项目产生的一切后果由使用者自行承担。请支持正版，支持作者。

完整条款见 [DISCLAIMER.md](./DISCLAIMER.md)。如有侵权，请通过 Issues 联系，核实后将第一时间处理。

## 许可证

[MIT](./LICENSE)

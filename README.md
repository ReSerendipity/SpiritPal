# SpiritPal · 桌边友 — AI Desktop Pet

> 治理规范：[ReSerendipity/.github/governance](https://github.com/ReSerendipity/.github/tree/main/governance)

> Cross-platform AI desktop pet companion built with Tauri v2. The core philosophy is "simple yet warm" — emotional companionship, lightweight interaction, and gentle productivity assistance.
>
> 跨平台 AI 桌面宠物：简单、温暖，陪在桌边。用轻交互与温柔的提醒，陪你工作、帮你专注。

## 它是什么

SpiritPal 是一只住在你桌面的 AI 伙伴：一个 Tauri v2 原生应用（Rust + React）。它支持自然语言聊天、专注计时、番茄钟、记忆召回——能记住与你的对话上下文，在你需要时给出恰到好处的陪伴，而不是打扰。

**核心定位**：情感陪伴 + 轻交互 + 温和的生产力协助。不是又一个效率插件，而是一个"在桌边陪着"的伙伴。

## 特性

**陪伴与交互**

- **多 Provider LLM 聊天**：OpenAI / Anthropic Claude / Google Gemini / DeepSeek / 千问 / 智谱 GLM / Kimi / 豆包 / Ollama（本地）/ 自定义端点
- **本地记忆召回**：本地 embedding（`@xenova/transformers`）检索，数据加密存本机
- **专注模式与番茄钟**：系统托盘或聊天唤起
- **全局快捷键**：`Ctrl+Shift+P` 切换宠物窗口显隐
- **MCP 桥**：内置 `spiritpal-mcp` sidecar，可供 MCP 客户端调用

**桌宠形象**

- 默认精灵图渲染，内置示例角色
- 可选 Live2D：应用**不随包分发** Live2D Cubism Core（专有软件）；将 `live2dcubismcore.js` 放入应用数据目录后自动启用，详见 [docs/COMPLIANCE_CHECKLIST.md](docs/COMPLIANCE_CHECKLIST.md)

**桌面原生能力**

- **系统托盘**：显示/隐藏宠物、专注模式、番茄钟（25 分钟）、切换形态（窗口/漫游）、打开聊天、设置、检查更新、退出
- **单实例**：二次启动唤出宠物窗口、不抢焦点（`tauri-plugin-single-instance`）
- **崩溃自启**：panic 现场落盘 `crash_YYYYMMDD_HHMMSS.log` 后受限自动重启——60 秒窗口内连续崩溃 ≤3 次自动重启，超限停止防循环（`SPIRITPAL_DISABLE_CRASH_RESTART=1` 可关闭）
- **增量更新**：内置更新器，入口：托盘「检查更新」或 设置 → 关于

**平台**

- 桌面：Windows / macOS / Linux（安装包：NSIS / DMG / AppImage / deb）
- 移动端：Android 适配视图（minSdk 24，源码构建）
- 界面语言：简体中文 / English / 日本語 / 한국어 / 繁體中文

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri v2（Rust 2021 edition + WebView） |
| 前端 | React 19、TypeScript、Vite、Tailwind CSS v4 |
| 状态管理 | Zustand 5 |
| 渲染 | Pixi.js 8 + @jannchie/pixi-live2d-display（可选 Live2D） |
| AI/ML | @xenova/transformers（本地 embedding）、多 Provider LLM 客户端 |
| 后端 | Rust（Tauri commands、加密、数据库、托盘、MCP 桥） |

## 快速开始

**前置条件**

- Node.js ≥ 22.13、pnpm 11（仓库锁定 `pnpm@11.26.0`）
- Rust：`Cargo.toml` 最低 1.77.2；`rust-toolchain.toml` 固定 1.98.0
- Linux 额外依赖：`libwebkit2gtk-4.1-0`、`libgtk-3-0`

```bash
git clone https://github.com/ReSerendipity/SpiritPal.git
cd SpiritPal

pnpm install          # 安装依赖
pnpm tauri dev        # 开发模式（dev server :5223）
pnpm tauri build      # 生产构建
```

## 安装（免构建）

前往 [GitHub Releases](https://github.com/ReSerendipity/SpiritPal/releases) 下载对应平台安装包。Windows 首次运行可能弹出 SmartScreen 提示——当前安装包未做 Authenticode 签名，属无签名软件常见现象：点「更多信息」→「仍然运行」即可；如有疑虑请比对 SHA-256 与 Release 页校验值。

## 配置

- **LLM Provider 与 API Key**：应用内「设置」窗口配置，Key 存入系统钥匙链，不写入仓库
- **开发端口**：dev server `:5223`（`src-tauri/tauri.conf.json`）
- **可选环境变量**：见 [.env.example](.env.example)（Sentry 监控）；`SPIRITPAL_DISABLE_CRASH_RESTART=1` 可关闭崩溃自启

## 测试

```bash
pnpm test            # 单元测试（Vitest）
pnpm lint            # 类型检查 + ESLint
pnpm test:e2e        # E2E 测试（Playwright）
cd src-tauri && cargo test   # Rust 测试
```

## 目录结构（概览）

```
SpiritPal/
├── src/                # 前端（components / lib / stores / hooks / mobile）
├── src-tauri/          # Rust 后端（commands、tray、encryption、db）
├── docs/               # 文档（adr/ 等）
├── demo/ perf/         # Demo 素材 / 性能评测脚本
├── scripts/            # 构建、审计与生成脚本
├── tests/e2e/          # Playwright E2E 用例
└── .github/workflows/  # CI/CD
```

## 贡献

参与贡献请遵循 [组织级贡献指南](https://github.com/ReSerendipity/.github/blob/main/CONTRIBUTING.md)（Conventional Commits + DCO 签名）。

安全漏洞请通过 [SECURITY.md](.github/SECURITY.md) 的私密披露渠道报告，勿直接提公开 issue。

## 许可证

SpiritPal 采用 [Apache License 2.0](LICENSE) 开源协议。第三方组件与 Live2D 相关声明见 [NOTICE](NOTICE) 与 [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md)。

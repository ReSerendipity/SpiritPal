# SpiritPal · 桌边友

> Cross-platform AI desktop pet built with Tauri v2 (Rust + React). "Simple yet warm" — gentle companionship, lightweight interaction, and quiet focus assistance.
>
> 跨平台 AI 桌面宠物：简单、温暖，陪在桌边。用轻交互与温柔的提醒，陪你工作、帮你专注。

[![CI](https://github.com/ReSerendipity/SpiritPal/actions/workflows/ci.yml/badge.svg)](https://github.com/ReSerendipity/SpiritPal/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ReSerendipity/SpiritPal)](https://github.com/ReSerendipity/SpiritPal/releases)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-2021%20edition-orange)](https://www.rust-lang.org/)
[![Last commit](https://img.shields.io/github/last-commit/ReSerendipity/SpiritPal)](https://github.com/ReSerendipity/SpiritPal/commits/main)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/ReSerendipity/.github/blob/main/CONTRIBUTING.md)
[![Governance](https://img.shields.io/badge/governance-ReSerendipity%2F.github-blue)](https://github.com/ReSerendipity/.github/tree/main/governance)

**[中文](#中文) · [English](#english)**

---

## 中文

### 这是什么

SpiritPal 是一只住在你桌面的 AI 伙伴，基于 Tauri v2 的原生应用（Rust 后端 + React 前端）。它能自然语言聊天、专注计时、番茄钟，并通过本地 embedding 召回与你的对话记忆——在你需要时给出恰到好处的陪伴，而不是打扰。

**核心定位**：情感陪伴 + 轻交互 + 温和的生产力协助。它不是又一个效率插件，而是一只"在桌边陪着"的伙伴。

### 核心特性

- **多 Provider LLM 聊天**：OpenAI / Anthropic Claude / Google Gemini / DeepSeek / 千问 / 智谱 GLM / Kimi / 豆包 / Ollama（本地）/ 自定义端点，API Key 存入系统 Keychain。
- **本地记忆召回**：`@xenova/transformers` 本地 embedding 检索，记忆以 AES-256-GCM 加密落盘，数据不离开本机。
- **专注与番茄钟**：系统托盘或聊天内唤起，25 分钟番茄钟，配合轻量提醒。
- **全局快捷键与单实例**：`Ctrl+Shift+P` 切换宠物显隐；二次启动唤出窗口但不抢焦点。
- **MCP 桥**：内置 `spiritpal-mcp` sidecar（`mcp_bridge.rs`），可供外部 MCP 客户端调用 SpiritPal 能力。
- **桌面原生能力**：系统托盘、崩溃自启（`crash_*.log`，60 秒窗口连续崩溃 ≤3 次后停止）、Tauri 增量更新、开机自启。

### 展示

**陪伴场景示意（非真实运行截图）**

![主界面](https://gcore.jsdelivr.net/gh/ReSerendipity/SpiritPal@main/docs/assets/readme-spiritpal-1-pet.svg)

**交互流程 · 一次聊天的真实链路**

![交互流程](https://gcore.jsdelivr.net/gh/ReSerendipity/SpiritPal@main/docs/assets/readme-spiritpal-2-interaction.svg)

**设置与记忆面板**（Provider / Keychain / 快捷键 / 语言 / 自启 / 更新 / 端侧模型）

![设置与记忆](https://gcore.jsdelivr.net/gh/ReSerendipity/SpiritPal@main/docs/assets/readme-spiritpal-3-settings-memory.svg)

**分层架构 · React ↔ Tauri IPC ↔ Rust 后端**

![架构](https://gcore.jsdelivr.net/gh/ReSerendipity/SpiritPal@main/docs/assets/readme-spiritpal-4-architecture.svg)

> 上图为模块级示意，模块名均对应仓库真实源码文件；当前未提供真实运行截图，欢迎在使用后提交截图到 issue 或 PR。

### 快速开始

**前置条件**

- Node.js ≥ 22.13、pnpm 11（仓库锁定 `pnpm@11.26.0`）
- Rust：`rust-version = 1.77.2`，`rust-toolchain.toml` 固定 1.98.0
- Linux 额外系统依赖：`libwebkit2gtk-4.1-0`、`libgtk-3-0`

```bash
git clone https://github.com/ReSerendipity/SpiritPal.git
cd SpiritPal

pnpm install          # 安装依赖
pnpm tauri dev        # 开发模式（dev server :5223）
pnpm tauri build      # 生产构建（NSIS / DMG / AppImage / deb）
```

**免构建安装**：前往 [Releases](https://github.com/ReSerendipity/SpiritPal/releases) 下载对应平台安装包。Windows 首次运行可能出现 SmartScreen 提示——当前安装包未做 Authenticode 签名，属常见现象：「更多信息」→「仍然运行」即可；可比对 SHA-256 与 Release 页校验值。

### 系统要求与兼容性

| 平台 | 安装包 | 备注 |
|---|---|---|
| Windows x64 | NSIS（`.exe`） | WebView2 引导安装 |
| macOS | DMG | 未做 Notarization |
| Linux x64 | AppImage / `.deb` | 依赖 WebKit2GTK 4.1 |
| Android | 源码构建 | minSdk 24，适配视图 |

界面语言：简体中文 / English / 日本語 / 한국어 / 繁體中文。

Live2D 为可选项：应用**不随包分发** Live2D Cubism Core（专有软件）；将 `live2dcubismcore.js` 放入应用数据目录后自动启用，合规细节见 [docs/COMPLIANCE_CHECKLIST.md](docs/COMPLIANCE_CHECKLIST.md)。

### 使用示例

- **配置第一个 Provider**：启动后从托盘打开「设置」→ 选择 Provider → 粘贴 API Key（Key 写入系统 Keychain，不写入仓库）。
- **专注 25 分钟**：托盘 →「番茄钟」开始；宠物会在适当时候给出轻提醒。
- **唤起宠物**：任意窗口按 `Ctrl+Shift+P`；再次按下隐藏。
- **导入自定义角色**：将 `.petmod`（zip）通过「设置 → 数据」导入，或直接放入 `character-packs/`。
- **接 MCP 客户端**：在「MCP 设置」中启用 `spiritpal-mcp` sidecar，外部 MCP 客户端即可调用。

### 常见问题（FAQ）

1. **为什么第一次启动没有宠物形象？** 默认精灵图已内置；如启用 Live2D，需自行放置 `live2dcubismcore.js`，否则回退到 Pixi.js 精灵渲染。
2. **API Key 存在哪里？安全吗？** 存入系统 Keychain（Windows Credential Manager / macOS Keychain / Linux Secret Service），代码见 `src-tauri/src/keychain.rs`，不写仓库、不入日志。
3. **记忆数据会上传云端吗？** 不会。记忆以 AES-256-GCM 加密存在本机应用数据目录（`encrypted_db.rs`），embedding 在本地用 `@xenova/transformers` 计算。
4. **崩溃后自动重启会不会死循环？** 60 秒窗口内连续崩溃 ≤3 次才自动重启，超限停止；设置 `SPIRITPAL_DISABLE_CRASH_RESTART=1` 可完全关闭。
5. **如何检查更新？** 托盘 →「检查更新」或 设置 →「关于」；更新清单见 `updates.json`，包来自 GitHub Releases。

### 文档与治理

- 架构决策：[docs/adr/](docs/adr/)（Tauri v2 capabilities、记忆系统选型、Pixi Live2D 版本锁定等）
- 隐私与合规：[docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md) · [docs/COMPLIANCE_CHECKLIST.md](docs/COMPLIANCE_CHECKLIST.md) · [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md)
- 安全模型：[docs/SECURITY_MATRIX.md](docs/SECURITY_MATRIX.md) · [.github/SECURITY.md](.github/SECURITY.md)
- 组织级治理：[ReSerendipity/.github/governance](https://github.com/ReSerendipity/.github/tree/main/governance)

### 贡献、安全与支持

- 贡献请遵循[组织级贡献指南](https://github.com/ReSerendipity/.github/blob/main/CONTRIBUTING.md)（Conventional Commits + DCO `Signed-off-by`）。
- 安全漏洞请通过 [.github/SECURITY.md](.github/SECURITY.md) 的私密披露渠道报告，勿直接提公开 issue。
- 功能建议与问题排查：先查 [Issues](https://github.com/ReSerendipity/SpiritPal/issues) 与 [docs/execution/](docs/execution/) 下的执行记录。

### 许可证

SpiritPal 采用 [Apache License 2.0](LICENSE)。第三方组件与 Live2D 相关声明见 [NOTICE](NOTICE) 与 [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md)。

---

## English

### What is SpiritPal

SpiritPal is an AI companion that lives on your desktop — a native Tauri v2 app (Rust backend + React frontend). It chats in natural language, runs focus timers and Pomodoro sessions, and recalls past conversations through local embeddings: the right amount of companionship when you need it, never intrusive.

**Positioning**: emotional companionship + lightweight interaction + gentle productivity help. It is not another productivity plugin — it is a friend that stays by your desk.

### Highlights

- **Multi-provider LLM chat**: OpenAI / Anthropic Claude / Google Gemini / DeepSeek / Qwen / Zhipu GLM / Kimi / Doubao / Ollama (local) / custom endpoints. API keys go to the OS keychain.
- **Local memory recall**: `@xenova/transformers` runs embeddings on-device; memories are encrypted at rest with AES-256-GCM and never leave your machine.
- **Focus & Pomodoro**: start from the tray or inside chat; 25-minute sessions with gentle nudges.
- **Global shortcut & single instance**: `Ctrl+Shift+P` toggles the pet window; a second launch brings it forward without stealing focus.
- **MCP bridge**: built-in `spiritpal-mcp` sidecar (`mcp_bridge.rs`) lets external MCP clients call SpiritPal capabilities.
- **Native desktop features**: system tray, crash auto-restart (`crash_*.log`, stops after ≤3 crashes in 60 s), Tauri updater, auto-start on login.

### Showcase

**Companionship scene illustration (not a real running screenshot)**

![Main window](https://gcore.jsdelivr.net/gh/ReSerendipity/SpiritPal@main/docs/assets/readme-spiritpal-1-pet.svg)

**Interaction flow · one chat turn, end to end**

![Interaction flow](https://gcore.jsdelivr.net/gh/ReSerendipity/SpiritPal@main/docs/assets/readme-spiritpal-2-interaction.svg)

**Settings & memory panel** (Provider / Keychain / shortcut / language / autostart / updater / on-device model)

![Settings & memory](https://gcore.jsdelivr.net/gh/ReSerendipity/SpiritPal@main/docs/assets/readme-spiritpal-3-settings-memory.svg)

**Layered architecture · React ↔ Tauri IPC ↔ Rust backend**

![Architecture](https://gcore.jsdelivr.net/gh/ReSerendipity/SpiritPal@main/docs/assets/readme-spiritpal-4-architecture.svg)

> The diagrams are module-level illustrations; every module name maps to a real source file in this repo. Real screenshots are not yet shipped — feel free to open an issue or PR with one after you try the app.

### Quick start

**Prerequisites**

- Node.js ≥ 22.13, pnpm 11 (repo pins `pnpm@11.26.0`)
- Rust: `rust-version = 1.77.2`, `rust-toolchain.toml` pins 1.98.0
- Linux extra deps: `libwebkit2gtk-4.1-0`, `libgtk-3-0`

```bash
git clone https://github.com/ReSerendipity/SpiritPal.git
cd SpiritPal

pnpm install          # install dependencies
pnpm tauri dev        # dev mode (dev server on :5223)
pnpm tauri build      # production build (NSIS / DMG / AppImage / deb)
```

**Prebuilt installers**: grab the right one from [Releases](https://github.com/ReSerendipity/SpiritPal/releases). On Windows, SmartScreen may warn on first launch — the installer is not Authenticode-signed yet, which is expected: *More info* → *Run anyway*. Cross-check the SHA-256 against the Release page if you prefer.

### Requirements & compatibility

| Platform | Package | Notes |
|---|---|---|
| Windows x64 | NSIS (`.exe`) | WebView2 bootstrapper |
| macOS | DMG | Not notarized yet |
| Linux x64 | AppImage / `.deb` | Requires WebKit2GTK 4.1 |
| Android | Build from source | minSdk 24, adapted view |

UI languages: Simplified Chinese / English / 日本語 / 한국어 / Traditional Chinese.

Live2D is optional: the app **does not bundle** the Live2D Cubism Core (proprietary). Drop `live2dcubismcore.js` into the app data directory to enable it; see [docs/COMPLIANCE_CHECKLIST.md](docs/COMPLIANCE_CHECKLIST.md).

### Usage recipes

- **Configure your first provider**: open *Settings* from the tray → pick a provider → paste your API key (stored in the OS keychain, never committed).
- **Focus for 25 minutes**: tray → *Pomodoro* to start; the pet nudges you gently when appropriate.
- **Summon the pet**: press `Ctrl+Shift+P` from any window; press again to hide.
- **Import a custom character**: import a `.petmod` (zip) via *Settings → Data*, or drop it into `character-packs/`.
- **Connect an MCP client**: enable the `spiritpal-mcp` sidecar in *MCP Settings*; external MCP clients can then call into it.

### FAQ

1. **Why is there no pet sprite on first launch?** The default sprite is bundled. If you enable Live2D, you must place `live2dcubismcore.js` yourself; otherwise the app falls back to the Pixi.js sprite renderer.
2. **Where are API keys stored? Are they safe?** They go to the OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service) — see `src-tauri/src/keychain.rs`. They are never committed or logged.
3. **Do memories leave my machine?** No. Memories are encrypted with AES-256-GCM in the local app-data directory (`encrypted_db.rs`); embeddings are computed locally by `@xenova/transformers`.
4. **Will auto-restart loop on a crash?** It only restarts when there are ≤3 crashes within a 60-second window, then gives up. Set `SPIRITPAL_DISABLE_CRASH_RESTART=1` to disable it entirely.
5. **How do I check for updates?** Tray → *Check for updates*, or Settings → *About*. The manifest is `updates.json`; packages come from GitHub Releases.

### Docs & governance

- ADRs: [docs/adr/](docs/adr/) (Tauri v2 capabilities, memory-system choice, Pixi Live2D version pin, …)
- Privacy & compliance: [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md) · [docs/COMPLIANCE_CHECKLIST.md](docs/COMPLIANCE_CHECKLIST.md) · [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md)
- Security model: [docs/SECURITY_MATRIX.md](docs/SECURITY_MATRIX.md) · [.github/SECURITY.md](.github/SECURITY.md)
- Org-level governance: [ReSerendipity/.github/governance](https://github.com/ReSerendipity/.github/tree/main/governance)

### Contributing, security & support

- Follow the [org contribution guide](https://github.com/ReSerendipity/.github/blob/main/CONTRIBUTING.md) (Conventional Commits + DCO `Signed-off-by`).
- Report security vulnerabilities via the private channel in [.github/SECURITY.md](.github/SECURITY.md) — do not open a public issue.
- For feature requests and troubleshooting, start with [Issues](https://github.com/ReSerendipity/SpiritPal/issues) and the execution notes under [docs/execution/](docs/execution/).

### License

SpiritPal is licensed under [Apache License 2.0](LICENSE). Third-party attributions and Live2D-related notices are in [NOTICE](NOTICE) and [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md).

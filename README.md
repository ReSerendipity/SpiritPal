# SpiritPal · 桌边友 — AI Desktop Pet

> Cross-platform AI desktop pet companion built with Tauri v2. The core philosophy is "simple yet warm" — emotional companionship, lightweight interaction, and gentle productivity assistance.
>
> 跨平台 AI 桌面宠物：简单、温暖，陪在桌边。用轻交互与温柔的提醒，陪你工作、帮你专注。

## 它是什么

SpiritPal 是一只住在你桌面的 AI 伙伴：一个 Tauri v2 原生应用（Rust 后端 + React 前端），通过 Live2D 形象陪伴你。它支持自然语言聊天、专注计时、番茄钟、记忆召回——能记住与你的对话上下文，在你需要时给出恰到好处的陪伴，而不是打扰。

**核心定位**：情感陪伴 + 轻交互 + 温和的生产力协助。不是又一个效率插件，而是一个"在桌边陪着"的伙伴。

## 特性

**陪伴与交互**

- Live2D 桌宠形态，支持多种形态切换（`src/components/`）
- 自然语言聊天与本地记忆召回（本地 embedding，`@xenova/transformers`，数据不出机器）
- 专注模式与番茄钟，通过系统托盘或聊天唤起

**桌面原生能力（阶段五佐证，2026-09-10 核验）**

- **系统托盘**：显示/隐藏宠物、专注模式、番茄钟、切换形态、打开聊天、设置、检查更新、退出（`src-tauri/src/tray.rs`）
- **单实例**：二次启动唤出主窗口不抢焦点（`tauri-plugin-single-instance`）
- **崩溃自启**：panic hook 落盘崩溃现场（`{log_dir}/crash_*.log`）后受限自动重启——60 秒冷却窗口内连续崩溃 ≤3 次自动重启，超限停止防循环（可用 `SPIRITPAL_DISABLE_CRASH_RESTART=1` 关闭）
- **增量更新**：Tauri updater 已启用（签名密钥与发布链见项目内 SOP 文档，本地保留）；入口：托盘「检查更新」/ 设置-关于

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri v2（Rust 2021 edition + WebView） |
| 前端 | React 19、TypeScript、Vite、Tailwind CSS v4 |
| 状态管理 | Zustand 5 |
| 渲染 | Pixi.js 8 + @jannchie/pixi-live2d-display |
| AI/ML | @xenova/transformers（本地 embedding） |
| 后端 | Rust（Tauri commands、encryption、db、tray） |

## 快速开始

```bash
# 仓库根即 SpiritPal，无需进入子目录
cd SpiritPal

pnpm install          # 安装依赖
pnpm tauri dev        # 开发模式
pnpm tauri build      # 生产构建
```

## Windows 安装与 SmartScreen 说明

当前安装包暂未进行 Authenticode 代码签名（无商业证书），Windows 首次运行时 SmartScreen 可能提示"Windows 已保护你的电脑"。**这是无签名软件的常见现象，并非病毒警告**：

1. 点击提示窗口中的「更多信息」
2. 再点击「仍然运行」即可正常安装/启动

> 安全说明：本仓库绝不伪造或冒用任何证书；产物哈希与版本信息均可通过 GitHub Release 资产核对。如有疑虑，请比对安装包 SHA-256 与 Release 页发布的校验值。

## 测试

```bash
cd SpiritPal

pnpm test            # 单元测试（Vitest）
pnpm lint            # 类型检查
pnpm test:e2e        # E2E 测试（Playwright）
cd src-tauri && cargo test   # Rust 测试
```

## 目录结构（概览）

```
SpiritPal/
├── src/                # 前端（components / lib / stores / mobile）
├── src-tauri/          # Rust 后端（commands、capabilities、tray、encryption、db）
├── docs/               # 文档（adr/ 架构决策记录 0001–0005、execution/、project/）
├── demo/               # Demo HTML 页面与预览素材
├── perf/               # 性能评测（记忆召回 P95 / 准确率趋势）
├── .github/workflows/  # CI/CD
└── AGENTS.md           # AI 辅助开发指南（本地保留，未随仓库发布）
```

## 已知阻塞 / 待办（透明披露）

- **性能验收数据待真实跑批**：记忆召回评测（P95 / 准确率趋势）数据已落地，但 PRD 性能验收（冷启动 / 内存 / 帧率 / 包体时序）依赖 `pnpm tauri build` + `pnpm perf` 的真实产物，目前为空（数据仅本地、不入库）
- **评测 case 20（运动 → 跑步）语义鸿沟**：本地召回评测 29/30（96.7%），`运动` 与 `跑步` 的语义关联超出当前 LCS/同义词扩展能力；待启用真实 embedding/RAG 路径后该 case 应自然命中

## 开源模式说明

本仓库为**公开仓库**，以 Apache License 2.0 发布（Copyright 2026 ReSerendipity）。原「main 私有开发 + origin 公开演示」双仓双分支体系已废止：私有仓已改名为本仓库并全量公开（含完整 main 历史）。

- `main` 为唯一主分支，push 即发布；禁止 force push
- 敏感文件永不入库：`*.jks` / `local.properties` / `.env` 等（.gitignore 已覆盖，全历史已扫描核验）
- 安全漏洞请通过 [SECURITY.md](.github/SECURITY.md) 的私密披露渠道报告，勿直接提公开 issue

## 贡献

参与贡献请遵循 [组织级贡献指南](https://github.com/ReSerendipity/.github/blob/main/CONTRIBUTING.md)（Conventional Commits + DCO 签名）。

## 许可证

SpiritPal 采用 [Apache License 2.0](LICENSE) 开源协议。`references/` 中的参考仓库保留各自许可。

# SpiritPal · 桌边友 - AI Desktop Pet

 Cross-platform AI desktop pet application built with Tauri v2 (Rust + React 19 + TypeScript). The core philosophy is "simple yet warm" -- providing emotional companionship, lightweight interaction, and gentle productivity assistance.

## Directory Structure

```
SpiritPal/
├── src/                 # Frontend source code
│   ├── components/      # UI components
│   ├── lib/             # Core libraries (AI, memory, behavior, etc.)
│   ├── stores/          # Zustand state management
│   ├── mobile/          # Mobile-specific views
│   │   └── test/        # Vitest test setup & mocks
│   └── stores/__tests__ # Zustand store unit tests
├── src-tauri/           # Rust backend (Tauri commands, capabilities, tray)
│   ├── src/             # Rust source (commands, encryption, db, tray)
│   └── capabilities/    # Tauri v2 capability permission whitelists
├── docs/                # Documentation
│   ├── analysis/        # Repository analysis reports & optimization plans
│   └── project/         # PRD, technical specs, and roadmap
├── demo/                # Demo HTML pages and preview assets
├── references/          # Vendored reference repos for learning (gitignored)
├── artifacts/           # Build outputs like APK files (gitignored)
├── .github/workflows/   # CI/CD pipelines
├── .trae/               # Local IDE tooling state (gitignored)
├── AGENTS.md            # AI 辅助开发指南（本地文档，未随仓库发布）
└── .gitignore
```

## Quick Start

```bash
# 仓库根即 SpiritPal，无需进入子目录
cd SpiritPal

# Install dependencies
pnpm install

# Development
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Windows 安装与 SmartScreen 说明（P1-2）

当前安装包**暂未进行 Authenticode 代码签名**（无商业证书）。因此 Windows 首次运行时 SmartScreen 可能提示"Windows 已保护你的电脑"，**这是无签名软件的常见正常现象，并非病毒警告**：

1. 点击提示窗口中的 **"更多信息"**
2. 再点击 **"仍然运行"** 即可正常安装/启动

> 安全说明：本仓库绝不伪造或冒用任何证书；产物哈希与版本信息均可通过 GitHub Release 资产核对。如有疑虑，请比对安装包 SHA-256 与 Release 页发布的校验值。

## 桌面端能力（阶段五佐证，2026-09-10 核验）

- **系统托盘**：显示/隐藏宠物、专注模式、番茄钟、切换形态、打开聊天、设置、**检查更新**、退出（`src-tauri/src/tray.rs`）
- **单实例**：二次启动唤出主窗口不抢焦点（`tauri-plugin-single-instance`，lib.rs）
- **崩溃自启**：panic hook 落盘崩溃现场（`{log_dir}/crash_*.log`）后受限自动重启——60 秒冷却窗口内连续崩溃 ≤3 次自动重启，超限停止防循环（`src-tauri/src/diagnostics.rs`，可用 `SPIRITPAL_DISABLE_CRASH_RESTART=1` 关闭）
- **增量更新**：Tauri updater 已启用（签名密钥、updates.json 发布链见 `docs/project/AI_DEV_SOPS.md` SOP-5，本地文档，未随仓库发布）；入口：托盘「检查更新」/ 设置-关于「检查更新」

## Testing

```bash
# 仓库根即 SpiritPal，无需进入子目录
cd SpiritPal

# Unit tests (Vitest)
pnpm test

# Type check
pnpm lint

# E2E tests (Playwright)
pnpm test:e2e

# Rust tests
cd src-tauri && cargo test
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | Tauri v2 (Rust + WebView) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| State management | Zustand 5 |
| Rendering | Pixi.js 7 + pixi-live2d-display |
| AI/ML | @xenova/transformers (local embeddings) |
| Backend | Rust 2021 edition |
| Package manager | pnpm 9 (frontend), Cargo (Rust) |

## Contributing

参与贡献请遵循 [组织级贡献指南](https://github.com/ReSerendipity/.github/blob/main/CONTRIBUTING.md)（Conventional Commits + DCO 签名）。

## License

SpiritPal is licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) for details.
Reference repositories in `references/` retain their respective licenses.

## 仓库说明（开源模式，2026-09-08 起）

本仓库为**公开仓库**，以 Apache License 2.0 发布（Copyright 2026 ReSerendipity）。原「main 私有开发 + origin 公开演示」双仓双分支体系已废止：私有仓已改名为本仓库并全量公开（含完整 main 历史），public 演示分支与演示仓已删除。

- `main` 为唯一主分支，push 即发布；push 前需经所有者授权并核对 `git remote -v`，禁止 force push。
- 敏感文件永不入库：`*.jks` / `local.properties` / `.env` 等（.gitignore 已覆盖，全历史已扫描核验）。
- `backup` 为本地历史分支，不对外维护。
- 安全漏洞请通过 [SECURITY.md](.github/SECURITY.md) 的私密披露渠道报告，勿直接提公开 issue。
## 🚧 已知阻塞 / 待办（B-4 记忆召回收尾）

B-4 主线（隔离设计 + 检索候选池修复 + 评测套件 + 趋势看板）已闭环并提交，以下两项需环境/架构就位后方可推进，**当前无独立代码可解**：

- **[阻塞] 真实验收填充 `perf/results/perf-history.json`**
  - 现状：`perf/results/recall-history.json`（记忆 P95 / 召回率趋势）已落地，但 PRD 性能验收（冷启动 / 内存 / 帧率 / 包体时序）依赖 `perf/run-all.mjs` 的真实产物，目前为空。
  - 解锁条件：先 `pnpm tauri build` 产出 exe，再 `pnpm perf`（Playwright + 真机/模拟器）跑批；数据仅本地、不入库（已 gitignore）。
- **[阻塞] 评测 case 20（运动 → 跑步）语义鸿沟**
  - 现状：本地召回评测 29/30（96.7%），仅 case 20 未命中——`运动` 与 `跑步` 的语义关联超出 LCS/同义词扩展能力。
  - 解锁条件：启用真实 embedding/RAG 路径（`@xenova/transformers` 本地向量检索 + `ragRetrieval`），当前评测在 mock 下短路了向量检索，故纯本地无法补；待真实 RAG 接通后该 case 应自然命中。

# SpiritPal · 桌边友 - AI Desktop Pet

 Cross-platform AI desktop pet application built with Tauri v2 (Rust + React 19 + TypeScript). The core philosophy is "simple yet warm" -- providing emotional companionship, lightweight interaction, and gentle productivity assistance.

## Directory Structure

```
SpiritPal/
├── src/                 # Frontend source code
│   ├── components/      # UI components
│   ├── lib/             # Core libraries (AI, memory, behavior, etc.)
│   ├── stores/          # Zustand state management
│   └── mobile/          # Mobile-specific views
├── src-tauri/           # Rust backend (Tauri commands, capabilities, tray)
│   └── capabilities/    # Tauri v2 capability permission whitelists
├── docs/                # Documentation
│   └── project/         # PRD, technical specs, and roadmap
├── demo/                # Demo HTML pages and preview assets
├── .github/workflows/   # CI/CD pipelines
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

## 桌面端功能

- **系统托盘**：显示/隐藏宠物、专注模式、番茄钟、切换形态、打开聊天、设置、检查更新、退出
- **单实例**：二次启动唤出主窗口，不抢焦点
- **崩溃自启**：崩溃时自动落盘现场日志并受限自动重启（60 秒冷却窗口内连续崩溃 ≤3 次，超限停止防循环）；如需关闭，设置环境变量 `SPIRITPAL_DISABLE_CRASH_RESTART=1`
- **增量更新**：内置更新器，入口为托盘「检查更新」或 设置 → 关于 →「检查更新」

## Windows 安装与 SmartScreen 说明

当前安装包**暂未进行 Authenticode 代码签名**（无商业证书）。因此 Windows 首次运行时 SmartScreen 可能提示"Windows 已保护你的电脑"，**这是无签名软件的常见正常现象，并非病毒警告**：

1. 点击提示窗口中的 **"更多信息"**
2. 再点击 **"仍然运行"** 即可正常安装/启动

> 安全说明：本仓库绝不伪造或冒用任何证书；产物哈希与版本信息均可通过 GitHub Release 资产核对。如有疑虑，请比对安装包 SHA-256 与 Release 页发布的校验值。

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

## Security

安全漏洞请通过 [SECURITY.md](.github/SECURITY.md) 的私密披露渠道报告，勿直接提公开 issue。

## Contributing

参与贡献请遵循 [组织级贡献指南](https://github.com/ReSerendipity/.github/blob/main/CONTRIBUTING.md)（Conventional Commits + DCO 签名）。

## License

SpiritPal is licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) for details.

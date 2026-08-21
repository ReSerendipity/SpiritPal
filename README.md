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
├── AGENTS.md            # AI agent guidance and architecture docs（自进化协议）
└── .gitignore
```

## Quick Start

```bash
cd spiritpal-app

# Install dependencies
pnpm install

# Development
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Testing

```bash
cd spiritpal-app

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

## License

See individual repositories in `references/` for their respective licenses.

## ⚠️ Git Branch Usage Instructions（分支策略：本地 main + 远程 public）

> 本仓库采用 **「本地开发 + 远程发布」双分支策略**，请严格遵守，避免把本地私有代码泄漏到远程。

- **`main`（本地开发分支）**：日常开发与私有工作都在这条分支上，**只提交到本地**。
- **`public`（远程发布分支）**：对外发布的公共内容专属分支。**仅此分支会被推送到远程**。

### 📌 使用准则

1. 开发时一律在 `main` 分支上提交。
2. 需要对外发布时，先把内容合并到 `public`，再 `push origin public`。
3. ⚠️ **绝对不要执行 `git push origin main`** —— 会把本地私有代码泄漏到 GitHub。

### 🔒 工作流

**日常开发（只动本地）：**
```bash
git checkout main      # 切到本地开发分支
git add .              # 暂存
git commit -m "..."    # 本地提交（不会被推送）
```

**发布公共内容（合并到 public 后推送）：**
```bash
git checkout public    # 切到发布分支
git merge main         # 合并本地开发内容（可按需 cherry-pick 指定提交）
git push origin public # 推送到远程 public 分支
```

> 📌 远端 `origin` 同时存在 `main` 与 `public` 两个分支时，请始终以 `public` 作为唯一对外发布出口。

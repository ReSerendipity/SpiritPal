# SpiritPal · 桌边友 - AI Desktop Pet

 Cross-platform AI desktop pet application built with Tauri v2 (Rust + React 19 + TypeScript). The core philosophy is "simple yet warm" -- providing emotional companionship, lightweight interaction, and gentle productivity assistance.

## Directory Structure

```
Pet/
├── spiritpal-app/           # Core application (Tauri v2 + React 19 + TypeScript)
│   ├── src/              # Frontend source code
│   │   ├── components/   # UI components
│   │   ├── lib/          # Core libraries (AI, memory, behavior, etc.)
│   │   ├── stores/       # Zustand state management
│   │   ├── mobile/       # Mobile-specific views
│   │   └── test/         # Vitest test setup & mocks
│   ├── src-tauri/        # Rust backend (Tauri commands, Win32 API, encryption)
│   ├── perf/             # Performance test scripts
│   └── e2e/              # Playwright E2E tests
├── docs/                 # Documentation
│   ├── analysis/         # Repository analysis reports & optimization plans
│   └── project/          # PRD, technical specs, and roadmap
├── demo/                 # Demo HTML pages and preview assets
├── references/           # Vendored reference repos for learning (gitignored)
├── artifacts/            # Build outputs like APK files (gitignored)
├── .github/workflows/    # CI/CD pipelines (ci.yml, release.yml)
├── .trae/                # Local IDE tooling state (gitignored)
├── AGENTS.md             # AI agent guidance and architecture docs
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

## ⚠️ Git Branch Usage Instructions

**Important**: This project now uses main as the primary branch name.

- **All development work should be done on the \main\ branch**
- **Do NOT use the \public\ branch for development anymore**
- **All code commits should be directly to the \main\ branch**

Historical context: This project previously created an orphan branch named \public\ for potential public release purposes, but that strategy has been changed and all development and version management are now unified on the \main\ branch.

When pushing to remote repository, please push to the \main\ branch:
```bash
git push origin main
```

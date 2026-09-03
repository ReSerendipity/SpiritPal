# Contributing to SpiritPal

Thank you for your interest in contributing to SpiritPal — a desktop AI pet application (Tauri v2 + React/TypeScript + Rust).

This document gives a short "10-minute quick start" to get contributors productive, and a concise reference for common contribution tasks.

---

## Quick Start (10 minutes)

1. Clone the repository

```bash
git clone https://github.com/ReSerendipity/SpiritPal.git
cd SpiritPal
```

2. Install dependencies & run (dev)

```bash
pnpm install
pnpm tauri dev
```

3. Create a branch for your change

```bash
git checkout -b fix/short-description
# make changes, run tests, then push
git commit -m "fix(pet): short description"
git push origin fix/short-description
```

4. Open a Pull Request using the provided template.

---

## Development (local)

Prerequisites
- Node.js 20+ / pnpm
- Rust toolchain (stable)
- Tauri v2 CLI

Run tests

```bash
pnpm test          # 前端单测（Vitest）
pnpm lint          # ESLint + prettier
cargo test         # Rust 侧测试（src-tauri）
pnpm e2e           # Playwright E2E
```

Format

```bash
pnpm format
cargo fmt
cargo clippy
```

---

## How to File Good Issues

- Bug reports: include environment (OS, GPU), steps to reproduce, expected vs actual behavior, and logs.
- Feature requests: describe the use case, proposed solution, and any alternatives.

Use the provided issue templates (bug_report / feature_request).

---

## Pull Request Checklist

- Use a descriptive title and include a short summary in the PR body.
- Link related issues using `Closes #<issue>` when appropriate.
- Add tests for new behavior where feasible.
- Run tests & linters locally before opening the PR.
- Follow Conventional Commits for commit messages (`feat:`, `fix:`, `docs:`, etc.).

---

## License

By contributing, you agree your contributions are licensed under the Apache License 2.0 (see [LICENSE](../LICENSE)).

---

Thank you for contributing — the community makes this project better!

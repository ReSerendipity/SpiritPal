# 贡献指南（CONTRIBUTING）

感谢关注 SpiritPal！本文件给出从克隆到合并的最短路径。

## 1. 环境搭建

```bash
# 前端（Node 22+ / pnpm 11）
pnpm install
pnpm dev          # Vite 开发服务

# Tauri 壳（Rust）
pnpm tauri dev
```

## 2. 本地开发循环

| 场景 | 命令 |
|---|---|
| Lint（ESLint） | `pnpm lint` |
| 格式（Prettier） | `pnpm format` |
| 单元测试（Vitest） | `pnpm test` |
| Rust 测试 | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Rust Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` |
| E2E（Playwright） | `pnpm test:e2e` |

## 3. 分支与提交规范

- 从最新 `main` 切出：`git checkout -b feat/xxx`。
- **Conventional Commits**：`feat(scope): 描述` / `fix(scope): 描述` / `docs:` / `ci:` / `test:` / `chore:` / `refactor:`。
- **DCO 签名**：每个提交必须带签名：`git commit -s`（CI 有 DCO 门禁）。
- 提交层钩子自动跑 structure-guard / capability-lint / gitleaks；预检失败请修复代码，禁止 `--no-verify`。

## 4. Pull Request

PR 模板会引导你填写变更动机、测试结果、自查项。Issue 请使用现成表单。

## 5. 红线

- **禁止修改 `src-tauri/gen/` 生成目录**（由 Tauri CLI 重新生成）。
- 三窗口配置以 Rust `window_config()` 为单一事实源，前端不得重复定义窗口参数。
- push ≠ 完成：用 `gh run list` 盯 CI 到终态。

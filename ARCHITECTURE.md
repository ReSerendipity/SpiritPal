# 架构 — SpiritPal

> 治理定位：`delivery=release`、`lifecycle=active`（`governance/desired-state.json`）。
> 本文按 2026-11-03 的实际目录结构生成；数据流与边界须由维护者在实现变更时同步复核。

## 1. 定位

**[中文](#中文) · [English](#english)**

## 2. 组件与依赖方向

```text
应用层：src/ (606)、src-tauri/ (493)
工具层：scripts/ (54)
资产层：public/ (7)
测试层：perf/ (22)、tests/ (12)
支撑层：docs/ (79)、.github/ (25)
其他层：.githooks/ (13)、demo/ (3)、.ci/ (1)、character-packs/ (1)
根级层：根级文件 (33)
```

| 组件 | 目录 | 文件数 | 代表文件 |
|---|---|---|---|
| `src` | `src/` | 606 | `src/App.tsx`, `src/components/AchievementPanel.tsx`, `src/components/AgreementGate.tsx` |
| `src-tauri` | `src-tauri/` | 493 | `src-tauri/.cargo/audit.toml`, `src-tauri/.cargo/config.toml`, `src-tauri/.gitignore` |
| `docs` | `docs/` | 79 | `docs/CHARACTER_ATTRIBUTIONS.md`, `docs/CHARACTER_PERMISSION_REQUEST_DRAFTS.md`, `docs/CHARACTER_PERMISSION_REQUEST_DRAFTS_doro.md` |
| `scripts` | `scripts/` | 54 | `scripts/__tests__/check-atlas-layout.test.mjs`, `scripts/__tests__/community-pet-maps.test.mjs`, `scripts/__tests__/lint-capabilities.test.mjs` |
| 根级文件 | `/` | 33 | `.editorconfig`, `.env.example`, `.gitattributes` |
| `perf` | `perf/` | 22 | `perf/_helpers.mjs`, `perf/baseline-trend.mjs`, `perf/benchmark-report.mjs` |
| `.githooks` | `.githooks/` | 13 | `.githooks/README.md`, `.githooks/commit-msg`, `.githooks/install.sh` |
| `tests` | `tests/` | 12 | `tests/e2e/README.md`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/app-loading.spec.ts` |
| `public` | `public/` | 7 | `public/characters/doro/pet_conf.json`, `public/characters/feibi/pet_conf.json`, `public/characters/gugugaga/pet_conf.json` |
| `demo` | `demo/` | 3 | `demo/assets/doro/idle.gif`, `demo/assets/feibi/idle.gif`, `demo/spiritpal_preview.html` |
| `.ci` | `.ci/` | 1 | `.ci/security_baseline.json` |
| `character-packs` | `character-packs/` | 1 | `character-packs/feibi/pet.json` |

依赖方向：入口层（应用 / 页面）调用领域层（业务模块），领域层依赖基础设施层（脚本、配置、模型资产）；反向引用不允许。

## 3. 数据流

前端 UI 交互 → Tauri 命令层 → 加密存储与 IPC；移动端走 `src-tauri/gen/android`。

## 4. 外部依赖

| 依赖 | 用途 | 不可用时 |
|---|---|---|
| Node.js / npm | 前端构建 | 无法出包 |
| Rust / Tauri | 桌面壳与命令层 | 无桌面形态 |

## 5. 边界与非目标

- 发布链只走 §10：远端优先、tag 驱动、资产附 `SHA256SUMS.txt`。
- 分发产物由 CI 生成，不入库。
- 不入库：密钥 / token / 口令 / 连接串、本机绝对路径、`local/` 与 `AGENTS.md`、构建产物。
- 治理正文只在 `ReSerendipity/.github/governance`，本仓不复制规则正文。

## 6. 变更影响面

| 改什么 | 必须同步 | 由谁校验 |
|---|---|---|
| 目录结构 / 入口 | 本文「组件与依赖方向」与「数据流」 | 维护者 |
| CI 与门禁 | 本仓 `README.md` 的测试命令；治理仓 §20 远端载体口径 | `audit-drift.py` |
| 依赖清单 | 锁文件与 `.github/dependabot.yml` 的生态段 | Dependabot / `lock-consistency` |
| README 展示图 | §8.1 真实性红线（图必须来自真实运行） | 治理仓 `readme-image-provenance` |

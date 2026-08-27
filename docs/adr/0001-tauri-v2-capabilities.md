**ADR-0001: 采用 Tauri v2 + 最小权限 Capability**

- **状态**: Implemented
- **日期**: 2026-08-27
- **决策者**: 项目维护者 + AI 指挥（家族规范审计更正事实后确认）

---

# 背景与问题

外界/历史文档曾把 SpiritPal 记为 Electron 项目（含 `electron-forge.yml`），
实测为 **Tauri v2** 项目：`@tauri-apps/*` 全家桶、`src-tauri/src/` 下 18 个 `.rs` 文件、
AGENTS.md 提及 Tauri 120 次（Electron 仅 2 次，为对照说明）。本 ADR 固化技术栈事实并记录权限模型决策。

# 评估的备选方案

- **方案 A：宽泛默认权限** —— 各窗口直接授予全量能力，实现简单但越权风险高。
- **方案 B：最小权限 Capability 拆分** —— 按窗口拆分权限（`src-tauri/capabilities/` 下 default / chat-window / settings-window 三个 json），
  实测权限项 **43 / 13 / 41**，全部为 allow 型、**无 deny-* 条目、无 scope**（Tauri v2 无 scope 时 fs 默认全拒）。**采用**。

# 决策

- 技术栈：**Tauri v2**（Rust 内核 18 个 `.rs` + React/TS 前端）。
- 权限：三个 capability 文件按窗口最小权限拆分；fs 权限不配 scope（默认全拒）即"白名单由缺失即拒绝"体现。
- 历史错误表述（Electron、deny-* 条目、"14→35 项"）均已在新版 SECURITY.md 中更正。

# 实施影响

- 数据库：`src-tauri/src/encrypted_db.rs`（SQLx + SQLite）；窗口管理：`src/lib/windowManager.ts`（Rust 侧 `src-tauri/src/system.rs`）。

# 可回滚路径与待验证项

- 权限增加需走 ADR 审查；回滚即还原 capability json 的 git 历史。
- 待验证：`src-tauri/capabilities/` 三文件与 SECURITY.md 数字逐项一致。
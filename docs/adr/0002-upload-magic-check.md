**ADR-0002: 上传文件魔数校验（Rust 签名表 + 前端接线）**

- **状态**: Implemented
- **日期**: 2026-08-27
- **决策者**: 项目维护者 + AI 指挥（安全加固 v1.1 事实）

---

# 背景与问题

聊天上传图片/音频、素材导入与 `.petmod` 模组导入存在**伪装文件**风险（如把 `.exe` 改名 `.png`）。
需在 Rust 侧做纵深防御，前端叠加校验，防止仅靠扩展名判断的安全绕过。

# 评估的备选方案

- **方案 A：仅前端校验** —— 实现简单但可被直接绕过（不经过前端）。
- **方案 B：Rust 端签名表 + 前端混合校验** —— `src-tauri/src/magic_check.rs` 维护 **19 个扩展名、21 条魔数签名**；
  `validate_magic` 读文件头 12 字节与声明扩展名比对，fail-closed。**采用**。

# 决策

- Rust 命令：`validate_upload_magic(contents, file_ext)`（注册于 `src-tauri/src/lib.rs` 的 `generate_handler!`）。
- 前端接线：`src/lib/system/uploadMagic.ts`，已接入 CommunityPanel / GifToSpriteTool / SettingsWindow / SpriteSheetPanel 共 4 处。
- petmod 导入链路：zip 魔数 → SHA-256 → `validate_target_dir` 三层路径校验 → 解压（`enclosed_name` 防 zip slip）→ 结构验证。

# 实施影响

- 未知扩展名（如 .json / .svg）跳过校验以免误伤；非 Tauri 环境跳过不阻断（Rust 端命令本身 fail-closed）。

# 可回滚路径与待验证项

- 回滚：恢复为扩展名白名单判断（不推荐）。
- ~~待验证：`detect_file_kind`（按字节识别媒体类别）为预留 API，尚未暴露为 Tauri 命令。~~
  **已收口（2026-11-06）**：`detect_file_kind` 已暴露为 Tauri 命令 `detect_upload_kind(contents)`
  （`src-tauri/src/commands/window.rs`，注册于 `lib.rs` 两处 `generate_handler!`；桌面端与移动端
  各一份），前端助手为 `src/lib/system/uploadMagic.ts` 的 `detectUploadKind(file)`——返回
  `image | audio | video | archive`，未命中已登记魔数返回 `null`，非 Tauri 环境返回 `null` 由调用方兜底。
  与 `validate_upload_magic` 共用同一张 `MAGIC_SIGNATURES`：前者回答「声明扩展名与内容是否一致」，
  后者回答「内容到底是什么类别」，供拖拽/剪贴板/移动端相册等**没有可靠扩展名**的上传入口使用。
  验证：Rust 单测 3 条（四类别识别、ftyp brand 歧义消解、伪装/空/过短内容不 panic 且返回 None）、
  前端 vitest 5 条（四类别透传、无扩展名照常识别、`null` 收敛、未知标签收敛为 `null`、非 Tauri
  环境不抛错），两侧全 PASS；`cargo check --lib`、`cargo fmt --check`、`npx tsc --noEmit` 均 rc=0。
  **暴露过程中发现并修掉一处真缺陷**：`.m4a` 与 `.mp4/.mov` 的魔数完全相同（偏移 4 处都是
  `ftyp`），原实现按签名表顺序返回首个命中，同一段 mp4 字节会被排在前面的 m4a 规则判成
  `audio`（聊天上传会把视频交给音频分支）。现按偏移 8..12 的 brand 消歧：`M4A `/`M4B `/`M4P `
  为音频，其余（`mp42`/`isom`/`avc1`/`qt  `/`M4V `…）为视频；Rust 单测用 7 个 brand 逐一钉住。

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
- 前端接线：`src/lib/uploadMagic.ts`，已接入 CommunityPanel / GifToSpriteTool / SettingsWindow / SpriteSheetPanel 共 4 处。
- petmod 导入链路：zip 魔数 → SHA-256 → `validate_target_dir` 三层路径校验 → 解压（`enclosed_name` 防 zip slip）→ 结构验证。

# 实施影响

- 未知扩展名（如 .json / .svg）跳过校验以免误伤；非 Tauri 环境跳过不阻断（Rust 端命令本身 fail-closed）。

# 可回滚路径与待验证项

- 回滚：恢复为扩展名白名单判断（不推荐）。
- 待验证：`detect_file_kind`（按字节识别媒体类别）为预留 API，尚未暴露为 Tauri 命令——不得写入现存式承诺。
# SpiritPal Tauri 安全策略与权限说明

## 🔐 Tauri Capability 权限配置说明

### 版本：v1.1 | 最后更新：2026-08-15

> **修订记录**：v1.1（2026-08-15）修正 v1.0（2026-08-11）的文档漂移——原文档声称的
> `fs:deny-home-dir` / `fs:deny-desktop-dir` 等 deny-* 权限、"增加 31 项细化权限、明确禁止 9 个系统目录访问"、
> "default.json 14→35 项"等描述与实际 capability 文件不符（三个文件均无任何 deny-* 条目、无 scope）。
> 本版按实际文件逐项核对重写，并补充此前缺失的魔数（Magic Number）校验现状。

## 🔒 核心原则

本实施遵循 **最小权限原则（Principle of Least Privilege）**，按窗口类型与应用模块拆分 Tauri 插件权限，防止越权访问。

## 📋 权限现状总览（2026-08-15 与 src-tauri/capabilities/ 三文件逐项核对）

| 文件 | 窗口 | 权限项数 | allow-* 项 | deny-* 项 | fs 权限 | scope | shell |
|------|------|---------|-----------|-----------|---------|-------|-------|
| default.json | pet-window（主宠物窗口） | 43 | 35 | 0 | 无 | 无 | 无 |
| chat-window.json | chat-window（聊天窗口） | 13 | 9 | 0 | 无 | 无 | 无 |
| settings-window.json | settings-window（设置窗口） | 41 | 32 | 0 | fs:default + 7 项 fs:allow-* | 无 | 无 |

**重要说明（Tauri v2 权限模型）**：

- 三个 capability 文件的权限**全部为 allow 型，不存在任何 deny-\* 条目**。v1.0 文档声称的 `fs:deny-home-dir` / `fs:deny-desktop-dir` / `fs:deny-documents-dir` / `fs:deny-downloads-dir` / `fs:deny-pictures-dir` 等路径拒绝权限系虚构，实际文件中不存在。
- fs 权限**未配置 scope**（capability 无 scope 字段，`tauri.conf.json` 亦无 fs scope 配置）。Tauri v2 中 fs 插件在无 scope 时**默认拒绝所有路径访问**（即"默认全拒"），因此 settings-window.json 中的 fs:allow-* 实际无法读写任何目录，无需（也不存在）deny 列表来"禁止系统目录"。

### 1️⃣ default.json（pet-window）

**适用范围**：主宠物窗口（常驻桌面），长期运行。

实际 **43 项权限**，全部为 allow 型，无 scope：

- **core:default** + 窗口管理：show / hide / set-focus / create / get-all-windows / start-dragging / start-resize-dragging / set-position / set-size / inner-size / outer-position / outer-size / scale-factor / current-monitor / available-monitors / primary-monitor
- **core:webview:allow-create-webview-window**（v1.0 未提及）
- **store**: default + load / save / get / set / delete / clear（Tauri store 插件持久化配置）
- **sql**: default + execute / close / load（本地 SQLite；注意为 allow-load，并非 v1.0 所写的 "allow-open"）
- **global-shortcut**: default + is-registered / register / unregister
- **notification**: default + request-permission / notify / get-active / register-action-types
- **core:app**: default + name / version
- **core:event:default**、**dialog:default**（v1.0 未提及 dialog:default）

无 fs 权限、无 shell 权限、无 deny 条目、无 scope。
（v1.0 称 "14 项 → 35 项"，实际为 **43 项**；v1.0 称 "Store 严格限定为 $APP/* 目录读写"，capability 中并无此类路径限定表述，本版不再虚构路径白名单。）

### 2️⃣ chat-window.json（chat-window）

**适用范围**：聊天对话窗口。

实际 **13 项权限**，全部为 allow 型，无 scope：

- **core:default** + 窗口基础操作：show / hide / close / set-focus / start-dragging
- **store**: default + load / get（只读，无 save / set / delete / clear）
- **sql**: default + execute
- **notification**: default + notify

**无任何 fs 权限**（前端无法通过 Tauri fs 插件读写文件）、无 shell、无 deny、无 scope。
（v1.0 称 "7 项 → 10 项只读权限"，实际为 **13 项**；"禁止文件系统写入"的结论方向正确，数字已修正。）

### 3️⃣ settings-window.json（settings-window）

**适用范围**：设置面板（模组导入、更新、应用控制）。

实际 **41 项权限**，全部为 allow 型，无 scope：

- **core:default** + 窗口基础操作：show / hide / close / set-focus / start-dragging
- **store**: default + load / save / get / set / delete / clear
- **sql**: default + execute / load / close
- **autostart**: default + enable / is-enabled
- **notification**: default + request-permission / notify
- **updater**: default + check / download-and-install
- **process**: default + restart / exit
- **fs**: default + read-dir / read-file / write-file / exists / mkdir / remove / copy-file（**无 scope**）
- **dialog**: default + open / save / message

**关键事实（修正 v1.0 虚构内容）**：

- **不存在** `fs:deny-home-dir` / `fs:deny-desktop-dir` / `fs:deny-documents-dir` / `fs:deny-downloads-dir` / `fs:deny-pictures-dir`。
- **不存在** `fs:allow-app-data-dir` / `fs:allow-resource-dir`（实际 fs:allow-* 为 7 项通用操作权限：read-dir / read-file / write-file / exists / mkdir / remove / copy-file，且无任何路径限定）。
- 无 scope → Tauri v2 下 fs 插件**默认拒绝所有路径访问**，即"默认全拒"，无需（也不存在）deny 列表。

## 🪄 魔数校验现状（v1.1 新增）

聊天上传图片/音频、素材导入与 .petmod 模组导入存在伪装文件风险（如把 `.exe` 改名 `.png`）。当前实现为 **Rust 端纵深防御 + 前端叠加校验**：

1. **Rust 签名表**（`src-tauri/src/magic_check.rs`）：`MAGIC_SIGNATURES` 共 **19 个扩展名、21 条签名**（`.tif` / `.tiff` 各含 `II*\x00` 与 `MM\x00*` 双魔数），覆盖图片 8（png / jpg / jpeg / gif / bmp / webp / tif / tiff）、音频 5（wav / mp3 / flac / ogg / m4a）、视频 4（mp4 / mov / webm / mkv）、压缩包 2（zip / petmod）。`validate_magic` 读取文件头 12 字节（`HEADER_READ_SIZE`）与声明扩展名比对；扩展名与内容不匹配、未知扩展名、空内容均拒绝（fail-closed）。
2. **Tauri 命令**（`src-tauri/src/lib.rs`）：`validate_upload_magic(contents, file_ext) -> Result<bool, String>`，已注册进 `generate_handler!`（桌面与移动端两处）；不 panic，任何异常归为校验失败并记日志。
3. **前端接线**（`src/lib/uploadMagic.ts`）：`SUPPORTED_MAGIC_EXTENSIONS` 与 Rust 签名表对齐（19 个扩展名），读取文件头 12 字节后 invoke Rust 命令；已接入 **4 处**：`CommunityPanel.tsx:687`（社区面板）、`GifToSpriteTool.tsx:206`（GIF 转精灵）、`SettingsWindow.tsx:341`（设置-模组/素材导入）、`SpriteSheetPanel.tsx:70`（精灵表）。未知扩展名（如 .json / .svg）跳过校验以免误伤合法流程；非 Tauri 环境跳过不阻断（Rust 端命令本身 fail-closed）。
4. **petmod 安装校验**（`src-tauri/src/petmod.rs`）：`import_petmod` 流程中读取文件后先 `validate_magic(".petmod")` 校验 zip 魔数 → SHA-256 → `validate_target_dir` 三层路径校验 → 解压（`enclosed_name` 防 zip slip）→ 结构验证（pet_conf.json 必须存在）。
5. `detect_file_kind`（按字节自动识别媒体类别）为聊天上传自动识别的预留 API，**尚未暴露为 Tauri 命令**。

## 🛡️ 防护效果总结

| 攻击向量 | 风险等级 | 缓解措施 | 状态 |
|---------|---------|---------|------|
| 恶意 petmod 文件注入 | 高 | 魔数校验（zip 签名）+ SHA-256 + zip slip 防护 + 目标目录三层校验 + 结构验证 | ✅ 已缓解 |
| 伪装媒体文件上传 | 高 | Rust 19 扩展名魔数签名表 + `validate_upload_magic` 命令 + 前端 4 处接线 | ✅ 已缓解 |
| 本地文件读取（LFI） | 高 | fs 权限无 scope → 默认全拒；模组/文件目标路径由 Rust 侧 `validate_target_dir` 校验 | ✅ 已缓解 |
| 命令注入 | 中 | 三个 capability 均无 shell 权限 | ✅ 已缓解 |

## ✅ 实施完成（修正后事实）

- 3 个 Capability 文件按最小权限拆分：**43 / 13 / 41 项**，全部为 allow 型。
- 无任何 deny-* 条目、无 scope；Tauri v2 无 scope 语义下 fs 权限默认全拒。
- 新增魔数校验纵深防御：Rust 19 扩展名签名表 + `validate_upload_magic` 命令 + 前端 uploadMagic.ts 4 处接线 + petmod 导入校验。

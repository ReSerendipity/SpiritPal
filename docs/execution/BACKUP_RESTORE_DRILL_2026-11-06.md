# 本地数据备份/恢复实测记录（2026-11-06）

> 依据：评估报告（2026-11-05）门禁 O4「备份恢复定期实测」（⛔P0（绝对），本轮唯一 P0 阻断项）与 top_finding #1——备份已实现（`src-tauri/src/encrypted_db.rs` AES-256-GCM），但 `src-tauri/tests` 与 docs 全仓零恢复实测（`git grep backup_db_at_rest restore_db_backup -- src-tauri/tests` 0 命中）。整改单（2026-11-05 夜）条目 1：补恢复路径的测试或可复核演练记录，并把「下次演练时间与触发人」写进文档。
> 关联：`docs/execution/ROLLBACK_DRILL_2026-10-31.md`（发布回滚域，与本记录互补——那条覆盖「发布清单回滚」，本条覆盖「本地用户数据备份恢复」）；`src-tauri/tests/test_backup_restore.rs`（本轮新增的常驻自动化往返测试）。
> 范围与安全边界：全程在系统临时目录（`%TEMP%/sp-bkrestore-*`）内造合成数据演练；**不触碰**任何真实用户数据目录（app data）、远端仓库、Secrets；不 push。

## 0. 结论速览

| 演练 | 对象 | 结果 | 对平判据 |
|---|---|---|---|
| A 备份→恢复往返（真实加密栈） | `create_backup_in` → `restore_backup_in` → `crypto::decrypt_data` | ✅ 通过（sha256 与逐字节双对平） | 恢复后 sha256 == 原始 `d7a209f5…a9138`，且逐字节一致 |
| B 备份字节一致性 | 备份副本 vs `.enc` 主库 | ✅ 通过（466,149 字节逐字节一致） | 字节相等 |
| C 轮转保留策略 | `rotate_backups_in` | ✅ 通过（5 份 → 保留最新 3 份） | 保留集 == mtime 最新 3 份 |
| D 恢复防护分支 | 路径穿越 / 备份缺失 | ✅ 通过（拒穿越、缺备份报错且不破坏现库） | 错误信息与主库完好性断言 |

## 1. 环境与基线

- 实测时间：2026-11-06 00:31:31 +0800；rustc 1.98.0 (88d9e12ae 2026-08-18)；Windows 10.0.26300 x64。
- 仓库基线：`main` @ `1e7183f`（+ 本轮工作树改动），开工 `git status --porcelain` 0 项脏。
- 被测代码：`src-tauri/src/encrypted_db.rs` 的备份/恢复核心（本轮重构为路径注入版 `create_backup_in` / `restore_backup_in` / `rotate_backups_in` / `list_backup_files_in` / `delete_backup_in`，Tauri 命令包装层 `backup_db_at_rest` / `restore_db_backup` 等签名与行为不变，仅把文件操作核心抽出以便脱离 AppHandle 实测）。
- 加密栈：`crypto::encrypt_data(明文base64, "")` / `crypto::decrypt_data(密文, "")`——空密码即机器 ID 派生密钥（PBKDF2，与生产 `encrypt_db_at_rest` / `decrypt_db_at_rest` 同路径同密钥）。

## 2. 演练 A/B：备份→恢复往返（命令原文与输出）

命令原文：

```bash
cd src-tauri
cargo test --test test_backup_restore -- --nocapture
echo "EXIT_CODE=$?"
```

输出原文（2026-11-06 00:31:31 +0800 实跑，**退出码 0**）：

```
running 9 tests
test test_list_backup_files_empty_when_dir_missing ... ok
test test_create_backup_skips_when_no_enc ... ok
test test_restore_rejects_path_traversal ... ok
test test_restore_missing_backup_errors_without_touching_enc ... ok
test test_delete_backup_removes_target_and_keeps_others ... ok
test test_create_backup_copies_enc_bytes_identically ... ok
test test_restore_replaces_corrupt_enc_with_backup_bytes ... ok
样本: SQLite 形状 262160 字节, sha256=d7a209f54d203b3ed6116c3655c52180bf10019aa136623ae9afa0ee9b7a9138
test test_rotate_keeps_latest_three ... ok
加密落盘: 466149 字节
备份: spiritpal-backup-1793896292.db.enc, 466149 字节
test test_backup_restore_roundtrip_real_crypto ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.06s

EXIT_CODE=0
```

往返六步（测试 `test_backup_restore_roundtrip_real_crypto` 的实际执行序）：

1. **造样本**：SQLite 形状明文 = 真实文件头 `SQLite format 3\0` + 64 页确定性内容，共 **262,160 字节**，sha256 = `d7a209f54d203b3ed6116c3655c52180bf10019aa136623ae9afa0ee9b7a9138`；
2. **加密落盘**：真实 AES-256-GCM 栈（空密码 → 机器 ID 派生）加密后写 `spiritpal.db.enc`，**466,149 字节**；
3. **备份**：`create_backup_in` → `backups/spiritpal-backup-1793896292.db.enc`，**466,149 字节**（对平判据：与 `.enc` 逐字节一致 ✅）；
4. **灾难注入**：主库 `.enc` 被截断损坏为 9 字节垃圾（`CORRUPTED`）；
5. **恢复**：`restore_backup_in`（删现库 → 复制备份）→ 恢复后主库大小 == 备份大小 ✅；
6. **解密对平**：`crypto::decrypt_data`（同密钥）→ base64 解码 → **sha256 与原始一致 ✅ 且 262,160 字节逐字节一致 ✅**，SQLite 文件头保留 ✅。

## 3. 演练 C/D：轮转与防护分支

- **轮转**（`test_rotate_keeps_latest_three`）：5 份合成备份（显式递增 mtime）→ `rotate_backups_in` → 仅保留最新 3 份（`BACKUP_KEEP_COUNT=3`），最旧 2 份被删除 ✅；
- **防路径穿越**（`test_restore_rejects_path_traversal`）：`../evil.enc` / `sub\evil.enc` / `..` / `a/b.enc` 全部拒绝（`备份文件名非法`），且拒绝时主库不被触碰 ✅；
- **备份缺失**（`test_restore_missing_backup_errors_without_touching_enc`）：不存在的备份名 → 报 `备份不存在`，现库字节完好 ✅；
- **损坏库替换**（`test_restore_replaces_corrupt_enc_with_backup_bytes`）：垃圾主库被恢复操作整体替换为备份内容（逐字节一致）✅；
- **删除幂等**（`test_delete_backup_removes_only_target`）：删指定备份、其余保留、重复删除不报错、穿越名拒绝 ✅。

## 4. 与生产路径的对应关系（为什么测试有效）

| 测试调用 | 生产对应 | 说明 |
|---|---|---|
| `crypto::encrypt_data(b64, "")` | `encrypt_db_at_rest_internal` 同函数同参数 | 同一加密函数、同一空密码 → 同一机器 ID 派生密钥 |
| `create_backup_in(data_dir)` | Tauri 命令 `backup_db_at_rest` | 命令层仅做 `get_data_dir` 后委托，核心逻辑同一函数体 |
| `restore_backup_in(data_dir, name)` | Tauri 命令 `restore_db_backup`（经窗口门禁+审计+`sqlite::close` 后委托） | 穿越防护/存在性检查/删旧/复制逻辑同一函数体 |
| `rotate_backups_in` / `list_backup_files_in` / `delete_backup_in` | 同名 Tauri 命令 | 同上 |

测试文件为常驻 CI 资产：`cargo test --test test_backup_restore` 随 Rust Tests（required check）每轮运行，本演练不是一次性留痕而是**可重复执行的恢复实测**。

## 5. 局限（如实自报）

- **UI 层恢复实测未做**：数据管理面板（`DataPanel.tsx`）按钮 → IPC → 命令的界面操作链未在真机 GUI 走查（需真实应用运行与人眼确认）；本记录覆盖命令核心与加密栈整链，UI 薄封装层（`dbBackup.ts` 一行 invoke）未单测。
- **跨机恢复不在范围**：备份与主库同密钥（机器 ID 派生），跨机恢复本设计即不支持（走 `.spiritpal` 导出包通道，`dbBackup.ts` 文件头注），故未测。
- **真实 app data 目录演练未做**：为不触碰真实用户数据，演练全部使用临时目录合成样本；真实目录内的备份/恢复等价性由 §4 路径对应表背书。

## 6. 下次演练安排（写死）

- **节奏**：每季度至少一次，与发布回滚演练节奏（`docs/release-governance.md` §5）对齐。
- **下次到期日**：**2027-02-06**（本次 + 3 个月）。
- **触发人**：**仓库所有者**（当前：ReSerendipity）。agent 会话只做取证与建议，不自行启动涉及真实用户数据的演练。
- **触发方式**：重跑 `cargo test --test test_backup_restore`（命令级），并按 §5 局限项补一次真实 app data 目录或 GUI 层的抽样恢复走查；结果续写本文件或新建 `BACKUP_RESTORE_DRILL_<日期>.md`。

## 7. 本轮改动清单

- 新增 `src-tauri/tests/test_backup_restore.rs`（9 用例，真实加密栈往返）；
- 重构 `src-tauri/src/encrypted_db.rs`：备份/恢复文件操作核心抽为路径注入版 pub 函数（`create_backup_in` / `restore_backup_in` / `rotate_backups_in` / `list_backup_files_in` / `delete_backup_in`），Tauri 命令包装层签名与行为不变；
- 新增本演练记录并接入 `docs/README.md` 索引。

*记录人：ZCode（整改单 2026-11-05 夜 · 条目 1）｜基线 main @ 1e7183f｜完*

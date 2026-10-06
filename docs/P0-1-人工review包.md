# P0-1 人工 Review 包 · 安卓 at-rest 加密/备份链

> **状态**：技术实现已完成、实机验收三项全过——**等待所有者人工 review 签字**（工单硬要求：risk=high 安全/合规项禁止自动合并，本文件即 review 输入）。
> 复验日期：2026-10-07 00:3x ｜ 环境：模拟器 LawnchairApi35，arm64 debug 包（含 VR-10 的 `20088b2`）

## 1. 代码现状（已落地，非本次新增）

`src-tauri/src/lib.rs` **mobile handler**（约 545–553 行）已注册六个命令，注释即修复动机：

```
// R-14: 数据库静态加密（启动解密 / 退出加密；前端 initDB() 与
// encryptDatabaseAtRest() 直接 invoke 这两个命令——移动端此前
// 未注册导致 .enc 无法解密（二次启动数据不可达）与退出加密静默失效）
encrypt_db_at_rest,
decrypt_db_at_rest,
// P1: 本地自动备份
backup_db_at_rest,
list_db_backups,
restore_db_backup,
delete_db_backup,
```

前端调用链：`src/lib/data/db.ts`（`initDB()` → `decrypt_db_at_rest`；`encryptDatabaseAtRest()` → `encrypt_db_at_rest` + `backup_db_at_rest`）。

## 2. 实机验收证据（本次复验采集）

| 工单验收项 | 结果 | 证据 |
|---|---|---|
| 冷启动不抛 decrypt 错 | ✅ | 应用正常启动运行（本轮及此前多轮） |
| 退出加密生成 `spiritpal.db.enc` | ✅ | `encrypt_db_at_rest` invoke 返回 ok；app data 根目录存在 `spiritpal.db.enc`（与 `spiritpal.db`/`-wal`/`-shm` 并存） |
| `backup_db_at_rest` 产出且 `list_db_backups` 非空 | ✅ | backup → `spiritpal-backup-1791304497.db.enc`（546,221 B）；list 返回该条目（name/sizeBytes/modifiedAt 齐全） |

## 3. 需所有者人工确认的两点（合规判断，非技术）

1. **加密策略口径**：当前为「at-rest 文件级加密（AES，退出加密）+ 运行时明文」。检查表 §7 要求的诚实表述已在前端文案落实；请确认该口径符合你的合规预期（vs 更强的运行时加密——需要 SQLCipher 级方案，属新工单）。
2. **备份保留策略**：`list_db_backups` 无自动清理上限，备份文件驻留 app 私有目录（卸载即失）。是否需要轮转上限/导出到用户可见目录，请裁决。

## 4. 结论

技术验收 **PASS**。人工 review 签字后 P0-1 即可关闭（如需改动上述两点，开新工单处理）。

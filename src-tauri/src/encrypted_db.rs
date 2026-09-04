//! R-14: SQLite 数据库文件级加密
//!
//! 在应用关闭时加密数据库文件 (spiritpal.db)，启动时解密。
//! 使用 AES-256-GCM + PBKDF2 密钥派生（复用 crypto.rs 加密栈）。
//!
//! 加密流程：
//! 1. 应用启动 → 调用 decrypt_db_at_rest → 解密 spiritpal.db.enc → spiritpal.db
//! 2. tauri-plugin-sql 正常打开 spiritpal.db
//! 3. 应用关闭 → 调用 encrypt_db_at_rest → 加密 spiritpal.db → spiritpal.db.enc
//! 4. 删除明文 spiritpal.db
//!
//! S2/M0 加固（E1-E3）：
//! - E1: 加密前 WAL checkpoint(TRUNCATE) + 删除 -wal/-shm 明文残留
//! - E2: 先写 .enc.tmp → rename 原子替换 → 再删明文（解密同理）
//! - E3: 退出时机改由 RunEvent::ExitRequested 同步执行（lib.rs 中注册）
//!
//! 安全说明：
//! - 数据库在运行时处于明文状态（与 SQLCipher 的页面级解密一致）
//! - 应用关闭后数据库文件被 AES-256-GCM 加密
//! - 密钥通过 PBKDF2 从机器 ID 派生（100,000 次迭代）

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
// R-14: base64 编解码用于数据库二进制内容
use base64::Engine;

use crate::crypto;

/// 获取数据库文件路径
fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))?;
    Ok(data_dir.join("spiritpal.db"))
}

/// 获取加密数据库文件路径
fn get_encrypted_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))?;
    Ok(data_dir.join("spiritpal.db.enc"))
}

/// E1: WAL checkpoint 后删除 -wal/-shm 残留文件
/// 在加密前调用，确保 WAL 中的最新数据已合并到主库，且无明文残留
fn cleanup_wal_files(db_path: &Path) {
    // 删除 spiritpal.db-wal（WAL 文件，可能含明文数据）
    let wal_path = db_path.with_extension("db-wal");
    if wal_path.exists() {
        let _ = fs::remove_file(&wal_path);
        log::debug!("[encrypted_db] Cleaned up WAL file: {}", wal_path.display());
    }
    // 删除 spiritpal.db-shm（共享内存文件，WAL 模式的索引）
    let shm_path = db_path.with_extension("db-shm");
    if shm_path.exists() {
        let _ = fs::remove_file(&shm_path);
        log::debug!("[encrypted_db] Cleaned up SHM file: {}", shm_path.display());
    }
}

/// E2: 原子写入——先写临时文件，再 rename 替换目标文件
/// 确保中途崩溃不会留下半份损坏文件
fn atomic_write(target: &PathBuf, content: &[u8]) -> Result<(), String> {
    let tmp_path = target.with_extension("tmp");
    // 写入临时文件
    fs::write(&tmp_path, content).map_err(|e| format!("写入临时文件失败: {}", e))?;
    // 原子重命名（在同一文件系统上 rename 是原子的）
    fs::rename(&tmp_path, target).map_err(|e| {
        // rename 失败时清理临时文件
        let _ = fs::remove_file(&tmp_path);
        format!("原子重命名失败: {}", e)
    })
}

/// V-1 修复：带重试的文件删除（Windows 上 SQLite 连接关闭后文件锁可能需要几毫秒释放）
fn remove_file_with_retry(path: &PathBuf, max_retries: u32) -> Result<(), String> {
    for attempt in 0..max_retries {
        match fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                log::debug!(
                    "[encrypted_db] File locked (attempt {}/{}), retrying in 100ms...",
                    attempt + 1,
                    max_retries
                );
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(format!("删除文件失败: {}", e)),
        }
    }
    Err(format!(
        "文件被锁定，重试 {} 次后仍无法删除: {}",
        max_retries,
        path.display()
    ))
}

/// R-14: 加密数据库文件（应用关闭时调用）
///
/// S2/M0 加固：
/// - E1: WAL checkpoint(TRUNCATE) 通过 tauri-plugin-sql 在前端执行
///       此处负责删除 -wal/-shm 残留文件
/// - E2: 先写 .enc.tmp → rename 原子替换 → 再删明文
///
/// V-1 修复：
/// - 增加文件读取重试（Windows 上 SQLite 连接关闭后文件锁释放有延迟）
/// - 增加明文删除重试（同上）
/// - 加密失败时保留明文（不删除），避免数据丢失
///
/// 读取 spiritpal.db 明文，使用 AES-256-GCM 加密，写入 spiritpal.db.enc
/// 加密成功后删除明文 spiritpal.db
/// 命令包装层：门禁 + 委托内部实现（Tauri 不支持 Option<Window> 注入，故拆两层）
#[tauri::command]
pub async fn encrypt_db_at_rest(window: tauri::Window, app: AppHandle) -> Result<bool, String> {
    // D-2: 来自 WebView 的调用必须来自应用窗口
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    encrypt_db_at_rest_internal(app).await
}

/// 内部实现：无窗口门禁（供退出钩子等 Rust 内部路径调用）
pub async fn encrypt_db_at_rest_internal(app: AppHandle) -> Result<bool, String> {
    // D-1: 关闭 rusqlite 连接，避免文件锁导致 fs::read 失败/残留
    crate::sqlite::close();
    let db_path = get_db_path(&app)?;
    let enc_path = get_encrypted_db_path(&app)?;

    // 如果明文数据库不存在，无需加密
    if !db_path.exists() {
        log::debug!("[encrypted_db] Database file not found, skipping encryption");
        return Ok(false);
    }

    // E1: 删除 WAL/SHM 残留文件（WAL checkpoint 应已在前端执行）
    cleanup_wal_files(&db_path);

    // V-1: 带重试的文件读取（Windows 上 SQLite 连接关闭后文件锁释放有延迟）
    let content = {
        let mut last_err = String::new();
        let mut result: Option<Vec<u8>> = None;
        for attempt in 0..5u32 {
            match fs::read(&db_path) {
                Ok(data) => {
                    result = Some(data);
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                    log::debug!(
                        "[encrypted_db] DB file locked (attempt {}/5), retrying in 100ms...",
                        attempt + 1
                    );
                    last_err = format!("文件被锁定: {}", e);
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(e) => {
                    return Err(format!("读取数据库失败: {}", e));
                }
            }
        }
        match result {
            Some(data) => data,
            None => {
                return Err(format!(
                    "读取数据库失败（重试 5 次后仍被锁定）: {}",
                    last_err
                ))
            }
        }
    };

    // 转为 base64 用于加密（encrypt_data 接受 String）
    let content_b64 = base64::engine::general_purpose::STANDARD.encode(&content);

    // 使用空密码（内部使用机器 ID 派生）
    let encrypted = crypto::encrypt_data(content_b64, String::new()).await?;

    // E2: 原子写入加密文件（先写 .tmp → rename → 再删明文）
    if let Some(parent) = enc_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    atomic_write(&enc_path, encrypted.as_bytes())?;

    // V-1: 带重试的明文删除（Windows 上文件锁释放有延迟）
    remove_file_with_retry(&db_path, 5)?;

    // E1: 再次清理（确保无残留）
    cleanup_wal_files(&db_path);

    log::info!(
        "[encrypted_db] Database encrypted at rest: {}",
        enc_path.display()
    );
    Ok(true)
}

/// R-14: 解密数据库文件（应用启动时调用）
///
/// S2/M0 加固：
/// - E2: 先写 .db.tmp → rename 原子替换
///
/// 读取 spiritpal.db.enc 密文，使用 AES-256-GCM 解密，写入 spiritpal.db
/// 解密成功后删除加密文件
/// 命令包装层：门禁 + 委托内部实现
#[tauri::command]
pub async fn decrypt_db_at_rest(window: tauri::Window, app: AppHandle) -> Result<bool, String> {
    // D-2: 来自 WebView 的调用必须来自应用窗口
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    decrypt_db_at_rest_internal(app).await
}

/// 内部实现：无窗口门禁
pub async fn decrypt_db_at_rest_internal(app: AppHandle) -> Result<bool, String> {
    // D-1: 关闭 rusqlite 连接，避免覆盖明文文件时被锁
    crate::sqlite::close();
    let db_path = get_db_path(&app)?;
    let enc_path = get_encrypted_db_path(&app)?;

    // 如果加密文件不存在，检查明文数据库是否存在
    if !enc_path.exists() {
        if db_path.exists() {
            log::debug!("[encrypted_db] Encrypted DB not found, plaintext exists — first run or already decrypted");
            return Ok(false);
        }
        log::debug!("[encrypted_db] No database file found — first run");
        return Ok(false);
    }

    // 读取加密文件
    let encrypted =
        fs::read_to_string(&enc_path).map_err(|e| format!("读取加密数据库失败: {}", e))?;

    // 解密
    let decrypted_b64 = crypto::decrypt_data(encrypted, String::new()).await?;

    // 解码 base64 还原二进制
    let content = base64::engine::general_purpose::STANDARD
        .decode(decrypted_b64)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    // E2: 原子写入明文数据库（先写 .tmp → rename）
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    atomic_write(&db_path, &content)?;

    // 删除加密文件
    fs::remove_file(&enc_path).ok();

    // E1: 清理可能残留的 WAL/SHM 文件
    cleanup_wal_files(&db_path);

    log::info!("[encrypted_db] Database decrypted: {}", db_path.display());
    Ok(true)
}

// ============ 自动备份（P1：无云端备份下的本地 durability）============
// 备份对象为「加密后的 spiritpal.db.enc」，位于 app data 目录 backups/ 下，
// 与主库同密钥（同机可恢复；跨机恢复需使用 .spiritpal 导出包）。
// 保留最近 BACKUP_KEEP_COUNT 份，按修改时间轮转。

/// 备份保留份数
const BACKUP_KEEP_COUNT: usize = 3;

/// 备份目录名
const BACKUP_DIR_NAME: &str = "backups";

/// 备份文件信息（供前端 UI 列示）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DBBackupInfo {
    pub name: String,
    pub size_bytes: u64,
    pub modified_at: u64,
}

/// 获取备份目录路径
fn get_backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {e}"))?;
    Ok(data_dir.join(BACKUP_DIR_NAME))
}

/// 备份文件名（时间戳到秒，唯一）
fn backup_filename() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("spiritpal-backup-{now}.db.enc")
}

/// 列出全部备份（按修改时间倒序）
fn list_backup_files(app: &AppHandle) -> Result<Vec<DBBackupInfo>, String> {
    let dir = get_backup_dir(app)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut items: Vec<DBBackupInfo> = vec![];
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("读取备份目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("遍历备份目录失败: {e}"))?;
        let meta = entry
            .metadata()
            .map_err(|e| format!("读取备份元数据失败: {e}"))?;
        if meta.is_file() {
            let modified_at = meta
                .modified()
                .map(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64
                })
                .unwrap_or(0);
            items.push(DBBackupInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                size_bytes: meta.len(),
                modified_at,
            });
        }
    }
    items.sort_by_key(|a| std::cmp::Reverse(a.modified_at));
    Ok(items)
}

/// 轮转：只保留最新的 BACKUP_KEEP_COUNT 份
fn rotate_backups(app: &AppHandle) -> Result<(), String> {
    let dir = get_backup_dir(app)?;
    let items = list_backup_files(app)?;
    if items.len() <= BACKUP_KEEP_COUNT {
        return Ok(());
    }
    for old in &items[BACKUP_KEEP_COUNT..] {
        let _ = std::fs::remove_file(dir.join(&old.name));
    }
    Ok(())
}

/// 自动备份：把加密库文件复制到 backups/ 并轮转（应用关闭加密完成后调用）
#[tauri::command]
pub async fn backup_db_at_rest(app: AppHandle) -> Result<Option<String>, String> {
    let enc_path = get_encrypted_db_path(&app)?;
    if !enc_path.exists() {
        // 无加密库（首次运行/未加密）则静默跳过
        return Ok(None);
    }
    let backup_dir = get_backup_dir(&app)?;
    std::fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {e}"))?;

    let name = backup_filename();
    let target = backup_dir.join(&name);
    std::fs::copy(&enc_path, &target).map_err(|e| format!("复制备份失败: {e}"))?;

    rotate_backups(&app)?;
    log::info!("[encrypted_db] Auto backup created: {}", target.display());
    Ok(Some(name))
}

/// 列出全部可用备份（前端 UI 展示:名称/大小/时间）
#[tauri::command]
pub async fn list_db_backups(app: AppHandle) -> Result<Vec<DBBackupInfo>, String> {
    list_backup_files(&app)
}

/// 从指定备份恢复：备份文件（合法备份即 spiritpal.db.enc 的副本）覆盖加密库
/// 恢复后需重启应用（下次启动 decrypt_db_at_rest 会解出明文库）。
/// 命令包装层：门禁 + 审计 + 委托内部实现
#[tauri::command]
pub async fn restore_db_backup(
    window: tauri::Window,
    app: AppHandle,
    name: String,
) -> Result<(), String> {
    // D-2: 恢复属高敏文件操作，仅应用窗口调用
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    restore_db_backup_internal(app, name).await
}

/// 内部实现：无窗口门禁
async fn restore_db_backup_internal(app: AppHandle, name: String) -> Result<(), String> {
    let _ = crate::audit_log::record_audit(
        &app,
        "data_restore",
        "user",
        &format!("restore_db_backup: {name}"),
    );
    // D-1: 关闭 rusqlite 连接，避免恢复覆盖时文件被锁
    crate::sqlite::close();
    // 防路径穿越：只允许 backups 目录内的文件名
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("备份文件名非法".into());
    }
    let backup_dir = get_backup_dir(&app)?;
    let src = backup_dir.join(&name);
    // 备份文件即使存在也需确认（不读了再写，避免损坏源）
    if !src.exists() {
        return Err(format!("备份不存在: {name}"));
    }

    // 恢复前先移除当前加密库（若存在），再复制（避免旧库残留被新库覆盖时同文件 io 冲突）
    let enc_path = get_encrypted_db_path(&app)?;
    if enc_path.exists() {
        std::fs::remove_file(&enc_path).map_err(|e| format!("移除当前加密库失败: {e}"))?;
    }
    std::fs::copy(&src, &enc_path).map_err(|e| format!("恢复备份失败: {e}"))?;
    log::warn!("[encrypted_db] Database restored from backup: {name}");
    Ok(())
}

/// 删除指定备份
#[tauri::command]
pub async fn delete_db_backup(app: AppHandle, name: String) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("备份文件名非法".into());
    }
    let dir = get_backup_dir(&app)?;
    let target = dir.join(&name);
    if target.exists() {
        std::fs::remove_file(&target).map_err(|e| format!("删除备份失败: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use base64::Engine;

    // ============ Base64 往返测试（模拟 encrypt_db_at_rest / decrypt_db_at_rest 数据流）============

    #[test]
    fn test_db_base64_roundtrip_binary() {
        // 模拟数据库文件内容（二进制数据）
        let original: Vec<u8> = (0..=255).collect();
        // 模拟 encrypt_db_at_rest 中的编码步骤
        let encoded = base64::engine::general_purpose::STANDARD.encode(&original);
        // 模拟 decrypt_db_at_rest 中的解码步骤
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_db_base64_roundtrip_empty() {
        let original: Vec<u8> = vec![];
        let encoded = base64::engine::general_purpose::STANDARD.encode(&original);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_db_base64_roundtrip_sqlite_header() {
        // SQLite 文件以 "SQLite format 3\0" 开头
        let original = b"SQLite format 3\x00test database content";
        let encoded = base64::engine::general_purpose::STANDARD.encode(original);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, original);
        // 验证 SQLite 头部特征保留
        assert_eq!(&decoded[0..16], b"SQLite format 3\x00");
    }

    #[test]
    fn test_db_base64_roundtrip_large() {
        // 模拟较大的数据库文件（1MB）
        let original: Vec<u8> = (0..1024 * 1024).map(|i| (i % 256) as u8).collect();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&original);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, original);
    }

    // ============ S2/M0: 原子写入测试 ============
    use std::fs;

    #[test]
    fn test_atomic_write_creates_target() {
        // 创建临时目录
        let tmp_dir = std::env::temp_dir().join("spiritpal_test_atomic_write");
        let _ = fs::create_dir_all(&tmp_dir);
        let target = tmp_dir.join("target.enc");
        let _ = fs::remove_file(&target); // 清理之前可能残留的

        // 调用 atomic_write
        let content = b"test content for atomic write";
        super::atomic_write(&target, content).unwrap();

        // 验证目标文件存在且内容正确
        assert!(target.exists());
        let read_content = fs::read(&target).unwrap();
        assert_eq!(read_content, content);

        // 验证临时文件已被清理
        let tmp_file = target.with_extension("tmp");
        assert!(!tmp_file.exists());

        // 清理
        let _ = fs::remove_file(&target);
        let _ = fs::remove_dir(&tmp_dir);
    }

    #[test]
    fn test_atomic_write_overwrites_existing() {
        let tmp_dir = std::env::temp_dir().join("spiritpal_test_atomic_overwrite");
        let _ = fs::create_dir_all(&tmp_dir);
        let target = tmp_dir.join("overwrite.enc");

        // 先写入旧内容
        fs::write(&target, b"old content").unwrap();

        // 用原子写入覆盖
        let new_content = b"new content that replaces old";
        super::atomic_write(&target, new_content).unwrap();

        // 验证内容已更新
        let read_content = fs::read(&target).unwrap();
        assert_eq!(read_content, new_content);

        // 清理
        let _ = fs::remove_file(&target);
        let _ = fs::remove_dir(&tmp_dir);
    }
}

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
use std::path::PathBuf;
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
fn cleanup_wal_files(db_path: &PathBuf) {
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

/// R-14: 加密数据库文件（应用关闭时调用）
///
/// S2/M0 加固：
/// - E1: WAL checkpoint(TRUNCATE) 通过 tauri-plugin-sql 在前端执行
///       此处负责删除 -wal/-shm 残留文件
/// - E2: 先写 .enc.tmp → rename 原子替换 → 再删明文
///
/// 读取 spiritpal.db 明文，使用 AES-256-GCM 加密，写入 spiritpal.db.enc
/// 加密成功后删除明文 spiritpal.db
#[tauri::command]
pub async fn encrypt_db_at_rest(app: AppHandle) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let enc_path = get_encrypted_db_path(&app)?;

    // 如果明文数据库不存在，无需加密
    if !db_path.exists() {
        log::debug!("[encrypted_db] Database file not found, skipping encryption");
        return Ok(false);
    }

    // E1: 删除 WAL/SHM 残留文件（WAL checkpoint 应已在前端执行）
    cleanup_wal_files(&db_path);

    // 读取数据库文件
    let content = fs::read(&db_path).map_err(|e| format!("读取数据库失败: {}", e))?;

    // 转为 base64 用于加密（encrypt_data 接受 String）
    let content_b64 = base64::engine::general_purpose::STANDARD.encode(&content);

    // 使用空密码（内部使用机器 ID 派生）
    let encrypted = crypto::encrypt_data(content_b64, String::new()).await?;

    // E2: 原子写入加密文件（先写 .tmp → rename → 再删明文）
    if let Some(parent) = enc_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    atomic_write(&enc_path, encrypted.as_bytes())?;

    // 删除明文数据库
    fs::remove_file(&db_path).map_err(|e| format!("删除明文数据库失败: {}", e))?;

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
#[tauri::command]
pub async fn decrypt_db_at_rest(app: AppHandle) -> Result<bool, String> {
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

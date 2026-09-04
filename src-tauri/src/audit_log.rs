//! H-4: 安全审计日志模块
//!
//! 记录安全相关事件（权限变更 / 模组导入 / 加密操作 / 数据导出等），
//! 写入独立的审计日志文件 `spiritpal_audit.log`，追加模式写入。
//!
//! # 防篡改设计
//! - 每条日志包含前一条日志的 SHA-256 哈希（哈希链）
//! - 首条日志的 prev_hash = "GENESIS"
//! - 哈希链断裂 = 日志被篡改或删除
//!
//! # 日志格式
//! ```text
//! [ISO8601] [LEVEL] [EVENT_TYPE] [ACTOR] message | prev_hash=xxx | this_hash=yyy
//! ```
//!
//! # 提供的 Tauri 命令
//! - [`audit_log`] — 记录安全审计事件

use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// 审计日志文件名
const AUDIT_LOG_FILENAME: &str = "spiritpal_audit.log";
/// 轮转时保留的上一份文件名（超出上限后当前文件改名为该文件，从头写新文件）
const AUDIT_LOG_BACKUP_FILENAME: &str = "spiritpal_audit.old.log";
/// 单文件大小上限（P1-04：常驻应用审计日志无轮转会无限增长占满磁盘；5MB 后轮转保留一份旧档）
const AUDIT_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// 全局哈希链状态（上次写入的哈希）
static LAST_HASH: Mutex<Option<String>> = Mutex::new(None);

/// 获取审计日志文件路径
fn get_audit_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))?;
    Ok(data_dir.join(AUDIT_LOG_FILENAME))
}

/// 读取现有审计日志的最后一行哈希（用于初始化哈希链）
fn init_hash_chain(log_path: &PathBuf) {
    let mut last_hash = LAST_HASH.lock().unwrap();
    if last_hash.is_some() {
        return; // 已初始化
    }

    if !log_path.exists() {
        *last_hash = Some("GENESIS".to_string());
        return;
    }

    // 读取最后一行，提取 this_hash
    match fs::read_to_string(log_path) {
        Ok(content) => {
            if let Some(last_line) = content.lines().last() {
                if let Some(hash) = extract_hash(last_line, "this_hash") {
                    *last_hash = Some(hash);
                    return;
                }
            }
            // 无法提取哈希 → 重置为 GENESIS（日志可能被篡改）
            log::warn!(
                "[Audit] Failed to extract hash from last audit log line — chain may be broken"
            );
            *last_hash = Some("GENESIS".to_string());
        }
        Err(_) => {
            *last_hash = Some("GENESIS".to_string());
        }
    }
}

/// 从日志行中提取指定哈希字段
fn extract_hash(line: &str, field: &str) -> Option<String> {
    let marker = format!("{}=", field);
    line.split('|')
        .map(|s| s.trim())
        .find(|s| s.starts_with(&marker))
        .map(|s| s[marker.len()..].trim().to_string())
}

/// 计算审计日志条目的哈希
fn compute_entry_hash(
    timestamp: &str,
    level: &str,
    event_type: &str,
    actor: &str,
    message: &str,
    prev_hash: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(timestamp.as_bytes());
    hasher.update(b"|");
    hasher.update(level.as_bytes());
    hasher.update(b"|");
    hasher.update(event_type.as_bytes());
    hasher.update(b"|");
    hasher.update(actor.as_bytes());
    hasher.update(b"|");
    hasher.update(message.as_bytes());
    hasher.update(b"|");
    hasher.update(prev_hash.as_bytes());
    let result = hasher.finalize();
    crate::crypto::sha256_to_hex(&result)
}

/// 单文件大小轮转：当前文件超限时，删除上一份备份，将当前文件改名保留（P1-04）
///
/// 哈希链连续性：轮转只改文件名，内存中 [`LAST_HASH`] 仍是旧链尾，
/// 新文件首条日志的 `prev_hash` 仍引用旧链尾 → 跨文件哈希链不断裂。
fn rotate_audit_if_needed(log_path: &std::path::Path, max_bytes: u64) {
    let meta = match std::fs::metadata(log_path) {
        Ok(m) => m,
        Err(_) => return, // 文件不存在 → 无需轮转
    };
    if meta.len() < max_bytes {
        return;
    }
    let backup = log_path.with_file_name(AUDIT_LOG_BACKUP_FILENAME);
    if backup.exists() {
        let _ = std::fs::remove_file(&backup); // 只保留一份旧档
    }
    if let Err(e) = std::fs::rename(log_path, &backup) {
        log::error!("[Audit] 日志轮转失败（保留旧档）: {}", e);
    } else {
        log::info!(
            "[Audit] 审计日志已达 {} 字节，已轮转到 {}",
            max_bytes,
            AUDIT_LOG_BACKUP_FILENAME
        );
    }
}

/// 记录安全审计事件（Tauri 命令）
///
/// 前端调用方式：`invoke('audit_log', { eventType: string, actor: string, message: string })`
///
/// # Arguments
/// - `app` — Tauri 应用句柄（自动注入）
/// - `event_type` — 事件类型（如 "settings_change" / "mod_import" / "encryption" / "data_export"）
/// - `actor` — 操作者（如 "user" / "system" / "ai_agent"）
/// - `message` — 事件描述
///
/// # Returns
/// - `Ok(())` — 审计日志写入成功
/// - `Err(String)` — 文件写入失败
#[tauri::command]
pub async fn audit_log(
    app: AppHandle,
    event_type: String,
    actor: String,
    message: String,
) -> Result<(), String> {
    record_audit(&app, &event_type, &actor, &message)
}

/// 同步写入一条审计日志（供命令与高危命令内部共用）
///
/// P1-07：`execute_command` / `take_screenshot` 等高危命令在非 async 分支
/// 或 spawn_blocking 内也能直接调用本函数完成审计，无需经前端。
pub fn record_audit(
    app: &AppHandle,
    event_type: &str,
    actor: &str,
    message: &str,
) -> Result<(), String> {
    let log_path = get_audit_log_path(app)?;

    // 确保目录存在
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建审计日志目录失败: {}", e))?;
    }

    // P1-04: 写入前轮转检查（防止常驻应用审计日志无限增长）
    rotate_audit_if_needed(&log_path, AUDIT_MAX_BYTES);

    // 初始化哈希链（首次调用时）
    init_hash_chain(&log_path);

    // 生成 ISO8601 时间戳
    let now = chrono::Utc::now();
    let timestamp = now.to_rfc3339();

    // 获取前一条日志的哈希
    let prev_hash = {
        let guard = LAST_HASH.lock().unwrap();
        guard.clone().unwrap_or_else(|| "GENESIS".to_string())
    };

    // 计算本条日志的哈希
    let this_hash = compute_entry_hash(&timestamp, "AUDIT", event_type, actor, message, &prev_hash);

    // 格式化日志行
    let entry = format!(
        "[{}] [AUDIT] [{}] [{}] {} | prev_hash={} | this_hash={}\n",
        timestamp, event_type, actor, message, prev_hash, this_hash
    );

    // 追加写入（append 模式 — 不覆盖已有内容）
    let mut file = OpenOptions::new()
        .append(true)
        .create(true)
        .open(&log_path)
        .map_err(|e| format!("打开审计日志文件失败: {}", e))?;

    file.write_all(entry.as_bytes())
        .map_err(|e| format!("写入审计日志失败: {}", e))?;
    file.flush()
        .map_err(|e| format!("刷新审计日志失败: {}", e))?;

    // 更新哈希链
    {
        let mut guard = LAST_HASH.lock().unwrap();
        *guard = Some(this_hash);
    }

    // 同时输出到普通日志（方便排查）
    log::info!(
        "[Audit] event={} actor={} message={}",
        event_type,
        actor,
        message
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rotate_when_over_limit() {
        let dir = std::env::temp_dir().join(format!("spiritpal_audit_rot_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let data = std::path::Path::new(&dir).join("spiritpal_audit.log");

        std::fs::write(&data, "x".repeat(100)).unwrap();
        rotate_audit_if_needed(&data, 50); // 100 > 50 → 触发轮转
        assert!(!data.exists(), "超限后应轮到新文件（当前文件消失）");
        assert!(
            data.with_file_name(AUDIT_LOG_BACKUP_FILENAME).exists(),
            "旧档应保留"
        );

        // 备份覆盖：再次写满并轮转，仍只保留一份旧档
        std::fs::write(&data, "y".repeat(100)).unwrap();
        rotate_audit_if_needed(&data, 50);
        assert!(!data.exists());
        let backup = data.with_file_name(AUDIT_LOG_BACKUP_FILENAME);
        assert!(backup.exists());
        let content = std::fs::read_to_string(&backup).unwrap();
        assert!(content.starts_with("y"), "旧档应为最近一次轮转内容");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_no_rotate_under_limit() {
        let dir =
            std::env::temp_dir().join(format!("spiritpal_audit_norot_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let data = std::path::Path::new(&dir).join("spiritpal_audit.log");

        std::fs::write(&data, "abc").unwrap();
        rotate_audit_if_needed(&data, 100); // 3 < 100 → 不轮转
        assert!(data.exists());
        assert!(!data.with_file_name(AUDIT_LOG_BACKUP_FILENAME).exists());

        // 文件不存在 → 安静返回
        rotate_audit_if_needed(&data.with_extension("nope"), 100);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_extract_hash_from_line() {
        let line = "[2026-08-26T10:00:00Z] [AUDIT] [test] [system] test message | prev_hash=GENESIS | this_hash=abc123";
        assert_eq!(extract_hash(line, "prev_hash"), Some("GENESIS".to_string()));
        assert_eq!(extract_hash(line, "this_hash"), Some("abc123".to_string()));
        assert_eq!(extract_hash(line, "nonexistent"), None);
    }

    #[test]
    fn test_extract_hash_no_hash() {
        let line = "[2026-08-26T10:00:00Z] [AUDIT] [test] [system] test message";
        assert_eq!(extract_hash(line, "prev_hash"), None);
    }

    #[test]
    fn test_compute_entry_hash_deterministic() {
        let h1 = compute_entry_hash(
            "2026-08-26T10:00:00Z",
            "AUDIT",
            "test",
            "system",
            "hello",
            "GENESIS",
        );
        let h2 = compute_entry_hash(
            "2026-08-26T10:00:00Z",
            "AUDIT",
            "test",
            "system",
            "hello",
            "GENESIS",
        );
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_entry_hash_different_input() {
        let h1 = compute_entry_hash(
            "2026-08-26T10:00:00Z",
            "AUDIT",
            "test",
            "system",
            "hello",
            "GENESIS",
        );
        let h2 = compute_entry_hash(
            "2026-08-26T10:00:00Z",
            "AUDIT",
            "test",
            "system",
            "world",
            "GENESIS",
        );
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_compute_entry_hash_different_prev() {
        let h1 = compute_entry_hash(
            "2026-08-26T10:00:00Z",
            "AUDIT",
            "test",
            "system",
            "hello",
            "GENESIS",
        );
        let h2 = compute_entry_hash(
            "2026-08-26T10:00:00Z",
            "AUDIT",
            "test",
            "system",
            "hello",
            "abc123",
        );
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_hash_chain_integrity() {
        // 模拟哈希链：3 条日志，每条引用前一条的哈希
        let genesis = "GENESIS";

        let hash1 = compute_entry_hash("t1", "AUDIT", "event1", "system", "msg1", genesis);
        let hash2 = compute_entry_hash("t2", "AUDIT", "event2", "system", "msg2", &hash1);
        let hash3 = compute_entry_hash("t3", "AUDIT", "event3", "system", "msg3", &hash2);

        // 链完整性验证：每条哈希包含前一条
        assert_ne!(hash1, hash2);
        assert_ne!(hash2, hash3);
        assert_ne!(hash1, hash3);

        // 篡改检测：修改 msg1 后 hash1 变化 → hash2 应不同
        let hash1_tampered =
            compute_entry_hash("t1", "AUDIT", "event1", "system", "TAMPERED", genesis);
        assert_ne!(hash1, hash1_tampered);
        // hash2 基于 hash1 → hash1_tampered 导致 hash2 也不同
        let hash2_from_tampered =
            compute_entry_hash("t2", "AUDIT", "event2", "system", "msg2", &hash1_tampered);
        assert_ne!(hash2, hash2_from_tampered);
    }
}

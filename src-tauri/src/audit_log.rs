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
            log::warn!("[Audit] Failed to extract hash from last audit log line — chain may be broken");
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
fn compute_entry_hash(timestamp: &str, level: &str, event_type: &str, actor: &str, message: &str, prev_hash: &str) -> String {
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
    let log_path = get_audit_log_path(&app)?;

    // 确保目录存在
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建审计日志目录失败: {}", e))?;
    }

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
    let this_hash = compute_entry_hash(
        &timestamp,
        "AUDIT",
        &event_type,
        &actor,
        &message,
        &prev_hash,
    );

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
    fn test_extract_hash_from_line() {
        let line = "[2026-08-26T10:00:00Z] [AUDIT] [test] [system] test message | prev_hash=GENESIS | this_hash=abc123";
        assert_eq!(extract_hash(line, "prev_hash"), Some("GENESIS".to_string()));
        assert_eq!(
            extract_hash(line, "this_hash"),
            Some("abc123".to_string())
        );
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
        let hash1_tampered = compute_entry_hash("t1", "AUDIT", "event1", "system", "TAMPERED", genesis);
        assert_ne!(hash1, hash1_tampered);
        // hash2 基于 hash1 → hash1_tampered 导致 hash2 也不同
        let hash2_from_tampered = compute_entry_hash("t2", "AUDIT", "event2", "system", "msg2", &hash1_tampered);
        assert_ne!(hash2, hash2_from_tampered);
    }
}

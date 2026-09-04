//! P1-05: 运行时日志级别（对应审计 LOG-04「日志级别硬编码、需重新编译」修复）
//!
//! # 原理
//! tauri-plugin-log 内部使用 fern::Dispatch，其 `.level()` 在 build 后不可运行时修改，
//! 因此本模块采用「**插件全开 + log crate 全局 `max_level()` 闸门**」方案：
//! - 插件 builder 固定 `LevelFilter::Debug`（保证 fern 不会拒绝低级记录）
//! - 是否输出某条日志由 `log::set_max_level()` 决定（log 宏在记录前校验全局 max_level）
//! - 启动时（setup）按持久化配置或构建类型施加默认级别；之后可由用户运行时调整
//!
//! # 持久化
//! 级别写入 `{app_data_dir}/log-level.json`，格式：`{"level":"info"}`。
//! 该文件不影响隐私承诺（本地文件，数据不出设备）。

use serde_json::json;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// 持久化文件名
const LOG_LEVEL_FILE: &str = "log-level.json";

/// 当前生效级别（启动后由 [apply_boot_level] 初始化）
static CURRENT_LEVEL: Mutex<Option<log::LevelFilter>> = Mutex::new(None);

/// 解析级别字符串（大小写不敏感）
fn parse_level(s: &str) -> Option<log::LevelFilter> {
    match s.to_ascii_lowercase().as_str() {
        "off" => Some(log::LevelFilter::Off),
        "error" => Some(log::LevelFilter::Error),
        "warn" | "warning" => Some(log::LevelFilter::Warn),
        "info" => Some(log::LevelFilter::Info),
        "debug" => Some(log::LevelFilter::Debug),
        "trace" => Some(log::LevelFilter::Trace),
        _ => None,
    }
}

/// 级别名（与 [parse_level] 双向一致）
fn level_name(l: log::LevelFilter) -> &'static str {
    match l {
        log::LevelFilter::Off => "off",
        log::LevelFilter::Error => "error",
        log::LevelFilter::Warn => "warn",
        log::LevelFilter::Info => "info",
        log::LevelFilter::Debug => "debug",
        log::LevelFilter::Trace => "trace",
    }
}

/// 级别配置文件路径
fn level_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))?;
    Ok(dir.join(LOG_LEVEL_FILE))
}

/// 立即应用级别（全局闸门 + 记录当前值）
fn apply_level(l: log::LevelFilter) {
    let mut guard = CURRENT_LEVEL.lock().unwrap();
    *guard = Some(l);
    drop(guard);
    log::set_max_level(l);
}

/// 启动时应用的默认级别：持久化配置 > 构建类型默认（dev=Debug / release=Info）
///
/// 在 run() 的 setup 回调中调用一次；无持久化配置时按构建类型设默认，
/// 保证 release 构建不输出调试信息（审计 LOG-04 的核心诉求）。
pub fn apply_boot_level(app: &tauri::AppHandle) {
    // 1) 持久化配置优先
    if let Ok(path) = level_file(app) {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&raw) {
                let level_str = config.get("level").and_then(|s| s.as_str());
                if let Some(l) = level_str.and_then(parse_level) {
                    apply_level(l);
                    log::info!(
                        "[LogLevel] 已按持久化配置应用日志级别: {}",
                        level_name(l)
                    );
                    return;
                }
            }
        }
    }

    // 2) 构建类型默认
    #[cfg(debug_assertions)]
    let default = log::LevelFilter::Debug;
    #[cfg(not(debug_assertions))]
    let default = log::LevelFilter::Info;
    apply_level(default);
    log::info!("[LogLevel] 默认日志级别: {}", level_name(default));
}

/// 查询当前生效的日志级别
///
/// 前端调用方式：`invoke('get_log_level')` → `string`
#[tauri::command]
pub fn get_log_level(_app: tauri::AppHandle) -> Result<String, String> {
    let cur = CURRENT_LEVEL
        .lock()
        .unwrap()
        .unwrap_or(log::LevelFilter::Info);
    Ok(level_name(cur).to_string())
}

/// 运行时调整日志级别（立即生效 + 持久化，无需重新编译）
///
/// 前端调用方式：`invoke('set_log_level', { level: 'debug' })` → `string`
///
/// # 可用级别
/// `off` / `error` / `warn` / `info` / `debug` / `trace`
#[tauri::command]
pub fn set_log_level(app: tauri::AppHandle, level: String) -> Result<String, String> {
    let filter = parse_level(&level).ok_or_else(|| {
        format!(
            "无效日志级别: {}（可选 off/error/warn/info/debug/trace）",
            level.trim()
        )
    })?;

    let path = level_file(&app)?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let payload = json!({ "level": level_name(filter) });
    std::fs::write(&path, serde_json::to_string_pretty(&payload).unwrap_or_default())
        .map_err(|e| format!("持久化日志级别失败: {}", e))?;

    apply_level(filter);
    log::info!("[LogLevel] 日志级别已设置为: {}", level_name(filter));
    Ok(level_name(filter).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_level_accepts_all_aliases() {
        assert_eq!(parse_level("OFF"), Some(log::LevelFilter::Off));
        assert_eq!(parse_level("error"), Some(log::LevelFilter::Error));
        assert_eq!(parse_level("WARN"), Some(log::LevelFilter::Warn));
        assert_eq!(parse_level("warning"), Some(log::LevelFilter::Warn));
        assert_eq!(parse_level("info"), Some(log::LevelFilter::Info));
        assert_eq!(parse_level("DEBUG"), Some(log::LevelFilter::Debug));
        assert_eq!(parse_level("trace"), Some(log::LevelFilter::Trace));
    }

    #[test]
    fn test_parse_level_rejects_unknown() {
        assert_eq!(parse_level("verbose"), None);
        assert_eq!(parse_level(""), None);
        assert_eq!(parse_level("info "), None); // 未 trim，保持严格
    }

    #[test]
    fn test_level_name_roundtrip() {
        for l in [
            log::LevelFilter::Off,
            log::LevelFilter::Error,
            log::LevelFilter::Warn,
            log::LevelFilter::Info,
            log::LevelFilter::Debug,
            log::LevelFilter::Trace,
        ] {
            assert_eq!(parse_level(level_name(l)), Some(l));
        }
    }
}
//! Q3: 崩溃本地留存与诊断导出（本地优先零崩溃上报的补偿方案）
//!
//! # 三层可观测（全部数据不出设备，符合 PRIVACY_POLICY.md「本地存储」承诺）
//! 1. **panic hook**：Rust 侧 panic（含 WebView 线程 panic）落盘到
//!    `{log_dir}/crash_YYYYMMDD_HHMMSS.log`，无需网络即可留存崩溃现场；
//! 2. **export_diagnostics 命令**：把主日志 + 审计日志 + 崩溃日志 + 级别配置
//!    复制到 `{app_data_dir}/exports/diagnostics_<ts>/`，由用户（Settings「关于」
//!    页按钮）主动触发 —— 生成与传输都在用户设备上，由用户显式发起；
//! 3. （远期，未实现）一次性崩溃摘要上报：无服务端端点，本地优先架构下
//!    不引入网络出口；留待服务端就绪且用户 opt-in 后启用。
//!
//! # 崩溃自动重启（报告1 §阶段2 必需能力，任务书阶段五-1）
//! panic hook 内追加受限自动重启：60 秒冷却窗口内连续崩溃 ≤ 3 次则重启自身，
//! 超过上限停止重启（防无限循环）。计数状态存 `{log_dir}/crash_restart.json`。
//! 可用环境变量 `SPIRITPAL_DISABLE_CRASH_RESTART=1` 关闭（测试/调试用）。

use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;

/// 崩溃日志目录（setup 时初始化）
static CRASH_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// 60 秒冷却窗口内最大自动重启次数（防无限重启循环）
const MAX_CRASH_RESTARTS: u32 = 3;
/// 崩溃重启冷却窗口（秒）
const CRASH_RESTART_COOLDOWN_SECS: i64 = 60;

/// 崩溃自启决策（纯函数，可单测）
///
/// - `in_cooldown`：距上次崩溃 ≤ 60 秒 → 计数递增；否则视为新一次崩溃（计数重置为 1）
/// - 是否重启：新计数 ≤ 上限
///
/// 返回 `(是否应重启, 新的崩溃计数)`
fn compute_restart_decision(last_count: u32, last_ts: Option<i64>, now_ts: i64) -> (bool, u32) {
    let in_cooldown = last_ts.is_some_and(|ts| now_ts - ts <= CRASH_RESTART_COOLDOWN_SECS);
    let count = if in_cooldown {
        last_count.saturating_add(1)
    } else {
        1
    };
    (count <= MAX_CRASH_RESTARTS, count)
}

/// 读取崩溃重启计数状态（文件不存在视为首次崩溃）
fn read_restart_state(state_path: &Path) -> (u32, Option<i64>) {
    let Ok(raw) = std::fs::read_to_string(state_path) else {
        return (0, None);
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return (0, None);
    };
    let count = v.get("count").and_then(|c| c.as_u64()).unwrap_or(0) as u32;
    let ts = v.get("last_ts").and_then(|t| t.as_i64());
    (count, ts)
}

/// 写回崩溃重启计数状态
fn write_restart_state(state_path: &Path, count: u32, last_ts: i64) {
    let payload = json!({ "count": count, "last_ts": last_ts });
    let _ = std::fs::write(
        state_path,
        serde_json::to_string(&payload).unwrap_or_default(),
    );
}

/// 崩溃后受限自动重启（panic hook 内调用）
///
/// 安全约束（铁律 3 可回滚视角）：
/// - 只 spawn 自身进程（`--relaunch-after-crash` 标记），不触碰任何数据/配置；
/// - 计数上限 + 冷却窗口防无限重启死循环；
/// - 环境变量 `SPIRITPAL_DISABLE_CRASH_RESTART` 可随时关闭。
fn maybe_auto_restart_after_crash(log_dir: &Path) {
    if std::env::var_os("SPIRITPAL_DISABLE_CRASH_RESTART").is_some() {
        return;
    }
    let state_path = log_dir.join("crash_restart.json");
    let (last_count, last_ts) = read_restart_state(&state_path);
    let now_ts = chrono::Utc::now().timestamp();
    let (should_restart, new_count) = compute_restart_decision(last_count, last_ts, now_ts);
    write_restart_state(&state_path, new_count, now_ts);

    if should_restart {
        if let Ok(exe) = std::env::current_exe() {
            let spawned = std::process::Command::new(&exe)
                .arg("--relaunch-after-crash")
                .spawn()
                .is_ok();
            if spawned {
                log::error!("[Crash] 已触发自动重启（第 {} 次）", new_count);
            } else {
                log::error!(
                    "[Crash] 自动重启 spawn 失败（第 {} 次），请手动重启",
                    new_count
                );
            }
        }
    } else {
        log::error!(
            "[Crash] 60 秒内连续崩溃 {} 次，停止自动重启（防无限循环，崩溃日志已留存）",
            new_count
        );
    }
}

/// 安装 panic hook（setup 中调用一次；所有非桌面目标同样安装，日志写到临时目录）
pub fn setup_panic_hook(app: &tauri::App) {
    let log_dir = match app.path().app_log_dir() {
        Ok(dir) => {
            let _ = std::fs::create_dir_all(&dir);
            dir
        }
        Err(_) => std::env::temp_dir().join("spiritpal-crash"),
    };
    let _ = CRASH_DIR.set(Some(log_dir));

    std::panic::set_hook(Box::new(|info| {
        let dir = CRASH_DIR.get().and_then(|d| d.clone());
        let dir = dir.unwrap_or_else(|| std::env::temp_dir().join("spiritpal-crash"));
        let _ = std::fs::create_dir_all(&dir);

        let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let path = dir.join(format!("crash_{}.log", ts));

        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "未知 panic payload".to_string()
        };
        let loc = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        // force_capture()：panics 路径较冷，捕获完整 backtrace 成本可接受，
        // 便于离线定位崩溃现场（backtrace 可能含路径，但仅留在本机诊断包内）。
        let backtrace = std::backtrace::Backtrace::force_capture();

        let mut f = std::fs::File::create(&path).ok();
        if let Some(f) = f.as_mut() {
            let _ = writeln!(f, "=== SpiritPal Crash Report ===");
            let _ = writeln!(f, "timestamp: {}", chrono::Utc::now().to_rfc3339());
            let _ = writeln!(f, "location : {}", loc);
            let _ = writeln!(f, "payload  : {}", payload);
            let _ = writeln!(f, "thread   : {:?}", std::thread::current().name());
            let _ = write!(f, "{}", backtrace);
        }
        log::error!(
            "[Crash] 已记录崩溃现场到 {} （location: {}, payload: {}）",
            path.display(),
            loc,
            payload
        );

        // 崩溃自动重启（受限：60s 冷却 + 上限 3 次，防循环）
        maybe_auto_restart_after_crash(&dir);
    }));
}

/// 诊断导出结果
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiagnosticsResult {
    /// 导出的目录（用户可自行访问/压缩/转移）
    pub path: String,
    /// 实际含有的文件列表
    pub files: Vec<String>,
}

/// 收集诊断文件到 `{app_data_dir}/exports/diagnostics_<ts>/`，返回目录路径
///
/// 前端调用方式：`invoke('export_diagnostics')` → [`ExportDiagnosticsResult`]
///
/// 隐私说明：仅复制本项目自己的日志/配置到应用数据目录下，不读取任何用户内容；
/// 导出动作由用户在设置页主动触发（默认不执行，无网络出口）。
#[tauri::command]
pub fn export_diagnostics(app: tauri::AppHandle) -> Result<ExportDiagnosticsResult, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))?;
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("获取日志目录失败: {}", e))?;

    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let out_dir = data_dir.join("exports").join(format!("diagnostics_{}", ts));
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("创建导出目录失败: {}", e))?;

    // 待收集源文件 → 目标文件名
    let mut candidates: Vec<(PathBuf, String)> = vec![
        (log_dir.join("spiritpal.log"), "spiritpal.log".to_string()),
        (
            data_dir.join("spiritpal_audit.log"),
            "spiritpal_audit.log".to_string(),
        ),
        (
            data_dir.join("spiritpal_audit.old.log"),
            "spiritpal_audit.old.log".to_string(),
        ),
        (
            data_dir.join("log-level.json"),
            "log-level.json".to_string(),
        ),
    ];
    // 崩溃日志（匹配当前及历史 crash_*.log）
    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if (name.starts_with("crash_") && name.ends_with(".log"))
                && e.file_type().map(|t| t.is_file()).unwrap_or(false)
            {
                candidates.push((e.path(), name));
            }
        }
    }

    let mut files = Vec::new();
    for (src, name) in candidates {
        if src.is_file() {
            let dst = out_dir.join(name.clone());
            if std::fs::copy(&src, &dst).is_ok() {
                files.push(name);
            }
        }
    }

    // 清单（便于人工识别导出内容与时间）
    let manifest = json!({
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "appVersion": {
            "version": app.package_info().version.to_string(),
        },
        "files": files,
    });
    let _ = std::fs::write(
        out_dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    );
    files.push("manifest.json".to_string());

    log::info!("[Diagnostics] 诊断包已导出: {}", out_dir.display());
    Ok(ExportDiagnosticsResult {
        path: out_dir.to_string_lossy().into_owned(),
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manifest_payload_well_formed() {
        // manifest 序列化不应失败（export_diagnostics 用其落盘）
        let manifest = json!({
            "exportedAt": "2026-09-04T00:00:00Z",
            "appVersion": { "version": "0.1.0" },
            "files": ["spiritpal.log"],
        });
        let s = serde_json::to_string_pretty(&manifest);
        assert!(s.is_ok());
        assert!(s.unwrap().contains("spiritpal.log"));
    }

    // ---- 崩溃自启决策（阶段五-1）----

    #[test]
    fn test_restart_decision_first_crash_restarts() {
        // 首次崩溃：无历史 → 重启，计数 1
        let (should, count) = compute_restart_decision(0, None, 1_000_000);
        assert!(should);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_restart_decision_cooldown_increments() {
        // 60 秒内第 2 次崩溃 → 重启，计数 2
        let (should, count) = compute_restart_decision(1, Some(1_000_000), 1_000_030);
        assert!(should);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_restart_decision_hits_limit_stops() {
        // 60 秒内第 4 次崩溃（已重启 3 次）→ 停止重启，计数 4
        let (should, count) = compute_restart_decision(3, Some(1_000_000), 1_000_045);
        assert!(!should);
        assert_eq!(count, 4);
    }

    #[test]
    fn test_restart_decision_cooldown_expired_resets() {
        // 超过 60 秒后再次崩溃 → 重置计数为 1 并重启（新一次崩溃事件）
        let (should, count) = compute_restart_decision(3, Some(1_000_000), 1_000_200);
        assert!(should);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_restart_state_roundtrip() {
        // 状态文件读写往返（计数 + 时间戳）
        let dir = std::env::temp_dir().join(format!("sp-crash-state-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let state_path = dir.join("crash_restart.json");
        write_restart_state(&state_path, 2, 1_000_000);
        let (count, ts) = read_restart_state(&state_path);
        assert_eq!(count, 2);
        assert_eq!(ts, Some(1_000_000));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

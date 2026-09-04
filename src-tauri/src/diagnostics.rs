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

use serde_json::json;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::Manager;

/// 崩溃日志目录（setup 时初始化）
static CRASH_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

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
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("创建导出目录失败: {}", e))?;

    // 待收集源文件 → 目标文件名
    let mut candidates: Vec<(PathBuf, String)> = vec![
        (log_dir.join("spiritpal.log"), "spiritpal.log".to_string()),
        (data_dir.join("spiritpal_audit.log"), "spiritpal_audit.log".to_string()),
        (data_dir.join("spiritpal_audit.old.log"), "spiritpal_audit.old.log".to_string()),
        (data_dir.join("log-level.json"), "log-level.json".to_string()),
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
}
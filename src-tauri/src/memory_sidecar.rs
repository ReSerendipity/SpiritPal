//! 记忆系统 sidecar（cognee，进程外隔离）
//!
//! ADR-0003：cognee 以隔离 Python sidecar（API server）运行，经 HTTP 被前端
//! `src/lib/memory/cogneeClient.ts` 调用。本模块在 Rust 侧负责拉起/停止该
//! 隔离进程，遵循家族「vendor + 运行时隔离」纪律（类比 comfy_kernel）。
//!
//! # 提供的 Tauri 命令（桌面端）
//! - [`start_memory_sidecar`] — 启动 cognee sidecar（幂等；venv 未就绪则报错提示先 bootstrap）
//! - [`stop_memory_sidecar`]  — 停止 cognee sidecar
//!
//! # 重要提示
//! - sidecar 默认监听 127.0.0.1:7531
//! - 仅当用户机存在 Python venv（先运行 memory_sidecar/bootstrap 脚本）时才可启动
//! - 前端也可主动调用 `start_memory_sidecar`；启动时若 Python 缺失不会崩溃主进程

#[cfg(desktop)]
use std::process::{Child, Command, Stdio};
#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use std::sync::Mutex;

#[cfg(desktop)]
use tauri::{Emitter, Manager};

#[cfg(desktop)]
static SIDECAR_STARTED: AtomicBool = AtomicBool::new(false);

#[cfg(desktop)]
static SIDECAR_CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// 启动 cognee 记忆 sidecar
///
/// 在隔离 venv 中运行 `server.py`。资源目录解析参考 Tauri `resource_dir()`
/// （dev 下指向 `src-tauri/`，打包后指向 bundle resources 中的 `memory_sidecar/`）。
///
/// 前端调用方式：`invoke('start_memory_sidecar')`
///
/// # Returns
/// - `Ok(())` — sidecar 已启动（或已在运行）
/// - `Err(String)` — venv 未就绪或进程启动失败
#[cfg(desktop)]
#[tauri::command]
pub fn start_memory_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    if SIDECAR_STARTED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    let sidecar_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("memory_sidecar");

    #[cfg(windows)]
    let python = sidecar_dir.join(".venv").join("Scripts").join("python.exe");
    #[cfg(not(windows))]
    let python = sidecar_dir.join(".venv").join("bin").join("python");
    let server = sidecar_dir.join("server.py");

    if !python.exists() || !server.exists() {
        SIDECAR_STARTED.store(false, Ordering::SeqCst);
        return Err(
            "记忆 sidecar 未就绪：请先运行 memory_sidecar/bootstrap 脚本创建 venv".to_string(),
        );
    }

    match Command::new(&python)
        .arg(&server)
        .current_dir(&sidecar_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => {
            *SIDECAR_CHILD.lock().unwrap() = Some(child);
            let _ = app.emit("memory-sidecar-status", "started");
            log::info!("[Memory] cognee sidecar started on :7531");
            Ok(())
        }
        Err(e) => {
            SIDECAR_STARTED.store(false, Ordering::SeqCst);
            Err(format!("启动记忆 sidecar 失败: {e}"))
        }
    }
}

/// 停止 cognee 记忆 sidecar
///
/// 前端调用方式：`invoke('stop_memory_sidecar')`
///
/// # Returns
/// - `Ok(())` — 已停止（或本就未运行）
#[cfg(desktop)]
#[tauri::command]
pub fn stop_memory_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    if !SIDECAR_STARTED.swap(false, Ordering::SeqCst) {
        return Ok(());
    }
    if let Ok(mut guard) = SIDECAR_CHILD.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
    let _ = app.emit("memory-sidecar-status", "stopped");
    log::info!("[Memory] cognee sidecar stopped");
    Ok(())
}

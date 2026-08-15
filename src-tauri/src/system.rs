//! 系统级后台任务模块（空闲检测 / 全局快捷键 / WebView2 清理）
//!
//! [REFACTOR] 从 lib.rs 拆分，职责单一化
//!
//! # 包含功能
//! - [`start_idle_detection`]：后台线程轮询系统空闲时间，触发 idle/active 事件
//! - [`register_global_shortcut`]：注册 Ctrl+Shift+P 全局快捷键
//! - [`cleanup_webview2_if_needed`]：启动前清理 WebView2 残留锁文件（Windows）

#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use std::sync::Arc;
#[cfg(desktop)]
use std::time::Duration;

#[cfg(desktop)]
use tauri::Emitter;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

// ============ 常量 ============

/// 空闲检测轮询间隔（秒）
// [OPTIMIZE] A3 - 抽取魔法数字为具名常量
#[cfg(desktop)]
const IDLE_POLL_INTERVAL_SECS: u64 = 5;

/// 触发空闲事件的最小空闲分钟数
// [OPTIMIZE] A3 - 抽取魔法数字为具名常量
#[cfg(desktop)]
const IDLE_THRESHOLD_MIN: u64 = 5;

/// 恢复活跃事件的最大空闲分钟数
// [OPTIMIZE] A3 - 抽取魔法数字为具名常量
#[cfg(desktop)]
const ACTIVE_THRESHOLD_MIN: u64 = 1;

// ============ 空闲检测 ============

/// 启动空闲检测后台线程
///
/// [Quality Review] 从 `run()` 中提取，职责单一化。
///
/// # 行为
/// - 每 5 秒轮询系统空闲时间（通过 [`crate::win32::get_idle_ms`]）
/// - 空闲 ≥ 5 分钟时触发 `"system-idle"` 事件（带 idle_minutes 参数）
/// - 空闲 < 1 分钟时触发 `"system-active"` 事件
/// - 通过 `running` 标志控制线程退出（应用退出时设为 false）
///
/// # 前端事件
/// - `system-idle` — 用户空闲超过阈值，payload: `u64`（空闲分钟数）
/// - `system-active` — 用户恢复活跃
///
/// # Arguments
/// - `app_handle` — Tauri 应用句柄，用于发送前端事件
/// - `running` — 线程运行标志（Arc<AtomicBool>），设为 false 时线程退出
#[cfg(desktop)]
pub fn start_idle_detection(app_handle: tauri::AppHandle, running: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let mut last_idle_notified = false;
        while running.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_secs(IDLE_POLL_INTERVAL_SECS));
            if !running.load(Ordering::Acquire) {
                break;
            }
            let idle_ms = crate::win32::get_idle_ms();
            let idle_minutes = idle_ms / 1000 / 60;

            if idle_minutes >= IDLE_THRESHOLD_MIN && !last_idle_notified {
                last_idle_notified = true;
                let _ = app_handle.emit("system-idle", idle_minutes);
            }
            if idle_minutes < ACTIVE_THRESHOLD_MIN && last_idle_notified {
                last_idle_notified = false;
                let _ = app_handle.emit("system-active", ());
            }
        }
    });
}

// ============ 全局快捷键 ============

/// 注册全局快捷键 Ctrl+Shift+P
///
/// [Quality Review] 从 `run()` 中提取，职责单一化。
///
/// 快捷键触发时在 setup 中通过 `global-shortcut-toggle` 事件通知前端，
/// 用于切换宠物窗口显示/隐藏。
///
/// # Arguments
/// - `app` — Tauri 应用引用
#[cfg(desktop)]
pub fn register_global_shortcut(app: &tauri::App) {
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyP);
    if let Err(e) = app.global_shortcut().register(shortcut) {
        log::warn!("[SpiritPal] failed to register global shortcut: {}", e);
    } else {
        log::info!("[SpiritPal] global shortcut Ctrl+Shift+P registered");
    }
}

// ============ WebView2 清理 ============

/// 启动前自动清理 WebView2 用户数据目录（Windows only）
///
/// 修复问题：异常退出后 EBWebView 目录被锁死/损坏导致新窗口无法创建。
///
/// # 检测逻辑
/// 1. 检查 `%LOCALAPPDATA%\com.spiritpal.desktop-pet\EBWebView` 目录是否存在
/// 2. 检查是否存在锁文件：SingleLock、lockfile、Default/lock、Default/SharedData/lock
/// 3. 如果存在任何锁文件，认为 WebView2 上次异常退出，删除整个 EBWebView 目录
///
/// 非 Windows 平台为空操作（no-op）。
#[cfg(desktop)]
pub fn cleanup_webview2_if_needed() {
    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let ebwebview_dir = std::path::PathBuf::from(local_app_data)
                .join("com.spiritpal.desktop-pet")
                .join("EBWebView");

            if !ebwebview_dir.exists() {
                return;
            }

            // 检查是否存在锁文件（WebView2 锁定标志）
            let lock_files = [
                ebwebview_dir.join("SingleLock"),
                ebwebview_dir.join("lockfile"),
                ebwebview_dir.join("Default").join("lock"),
                ebwebview_dir
                    .join("Default")
                    .join("SharedData")
                    .join("lock"),
            ];

            let mut has_stale_locks = false;
            for lock_path in &lock_files {
                if lock_path.exists() {
                    has_stale_locks = true;
                    break;
                }
            }

            if has_stale_locks {
                // 锁文件存在时不再删除整个 EBWebView 目录：
                // 1. WebView2 正常退出时锁文件也常残留，误删会导致每次启动冷初始化
                //    （启动时窗口闪动/白屏）且 localStorage 全部丢失（首次引导反复出现）
                // 2. WebView2 自身能处理锁文件与损坏恢复，无需外部删除
                eprintln!("[SpiritPal] stale WebView2 locks detected, skipping cleanup (WebView2 handles recovery)");
            }
        }
    }
}

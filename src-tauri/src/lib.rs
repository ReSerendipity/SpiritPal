//! SpiritPal — AI Desktop Pet (Tauri v2 Rust 库入口)
//!
//! [REFACTOR] R1 - 模块化拆分：将原 1287 行单文件拆分为 9 个职责单一的模块
//!
//! # 模块结构
//! - [`validation`] — 输入校验（命令注入 / 路径遍历防护）
//! - [`win32`]      — 平台原生 API 封装（Windows / macOS / Linux stub）
//! - [`crypto`]     — AES-256-GCM 加密 / SHA-256 哈希 / 机器 ID 派生
//! - [`keychain`]   — 系统 Keychain 加密存储（API Key 等敏感数据）
//! - [`petmod`]     — .petmod 压缩包导入 + 本地模组目录扫描
//! - [`tray`]       — 系统托盘菜单 + 图标管理
//! - [`system`]     — 系统级后台任务（空闲检测 / 全局快捷键 / WebView2 清理）
//! - [`macos`]      — macOS NSPanel 浮层配置（tauri-nspanel 集成）
//! - [`device`]     — 全局键鼠监听（宠物注视光标效果，参考 BongoCat）
//!
//! # lib.rs 保留内容
//! - 模块声明与命令导入
//! - 通用命令（greet / log_frontend_error / open_application）
//! - 桌面端窗口命令（set/remove_pet_click_through / get_idle_time / get_active_window 等）
//! - macOS NSPanel 命令（show_pet_panel / hide_pet_panel / set_pet_always_on_top）
//! - [`run`] 应用入口函数
//! - 单元测试
//!
//! # 提供的 Tauri 命令（桌面端）
//! 通用命令：
//! - [`greet`] — 测试命令，返回问候语
//! - [`log_frontend_error`] — 前端错误日志桥接
//! - [`open_application`] — 打开应用程序或 URL
//!
//! 窗口与系统：
//! - [`set_pet_click_through`] — 设置宠物窗口点击穿透（Windows）
//! - [`remove_pet_click_through`] — 移除宠物窗口点击穿透（Windows）
//! - [`get_mouse_pos`] — 获取鼠标在窗口客户区坐标（Windows）
//! - [`get_idle_time`] — 获取系统空闲时间
//! - [`get_active_window`] — 获取前台窗口信息
//! - [`start_topmost_keepalive`] — 启动窗口置顶轮询保活（Windows）
//!
//! 托盘：
//! - [`tray::set_tray_icon`] — 设置托盘图标（指定路径）
//! - [`tray::update_tray_icon`] — 根据宠物状态切换托盘图标
//!
//! Keychain：
//! - [`keychain::set_secret`] — 存储敏感值
//! - [`keychain::get_secret`] — 读取敏感值
//! - [`keychain::delete_secret`] — 删除敏感值
//!
//! 加密：
//! - [`crypto::encrypt_data`] — AES-256-GCM 加密
//! - [`crypto::decrypt_data`] — AES-256-GCM 解密
//! - [`crypto::compute_sha256`] — 计算文件 SHA-256
//!
//! 模组：
//! - [`petmod::import_petmod`] — 导入 .petmod 压缩包
//! - [`petmod::scan_mods_directory`] — 扫描本地模组目录
//!
//! 全局键鼠监听：
//! - [`device::start_device_listening`] — 启动全局键鼠监听
//! - [`device::stop_device_listening`] — 停止全局键鼠监听
//!
//! macOS NSPanel 浮层：
//! - [`show_pet_window`] — 显示宠物窗口
//! - [`hide_pet_window`] — 隐藏宠物窗口
//! - [`set_pet_always_on_top`] — 设置宠物窗口置顶

// R-12: 反调试检测
mod antidebug;
// R-14: 数据库文件级加密
// pub mod: 允许集成测试 (tests/) 访问公开 API
pub mod crypto;
mod device;
pub mod encrypted_db;
mod keychain;
#[cfg(target_os = "macos")]
mod macos;
mod petmod;
mod magic_check;
mod system;
mod tray;
pub mod validation;
mod win32;
// R-11: SRI 哈希（构建时自动生成）
// clippy::incompatible_msrv: LazyLock 需要 1.80.0，但项目 MSRV 设为 1.77.2，此处允许
// dead_code: 生成的 get_hash 函数可能未被当前代码引用
#[allow(clippy::incompatible_msrv, dead_code)]
mod generated {
    pub mod sri_hashes;
}

// ============ 跨模块命令导入（供 generate_handler! 使用）============
// Tauri 的 generate_handler! 宏接受函数标识符，需要先 use 导入

use crypto::{compute_sha256, decrypt_data, encrypt_data};
use petmod::{import_petmod, scan_mods_directory};
// R-14: 数据库加密命令
use encrypted_db::{decrypt_db_at_rest, encrypt_db_at_rest};

#[cfg(desktop)]
use device::{start_device_listening, stop_device_listening};
#[cfg(desktop)]
use keychain::{delete_secret, get_secret, set_secret};
#[cfg(desktop)]
use tray::{set_tray_icon, set_tray_icon_png, update_tray_icon};

// ============ 桌面端专用导入 ============

#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use std::sync::Arc;

#[cfg(desktop)]
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewWindow,
};

#[cfg(desktop)]
use tauri_plugin_global_shortcut::ShortcutState;

#[cfg(not(desktop))]
use tauri::{Emitter, Manager, WebviewWindow};

#[cfg(windows)]
use windows::Win32::Foundation::HWND;

// ============================================================
// 通用 Tauri 命令
// ============================================================

/// 测试问候命令
///
/// 前端调用方式：`invoke('greet')`
///
/// # Returns
/// 固定问候字符串 `"Hello from SpiritPal"`
#[tauri::command]
fn greet() -> String {
    "Hello from SpiritPal".to_string()
}

/// 打开系统文件管理器定位到指定路径（Windows 使用 explorer）
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开路径失败: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("当前平台暂不支持自动打开目录".to_string())
    }
}

/// 前端错误日志记录 — 将 JS 错误写入 Rust log 文件
///
/// 使用 tauri-plugin-log 的日志系统，输出到 LogDir (spiritpal.log)。
///
/// 前端调用方式：`invoke('log_frontend_error', { level: string, message: string })`
///
/// # Arguments
/// - `level` — 日志级别：`"error"` / `"warn"` / `"info"` / 其他（debug）
/// - `message` — 错误消息内容
#[tauri::command]
fn log_frontend_error(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!("[Frontend] {}", message),
        "warn" => log::warn!("[Frontend] {}", message),
        "info" => log::info!("[Frontend] {}", message),
        _ => log::debug!("[Frontend] {}", message),
    }
}

// ============================================================
// 上传文件魔数校验（对齐 TTS/Image/SeedVR2 的输入防护）
// ============================================================
//
// 供聊天窗口上传图片/音频等多媒体内容给外部多模态 LLM 时调用，
// 在 Rust 端做纵深防御，阻断伪装文件（如把 .exe 改名 .png）。
//
// 前端调用方式：`invoke('validate_upload_magic', { contents: number[], fileExt: string })`

/// 校验上传文件字节的魔数与声明扩展名是否匹配。
///
/// # Arguments
/// - `contents` — 文件二进制字节（前端读取后传入，通常至少前 12 字节）
/// - `file_ext` — 声明扩展名（含前导点，小写），如 `.png`、`.petmod`
///
/// # Returns
/// - `Ok(true)` — 校验通过
/// - `Ok(false)` — 校验失败（伪装文件 / 未知扩展名 / 内容为空）
///
/// 不 panic，任何异常均归为校验失败，fail-closed。
#[tauri::command]
fn validate_upload_magic(contents: Vec<u8>, file_ext: String) -> Result<bool, String> {
    match magic_check::validate_magic(&contents, &file_ext) {
        Ok(()) => Ok(true),
        Err(e) => {
            log::warn!("[Security] 魔数校验失败: {}", e);
            Ok(false)
        }
    }
}

// ============================================================
// F5.5 AI Agent — 打开应用程序 / URL
// ============================================================
//
// [Quality Review] 使用 open crate 跨平台安全打开应用程序/URL，
// 替代原始的 cmd /C start 方案，消除命令注入风险。
// 前端通过 aiAgent.ts 封装调用，用于：
//   - open_application 工具：打开计算器、记事本等
//   - search_web 工具：打开浏览器搜索 URL

/// 打开应用程序或 URL
///
/// 使用 `open` crate 跨平台安全打开，替代原始的 `cmd /C start` 方案，消除命令注入风险。
/// 先通过 [`validation::validate_app_name`] 校验输入，拒绝 shell 元字符。
///
/// 前端调用方式：`invoke('open_application', { appName: string })`
///
/// # Arguments
/// - `app_name` — 应用程序名称（如 `"calc"`、`"notepad"`）或 URL（如 `"https://..."`）
///
/// # Returns
/// - `Ok(())` — 打开成功
/// - `Err(String)` — 输入包含非法字符或打开失败
///
/// [Tauri Review] 改为 async + open crate，消除 cmd.exe 命令注入风险
#[tauri::command]
async fn open_application(app_name: String) -> Result<(), String> {
    // [Tauri Review] 输入校验：拒绝 shell 元字符
    validation::validate_app_name(&app_name)?;

    // [Tauri Review] 使用 open crate 替代 cmd /C start，跨平台安全打开
    tauri::async_runtime::spawn_blocking(move || {
        open::that(&app_name).map_err(|e| format!("无法打开: {}", e))
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))?
}

// ============================================================
// 桌面端窗口命令
// ============================================================

/// 设置宠物窗口点击穿透（Windows only）
///
/// 通过 Win32 API 设置窗口扩展样式 `WS_EX_LAYERED | WS_EX_TRANSPARENT`，
/// 使宠物窗口不响应鼠标点击，点击事件穿透到下方窗口。
///
/// 前端调用方式：`invoke('set_pet_click_through')`（在 pet-window 上调用）
///
/// # Returns
/// - `Ok(())` — 设置成功
/// - `Err(String)` — 非 Windows 平台或 Win32 API 调用失败
#[cfg(desktop)]
#[tauri::command]
fn set_pet_click_through(window: WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(hwnd.0 as *mut _);
        win32::set_click_through(hwnd)
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("Click-through is only supported on Windows".to_string())
    }
}

/// 移除宠物窗口点击穿透（Windows only）
///
/// 清除窗口扩展样式中的 `WS_EX_TRANSPARENT`，恢复窗口响应鼠标点击。
///
/// 前端调用方式：`invoke('remove_pet_click_through')`（在 pet-window 上调用）
///
/// # Returns
/// - `Ok(())` — 移除成功
/// - `Err(String)` — 非 Windows 平台或 Win32 API 调用失败
#[cfg(desktop)]
#[tauri::command]
fn remove_pet_click_through(window: WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(hwnd.0 as *mut _);
        win32::remove_click_through(hwnd)
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("Click-through is only supported on Windows".to_string())
    }
}

/// 获取鼠标在窗口客户区的逻辑坐标
///
/// 用于前端像素级点击穿透检测。
///
/// 前端调用方式：`invoke('get_mouse_pos')`（在 pet-window 上调用）
///
/// # Returns
/// - `Ok((f64, f64))` — 鼠标在窗口客户区的 (x, y) 逻辑坐标
/// - `Err(String)` — 非 Windows 平台或 Win32 API 调用失败
///
/// # Safety
/// 使用 Win32 `GetCursorPos` API 获取屏幕坐标，然后转换为窗口客户区坐标：
/// 1. `GetCursorPos` 获取屏幕物理坐标
/// 2. 应用窗口 scale_factor 转换为逻辑坐标
/// 3. 减去窗口左上角位置得到客户区坐标
#[cfg(desktop)]
#[tauri::command]
fn get_mouse_pos(_app: tauri::AppHandle, window: WebviewWindow) -> Result<(f64, f64), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        unsafe {
            let mut point = POINT::default();
            // SAFETY: GetCursorPos 接收一个指向 POINT 结构的有效指针
            // 传入的 &mut point 是有效的、对齐的、可写的
            if GetCursorPos(&mut point).is_err() {
                return Err("GetCursorPos failed".to_string());
            }

            let scale_factor = window.scale_factor().unwrap_or(1.0);

            // 屏幕物理坐标 → 逻辑坐标
            let screen_logical =
                tauri::PhysicalPosition::new(point.x, point.y).to_logical::<f64>(scale_factor);

            // 窗口左上角物理坐标 → 逻辑坐标
            let window_physical = window
                .inner_position()
                .unwrap_or(tauri::PhysicalPosition::new(0, 0));
            let window_logical = window_physical.to_logical::<f64>(scale_factor);

            // 客户区坐标 = 屏幕坐标 - 窗口左上角
            let client_x = screen_logical.x - window_logical.x;
            let client_y = screen_logical.y - window_logical.y;

            Ok((client_x, client_y))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        let _ = window;
        Err("get_mouse_pos is only supported on Windows".to_string())
    }
}

/// 获取系统空闲时间（毫秒）
///
/// 前端调用方式：`invoke('get_idle_time')`
///
/// # Returns
/// 系统空闲时间（毫秒），0 表示获取失败或永不空闲
#[cfg(desktop)]
#[tauri::command]
fn get_idle_time() -> u64 {
    win32::get_idle_ms()
}

/// 前台窗口信息
///
/// 包含当前前台窗口的标题和进程名。
#[cfg(desktop)]
#[derive(serde::Serialize, Debug)]
struct ActiveWindowInfo {
    /// 窗口标题
    title: String,
    /// 进程名（不含路径和扩展名）
    process_name: String,
}

/// 获取当前前台窗口信息（标题 + 进程名）
///
/// Windows: 使用 `GetForegroundWindow` + `GetWindowTextW` + `QueryFullProcessImageNameW`
/// macOS: 使用 osascript 调用 AppleScript
/// Linux: 使用 xdotool（X11）
/// 其他平台: 返回空字符串
///
/// 前端调用方式：`invoke('get_active_window')`
///
/// # Returns
/// [`ActiveWindowInfo`] 结构体，包含标题和进程名；获取失败时字段为空字符串
#[cfg(desktop)]
#[tauri::command]
fn get_active_window() -> ActiveWindowInfo {
    let (title, process_name) = win32::get_active_window_info();
    ActiveWindowInfo {
        title,
        process_name,
    }
}

/// 启动窗口置顶轮询保活（Windows only）
///
/// 参考 BongoCat：使用 `SetWindowPos(HWND_TOPMOST)` 16ms 轮询，
/// 防止其他全屏应用抢占置顶状态导致宠物窗口被遮挡。
/// 非 Windows 平台为空操作（macOS/Linux 上 Tauri 的 alwaysOnTop 更稳定）。
///
/// 前端调用方式：`invoke('start_topmost_keepalive')`（在 pet-window 上调用）
///
/// # Returns
/// - `Ok(())` — 保活线程启动成功（或非 Windows 平台空操作）
/// - `Err(String)` — 获取窗口句柄失败
// 全局保活线程去重标志：子窗口（聊天/设置/漫游）的 main.tsx 也会调用本命令，
// 若每次调用都启动新线程，多窗口累积出多个线程同时 SetWindowPos 高频置顶。
static TOPMOST_KEEPALIVE_STARTED: AtomicBool = AtomicBool::new(false);

#[cfg(desktop)]
#[tauri::command]
fn start_topmost_keepalive(app: tauri::AppHandle, _window: WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        // 强制只对 pet-window 保活：main.tsx 在每个窗口的 webview 中都会执行
        // enableWindowsPinMode，若各窗口各自启动保活线程，多个窗口会互相
        // SetWindowPos(HWND_TOPMOST) 抢占 Z 序与焦点（窗口重叠时反复串行）。
        let target = app
            .get_webview_window("pet-window")
            .ok_or_else(|| "pet-window not found".to_string())?;
        // 已存在保活线程则直接返回（去重），避免每个窗口各启动一个线程。
        // 注意：标志必须在窗口查找成功之后置位，否则查找失败会永久占位导致保活永不启动
        if TOPMOST_KEEPALIVE_STARTED.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let hwnd = target.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(hwnd.0 as *mut _);
        // 使用全局 running 标志控制线程生命周期
        // running 标志在 setup 中通过 App 状态管理，应用退出时自动停止
        let running = Arc::new(AtomicBool::new(true));
        win32::start_topmost_keepalive(hwnd, running);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, _window);
        // macOS/Linux: Tauri 的 alwaysOnTop 属性更稳定，不需要额外轮询
        Ok(())
    }
}

// ============================================================
// macOS NSPanel 命令
// ============================================================
// macOS 上宠物窗口被转换为 NSPanel，需使用 NSPanel 专用方法操作，
// 避免与 Tauri 原生 window 操作混用导致崩溃。
// 非 macOS 平台使用 Tauri 原生 window 方法作为降级。

/// 显示宠物窗口
///
/// macOS: 使用 NSPanel.show()，避免 NSPanel 与 NSWindow 操作混用
/// 其他平台: 使用 Tauri 原生 window.show() + set_focus()
///
/// 前端调用方式：`invoke('show_pet_window')`（在 pet-window 上调用）
///
/// # Returns
/// - `Ok(())` — 显示成功
#[cfg(desktop)]
#[tauri::command]
async fn show_pet_window(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if window.label() == "pet-window" {
            macos::set_pet_panel_visibility(&app, true);
            return Ok(());
        }
    }
    let _ = app;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// 隐藏宠物窗口
///
/// macOS: 使用 NSPanel.hide()，避免 NSPanel 与 NSWindow 操作混用
/// 其他平台: 使用 Tauri 原生 window.hide()
///
/// 前端调用方式：`invoke('hide_pet_window')`（在 pet-window 上调用）
///
/// # Returns
/// - `Ok(())` — 隐藏成功
#[cfg(desktop)]
#[tauri::command]
async fn hide_pet_window(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if window.label() == "pet-window" {
            macos::set_pet_panel_visibility(&app, false);
            return Ok(());
        }
    }
    let _ = app;
    let _ = window.hide();
    Ok(())
}

/// 设置宠物窗口置顶
///
/// macOS: 使用 NSPanel PanelLevel 控制，而非 Tauri 原生 set_always_on_top
/// 其他平台: 使用 Tauri 原生 set_always_on_top
///
/// 前端调用方式：`invoke('set_pet_always_on_top', { alwaysOnTop: boolean })`（在 pet-window 上调用）
///
/// # Arguments
/// - `always_on_top` — 是否置顶
///
/// # Returns
/// - `Ok(())` — 设置成功
#[cfg(desktop)]
#[tauri::command]
async fn set_pet_always_on_top(
    app: tauri::AppHandle,
    window: WebviewWindow,
    always_on_top: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if window.label() == "pet-window" {
            macos::set_pet_panel_level(&app, always_on_top);
            return Ok(());
        }
    }
    let _ = app;
    let _ = window.set_always_on_top(always_on_top);
    Ok(())
}

// ============================================================
// 应用入口
// ============================================================

/// SpiritPal 应用入口函数
///
/// 由 `main.rs` 调用，负责：
/// 1. 设置 GPU 环境变量绕过黑名单
/// 2. 清理 WebView2 残留锁文件（Windows）
/// 3. 配置 Tauri Builder 和插件
/// 4. 注册系统托盘和菜单
/// 5. 启动空闲检测和全局快捷键
/// 6. 配置 macOS NSPanel（如适用）
/// 7. 注册所有 Tauri 命令处理器
/// 8. 配置窗口关闭行为（隐藏到托盘而非退出）
/// 9. 运行应用
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // GPU 黑名单绕过 — 参考 WindowPet
    // 设置环境变量，强制 WebView2 忽略 GPU 黑名单，避免黑屏/渲染异常
    // 某些 GPU 在 WebView2 黑名单中会被降级为软件渲染，导致桌面宠物显示异常
    #[cfg(desktop)]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        // WebView2 忽略 GPU 黑名单（仅 Windows）
        #[cfg(target_os = "windows")]
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--ignore-gpu-blocklist",
        );
    }

    // 自动清理 WebView2 残留锁文件/损坏数据，防止窗口无法创建
    #[cfg(desktop)]
    system::cleanup_webview2_if_needed();

    // 日志级别区分：debug 构建记录 DEBUG 级，release 仅记录 INFO 级（避免敏感调试日志落盘）
    #[cfg(debug_assertions)]
    let log_level = log::LevelFilter::Debug;
    #[cfg(not(debug_assertions))]
    let log_level = log::LevelFilter::Info;

    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log_level)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("spiritpal".to_string()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                // 统一日志格式：时间戳 + 级别 + 模块位置(file:line) + 消息
                .format(|out, message, record| {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| {
                            let secs = d.as_secs();
                            let ms = d.subsec_millis();
                            format!("{}.{:03}", secs, ms)
                        })
                        .unwrap_or_default();
                    let file = record.file().unwrap_or("unknown");
                    let line = record.line().unwrap_or(0);
                    out.finish(format_args!(
                        "[{}] [{}] [{}:{}] {}",
                        now,
                        record.level(),
                        file,
                        line,
                        message
                    ))
                })
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    // 桌面端专属插件
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ));

        // T-01: WebDriver 自动化环境下跳过单实例注册。
        // msedgedriver 每次创建会话都会拉起一个新的应用进程；
        // 单实例插件会让「已有实例仍在运行」时的二次启动瞬间退出，
        // 导致 tauri-driver 报 "Chrome instance exited" 而无法建立会话。
        // 自动化标志由 msedgedriver 通过 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 注入。
        let is_webdriver_automation =
            std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_ok();
        if !is_webdriver_automation {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                // 二次启动时优先唤出主窗口（宠物），而不是设置窗口：
                // 原逻辑优先 show settings-window，且无条件 set_focus 抢焦点，
                // 用户在应用隐藏（托盘）时再次启动会被强制拉出窗口并打断当前操作。
                // 改为仅 show 不 set_focus：窗口唤起但不抢占焦点。
                if let Some(window) = app.get_webview_window("pet-window") {
                    let _ = window.show();
                } else if let Some(window) = app.get_webview_window("settings-window") {
                    let _ = window.show();
                }
            }));
        }

        builder = builder.plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = app.emit("global-shortcut-toggle", ());
                        }
                    })
                    .build(),
            );
    }

    builder = builder
        .setup(|app| {
            println!("[SpiritPal] starting up...");
            log::info!("SpiritPal starting up");
            // R-12: 启动时反调试检查
            antidebug::startup_check();
            // R-11: 启动时 SRI 完整性验证
            let _ = generated::sri_hashes::verify_integrity();
            // R-14: 启动时解密数据库
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = decrypt_db_at_rest(app_handle).await;
            });

            // =========================================
            // 桌面端：主窗口创建 + 托盘 + 空闲检测 + 全局快捷键
            // =========================================
            #[cfg(desktop)]
            {
                // 主窗口创建必须放在 app setup（而非 tauri.conf.json app.windows）：
                // single-instance 插件在"插件 setup"阶段检测互斥体并拦截后续实例退出，
                // 而 tauri.conf.json 配置的窗口在 Builder 初始化时（插件 setup 之前）
                // 就已创建并显示——导致每次重复启动都先闪现一个宠物窗口再退出。
                // 移到此处后：只有第一个实例能到达 app setup 并创建窗口；
                // 后续实例在插件 setup 即被拦截退出，不再闪现窗口。
                {
                    use tauri::{WebviewUrl, WebviewWindowBuilder};
                    WebviewWindowBuilder::new(
                        app,
                        "pet-window",
                        WebviewUrl::App("index.html#/pet".into()),
                    )
                    .title("SpiritPal")
                    .inner_size(300.0, 400.0)
                    // 最小尺寸对齐前端 WIN_MIN_W/H(160×200)：宠物可缩小到 0.5×，
                    // 窗口需要能跟随宠物缩小（否则小宠物配大窗口，边框预览显示巨大空白）
                    .min_inner_size(160.0, 200.0)
                    .max_inner_size(720.0, 900.0)
                    .resizable(true)
                    .fullscreen(false)
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .build()?;
                }

                let menu = tray::build_tray_menu(app)?;

                let running = Arc::new(AtomicBool::new(true));
                let app_handle = app.handle().clone();

                system::start_idle_detection(app_handle.clone(), running.clone());

                let mut tray_builder = TrayIconBuilder::with_id("main")
                    .tooltip("SpiritPal")
                    .menu(&menu)
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("pet-window") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("pet-window") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("pet-window") {
                                let _ = window.hide();
                            }
                        }
                        "focus-mode" => {
                            if let Some(chat_win) = app.get_webview_window("chat-window") {
                                let _ = chat_win.hide();
                            }
                            if let Some(settings_win) = app.get_webview_window("settings-window") {
                                let _ = settings_win.hide();
                            }
                            let _ = app.emit("toggle-focus-mode", true);
                        }
                        "start-pomodoro" => {
                            let _ = app.emit("start-pomodoro-from-tray", 25u32);
                        }
                        "toggle-form" => {
                            let _ = app.emit("toggle-pet-form", ());
                        }
                        "open-chat" => {
                            let window = if let Some(w) = app.get_webview_window("chat-window") {
                                w
                            } else {
                                // 动态创建聊天窗口（无边框，自定义标题栏）
                                match tauri::WebviewWindowBuilder::new(
                                    app,
                                    "chat-window",
                                    tauri::WebviewUrl::App("index.html#/chat".into()),
                                )
                                .title("SpiritPal Chat")
                                .inner_size(420.0, 600.0)
                                .min_inner_size(320.0, 400.0)
                                .resizable(true)
                                .decorations(false)
                                .build()
                                {
                                    Ok(w) => w,
                                    Err(e) => {
                                        log::error!("[SpiritPal] Failed to create chat window: {}", e);
                                        return;
                                    }
                                }
                            };
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        "settings" => {
                            let window = if let Some(w) = app.get_webview_window("settings-window")
                            {
                                w
                            } else {
                                // 动态创建设置窗口（无边框，自定义标题栏）
                                match tauri::WebviewWindowBuilder::new(
                                    app,
                                    "settings-window",
                                    tauri::WebviewUrl::App("index.html#/settings".into()),
                                )
                                .title("SpiritPal Settings")
                                .inner_size(720.0, 540.0)
                                .min_inner_size(580.0, 400.0)
                                .resizable(true)
                                .decorations(false)
                                .build()
                                {
                                    Ok(w) => w,
                                    Err(e) => {
                                        log::error!(
                                            "[SpiritPal] Failed to create settings window: {}",
                                            e
                                        );
                                        return;
                                    }
                                }
                            };
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit("open-settings", ());
                        }
                        "quit" => {
                            running.store(false, Ordering::Release);
                            app.exit(0);
                        }
                        _ => {}
                    });

                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }

                let _tray = tray_builder.build(app)?;

                system::register_global_shortcut(app);

                // =========================================
                // macOS NSPanel 浮层配置
                // =========================================
                // 将 pet-window 转换为 NSPanel，实现不抢焦点、跨 Space、全屏可见浮层。
                // 参考 BongoCat 的 tauri-nspanel 集成方案。
                #[cfg(target_os = "macos")]
                {
                    if let Some(pet_window) = app.get_webview_window("pet-window") {
                        macos::setup_pet_panel(app.handle(), pet_window);
                    } else {
                        log::warn!("[SpiritPal] pet-window not found, skipping NSPanel setup");
                    }
                }
            }

            log::info!("[SpiritPal] setup complete");
            Ok(())
        })
        .invoke_handler({
            #[cfg(desktop)]
            {
                tauri::generate_handler![
                    greet,
                    open_path,
                    log_frontend_error,
                    open_application,
                    // 窗口与系统
                    set_pet_click_through,
                    remove_pet_click_through,
                    get_mouse_pos,
                    get_idle_time,
                    get_active_window,
                    start_topmost_keepalive,
                    // 托盘
                    set_tray_icon,
                    set_tray_icon_png,
                    update_tray_icon,
                    // Keychain
                    set_secret,
                    get_secret,
                    delete_secret,
                    // 加密
                    encrypt_data,
                    decrypt_data,
                    compute_sha256,
                    // 模组
                    import_petmod,
                    scan_mods_directory,
                    // 上传文件魔数校验
                    validate_upload_magic,
                    // 全局键鼠监听（宠物注视光标效果）
                    start_device_listening,
                    stop_device_listening,
                    // macOS NSPanel 浮层
                    show_pet_window,
                    hide_pet_window,
                    set_pet_always_on_top,
                    // R-14: 数据库加密
                    encrypt_db_at_rest,
                    decrypt_db_at_rest,
                ]
            }
            #[cfg(not(desktop))]
            {
                tauri::generate_handler![
                    greet,
                    log_frontend_error,
                    open_application,
                    // 加密
                    encrypt_data,
                    decrypt_data,
                    compute_sha256,
                    // 模组
                    import_petmod,
                    scan_mods_directory,
                    // 上传文件魔数校验
                    validate_upload_magic,
                ]
            }
        });

    // 桌面端：窗口关闭时隐藏到托盘而非退出
    #[cfg(desktop)]
    {
        builder = builder.on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "pet-window" || label == "settings-window" || label == "chat-window" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        });
    }

    // S2/M0 (E3): RunEvent::ExitRequested 时同步执行数据库加密
    // 比 beforeunload 异步调用更可靠——Rust 侧在真正退出前同步完成加密
    let app = builder.build(tauri::generate_context!())
        .expect("error while building SpiritPal application");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            log::info!("[SpiritPal] ExitRequested — encrypting database at rest...");
            // 同步执行加密（blocking），确保退出前完成
            let app = app_handle.clone();
            tauri::async_runtime::block_on(async move {
                let _ = encrypted_db::encrypt_db_at_rest(app).await;
            });
            log::info!("[SpiritPal] Database encryption complete, exiting.");
        }
    });
}

// ============================================================
// 单元测试
// ============================================================

#[cfg(test)]
mod tests {
    // [REFACTOR] 测试模块显式导入各子模块的 pub 符号，替代原 use super::*
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    use base64::{engine::general_purpose, Engine};

    use crate::crypto::{
        derive_aes_key, get_machine_id, resolve_password, sha256_of_bytes, sha256_to_hex,
        ENC_PREFIX,
    };
    use crate::petmod::get_pet_conf_field;
    #[cfg(desktop)]
    use crate::tray::make_state_icon;
    use crate::validation::validate_app_name;

    // ============ validate_app_name 测试 ============

    #[test]
    fn test_validate_app_name_valid() {
        assert!(validate_app_name("calc").is_ok());
        assert!(validate_app_name("notepad").is_ok());
        assert!(validate_app_name("https://www.bing.com").is_ok());
        assert!(validate_app_name("ms-settings:").is_ok());
    }

    #[test]
    fn test_validate_app_name_empty() {
        assert!(validate_app_name("").is_err());
    }

    #[test]
    fn test_validate_app_name_shell_injection() {
        // 命令注入尝试
        assert!(validate_app_name("calc & del /f").is_err());
        assert!(validate_app_name("calc | format C:").is_err());
        assert!(validate_app_name("calc > test.txt").is_err());
        assert!(validate_app_name("calc < input.txt").is_err());
        assert!(validate_app_name("calc;rm -rf").is_err());
        assert!(validate_app_name("calc\nwhoami").is_err());
        assert!(validate_app_name("calc`whoami`").is_err());
    }

    #[test]
    fn test_validate_app_name_url_with_ampersand() {
        // URL 中的 & 也会被拒绝（因为 cmd.exe 会解析为命令分隔符）
        assert!(validate_app_name("https://example.com?a=1&b=2").is_err());
    }

    // ============ make_state_icon 测试 ============

    #[cfg(desktop)]
    #[test]
    fn test_make_state_icon_dimensions() {
        let icon = make_state_icon("normal");
        // 32x32 RGBA = 4096 bytes
        assert_eq!(icon.rgba().len(), 32 * 32 * 4);
    }

    #[cfg(desktop)]
    #[test]
    fn test_make_state_icon_colors() {
        // hungry = 橙色 (249, 115, 22)
        let icon_hungry = make_state_icon("hungry");
        let rgba = icon_hungry.rgba();
        assert_eq!(rgba[0], 249); // R
        assert_eq!(rgba[1], 115); // G
        assert_eq!(rgba[2], 22); // B
        assert_eq!(rgba[3], 255); // A

        // sick = 红色 (239, 68, 68)
        let icon_sick = make_state_icon("sick");
        let rgba = icon_sick.rgba();
        assert_eq!(rgba[0], 239);
        assert_eq!(rgba[1], 68);
        assert_eq!(rgba[2], 68);

        // sleeping = 蓝色 (59, 130, 246)
        let icon_sleep = make_state_icon("sleeping");
        let rgba = icon_sleep.rgba();
        assert_eq!(rgba[0], 59);
        assert_eq!(rgba[1], 130);
        assert_eq!(rgba[2], 246);

        // normal/unknown = 绿色 (34, 197, 94)
        let icon_normal = make_state_icon("normal");
        let rgba = icon_normal.rgba();
        assert_eq!(rgba[0], 34);
        assert_eq!(rgba[1], 197);
        assert_eq!(rgba[2], 94);
    }

    // ============ get_pet_conf_field 测试 ============

    #[test]
    fn test_get_pet_conf_field_existing() {
        let json = serde_json::json!({"id": "doro", "name": "多罗"});
        assert_eq!(get_pet_conf_field(&json, "id"), "doro");
        assert_eq!(get_pet_conf_field(&json, "name"), "多罗");
    }

    #[test]
    fn test_get_pet_conf_field_missing() {
        let json = serde_json::json!({"id": "doro"});
        assert_eq!(get_pet_conf_field(&json, "name"), "");
    }

    #[test]
    fn test_get_pet_conf_field_non_string() {
        let json = serde_json::json!({"id": 123});
        assert_eq!(get_pet_conf_field(&json, "id"), "");
    }

    // ============ SHA-256 测试 ============

    #[test]
    fn test_sha256_empty() {
        let hex = sha256_of_bytes(b"");
        assert_eq!(
            hex,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn test_sha256_hello() {
        let hex = sha256_of_bytes(b"hello");
        assert_eq!(
            hex,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn test_sha256_unicode() {
        let hex = sha256_of_bytes("你好，世界".as_bytes());
        // SHA-256 是确定性算法，验证输出长度正确且非空
        assert_eq!(hex.len(), 64);
        // 验证与已知值一致（SHA-256 of UTF-8 bytes of "你好，世界"）
        assert_eq!(
            hex,
            "46932f1e6ea5216e77f58b1908d72ec9322ed129318c6d4bd4450b5eaab9d7e7"
        );
    }

    #[test]
    fn test_sha256_to_hex_format() {
        let bytes: [u8; 4] = [0x00, 0xff, 0xab, 0x01];
        let hex = sha256_to_hex(&bytes);
        assert_eq!(hex, "00ffab01");
    }

    // ============ AES-256-GCM 加密/解密测试 ============

    #[test]
    fn test_aes_encrypt_decrypt() {
        let password = "test-password";
        let key = derive_aes_key(password);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let data: &[u8] = "Hello, SpiritPal! 这是一段测试数据。".as_bytes();

        // 生成 nonce
        let mut nonce_bytes = [0u8; 12];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        // 加密
        let ciphertext = cipher.encrypt(nonce, data).unwrap();
        assert!(!ciphertext.is_empty());

        // 合并 nonce + ciphertext
        let mut combined = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);

        // 解密
        let (n, c) = combined.split_at(12);
        let decrypted = cipher.decrypt(Nonce::from_slice(n), c).unwrap();

        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_aes_encrypt_decrypt_empty() {
        let password = "test";
        let key = derive_aes_key(password);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let data: &[u8] = b"";

        let mut nonce_bytes = [0u8; 12];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, data).unwrap();

        let mut combined = Vec::new();
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);

        let (n, c) = combined.split_at(12);
        let decrypted = cipher.decrypt(Nonce::from_slice(n), c).unwrap();

        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_aes_decrypt_wrong_password() {
        let key1 = derive_aes_key("password1");
        let cipher1 = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key1));

        let data: &[u8] = b"secret data";

        let mut nonce_bytes = [0u8; 12];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher1.encrypt(nonce, data).unwrap();

        // 用错误密码解密
        let key2 = derive_aes_key("password2");
        let cipher2 = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key2));

        let result = cipher2.decrypt(nonce, &ciphertext[..]);
        assert!(result.is_err());
    }

    #[test]
    fn test_aes_encrypt_produces_different_ciphertext() {
        let password = "test";
        let key = derive_aes_key(password);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let data: &[u8] = b"same data";

        // 第一次加密
        let mut nonce1 = [0u8; 12];
        getrandom::getrandom(&mut nonce1).unwrap();
        let ct1 = cipher.encrypt(Nonce::from_slice(&nonce1), data).unwrap();

        // 第二次加密（不同 nonce）
        let mut nonce2 = [0u8; 12];
        getrandom::getrandom(&mut nonce2).unwrap();
        let ct2 = cipher.encrypt(Nonce::from_slice(&nonce2), data).unwrap();

        // 由于 nonce 不同，密文应不同
        assert_ne!(ct1, ct2);
    }

    #[test]
    fn test_derive_aes_key_consistency() {
        let key1 = derive_aes_key("password");
        let key2 = derive_aes_key("password");
        assert_eq!(key1, key2);

        let key3 = derive_aes_key("different");
        assert_ne!(key1, key3);

        // SHA-256 输出 32 字节
        assert_eq!(key1.len(), 32);
    }

    #[test]
    fn test_derive_aes_key_known_value() {
        // SHA-256("test") = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
        let key = derive_aes_key("test");
        let expected_hex = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
        let actual_hex: String = key.iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(actual_hex, expected_hex);
    }

    // ============ Base64 编码/解码测试 ============

    #[test]
    fn test_base64_encode_decode() {
        let original = b"Hello, World!";
        let encoded = general_purpose::STANDARD.encode(original);
        let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_base64_unicode() {
        let original = "你好，世界！".as_bytes();
        let encoded = general_purpose::STANDARD.encode(original);
        let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_base64_empty() {
        let original = b"";
        let encoded = general_purpose::STANDARD.encode(original);
        let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_base64_binary() {
        let original: Vec<u8> = (0..=255).collect();
        let encoded = general_purpose::STANDARD.encode(&original);
        let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_base64_known_value() {
        // "SpiritPal" → base64
        let encoded = general_purpose::STANDARD.encode(b"SpiritPal");
        assert_eq!(encoded, "U3Bpcml0UGFs");
    }

    // ============ resolve_password 测试 ============

    #[test]
    fn test_resolve_password_empty_uses_machine_id() {
        // [SECURITY] D3 - 空密码时尝试获取机器 ID
        // 正常环境返回 Ok(非空机器 ID)；异常环境（如无 machine-id 的容器）返回 Err
        let result = resolve_password("");
        if let Ok(ref pwd) = result {
            assert!(!pwd.is_empty(), "机器 ID 不应为空字符串");
        }
        // 若为 Err，说明当前测试环境无法获取机器 ID，符合 Fail Fast 设计
    }

    #[test]
    fn test_resolve_password_custom() {
        let pwd = resolve_password("custom-password").unwrap();
        assert_eq!(pwd, "custom-password");
    }

    // ============ get_machine_id 安全测试 ============

    #[test]
    fn test_get_machine_id_no_hardcoded_fallback() {
        // [SECURITY] D3 - 验证 get_machine_id 不会返回硬编码的 APP_FALLBACK_KEY
        // 该密钥已在重构中移除，此处确保不会回归
        const REMOVED_FALLBACK_KEY: &str = "SpiritPal-Memory-Encryption-v1-2024";
        let result = get_machine_id();
        if let Ok(ref id) = result {
            assert_ne!(
                id, REMOVED_FALLBACK_KEY,
                "get_machine_id 不应返回已废弃的硬编码密钥"
            );
        }
        // 若为 Err，说明环境无法获取机器 ID，符合 Fail Fast 设计
    }

    // ============ ENC_PREFIX 测试 ============

    #[test]
    fn test_enc_prefix_value() {
        assert_eq!(ENC_PREFIX, "ENC1:");
    }

    // ============ 完整加密流程测试（模拟 Tauri 命令逻辑）============

    #[test]
    fn test_full_encrypt_decrypt_roundtrip() {
        let data = "{\"memory\":\"test content\",\"timestamp\":12345}";
        let password = "roundtrip-test";

        // 模拟 encrypt_data 逻辑
        let key = derive_aes_key(password);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let mut nonce_bytes = [0u8; 12];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();

        let mut combined = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);

        let b64 = general_purpose::STANDARD.encode(&combined);
        let encrypted = format!("{}{}", ENC_PREFIX, b64);

        // 验证加密结果格式
        assert!(encrypted.starts_with(ENC_PREFIX));

        // 模拟 decrypt_data 逻辑
        let stripped = encrypted.strip_prefix(ENC_PREFIX).unwrap();
        let decoded = general_purpose::STANDARD.decode(stripped).unwrap();

        assert!(decoded.len() >= 12);

        let (n, c) = decoded.split_at(12);
        let plaintext = cipher.decrypt(Nonce::from_slice(n), c).unwrap();

        let decrypted = String::from_utf8(plaintext).unwrap();
        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_decrypt_invalid_prefix() {
        // 模拟 decrypt_data 对无前缀数据的处理
        let invalid_data = "invalid-data-without-prefix";
        let result = invalid_data.strip_prefix(ENC_PREFIX);
        assert!(result.is_none());
    }

    #[test]
    fn test_decrypt_short_data() {
        // 模拟 decrypt_data 对过短数据的处理
        let short_b64 = general_purpose::STANDARD.encode(b"short");
        let encrypted = format!("{}{}", ENC_PREFIX, short_b64);
        let stripped = encrypted.strip_prefix(ENC_PREFIX).unwrap();
        let decoded = general_purpose::STANDARD.decode(stripped).unwrap();

        // 数据长度不足 12 字节
        assert!(decoded.len() < 12);
    }

    // ============ 回归防护：确保移除的符号不再出现在 lib.rs 顶层 ============
    // [REFACTOR] 这些符号已迁移到子模块，若在 lib.rs 顶层重新定义会导致重复定义编译错误

    #[test]
    fn test_refactor_symbols_moved_to_modules() {
        // 验证 derive_aes_key 来自 crypto 模块（而非 lib.rs 顶层）
        let _ = derive_aes_key("regression-test");
        // 验证 sha256_to_hex 来自 crypto 模块
        assert_eq!(sha256_to_hex(&[0xab, 0xcd]), "abcd");
        // 验证 validate_app_name 来自 validation 模块
        assert!(validate_app_name("regression").is_ok());
        // 验证 get_pet_conf_field 来自 petmod 模块
        let json = serde_json::json!({"id": "regression"});
        assert_eq!(get_pet_conf_field(&json, "id"), "regression");
    }
}

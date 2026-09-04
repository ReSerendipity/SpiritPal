//! 窗口 / 通用命令（M1 拆分：自 lib.rs 迁出）
//!
//! 包含：
//! - 通用命令：`greet` / `log_frontend_error` / `open_application` / `open_path`
//! - 窗口配置单一事实来源：`window_config` / `get_window_config` / `build_configured_window`（S3 / ADR-0004）
//! - 角色包 / 素材管线 / 魔数校验命令：`scan_character_directory` / `read_text_file` /
//!   `detect_asset_tools` / `run_asset_pipeline` / `validate_upload_magic`
//! - 桌面端窗口命令：`set/remove_pet_click_through` / `get_mouse_pos` / `get_idle_time` /
//!   `get_active_window` / `start_topmost_keepalive`
//! - macOS NSPanel 浮层：`show/hide_pet_window` / `set_pet_always_on_top`

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[cfg(desktop)]
use tauri::{Manager, WebviewWindow};
#[cfg(windows)]
use windows::Win32::Foundation::HWND;

use crate::asset_pipeline;
use crate::character_import;
use crate::magic_check;
use crate::validation;

#[cfg(desktop)]
use crate::win32;
#[cfg(target_os = "macos")]
use crate::macos;

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
pub fn greet() -> String {
    "Hello from SpiritPal".to_string()
}

// ============ 窗口配置单一事实来源（S3）============
// 前端 appWindows.ts 通过 get_window_config 查询本表；Rust 托盘/setup 创建窗口统一走
// build_configured_window，消除「前端 WINDOW_CONFIGS 与 Rust 两处各自维护窗口参数」的双源漂移
// （曾导致前端创建的窗口无法最大化/边缘缩放的历史 bug，见 appWindows.ts 源码注释）。

#[derive(serde::Serialize)]
pub struct WindowConfigDto {
    title: String,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    max_width: Option<f64>,
    max_height: Option<f64>,
    resizable: bool,
    decorations: bool,
    transparent: bool,
    always_on_top: bool,
    skip_taskbar: bool,
    shadow: bool,
    background_color: Option<String>,
    url: String,
}

/// 窗口参数权威表（字段私有：外部只能经 `get_window_config` 取 DTO，防绕过单一事实源）
pub struct WindowConfig {
    title: &'static str,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    max_width: Option<f64>,
    max_height: Option<f64>,
    resizable: bool,
    decorations: bool,
    transparent: bool,
    always_on_top: bool,
    skip_taskbar: bool,
    shadow: bool,
    background_color: Option<&'static str>,
    url: &'static str,
}

impl WindowConfig {
    fn into_dto(self) -> WindowConfigDto {
        WindowConfigDto {
            title: self.title.to_string(),
            width: self.width,
            height: self.height,
            min_width: self.min_width,
            min_height: self.min_height,
            max_width: self.max_width,
            max_height: self.max_height,
            resizable: self.resizable,
            decorations: self.decorations,
            transparent: self.transparent,
            always_on_top: self.always_on_top,
            skip_taskbar: self.skip_taskbar,
            shadow: self.shadow,
            background_color: self.background_color.map(|s| s.to_string()),
            url: self.url.to_string(),
        }
    }
}

/// 窗口参数权威表：托盘/setup 创建与前端 ensureAppWindow 共用
pub fn window_config(label: &str) -> Option<WindowConfig> {
    Some(match label {
        "pet-window" => WindowConfig {
            title: "SpiritPal",
            width: 224.0,
            height: 304.0,
            min_width: 160.0,
            min_height: 200.0,
            max_width: Some(720.0),
            max_height: Some(900.0),
            resizable: true,
            decorations: false,
            transparent: true,
            always_on_top: true,
            skip_taskbar: true,
            shadow: false,
            background_color: None,
            url: "index.html#/pet",
        },
        "chat-window" => WindowConfig {
            title: "SpiritPal Chat",
            width: 420.0,
            height: 600.0,
            min_width: 320.0,
            min_height: 400.0,
            max_width: None,
            max_height: None,
            resizable: true,
            decorations: false,
            transparent: false,
            always_on_top: false,
            skip_taskbar: false,
            shadow: true,
            background_color: Some("#fdf6ec"),
            url: "index.html#/chat",
        },
        "settings-window" => WindowConfig {
            title: "SpiritPal Settings",
            width: 720.0,
            height: 540.0,
            min_width: 580.0,
            min_height: 400.0,
            max_width: None,
            max_height: None,
            resizable: true,
            decorations: false,
            transparent: false,
            always_on_top: false,
            skip_taskbar: false,
            shadow: true,
            background_color: Some("#fdf6ec"),
            url: "index.html#/settings",
        },
        _ => return None,
    })
}

/// 查询窗口配置（前端 appWindows.ensureAppWindow 消费，替代前端自带 WINDOW_CONFIGS）
#[tauri::command]
pub fn get_window_config(label: String) -> Option<WindowConfigDto> {
    window_config(&label).map(WindowConfig::into_dto)
}

/// 解析 "#RRGGBB" 为 tauri::window::Color
/// 注意：tauri 2.x 的 Color 是元组结构体 `Color(pub u8, pub u8, pub u8, pub u8)`
pub fn parse_hex_color(hex: &str) -> tauri::window::Color {
    let hex = hex.trim_start_matches('#');
    let digits = &hex[..hex.len().min(6)];
    let val = u32::from_str_radix(digits, 16).unwrap_or(0);
    tauri::window::Color(
        ((val >> 16) & 0xFF) as u8,
        ((val >> 8) & 0xFF) as u8,
        (val & 0xFF) as u8,
        255,
    )
}

/// 按权威表创建窗口：托盘/setup 各创建点统一入口
pub fn build_configured_window(
    app: &tauri::AppHandle,
    label: &str,
) -> tauri::Result<Option<tauri::WebviewWindow>> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let Some(cfg) = window_config(label) else {
        return Ok(None);
    };
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(cfg.url.into()))
        .title(cfg.title)
        .inner_size(cfg.width, cfg.height)
        .min_inner_size(cfg.min_width, cfg.min_height)
        .resizable(cfg.resizable)
        .decorations(cfg.decorations)
        .transparent(cfg.transparent)
        .always_on_top(cfg.always_on_top)
        .skip_taskbar(cfg.skip_taskbar)
        .shadow(cfg.shadow);
    if let (Some(max_w), Some(max_h)) = (cfg.max_width, cfg.max_height) {
        builder = builder.max_inner_size(max_w, max_h);
    }
    let win = builder.build()?;
    // WebviewWindowBuilder 无 background_color 方法（tauri v2），建后运行时可设置
    if let Some(bg) = cfg.background_color {
        let _ = win.set_background_color(Some(parse_hex_color(bg)));
    }
    Ok(Some(win))
}

/// 打开系统文件管理器定位到指定路径（Windows 使用 explorer）
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
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

// P1-2: 角色包导入命令
/// 扫描角色资源目录，返回包含 pet.json 的子目录路径列表
///
/// 安全措施：拒绝 `..` 路径组件，防止目录穿越攻击。
///
/// 前端调用方式：`invoke('scan_character_directory', { path: string })`
#[tauri::command]
pub fn scan_character_directory(path: String) -> Result<Vec<String>, String> {
    character_import::scan_character_directory(&path)
}

/// 读取文本文件内容（限定为角色包 JSON/文本）
///
/// 安全措施：拒绝 `..` 路径组件，防止目录穿越攻击。
/// 文件大小限制 1MB，防止读取超大文件导致内存溢出。
///
/// 前端调用方式：`invoke('read_text_file', { path: string })`
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    character_import::read_text_file(&path)
}

/// P2: 检测本机 python / ffmpeg 是否在 PATH
#[tauri::command]
pub fn detect_asset_tools() -> asset_pipeline::ToolDetectionResult {
    asset_pipeline::detect_asset_tools()
}

/// P2: 安全执行 asset-pipeline 脚本（白名单 + 参数强校验）
#[tauri::command]
pub fn run_asset_pipeline(
    script_name: String,
    args: Vec<String>,
) -> Result<asset_pipeline::PipelineRunResult, String> {
    asset_pipeline::run_asset_pipeline(&script_name, &args)
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
pub fn log_frontend_error(level: String, message: String) {
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
pub fn validate_upload_magic(contents: Vec<u8>, file_ext: String) -> Result<bool, String> {
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
pub async fn open_application(app_name: String) -> Result<(), String> {
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
pub fn set_pet_click_through(window: WebviewWindow) -> Result<(), String> {
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
pub fn remove_pet_click_through(window: WebviewWindow) -> Result<(), String> {
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
pub fn get_mouse_pos(_app: tauri::AppHandle, window: WebviewWindow) -> Result<(f64, f64), String> {
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
        // WHY 形参名是 `_app`（带下划线前缀）而非 `app`：Windows 分支不使用该
        // 句柄，下划线前缀用于抑制 unused 警告；非 Windows 分支显式消费它时
        // 必须写全名 `_app`。此前误写成 `app` 导致 error[E0425]，而该分支仅在
        // Linux/macOS 生效 —— 于是 Windows 本地开发与 CI 上的 Windows job 全绿，
        // Linux job 才编译失败，属于典型的「平台条件编译盲区」。
        let _ = _app;
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
pub fn get_idle_time() -> u64 {
    win32::get_idle_ms()
}

/// 前台窗口信息
///
/// 包含当前前台窗口的标题和进程名。
#[cfg(desktop)]
#[derive(serde::Serialize, Debug)]
pub struct ActiveWindowInfo {
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
pub fn get_active_window() -> ActiveWindowInfo {
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
// 仅在桌面端使用（AtomicBool/Ordering 只在 desktop cfg 下导入），移动端不编译此静态。
#[cfg(desktop)]
#[allow(dead_code)]
pub static TOPMOST_KEEPALIVE_STARTED: AtomicBool = AtomicBool::new(false);

#[cfg(desktop)]
#[tauri::command]
pub fn start_topmost_keepalive(app: tauri::AppHandle, _window: WebviewWindow) -> Result<(), String> {
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
pub async fn show_pet_window(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
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
pub async fn hide_pet_window(_app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if window.label() == "pet-window" {
            macos::set_pet_panel_visibility(&_app, false);
            return Ok(());
        }
    }
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
pub async fn set_pet_always_on_top(
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

#[cfg(test)]
mod tests {
    use super::*;

    // ============ 窗口配置单一事实来源测试（S3 / ADR-0004） ============
    // 锁关键字段以防前后端双源漂移（曾因不一致导致窗口无法最大化）。

    #[test]
    fn test_window_config_single_source_of_truth() {
        let settings = window_config("settings-window").expect("settings-window 配置必须存在");
        assert_eq!(settings.url, "index.html#/settings");
        assert_eq!(settings.width, 720.0);
        assert_eq!(settings.height, 540.0);
        assert_eq!(settings.min_width, 580.0);
        assert_eq!(settings.min_height, 400.0);
        assert!(settings.resizable);
        assert!(!settings.decorations);
        assert_eq!(settings.background_color, Some("#fdf6ec"));

        let chat = window_config("chat-window").expect("chat-window 配置必须存在");
        assert_eq!(chat.url, "index.html#/chat");
        assert_eq!(chat.width, 420.0);
        assert_eq!(chat.min_height, 400.0);
        assert!(chat.resizable);

        let pet = window_config("pet-window").expect("pet-window 配置必须存在");
        assert_eq!(pet.url, "index.html#/pet");
        assert!(pet.transparent);
        assert!(pet.always_on_top);
        assert_eq!(pet.max_width, Some(720.0));
        assert_eq!(pet.max_height, Some(900.0));

        assert!(window_config("unknown-window").is_none());
    }

    #[test]
    fn test_window_config_dto_roundtrip() {
        let dto = get_window_config("settings-window".to_string()).expect("配置转 DTO 必须成功");
        assert_eq!(dto.title, "SpiritPal Settings");
        assert_eq!(dto.background_color.as_deref(), Some("#fdf6ec"));
        // 前端 ensureAppWindow 依赖的字段必须齐全
        assert!(dto.resizable);
        assert!(!dto.transparent);
    }

    // ============ validate_upload_magic 命令测试（P1-4 补测） ============
    // 命令为纯逻辑薄包装（不依赖 tauri 运行时），任何失败均 fail-closed 返回 Ok(false)。

    #[test]
    fn test_validate_upload_magic_matches() {
        let png: Vec<u8> = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
        assert_eq!(super::validate_upload_magic(png, ".png".into()), Ok(true));
        let zip: Vec<u8> = b"PK\x03\x04\x14\x00\x00\x00\x08\x00".to_vec();
        assert_eq!(super::validate_upload_magic(zip, ".petmod".into()), Ok(true));
    }

    #[test]
    fn test_validate_upload_magic_mismatch_returns_false() {
        // 伪装文件：声明 png 实为 PE 可执行文件 → Ok(false)（fail-closed，不 panic）
        let fake: Vec<u8> = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00".to_vec();
        assert_eq!(super::validate_upload_magic(fake, ".png".into()), Ok(false));
    }

    #[test]
    fn test_validate_upload_magic_unknown_ext_returns_false() {
        let png: Vec<u8> = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
        assert_eq!(super::validate_upload_magic(png.clone(), ".exe".into()), Ok(false));
        assert_eq!(super::validate_upload_magic(png, "png".into()), Ok(false));
    }
}
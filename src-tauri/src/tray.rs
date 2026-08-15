//! 系统托盘菜单 + 图标管理模块
//!
//! [REFACTOR] 从 lib.rs 拆分，职责单一化
//!
//! # 包含功能
//! - 托盘菜单构建（显示/隐藏/专注模式/番茄钟/聊天/设置/退出）
//! - 托盘图标切换（normal/hungry/sleeping/sick/happy/processing）
//! - 状态图标生成（32×32 纯色 RGBA）
//!
//! # 提供的 Tauri 命令
//! - [`set_tray_icon`] — 设置托盘图标（指定图片路径）
//! - [`update_tray_icon`] — 根据宠物状态切换托盘图标

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

// ============ 常量 ============

/// 托盘图标尺寸（32×32 像素）
// [OPTIMIZE] A3 - 抽取魔法数字为具名常量
#[cfg(desktop)]
const TRAY_ICON_SIZE: u32 = 32;

// ============ 状态图标生成 ============

/// 根据状态生成 32×32 纯色 RGBA 图标
///
/// 使用 `extend_from_slice` 批量填充像素，比逐个 push 更高效。
/// Chapter 11 增强：支持 happy 和 processing 状态图标。
///
/// # Arguments
/// - `state` — 宠物状态字符串
///   - `"normal"` / 其他 — 绿色 (34, 197, 94)
///   - `"hungry"` — 橙色 (249, 115, 22)
///   - `"sleeping"` — 蓝色 (59, 130, 246)
///   - `"sick"` — 红色 (239, 68, 68)
///   - `"happy"` — 粉色 (236, 72, 153)
///   - `"processing"` — 紫色 (168, 85, 247)，AI 处理中
///
/// # Returns
/// Tauri Image 对象，包含 32×32 RGBA 像素数据
// [Quality Review] 使用 extend_from_slice 批量填充，比逐个 push 更高效
// Chapter 11 增强：支持 happy 和 processing 状态图标
#[cfg(desktop)]
pub fn make_state_icon(state: &str) -> tauri::image::Image<'_> {
    // [OPTIMIZE] A3 - 颜色常量内联，便于维护
    let (r, g, b) = match state {
        "hungry" => (249u8, 115u8, 22u8),     // 橙
        "sleeping" => (59u8, 130u8, 246u8),   // 蓝
        "sick" => (239u8, 68u8, 68u8),        // 红
        "happy" => (236u8, 72u8, 153u8),      // 粉
        "processing" => (168u8, 85u8, 247u8), // 紫（AI 处理中）
        _ => (34u8, 197u8, 94u8),             // 正常：绿
    };
    let total = (TRAY_ICON_SIZE * TRAY_ICON_SIZE) as usize;
    // 预分配全部容量，避免 Vec 扩容
    let mut rgba = Vec::with_capacity(total * 4);
    // 使用 extend + repeat 批量填充，比逐个 push 更高效
    let pixel = [r, g, b, 255u8];
    for _ in 0..total {
        rgba.extend_from_slice(&pixel);
    }
    tauri::image::Image::new_owned(rgba, TRAY_ICON_SIZE, TRAY_ICON_SIZE)
}

// ============ Tauri 命令 ============

/// 设置托盘图标（指定图片路径）
///
/// 前端调用方式：`invoke('set_tray_icon', { path: string })`
///
/// # Arguments
/// - `app` — Tauri 应用句柄（自动注入）
/// - `path` — 图标文件绝对路径（PNG/ICO 格式）
///
/// # Returns
/// - `Ok(())` — 设置成功
/// - `Err(String)` — 托盘不存在、图片加载失败或设置失败
#[cfg(desktop)]
#[tauri::command]
pub fn set_tray_icon(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| "tray icon 'main' not found".to_string())?;
    let icon = tauri::image::Image::from_path(&path).map_err(|e| e.to_string())?;
    tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    Ok(())
}

/// 切换托盘图标（根据宠物状态）
///
/// - `normal` 状态恢复为默认应用图标
/// - 其他状态使用 [`make_state_icon`] 生成纯色状态图标
/// - 同时更新托盘 tooltip 显示宠物状态
///
/// 前端调用方式：`invoke('update_tray_icon', { state: string })`
///
/// # Arguments
/// - `app` — Tauri 应用句柄（自动注入）
/// - `state` — 宠物状态：`normal` / `hungry` / `sleeping` / `sick` / `happy` / `processing`
///
/// # Returns
/// - `Ok(())` — 更新成功
/// - `Err(String)` — 托盘不存在或默认图标未找到
#[cfg(desktop)]
#[tauri::command]
pub fn update_tray_icon(app: tauri::AppHandle, state: String) -> Result<(), String> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| "tray icon 'main' not found".to_string())?;
    let icon = if state == "normal" {
        // 恢复默认应用图标
        app.default_window_icon()
            .ok_or_else(|| "default icon not found".to_string())?
            .clone()
    } else {
        make_state_icon(&state)
    };
    tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    // 同步更新 tooltip
    let tooltip = match state.as_str() {
        "hungry" => "SpiritPal — 饿了",
        "sleeping" => "SpiritPal — 睡觉中",
        "sick" => "SpiritPal — 生病了",
        "happy" => "SpiritPal — 开心",
        "processing" => "SpiritPal — 思考中…",
        _ => "SpiritPal",
    };
    tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
    Ok(())
}

// ============ 托盘菜单构建 ============

/// 构建系统托盘菜单
///
/// [Quality Review] 从 `run()` 中提取，降低圈复杂度。
///
/// 菜单项：
/// - 显示宠物（show）
/// - 隐藏宠物（hide）
/// - --- 分隔符 ---
/// - 专注模式（focus-mode）
/// - 开始番茄钟 (25分钟)（start-pomodoro）
/// - --- 分隔符 ---
/// - 打开聊天（open-chat）
/// - 设置（settings）
/// - --- 分隔符 ---
/// - 退出（quit）
///
/// # Arguments
/// - `app` — Tauri 应用引用
///
/// # Returns
/// - `Ok(Menu<Wry>)` — 构建好的菜单
/// - `Err(tauri::Error)` — 菜单项创建失败
#[cfg(desktop)]
pub fn build_tray_menu(app: &tauri::App) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let show = MenuItem::with_id(app, "show", "显示宠物", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏宠物", true, None::<&str>)?;
    let separator1 = PredefinedMenuItem::separator(app)?;
    let focus_mode = MenuItem::with_id(app, "focus-mode", "专注模式", true, None::<&str>)?;
    let start_pomodoro = MenuItem::with_id(
        app,
        "start-pomodoro",
        "开始番茄钟 (25分钟)",
        true,
        None::<&str>,
    )?;
    let toggle_form = MenuItem::with_id(
        app,
        "toggle-form",
        "切换形态 (窗口/漫游)",
        true,
        None::<&str>,
    )?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let chat = MenuItem::with_id(app, "open-chat", "打开聊天", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let separator3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &separator1,
            &focus_mode,
            &start_pomodoro,
            &toggle_form,
            &separator2,
            &chat,
            &settings,
            &separator3,
            &quit,
        ],
    )
}

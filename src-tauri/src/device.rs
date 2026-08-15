//! 全局键鼠监听模块（宠物注视光标效果）
//!
//! 参考 BongoCat src-tauri/src/core/device.rs
//!
//! # 功能
//! - 使用 `rdev::listen()` 全局监听键鼠事件
//! - 捕获 MouseMove → 发送 `device-mouse-move` 事件（宠物注视光标）
//! - 捕获 KeyPress → 发送 `device-key-press` 事件（感知用户活动）
//! - 捕获 ButtonPress → 发送 `device-mouse-press` 事件（感知用户点击）
//! - `IS_LISTENING` AtomicBool 防止重复监听
//!
//! # 提供的 Tauri 命令
//! - [`start_device_listening`] — 启动全局键鼠监听
//! - [`stop_device_listening`] — 停止全局键鼠监听
//!
//! # 重要提示
//! - macOS 需要授予「输入监视」权限（系统偏好设置 → 隐私与安全性 → 输入监视）
//! - 此监听器默认不启动，需由前端通过 `start_device_listening` 命令主动启用
//! - rdev 使用 fork 版本 (<https://github.com/kunkunsh/rdev>) 以获得更好的跨平台支持
//! - fork 版本 API 与 crates.io 版本有差异：`Button` 而非 `ButtonType`，方向键为 `*Arrow`

#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(desktop)]
use tauri::Emitter;

/// 全局监听标志 — 防止重复启动 rdev::listen
#[cfg(desktop)]
static IS_LISTENING: AtomicBool = AtomicBool::new(false);

// ============ 事件载荷类型 ============

/// 鼠标移动事件载荷
///
/// 包含鼠标光标在屏幕上的坐标，用于实现宠物注视光标效果。
#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseMovePayload {
    /// 鼠标 X 坐标（屏幕坐标）
    pub x: f64,
    /// 鼠标 Y 坐标（屏幕坐标）
    pub y: f64,
}

/// 鼠标按键事件载荷
///
/// 包含鼠标点击位置和按键类型，用于感知用户点击活动。
#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MousePressPayload {
    /// 鼠标 X 坐标（屏幕坐标，ButtonPress 事件不携带坐标时为 0.0）
    pub x: f64,
    /// 鼠标 Y 坐标（屏幕坐标，ButtonPress 事件不携带坐标时为 0.0）
    pub y: f64,
    /// 鼠标按键：`left` / `right` / `middle` / `other`
    pub button: String,
}

/// 键盘按键事件载荷
///
/// 包含用户按下的键名，用于感知用户键盘活动。
#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPressPayload {
    /// 按键名称，如 "A"、"Enter"、"Space"、"Up" 等
    pub key: String,
}

// ============ 辅助函数 ============

/// 将 rdev::Button 转为可读字符串
///
/// rdev fork 版本使用 Button 枚举（非 crates.io 版本的 ButtonType）。
///
/// # Arguments
/// - `button` — rdev 鼠标按键枚举值
///
/// # Returns
/// 按键字符串：`left` / `right` / `middle` / `other`
#[cfg(desktop)]
fn button_to_string(button: rdev::Button) -> String {
    match button {
        rdev::Button::Left => "left".to_string(),
        rdev::Button::Right => "right".to_string(),
        rdev::Button::Middle => "middle".to_string(),
        _ => "other".to_string(),
    }
}

/// 将 rdev::Key 转为可读字符串
///
/// 只返回常见按键名称，未知键返回 "Unknown"。
///
/// 注意：rdev fork 版本的方向键为 `Key::UpArrow` / `DownArrow` / `LeftArrow` / `RightArrow`。
///
/// # Arguments
/// - `key` — rdev 键盘按键枚举值
///
/// # Returns
/// 按键名称字符串，如 "A"、"Enter"、"Space" 等
#[cfg(desktop)]
fn key_to_string(key: rdev::Key) -> String {
    match key {
        rdev::Key::KeyA => "A".to_string(),
        rdev::Key::KeyB => "B".to_string(),
        rdev::Key::KeyC => "C".to_string(),
        rdev::Key::KeyD => "D".to_string(),
        rdev::Key::KeyE => "E".to_string(),
        rdev::Key::KeyF => "F".to_string(),
        rdev::Key::KeyG => "G".to_string(),
        rdev::Key::KeyH => "H".to_string(),
        rdev::Key::KeyI => "I".to_string(),
        rdev::Key::KeyJ => "J".to_string(),
        rdev::Key::KeyK => "K".to_string(),
        rdev::Key::KeyL => "L".to_string(),
        rdev::Key::KeyM => "M".to_string(),
        rdev::Key::KeyN => "N".to_string(),
        rdev::Key::KeyO => "O".to_string(),
        rdev::Key::KeyP => "P".to_string(),
        rdev::Key::KeyQ => "Q".to_string(),
        rdev::Key::KeyR => "R".to_string(),
        rdev::Key::KeyS => "S".to_string(),
        rdev::Key::KeyT => "T".to_string(),
        rdev::Key::KeyU => "U".to_string(),
        rdev::Key::KeyV => "V".to_string(),
        rdev::Key::KeyW => "W".to_string(),
        rdev::Key::KeyX => "X".to_string(),
        rdev::Key::KeyY => "Y".to_string(),
        rdev::Key::KeyZ => "Z".to_string(),
        rdev::Key::Num0 => "0".to_string(),
        rdev::Key::Num1 => "1".to_string(),
        rdev::Key::Num2 => "2".to_string(),
        rdev::Key::Num3 => "3".to_string(),
        rdev::Key::Num4 => "4".to_string(),
        rdev::Key::Num5 => "5".to_string(),
        rdev::Key::Num6 => "6".to_string(),
        rdev::Key::Num7 => "7".to_string(),
        rdev::Key::Num8 => "8".to_string(),
        rdev::Key::Num9 => "9".to_string(),
        rdev::Key::Space => "Space".to_string(),
        rdev::Key::Return => "Enter".to_string(),
        rdev::Key::Escape => "Escape".to_string(),
        rdev::Key::Backspace => "Backspace".to_string(),
        rdev::Key::Tab => "Tab".to_string(),
        rdev::Key::ShiftLeft | rdev::Key::ShiftRight => "Shift".to_string(),
        rdev::Key::ControlLeft | rdev::Key::ControlRight => "Ctrl".to_string(),
        rdev::Key::Alt => "Alt".to_string(),
        rdev::Key::MetaLeft | rdev::Key::MetaRight => "Meta".to_string(),
        rdev::Key::UpArrow => "Up".to_string(),
        rdev::Key::DownArrow => "Down".to_string(),
        rdev::Key::LeftArrow => "Left".to_string(),
        rdev::Key::RightArrow => "Right".to_string(),
        rdev::Key::F1 => "F1".to_string(),
        rdev::Key::F2 => "F2".to_string(),
        rdev::Key::F3 => "F3".to_string(),
        rdev::Key::F4 => "F4".to_string(),
        rdev::Key::F5 => "F5".to_string(),
        rdev::Key::F6 => "F6".to_string(),
        rdev::Key::F7 => "F7".to_string(),
        rdev::Key::F8 => "F8".to_string(),
        rdev::Key::F9 => "F9".to_string(),
        rdev::Key::F10 => "F10".to_string(),
        rdev::Key::F11 => "F11".to_string(),
        rdev::Key::F12 => "F12".to_string(),
        _ => "Unknown".to_string(),
    }
}

// ============ Tauri 命令 ============

/// 启动全局键鼠监听
///
/// 参考 BongoCat：使用 `rdev::listen(callback)` 在独立线程中监听全局键鼠事件，
/// 通过 `app_handle.emit()` 将事件推送到前端。
///
/// 前端调用方式：`invoke('start_device_listening')`
///
/// # 安全说明
/// - macOS 需要用户在「系统偏好设置 → 隐私与安全性 → 输入监视」中授予权限
/// - `IS_LISTENING` AtomicBool 防止重复监听
/// - 监听器在独立线程中运行，不会阻塞主线程
///
/// # 发送的前端事件
/// - `device-mouse-move` — 鼠标移动，payload: `{ x: f64, y: f64 }`
/// - `device-mouse-press` — 鼠标点击，payload: `{ x: f64, y: f64, button: string }`
/// - `device-key-press` — 键盘按键，payload: `{ key: string }`
/// - `device-listen-error` — 监听错误，payload: `string`（错误消息）
///
/// # Returns
/// - `Ok(())` — 监听器启动成功（或已在运行）
/// - 监听失败通过 `device-listen-error` 事件异步通知
#[cfg(desktop)]
#[tauri::command]
pub fn start_device_listening(app_handle: tauri::AppHandle) -> Result<(), String> {
    // 检查是否已在监听
    if IS_LISTENING.load(Ordering::Acquire) {
        log::warn!("[Device] listener already running, skipping duplicate start");
        return Ok(());
    }

    IS_LISTENING.store(true, Ordering::Release);
    log::info!("[Device] starting global input listener");

    // rdev::listen 是阻塞调用，需要在线程中运行
    // rdev 的回调闭包是 FnMut，app_handle 被 move 进去后无法在外层再使用
    // 因此需要 clone 一份 app_handle 供 rdev::listen 返回后的错误处理使用
    let app_handle_for_error = app_handle.clone();

    std::thread::spawn(move || {
        // rdev::listen 的回调闭包会多次调用，app_handle 在此被 move 进闭包
        let result = rdev::listen(move |event| {
            // 如果标志被清除，停止处理事件
            if !IS_LISTENING.load(Ordering::Acquire) {
                return;
            }

            match event.event_type {
                rdev::EventType::MouseMove { x, y } => {
                    let payload = MouseMovePayload { x, y };
                    let _ = app_handle.emit("device-mouse-move", &payload);
                }
                rdev::EventType::ButtonPress(button) => {
                    // ButtonPress 不携带坐标，此处仅发送按键类型
                    // 前端可通过上一次 device-mouse-move 的坐标推断点击位置
                    let payload = MousePressPayload {
                        x: 0.0,
                        y: 0.0,
                        button: button_to_string(button),
                    };
                    let _ = app_handle.emit("device-mouse-press", &payload);
                }
                rdev::EventType::KeyPress(key) => {
                    let payload = KeyPressPayload {
                        key: key_to_string(key),
                    };
                    let _ = app_handle.emit("device-key-press", &payload);
                }
                // 忽略其他事件类型（KeyRelease、ButtonRelease、Wheel）
                _ => {}
            }
        });

        // rdev::listen 只有在出错时才会返回
        if let Err(e) = result {
            log::error!("[Device] rdev::listen error: {:?}", e);
            // macOS 常见错误：用户未授予「输入监视」权限
            #[cfg(target_os = "macos")]
            {
                let err_msg = format!(
                    "全局键鼠监听失败。请在「系统偏好设置 → 隐私与安全性 → 输入监视」中授予权限。错误: {:?}",
                    e
                );
                let _ = app_handle_for_error.emit("device-listen-error", &err_msg);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app_handle_for_error
                    .emit("device-listen-error", format!("rdev listen error: {:?}", e));
            }
        }

        IS_LISTENING.store(false, Ordering::Release);
    });

    Ok(())
}

/// 停止全局键鼠监听
///
/// 通过将 `IS_LISTENING` 标志设为 false 来停止事件处理。
///
/// 前端调用方式：`invoke('stop_device_listening')`
///
/// # 注意
/// rdev::listen 本身无法优雅停止，设置标志后回调将忽略后续事件，
/// 但底层线程仍然存在。这在桌面宠物场景下是可接受的——监听器通常只在
/// 应用退出时停止。
///
/// # Returns
/// - `Ok(())` — 停止成功（或未在运行）
#[cfg(desktop)]
#[tauri::command]
pub fn stop_device_listening() -> Result<(), String> {
    if !IS_LISTENING.load(Ordering::Acquire) {
        log::warn!("[Device] listener not running, nothing to stop");
        return Ok(());
    }

    IS_LISTENING.store(false, Ordering::Release);
    log::info!("[Device] stopped global input listener");
    Ok(())
}

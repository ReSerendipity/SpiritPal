//! 应用 setup（M1 拆分：自 lib.rs 迁出）
//!
//! - [`setup_environment`] — GPU 环境变量 + WebView2 残留清理
//! - [`build_log_plugin`] — tauri-plugin-log 构建（P1-05 日志级别闸门）
//! - [`setup_desktop_app`] — 桌面端初始化（窗口/托盘/空闲检测/快捷键/NSPanel）

use crate::commands::window::build_configured_window;

/// 设置 GPU 绕过环境变量 + 清理 WebView2 残留锁文件。
///
/// GPU 黑名单绕过 — 参考 WindowPet：
/// 设置环境变量，强制 WebView2 忽略 GPU 黑名单，避免黑屏/渲染异常。
/// 某些 GPU 在 WebView2 黑名单中会被降级为软件渲染，导致桌面宠物显示异常。
//
// 注：run() 曾内联同样的环境变量设置（三窗口入口重复），此函数为唯一配置点。
pub fn setup_environment() {
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
    crate::system::cleanup_webview2_if_needed();
}

/// 构建日志插件（tauri_plugin_log），区分 debug/release 级别。
///
/// P1-05（审计 LOG-04）：插件侧固定全开，实际通过 log crate 全局 max_level 闸控，
/// 由 setup 中 [crate::log_level::apply_boot_level] 施加启动默认值，运行时可用
/// `set_log_level` 命令动态调整（fern 的 Dispatch.level 构建后不可改，故不在此收窄）。
pub fn build_log_plugin() -> impl tauri::plugin::Plugin<tauri::Wry> {
    tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Debug)
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
        .build()
}

/// 桌面端应用初始化：主窗口创建 + 托盘 + 空闲检测 + 全局快捷键 + macOS NSPanel。
///
/// 从 run() 的 setup 闭包中拆出（消除与闭包内联块的重复），减少 Fat Controller 行数。
/// 包含窗口创建、托盘菜单事件处理、空闲检测启动等桌面端专属逻辑。
///
/// 注：主窗口创建必须放在 app setup（而非 tauri.conf.json app.windows）：
/// single-instance 插件在"插件 setup"阶段检测互斥体并拦截后续实例退出，
/// 而 tauri.conf.json 配置的窗口在 Builder 初始化时（插件 setup 之前）
/// 就已创建并显示——导致每次重复启动都先闪现一个宠物窗口再退出。
/// 移到此处后：只有第一个实例能到达 app setup 并创建窗口。
#[cfg(desktop)]
pub fn setup_desktop_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{Emitter, Manager};

    {
        use tauri::{WebviewUrl, WebviewWindowBuilder};
        WebviewWindowBuilder::new(app, "pet-window", WebviewUrl::App("index.html#/pet".into()))
            .title("SpiritPal")
            // 默认 224×304 = 1.0× 宠物的基准适配尺寸（精灵 192×208 + 32 边距 + 64 气泡空间），
            // 减少首帧与前端按持久化 petSize 校正后的落差闪烁；前端挂载后会立即按实际 petSize 校正
            .inner_size(224.0, 304.0)
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

    let menu = crate::tray::build_tray_menu(app)?;

    let running = Arc::new(AtomicBool::new(true));
    let app_handle = app.handle().clone();

    crate::system::start_idle_detection(app_handle.clone(), running.clone());

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
                let window = if let Some(w) = app.get_webview_window("settings-window") {
                    w
                } else {
                    // 动态创建设置窗口（无边框，自定义标题栏）
                    match build_configured_window(app, "settings-window") {
                        Ok(Some(w)) => w,
                        Ok(None) => return,
                        Err(e) => {
                            log::error!("[SpiritPal] Failed to create settings window: {}", e);
                            return;
                        }
                    }
                };
                let _ = window.show();
                let _ = window.set_focus();
                let _ = app.emit("open-settings", ());
            }
            // P0-1.5: 托盘「检查更新」→ 前端 UpdateNotification 弹窗执行完整状态机（每步可见）
            "check-updates" => {
                let _ = app.emit("check-updates-from-tray", ());
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

    crate::system::register_global_shortcut(app);

    // =========================================
    // macOS NSPanel 浮层配置
    // =========================================
    // 将 pet-window 转换为 NSPanel，实现不抢焦点、跨 Space、全屏可见浮层。
    // 参考 BongoCat 的 tauri-nspanel 集成方案。
    #[cfg(target_os = "macos")]
    {
        if let Some(pet_window) = app.get_webview_window("pet-window") {
            crate::macos::setup_pet_panel(app.handle(), pet_window);
        } else {
            log::warn!("[SpiritPal] pet-window not found, skipping NSPanel setup");
        }
    }

    Ok(())
}

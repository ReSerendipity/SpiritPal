//! macOS NSPanel 浮层配置模块（参考 BongoCat）
//!
//! 将宠物窗口（pet-window）从 NSWindow 转换为 NSPanel，
//! 实现以下 macOS 桌面宠物关键行为：
//!
//! 1. **不抢焦点**（nonactivating_panel）：点击宠物窗口不会激活应用，
//!    不会打断用户在其他窗口的操作。
//! 2. **跨 Space 跟随**（move_to_active_space）：宠物在所有桌面空间可见，
//!    切换 Space 时宠物自动跟随。
//! 3. **全屏可见**（full_screen_auxiliary）：其他应用进入全屏时，
//!    宠物窗口仍然浮在上方。
//! 4. **隐藏 Dock 图标**：宠物应用不在 Dock 栏显示图标。
//!
//! # 前置条件
//! - `tauri.conf.json` 中 `macOSPrivateApi: true`（已配置）
//! - Cargo.toml 中 tauri feature `"macos-private-api"`（已配置）
//! - `[target.'cfg(target_os = "macos")'.dependencies] tauri-nspanel`
//!
//! # 参考
//! - BongoCat src-tauri/src/core/setup/macos.rs
//! - tauri-nspanel: <https://github.com/ahkohd/tauri-nspanel> (v2.1 branch)

#![allow(deprecated)]
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

/// 宠物窗口标签（与 tauri.conf.json 中 label 一致）
const PET_WINDOW_LABEL: &str = "pet-window";

// ============ NSPanel 定义 ============

/// SpiritPal 宠物窗口 NSPanel 定义
///
/// 配置为浮动面板、可成为关键窗口（接收键盘输入）、不可成为主窗口。
tauri_panel! {
    panel!(PetNsPanel {
        config: {
            is_floating_panel: true,
            can_become_key_window: true,
            can_become_main_window: false
        }
    })
}

// ============ 公共接口 ============

/// 配置宠物窗口为 macOS NSPanel 浮层
///
/// 此函数在应用 setup 阶段调用，将 pet-window 转换为 NSPanel。
/// 仅在 macOS 上有效，其他平台调用为空操作（通过 cfg 守卫在调用侧控制）。
///
/// # 配置步骤
/// 1. 初始化 tauri-nspanel 插件
/// 2. 隐藏 Dock 图标
/// 3. 将 pet-window 转为 NSPanel
/// 4. 设置 Panel 级别为 Dock（始终浮在普通窗口之上）
/// 5. 设置 StyleMask：可调整大小 + 非激活面板
/// 6. 设置 CollectionBehavior：固定位置 + 跨 Space + 全屏辅助
///
/// # Arguments
/// - `app_handle` — Tauri 应用句柄
/// - `pet_window` — 宠物窗口 WebviewWindow 实例
pub fn setup_pet_panel(app_handle: &AppHandle, pet_window: WebviewWindow) {
    // 1. 初始化 tauri-nspanel 插件
    if let Err(e) = app_handle.plugin(tauri_nspanel::init()) {
        log::error!("[SpiritPal] failed to init tauri-nspanel plugin: {}", e);
        return;
    }

    // 2. 隐藏 Dock 图标（宠物应用不在 Dock 栏显示）
    if let Err(e) = app_handle.set_dock_visibility(false) {
        log::warn!("[SpiritPal] failed to hide Dock icon: {}", e);
    }

    // 3. 将 pet-window 转换为 NSPanel
    let panel = match pet_window.to_panel::<PetNsPanel>() {
        Ok(p) => p,
        Err(e) => {
            log::error!("[SpiritPal] failed to convert pet-window to NSPanel: {}", e);
            return;
        }
    };

    // 4. 设置 Panel 级别为 Dock（浮在普通窗口之上，低于屏幕保护程序）
    panel.set_level(PanelLevel::Dock.value());

    // 5. 设置 StyleMask：可调整大小 + 非激活面板（点击不抢焦点）
    panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());

    // 6. 设置 CollectionBehavior：
    //    - stationary: 固定位置
    //    - move_to_active_space: 切换 Space 时跟随
    //    - full_screen_auxiliary: 全屏应用时仍可见
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .stationary()
            .move_to_active_space()
            .full_screen_auxiliary()
            .into(),
    );

    log::info!("[SpiritPal] macOS NSPanel configured for pet-window");
}

/// 设置宠物面板可见性（show/hide）
///
/// macOS 上使用 NSPanel 的 show/hide 方法而非 Tauri 原生 window 方法，
/// 避免 NSPanel 与 NSWindow 操作混用导致崩溃。
///
/// # Arguments
/// - `app_handle` — Tauri 应用句柄
/// - `visible` — `true` 显示面板，`false` 隐藏面板
///
/// # 行为说明
/// - 显示时使用 `can_join_all_spaces`，确保在所有 Space 可见
/// - 隐藏时使用 `move_to_active_space`，隐藏后仅在当前 Space
/// - 操作在主线程执行（通过 `run_on_main_thread`）
pub fn set_pet_panel_visibility(app_handle: &AppHandle, visible: bool) {
    let app_handle_clone = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Ok(panel) = app_handle_clone.get_webview_panel(PET_WINDOW_LABEL) {
            if visible {
                panel.show();
                // 显示时使用 can_join_all_spaces，确保在所有 Space 可见
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .stationary()
                        .can_join_all_spaces()
                        .full_screen_auxiliary()
                        .into(),
                );
            } else {
                panel.hide();
                // 隐藏时使用 move_to_active_space，隐藏后仅在当前 Space
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .stationary()
                        .move_to_active_space()
                        .full_screen_auxiliary()
                        .into(),
                );
            }
        }
    });
}

/// 设置宠物面板置顶级别
///
/// macOS 上通过 PanelLevel 控制置顶，而非 Tauri 原生 set_always_on_top。
///
/// # Arguments
/// - `app_handle` — Tauri 应用句柄
/// - `always_on_top` — 是否置顶
///   - `true`: 设置 PanelLevel::Dock（浮在普通窗口之上）
///   - `false`: 设置 PanelLevel 为 -1（普通级别）
///
/// 操作在主线程执行（通过 `run_on_main_thread`）。
pub fn set_pet_panel_level(app_handle: &AppHandle, always_on_top: bool) {
    let app_handle_clone = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Ok(panel) = app_handle_clone.get_webview_panel(PET_WINDOW_LABEL) {
            if always_on_top {
                panel.set_level(PanelLevel::Dock.value());
            } else {
                panel.set_level(-1);
            }
        }
    });
}

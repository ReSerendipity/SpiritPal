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
mod magic_check;
mod mcp_bridge;
mod memory_sidecar;
mod petmod;
mod system;
mod tray;
pub mod validation;
mod win32;
// M1: 应用 setup 模块（环境变量 / 日志插件 / 桌面端初始化）
mod setup;
// P1-2: 角色包导入命令（scan_character_directory / read_text_file）
mod character_import;
// C 类: 系统工具命令（截图/进程/音量/亮度/文件搜索/受限命令执行/小组件状态）
// pub mod: 允许集成测试 (tests/) 在真实 Windows 上验证 Win32 运行时路径
pub mod system_tools;
#[cfg(desktop)]
use system_tools::{
    execute_command, get_running_processes, read_widget_state, search_files, set_system_brightness,
    set_system_volume, sync_widget_state, take_screenshot,
};
// D-1: Rust 语义 SQL 命令层（sp_* 命令；替代前端 plugin-sql 直执行 SQL）
// 命令以 sqlite::sp_xxx 路径形式注册进 invoke_handler，无需逐个 use。
mod sqlite;
// D-2: 自定义命令窗口级门禁（高敏命令校验调用方窗口 label）
mod window_gate;
// H-4: 安全审计日志（audit_log 命令）
pub mod audit_log;
// P1-05: 运行时日志级别（审计 LOG-04 修复 — get_log_level / set_log_level）
pub mod log_level;
use log_level::{get_log_level, set_log_level};
// Q3: 崩溃本地留存与诊断导出（panic hook / export_diagnostics）
pub mod diagnostics;
use diagnostics::export_diagnostics;
// P2: 素材管线命令（detect_asset_tools / run_asset_pipeline）
mod asset_pipeline;
// R-11: SRI 哈希（构建时自动生成）
// clippy::incompatible_msrv: LazyLock 需要 1.80.0，但项目 MSRV 设为 1.77.2，此处允许
// dead_code: 生成的 get_hash 函数可能未被当前代码引用
#[allow(clippy::incompatible_msrv, dead_code)]
mod generated {
    pub mod sri_hashes;
}

// ============ 跨模块命令导入（供 generate_handler! 使用）============
// Tauri 的 generate_handler! 宏接受函数标识符，需要先 use 导入

use crypto::{
    compute_sha256, decrypt_data, decrypt_data_chunked, encrypt_data, encrypt_data_chunked,
};
// A-15: .petmod 打包 / 校验 / 安装 / 卸载（前端 modPackager 一直在调用）
use petmod::{
    import_petmod, install_petmod, pack_petmod, scan_mods_directory, uninstall_mod, validate_petmod,
};
// R-14: 数据库加密命令
use encrypted_db::{
    backup_db_at_rest, decrypt_db_at_rest, delete_db_backup, encrypt_db_at_rest, list_db_backups,
    restore_db_backup,
};
// H-4: 审计日志命令
use audit_log::audit_log;
// P0: Rust 侧 HTTP 网络出口命令（绕过生产 CSP 对境内/本地服务商的阻断）
mod http_proxy;
use http_proxy::http_proxy;

#[cfg(desktop)]
use device::{start_device_listening, stop_device_listening};
#[cfg(desktop)]
use keychain::{delete_secret, get_secret, set_secret};
#[cfg(desktop)]
use mcp_bridge::mcp_respond;
// 记忆系统 sidecar 命令（含 M0 加固的 token 读取命令）
#[cfg(desktop)]
use memory_sidecar::{get_memory_sidecar_token, start_memory_sidecar, stop_memory_sidecar};
#[cfg(desktop)]
use tray::{set_tray_icon, set_tray_icon_png, update_tray_icon};

// ============ 桌面端专用导入 ============
// 注：run() 的桌面端窗口/托盘逻辑已下沉 setup 模块（M1），托盘相关类型不再在此导入。

#[cfg(desktop)]
use tauri_plugin_global_shortcut::ShortcutState;

#[cfg(not(desktop))]
use tauri::{Emitter, Manager, WebviewWindow};

// ============ M1: 命令模块（commands/） ============
// 窗口/通用命令迁入 commands::window（greet/窗口配置/点击穿透/置顶/macOS 浮层等）；
// 其余命令保持独立模块文件，由下方 invoke_handler 统一注册。
mod commands;
use commands::window::{
    detect_asset_tools, get_window_config, greet, log_frontend_error, open_application,
    read_text_file, run_asset_pipeline, scan_character_directory, validate_upload_magic,
};
#[cfg(desktop)]
use commands::window::{
    get_active_window, get_idle_time, get_mouse_pos, hide_pet_window, open_path,
    remove_pet_click_through, set_pet_always_on_top, set_pet_click_through, show_pet_window,
    start_topmost_keepalive,
};

// ============================================================
// 应用入口
// ============================================================

// ============================================================
// run() 拆分函数（P1-4: 减少 Fat Controller 反模式）
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
///
/// M1：环境变量 / 日志插件 / 桌面端窗口与托盘逻辑已下沉到 [`setup`] 模块。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // M1: GPU 环境变量 + WebView2 清理（唯一配置点，见 setup::setup_environment）
    setup::setup_environment();

    // P1-4: 日志插件构建拆分到 build_log_plugin() 函数
    let mut builder = tauri::Builder::default()
        .plugin(setup::build_log_plugin())
        .plugin(tauri_plugin_store::Builder::new().build())
        // D-1: 已移除 tauri-plugin-sql —— SQL 全量收口 Rust 语义命令（sqlite.rs），
        // capability 中 sql:* 授权一并删除（S1 闭合）。
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init());

    // 桌面端专属插件
    #[cfg(desktop)]
    {
        use tauri::{Emitter, Manager}; // 插件回调内需 Manager/Emitter trait

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
            // Q3: 尽早安装 panic hook（承接此后任何线程的崩溃现场落盘）
            diagnostics::setup_panic_hook(app);
            // P1-05: 施加启动日志级别（持久化配置 > 构建类型默认；release 默认 Info 不输出调试信息）
            crate::log_level::apply_boot_level(app.handle());
            // R-12: 启动时反调试检查（D-6：命中写审计 + emit 前端安全模式事件）
            antidebug::startup_check(Some(app.handle()));
            // R-11: 启动时 SRI 完整性验证（D-7：消费返回布尔 —— 不匹配记 error + 通知前端，不阻断启动）
            if !generated::sri_hashes::verify_integrity() {
                log::error!("[SRI] 前端资源完整性校验失败（可能被篡改）");
                use tauri::Emitter;
                let _ = app.emit("spiritpal:integrity-warning", true);
            }
            // R-14: 启动时解密数据库
            // V-1 修复：移除 Rust 端 spawn 异步解密——前端 db.ts initDB() 中已调用 invoke('decrypt_db_at_rest')
            // 之前 Rust 端 spawn 解密与前端 invoke 解密并发执行，可能导致竞争（两个解密同时写 spiritpal.db）
            // 现在统一由前端 initDB() 中的 invoke('decrypt_db_at_rest') 负责，确保解密完成后才 Database.load()
            // （lib.rs 的 spawn 解密保留注释说明，实际不执行）

            // MCP 命令桥：在应用进程内宿主 spiritpal-mcp 的 bridge 服务器
            mcp_bridge::spawn(app.handle());

            // =========================================
            // 桌面端：主窗口创建 + 托盘 + 空闲检测 + 全局快捷键
            // =========================================
            // M1：逻辑已下沉 setup::setup_desktop_app（消除闭包内联重复）
            #[cfg(desktop)]
            {
                setup::setup_desktop_app(app)?;
            }

            // =========================================
            // 移动端：创建根 WebView
            // =========================================
            // tauri.conf.json 的 app.windows 为空（桌面端为了配合单实例插件，
            // 窗口统一在 setup 中动态创建，避免重复启动闪窗）。
            // 但 Android/iOS 依赖窗口配置来创建根 WebView：若全程零窗口，
            // tauri-runtime-wry 的移动端 Resumed/Suspended 分支因无窗口而
            // 永不创建 WebView（tauri issue #15671），表现为白屏。
            // 故移动端在此显式创建根 WebView（等价于把窗口写回 app.windows）。
            #[cfg(not(desktop))]
            {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("SpiritPal")
                    .build()?;
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
                    get_window_config,
                    set_pet_click_through,
                    remove_pet_click_through,
                    get_mouse_pos,
                    get_idle_time,
                    get_active_window,
                    start_topmost_keepalive,
                    // C 类: 系统工具（此前"计划中"，现已实现）
                    take_screenshot,
                    get_running_processes,
                    set_system_volume,
                    set_system_brightness,
                    search_files,
                    execute_command,
                    sync_widget_state,
                    read_widget_state,
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
                    // B-3: 大 blob 分块流式加密（ENC3）
                    encrypt_data_chunked,
                    decrypt_data_chunked,
                    compute_sha256,
                    // 模组
                    import_petmod,
                    scan_mods_directory,
                    // A-15: 模组打包链路（pack/validate/install/uninstall）
                    pack_petmod,
                    validate_petmod,
                    install_petmod,
                    uninstall_mod,
                    // 上传文件魔数校验
                    validate_upload_magic,
                    // 全局键鼠监听（宠物注视光标效果）
                    start_device_listening,
                    stop_device_listening,
                    // 记忆系统 sidecar（cognee，ADR-0003）
                    start_memory_sidecar,
                    stop_memory_sidecar,
                    // M0 加固：读取 sidecar 鉴权 token（前端 cogneeClient 附加请求头）
                    get_memory_sidecar_token,
                    // macOS NSPanel 浮层
                    show_pet_window,
                    hide_pet_window,
                    set_pet_always_on_top,
                    // R-14: 数据库加密
                    encrypt_db_at_rest,
                    decrypt_db_at_rest,
                    // P1: 本地自动备份（无云端备份下的 durability:备份/列出/恢复/删除）
                    backup_db_at_rest,
                    list_db_backups,
                    restore_db_backup,
                    delete_db_backup,
                    // MCP 命令桥：webview 回调挂起的工具调用
                    mcp_respond,
                    // P1-2: 角色包导入
                    scan_character_directory,
                    read_text_file,
                    // P2: 素材管线
                    detect_asset_tools,
                    run_asset_pipeline,
                    // H-4: 审计日志
                    audit_log,
                    // P1-05: 运行时日志级别（LOG-04）
                    get_log_level,
                    set_log_level,
                    // Q3: 诊断包导出（本地留存，用户主动触发）
                    export_diagnostics,
                    // P0: Rust 侧 HTTP 网络出口（代理 LLM / 天气 / 模组下载）
                    http_proxy,
                    // D-1: Rust 语义 SQL 命令层（替代前端 plugin-sql 的 sql:* 授权）
                    sqlite::sp_db_migrate,
                    sqlite::sp_settings_get,
                    sqlite::sp_settings_set,
                    sqlite::sp_settings_remove,
                    sqlite::sp_char_get_stats,
                    sqlite::sp_char_save_stats,
                    sqlite::sp_char_list,
                    sqlite::sp_mem_add,
                    sqlite::sp_mem_save_embedding,
                    sqlite::sp_mem_save_embeddings_batch,
                    sqlite::sp_mem_touch,
                    sqlite::sp_mem_get_embeddings,
                    sqlite::sp_mem_list,
                    sqlite::sp_mem_delete,
                    sqlite::sp_mem_clear,
                    sqlite::sp_mem_insert_row,
                    sqlite::sp_mem_update_row,
                    sqlite::sp_mem_by_tier,
                    sqlite::sp_mem_by_character,
                    sqlite::sp_mem_summary_get,
                    sqlite::sp_mem_summary_upsert,
                    sqlite::sp_mem_summary_delete,
                    sqlite::sp_mem_state_get,
                    sqlite::sp_mem_state_upsert,
                    sqlite::sp_mem_state_delete,
                    sqlite::sp_mem_clear_all,
                    sqlite::sp_owner_facts_list,
                    sqlite::sp_owner_facts_as_of,
                    sqlite::sp_owner_facts_history,
                    sqlite::sp_owner_facts_upsert,
                    sqlite::sp_owner_facts_delete,
                    sqlite::sp_owner_facts_clear,
                    sqlite::sp_sem_facts_list,
                    sqlite::sp_sem_facts_by_key,
                    sqlite::sp_sem_facts_upsert,
                    sqlite::sp_sem_facts_delete,
                    sqlite::sp_sem_facts_clear,
                    sqlite::sp_sem_facts_count,
                    sqlite::sp_pet_exp_list,
                    sqlite::sp_pet_exp_insert,
                    sqlite::sp_pet_exp_clear,
                    sqlite::sp_visual_list,
                    sqlite::sp_visual_insert,
                    sqlite::sp_visual_clear,
                    sqlite::sp_entity_list,
                    sqlite::sp_entity_upsert,
                    sqlite::sp_entity_clear,
                    sqlite::sp_mods_save,
                    sqlite::sp_mods_list,
                    sqlite::sp_mods_delete,
                    sqlite::sp_mods_set_enabled,
                    sqlite::sp_inventory_save,
                    sqlite::sp_inventory_list,
                    sqlite::sp_schedules_save,
                    sqlite::sp_schedules_list,
                    // B2-2: 健康检查/快照/清理/约定/上下文/实体图/schema/dirty
                    sqlite::sp_db_integrity,
                    sqlite::sp_db_snapshot,
                    sqlite::sp_settings_keys,
                    sqlite::sp_db_purge,
                    sqlite::sp_commitments_insert,
                    sqlite::sp_commitments_list,
                    sqlite::sp_commitments_due,
                    sqlite::sp_commitments_overdue,
                    sqlite::sp_commitments_set_status,
                    sqlite::sp_commitments_increment_follow_up,
                    sqlite::sp_commitments_auto_lapse,
                    sqlite::sp_commitments_recurring_done,
                    sqlite::sp_commitments_open_recent,
                    sqlite::sp_ctx_insert,
                    sqlite::sp_ctx_close,
                    sqlite::sp_ctx_list,
                    sqlite::sp_entitygraph_upsert_node,
                    sqlite::sp_entitygraph_upsert_edge,
                    sqlite::sp_entitygraph_find_by_names,
                    sqlite::sp_entitygraph_neighbors,
                    sqlite::sp_zombie_report,
                    sqlite::sp_zombie_cleanup_legacy,
                    sqlite::sp_zombie_cleanup_episodes,
                    sqlite::sp_zombie_cleanup_entities,
                    sqlite::sp_schema_version_current,
                    sqlite::sp_schema_version_applied,
                    sqlite::sp_schema_version_record,
                    sqlite::sp_schema_version_history,
                    sqlite::sp_schema_log_failure,
                    sqlite::sp_schema_resolve_failure,
                    sqlite::sp_schema_unresolved,
                    sqlite::sp_dirty_scan,
                    sqlite::sp_dirty_upsert,
                    sqlite::sp_dirty_resolve,
                    sqlite::sp_dirty_resolve_table,
                    sqlite::sp_dirty_list,
                    sqlite::sp_dirty_cleanup,
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
                    // B-3: 大 blob 分块流式加密（ENC3）
                    encrypt_data_chunked,
                    decrypt_data_chunked,
                    compute_sha256,
                    // P1: 本地自动备份
                    backup_db_at_rest,
                    list_db_backups,
                    restore_db_backup,
                    delete_db_backup,
                    // 模组
                    import_petmod,
                    scan_mods_directory,
                    // A-15: 模组打包链路（pack/validate/install/uninstall）
                    pack_petmod,
                    validate_petmod,
                    install_petmod,
                    uninstall_mod,
                    // 上传文件魔数校验
                    validate_upload_magic,
                    // P1-2: 角色包导入
                    scan_character_directory,
                    read_text_file,
                    // P2: 素材管线
                    detect_asset_tools,
                    run_asset_pipeline,
                    // H-4: 审计日志
                    audit_log,
                    // P1-05: 运行时日志级别（LOG-04）
                    get_log_level,
                    set_log_level,
                    // Q3: 诊断包导出（本地留存，用户主动触发）
                    export_diagnostics,
                    // P0: Rust 侧 HTTP 网络出口（代理 LLM / 天气 / 模组下载）
                    http_proxy,
                    // D-1: Rust 语义 SQL 命令层（移动端同样需要数据访问）
                    sqlite::sp_db_migrate,
                    sqlite::sp_settings_get,
                    sqlite::sp_settings_set,
                    sqlite::sp_settings_remove,
                    sqlite::sp_char_get_stats,
                    sqlite::sp_char_save_stats,
                    sqlite::sp_char_list,
                    sqlite::sp_mem_add,
                    sqlite::sp_mem_save_embedding,
                    sqlite::sp_mem_save_embeddings_batch,
                    sqlite::sp_mem_touch,
                    sqlite::sp_mem_get_embeddings,
                    sqlite::sp_mem_list,
                    sqlite::sp_mem_delete,
                    sqlite::sp_mem_clear,
                    sqlite::sp_mem_insert_row,
                    sqlite::sp_mem_update_row,
                    sqlite::sp_mem_by_tier,
                    sqlite::sp_mem_by_character,
                    sqlite::sp_mem_summary_get,
                    sqlite::sp_mem_summary_upsert,
                    sqlite::sp_mem_summary_delete,
                    sqlite::sp_mem_state_get,
                    sqlite::sp_mem_state_upsert,
                    sqlite::sp_mem_state_delete,
                    sqlite::sp_mem_clear_all,
                    sqlite::sp_owner_facts_list,
                    sqlite::sp_owner_facts_as_of,
                    sqlite::sp_owner_facts_history,
                    sqlite::sp_owner_facts_upsert,
                    sqlite::sp_owner_facts_delete,
                    sqlite::sp_owner_facts_clear,
                    sqlite::sp_sem_facts_list,
                    sqlite::sp_sem_facts_by_key,
                    sqlite::sp_sem_facts_upsert,
                    sqlite::sp_sem_facts_delete,
                    sqlite::sp_sem_facts_clear,
                    sqlite::sp_sem_facts_count,
                    sqlite::sp_pet_exp_list,
                    sqlite::sp_pet_exp_insert,
                    sqlite::sp_pet_exp_clear,
                    sqlite::sp_visual_list,
                    sqlite::sp_visual_insert,
                    sqlite::sp_visual_clear,
                    sqlite::sp_entity_list,
                    sqlite::sp_entity_upsert,
                    sqlite::sp_entity_clear,
                    sqlite::sp_mods_save,
                    sqlite::sp_mods_list,
                    sqlite::sp_mods_delete,
                    sqlite::sp_mods_set_enabled,
                    sqlite::sp_inventory_save,
                    sqlite::sp_inventory_list,
                    sqlite::sp_schedules_save,
                    sqlite::sp_schedules_list,
                    // B2-2: 健康检查/快照/清理/约定/上下文/实体图/schema/dirty
                    sqlite::sp_db_integrity,
                    sqlite::sp_db_snapshot,
                    sqlite::sp_settings_keys,
                    sqlite::sp_db_purge,
                    sqlite::sp_commitments_insert,
                    sqlite::sp_commitments_list,
                    sqlite::sp_commitments_due,
                    sqlite::sp_commitments_overdue,
                    sqlite::sp_commitments_set_status,
                    sqlite::sp_commitments_increment_follow_up,
                    sqlite::sp_commitments_auto_lapse,
                    sqlite::sp_commitments_recurring_done,
                    sqlite::sp_commitments_open_recent,
                    sqlite::sp_ctx_insert,
                    sqlite::sp_ctx_close,
                    sqlite::sp_ctx_list,
                    sqlite::sp_entitygraph_upsert_node,
                    sqlite::sp_entitygraph_upsert_edge,
                    sqlite::sp_entitygraph_find_by_names,
                    sqlite::sp_entitygraph_neighbors,
                    sqlite::sp_zombie_report,
                    sqlite::sp_zombie_cleanup_legacy,
                    sqlite::sp_zombie_cleanup_episodes,
                    sqlite::sp_zombie_cleanup_entities,
                    sqlite::sp_schema_version_current,
                    sqlite::sp_schema_version_applied,
                    sqlite::sp_schema_version_record,
                    sqlite::sp_schema_version_history,
                    sqlite::sp_schema_log_failure,
                    sqlite::sp_schema_resolve_failure,
                    sqlite::sp_schema_unresolved,
                    sqlite::sp_dirty_scan,
                    sqlite::sp_dirty_upsert,
                    sqlite::sp_dirty_resolve,
                    sqlite::sp_dirty_resolve_table,
                    sqlite::sp_dirty_list,
                    sqlite::sp_dirty_cleanup,
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
    // V-1 修复：增加 300ms 延迟，等待前端 beforeunload 中的 DB close(WAL checkpoint) 完成
    //   之前直接加密导致 Windows 上 SQLite 连接仍打开 → fs::remove_file 失败 → 明文残留
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building SpiritPal application");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            log::info!("[SpiritPal] ExitRequested — encrypting database at rest...");
            // V-1: 等待前端关闭 DB 连接（beforeunload → encryptDatabaseAtRest → close DB）
            // 300ms 足够前端完成 WAL checkpoint + close + invoke('encrypt_db_at_rest')
            // 即使前端来不及完成，Rust 端 encrypt_db_at_rest 内部也有重试逻辑
            std::thread::sleep(std::time::Duration::from_millis(300));
            // 同步执行加密（blocking），确保退出前完成
            let app = app_handle.clone();
            tauri::async_runtime::block_on(async move {
                let _ = encrypted_db::encrypt_db_at_rest_internal(app).await;
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

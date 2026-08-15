//! SpiritPal 应用二进制入口点
//!
//! 此文件为 Tauri 应用的二进制 crate 入口，仅负责调用库 crate 的 [`spiritpal_lib::run`] 函数。
//! 所有核心逻辑位于 `lib.rs` 及各子模块中。
//!
//! # Windows 子系统配置
//! `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` 属性在 Release 模式下
//! 使用 Windows 子系统，避免启动时显示控制台窗口。Debug 模式保留控制台以便查看日志输出。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 应用程序主入口点
///
/// 调用 `spiritpal_lib::run()` 启动 Tauri 应用，该函数在 `lib.rs` 中定义，
/// 负责完整的应用初始化、插件注册、窗口创建和事件循环运行。
fn main() {
    spiritpal_lib::run();
}

//! 命令模块：按域分组，避免 lib.rs 巨石（M1 拆分）
//!
//! - [`window`] — 窗口 / 通用命令（greet、窗口配置、点击穿透、置顶、macOS 浮层等）
//!
//! 其余命令（crypto / petmod / system_tools / keychain / encrypted_db / audit_log /
//! device / memory_sidecar / tray / http_proxy / log_level / diagnostics）本就独立成
//! 模块文件，由 `lib.rs` 的 `invoke_handler` 统一注册。

pub mod window;

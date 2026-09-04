//! D-2: Tauri 自定义命令窗口级门禁
//!
//! Tauri 2 的 capability（ACL）只约束 core/插件命令；**自定义 `#[tauri::command]`
//! 不经过 ACL**，任何窗口都能 invoke。本模块为高敏自定义命令提供运行时
//! 窗口 label 校验：调用方窗口不在白名单内直接拒绝。
//!
//! # 用法
//! ```rust
//! window_gate::require_window(&window, window_gate::APP_WINDOWS)?;
//! ```
//! 命令签名注入 `window: tauri::Window`（Tauri 自动注入，不影响 ipcContract 参数校验）。

/// SpiritPal 全部应用窗口 label（白名单基线）
pub const APP_WINDOWS: &[&str] = &["pet-window", "settings-window", "chat-window", "main"];

/// Agent 工具窗口集（LLM/助手工具只在聊天/主窗口表面可达）
pub const AGENT_WINDOWS: &[&str] = &["chat-window", "main"];

/// 校验调用方窗口是否在允许集合内
pub fn require_window(window: &tauri::Window, allowed: &[&str]) -> Result<(), String> {
    let label = window.label();
    if allowed.contains(&label) {
        Ok(())
    } else {
        Err(format!(
            "命令不允许在窗口 '{label}' 中调用（允许: {}）",
            allowed.join(", ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 纯函数校验（避免在单测中构造真实 tauri::Window）
    fn label_allowed(label: &str, allowed: &[&str]) -> bool {
        allowed.contains(&label)
    }

    #[test]
    fn test_app_windows_all_allowed() {
        for w in ["pet-window", "settings-window", "chat-window", "main"] {
            assert!(label_allowed(w, APP_WINDOWS), "{w} 应在应用窗口白名单");
        }
    }

    #[test]
    fn test_non_app_window_rejected() {
        assert!(!label_allowed("attacker-window", APP_WINDOWS));
        assert!(!label_allowed("", APP_WINDOWS));
    }

    #[test]
    fn test_agent_windows_subset() {
        for w in AGENT_WINDOWS {
            assert!(label_allowed(w, APP_WINDOWS), "agent 窗口必须属于应用窗口");
        }
        assert!(!label_allowed("settings-window", AGENT_WINDOWS));
    }
}

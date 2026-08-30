//! A 段 Win32 命令「真机运行时」集成测试（2026-08-29）
//!
//! 背景：真机冒烟 checklist 的 A 段命令（system_tools）此前只有纯逻辑单测，
//! 从未真正调用过 Win32 运行时路径（Toolhelp32 枚举 / cmd 子进程执行）。
//! 本测试在**真实 Windows** 上直接调用这些安全、无副作用的命令，补上运行时验证。
//!
//! 不覆盖（有副作用 / 需窗口 / 需人眼）：
//! - set_system_volume / set_system_brightness：会真的改用户机器音量/亮度，且"变没变"须人看
//! - take_screenshot：需 WebviewWindow/AppHandle，且远程桌面虚拟屏指标为 0 需人工确认
//! - sync/read_widget_state：需 AppHandle
//!
//! 运行：`cargo test --test test_system_runtime --features custom-protocol`（或默认 debug）

#![cfg(windows)]

use spiritpal_lib::system_tools::{execute_command, get_running_processes};

// 这些命令内部用 tauri::async_runtime::spawn_blocking，需在其全局运行时内 block_on
fn rt<T>(fut: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(fut)
}

#[test]
fn runtime_get_running_processes_returns_real_windows_processes() {
    // 真调 CreateToolhelp32Snapshot + Process32First/NextW
    let procs = rt(get_running_processes()).expect("get_running_processes 应在真实 Windows 上成功");
    assert!(procs.len() > 5, "应枚举到多个进程，实际 {}", procs.len());
    // svchost.exe 几乎必然存在；explorer.exe 在有桌面会话时存在。至少命中其一。
    let has_core = procs.iter().any(|p| p.eq_ignore_ascii_case("svchost.exe"))
        || procs.iter().any(|p| p.eq_ignore_ascii_case("explorer.exe"));
    assert!(
        has_core,
        "进程列表应含 svchost.exe/explorer.exe，样例: {:?}",
        &procs[..procs.len().min(8)]
    );
    // 已排序去重
    let mut sorted = procs.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted, procs, "返回值应已排序去重");
}

#[test]
fn runtime_execute_command_whitelisted_tasklist_actually_runs() {
    // 真起 cmd 子进程执行 tasklist（只读白名单内）
    let out = rt(execute_command("tasklist".to_string())).expect("tasklist 在白名单内，应成功执行");
    // tasklist 输出应包含常见进程名与图像 PID 表头
    let hits = out.contains(".exe") || out.to_lowercase().contains("svchost");
    assert!(
        hits,
        "tasklist 真实输出应含 .exe/svchost，片段: {}",
        &out[..out.len().min(160)]
    );
}

#[test]
fn runtime_execute_command_whitelisted_ipconfig_runs() {
    let out = rt(execute_command("ipconfig".to_string())).expect("ipconfig 在白名单内，应成功执行");
    // 中文/英文 Windows 均可能：IPv / 适配器 / adapter
    let ok = out.to_lowercase().contains("ipv")
        || out.contains("适配器")
        || out.to_lowercase().contains("adapter");
    assert!(
        ok,
        "ipconfig 真实输出应含网络接口信息，片段: {}",
        &out[..out.len().min(160)]
    );
}

#[test]
fn runtime_execute_command_rejects_non_whitelisted_delete() {
    // 安全边界：del 不在只读白名单，必须被拒（且绝不能真的执行）
    let err = rt(execute_command(
        "del C:\\Windows\\Temp\\definitely_should_not_run.txt".to_string(),
    ))
    .expect_err("del 不在只读白名单，必须返回错误");
    assert!(
        err.contains("白名单") || err.contains("不在"),
        "错误信息应说明不在白名单，实际: {}",
        err
    );
}

#[test]
fn runtime_execute_command_rejects_shell_injection_chain() {
    // 安全边界：即使首个 token 合法，含 shell 元字符的拼接也应被 validate 拦截
    let err = rt(execute_command("tasklist & del C:\\evil.txt".to_string()))
        .expect_err("含 & 拼接的命令应被拒绝");
    assert!(
        err.contains("白名单")
            || err.contains("非法")
            || err.contains("&")
            || err.contains("不允许"),
        "应拦截 shell 拼接，实际: {}",
        err
    );
}

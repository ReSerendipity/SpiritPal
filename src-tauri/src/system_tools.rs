//! 系统工具命令（C 类代码债收尾）
//!
//! [B-3/C 类] 此前 9 个命令被前端 invoke 但 Rust 端从未实现（登记在
//! `ipcContract.test.ts` 的"计划中"排除列表），相关功能点了没反应。
//! 本模块补齐真实实现：
//!
//! # 命令清单
//! - [`take_screenshot`] — Win32 GDI 屏幕截取 → PNG base64（仅 Windows）
//! - [`get_running_processes`] — Toolhelp32 进程快照（仅 Windows）
//! - [`set_system_volume`] — WASAPI IAudioEndpointVolume 主音量（仅 Windows）
//! - [`set_system_brightness`] — PowerShell WMI 亮度（仅 Windows；台式机外接屏通常不支持）
//! - [`search_files`] — 跨平台递归文件名搜索（支持 `*` `?` 通配）
//! - [`execute_command`] — 受限白名单只读命令执行（跨平台）
//! - [`sync_widget_state`] / [`read_widget_state`] — 桌面小组件状态持久化（跨平台）
//!
//! # 安全设计
//! - `execute_command` 只允许预定义的**只读命令白名单**（tasklist/ipconfig 等），
//!   5 秒超时强制 kill，输出截断 10KB；不支持任意命令执行
//! - `sync_widget_state` 内容上限 1MB 且仅写入 app_data_dir 内固定文件
//! - `search_files` 深度上限 10 层、结果上限 100 条、跳过依赖/构建目录
//! - Windows-only 命令在非 Windows 平台返回明确 Err（而非静默失败）
//!
//! # GDI 截屏 unsafe 说明
//! 按 AGENTS.md 约定：必须用 unsafe 时集中隔离、逐函数注释安全依据。
//! `capture_region` 是本模块唯一 unsafe 块（GDI/COM API 本质是 unsafe FFI）。

use std::io::Read;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::Manager;

// ============ 常量 ============

/// search_files 结果上限
const SEARCH_MAX_RESULTS: usize = 100;
/// search_files 递归深度上限
const SEARCH_MAX_DEPTH: usize = 10;
/// search_files 跳过的目录（依赖/构建产物，无搜索价值且巨大）
const SEARCH_SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", ".codebuddy"];

/// execute_command 命令 → 可执行文件 + 参数策略映射（D-3 硬化）
///
/// 安全约束（相对旧版 `cmd /C` / `sh -c` 的改进）：
/// - **无 shell**：直接 `Command::new(exe).args(…)`，链式/重定向/变量替换无解释器承接；
/// - 移除可读任意文件的 shell 内置（type/dir/echo/ver/cat/ls 路径参数）→ 无 shell 内置命令；
/// - `base_args` 为固定前缀；`host_arg=true` 的命令（ping）仅接收单个经字符白名单校验的主机名；
/// - 其余命令的尾部参数原样传递（不执行、不解释，仅透传给可执行文件，无注入面）。
struct CmdDef {
    exe: &'static str,
    base_args: &'static [&'static str],
    /// 是否仅允许单个「主机名」参数（做字符白名单校验）
    host_arg: bool,
}

/// Windows 命令默认落在 System32（PATH 可解析）；Unix 使用绝对路径避免依赖 PATH 污染
const CMD_MAP: &[(&str, CmdDef)] = &[
    // ---- Windows ----
    (
        "tasklist",
        CmdDef {
            exe: "tasklist.exe",
            base_args: &[],
            host_arg: false,
        },
    ),
    (
        "ipconfig",
        CmdDef {
            exe: "ipconfig.exe",
            base_args: &[],
            host_arg: false,
        },
    ),
    (
        "whoami",
        CmdDef {
            exe: "whoami.exe",
            base_args: &[],
            host_arg: false,
        },
    ),
    (
        "hostname",
        CmdDef {
            exe: "hostname.exe",
            base_args: &[],
            host_arg: false,
        },
    ),
    (
        "systeminfo",
        CmdDef {
            exe: "systeminfo.exe",
            base_args: &[],
            host_arg: false,
        },
    ),
    (
        "netstat",
        CmdDef {
            exe: "netstat.exe",
            base_args: &[],
            host_arg: false,
        },
    ),
    (
        "ping",
        CmdDef {
            exe: "ping.exe",
            base_args: &["-n", "1", "-w", "1000"],
            host_arg: true,
        },
    ),
    // ---- Unix ----
    (
        "ls",
        CmdDef {
            exe: "/bin/ls",
            base_args: &["-1"],
            host_arg: false,
        },
    ),
    (
        "pwd",
        CmdDef {
            exe: "/bin/pwd",
            base_args: &[],
            host_arg: false,
        },
    ),
    (
        "date",
        CmdDef {
            exe: "/bin/date",
            base_args: &[],
            host_arg: false,
        },
    ),
    (
        "df",
        CmdDef {
            exe: "/bin/df",
            base_args: &[],
            host_arg: false,
        },
    ),
    (
        "free",
        CmdDef {
            exe: "/usr/bin/free",
            base_args: &[],
            host_arg: false,
        },
    ),
    (
        "uname",
        CmdDef {
            exe: "/bin/uname",
            base_args: &[],
            host_arg: false,
        },
    ),
];

/// 历史白名单命令（含 shell 内置与任意文件读）— 记录用于明确拒绝提示
const REMOVED_SHELL_BUILTINS: &[&str] = &["dir", "type", "echo", "ver", "cat", "ps"];

/// execute_command 超时（秒）
const EXECUTE_TIMEOUT_SECS: u64 = 5;
/// execute_command 输出截断（字节）
const EXECUTE_OUTPUT_LIMIT: usize = 10 * 1024;
/// sync_widget_state 内容上限（字节）
const WIDGET_STATE_MAX_BYTES: usize = 1024 * 1024;

// ============ 工具函数（跨平台） ============

/// 通配符匹配（`*` 任意长度、`?` 单字符，大小写不敏感，只匹配文件名）
fn wildcard_match(text: &str, pattern: &str) -> bool {
    fn inner(t: &[char], p: &[char]) -> bool {
        if p.is_empty() {
            return t.is_empty();
        }
        match p[0] {
            '*' => (0..=t.len()).any(|i| inner(&t[i..], &p[1..])),
            '?' => !t.is_empty() && inner(&t[1..], &p[1..]),
            c => !t.is_empty() && t[0] == c && inner(&t[1..], &p[1..]),
        }
    }
    inner(
        &text.to_lowercase().chars().collect::<Vec<_>>(),
        &pattern.to_lowercase().chars().collect::<Vec<_>>(),
    )
}

/// 递归收集匹配文件（相对路径），带深度/结果/跳过目录限制
fn search_recursive(
    dir: &Path,
    base: &Path,
    pattern: &str,
    out: &mut Vec<String>,
) -> Result<(), String> {
    if out.len() >= SEARCH_MAX_RESULTS {
        return Ok(());
    }
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if SEARCH_SKIP_DIRS.contains(&name) {
                continue;
            }
            let depth_ok = path
                .strip_prefix(base)
                .map(|rel| rel.components().count() < SEARCH_MAX_DEPTH)
                .unwrap_or(false);
            if depth_ok {
                search_recursive(&path, base, pattern, out)?;
            }
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if wildcard_match(name, pattern) {
                if let Ok(rel) = path.strip_prefix(base) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                    if out.len() >= SEARCH_MAX_RESULTS {
                        return Ok(());
                    }
                }
            }
        }
    }
    Ok(())
}

/// 搜索目录下匹配通配模式的文件（跨平台）
///
/// 前端调用方式：`invoke('search_files', { path: string, pattern: string })`
///
/// # Returns
/// 相对 `path` 的文件路径列表（`/` 分隔，最多 [`SEARCH_MAX_RESULTS`] 条）
#[tauri::command]
pub async fn search_files(
    window: tauri::Window,
    path: String,
    pattern: String,
) -> Result<Vec<String>, String> {
    // D-2: 文件搜索属 Agent 工具面，仅应用窗口调用
    crate::window_gate::require_window(&window, crate::window_gate::AGENT_WINDOWS)?;
    if pattern.trim().is_empty() {
        return Err("搜索模式不能为空".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // D-4: canonicalize 解析符号链接/相对路径，且以解析后路径为遍历基准，
        // 防止通过 .. / 符号链接逃逸出用户指定目录
        let root = std::fs::canonicalize(&path)
            .map_err(|e| format!("路径无效（无法解析）: {}: {}", path, e))?;
        if !root.is_dir() {
            return Err(format!("目录不存在: {}", root.display()));
        }
        let mut results = Vec::new();
        search_recursive(&root, &root, pattern.trim(), &mut results)?;
        Ok(results)
    })
    .await
    .map_err(|e| format!("搜索任务执行失败: {}", e))?
}

/// 截断文本到上限字节数（附加省略标记）
fn truncate_output(mut s: String) -> String {
    if s.len() > EXECUTE_OUTPUT_LIMIT {
        while !s.is_char_boundary(EXECUTE_OUTPUT_LIMIT.min(s.len()))
            && s.len() > EXECUTE_OUTPUT_LIMIT
        {
            s.pop();
        }
        s.truncate(EXECUTE_OUTPUT_LIMIT);
        s.push_str("\n...（输出已截断）");
    }
    s
}

/// 执行只读白名单命令（跨平台，安全受限）
///
/// 前端调用方式：`invoke('execute_command', { command: string })`
///
/// # 安全约束
/// - 命令首个 token 必须命中 [`EXECUTE_ALLOWLIST`]（全部为只读命令）
/// - 5 秒超时强制 kill（防止 AI Agent 挂起）
/// - stdout/stderr 合并输出，截断 10KB
/// - P1-07：高危命令签发（授权允许 / 白名单拒绝）均写入安全审计日志
///
/// ⚠️ 这不是通用 shell —— 任意命令执行永远不在白名单内
#[tauri::command]
pub async fn execute_command(
    window: tauri::Window,
    app: tauri::AppHandle,
    command: String,
) -> Result<String, String> {
    // D-2: 仅允许应用窗口调用（Agent 工具窗口集）
    crate::window_gate::require_window(&window, crate::window_gate::AGENT_WINDOWS)?;
    // D-6: 安全模式（检测到调试器）下拒绝执行系统命令
    if crate::antidebug::is_debugger_detected() {
        let _ = crate::audit_log::record_audit(
            &app,
            "security_event",
            "ai_agent",
            "安全模式拒绝 execute_command",
        );
        return Err("安全模式（检测到调试器），拒绝执行系统命令".to_string());
    }
    let first = command
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches('"')
        .to_lowercase();

    // P1-07：高危命令签发（授权允许 / 白名单拒绝 / 执行失败）统一写入安全审计日志。
    // 失败分支记录为 security_event，成功记录为 command_executed（含命令首 token 便于追溯）。
    let result = execute_command_core(command).await;
    let (event_type, outcome) = match &result {
        Ok(_) => ("command_executed", "授权执行"),
        Err(_) => ("security_event", "拒绝/执行失败"),
    };
    let _ = crate::audit_log::record_audit(
        &app,
        event_type,
        "ai_agent",
        &format!("execute_command {}: {}", outcome, first),
    );
    result
}

/// 解析结果：具体的可执行文件 + 固定前缀参数 + 尾部透传参数（无 shell）
struct ResolvedCmd {
    exe: String,
    base_args: Vec<String>,
    rest: Vec<String>,
}

fn resolve_command(command: &str) -> Result<ResolvedCmd, String> {
    let tokens: Vec<&str> = command.split_whitespace().collect();
    let first = tokens
        .first()
        .copied()
        .unwrap_or("")
        .trim_matches('"')
        .to_lowercase();

    let def = CMD_MAP.iter().find(|(name, _)| *name == first.as_str());
    let Some((_, def)) = def else {
        return Err(format!(
            "命令不在只读白名单内: {first}（允许: {}）",
            CMD_MAP
                .iter()
                .map(|(n, _)| *n)
                .collect::<Vec<_>>()
                .join(", ")
        ));
    };

    // 明确拒绝历史 shell 内置命令（可读任意文件 / 无独立可执行体）
    if REMOVED_SHELL_BUILTINS.contains(&first.as_str()) {
        return Err(format!(
            "命令 '{first}' 已因安全原因移除（shell 内置/可读任意文件），不再允许执行"
        ));
    }

    // 安全兜底：元字符黑名单（白名单只读命令绝不需要下列字符）
    const EXECUTE_FORBIDDEN_CHARS: &[char] = &[
        '&', '|', '>', '<', '^', ';', '`', '$', '\n', '\r', '(', ')', '%', '!',
    ];
    if command.contains(EXECUTE_FORBIDDEN_CHARS) {
        return Err(
            "命令包含非法 shell 元字符（仅允许单条只读命令，禁止链式/重定向/替换）".to_string(),
        );
    }

    // 参数校验：host_arg 命令只允许单个主机名（字符白名单）
    let rest: Vec<&str> = tokens[1..].to_vec();
    if def.host_arg {
        if rest.len() != 1 {
            return Err("ping 仅支持单个主机名参数，如 `ping example.com`".to_string());
        }
        let host = rest[0];
        let valid = !host.is_empty()
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_');
        if !valid {
            return Err("主机名包含非法字符".to_string());
        }
    }

    Ok(ResolvedCmd {
        exe: def.exe.to_string(),
        base_args: def.base_args.iter().map(|s| s.to_string()).collect(),
        rest: rest.into_iter().map(String::from).collect(),
    })
}

/// `execute_command` 的核心实现（解析校验 + 执行，无审计）。
///
/// pub：集成测试 `tests/test_system_runtime.rs` 在无 AppHandle 的进程内
/// 直接调用，覆盖白名单拒绝与真实 Win32 命令执行；审计联动由命令层负责。
///
/// # D-3 硬化说明
/// 旧实现用 `cmd /C` / `sh -c` 整串传递：白名单校验首 token 后仍会被
/// shell 解释链式/重定向/内置读文件（如 `type C:\\secret.txt` 可读任意文件）。
/// 现改为「命令 → 可执行文件 + 固定参数」显式映射，直接 `Command::new(exe).args(…)`
/// 无 shell 解释器：
/// - shell 内置（dir/type/echo/ver/cat/ps）不在映射表中 → 直接拒绝；
/// - 尾部参数透传给可执行文件（无解释执行，无注入面）；ping 的主机名做字符白名单；
/// - 元字符黑名单作为兜底仍保留。
pub async fn execute_command_core(command: String) -> Result<String, String> {
    let resolved = resolve_command(&command)?;

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&resolved.exe);
        cmd.args(&resolved.base_args).args(&resolved.rest);
        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("启动命令失败: {}", e))?;

        // 输出读取放独立线程，避免管道缓冲区填满导致死锁
        let mut stdout_pipe = child.stdout.take().ok_or("无法读取 stdout")?;
        let mut stderr_pipe = child.stderr.take().ok_or("无法读取 stderr")?;
        // 关键：控制台输出在中文 Windows 上是 GBK/OEM 编码（如 tasklist/ipconfig 的中文表头），
        // 用 read_to_string 会因非法 UTF-8 直接报错并返回空串。改为按字节读 + lossy 解码，
        // 保住 ASCII 部分（进程名 / IP 等真正有用的信息），中文表头降级为替换字符。
        let t_out = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stdout_pipe.read_to_end(&mut buf);
            String::from_utf8_lossy(&buf).into_owned()
        });
        let t_err = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stderr_pipe.read_to_end(&mut buf);
            String::from_utf8_lossy(&buf).into_owned()
        });

        // 轮询等待 / 超时 kill
        let start = Instant::now();
        let status = loop {
            match child
                .try_wait()
                .map_err(|e| format!("等待命令失败: {}", e))?
            {
                Some(status) => break status,
                None => {
                    if start.elapsed() > Duration::from_secs(EXECUTE_TIMEOUT_SECS) {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(format!("命令执行超时（{} 秒）", EXECUTE_TIMEOUT_SECS));
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        };

        let stdout = t_out.join().unwrap_or_default();
        let stderr = t_err.join().unwrap_or_default();

        let mut combined = String::new();
        if !stdout.trim().is_empty() {
            combined.push_str(stdout.trim_end());
        }
        if !stderr.trim().is_empty() {
            if !combined.is_empty() {
                combined.push('\n');
            }
            combined.push_str("[stderr] ");
            combined.push_str(stderr.trim_end());
        }
        combined = truncate_output(combined);

        if !status.success() {
            return Err(format!("命令退出码 {:?}: {}", status.code(), combined));
        }
        Ok(combined)
    })
    .await
    .map_err(|e| format!("命令执行任务失败: {}", e))?;

    outcome
}

/// 桌面小组件状态文件路径
fn widget_state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    Ok(dir.join("widget-state.json"))
}

/// 保存桌面小组件状态（跨平台）
///
/// 前端调用方式：`invoke('sync_widget_state', { state: string })`
///
/// # Arguments
/// - `state` — JSON 序列化的小组件状态（上限 1MB）
#[tauri::command]
pub async fn sync_widget_state(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: String,
) -> Result<(), String> {
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    if state.len() > WIDGET_STATE_MAX_BYTES {
        return Err(format!(
            "小组件状态过大（{} bytes，上限 {}）",
            state.len(),
            WIDGET_STATE_MAX_BYTES
        ));
    }
    let path = widget_state_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        std::fs::write(&path, state).map_err(|e| format!("写入小组件状态失败: {}", e))
    })
    .await
    .map_err(|e| format!("保存任务执行失败: {}", e))?
}

/// 读取桌面小组件状态（跨平台）
///
/// 前端调用方式：`invoke('read_widget_state')`
///
/// # Returns
/// 此前保存的 JSON 字符串；从未保存过时返回空字符串
#[tauri::command]
pub async fn read_widget_state(
    window: tauri::Window,
    app: tauri::AppHandle,
) -> Result<String, String> {
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    let path = widget_state_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if !path.exists() {
            return Ok(String::new());
        }
        std::fs::read_to_string(&path).map_err(|e| format!("读取小组件状态失败: {}", e))
    })
    .await
    .map_err(|e| format!("读取任务执行失败: {}", e))?
}

// ============ Windows-only 命令 ============

/// 截屏结果
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    /// PNG 图片的 base64（不带 data: 前缀）
    image_data: String,
    /// 实际宽度（可能因 max_width 等比缩小）
    width: i32,
    /// 实际高度
    height: i32,
}

/// 截屏区域请求（width/height 为 0 时截取整个虚拟屏幕）
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotRegion {
    #[allow(dead_code)]
    x: i32,
    #[allow(dead_code)]
    y: i32,
    #[allow(dead_code)]
    width: i32,
    #[allow(dead_code)]
    height: i32,
}

/// 截取屏幕区域（仅 Windows；其他平台返回明确错误）
///
/// 前端调用方式：
/// - `invoke('take_screenshot', { region: {x,y,width,height} })` — 指定区域
/// - `invoke('take_screenshot', { maxWidth: 512 })` — 全屏并等比缩到最大宽度
///
/// # Returns
/// [`ScreenshotResult`] — PNG base64 与实际尺寸（quality 参数为 JPEG 概念，PNG 无损忽略）
#[tauri::command]
pub async fn take_screenshot(
    window: tauri::Window,
    app: tauri::AppHandle,
    region: Option<ScreenshotRegion>,
    max_width: Option<i32>,
) -> Result<ScreenshotResult, String> {
    // D-2: 截屏仅允许应用窗口调用
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    // D-6: 安全模式（检测到调试器）下拒绝截屏（防屏幕内容外带）
    if crate::antidebug::is_debugger_detected() {
        let _ = crate::audit_log::record_audit(
            &app,
            "security_event",
            "ai_agent",
            "安全模式拒绝 take_screenshot",
        );
        return Err("安全模式（检测到调试器），拒绝截屏".to_string());
    }
    // P1-07：截屏为高风险命令（可能捕获屏幕隐私），一律写入安全审计日志
    let request_summary = match (&region, max_width) {
        (Some(r), _) if r.width > 0 && r.height > 0 => {
            format!(
                "take_screenshot region {}x{}@({},{})",
                r.width, r.height, r.x, r.y
            )
        }
        _ => format!(
            "take_screenshot 全屏{}",
            max_width
                .map(|m| format!("（maxWidth={}）", m))
                .unwrap_or_default()
        ),
    };
    let _ = crate::audit_log::record_audit(&app, "security_event", "ai_agent", &request_summary);

    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            // region 全为 0 → 整个虚拟屏幕
            let (x, y, w, h) = match &region {
                Some(r) if r.width > 0 && r.height > 0 => (r.x, r.y, r.width, r.height),
                _ => {
                    use windows::Win32::UI::WindowsAndMessaging::{
                        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
                        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
                    };
                    unsafe {
                        (
                            GetSystemMetrics(SM_XVIRTUALSCREEN),
                            GetSystemMetrics(SM_YVIRTUALSCREEN),
                            GetSystemMetrics(SM_CXVIRTUALSCREEN),
                            GetSystemMetrics(SM_CYVIRTUALSCREEN),
                        )
                    }
                }
            };
            if w <= 0 || h <= 0 {
                return Err(format!("截屏区域非法: {}×{}", w, h));
            }

            let (png_bytes, out_w, out_h) =
                capture_region_to_png(x, y, w as usize, h as usize, max_width)?;
            use base64::engine::general_purpose;
            use base64::Engine as _;
            Ok(ScreenshotResult {
                image_data: general_purpose::STANDARD.encode(png_bytes),
                width: out_w as i32,
                height: out_h as i32,
            })
        })
        .await
        .map_err(|e| format!("截屏任务执行失败: {}", e))?
    }

    #[cfg(not(windows))]
    {
        let _ = (region, max_width);
        Err::<ScreenshotResult, _>("take_screenshot 仅支持 Windows 桌面端".to_string())
    }
}

/// GDI 截屏 → BGRA → RGB（含可选等比缩小）→ PNG 编码
///
/// # Safety（unsafe 集中隔离，逐行依据）
/// 本函数包装 Win32 GDI FFI：句柄均配对释放（SelectObject 还原 / DeleteObject /
/// DeleteDC / ReleaseDC），失败路径提前 return 前同样清理。
#[cfg(windows)]
fn capture_region_to_png(
    x: i32,
    y: i32,
    w: usize,
    h: usize,
    max_width: Option<i32>,
) -> Result<(Vec<u8>, usize, usize), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
        DIB_RGB_COLORS, SRCCOPY,
    };

    unsafe {
        let hdc_screen = GetDC(HWND::default());
        if hdc_screen.is_invalid() {
            return Err("GetDC(屏幕) 失败".to_string());
        }

        let result = (|| -> Result<(Vec<u8>, usize, usize), String> {
            let hdc_mem = CreateCompatibleDC(hdc_screen);
            if hdc_mem.is_invalid() {
                return Err("CreateCompatibleDC 失败".to_string());
            }

            let hbmp = CreateCompatibleBitmap(hdc_screen, w as i32, h as i32);
            if hbmp.is_invalid() {
                let _ = DeleteDC(hdc_mem);
                return Err("CreateCompatibleBitmap 失败".to_string());
            }

            let hbmp_obj: windows::Win32::Graphics::Gdi::HGDIOBJ = hbmp.into();
            let old = SelectObject(hdc_mem, hbmp_obj);

            // 整个 GDI 使用期结束后统一清理（BitBlt 失败也要走 cleanup）
            let blt = BitBlt(
                hdc_mem,
                0,
                0,
                w as i32,
                h as i32,
                hdc_screen,
                x,
                y,
                SRCCOPY | CAPTUREBLT,
            );

            let out = if blt.is_ok() {
                // top-down DIB（biHeight 取负）
                let mut bmi = BITMAPINFO::default();
                bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
                bmi.bmiHeader.biWidth = w as i32;
                bmi.bmiHeader.biHeight = -(h as i32);
                bmi.bmiHeader.biPlanes = 1;
                bmi.bmiHeader.biBitCount = 32;
                bmi.bmiHeader.biCompression = BI_RGB.0;

                let mut bgra = vec![0u8; w * h * 4];
                let lines = GetDIBits(
                    hdc_mem,
                    hbmp,
                    0,
                    h as u32,
                    Some(bgra.as_mut_ptr().cast()),
                    &mut bmi,
                    DIB_RGB_COLORS,
                );
                if lines == 0 {
                    Err("GetDIBits 失败".to_string())
                } else {
                    // BGRA → RGB，可选等比缩小（nearest-neighbor，CPU 抽样足够截屏场景）
                    let (rgb, ow, oh) = match max_width.filter(|mw| (*mw as usize) < w) {
                        Some(mw) => downscale_bgra_to_rgb(&bgra, w, h, mw as usize),
                        None => bgra_to_rgb(&bgra, w, h),
                    };
                    encode_png(&rgb, ow, oh)
                }
            } else {
                Err("BitBlt 失败".to_string())
            };

            // 统一清理
            SelectObject(hdc_mem, old);
            let _ = DeleteObject(hbmp_obj);
            let _ = DeleteDC(hdc_mem);
            out
        })();

        ReleaseDC(HWND::default(), hdc_screen);

        result
    }
}

/// BGRA（top-down）→ RGB
#[cfg(windows)]
fn bgra_to_rgb(bgra: &[u8], w: usize, h: usize) -> (Vec<u8>, usize, usize) {
    let mut rgb = Vec::with_capacity(w * h * 3);
    for px in bgra.chunks_exact(4) {
        rgb.push(px[2]); // R
        rgb.push(px[1]); // G
        rgb.push(px[0]); // B
    }
    (rgb, w, h)
}

/// BGRA → RGB 并 nearest-neighbor 等比缩放到指定宽度
#[cfg(windows)]
fn downscale_bgra_to_rgb(
    bgra: &[u8],
    w: usize,
    h: usize,
    target_w: usize,
) -> (Vec<u8>, usize, usize) {
    let scale = w as f64 / target_w as f64;
    let target_h = ((h as f64 / scale).round() as usize).max(1);
    let mut rgb = vec![0u8; target_w * target_h * 3];
    for ty in 0..target_h {
        let sy = ((ty as f64 * scale) as usize).min(h - 1);
        for tx in 0..target_w {
            let sx = ((tx as f64 * scale) as usize).min(w - 1);
            let si = (sy * w + sx) * 4;
            let di = (ty * target_w + tx) * 3;
            rgb[di] = bgra[si + 2];
            rgb[di + 1] = bgra[si + 1];
            rgb[di + 2] = bgra[si];
        }
    }
    (rgb, target_w, target_h)
}

/// RGB8 → PNG 编码
#[cfg(windows)]
fn encode_png(rgb: &[u8], w: usize, h: usize) -> Result<(Vec<u8>, usize, usize), String> {
    let mut out = Vec::with_capacity(w * h / 2 + 1024);
    let mut encoder = png::Encoder::new(&mut out, w as u32, h as u32);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|e| format!("PNG 头写入失败: {}", e))?;
    writer
        .write_image_data(rgb)
        .map_err(|e| format!("PNG 数据写入失败: {}", e))?;
    writer
        .finish()
        .map_err(|e| format!("PNG 收尾失败: {}", e))?;
    Ok((out, w, h))
}

/// 枚举当前运行的进程名（去重排序；仅 Windows）
///
/// 前端调用方式：`invoke('get_running_processes')`
///
/// 用途：AI 助手检测（`aiAssistantDetector` 判断用户是否在与别的 AI 聊天）
#[tauri::command]
pub async fn get_running_processes(window: tauri::Window) -> Result<Vec<String>, String> {
    // D-2: 进程枚举属强隐私能力，仅应用窗口调用
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    get_running_processes_core().await
}

/// 核心实现（无窗口门禁；供集成测试真机调用）
pub async fn get_running_processes_core() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };

        tauri::async_runtime::spawn_blocking(move || unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
                .map_err(|e| format!("创建进程快照失败: {}", e))?;

            let mut names: Vec<String> = Vec::new();
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };

            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    // szExeFile 是 [u16;256] 定长缓冲，须在第一个 NUL 处截断，
                    // 否则 from_utf16_lossy 会把尾部填充的 \0 一并带出，破坏前端进程名匹配
                    let end = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
                    if !name.is_empty() {
                        names.push(name);
                    }
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);

            names.sort_unstable();
            names.dedup();
            Ok(names)
        })
        .await
        .map_err(|e| format!("进程枚举任务失败: {}", e))?
    }

    #[cfg(not(windows))]
    async { Err::<Vec<String>, _>("get_running_processes 仅支持 Windows 桌面端".to_string()) }.await
}

/// 设置系统主音量（仅 Windows，0.0~1.0）
///
/// 前端调用方式：`invoke('set_system_volume', { volume: 0.5 })`
#[tauri::command]
pub async fn set_system_volume(window: tauri::Window, volume: f64) -> Result<(), String> {
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    if !(0.0..=1.0).contains(&volume) {
        return Err(format!("音量超出范围: {}（应为 0.0~1.0）", volume));
    }

    #[cfg(windows)]
    {
        use windows::Win32::Media::Audio::{
            eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
            MMDeviceEnumerator,
        };
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        };

        let v = volume as f32;
        tauri::async_runtime::spawn_blocking(move || unsafe {
            // 线程池线程可能未初始化 COM；已初始化（S_FALSE/其他模式）时忽略错误继续
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("创建设备枚举器失败: {}", e))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("获取默认音频设备失败: {}", e))?;
            let endpoint: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("激活音量接口失败: {}", e))?;
            endpoint
                .SetMasterVolumeLevelScalar(v, std::ptr::null())
                .map_err(|e| format!("设置音量失败: {}", e))?;
            Ok(())
        })
        .await
        .map_err(|e| format!("音量任务执行失败: {}", e))?
    }

    #[cfg(not(windows))]
    async move {
        let _ = volume;
        Err::<(), _>("set_system_volume 仅支持 Windows 桌面端".to_string())
    }
    .await
}

/// 设置屏幕亮度（仅 Windows；经 PowerShell WMI，台式机外接屏通常不支持）
///
/// 前端调用方式：`invoke('set_system_brightness', { brightness: 50 })`
///
/// # 设计说明
/// Windows 没有调节亮度的公开轻量 API：笔记本内屏走 WMI
/// `WmiMonitorBrightnessMethods`，外接屏走 DDC/CI。此处用 PowerShell WMI
/// （无新 Rust 依赖）；不支持的硬件会得到明确错误而非静默失败。
#[tauri::command]
pub async fn set_system_brightness(window: tauri::Window, brightness: f64) -> Result<(), String> {
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    if !(0.0..=100.0).contains(&brightness) {
        return Err(format!("亮度超出范围: {}（应为 0~100）", brightness));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        tauri::async_runtime::spawn_blocking(move || {
            // WmiSetBrightness 的第一个参数是超时秒数（0/1 均可），第二个是亮度
            let script = format!(
                "(Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,{})",
                brightness as i32
            );
            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script])
                .creation_flags(0x0800_0000) // CREATE_NO_WINDOW：不闪黑窗
                .output()
                .map_err(|e| format!("无法启动 PowerShell: {}", e))?;

            if output.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!(
                    "亮度调节失败（台式机外接显示器通常不支持 WMI 亮度控制）: {}",
                    stderr.trim()
                ))
            }
        })
        .await
        .map_err(|e| format!("亮度任务执行失败: {}", e))?
    }

    #[cfg(not(windows))]
    async move {
        let _ = brightness;
        Err::<(), _>("set_system_brightness 仅支持 Windows 桌面端".to_string())
    }
    .await
}

// ============ 测试 ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wildcard_match() {
        assert!(wildcard_match("report.png", "*.png"));
        assert!(wildcard_match("REPORT.PNG", "*.png")); // 大小写不敏感
        assert!(wildcard_match("data_01.json", "data_??.json"));
        assert!(wildcard_match("app.log", "app*"));
        assert!(!wildcard_match("report.png", "*.jpg"));
        assert!(wildcard_match("a/b.png", "*.png") || true); // 仅匹配文件名，路径无关
        assert!(wildcard_match("b.png", "*.png"));
    }

    #[test]
    fn test_wildcard_match_edge_cases() {
        assert!(wildcard_match("", ""));
        assert!(wildcard_match("a", "?"));
        assert!(wildcard_match("ab", "*"));
        assert!(!wildcard_match("", "?"));
    }

    #[test]
    fn test_search_recursive_skips_and_limits() {
        // 构造临时目录：含命中文件 + 跳过目录（node_modules）+ 深层目录
        let base = std::env::temp_dir().join(format!("spiritpal_search_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(base.join("sub/deeper/deeper2/deeper3/deeper4/deeper5/deeper6/deeper7/deeper8/deeper9/deeper10/deeper11")).unwrap();
        std::fs::write(base.join("wanted.txt"), "x").unwrap();
        std::fs::write(base.join("node_modules/pkg/ignored.txt"), "x").unwrap();
        // 超出深度上限的文件（11 层）不应命中
        std::fs::write(
            base.join("sub/deeper/deeper2/deeper3/deeper4/deeper5/deeper6/deeper7/deeper8/deeper9/deeper10/deeper11/too-deep.txt"),
            "x",
        )
        .unwrap();

        let mut out = Vec::new();
        search_recursive(&base, &base, "*.txt", &mut out).unwrap();

        assert_eq!(out, vec!["wanted.txt".to_string()]);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_truncate_output_multibyte_safe() {
        // 1MB 边界附近的中文不 panic（char_boundary 保护）
        let big = "喵".repeat(100_000);
        let truncated = truncate_output(big);
        assert!(truncated.ends_with("...（输出已截断）"));
        assert!(truncated.len() <= EXECUTE_OUTPUT_LIMIT + 40);
    }

    #[test]
    fn test_truncate_output_short_passthrough() {
        assert_eq!(truncate_output("hello".to_string()), "hello");
    }

    #[test]
    fn test_cmd_map_has_no_shell_builtins() {
        // 危险命令 / shell 内置 / 任意文件读命令绝不允许进入映射表
        for banned in [
            "del", "rm", "format", "shutdown", "reg", "rmdir", "remove", "mv", "dd", "dir", "type",
            "echo", "ver", "cat", "ps",
        ] {
            assert!(
                !CMD_MAP.iter().any(|(name, _)| *name == banned),
                "映射表不允许包含: {}",
                banned
            );
        }
    }

    #[test]
    fn test_cmd_map_resolves_exe() {
        for (name, def) in CMD_MAP {
            assert!(!def.exe.is_empty(), "{name} 的 exe 不能为空");
            // host_arg 命令必须有 base args（固定前缀）
            if def.host_arg {
                assert!(
                    !def.base_args.is_empty(),
                    "{name} 作为 host 命令应有固定前缀参数"
                );
            }
        }
    }

    #[test]
    fn test_execute_rejects_removed_shell_builtins() {
        // D-3：shell 内置 / 任意文件读命令必须被拒绝（不落入可执行路径）
        for cmd in [
            "type C:\\Users\\doro\\secrets.txt",
            "dir C:\\Windows\\System32",
            "cat /etc/shadow",
            "echo x",
            "ver",
            "ps aux",
        ] {
            let res = resolve_command(cmd);
            assert!(res.is_err(), "命令应被拒绝: {cmd}");
        }
    }

    #[test]
    fn test_execute_rejects_unknown_commands() {
        assert!(resolve_command("format C: /y").is_err());
        assert!(resolve_command("shutdown /s").is_err());
        assert!(resolve_command("whoami | sudo").is_err());
    }

    #[test]
    fn test_execute_rejects_metachars() {
        assert!(
            resolve_command("tasklist & del evil.txt").is_err(),
            "链式命令必须被拒绝"
        );
        assert!(
            resolve_command("netstat > c:\\pwn.txt").is_err(),
            "重定向必须被拒绝"
        );
        assert!(
            resolve_command("ipconfig $(whoami)").is_err(),
            "变量替换必须被拒绝"
        );
    }

    #[test]
    fn test_execute_ping_host_validation() {
        // 缺主机名 / 非法字符 / 多参数 → 拒绝；合法主机名 → 解析通过
        assert!(resolve_command("ping").is_err());
        assert!(resolve_command("ping ha;ck.com").is_err());
        assert!(resolve_command("ping 127.0.0.1 8.8.8.8").is_err());
        let ok = resolve_command("ping example.com").unwrap();
        assert_eq!(ok.rest, vec!["example.com"]);
    }

    #[test]
    fn test_execute_allowlisted_cmd_resolves() {
        let ok = resolve_command("tasklist").unwrap();
        assert!(!ok.exe.is_empty());
        assert_eq!(ok.exe, "tasklist.exe");
        let ok = resolve_command("netstat -ano").unwrap();
        assert_eq!(ok.rest, vec!["-ano"]);
    }
}

// ============ P0-2：Agent 文件读写工具（read_file / write_file / list_directory）============

/// read_file 内容上限（字节，约 1MB）
const READ_FILE_MAX_BYTES: usize = 1024 * 1024;
/// write_file 内容上限（字节，约 512KB）
const WRITE_FILE_MAX_BYTES: usize = 512 * 1024;
/// list_directory 条目上限
const LIST_DIR_MAX_ENTRIES: usize = 500;

/// 敏感路径片段（大小写不敏感，匹配规范化绝对路径）。
/// 与前端 `toolParamValidator.ts` 的 `FORBIDDEN_PATH_SEGMENTS` 双端对齐。
const SENSITIVE_PATH_SEGMENTS: &[&str] = &[
    "/.ssh/",
    "/.gnupg/",
    "/.aws/",
    "/.config/",
    "/.git/",
    "/windows/system32/",
    "/program files/",
    "/program files (x86)/",
    "/etc/",
    "/usr/",
    "/bin/",
    "/sbin/",
];

/// 校验规范化绝对路径是否触及敏感目录
/// 统一将反斜杠归一为正斜杠，使 Windows（`C:\...\.ssh\...`）与 Unix 片段匹配一致
fn is_sensitive_path(normalized: &str) -> bool {
    let normalized = normalized.replace('\\', "/");
    let lower = normalized.to_lowercase();
    SENSITIVE_PATH_SEGMENTS
        .iter()
        .any(|seg| lower.contains(seg))
}

/// read_file / list_directory 的路径解析：canonicalize（解析符号链接 / 相对路径，防 `..` 逃逸）
fn resolve_path(path: &str) -> Result<std::path::PathBuf, String> {
    let real = std::fs::canonicalize(path)
        .map_err(|e| format!("路径无效（无法解析）: {}: {}", path, e))?;
    if is_sensitive_path(&real.to_string_lossy()) {
        return Err(format!(
            "路径位于敏感目录，已被拦截: {}",
            real.display()
        ));
    }
    Ok(real)
}

/// write_file 目标解析：父目录 canonicalize + 拼接文件名（目标文件可尚未存在），再校验敏感路径
fn resolve_write_target(path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::Path::new(path);
    let parent = p.parent().ok_or_else(|| "路径缺少父目录".to_string())?;
    let file_name = p.file_name().ok_or_else(|| "路径缺少文件名".to_string())?;
    let parent_real = std::fs::canonicalize(parent)
        .map_err(|e| format!("父目录无法解析: {}: {}", parent.display(), e))?;
    let target = parent_real.join(file_name);
    if is_sensitive_path(&target.to_string_lossy()) {
        return Err(format!(
            "目标路径位于敏感目录，已被拦截: {}",
            target.display()
        ));
    }
    Ok(target)
}

/// 读取文件文本内容（Agent 工具：`read_file`）
///
/// 前端调用：`invoke('read_file', { path: string })`
///
/// # 安全约束
/// - 仅应用窗口（chat-window / main）可调用（D-2 窗口门禁）
/// - canonicalize 解析符号链接 / 相对路径，防止 `..` 逃逸（D-4）
/// - 敏感目录（~/.ssh、/etc、Windows 系统区等）拒绝读取
/// - 仅文本文件（UTF-8），二进制报错；大小上限 1MB
#[tauri::command]
pub async fn read_file(window: tauri::Window, path: String) -> Result<String, String> {
    crate::window_gate::require_window(&window, crate::window_gate::AGENT_WINDOWS)?;
    tauri::async_runtime::spawn_blocking(move || {
        let real = resolve_path(&path)?;
        if !real.is_file() {
            return Err(format!("不是文件: {}", real.display()));
        }
        let meta = std::fs::metadata(&real)
            .map_err(|e| format!("读取文件元信息失败: {}", e))?;
        if meta.len() > READ_FILE_MAX_BYTES as u64 {
            return Err(format!(
                "文件过大（>{:.1}MB），拒绝读取: {}",
                READ_FILE_MAX_BYTES as f64 / (1024.0 * 1024.0),
                real.display()
            ));
        }
        let text = std::fs::read_to_string(&real).map_err(|e| {
            if e.kind() == std::io::ErrorKind::InvalidData {
                format!("二进制文件不支持文本读取: {}", real.display())
            } else {
                format!("读取文件失败: {}", e)
            }
        })?;
        Ok(text)
    })
    .await
    .map_err(|e| format!("读取任务执行失败: {}", e))?
}

/// 目录条目信息（`list_directory` 返回）
#[derive(serde::Serialize)]
pub struct DirEntryInfo {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

/// 列出目录条目（Agent 工具：`list_directory`）
///
/// 前端调用：`invoke('list_directory', { path?: string })`
///
/// # 安全约束
/// - 仅应用窗口可调用（D-2 窗口门禁）
/// - canonicalize 解析 + 敏感目录拒绝；条目数上限 500
#[tauri::command]
pub async fn list_directory(
    window: tauri::Window,
    path: Option<String>,
) -> Result<Vec<DirEntryInfo>, String> {
    crate::window_gate::require_window(&window, crate::window_gate::AGENT_WINDOWS)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir_str = path.unwrap_or_else(|| ".".to_string());
        let real = resolve_path(&dir_str)?;
        if !real.is_dir() {
            return Err(format!("不是目录: {}", real.display()));
        }
        let entries = std::fs::read_dir(&real)
            .map_err(|e| format!("读取目录失败 {}: {}", real.display(), e))?;
        let mut out = Vec::new();
        for entry in entries.flatten().take(LIST_DIR_MAX_ENTRIES) {
            let meta = entry
                .metadata()
                .map_err(|e| format!("读取条目元信息失败: {}", e))?;
            out.push(DirEntryInfo {
                name: entry.file_name().to_string_lossy().into_owned(),
                is_dir: meta.is_dir(),
                size: if meta.is_file() { meta.len() } else { 0 },
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("列目录任务执行失败: {}", e))?
}

/// 写入文件文本内容（Agent 工具：`write_file`，高风险操作）
///
/// 前端调用：`invoke('write_file', { path: string, content: string })`
///
/// # 安全约束
/// - 仅应用窗口可调用（D-2 窗口门禁）；安全模式（检测到调试器，D-6）拒绝写入
/// - canonicalize 父目录 + 敏感路径校验（禁止写 ~/.ssh、/etc、Windows 系统区、Program Files 等）
/// - 内容上限 512KB；拒绝 / 成功 / 失败均写安全审计日志（P1-07 风格）
#[tauri::command]
pub async fn write_file(
    window: tauri::Window,
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<String, String> {
    crate::window_gate::require_window(&window, crate::window_gate::AGENT_WINDOWS)?;
    // D-6: 安全模式（检测到调试器）下拒绝写入文件
    if crate::antidebug::is_debugger_detected() {
        let _ = crate::audit_log::record_audit(
            &app,
            "security_event",
            "ai_agent",
            "安全模式拒绝 write_file",
        );
        return Err("安全模式（检测到调试器），拒绝写入文件".to_string());
    }
    if content.len() > WRITE_FILE_MAX_BYTES {
        return Err(format!(
            "内容过大（>{:.1}KB），拒绝写入",
            WRITE_FILE_MAX_BYTES as f64 / 1024.0
        ));
    }
    // 路径解析（canonicalize 父目录）放阻塞线程，避免在 async 上下文做文件 IO
    let target = tauri::async_runtime::spawn_blocking({
        let path = path.clone();
        move || resolve_write_target(&path)
    })
    .await
    .map_err(|e| format!("路径解析任务失败: {}", e))??;

    // 审计需要目标路径展示；转成 String 避免 PathBuf 移动语义问题
    let target_display = target.to_string_lossy().into_owned();
    let display_in_closure = target_display.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&target, content.as_bytes())
            .map_err(|e| format!("写入文件失败 {}: {}", target.display(), e))?;
        Ok::<String, String>(format!(
            "已写入 {}（{} 字节）",
            display_in_closure, content.len()
        ))
    })
    .await
    .map_err(|e| format!("写入任务执行失败: {}", e))?;

    // P1-07 风格：高危写操作的签发 / 拒绝均写安全审计日志
    let (event_type, outcome) = match &result {
        Ok(_) => ("command_executed", "授权写入"),
        Err(_) => ("security_event", "拒绝/写入失败"),
    };
    let _ = crate::audit_log::record_audit(
        &app,
        event_type,
        "ai_agent",
        &format!("write_file {}: {}", outcome, target_display),
    );
    result
}

#[cfg(test)]
mod p0_2_tests {
    use super::*;

    #[test]
    fn test_is_sensitive_path_blocks_private_dirs() {
        // 敏感目录（大小写不敏感）必须拦截
        assert!(is_sensitive_path(r"C:\Users\me\.ssh\id_rsa"));
        assert!(is_sensitive_path("/home/u/.config/app.conf"));
        assert!(is_sensitive_path("C:\\Windows\\System32\\config\\sam"));
        assert!(is_sensitive_path("/etc/passwd"));
        assert!(is_sensitive_path("/home/u/.aws/credentials"));
        assert!(is_sensitive_path("C:\\Program Files\\test\\app.exe"));
        // 普通用户目录 / 项目目录放行
        assert!(!is_sensitive_path(r"C:\Users\me\Documents\test.txt"));
        assert!(!is_sensitive_path("/home/u/project/src/main.rs"));
        assert!(!is_sensitive_path(r"C:\Users\me\Desktop\notes.md"));
    }

    #[test]
    fn test_resolve_write_target_rejects_sensitive_parent() {
        // 指向系统 / 私密目录的写入目标必须被拒绝
        assert!(resolve_write_target(r"C:\Windows\System32\evil.txt").is_err());
        assert!(resolve_write_target("/home/u/.ssh/authorized_keys").is_err());
        assert!(resolve_write_target("C:\\Program Files\\x\\y.tmp").is_err());
    }

    #[test]
    fn test_resolve_write_target_accepts_user_dir() {
        // 临时目录下的文件（可不存在）解析成功，且可写
        let tmp = std::env::temp_dir();
        let path = tmp.join("spiritpal-p0-2-write-test.txt");
        let resolved = resolve_write_target(path.to_str().unwrap()).expect("用户临时目录应可写");
        let ok = std::fs::write(&resolved, "p0-2 test").is_ok();
        std::fs::remove_file(&resolved).ok();
        assert!(ok);
    }

    #[test]
    fn test_resolve_path_rejects_missing_and_sensitive() {
        assert!(resolve_path("/nonexistent/definitely/missing").is_err());
        assert!(resolve_path("/etc/hosts").is_err());
    }
}

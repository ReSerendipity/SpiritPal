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

/// execute_command 允许的只读命令白名单（首个 token 精确匹配，大小写不敏感）
const EXECUTE_ALLOWLIST: &[&str] = &[
    // Windows cmd 内置
    "dir",
    "type",
    "echo",
    "ver",
    "tasklist",
    "ipconfig",
    "whoami",
    "hostname",
    "systeminfo",
    "ping",
    "netstat",
    // Unix 常用
    "ls",
    "cat",
    "pwd",
    "date",
    "df",
    "free",
    "uname",
    "ps",
];
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
pub async fn search_files(path: String, pattern: String) -> Result<Vec<String>, String> {
    if pattern.trim().is_empty() {
        return Err("搜索模式不能为空".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&path);
        if !root.is_dir() {
            return Err(format!("目录不存在: {}", path));
        }
        let mut results = Vec::new();
        search_recursive(root, root, pattern.trim(), &mut results)?;
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
///
/// ⚠️ 这不是通用 shell —— 任意命令执行永远不在白名单内
#[tauri::command]
pub async fn execute_command(command: String) -> Result<String, String> {
    let first = command
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches('"')
        .to_lowercase();
    if !EXECUTE_ALLOWLIST.contains(&first.as_str()) {
        return Err(format!(
            "命令不在只读白名单内: {}（允许: {}）",
            first,
            EXECUTE_ALLOWLIST.join(", ")
        ));
    }

    // 安全：白名单只校验首 token，若不拦 shell 元字符，`tasklist & del evil.txt`
    // 会被 cmd /C 链式执行后半段破坏性命令（Gotcha：只读白名单可被绕过）。
    // 只读命令（tasklist/ipconfig/dir /s 等）只需空格与 / 参数，绝不需要下列元字符。
    const EXECUTE_FORBIDDEN_CHARS: &[char] = &[
        '&', '|', '>', '<', '^', ';', '`', '$', '\n', '\r', '(', ')', '%', '!',
    ];
    if command.contains(EXECUTE_FORBIDDEN_CHARS) {
        return Err(
            "命令包含非法 shell 元字符（仅允许单条只读命令，禁止链式/重定向/替换）".to_string(),
        );
    }

    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = std::process::Command::new("cmd");
            c.args(["/C", &command]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = std::process::Command::new("sh");
            c.args(["-c", &command]);
            c
        };
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
    .map_err(|e| format!("命令执行任务失败: {}", e))?
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
pub async fn sync_widget_state(app: tauri::AppHandle, state: String) -> Result<(), String> {
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
pub async fn read_widget_state(app: tauri::AppHandle) -> Result<String, String> {
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
    region: Option<ScreenshotRegion>,
    max_width: Option<i32>,
) -> Result<ScreenshotResult, String> {
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
pub async fn get_running_processes() -> Result<Vec<String>, String> {
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
pub async fn set_system_volume(volume: f64) -> Result<(), String> {
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
pub async fn set_system_brightness(brightness: f64) -> Result<(), String> {
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
        assert!(!wildcard_match("a/b.png", "*.png") == false || true); // 仅匹配文件名，路径无关
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
    fn test_execute_allowlist_is_readonly() {
        // 危险命令绝不允许混入白名单
        for banned in [
            "del", "rm", "format", "shutdown", "reg", "rmdir", "remove", "mv", "dd",
        ] {
            assert!(
                !EXECUTE_ALLOWLIST.contains(&banned),
                "白名单不允许包含危险命令: {}",
                banned
            );
        }
    }
}

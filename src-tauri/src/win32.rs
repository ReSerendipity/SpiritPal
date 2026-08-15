//! 平台原生 API 封装模块（Windows / macOS / Linux）
//!
//! [REFACTOR] 从 lib.rs 内联 mod win32 提取为独立文件
//! [P2-14] 拆分 macOS/Linux stub 为各自原生实现
//!
//! # 跨平台策略
//! - **Windows**: Win32 API（GetLastInputInfo, GetForegroundWindow 等）
//! - **macOS**:   系统命令（ioreg 读取空闲时间, osascript 获取前台窗口）
//! - **Linux**:   外部工具（xprintidle 空闲时间, xdotool 前台窗口），不可用时降级
//!
//! # 公共接口
//! - [`get_idle_ms`] → `u64`（毫秒，0 表示获取失败或永不空闲）
//! - [`get_active_window_info`] → `(title, process_name)`（空字符串表示获取失败）
//! - [`set_click_through`] — Windows 专属：设置窗口点击穿透
//! - [`remove_click_through`] — Windows 专属：移除窗口点击穿透
//! - [`start_topmost_keepalive`] — Windows 专属：启动窗口置顶轮询保活

#[cfg(windows)]
use windows::Win32::Foundation::HWND;

// ============ Windows 平台实现 ============

#[cfg(windows)]
mod platform_impl {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::*;
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    // Win32 窗口扩展样式常量
    // [PLATFORM-SPECIFIC] P3.2 - Win32 API 常量，对应 GWL_EXSTYLE / WS_EX_LAYERED / WS_EX_TRANSPARENT
    const GWL_EXSTYLE: WINDOW_LONG_PTR_INDEX = WINDOW_LONG_PTR_INDEX(-20);
    const WS_EX_LAYERED: u32 = 0x00080000;
    const WS_EX_TRANSPARENT: u32 = 0x00000020;

    /// 设置窗口鼠标点击穿透（Windows）
    ///
    /// 通过设置窗口扩展样式 `WS_EX_LAYERED | WS_EX_TRANSPARENT` 实现点击穿透，
    /// 使窗口不响应鼠标点击，点击事件穿透到下方窗口。
    ///
    /// # Win32 API 调用步骤
    /// 1. `GetWindowLongPtrW(hwnd, GWL_EXSTYLE)` 获取当前扩展样式
    /// 2. 位或添加 `WS_EX_LAYERED | WS_EX_TRANSPARENT`
    /// 3. `SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style)` 设置新样式
    /// 4. 检查返回值：返回 0 且 GetLastError 非 0 表示失败
    ///
    /// # Arguments
    /// - `hwnd` — 目标窗口句柄（HWND）
    ///
    /// # Returns
    /// - `Ok(())` — 设置成功
    /// - `Err(String)` — SetWindowLongPtrW 失败
    ///
    /// # Safety
    /// 调用方必须保证 `hwnd` 是有效的窗口句柄。
    /// - `GetWindowLongPtrW` / `SetWindowLongPtrW` 接收有效的 HWND 是安全的
    /// - `GetLastError` 在 Win32 API 调用后立即调用是安全的
    // [SECURITY] D6 - 检查 SetWindowLongPtrW 返回值，失败时返回 Err
    pub unsafe fn set_click_through(hwnd: HWND) -> Result<(), String> {
        // SAFETY: hwnd 由调用方（lib.rs 中从 Tauri window.hwnd() 获取）保证有效
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let new_style = (ex_style | WS_EX_LAYERED | WS_EX_TRANSPARENT) as isize;
        // SAFETY: hwnd 有效，GWL_EXSTYLE 是有效的索引，new_style 是合法的样式值
        let prev = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
        // SAFETY: GetLastError 在 Win32 API 调用后立即调用是安全的
        if prev == 0 && GetLastError().0 != 0 {
            return Err(format!(
                "SetWindowLongPtrW failed: error code {}",
                GetLastError().0
            ));
        }
        Ok(())
    }

    /// 移除窗口鼠标点击穿透（Windows）
    ///
    /// 清除窗口扩展样式中的 `WS_EX_TRANSPARENT` 位，恢复窗口响应鼠标点击。
    /// 保留 `WS_EX_LAYERED` 以支持透明窗口效果。
    ///
    /// # Win32 API 调用步骤
    /// 1. `GetWindowLongPtrW(hwnd, GWL_EXSTYLE)` 获取当前扩展样式
    /// 2. 位与非清除 `WS_EX_TRANSPARENT`
    /// 3. `SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style)` 设置新样式
    /// 4. 检查返回值
    ///
    /// # Arguments
    /// - `hwnd` — 目标窗口句柄（HWND）
    ///
    /// # Returns
    /// - `Ok(())` — 移除成功
    /// - `Err(String)` — SetWindowLongPtrW 失败
    ///
    /// # Safety
    /// 调用方必须保证 `hwnd` 是有效的窗口句柄。
    // [SECURITY] D6 - 检查 SetWindowLongPtrW 返回值，失败时返回 Err
    pub unsafe fn remove_click_through(hwnd: HWND) -> Result<(), String> {
        // SAFETY: hwnd 由调用方保证有效
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let new_style = (ex_style & !WS_EX_TRANSPARENT) as isize;
        // SAFETY: hwnd 有效，GWL_EXSTYLE 是有效的索引
        let prev = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
        // SAFETY: GetLastError 在此处调用是安全的
        if prev == 0 && GetLastError().0 != 0 {
            return Err(format!(
                "SetWindowLongPtrW failed: error code {}",
                GetLastError().0
            ));
        }
        Ok(())
    }

    /// 获取系统空闲时间（毫秒）（Windows）
    ///
    /// 使用 `GetLastInputInfo` 获取上次输入（键盘/鼠标）时间，
    /// 与当前 `GetTickCount` 差值计算空闲时长。
    ///
    /// # Win32 API 调用步骤
    /// 1. 初始化 `LASTINPUTINFO` 结构，设置 `cbSize` 为结构大小
    /// 2. 调用 `GetLastInputInfo` 获取上次输入时间
    /// 3. 调用 `GetTickCount` 获取当前系统运行时间
    /// 4. 计算差值：`tick_count - lii.dwTime`（使用 saturating_sub 防止溢出）
    ///
    /// # Returns
    /// 系统空闲时间（毫秒），获取失败时返回 0
    ///
    /// # Note
    /// `GetTickCount` 在 Windows 2000+ 可用，精度约 10-16ms，对于空闲检测足够。
    /// 需要更高精度可使用 `GetTickCount64`（Windows Vista+）。
    pub fn get_idle_ms() -> u64 {
        unsafe {
            let mut lii = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            // SAFETY: GetLastInputInfo 接收指向 LASTINPUTINFO 的有效指针
            // &mut lii 是有效的、对齐的、可写的，且 cbSize 已正确初始化
            if GetLastInputInfo(&mut lii).as_bool() {
                // GetTickCount 在 Windows 2000+ 可用，精度约 10-16ms
                // 对于亚秒级精度需求，这个精度已经足够
                // 如果需要更高精度，可使用 GetTickCount64 (Windows Vista+)
                // SAFETY: GetTickCount 是无参数的安全 API 调用
                let tick_count = GetTickCount();
                tick_count.saturating_sub(lii.dwTime) as u64
            } else {
                0
            }
        }
    }

    /// 获取前台窗口信息（标题 + 进程名）（Windows）
    ///
    /// 使用 Win32 API 获取当前前台窗口的标题和所属进程名。
    ///
    /// # Win32 API 调用步骤
    /// 1. `GetForegroundWindow()` 获取前台窗口句柄
    /// 2. `GetWindowTextW()` 获取窗口标题（UTF-16 缓冲区）
    /// 3. `GetWindowThreadProcessId()` 获取窗口所属进程 ID
    /// 4. `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)` 打开进程
    /// 5. `QueryFullProcessImageNameW()` 获取进程完整路径
    /// 6. 从路径中提取文件名（不含扩展名）作为进程名
    ///
    /// # Returns
    /// `(title, process_name)` 元组，获取失败时对应字段为空字符串
    pub fn get_active_window_info() -> (String, String) {
        unsafe {
            // SAFETY: GetForegroundWindow 是无参数的安全 API 调用
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return (String::new(), String::new());
            }

            // 获取窗口标题
            let mut title_buf = [0u16; 512];
            // SAFETY: GetWindowTextW 接收有效的 HWND、缓冲区指针和缓冲区大小
            // hwnd 有效，title_buf 是 512 个 u16 的有效数组
            let len = GetWindowTextW(hwnd, &mut title_buf);
            let title = if len > 0 {
                String::from_utf16_lossy(&title_buf[..len as usize])
            } else {
                String::new()
            };

            // 获取进程名
            let mut pid: u32 = 0;
            // SAFETY: GetWindowThreadProcessId 接收有效的 HWND 和可选的 PID 输出指针
            // &mut pid 是有效的 u32 指针
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let process_name = if pid != 0 {
                // SAFETY: OpenProcess 接收有效的访问权限标志、继承标志和进程 ID
                // PROCESS_QUERY_LIMITED_INFORMATION 是获取进程名所需的最小权限
                match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                    Ok(handle) => {
                        let mut name_buf = [0u16; 512];
                        let mut name_len: u32 = name_buf.len() as u32;
                        // SAFETY: QueryFullProcessImageNameW 接收有效的进程句柄、
                        // 名称格式标志、输出缓冲区指针和缓冲区长度指针
                        // handle 由 OpenProcess 返回的有效句柄
                        // PWSTR(name_buf.as_mut_ptr()) 指向 512 个 u16 的有效缓冲区
                        // &mut name_len 指向有效的 u32
                        let result = QueryFullProcessImageNameW(
                            handle,
                            PROCESS_NAME_FORMAT(0),
                            PWSTR(name_buf.as_mut_ptr()),
                            &mut name_len as *mut u32,
                        );
                        let _ = result;
                        if name_len > 0 {
                            let full_path =
                                String::from_utf16_lossy(&name_buf[..name_len as usize]);
                            std::path::Path::new(&full_path)
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .map(|s| s.to_string())
                                .unwrap_or_default()
                        } else {
                            String::new()
                        }
                    }
                    Err(_) => String::new(),
                }
            } else {
                String::new()
            };

            (title, process_name)
        }
    }

    /// 窗口置顶轮询保活线程（Windows）
    ///
    /// 参考 BongoCat：在后台线程中使用 `SetWindowPos(HWND_TOPMOST)` 约 16ms 轮询，
    /// 防止其他全屏应用抢占置顶状态导致宠物窗口被遮挡。
    ///
    /// # Win32 API 调用
    /// - `SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)`
    ///   - HWND_TOPMOST: 将窗口置于所有非置顶窗口之上
    ///   - SWP_NOMOVE: 保持当前位置（忽略 x, y 参数）
    ///   - SWP_NOSIZE: 保持当前大小（忽略 cx, cy 参数）
    ///
    /// # 线程安全
    /// - HWND 内部是 `*mut c_void`，不实现 Send。
    /// - 提取底层句柄值为 `isize` 跨线程传递，在线程内重建 HWND。
    ///   Win32 句柄在同一进程的线程间是有效的。
    /// - 通过 `running: Arc<AtomicBool>` 标志控制线程退出，应用退出时设为 false。
    ///
    /// # Arguments
    /// - `hwnd` — 目标窗口句柄（宠物窗口）
    /// - `running` — 线程退出标志（Arc<AtomicBool>，设为 false 停止轮询）
    pub fn start_topmost_keepalive(
        hwnd: HWND,
        running: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) {
        use std::sync::atomic::Ordering;
        use std::time::Duration;

        // HWND 内部是 *mut c_void，不实现 Send。
        // 提取底层句柄值为 isize（Win32 句柄的数值表示），跨线程传递后重建 HWND。
        let hwnd_val = hwnd.0 as isize;

        std::thread::spawn(move || {
            log::info!("[SpiritPal] 置顶保活线程启动");
            let hwnd = HWND(hwnd_val as *mut _);
            while running.load(Ordering::Acquire) {
                unsafe {
                    // SetWindowPos HWND_TOPMOST 保持窗口置顶
                    // SWP_NOMOVE | SWP_NOSIZE: 不改变窗口位置和大小
                    // SAFETY: hwnd 是从 isize 重建的有效窗口句柄
                    // HWND_TOPMOST 是常量，SWP_NOMOVE/SWP_NOSIZE 是有效标志
                    // x/y/cx/cy 为 0 但被 SWP_NOMOVE/SWP_NOSIZE 忽略
                    let _ = SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                }
                // 1000ms 轮询间隔：16ms（60fps）的 SetWindowPos 会在窗口重叠时高频抢占 Z 序
                // 导致其他窗口（聊天/设置）反复重绘闪烁，且拖动时打断鼠标捕获造成"拖不动"。
                // 1s 轮询仍能防全屏应用/其他窗口覆盖，用户无感知。
                std::thread::sleep(Duration::from_millis(1000));
            }
            log::info!("[SpiritPal] 置顶保活线程退出");
        });
    }
}

// ============ macOS 平台实现 ============
// [P2-14] 使用 macOS 自带系统命令实现，无需额外 FFI 依赖：
//   - 空闲时间：ioreg -c IOHIDSystem 读取 HIDIdleTime（纳秒 → 毫秒）
//   - 前台窗口：osascript 调用 AppleScript（NSWorkspace.frontmostApplication）
//
// 优势：osascript / ioreg 是 macOS 系统自带工具，100% 可用
// 劣势：每次调用需要 fork 进程，约 10-50ms 延迟（10秒轮询间隔可接受）

#[cfg(target_os = "macos")]
mod platform_impl {
    use std::process::Command;

    /// 获取系统空闲时间（毫秒）（macOS）
    ///
    /// 通过 `ioreg -c IOHIDSystem` 读取 HIDIdleTime 字段。
    /// HIDIdleTime 单位为纳秒，需除以 1,000,000 转换为毫秒。
    ///
    /// # ioreg 输出格式
    /// ioreg 输出每行可能包含以下两种格式：
    /// - 十进制：`"HIDIdleTime" = 12345678900`
    /// - 十六进制：`"HIDIdleTime" = <00000000 12345678>`（大端序 64 位，空格分隔的 32 位字）
    ///
    /// # Returns
    /// 系统空闲时间（毫秒），解析失败或 ioreg 执行失败时返回 0
    pub fn get_idle_ms() -> u64 {
        let output = Command::new("ioreg").args(["-c", "IOHIDSystem"]).output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for line in stdout.lines() {
                    if line.contains("HIDIdleTime") {
                        return parse_hid_idle_time(line);
                    }
                }
                log::warn!("[SpiritPal] ioreg 输出中未找到 HIDIdleTime 字段");
                0
            }
            Err(e) => {
                log::warn!("[SpiritPal] ioreg 执行失败: {}", e);
                0
            }
        }
    }

    /// 解析 ioreg 输出中的 HIDIdleTime 行
    ///
    /// 支持十进制和十六进制两种格式。
    ///
    /// # Arguments
    /// - `line` — ioreg 输出中包含 HIDIdleTime 的一行
    ///
    /// # Returns
    /// 空闲时间（毫秒），解析失败时返回 0
    fn parse_hid_idle_time(line: &str) -> u64 {
        if let Some(eq_pos) = line.find('=') {
            let value_part = line[eq_pos + 1..].trim();

            // 格式1: 十进制 — "HIDIdleTime" = 12345678900
            if !value_part.starts_with('<') {
                let nanos_str = value_part.trim_end_matches(',');
                if let Ok(nanos) = nanos_str.parse::<u64>() {
                    return nanos / 1_000_000; // 纳秒 → 毫秒
                }
            }

            // 格式2: 十六进制 — "HIDIdleTime" = <00000000 12345678>
            // 大端序，空格分隔的 32 位字
            if value_part.starts_with('<') && value_part.ends_with('>') {
                let hex_content = &value_part[1..value_part.len() - 1];
                let words: Vec<&str> = hex_content.split_whitespace().collect();
                let mut nanos: u64 = 0;
                let mut valid = true;
                for word in words {
                    match u32::from_str_radix(word, 16) {
                        Ok(w) => nanos = (nanos << 32) | (w as u64),
                        Err(_) => {
                            valid = false;
                            break;
                        }
                    }
                }
                if valid && nanos > 0 {
                    return nanos / 1_000_000;
                }
            }
        }
        log::warn!("[SpiritPal] 无法解析 HIDIdleTime: {}", line.trim());
        0
    }

    /// 获取前台窗口信息（标题 + 进程名）（macOS）
    ///
    /// 使用 osascript 调用 AppleScript System Events API。
    ///
    /// # Returns
    /// `(title, process_name)` 元组
    pub fn get_active_window_info() -> (String, String) {
        let process_name = get_frontmost_app_name();
        let title = get_front_window_title();
        (title, process_name)
    }

    /// 获取前台应用进程名（macOS）
    ///
    /// 使用 osascript 执行 AppleScript：
    /// `tell application "System Events" to get name of first process whose frontmost is true`
    ///
    /// # Returns
    /// 前台应用名称，执行失败时返回空字符串
    fn get_frontmost_app_name() -> String {
        Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to get name of first process whose frontmost is true",
            ])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }

    /// 获取前台窗口标题（macOS）
    ///
    /// 使用 osascript 执行 AppleScript：
    /// `tell application "System Events" to get title of front window of first process whose frontmost is true`
    ///
    /// # Returns
    /// 前台窗口标题，执行失败或无窗口时返回空字符串
    fn get_front_window_title() -> String {
        Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to get title of front window of first process whose frontmost is true",
            ])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }
}

// ============ Linux 平台实现 ============
// [P2-14] 使用外部工具实现，不可用时优雅降级：
//   - 空闲时间：xprintidle（X11），不可用返回 0
//   - 前台窗口：xdotool（X11），不可用返回空字符串
//
// Wayland 支持说明：
//   xdotool / xprintidle 仅支持 X11。Wayland 下需使用 D-Bus 接口：
//     - org.freedesktop.ScreenSaver (GetActiveTime) 替代 xprintidle
//     - org.gnome.Shell.Eval / wlr-foreign-toplevel 替代 xdotool
//   当前暂不实现 Wayland 支持，待 Wayland 原生方案成熟后补充。

#[cfg(target_os = "linux")]
mod platform_impl {
    use std::process::Command;

    /// 获取系统空闲时间（毫秒）（Linux）
    ///
    /// 优先使用 `xprintidle`（X11 工具），不可用时返回 0。
    /// xprintidle 直接输出空闲毫秒数。
    ///
    /// # Returns
    /// 系统空闲时间（毫秒），xprintidle 不可用或解析失败时返回 0
    pub fn get_idle_ms() -> u64 {
        let output = Command::new("xprintidle").output();
        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                match stdout.trim().parse::<u64>() {
                    Ok(ms) => ms,
                    Err(_) => {
                        log::warn!("[SpiritPal] xprintidle 输出无法解析: {:?}", stdout);
                        0
                    }
                }
            }
            Err(e) => {
                // xprintidle 未安装是常见情况，使用 debug 级别避免日志刷屏
                log::debug!(
                    "[SpiritPal] xprintidle 不可用（{}），空闲检测降级。安装方式: sudo apt install xprintidle",
                    e
                );
                0
            }
        }
    }

    /// 获取前台窗口信息（标题 + 进程名）（Linux）
    ///
    /// 优先使用 `xdotool`（X11 工具），不可用时返回空字符串。
    ///
    /// # 步骤
    /// 1. `xdotool getactivewindow` 获取活跃窗口 ID
    /// 2. `xdotool getactivewindow getwindowname` 获取窗口标题
    /// 3. `xdotool getactivewindow getwindowpid` 获取窗口 PID
    /// 4. 读取 `/proc/PID/comm` 获取进程名
    ///
    /// # Returns
    /// `(title, process_name)` 元组，xdotool 不可用时返回空字符串
    pub fn get_active_window_info() -> (String, String) {
        // 先获取活跃窗口 ID
        let window_id = match Command::new("xdotool").args(["getactivewindow"]).output() {
            Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
            Err(e) => {
                log::debug!(
                    "[SpiritPal] xdotool 不可用（{}），窗口检测降级。安装方式: sudo apt install xdotool",
                    e
                );
                return (String::new(), String::new());
            }
        };

        if window_id.is_empty() {
            return (String::new(), String::new());
        }

        // 获取窗口标题
        let title = Command::new("xdotool")
            .args(["getactivewindow", "getwindowname"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        // 获取窗口 PID → 进程名
        let process_name = Command::new("xdotool")
            .args(["getactivewindow", "getwindowpid"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|pid_str| {
                let pid = pid_str.trim();
                if pid.is_empty() {
                    return String::new();
                }
                // 从 /proc/PID/comm 读取进程名
                let comm_path = format!("/proc/{}/comm", pid);
                std::fs::read_to_string(&comm_path)
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            })
            .unwrap_or_default();

        (title, process_name)
    }
}

// ============ 其他平台降级实现 ============
// 非 Windows/macOS/Linux 平台（如 FreeBSD 等）返回默认值

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
mod platform_impl {
    /// 其他平台：空闲检测不可用，返回 0
    pub fn get_idle_ms() -> u64 {
        0
    }

    /// 其他平台：前台窗口信息不可用，返回空字符串
    pub fn get_active_window_info() -> (String, String) {
        (String::new(), String::new())
    }
}

// ============ 公共 re-export（跨平台统一接口）============

pub use platform_impl::{get_active_window_info, get_idle_ms};

/// Windows 专属：设置窗口点击穿透
///
/// 非 Windows 平台在命令层（lib.rs）返回 Err，不会调用此函数。
/// unsafe 封装在内部，对外提供安全接口。
///
/// # Arguments
/// - `hwnd` — 目标窗口句柄
///
/// # Returns
/// - `Ok(())` — 设置成功
/// - `Err(String)` — Win32 API 调用失败
#[cfg(windows)]
pub fn set_click_through(hwnd: HWND) -> Result<(), String> {
    // [SECURITY] D6 - unsafe 封装在内部，对外提供安全接口
    unsafe { platform_impl::set_click_through(hwnd) }
}

/// Windows 专属：移除窗口点击穿透
///
/// 非 Windows 平台在命令层返回 Err，不会调用此函数。
///
/// # Arguments
/// - `hwnd` — 目标窗口句柄
///
/// # Returns
/// - `Ok(())` — 移除成功
/// - `Err(String)` — Win32 API 调用失败
#[cfg(windows)]
pub fn remove_click_through(hwnd: HWND) -> Result<(), String> {
    unsafe { platform_impl::remove_click_through(hwnd) }
}

/// Windows 专属：启动窗口置顶轮询保活线程
///
/// 参考 BongoCat：在后台线程中使用 `SetWindowPos(HWND_TOPMOST)` 约 16ms 轮询，
/// 防止其他全屏应用抢占置顶状态导致宠物窗口被遮挡。
/// 非 Windows 平台为空操作（no-op），因为 Tauri 的 alwaysOnTop 在 macOS/Linux 上更稳定。
///
/// # Arguments
/// - `hwnd` — 宠物窗口句柄
/// - `running` — 线程退出标志
#[cfg(windows)]
pub fn start_topmost_keepalive(hwnd: HWND, running: std::sync::Arc<std::sync::atomic::AtomicBool>) {
    platform_impl::start_topmost_keepalive(hwnd, running);
}

/// macOS / Linux / 其他平台：置顶保活为空操作
///
/// macOS/Linux 上 Tauri 的 alwaysOnTop 属性更稳定，不需要额外轮询。
#[cfg(not(windows))]
pub fn start_topmost_keepalive() {
    // no-op: 非 Windows 平台不需要置顶保活
}

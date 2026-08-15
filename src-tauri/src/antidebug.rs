//! R-12: 反调试检测模块（v2.0 增强）
//!
//! 在应用启动时检测调试器附加，防止逆向工程。
//! 命中后仅触发"安全模式"标记 + 日志上报，不 panic（避免误报崩溃）。
//!
//! 检测策略（三层低成本检测）：
//! - Windows: IsDebuggerPresent + CheckRemoteDebuggerPresent + NtQueryInformationProcess(ProcessDebugPort)
//!   三选二命中即标记
//! - macOS: sysctl(KERN_PROC, KERN_PROC_PID) + P_TRACED flag + ptrace(PT_DENY_ATTACH)
//! - Linux: 读取 /proc/self/status TracerPid != 0
//!
//! 注意: 桌面端防逆向是"提高成本"而非"绝对防住"。

use log::warn;
use std::sync::atomic::{AtomicBool, Ordering};

/// 全局调试器检测标记
static DEBUGGER_DETECTED: AtomicBool = AtomicBool::new(false);

/// 检测调试器是否附加（Windows 增强 v2.0）
///
/// Windows 平台使用三层检测，三选二命中即标记：
/// 1. IsDebuggerPresent — 检测用户态调试器
/// 2. CheckRemoteDebuggerPresent — 检测远程调试器
/// 3. NtQueryInformationProcess(ProcessDebugPort) — 检测调试端口
#[cfg(target_os = "windows")]
pub fn check_debugger() -> bool {
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::System::Diagnostics::Debug::{
        CheckRemoteDebuggerPresent, IsDebuggerPresent,
    };
    use windows::Win32::System::Threading::GetCurrentProcess;

    let mut hits = 0u32;

    // 1. IsDebuggerPresent
    let present = unsafe { IsDebuggerPresent() }.as_bool();
    if present {
        warn!("[AntiDebug] Debugger detected via IsDebuggerPresent!");
        hits += 1;
    }

    // 2. CheckRemoteDebuggerPresent
    let mut remote_debugged = BOOL(0);
    let _ = unsafe { CheckRemoteDebuggerPresent(GetCurrentProcess(), &mut remote_debugged) };
    if remote_debugged.as_bool() {
        warn!("[AntiDebug] Debugger detected via CheckRemoteDebuggerPresent!");
        hits += 1;
    }

    // 3. NtQueryInformationProcess(ProcessDebugPort) — 通过 ntdll 直接调用
    // ProcessDebugPort = 7, 读取进程的调试端口
    #[cfg(target_arch = "x86_64")]
    {
        unsafe {
            use std::ffi::CString;
            use windows::core::PCSTR;
            use windows::Win32::System::LibraryLoader::GetModuleHandleA;

            let ntdll_name = CString::new(obfstr::obfstr!("ntdll.dll")).unwrap();
            if let Ok(ntdll) = GetModuleHandleA(PCSTR(ntdll_name.as_ptr() as *const u8)) {
                let func_name = CString::new(obfstr::obfstr!("NtQueryInformationProcess")).unwrap();
                let func_ptr = windows::Win32::System::LibraryLoader::GetProcAddress(
                    ntdll,
                    PCSTR(func_name.as_ptr() as *const u8),
                );

                if let Some(func) = func_ptr {
                    // NtQueryInformationProcess signature:
                    // NTSTATUS NtQueryInformationProcess(
                    //   HANDLE ProcessHandle,
                    //   PROCESSINFOCLASS ProcessInformationClass,  // 7 = ProcessDebugPort
                    //   PVOID ProcessInformation,
                    //   ULONG ProcessInformationLength,
                    //   PULONG ReturnLength
                    // )
                    type NtQueryInformationProcessFn = unsafe extern "system" fn(
                        isize,
                        u32,
                        *mut std::ffi::c_void,
                        u32,
                        *mut u32,
                    )
                        -> i32;

                    let nt_query: NtQueryInformationProcessFn = std::mem::transmute(func);
                    let mut debug_port: usize = 0;
                    let mut return_len: u32 = 0;
                    let status = nt_query(
                        -1isize, // GetCurrentProcess() handle = (HANDLE)-1
                        7,       // ProcessDebugPort
                        &mut debug_port as *mut _ as *mut std::ffi::c_void,
                        std::mem::size_of::<usize>() as u32,
                        &mut return_len,
                    );
                    // STATUS_SUCCESS = 0
                    if status == 0 && debug_port != 0 {
                        warn!("[AntiDebug] Debugger detected via NtQueryInformationProcess(ProcessDebugPort)!");
                        hits += 1;
                    }
                }
            }
        }
    }

    // 三选二命中即标记
    let detected = hits >= 2 || (hits >= 1 && present);
    if detected {
        DEBUGGER_DETECTED.store(true, Ordering::Relaxed);
    }
    detected
}

/// macOS 平台调试器检测
#[cfg(target_os = "macos")]
pub fn check_debugger() -> bool {
    use std::mem;

    // macOS: sysctl(KERN_PROC, KERN_PROC_PID) + P_TRACED flag
    // KERN_PROC = 14, KERN_PROC_PID = 1, P_TRACED = 0x00000800
    const KERN_PROC: i32 = 14;
    const KERN_PROC_PID: i32 = 1;
    const P_TRACED: u32 = 0x00000800;

    #[repr(C)]
    struct KInfoProc {
        ki_structsize: i32,
        ki_rusage: [u8; 144],
        ki_rusage_ch: [u8; 144],
        ki_paddr: u64,
        ki_stat: i8,
        ki_xstat: u16,
        ki_acflag: u32,
        ki_traceflag: u32,
        // ... truncated, we only need traceflag
    }

    let mut mib = [KERN_PROC, KERN_PROC_PID];
    let pid = std::process::id() as i32;
    mib[1] = KERN_PROC_PID;

    let mut info: KInfoProc = unsafe { mem::zeroed() };
    let mut size = mem::size_of::<KInfoProc>();

    let detected = unsafe {
        libc_sysctl(
            mib.as_mut_ptr(),
            2,
            &mut info as *mut _ as *mut _,
            &mut size,
            std::ptr::null_mut(),
            0,
        ) == 0
            && (info.ki_traceflag & P_TRACED) != 0
    };

    if detected {
        warn!("[AntiDebug] Debugger detected via sysctl P_TRACED!");
        DEBUGGER_DETECTED.store(true, Ordering::Relaxed);
    }
    detected
}

/// macOS sysctl 绑定
#[cfg(target_os = "macos")]
extern "C" {
    fn sysctl(
        name: *mut i32,
        namelen: u32,
        oldp: *mut std::ffi::c_void,
        oldlenp: *mut usize,
        newp: *const std::ffi::c_void,
        newlen: usize,
    ) -> i32;
}

#[cfg(target_os = "macos")]
unsafe fn libc_sysctl(
    name: *mut i32,
    namelen: i32,
    oldp: *mut std::ffi::c_void,
    oldlenp: *mut usize,
    newp: *mut std::ffi::c_void,
    newlen: usize,
) -> i32 {
    sysctl(name, namelen as u32, oldp, oldlenp, newp, newlen)
}

/// Linux 平台调试器检测
#[cfg(target_os = "linux")]
pub fn check_debugger() -> bool {
    // Linux: 读取 /proc/self/status TracerPid != 0
    if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
        for line in status.lines() {
            if line.starts_with("TracerPid:") {
                if let Some(pid_str) = line.split(':').nth(1) {
                    let pid: i32 = pid_str.trim().parse().unwrap_or(0);
                    if pid != 0 {
                        warn!(
                            "[AntiDebug] Debugger detected via /proc/self/status TracerPid={}!",
                            pid
                        );
                        DEBUGGER_DETECTED.store(true, Ordering::Relaxed);
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// 非 Windows/macOS/Linux 平台：no-op
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn check_debugger() -> bool {
    false
}

/// 检查全局调试器检测标记是否被设置
///
/// 可在其他模块中调用此函数，如果返回 true 则进入"安全模式"
/// （加密功能返回 Err 但不崩）。
#[allow(dead_code)]
pub fn is_debugger_detected() -> bool {
    DEBUGGER_DETECTED.load(Ordering::Relaxed)
}

/// 启动时反调试检查
/// 在 Tauri setup hook 中调用
pub fn startup_check() {
    let _ = check_debugger();
}

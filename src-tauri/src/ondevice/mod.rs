//! 端侧推理子系统（on-device LLM）。
//!
//! 架构三件套移植自 `Daniele-rolli/tauri-plugin-local-ai`（Apache-2.0 友好，纯 Rust）：
//! - [`tier`]      — 设备分档 T0/T1/T2（决定可跑的模型尺寸）
//! - [`scheduler`] — 串行推理槽 + `CancellationToken` 取消（单 Worker，防 CPU/显存抢占 OOM）
//! - [`models`]    — 模型下载缓存 + LRU 空闲卸载
//!
//! 移动端（Android）实际推理走 **内嵌 MNN 引擎**（`libmnnllmapp.so`，经 Kotlin/JNI 桥接，
//! 详见 `docs/agents/ondevice-embed-plan.md`）。本模块只提供与平台无关的分档/调度/缓存原语，
//! 以及跨平台 [`detect_device_tier`] 命令，供前端 `src/lib/ai/onDeviceTiers.ts` 使用。
//!
//! 约束：MNN 不是 SpiritPal 的运行依赖——
//! 桌面端本地推理由 Ollama 承担，本模块在桌面只做分档建议；移动端 MNN 引擎内嵌但「惰性」，
//! 未加载模型时 `ondevice` provider 不可用、其余 provider（云端/Ollama）照常工作。

pub mod models;
pub mod scheduler;
pub mod tier;
// 移动端（Android）内嵌 MNN 引擎桥（JNI）。仅 #[cfg(mobile)] 编译；桌面端不编此文件，
// 桌面 ondevice 走 companion loopback（前端 llmClient.ts）。见 engine.rs 头注与 ondevice-embed-plan.md §3.3–§3.6。
#[cfg(mobile)]
pub mod engine;

use serde::Serialize;
use tier::{llm_allowed, Tier};
// detect_tier 仅移动端分支使用；桌面端编译时排除避免 unused import
#[cfg(not(desktop))]
use tier::detect_tier;

#[derive(Serialize)]
pub struct DeviceTierResult {
    /// "T0" | "T1" | "T2"
    pub tier: String,
    pub llm_allowed: bool,
    /// 人类可读说明（含探测到的 RAM/核数或平台身份）
    pub note: String,
}

/// 跨平台设备分档命令。前端 `onDeviceTiers.ts` 调用以决定推荐模型尺寸。
#[tauri::command]
pub fn detect_device_tier(saver: bool) -> DeviceTierResult {
    let (tier, note) = platform_tier(saver);
    let s = match tier {
        Tier::T0 => "T0",
        Tier::T1 => "T1",
        Tier::T2 => "T2",
    };
    DeviceTierResult {
        tier: s.to_string(),
        llm_allowed: llm_allowed(tier),
        note,
    }
}

#[cfg(desktop)]
fn platform_tier(_saver: bool) -> (Tier, String) {
    // 桌面端本地推理由 Ollama 承担，不依赖 MNN；设备能力默认充足（T2）。
    (Tier::T2, "desktop: Ollama-capable".to_string())
}

#[cfg(not(desktop))]
fn platform_tier(saver: bool) -> (Tier, String) {
    // 移动端：核数用 available_parallelism；RAM 读 /proc/meminfo（见 mobile_total_ram_gb），
    // 读不到时回退保守默认 8GB。
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let total_ram_gb = mobile_total_ram_gb().unwrap_or(8.0);
    let t = detect_tier(total_ram_gb, cores, saver);
    (
        t,
        format!("mobile: {total_ram_gb:.1}GB/{cores}cores (estimated)"),
    )
}

#[cfg(not(desktop))]
fn mobile_total_ram_gb() -> Option<f64> {
    // Android 即 Linux：`/proc/meminfo` 的 `MemTotal` 与 `ActivityManager.MemoryInfo.totalMem`
    // 同源（都是物理内存总量），故直接读取 —— 免去 Context/JNI 管线。
    // 行格式：`MemTotal:       12345678 kB`
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = text.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kb: f64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb / 1024.0 / 1024.0)
}

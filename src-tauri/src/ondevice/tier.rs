//! 设备分档（device tiering）—— 移植自 `Daniele-rolli/tauri-plugin-local-ai`（`tier.rs`）。
//!
//! 纯 Rust、与平台无关，决定一台设备能跑多大尺寸的端侧模型。
//! 前端 `src/lib/ai/onDeviceTiers.ts` 通过 `detect_device_tier` 命令调用本模块。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    T0,
    T1,
    T2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Quality,
    Balanced,
    Saver,
}

/// 根据物理内存(GB)与 CPU 核数分档；`saver=true` 时把 T2 降为 T1（省电/降温）。
pub fn detect_tier(total_ram_gb: f64, cores: usize, saver: bool) -> Tier {
    let base = if total_ram_gb < 6.0 || cores <= 2 {
        Tier::T0
    } else if total_ram_gb < 12.0 || cores <= 4 {
        Tier::T1
    } else {
        Tier::T2
    };
    match (base, saver) {
        (Tier::T2, true) => Tier::T1,
        (b, _) => b,
    }
}

/// T0 设备内存/核数过低，不允许加载 LLM。
pub fn llm_allowed(t: Tier) -> bool {
    !matches!(t, Tier::T0)
}

/// 仅 T2 允许加载 large STT 模型。
pub fn stt_large_allowed(t: Tier) -> bool {
    matches!(t, Tier::T2)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_intel_dual_core_is_t0() {
        assert_eq!(detect_tier(4.0, 2, false), Tier::T0);
        assert!(!llm_allowed(Tier::T0));
    }
    #[test]
    fn mid_laptop_is_t1() {
        assert_eq!(detect_tier(8.0, 4, false), Tier::T1);
        assert!(llm_allowed(Tier::T1));
    }
    #[test]
    fn saver_downgrades_t2_to_t1() {
        assert_eq!(detect_tier(32.0, 8, true), Tier::T1);
    }
}

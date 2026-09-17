/**
 * 端侧 Qwen3.5 设备分档表
 *
 * @fileoverview 基于 2026-09-15 内存预算测算，把「设备 RAM → 可运行模型/上下文」的
 * 结论固化为代码，供设置页推荐、运行时校验、以及后续 UI 展示复用。
 *
 * 预算模型（单位 GB）：
 *   可用预算 = 设备 RAM × 系数 − 系统预留
 *   单模型占用 = 权重 + 视觉 mmproj + 线性层循环状态 + 运行时(0.14) + 应用基线(0.45) + KV cache
 *   Qwen3.5 混合注意力：仅 1/4 层持 KV cache，故同参数下上下文容量约为标准 Transformer 的 4×。
 *
 * 结论速查（Qwen3.5-2B）：
 *   - Q4_K_M 权重 1.281 + 视觉 0.668 + 线性态 0.019 = 固定 1.97GB（不含 KV）
 *   - KV(Q8_0) @128K ≈ 0.856GB → 2B Q4_K_M + Q8 KV + 视觉 共 ≈ 3.41GB
 *   - 实机验证：骁龙8至尊版 / 12GB / Android 16，30+ tok/s（2026-09-15）
 *
 * 数据来源：docs/execution/ondevice-model-budget-20260915.html（交互式计算器）
 */

import { invoke } from '@tauri-apps/api/core'

/** 设备内存档位 */
export interface OnDeviceTier {
  /** 设备物理 RAM（GB） */
  ramGB: number
  /** 可分配给 LLM 进程的内存预算（GB） */
  budgetGB: number
  /** Qwen3.5-2B Q4_K_M 基础推理（不含 128K KV + 视觉）是否可装入 */
  feasible2B_Q4: boolean
  /** 固定 128K 上下文 + 视觉常驻（2B Q4_K_M + Q8 KV ≈ 3.41GB）是否可行 */
  feasible128KVision: boolean
  /** 该档位推荐配置说明 */
  note: string
}

/**
 * 端侧分档表（由低到高）。
 * 注意：6GB 档固定开销 1.97GB 已超其 1.8GB 预算，故 2B 也不可行。
 */
export const ON_DEVICE_TIERS: OnDeviceTier[] = [
  {
    ramGB: 6,
    budgetGB: 1.8,
    feasible2B_Q4: false,
    feasible128KVision: false,
    note: '连 2B Q4 固定开销 1.97GB 都超预算，端侧不可行；建议走云端 provider',
  },
  {
    ramGB: 8,
    budgetGB: 2.8,
    feasible2B_Q4: true,
    feasible128KVision: false,
    note: '2B Q4 可跑（1.97<2.8）；但 128K+视觉 3.41GB 超 0.61GB，须降上下文或去视觉',
  },
  {
    ramGB: 12,
    budgetGB: 4.0,
    feasible2B_Q4: true,
    feasible128KVision: true,
    note: '旗舰舒适解：2B Q4_K_M + Q8 KV + 视觉 ≈ 3.41GB（已实机验证 30+ tok/s）',
  },
  {
    ramGB: 16,
    budgetGB: 6.0,
    feasible2B_Q4: true,
    feasible128KVision: true,
    note: '可升 2B Q8_0 + F16 KV（4.90GB），质量更优',
  },
  {
    ramGB: 24,
    budgetGB: 10.0,
    feasible2B_Q4: true,
    feasible128KVision: true,
    note: '可上 4B Q4_K_M（3.46GB）；但 4B 128K+视觉仍不可行（KV 过大）',
  },
]

/**
 * 根据设备 RAM 返回适用档位。
 * 低于 6GB 归入 6GB 档（标不可行）；高于 24GB 归入 24GB 档。
 */
export function getOnDeviceTier(ramGB: number): OnDeviceTier {
  if (ramGB <= 0) return ON_DEVICE_TIERS[0]!
  let best = ON_DEVICE_TIERS[0]!
  for (const tier of ON_DEVICE_TIERS) {
    if (ramGB >= tier.ramGB) best = tier
  }
  return best
}

/**
 * 推荐给用户的端侧模型配置摘要（用于设置页提示）。
 * 目标模型固定为 Qwen3.5-2B（视觉 + 128K 上下文）。
 */
export interface OnDeviceRecommendation {
  tier: OnDeviceTier
  /** 是否建议启用端侧 */
  recommended: boolean
  /** 推荐量化（Q4_K_M / Q8_0） */
  quant: 'Q4_K_M' | 'Q8_0'
  /** 推荐 KV 精度 */
  kvPrecision: 'F16' | 'Q8_0' | 'Q4_0'
  /** 推荐上下文上限（token） */
  maxContext: number
  /** 给用户的提示文案 */
  hint: string
}

/**
 * 生成端侧推荐配置。
 * @param ramGB 设备 RAM
 * @param vision 是否需要视觉（宠物截图理解）
 */
export function recommendOnDevice(ramGB: number, vision = true): OnDeviceRecommendation {
  const tier = getOnDeviceTier(ramGB)

  if (!tier.feasible2B_Q4) {
    return {
      tier,
      recommended: false,
      quant: 'Q4_K_M',
      kvPrecision: 'Q8_0',
      maxContext: 0,
      hint: `设备 ${ramGB}GB 内存不足以运行端侧 2B 模型，建议使用云端 provider 或升级设备`,
    }
  }

  if (vision && !tier.feasible128KVision) {
    // 8GB 档：去视觉或降上下文
    return {
      tier,
      recommended: true,
      quant: 'Q4_K_M',
      kvPrecision: 'Q4_0',
      maxContext: 32768,
      hint: `2B Q4_K_M 可跑，但 128K+视觉超预算；建议关闭视觉并将上下文降到 32K（仍优于云端延迟）`,
    }
  }

  // 12GB+：旗舰配置（2B Q4_K_M + Q8 KV + 视觉 + 128K）
  const quant: 'Q4_K_M' | 'Q8_0' = ramGB >= 16 ? 'Q8_0' : 'Q4_K_M'
  return {
    tier,
    recommended: true,
    quant,
    kvPrecision: 'Q8_0',
    maxContext: 131072,
    hint: `推荐 Qwen3.5-2B ${quant} + 视觉 + 128K 上下文（KV Q8_0 近无损），固定约 ${
      quant === 'Q8_0' ? '4.90' : '3.41'
    }GB，已在 12GB 旗舰实机验证 30+ tok/s`,
  }
}

/**
 * 由 Rust 命令 `detect_device_tier` 得到的真实设备分档。
 * 移动端经 JNI 读 ActivityManager RAM（见 src-tauri/src/ondevice/mod.rs）；桌面恒为 T2。
 */
export type DetectedTier = 'T0' | 'T1' | 'T2'

export interface DeviceTierResult {
  tier: DetectedTier
  llmAllowed: boolean
  note: string
  /** 由 tier 反推的 RAM 估算（GB），用于驱动 {@link recommendOnDevice} */
  ramGB: number
}

// T0 设备内存过低（<6GB / ≤2 核），T1 中端（<12GB / ≤4 核），T2 高端。
const TIER_TO_RAM: Record<DetectedTier, number> = { T0: 4, T1: 8, T2: 12 }

/**
 * 调用 Rust 命令 `detect_device_tier` 拿真实设备分档。
 * 非 Tauri 环境 / 调用失败时回退到 T2（12GB）估算，**不抛错**，保证设置页始终可用。
 * @param saver 是否省电模式（省电时 T2 降为 T1）
 */
export async function detectDeviceTier(saver = false): Promise<DeviceTierResult> {
  try {
    const res = await invoke<{ tier: string; llm_allowed: boolean; note: string }>(
      'detect_device_tier',
      { saver },
    )
    const tier = (res.tier === 'T0' || res.tier === 'T1' || res.tier === 'T2'
      ? res.tier
      : 'T2') as DetectedTier
    return { tier, llmAllowed: res.llm_allowed, note: res.note, ramGB: TIER_TO_RAM[tier] }
  } catch {
    return { tier: 'T2', llmAllowed: true, note: 'fallback: no Tauri context', ramGB: 12 }
  }
}

/**
 * 端侧推荐（基于命令真实分档）。设置页「端侧模型管理」入口调用本函数即可拿到
 * 与设备匹配的推荐量化 / KV 精度 / 上下文上限，无需前端自行估算 RAM。
 */
export async function recommendOnDeviceDetected(
  saver = false,
  vision = true,
): Promise<OnDeviceRecommendation> {
  const d = await detectDeviceTier(saver)
  return recommendOnDevice(d.ramGB, vision)
}

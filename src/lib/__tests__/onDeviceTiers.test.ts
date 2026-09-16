import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'

// 自动 mock @tauri-apps/api/core，使 invoke 成为可控 mock
vi.mock('@tauri-apps/api/core')

import {
  detectDeviceTier,
  recommendOnDeviceDetected,
  getOnDeviceTier,
  recommendOnDevice,
} from '@/lib/ai/onDeviceTiers'

beforeEach(() => {
  vi.mocked(invoke).mockReset()
})

describe('detectDeviceTier (Rust 命令桥接)', () => {
  it('把 T1 命令结果映射为 8GB 且允许 LLM', async () => {
    vi.mocked(invoke).mockResolvedValue({
      tier: 'T1',
      llm_allowed: true,
      note: 'mobile: 8.0GB/4cores',
    })
    const r = await detectDeviceTier()
    expect(r.tier).toBe('T1')
    expect(r.ramGB).toBe(8)
    expect(r.llmAllowed).toBe(true)
  })

  it('invoke 失败时回退到 T2/12GB（不抛错）', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('not in tauri runtime'))
    const r = await detectDeviceTier()
    expect(r.tier).toBe('T2')
    expect(r.ramGB).toBe(12)
  })

  it('未知 tier 字符串归一到 T2', async () => {
    vi.mocked(invoke).mockResolvedValue({ tier: 'ZZ', llm_allowed: false, note: 'x' })
    const r = await detectDeviceTier()
    expect(r.tier).toBe('T2')
    expect(r.llmAllowed).toBe(false)
  })
})

describe('recommendOnDeviceDetected', () => {
  it('T1 设备去视觉/降上下文推荐', async () => {
    vi.mocked(invoke).mockResolvedValue({ tier: 'T1', llm_allowed: true, note: 'm' })
    const r = await recommendOnDeviceDetected(false, true)
    expect(r.recommended).toBe(true)
    expect(r.maxContext).toBeLessThan(131072)
  })
})

describe('静态分档表（回归）', () => {
  it('6GB 档 2B 不可行', () => {
    expect(getOnDeviceTier(6).feasible2B_Q4).toBe(false)
  })
  it('12GB 档启用 128K + 视觉', () => {
    const r = recommendOnDevice(12, true)
    expect(r.recommended).toBe(true)
    expect(r.maxContext).toBe(131072)
  })
})

import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getVisualPerceptionManager, resetVisualPerceptionManager } from '@/lib/memory/visualPerception'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const mockInvoke = vi.mocked(invoke)

describe('VisualPerceptionManager.triggerAnalysis (A-1 接线依赖验证)', () => {
  beforeEach(() => {
    resetVisualPerceptionManager()
    mockInvoke.mockReset()
  })

  it('take_screenshot 未实现时优雅返回 null（不抛错、不崩溃）', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_active_window') return { title: 'VSCode', process_name: 'Code' }
      if (cmd === 'take_screenshot') throw new Error('command take_screenshot not found')
      return null
    })
    const mgr = getVisualPerceptionManager()
    const result = await mgr.triggerAnalysis()
    expect(result).toBeNull()
  })

  it('提供自定义截屏源且无 LLM 时，产出基于活动窗口的推断分析', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_active_window') return { title: 'Figma', process_name: 'Figma' }
      return null
    })
    const mgr = getVisualPerceptionManager({
      onCaptureScreen: async () => 'data:image/png;base64,iVBORw0KGgo=',
    })
    const result = await mgr.triggerAnalysis()
    expect(result).not.toBeNull()
    expect(result?.userActivity ?? '').toContain('Figma')
    expect(result?.inferredWorkState).toBe('unknown')
  })

  it('P0-3：同一窗口的近似重复帧只调用一次 LLM 分析', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_active_window') return { title: 'VSCode', process_name: 'Code' }
      return null
    })
    const onLLMAnalyze = vi.fn(async () => ({
      userActivity: '在写代码',
      inferredWorkState: 'coding',
      relevantTopics: ['TypeScript'],
    }))
    const hashes = ['0000000000000000', '0000000000000000', 'ffffffffffffffff']
    const frameHashFn = vi.fn(async () => hashes.shift() ?? 'ffffffffffffffff')

    const mgr = getVisualPerceptionManager(
      {
        onCaptureScreen: async () => 'data:image/png;base64,iVBORw0KGgo=',
        onLLMAnalyze,
      },
      { frameHashFn },
    )

    const first = await mgr.triggerAnalysis()
    const second = await mgr.triggerAnalysis()
    expect(first?.userActivity).toBe('在写代码')
    expect(second?.userActivity).toBe('在写代码')
    expect(onLLMAnalyze).toHaveBeenCalledTimes(1)
    expect(mgr.getSkippedDuplicateCount()).toBe(1)

    await mgr.triggerAnalysis()
    expect(onLLMAnalyze).toHaveBeenCalledTimes(2)
  })
})

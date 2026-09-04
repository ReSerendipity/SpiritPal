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
})

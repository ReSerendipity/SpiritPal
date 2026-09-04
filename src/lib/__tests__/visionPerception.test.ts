/**
 * @file visionPerception.test.ts
 * @description VisionPerceptionManager 单测（A-1 接线配套）
 *
 * 契约：
 *  1. petLookAround 全链路：截屏成功 + 分析成功 → 回调触发、返回结果
 *  2. Vision LLM 命令（analyze_screen_content）不存在/失败 → 降级 fallback：
 *     a. get_active_window 可用 → 描述含窗口标题
 *     b. 窗口信息也不可用 → 返回通用文案（不抛错）
 *  3. 截屏失败 → onError 回调 + 返回 null（不抛未捕获异常）
 */

import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getKeyframeMemory } from '@/lib/memory/keyframeMemory'
import { getVisionPerceptionManager, resetVisionPerceptionManager } from '@/lib/memory/visionPerception'

const mockInvoke = vi.mocked(invoke)

vi.mock('@/lib/ai/promptRegistry', () => ({
  getPrompt: vi.fn(() => '你是桌面宠物的视觉分析系统。'),
}))

// keyframeMemory 走真实实现可能报错，mock 掉 addFrame 相关的即可
vi.mock('@/lib/memory/keyframeMemory', () => ({
  getKeyframeMemory: vi.fn(() => ({
    addFrame: vi.fn(),
  })),
  KeyframeLevel: { Screen: 'screen' },
}))

/** 构造一个最小合法截图 */
function makeScreenshot() {
  return {
    imageData: 'aW1hZ2U=', // "image"
    width: 100,
    height: 50,
    timestamp: Date.now(),
    region: { x: 0, y: 0, width: 100, height: 50 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetVisionPerceptionManager()
})

describe('VisionPerceptionManager', () => {
  it('petLookAround 截屏成功且分析成功 → 回调触发并返回结果', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'take_screenshot') {
        return { image_data: 'aW1hZ2U=', width: 100, height: 50 }
      }
      if (cmd === 'analyze_screen_content') {
        return { description: '主人正在写代码', isCoding: true, confidence: 0.9 }
      }
      throw new Error(`unexpected command: ${cmd}`)
    })

    const onScreenshot = vi.fn()
    const onAnalysisComplete = vi.fn()
    const mgr = getVisionPerceptionManager()

    const result = await mgr.petLookAround({ onScreenshot, onAnalysisComplete })

    expect(result?.description).toBe('主人正在写代码')
    expect(result?.isCoding).toBe(true)
    expect(onScreenshot).toHaveBeenCalledOnce()
    expect(onAnalysisComplete).toHaveBeenCalledOnce()
  })

  it('A-1：Vision LLM 命令失败 → 降级描述包含活动窗口标题', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'take_screenshot') {
        return { image_data: 'aW1hZ2U=', width: 100, height: 50 }
      }
      if (cmd === 'analyze_screen_content') {
        throw new Error('Command analyze_screen_content not found')
      }
      if (cmd === 'get_active_window') {
        return { title: 'Visual Studio Code', processName: 'Code.exe' }
      }
      throw new Error(`unexpected command: ${cmd}`)
    })

    const mgr = getVisionPerceptionManager()
    const result = await mgr.petLookAround()

    expect(result).not.toBeNull()
    expect(result?.description).toContain('Visual Studio Code')
    expect(result?.windowTitle).toBe('Visual Studio Code')
    // 降级置信度低但接口完整
    expect(result?.confidence).toBeLessThan(0.5)
  })

  it('A-1：窗口信息也不可用 → 通用降级文案且不抛错', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'take_screenshot') {
        return { image_data: 'aW1hZ2U=', width: 100, height: 50 }
      }
      throw new Error('Command not found')
    })

    const mgr = getVisionPerceptionManager()
    const result = await mgr.analyzeScreen(makeScreenshot())

    expect(result.description).toBe('屏幕中有内容，但无法详细分析')
  })

  it('截屏失败 → onError 回调且返回 null（不抛未捕获异常）', async () => {
    mockInvoke.mockRejectedValue(new Error('Screenshot timeout'))

    const onError = vi.fn()
    const mgr = getVisionPerceptionManager()

    const result = await mgr.petLookAround({ onError })

    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledOnce()
    expect(mockInvoke).toHaveBeenCalledWith(
      'take_screenshot',
      expect.objectContaining({ region: expect.anything() }),
    )
  })
})

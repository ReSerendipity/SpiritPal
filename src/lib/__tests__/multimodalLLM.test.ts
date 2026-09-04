/**
 * @file multimodalLLM.test.ts
 * @description 多模态 LLM 能力单测 — 图片处理 / Vision LLM 客户端 / 视觉感知管理器
 *
 * 测什么：
 * - ImageProcessor: readImageAsBase64（>5MB 抛错）、getImageStats、buildDataUri、guessMimeType
 * - VisionLLMClient: analyzeImage / chatWithImage / batchAnalyzeImages
 *   （callVisionAPI 内部有固定 1000ms setTimeout 且为 private 无法 mock，
 *    使用真实延迟等待——用例数少、总耗时 <5s，可接受）
 * - VisualPerceptionManager: init / setEnabled / setPrivacyMode / analyzeScreenshot
 *   （未启用抛错 / 隐私本地 / 非隐私走 visionClient）/ petLookAtScreen / isAvailable
 *
 * fs/promises 全量 mock（含 default 导出以满足 node 内建模块 CJS 互操作）；
 * node:path 的 join/extname 真实可用无需 mock。
 *
 * 已知坑：动态 import('fs/promises') 在 fake timers + jsdom 下挂起，故本文件不用 fake timers。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============ Mock fs/promises ============
vi.mock('node:fs/promises', () => {
  const readFile = vi.fn(async () => Buffer.from('aGVsbG8='))
  const stat = vi.fn(async () => ({ size: 1024 }))
  return { readFile, stat, default: { readFile, stat } }
})

import { readFile, stat } from 'node:fs/promises'
import {
  ImageProcessor,
  VisionLLMClient,
  VisualPerceptionManager,
  getVisualPerceptionManager,
} from '@/lib/ai/multimodalLLM'

const mockReadFile = vi.mocked(readFile)
const mockStat = vi.mocked(stat)

/** stat mock 需伪装完整 Stats（业务仅读取 .size，其余字段不参与断言） */
type StatsLike = Awaited<ReturnType<typeof stat>>

/** 'hello' 的 base64 */
const HELLO_B64 = 'aGVsbG8='

beforeEach(() => {
  vi.clearAllMocks()
  // 虚拟时钟自动推进：让 callVisionAPI 内部的 setTimeout(1000) 无需手动 advance 也能 resolve，
  // 避免 advanceTimersByTimeAsync 与深层 await 链相互等待导致的 5s 真实超时
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 20 })
  mockReadFile.mockResolvedValue(Buffer.from('hello'))
  mockStat.mockResolvedValue({ size: 1024 } as unknown as StatsLike)
})
afterEach(() => {
  vi.restoreAllMocks()
})

// ============ ImageProcessor ============

describe('ImageProcessor', () => {
  const proc = new ImageProcessor()

  it('readImageAsBase64 返回 base64 编码', async () => {
    const b64 = await proc.readImageAsBase64('/tmp/a.png')

    expect(b64).toBe(HELLO_B64)
    expect(mockReadFile).toHaveBeenCalledWith('/tmp/a.png')
  })

  it('readImageAsBase64 文件超过 5MB 抛错', async () => {
    mockStat.mockResolvedValue({ size: 6 * 1024 * 1024 } as unknown as StatsLike)

    await expect(proc.readImageAsBase64('/tmp/big.png')).rejects.toThrow('图片过大')
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('getImageStats 返回 size 与标准化 format', async () => {
    mockStat.mockResolvedValue({ size: 2048 } as unknown as StatsLike)

    const stats = await proc.getImageStats('/tmp/photo.jpeg')
    expect(stats.size).toBe(2048)
    expect(stats.format).toBe('jpeg')
  })

  it('getImageStats 处理 jpg 扩展名', async () => {
    const stats = await proc.getImageStats('/tmp/photo.jpg')
    expect(stats.format).toBe('jpeg')
  })

  it('getImageStats 未知扩展名原样返回', async () => {
    const stats = await proc.getImageStats('/tmp/file.xyz')
    expect(stats.format).toBe('xyz')
  })

  it('buildDataUri 拼接 data URI', () => {
    expect(proc.buildDataUri('abc', 'image/png')).toBe('data:image/png;base64,abc')
  })

  it('guessMimeType 覆盖全部格式', () => {
    expect(proc.guessMimeType('jpeg')).toBe('image/jpeg')
    expect(proc.guessMimeType('png')).toBe('image/png')
    expect(proc.guessMimeType('webp')).toBe('image/webp')
    expect(proc.guessMimeType('gif')).toBe('image/gif')
  })
})

// ============ VisionLLMClient ============

describe('VisionLLMClient', () => {
  const config = { endpoint: 'https://api.example.com', apiKey: 'sk-test', model: 'gpt-4v' }
  let client: VisionLLMClient

  beforeEach(() => {
    client = new VisionLLMClient(config)
  })

  it('analyzeImage 返回解析后的分析结果（走启发式降级）', async () => {
    const result = await client.analyzeImage('/tmp/a.png')

    expect(result.description).toContain('我收到了一张图片')
    expect(result.objects).toEqual([])
    expect(result.sceneCategory).toBe('unknown')
    expect(result.description.length).toBeLessThanOrEqual(200)
  })

  it('analyzeImage 文件超限时抛出（内部 console.error）', async () => {
    mockStat.mockResolvedValue({ size: 10 * 1024 * 1024 } as unknown as StatsLike)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(client.analyzeImage('/tmp/big.png')).rejects.toThrow('图片过大')
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Image analysis failed'),
      expect.any(Error),
    )
    errSpy.mockRestore()
  })

  it('chatWithImage 返回启发式回复', async () => {
    const res = await client.chatWithImage('/tmp/a.png', '这是什么？')

    expect(res).toContain('我收到了一张图片')
  })

  it('batchAnalyzeImages 全部成功时逐张分析', async () => {
    const results = await client.batchAnalyzeImages(['/a.png', '/b.png'])

    expect(results).toHaveLength(2)
    expect(results[0].description).toContain('我收到了一张图片')
    expect(results[1].description).toContain('我收到了一张图片')
  })

  it('batchAnalyzeImages 单张失败降级为 分析失败，不影响后续', async () => {
    mockStat
      .mockResolvedValueOnce({ size: 10 * 1024 * 1024 }) // 第一张超限失败
      .mockResolvedValueOnce({ size: 100 }) // 第二张正常
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const results = await client.batchAnalyzeImages(['/a.png', '/b.png'])

    expect(results).toHaveLength(2)
    expect(results[0].description).toBe('分析失败')
    expect(results[0].objects).toEqual([])
    expect(results[1].description).toContain('我收到了一张图片')
    errSpy.mockRestore()
  })
})

// ============ VisualPerceptionManager ============

describe('VisualPerceptionManager', () => {
  let mgr: VisualPerceptionManager

  beforeEach(() => {
    mgr = new VisualPerceptionManager()
  })

  it('初始 isAvailable 为 false（未启用）', () => {
    expect(mgr.isAvailable()).toBe(false)
  })

  it('init 后 isAvailable 为 true', () => {
    mgr.init({ endpoint: 'x', apiKey: 'k', model: 'm' })
    expect(mgr.isAvailable()).toBe(true)
  })

  it('setEnabled(false) 后不可用', () => {
    mgr.init({ endpoint: 'x', apiKey: 'k', model: 'm' })
    mgr.setEnabled(false)
    expect(mgr.isAvailable()).toBe(false)
  })

  it('未启用时 analyzeScreenshot 抛错', async () => {
    await expect(mgr.analyzeScreenshot()).rejects.toThrow('Visual perception not enabled')
  })

  it('隐私模式 analyzeScreenshot 走本地分析', async () => {
    mgr.init({ endpoint: 'x', apiKey: 'k', model: 'm' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // 默认 privacyMode = true
    const result = await mgr.analyzeScreenshot()

    expect(result.description).toContain('隐私模式已启用')
    expect(result.sceneCategory).toBe('screenshot')
    expect(result.objects).toEqual([])
    expect(mockReadFile).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('非隐私模式 analyzeScreenshot 走 visionClient（远程分析）', async () => {
    mgr.init({ endpoint: 'x', apiKey: 'k', model: 'm' })
    mgr.setPrivacyMode(false)

    const result = await mgr.analyzeScreenshot()

    expect(result.description).toContain('我收到了一张图片')
    expect(mockReadFile).toHaveBeenCalled()
  })

  it('setPrivacyMode 切换并记录日志', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    mgr.setPrivacyMode(true)
    mgr.setPrivacyMode(false)

    expect(logSpy).toHaveBeenCalledTimes(2)
    logSpy.mockRestore()
  })

  describe('petLookAtScreen', () => {
    it('成功路径返回宠物回应（含 description 与 objects）', async () => {
      mgr.init({ endpoint: 'x', apiKey: 'k', model: 'm' })
      const spy = vi.spyOn(mgr, 'analyzeScreenshot').mockResolvedValue({
        description: '桌面上有一只猫在敲键盘',
        objects: [
          { name: '猫', confidence: 0.9 },
          { name: '键盘', confidence: 0.8 },
        ],
        sceneCategory: 'screenshot',
      })

      const res = await mgr.petLookAtScreen()

      expect(res).toContain('桌面上有一只猫在敲键盘')
      expect(res).toContain('我看到有 猫, 键盘')
      spy.mockRestore()
    })

    it('无 description 且无 objects 时返回默认文案', async () => {
      mgr.init({ endpoint: 'x', apiKey: 'k', model: 'm' })
      const spy = vi.spyOn(mgr, 'analyzeScreenshot').mockResolvedValue({
        description: '',
        objects: [],
      })

      const res = await mgr.petLookAtScreen()
      expect(res).toBe('我在看着呢！')
      spy.mockRestore()
    })

    it('失败路径返回降级文案', async () => {
      // 未 init → analyzeScreenshot 抛错 → 降级文案
      const res = await mgr.petLookAtScreen()
      expect(res).toBe('抱歉，我现在还看不到屏幕内容呢...')
    })
  })
})

// ============ 单例 ============

describe('getVisualPerceptionManager 单例', () => {
  it('多次获取返回同一实例', () => {
    expect(getVisualPerceptionManager()).toBe(getVisualPerceptionManager())
  })
})

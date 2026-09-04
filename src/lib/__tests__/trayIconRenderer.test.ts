/**
 * @file trayIconRenderer.test.ts
 * @description 托盘图标渲染器单元测试 — 图集切片 + A-6 帧缓存命中
 *
 * 重点验证：同一 (角色, 动画行, 帧号) 第二次渲染应命中帧缓存，
 * 不再重复执行 drawImage + toDataURL（后者是同步 PNG 编码，开销最高）。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { disposeFrameCaches } from '@/lib/render/frameCache'
import { renderPetTrayIcon } from '@/lib/render/trayIconRenderer'

// 固定角色数据：8 列 × 4 行的 128px 图集
vi.mock('@/lib/data/characters', () => ({
  getCharacter: (id: string) => ({
    id,
    name: '测试宠物',
    spriteAsset: `/sprites/${id}.png`,
    spriteType: 'sprite',
    atlasLayout: { cellW: 128, cellH: 128, cols: 8, rows: 4 },
  }),
}))

const drawImageSpy = vi.fn()
const toDataURLSpy = vi.fn(() => 'data:image/png;base64,TESTBASE64')

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () =>
      ({
        drawImage: drawImageSpy,
        imageSmoothingEnabled: true,
      }) as unknown as CanvasRenderingContext2D,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toDataURL = toDataURLSpy

  // jsdom 不会真正加载图片，用桩 Image 立即触发 onload
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0)
      }
    },
  )
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

beforeEach(() => {
  drawImageSpy.mockClear()
  toDataURLSpy.mockClear()
  disposeFrameCaches()
})

describe('renderPetTrayIcon', () => {
  it('图集模式下返回去掉 data: 前缀的 base64', async () => {
    const result = await renderPetTrayIcon('doro', 'idle', 0)
    expect(result).toBe('TESTBASE64')
    expect(drawImageSpy).toHaveBeenCalledTimes(1)
  })

  it('同一 (角色,状态,帧号) 第二次渲染命中帧缓存（A-6）', async () => {
    const first = await renderPetTrayIcon('doro', 'walk', 2)
    expect(first).toBe('TESTBASE64')
    expect(toDataURLSpy).toHaveBeenCalledTimes(1)

    const second = await renderPetTrayIcon('doro', 'walk', 2)
    expect(second).toBe('TESTBASE64')
    // 命中缓存：不再重复绘制与编码
    expect(toDataURLSpy).toHaveBeenCalledTimes(1)
    expect(drawImageSpy).toHaveBeenCalledTimes(1)
  })

  it('帧号不同 → 未命中，重新渲染', async () => {
    await renderPetTrayIcon('doro', 'idle', 0)
    await renderPetTrayIcon('doro', 'idle', 1)

    expect(toDataURLSpy).toHaveBeenCalledTimes(2)
    expect(drawImageSpy).toHaveBeenCalledTimes(2)
  })

  it('角色不同 → 未命中（缓存键含角色 ID）', async () => {
    await renderPetTrayIcon('doro', 'idle', 0)
    await renderPetTrayIcon('mimi', 'idle', 0)

    expect(toDataURLSpy).toHaveBeenCalledTimes(2)
  })

  it('帧号按列数取模，越界帧号回落到有效帧', async () => {
    await renderPetTrayIcon('doro', 'idle', 8) // cols = 8 → 等价于第 0 帧
    await renderPetTrayIcon('doro', 'idle', 0)

    expect(toDataURLSpy).toHaveBeenCalledTimes(1)
  })

  it('渲染失败时返回 null 而不是抛错', async () => {
    toDataURLSpy.mockImplementationOnce(() => {
      throw new Error('canvas encode failed')
    })
    await expect(renderPetTrayIcon('doro', 'idle', 0)).resolves.toBeNull()
  })
})

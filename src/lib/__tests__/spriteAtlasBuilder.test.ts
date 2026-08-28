/**
 * @file spriteAtlasBuilder.test.ts
 * @description spriteAtlasBuilder 单元测试 — 矩形打包 / 元数据 / 绘制
 *
 * A-6：该模块原为孤岛且静态 import 了 node:path / node:fs，
 * 无法进入 webview bundle。改造为纯布局计算 + 调用方绘制后补此测试。
 */

import { describe, it, expect } from 'vitest'
import { createSpriteAtlas, getSpriteAtlasLoader } from '../spriteAtlasBuilder'

/** 构造一个只记录 drawImage 调用的假画布上下文 */
function createFakeCanvas() {
  const calls: Array<{ x: number; y: number; w: number; h: number; src: string }> = []
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (
        img: { src: string },
        x: number,
        y: number,
        w: number,
        h: number,
      ) => {
        calls.push({ x, y, w, h, src: img.src })
      },
    }),
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, calls }
}

describe('SpriteAtlasBuilder', () => {
  it('没有切片时 build 抛错', async () => {
    const builder = createSpriteAtlas({ outputName: 'atlas', format: 'png' })
    await expect(builder.build()).rejects.toThrow('没有要打包的图片')
  })

  it('打包后的每个切片都有坐标与 UV，且不越出图集边界', async () => {
    const builder = createSpriteAtlas({ outputName: 'atlas', format: 'png', padding: 2 })
    for (let i = 0; i < 12; i++) builder.addItem(`f${i}`, `frame:${i}`, 64, 64)

    const atlas = await builder.build()
    expect(atlas.sprites).toHaveLength(12)
    expect(atlas.totalWidth).toBeGreaterThan(0)
    expect(atlas.totalHeight).toBeGreaterThan(0)
    expect(atlas.efficiency).toBeGreaterThan(0)

    for (const s of atlas.sprites) {
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.y).toBeGreaterThanOrEqual(0)
      expect((s.x ?? 0) + (s.width ?? 0)).toBeLessThanOrEqual(atlas.totalWidth)
      expect((s.y ?? 0) + (s.height ?? 0)).toBeLessThanOrEqual(atlas.totalHeight)
      expect(s.uv?.u0).toBeGreaterThanOrEqual(0)
      expect(s.uv?.v0).toBeGreaterThanOrEqual(0)
      expect(s.uv?.u1).toBeLessThanOrEqual(1)
      expect(s.uv?.v1).toBeLessThanOrEqual(1)
    }
  })

  it('切片之间互不重叠（含 padding 间隙）', async () => {
    const builder = createSpriteAtlas({ outputName: 'atlas', format: 'png', padding: 2 })
    for (let i = 0; i < 9; i++) builder.addItem(`f${i}`, `frame:${i}`, 50, 50)

    const atlas = await builder.build()
    for (let i = 0; i < atlas.sprites.length; i++) {
      for (let j = i + 1; j < atlas.sprites.length; j++) {
        const a = atlas.sprites[i]!
        const b = atlas.sprites[j]!
        const overlapX = (a.x! < b.x! + b.width!) && (b.x! < a.x! + a.width!)
        const overlapY = (a.y! < b.y! + b.height!) && (b.y! < a.y! + a.height!)
        expect(overlapX && overlapY).toBe(false)
      }
    }
  })

  it('生成可序列化的图集元数据', async () => {
    const builder = createSpriteAtlas({ outputName: 'pet', format: 'png' })
    builder.addItem('idle_0', 'frame:0', 128, 128)

    const atlas = await builder.build()
    const json = builder.serializeMetadata(atlas)
    const meta = JSON.parse(json)

    expect(meta.image).toBe('pet.png')
    expect(meta.size.width).toBe(atlas.totalWidth)
    expect(meta.sprites).toHaveLength(1)
    expect(meta.sprites[0].name).toBe('idle_0')
    expect(meta.sprites[0].frame).toEqual({
      x: atlas.sprites[0]!.x,
      y: atlas.sprites[0]!.y,
      w: 128,
      h: 128,
    })
  })

  it('drawTo 按打包布局绘制每个切片', async () => {
    const builder = createSpriteAtlas({ outputName: 'atlas', format: 'png', padding: 2 })
    for (let i = 0; i < 4; i++) builder.addItem(`f${i}`, `frame:${i}`, 32, 32)

    const atlas = await builder.build()
    const { canvas, calls } = createFakeCanvas()

    const drawn = await builder.drawTo(
      canvas,
      (sourcePath) => ({ src: sourcePath }) as unknown as CanvasImageSource,
    )

    expect(drawn).toBe(4)
    expect(calls).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      const sprite = atlas.sprites.find((s) => s.id === `f${i}`)!
      expect(calls[i]).toMatchObject({ x: sprite.x, y: sprite.y, w: 32, h: 32 })
    }
  })

  it('drawTo 跳过无法解析的切片而不是抛错', async () => {
    const builder = createSpriteAtlas({ outputName: 'atlas', format: 'png' })
    builder.addItem('ok', 'frame:0', 16, 16)
    builder.addItem('missing', 'frame:99', 16, 16)

    await builder.build()
    const { canvas, calls } = createFakeCanvas()

    const drawn = await builder.drawTo(canvas, (src) =>
      src === 'frame:0' ? ({ src } as unknown as CanvasImageSource) : null,
    )

    expect(drawn).toBe(1)
    expect(calls).toHaveLength(1)
  })
})

describe('SpriteAtlasLoader', () => {
  it('按名称查找切片的 UV', async () => {
    const builder = createSpriteAtlas({ outputName: 'atlas', format: 'png' })
    builder.addItem('heart', 'frame:0', 16, 16)
    const atlas = await builder.build()

    const loader = getSpriteAtlasLoader()
    loader.load('atlas', atlas)

    expect(loader.list()).toContain('atlas')
    const uv = loader.getSpriteUV('atlas', 'heart')
    expect(uv).toBeDefined()
    expect(uv!.u1).toBeGreaterThan(uv!.u0)

    loader.unload('atlas')
    expect(loader.getSpriteUV('atlas', 'heart')).toBeUndefined()
  })

  it('导出的 atlas.json 可被回读（PNG + JSON 运行时可加载）', async () => {
    const builder = createSpriteAtlas({ outputName: 'pet', format: 'png', padding: 2 })
    for (let i = 0; i < 5; i++) builder.addItem(`f${i}`, `frame:${i}`, 32, 32)
    const atlas = await builder.build()

    // 模拟：落盘 → 再次读取
    const json = builder.serializeMetadata(atlas)
    const meta = JSON.parse(json)

    const loader = getSpriteAtlasLoader()
    const restored = loader.loadFromMetadata('pet', meta)

    expect(restored.totalWidth).toBe(atlas.totalWidth)
    expect(restored.sprites).toHaveLength(5)
    expect(loader.getSpriteUV('pet', 'f0')).toEqual(atlas.sprites[0]!.uv)
  })
})

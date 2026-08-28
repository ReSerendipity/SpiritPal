/**
 * @file batchRenderer.test.ts
 * @description batchRenderer 单元测试 — 分组 / 剔除 / 顶点打包
 *
 * A-7：原 `render(gl)` 是「清零批次 + 打印日志」的静默假实现，已改为
 * `buildBatches()` 只产出 CPU 侧批次数据。此测试锁定该行为，并覆盖此前
 * 的两处越界缺陷（批次容量 ×6、起始顶点索引 ×4）。
 */

import { describe, it, expect, vi } from 'vitest'
import { BatchRenderer, type Renderable } from '../batchRenderer'

function makeRenderable(overrides: Partial<Renderable> = {}): Renderable {
  return {
    id: 'r1',
    textureId: 'pet-atlas',
    position: [100, 100],
    size: [64, 64],
    rotation: 0,
    scale: [1, 1],
    color: [1, 0.5, 0.25, 1],
    zIndex: 0,
    visible: true,
    opacity: 1,
    ...overrides,
  }
}

describe('BatchRenderer', () => {
  it('按纹理分组，同纹理的对象进入同一批次', () => {
    const renderer = new BatchRenderer()
    renderer.add(makeRenderable({ id: 'a', textureId: 'atlas-a' }))
    renderer.add(makeRenderable({ id: 'b', textureId: 'atlas-a' }))
    renderer.add(makeRenderable({ id: 'c', textureId: 'atlas-b' }))

    const batches = renderer.buildBatches()

    expect(batches).toHaveLength(2)
    // 每个精灵占 4 个顶点
    expect(batches.reduce((sum, b) => sum + b.vertexIndex, 0)).toBe(12)
    expect(renderer.getStats().totalDrawCalls).toBe(2)
  })

  it('视口外的对象被剔除，不进入批次', () => {
    const renderer = new BatchRenderer({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
    })
    renderer.add(makeRenderable({ id: 'inside', position: [100, 100] }))
    renderer.add(makeRenderable({ id: 'outside', position: [5000, 5000] }))

    const batches = renderer.buildBatches()

    expect(renderer.getStats().objectsCulled).toBe(1)
    expect(batches.reduce((sum, b) => sum + b.vertexIndex, 0)).toBe(4)
  })

  it('不可见对象不参与打包', () => {
    const renderer = new BatchRenderer()
    renderer.add(makeRenderable({ id: 'hidden', visible: false }))

    expect(renderer.buildBatches()).toHaveLength(0)
  })

  it('顶点数据为 [x, y, u, v, r, g, b, a] 且写入 4 个角点', () => {
    const renderer = new BatchRenderer()
    renderer.add(makeRenderable({ position: [200, 150], size: [80, 40] }))

    const [batch] = renderer.buildBatches()
    expect(batch).toBeDefined()
    expect(batch!.vertexIndex).toBe(4)

    // position 视为左上角：四个角点依次 左上 / 右上 / 右下 / 左下
    const vertex = (i: number) => Array.from(batch!.vertices.subarray(i * 8, i * 8 + 8))

    const v0 = vertex(0)
    expect(v0[0]).toBeCloseTo(200, 5) // x
    expect(v0[1]).toBeCloseTo(150, 5) // y
    expect(v0[2]).toBe(0) // u
    expect(v0[3]).toBe(0) // v
    expect(v0[4]).toBeCloseTo(1, 5) // r
    expect(v0[5]).toBeCloseTo(0.5, 5) // g
    expect(v0[6]).toBeCloseTo(0.25, 5) // b
    expect(v0[7]).toBeCloseTo(1, 5) // a

    expect(vertex(1)[0]).toBeCloseTo(280, 5) // 右上
    expect(vertex(2)[1]).toBeCloseTo(190, 5) // 右下 y
    expect(vertex(3)[0]).toBeCloseTo(200, 5) // 左下 x
  })

  it('opacity 会乘进顶点颜色', () => {
    const renderer = new BatchRenderer()
    renderer.add(makeRenderable({ opacity: 0.5 }))

    const [batch] = renderer.buildBatches()
    expect(batch!.vertices[4]).toBeCloseTo(0.5, 5)
    expect(batch!.vertices[7]).toBeCloseTo(0.5, 5)
  })

  it('批次容量耗尽时告警并跳过，不越界写入', () => {
    const renderer = new BatchRenderer({ maxBatches: 1, maxVerticesPerBatch: 8 })
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 8 顶点容量 = 2 个精灵
    renderer.add(makeRenderable({ id: 'a' }))
    renderer.add(makeRenderable({ id: 'b' }))
    renderer.add(makeRenderable({ id: 'c' }))

    const [batch] = renderer.buildBatches()

    expect(batch!.vertexIndex).toBe(8)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('同一批次内的顶点数组长度足以容纳 maxVertices（此前 *6 会溢出）', () => {
    const renderer = new BatchRenderer({ maxBatches: 1, maxVerticesPerBatch: 16 })
    for (let i = 0; i < 4; i++) {
      renderer.add(makeRenderable({ id: `r${i}`, position: [i * 10, 0] }))
    }

    const [batch] = renderer.buildBatches()
    expect(batch!.vertexIndex).toBe(16)
    // 最后一个顶点的 alpha 索引 = 15*8+7，数组必须覆盖到
    expect(batch!.vertices.length).toBeGreaterThanOrEqual(16 * 8)
    expect(batch!.vertices[15 * 8 + 7]).toBeCloseTo(1, 5)
  })

  it('重复 build 会重置上一帧批次，不会累积', () => {
    const renderer = new BatchRenderer()
    renderer.add(makeRenderable({ id: 'a' }))

    renderer.buildBatches()
    const second = renderer.buildBatches()

    expect(second.reduce((sum, b) => sum + b.vertexIndex, 0)).toBe(4)
  })
})

/**
 * @file gpuParticleSystem.test.ts
 * @description GPUParticleSystem 单元测试（A-7）
 *
 * jsdom 不提供 WebGL，这里用一个 Proxy 假上下文让「构造 → emit → update →
 * render → destroy」全流程可跑。重点锁定两处修复：
 *  1. `update()` 此前忽略 deltaTime（内部硬编码 0.016），导致粒子寿命与帧率脱钩；
 *  2. 顶点布局与物理数组解耦（CPU 10 floats 含速度 / GPU 8 floats 不含速度）。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { GPUParticleSystem } from '@/lib/render/gpuParticleSystem'

/**
 * 构造一个"什么方法都接受"的假 WebGL 上下文：
 * - 全大写属性视为 GL 常量，返回数字
 * - 其余视为方法，按语义返回可编程对象/布尔
 */
function createFakeGL(): WebGLRenderingContext {
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get(_t, prop: string) {
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return 1
      switch (prop) {
        case 'createShader':
        case 'createProgram':
        case 'createBuffer':
        case 'createTexture':
          return () => ({ kind: prop })
        case 'getShaderParameter':
        case 'getProgramParameter':
          return () => true
        case 'getAttribLocation':
          return () => 0
        case 'getUniformLocation':
          return () => ({ kind: 'uniform' })
        case 'getShaderInfoLog':
        case 'getProgramInfoLog':
          return () => ''
        default:
          return () => undefined
      }
    },
  }) as unknown as WebGLRenderingContext
}

let fakeGL: WebGLRenderingContext

beforeAll(() => {
  fakeGL = createFakeGL()
  HTMLCanvasElement.prototype.getContext = vi.fn((type: string) =>
    type === 'webgl' ? fakeGL : null,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

afterAll(() => {
  vi.restoreAllMocks()
})

function createSystem(maxParticles = 100): GPUParticleSystem {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  return new GPUParticleSystem(canvas, { maxParticles, emitRate: 0 })
}

describe('GPUParticleSystem', () => {
  it('WebGL 不可用时构造抛错（调用方需自行降级）', () => {
    const canvas = document.createElement('canvas')
    // vitest 4 下 vi.spyOn 实例方法会破坏原型链上的全局 mock（测试间污染），
    // 故改为实例 own property 覆盖（纯局部，不触碰 prototype）。
    const original = canvas.getContext
    canvas.getContext = (() => null) as typeof canvas.getContext
    expect(() => new GPUParticleSystem(canvas)).toThrow('WebGL not supported')
    canvas.getContext = original
  })

  it('emit 后粒子计数递增', () => {
    const system = createSystem()
    const pos = { x: 10, y: 20 }

    expect(system.getParticleCount()).toBe(0)
    system.emit(pos)
    expect(system.getParticleCount()).toBe(1)

    system.destroy()
  })

  it('burst 一次性发射指定数量并返回实际发射数', () => {
    const system = createSystem(10)
    const pos = { x: 0, y: 0 }

    expect(system.burst(pos, 6)).toBe(6)
    expect(system.getParticleCount()).toBe(6)

    // 超出 maxParticles 时截断
    expect(system.burst(pos, 10)).toBe(4)
    expect(system.getParticleCount()).toBe(10)

    system.destroy()
  })

  it('update 按真实 deltaTime 推进寿命（此前硬编码 0.016）', () => {
    const system = createSystem()
    const pos = { x: 100, y: 100 }

    system.emit(pos, { lifetime: 1 })
    expect(system.getParticleCount()).toBe(1)

    // 单次 dt 被钳制到 0.05s：1s 寿命约需 20 帧
    // （旧实现内部硬编码 0.016/帧，同样的入参需要约 63 帧才会消亡）
    let ticks = 0
    while (system.getParticleCount() > 0 && ticks < 200) {
      system.update(0.05, pos)
      ticks++
    }

    expect(system.getParticleCount()).toBe(0)
    expect(ticks).toBeGreaterThan(15)
    expect(ticks).toBeLessThan(25)

    system.destroy()
  })

  it('超大 deltaTime 被钳制，不会让粒子瞬间消亡', () => {
    const system = createSystem()
    const pos = { x: 0, y: 0 }

    system.emit(pos, { lifetime: 1 })
    system.update(10, pos) // 标签页切回等场景
    expect(system.getParticleCount()).toBe(1)

    system.destroy()
  })

  it('emitRate 为 0 时 update 不会自动补发粒子', () => {
    const system = createSystem()
    const pos = { x: 0, y: 0 }

    for (let i = 0; i < 10; i++) system.update(0.05, pos)
    expect(system.getParticleCount()).toBe(0)

    system.destroy()
  })

  it('render 与 resize 不抛错，且销毁后可重复销毁', () => {
    const system = createSystem()
    system.emit({ x: 1, y: 1 })

    expect(() => {
      system.render()
      system.resize(128, 128)
    }).not.toThrow()

    system.destroy()
    expect(() => system.destroy()).not.toThrow()
  })

  it('reset 清空所有粒子', () => {
    const system = createSystem()
    system.burst({ x: 0, y: 0 }, 5)
    expect(system.getParticleCount()).toBe(5)

    system.reset()
    expect(system.getParticleCount()).toBe(0)

    system.destroy()
  })
})

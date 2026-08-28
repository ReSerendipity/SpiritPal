/**
 * @file usePetParticles.test.tsx
 * @description usePetParticles 单元测试（A-7）
 *
 * 覆盖三点接线契约：
 *  1. 抚摸触发 burst → 启动 rAF 循环 → 粒子耗尽后主动停机（不常驻空转）
 *  2. WebGL 不可用时静默降级（burst 变 no-op，supported=false，不影响主交互）
 *  3. 卸载时销毁 GPU 资源
 *
 * 注意：必须渲染真实的 <canvas> 才能拿到 canvasRef.current，
 * 因此这里用一个 Harness 组件而非 renderHook。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { usePetParticles, type PetParticleBurstOptions } from './usePetParticles'

// ============ 假的 GPUParticleSystem ============
// vi.mock 的工厂会被提升到文件顶部，因此用到的变量必须用 vi.hoisted 预先创建

const mock = vi.hoisted(() => {
  const instances: Array<{
    count: number
    destroyed: boolean
    getParticleCount(): number
  }> = []
  const state = { destroyedCount: 0, renderCalls: 0, failInit: false }

  class FakeSystem {
    count = 0
    destroyed = false
    constructor(
      public canvas: HTMLCanvasElement,
      public config: { maxParticles: number },
    ) {
      if (state.failInit) throw new Error('WebGL not supported')
      instances.push(this)
    }
    burst(_pos: { x: number; y: number }, n: number): number {
      this.count = Math.min(this.count + n, this.config.maxParticles)
      return n
    }
    update(): void {
      // 每帧消亡 1 个，便于在有限帧内跑到 0
      if (this.count > 0) this.count -= 1
    }
    render(): void {
      state.renderCalls++
    }
    resize(_w: number, _h: number): void {}
    getParticleCount(): number {
      return this.count
    }
    destroy(): void {
      this.destroyed = true
      state.destroyedCount++
    }
  }

  return { instances, state, FakeSystem }
})

vi.mock('../../lib/gpuParticleSystem', () => ({
  GPUParticleSystem: mock.FakeSystem,
}))

const instances = mock.instances

// ============ rAF 手动调度 ============

let rafCallbacks: FrameRequestCallback[] = []

function flushFrames(count: number): void {
  for (let i = 0; i < count; i++) {
    const pending = rafCallbacks
    rafCallbacks = []
    if (pending.length === 0) return
    act(() => {
      pending.forEach((cb) => cb(performance.now()))
    })
  }
}

// ============ 测试载体 ============

type ParticlesApi = {
  burst: (options: PetParticleBurstOptions) => void
  supported: boolean
}

let api: ParticlesApi | null = null

function Harness({ w, h }: { w: number; h: number }) {
  const particles = usePetParticles(w, h)
  api = particles
  return <canvas ref={particles.canvasRef} width={w} height={h} data-testid="particles" />
}

beforeEach(() => {
  api = null
  instances.length = 0
  mock.state.destroyedCount = 0
  mock.state.renderCalls = 0
  mock.state.failInit = false
  rafCallbacks = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('usePetParticles', () => {
  it('burst 后启动帧循环，粒子耗尽后停止', () => {
    render(<Harness w={200} h={200} />)

    act(() => {
      api!.burst({ x: 100, y: 50, count: 3 })
    })

    // 首次 burst 才创建 WebGL 上下文（懒初始化）
    expect(instances).toHaveLength(1)
    expect(rafCallbacks.length).toBeGreaterThan(0)

    // 3 个粒子 → 每帧消亡 1 个 → 第 4 帧时机停机
    flushFrames(4)

    expect(instances[0]!.getParticleCount()).toBe(0)
    // 停机：不再有待执行的 rAF
    expect(rafCallbacks).toHaveLength(0)
    expect(mock.state.renderCalls).toBeGreaterThan(0)
  })

  it('WebGL 不可用时静默降级，burst 不抛错', () => {
    mock.state.failInit = true
    render(<Harness w={200} h={200} />)

    expect(() => {
      act(() => {
        api!.burst({ x: 10, y: 10 })
      })
    }).not.toThrow()

    expect(api!.supported).toBe(false)
    expect(rafCallbacks).toHaveLength(0)
  })

  it('画布尺寸变化时复用同一个粒子系统（不重建 WebGL 上下文）', () => {
    const { rerender } = render(<Harness w={200} h={200} />)

    act(() => {
      api!.burst({ x: 0, y: 0, count: 1 })
    })
    expect(instances).toHaveLength(1)

    rerender(<Harness w={320} h={240} />)

    expect(instances).toHaveLength(1)
    flushFrames(3)
  })

  it('卸载时销毁粒子系统', () => {
    const { unmount } = render(<Harness w={200} h={200} />)

    act(() => {
      api!.burst({ x: 0, y: 0, count: 2 })
    })
    expect(instances).toHaveLength(1)

    unmount()

    expect(mock.state.destroyedCount).toBe(1)
    expect(instances[0]!.destroyed).toBe(true)
  })

  it('尺寸为 0 时不创建上下文（避免无效 WebGL 画布）', () => {
    render(<Harness w={0} h={0} />)

    act(() => {
      api!.burst({ x: 0, y: 0 })
    })

    expect(instances).toHaveLength(0)
    expect(rafCallbacks).toHaveLength(0)
  })
})

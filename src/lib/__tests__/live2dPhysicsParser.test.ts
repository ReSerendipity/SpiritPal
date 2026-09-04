/**
 * @file live2dPhysicsParser.test.ts
 * @description live2dPhysicsParser 单元测试（A-13）
 *
 * 覆盖三处修复/补齐：
 *  1. 摆锤方程符号错误：原式 `(g/L)·sin(θ−gravityAngle)` 在平衡位置没有回复力，
 *     摆锤会被推离零点并稳定在 ±π/2（约 ±90°）附近，表现为"永远歪着"。
 *  2. Cubism 官方 physics3.json 用 `PhysicsSettings`，与本模块内部 `groups`
 *     结构不兼容，直接加载社区角色文件会崩溃 → 新增归一化层。
 *  3. 输出单位：摆锤返回弧度，需乘以 output.scale 才是可用的角度值。
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { Live2DPysicsParser, PendulumSimulator } from '@/lib/render/live2dPhysicsParser'

/** 内部简化格式 */
const SIMPLE_CONFIG = JSON.stringify({
  version: 3,
  groups: [
    {
      id: 'hair',
      type: 'pendulum',
      inputs: [{ id: 'ParamAngleX', type: 'angle', scale: 1, offset: 0 }],
      outputs: [{ id: 'ParamHairFront', scale: 10, offset: 0 }],
      settings: { gravity: { x: 0, y: 9.8 }, drag: 0.5 },
    },
  ],
})

/** Cubism 官方格式（社区角色包里的样子） */
const OFFICIAL_CONFIG = JSON.stringify({
  Version: 3,
  Meta: { Author: 'test' },
  PhysicsSettings: [
    {
      Id: 'HairSetting',
      Input: [
        { Source: { Target: 'Parameter', Id: 'ParamAngleX' }, Weight: 60, Type: 'Angle' },
      ],
      Output: [
        { Destination: { Target: 'Parameter', Id: 'ParamHairSide' }, Scale: 12, Weight: 100 },
      ],
      Vertices: [{ Mobility: 0.6, Delay: 0.2, Acceleration: 1, Radius: 5, Length: 2 }],
      PhysicsDetail: { Gravity: { X: 0, Y: -1 } },
    },
  ],
})

/** 连续跑若干帧，返回最后一帧输出与过程中出现过的最大绝对值 */
function runFrames(
  parser: Live2DPysicsParser,
  frames: number,
  inputValue: number,
): { last: Record<string, number>; maxAbs: number } {
  let last: Record<string, number> = {}
  let maxAbs = 0
  for (let i = 0; i < frames; i++) {
    last = parser.updateParameters({ ParamAngleX: inputValue }, 16)
    for (const v of Object.values(last)) {
      maxAbs = Math.max(maxAbs, Math.abs(v))
    }
  }
  return { last, maxAbs }
}

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('PendulumSimulator 单摆方程', () => {
  it('从偏转位置释放后会衰减回平衡位置（不发散、不残留大偏角）', () => {
    const sim = new PendulumSimulator({ gravity: { x: 0, y: 9.8 }, length: 1, damping: 0.5 })

    // 偏转到 20 度后自由摆动 8 秒
    sim.reset((20 * Math.PI) / 180)
    for (let i = 0; i < 480; i++) sim.simulate(16, { x: 0, y: 0 })

    // 应收敛到 0 附近（旧实现会停到 ±π/2 ≈ 1.57 rad）
    expect(Math.abs(sim.simulate(16, { x: 0, y: 0 }))).toBeLessThan(0.05)
  })

  it('摆动过程始终有界，不会指数发散', () => {
    const sim = new PendulumSimulator({ gravity: { x: 0, y: 9.8 }, length: 1, damping: 0.5 })
    sim.reset(0.2)

    let maxAbs = 0
    for (let i = 0; i < 600; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(sim.simulate(16, { x: 0, y: 0 })))
    }
    // 初始偏角 0.2 rad，有界摆动不会超过它
    expect(maxAbs).toBeLessThanOrEqual(0.21)
  })

  it('外力方向与偏转方向一致（向右推 → 向右偏）', () => {
    const sim = new PendulumSimulator({ gravity: { x: 0, y: 9.8 }, length: 1, damping: 0.5 })
    for (let i = 0; i < 30; i++) sim.simulate(16, { x: 5, y: 0 })
    expect(sim.simulate(16, { x: 5, y: 0 })).toBeGreaterThan(0)
  })
})

describe('Live2DPysicsParser 配置加载', () => {
  it('加载内部简化格式并创建模拟器', async () => {
    const parser = new Live2DPysicsParser()
    await parser.loadConfig(SIMPLE_CONFIG)

    expect(parser.isLoaded()).toBe(true)
    expect(parser.getConfig()!.groups).toHaveLength(1)
  })

  it('加载 Cubism 官方格式（PhysicsSettings）并归一化', async () => {
    const parser = new Live2DPysicsParser()
    await expect(parser.loadConfig(OFFICIAL_CONFIG)).resolves.toBeUndefined()

    const group = parser.getConfig()!.groups[0]!
    expect(group.id).toBe('HairSetting')
    expect(group.outputs[0]!.id).toBe('ParamHairSide')
    // 权重 60% 输入、Scale 12 × Weight 100% 输出
    expect(group.inputs[0]!.scale).toBeCloseTo(0.6, 5)
    expect(group.outputs[0]!.scale).toBeCloseTo(12, 5)
    // 官方 Gravity.Y = -1（y 向上为正）→ 本模块取反为 +1
    expect(group.settings.gravity.y).toBeCloseTo(1, 5)
  })

  it('非法 JSON 时抛错（调用方需降级）', async () => {
    const parser = new Live2DPysicsParser()
    await expect(parser.loadConfig('{ not json')).rejects.toThrow()
  })

  it('未加载配置时 updateParameters 返回空对象', () => {
    const parser = new Live2DPysicsParser()
    expect(parser.updateParameters({ ParamAngleX: 1 }, 16)).toEqual({})
  })
})

describe('Live2DPysicsParser 参数更新', () => {
  it('有输入时产生输出，撤销输入后回落', async () => {
    const parser = new Live2DPysicsParser()
    await parser.loadConfig(SIMPLE_CONFIG)

    const driven = runFrames(parser, 60, 30)
    expect(driven.last['ParamHairFront']).toBeDefined()
    expect(Math.abs(driven.last['ParamHairFront']!)).toBeGreaterThan(0)

    const released = runFrames(parser, 400, 0)
    expect(Math.abs(released.last['ParamHairFront']!)).toBeLessThan(
      Math.abs(driven.last['ParamHairFront']!),
    )
    // 全程有界（旧实现会持续被推离零点）
    expect(driven.maxAbs).toBeLessThan(90)
  })

  it('输出值会写入参数缓存，可用 getParameterValue 读取', async () => {
    const parser = new Live2DPysicsParser()
    await parser.loadConfig(SIMPLE_CONFIG)
    parser.updateParameters({ ParamAngleX: 10 }, 16)

    expect(parser.getParameterValue('ParamHairFront')).toBeDefined()

    parser.reset()
    expect(parser.getParameterValue('ParamHairFront')).toBeUndefined()
  })
})

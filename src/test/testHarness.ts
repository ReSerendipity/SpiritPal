/**
 * @file 语义化测试 Harness 工具
 * @module test/testHarness
 * @description
 * 提供语义化的测试操作和断言封装，简化宠物行为相关单元测试编写。
 * 参考 OpenPets 测试基础设施的 TestHarness 设计。
 *
 * 主要功能：
 * - 时间推进辅助（结合 FakeClock）
 * - 用户交互模拟（喂食、摸头等）
 * - 宠物状态断言（饥饿度、心情范围等）
 * - 事件/动画/气泡消息断言
 * - 心跳和离线衰减批量模拟
 */

import { expect } from 'vitest'
import type { FakeClock } from './fakeClock'
import type { MockContext } from './mockContext'

/**
 * 创建测试 Harness，封装常用测试操作和语义断言
 *
 * @param deps - 依赖项（FakeClock 和 MockContext）
 * @returns 测试 Harness 对象
 *
 * @example
 * ```ts
 * const clock = createFakeClock()
 * const mockCtx = createMockContext()
 * const harness = createTestHarness({ clock, mockCtx })
 *
 * await harness.simulatePat(3)
 * harness.expectMoodRange(80, 100)
 * harness.expectAnimationTriggered('happy')
 * ```
 */
export function createTestHarness(deps: {
  /** 虚拟时钟实例（可选） */
  clock?: FakeClock
  /** 模拟上下文实例（可选） */
  mockCtx?: MockContext
}) {
  const { clock, mockCtx } = deps

  // ============ 时间推进辅助 ============

  /**
   * 推进虚拟时间
   * @param duration - 时间字符串（如 "30s", "5m"）
   * @returns 推进后的虚拟时间戳
   */
  const advanceTime = (duration: string) => {
    clock?.advanceBy(duration)
    return clock?.nowMs() ?? Date.now()
  }

  /**
   * 等待冷却时间结束（推进时间超过冷却期）
   * @param cooldownMs - 冷却时长（毫秒）
   */
  const waitForCooldown = (cooldownMs: number) => {
    clock?.advance(cooldownMs + 1)
  }

  // ============ 宠物交互模拟 ============

  /**
   * 模拟用户交互事件
   * @param type - 交互类型（如 'feed', 'pet_head' 等）
   */
  const simulateInteraction = async (type: string) => {
    mockCtx?.eventImpl.emit('pet-interaction', { type, timestamp: Date.now() })
    clock?.advance(1000)
  }

  /** 模拟喂食操作 */
  const simulateFeed = async () => simulateInteraction('feed')

  /**
   * 模拟摸头操作
   * @param count - 摸头次数，默认 1 次
   */
  const simulatePat = async (count = 1) => {
    for (let i = 0; i < count; i++) {
      await simulateInteraction('pet_head')
      clock?.advance(500)
    }
  }

  // ============ 状态断言 ============

  /**
   * 断言宠物当前状态
   * @param expected - 期望的状态值
   */
  const expectPetState = (expected: string) => {
    if (mockCtx) {
      expect(mockCtx.petState.petState).toBe(expected)
    }
  }

  /**
   * 断言饥饿度在指定范围内
   * @param min - 最小值（包含）
   * @param max - 最大值（包含）
   */
  const expectHungerRange = (min: number, max: number) => {
    if (mockCtx) {
      expect(mockCtx.petState.stats.hunger).toBeGreaterThanOrEqual(min)
      expect(mockCtx.petState.stats.hunger).toBeLessThanOrEqual(max)
    }
  }

  /**
   * 断言心情在指定范围内
   * @param min - 最小值（包含）
   * @param max - 最大值（包含）
   */
  const expectMoodRange = (min: number, max: number) => {
    if (mockCtx) {
      expect(mockCtx.petState.stats.mood).toBeGreaterThanOrEqual(min)
      expect(mockCtx.petState.stats.mood).toBeLessThanOrEqual(max)
    }
  }

  // ============ 事件断言 ============

  /**
   * 断言特定事件被触发了指定次数
   * @param event - 事件名称
   * @param times - 期望触发次数
   */
  const expectEventCount = (event: string, times: number) => {
    if (mockCtx) {
      const count = mockCtx.events.filter(e => e.event === event).length
      expect(count).toBe(times)
    }
  }

  /** 断言没有错误事件被触发 */
  const expectNoErrors = () => {
    if (mockCtx) {
      const errors = mockCtx.events.filter(e => e.event === 'error')
      expect(errors).toHaveLength(0)
    }
  }

  // ============ 冷却断言 ============

  /**
   * 推进时间直到冷却过期（使操作可以再次触发）
   * @param cooldownMs - 冷却时长（毫秒）
   */
  const expectCooldownExpired = (cooldownMs: number) => {
    clock?.advance(cooldownMs + 1)
  }

  // ============ 气泡断言 ============

  /**
   * 断言气泡消息包含指定文本
   * @param text - 期望包含的文本
   */
  const expectBubbleContains = (text: string) => {
    if (mockCtx) {
      const sayEvents = mockCtx.events.filter(e => e.event === 'spiritpal-mcp-say')
      const found = sayEvents.some(e =>
        typeof e.payload === 'string' && e.payload.includes(text),
      )
      expect(found).toBe(true)
    }
  }

  // ============ 动画断言 ============

  /**
   * 断言指定动画被触发
   * @param animId - 动画ID
   */
  const expectAnimationTriggered = (animId: string) => {
    if (mockCtx) {
      const reactionEvents = mockCtx.events.filter(e => e.event === 'spiritpal-mcp-react')
      const found = reactionEvents.some(e => e.payload === animId)
      expect(found).toBe(true)
    }
  }

  // ============ 批量模拟 ============

  /**
   * 模拟多次心跳 tick（每秒一次）
   * @param seconds - 模拟的秒数
   */
  const simulateHeartbeat = (seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      clock?.advance(1000)
      mockCtx?.eventImpl.emit('heartbeat', { timestamp: clock?.nowMs() ?? Date.now() })
    }
  }

  /**
   * 模拟离线时长的属性衰减
   * @param hours - 离线小时数
   */
  const simulateOfflineDecay = (hours: number) => {
    clock?.advanceBy(`${hours}h`)
  }

  return {
    advanceTime,
    waitForCooldown,
    simulateInteraction,
    simulateFeed,
    simulatePat,
    expectPetState,
    expectHungerRange,
    expectMoodRange,
    expectEventCount,
    expectNoErrors,
    expectCooldownExpired,
    expectBubbleContains,
    expectAnimationTriggered,
    simulateHeartbeat,
    simulateOfflineDecay,
  }
}

/** TestHarness 类型，由 createTestHarness 返回值推导 */
export type TestHarness = ReturnType<typeof createTestHarness>

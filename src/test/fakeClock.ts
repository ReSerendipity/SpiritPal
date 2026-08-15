/**
 * @file 虚拟时钟测试工具
 * @module test/fakeClock
 * @description
 * 提供确定性时间控制的虚拟时钟实现，用于单元测试中模拟时间流逝。
 * 参考 OpenPets 测试基础设施的 FakeClock 设计。
 *
 * 主要功能：
 * - 替换全局 Date.now / setTimeout / setInterval
 * - 支持毫秒和字符串格式（"30s"/"90m"/"2h"）时间推进
 * - 自动执行到期的定时器回调
 * - 支持 interval 定时器的重复调度
 */

import { vi, afterEach } from 'vitest'

/**
 * 解析时间字符串为毫秒数
 * @param input - 时间字符串，支持格式："500ms"、"30s"、"90m"、"2h"
 * @returns 对应的毫秒数
 * @throws 当输入格式无效时抛出错误
 */
export function parseTimeMs(input: string): number {
  const match = input.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/)
  if (!match) throw new Error(`Invalid time string: "${input}". Use format like "30s", "90m", "2h", "500ms"`)
  const value = parseFloat(match[1])
  const unit = match[2] ?? 'ms'
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }
  return value * multipliers[unit]
}

/**
 * 虚拟时钟类
 * 用于在测试中精确控制时间流逝和定时器触发
 */
export class FakeClock {
  /** 当前虚拟时间戳（毫秒） */
  private now: number
  /** 待触发的定时器映射表 */
  private timers: Map<number, { fn: () => void; triggerAt: number; interval: number | null }> = new Map()
  /** 下一个定时器ID */
  private nextId = 1
  /** 原始的 Date.now 函数 */
  private originalDateNow: () => number
  /** 原始的 setTimeout 函数 */
  private originalSetTimeout: typeof setTimeout
  /** 原始的 setInterval 函数 */
  private originalSetInterval: typeof setInterval
  /** 原始的 clearTimeout 函数 */
  private originalClearTimeout: typeof clearTimeout
  /** 原始的 clearInterval 函数 */
  private originalClearInterval: typeof clearInterval
  /** 是否已安装 */
  private installed = false

  /**
   * 构造函数
   * @param initialTime - 初始时间戳（毫秒），默认使用当前真实时间
   */
  constructor(initialTime?: number) {
    this.now = initialTime ?? Date.now()
    this.originalDateNow = Date.now
    this.originalSetTimeout = globalThis.setTimeout as typeof setTimeout
    this.originalSetInterval = globalThis.setInterval as typeof setInterval
    this.originalClearTimeout = globalThis.clearTimeout as typeof clearTimeout
    this.originalClearInterval = globalThis.clearInterval as typeof clearInterval
  }

  /**
   * 安装虚拟时钟，替换全局 Date.now / setTimeout / setInterval
   */
  install(): void {
    if (this.installed) return
    this.installed = true

    vi.spyOn(Date, 'now').mockImplementation(() => this.now)

    vi.stubGlobal('setTimeout', (fn: TimerHandler, ms?: number) => {
      const id = this.nextId++
      const delay = ms ?? 0
      this.timers.set(id, { fn: fn as () => void, triggerAt: this.now + delay, interval: null })
      return id
    })

    vi.stubGlobal('setInterval', (fn: TimerHandler, ms?: number) => {
      const id = this.nextId++
      const delay = ms ?? 0
      this.timers.set(id, { fn: fn as () => void, triggerAt: this.now + delay, interval: delay })
      return id
    })

    vi.stubGlobal('clearTimeout', (id?: number) => {
      if (id !== undefined) this.timers.delete(id)
    })

    vi.stubGlobal('clearInterval', (id?: number) => {
      if (id !== undefined) this.timers.delete(id)
    })
  }

  /**
   * 卸载虚拟时钟，恢复全局函数
   */
  uninstall(): void {
    if (!this.installed) return
    this.installed = false
    vi.restoreAllMocks()
    this.timers.clear()
    vi.stubGlobal('setTimeout', this.originalSetTimeout)
    vi.stubGlobal('setInterval', this.originalSetInterval)
    vi.stubGlobal('clearTimeout', this.originalClearTimeout)
    vi.stubGlobal('clearInterval', this.originalClearInterval)
  }

  /**
   * 推进虚拟时间（毫秒），触发到期的定时器
   * @param ms - 要推进的毫秒数
   */
  advance(ms: number): void {
    this.now += ms
    const expired: number[] = []
    for (const [id, timer] of this.timers) {
      if (this.now >= timer.triggerAt) {
        expired.push(id)
      }
    }
    for (const id of expired) {
      const timer = this.timers.get(id)
      if (!timer) continue
      try {
        timer.fn()
      } catch {
        // 忽略定时器回调错误
      }
      if (timer.interval !== null) {
        timer.triggerAt = this.now + timer.interval
      } else {
        this.timers.delete(id)
      }
    }
  }

  /**
   * 推进时间（字符串格式）
   * @param duration - 时间字符串，如 "30s", "90m", "2h"
   */
  advanceBy(duration: string): void {
    this.advance(parseTimeMs(duration))
  }

  /**
   * 推进到指定的绝对时间戳
   * @param timestamp - 目标时间戳（毫秒）
   */
  advanceTo(timestamp: number): void {
    const diff = timestamp - this.now
    if (diff > 0) this.advance(diff)
  }

  /**
   * 获取当前虚拟时间戳
   * @returns 当前虚拟时间戳（毫秒）
   */
  nowMs(): number {
    return this.now
  }

  /**
   * 获取当前日期对象
   * @returns 当前虚拟时间的 Date 对象
   */
  nowDate(): Date {
    return new Date(this.now)
  }

  /**
   * 清除所有待触发的定时器
   */
  clearAllTimers(): void {
    this.timers.clear()
  }

  /**
   * 获取当前活跃的定时器数量
   * @returns 待触发的定时器数量
   */
  get pendingTimerCount(): number {
    return this.timers.size
  }
}

/**
 * 创建并自动安装 FakeClock，在 afterEach 中自动卸载
 * @param initialTime - 初始时间戳（毫秒）
 * @returns 已安装的 FakeClock 实例
 */
export function createFakeClock(initialTime?: number): FakeClock {
  const clock = new FakeClock(initialTime)
  clock.install()
  afterEach(() => clock.uninstall())
  return clock
}

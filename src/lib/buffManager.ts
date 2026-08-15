/**
 * Buff 系统管理器 — 状态增益/减益效果管理
 *
 * @fileoverview
 * 主要模块：
 * - ActiveBuff 接口：活跃 Buff 实例
 * - BuffEffectHandler 类型：Buff 效果回调
 * - BuffManager 类：Buff 管理器（单例模式），支持 Buff 施加/移除/定时 Tick/效果叠加
 *
 * Buff 类型：
 * - BuffAdd (hp/fv/coin): 每 interval 秒增加 value，持续 expiration 秒
 * - BuffAlt (HP_stop/FV_stop): 停止衰减，仅倒计时
 *
 * 叠加规则：重新施加同一 buff 添加新的 timer 条目（多层独立倒计时）
 *
 * @module buffManager
 * @requires ./types - BuffConfig 类型定义
 */

import type { BuffConfig } from './types'

// ============ 活跃 Buff 实例 ============
interface ActiveBuff {
  id: string
  config: BuffConfig
  remaining: number      // 剩余秒数
  intervalElapsed: number // 当前 interval 已过秒数
}

// ============ Buff 效果回调 ============
/**
 * Buff 效果处理回调类型
 * @callback BuffEffectHandler
 * @param {BuffConfig['effect']} effect - Buff 效果类型
 * @param {number} value - 效果数值
 */
export type BuffEffectHandler = (effect: BuffConfig['effect'], value: number) => void

/**
 * Buff 管理器类
 * @class
 */
export class BuffManager {
  private buffs: ActiveBuff[] = []
  private tickTimer: number | null = null
  private effectHandler: BuffEffectHandler | null = null
  private listeners: Set<() => void> = new Set()

  // 设置效果处理器（当 Buff tick 触发时调用）
  setEffectHandler(handler: BuffEffectHandler): void {
    this.effectHandler = handler
  }

  // 添加状态变化监听器
  onBuffsChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn())
  }

  // 施加一个 Buff
  applyBuff(config: BuffConfig, id?: string): string {
    const buffId = id ?? `buff_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const buff: ActiveBuff = {
      id: buffId,
      config,
      remaining: config.expiration ?? -1, // -1 表示永久
      intervalElapsed: 0,
    }
    this.buffs.push(buff)
    this.ensureTicking()
    this.notifyListeners()
    return buffId
  }

  // 移除指定 Buff
  removeBuff(buffId: string): void {
    const before = this.buffs.length
    this.buffs = this.buffs.filter((b) => b.id !== buffId)
    if (this.buffs.length === 0 && before > 0) {
      this.stopTicking()
    }
    if (this.buffs.length !== before) {
      this.notifyListeners()
    }
  }

  // 检查是否有停止饱食度衰减的 Buff
  isHpStopped(): boolean {
    return this.buffs.some((b) => b.config.effect === 'HP_stop' && (b.remaining === -1 || b.remaining > 0))
  }

  // 检查是否有停止心情衰减的 Buff
  isFvStopped(): boolean {
    return this.buffs.some((b) => b.config.effect === 'FV_stop' && (b.remaining === -1 || b.remaining > 0))
  }

  // 获取所有活跃 Buff
  getActiveBuffs(): ActiveBuff[] {
    return [...this.buffs]
  }

  // 获取指定 Buff 的剩余时间
  getRemainingTime(buffId: string): number {
    const buff = this.buffs.find((b) => b.id === buffId)
    return buff?.remaining ?? 0
  }

  // Tick（每秒调用一次）
  tick(): void {
    if (this.buffs.length === 0) return

    const expired: string[] = []

    for (const buff of this.buffs) {
      // 永久Buff（remaining=-1）不减时间
      if (buff.remaining !== -1) {
        buff.remaining -= 1
      }
      buff.intervalElapsed += 1

      // 检查是否过期（非永久且remaining<=0）
      if (buff.remaining !== -1 && buff.remaining <= 0) {
        expired.push(buff.id)
        continue
      }

      // BuffAdd 类型：到达 interval 时触发效果
      if (
        (buff.config.effect === 'hp' || buff.config.effect === 'fv' || buff.config.effect === 'coin') &&
        buff.config.interval > 0 &&
        buff.intervalElapsed >= buff.config.interval
      ) {
        buff.intervalElapsed = 0
        if (this.effectHandler) {
          this.effectHandler(buff.config.effect, buff.config.value)
        }
      }
    }

    // 移除过期 Buff
    if (expired.length > 0) {
      this.buffs = this.buffs.filter((b) => !expired.includes(b.id))
      if (this.buffs.length === 0) {
        this.stopTicking()
      }
      this.notifyListeners()
    }
  }

  // 启动 tick 计时器
  private ensureTicking(): void {
    if (this.tickTimer !== null) return
    this.tickTimer = window.setInterval(() => this.tick(), 1000)
  }

  // 停止 tick 计时器
  private stopTicking(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  // 清空所有 Buff
  clear(): void {
    this.buffs = []
    this.stopTicking()
    this.notifyListeners()
  }

  // 序列化（用于持久化）
  serialize(): Array<Omit<ActiveBuff, 'intervalElapsed'>> {
    return this.buffs.map((b) => ({
      id: b.id,
      config: b.config,
      remaining: b.remaining,
    }))
  }

  // 反序列化
  deserialize(data: Array<{ id: string; config: BuffConfig; remaining: number }>): void {
    this.clear()
    for (const item of data) {
      this.buffs.push({
        id: item.id,
        config: item.config,
        remaining: item.remaining,
        intervalElapsed: 0,
      })
    }
    if (this.buffs.length > 0) {
      this.ensureTicking()
    }
    this.notifyListeners()
  }

  /**
   * 销毁实例：停止计时器、清空 Buff 和监听器，防止内存泄漏
   * 在切换角色或应用退出时调用
   */
  dispose(): void {
    this.stopTicking()
    this.buffs = []
    this.listeners.clear()
    this.effectHandler = null
  }
}

// ============ 单例缓存（每个角色一个）============
const managers = new Map<string, BuffManager>()

export function getBuffManager(characterId: string): BuffManager {
  let mgr = managers.get(characterId)
  if (!mgr) {
    mgr = new BuffManager()
    managers.set(characterId, mgr)
  }
  return mgr
}

/**
 * 移除指定角色的 BuffManager 实例
 * 在切换角色时调用，先 dispose 清理资源再从缓存中删除
 * @param characterId 角色 ID
 */
export function removeBuffManager(characterId: string): void {
  const mgr = managers.get(characterId)
  if (mgr) {
    mgr.dispose()
    managers.delete(characterId)
  }
}

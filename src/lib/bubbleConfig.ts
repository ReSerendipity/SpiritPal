/**
 * 气泡配置系统 — 8+1 气泡类型 + HP 等级候选选择 + 倒计时气泡
 *
 * @fileoverview
 * 主要模块：
 * - BubbleTypeConfig 类型：9 种气泡类型（greeting/hungry/bored/sick/happy/sleep/idle/weather/custom）
 * - HpLevelCandidate 接口：HP 等级候选文本
 * - BubbleTypeDefinition 接口：气泡类型配置（候选、权重、冷却、倒计时）
 * - BubbleInstance 接口：气泡实例
 * - CountdownConfig 接口：倒计时配置
 * - replacePlaceholders()：占位符替换（{USERTAG}/{ITEMNAME}/自定义变量）
 * - createDefaultBubbleConfigs()：创建默认气泡配置
 * - BubbleConfigSystem 类：气泡配置系统（单例模式），支持 HP 分层候选、冷却管理、倒计时气泡
 * - getBubbleConfigSystem()：获取单例入口
 *
 * 核心功能：
 * 1. 8+1 气泡类型：greeting, hungry, bored, sick, happy, sleep, idle, weather, custom
 * 2. HP 等级候选选择（不同饱食度显示不同文本）
 * 3. USERTAG/ITEMNAME 占位符替换
 * 4. 倒计时气泡（如 "5 秒后喂食"）
 * 5. 可配置概率权重
 * 6. 冷却时间防刷屏
 *
 * @module bubbleConfig
 * @requires ./types - NurturingStats, CharacterProfile 类型定义
 * @requires ./behaviorEngine - getHpTier, HpTier HP 等级计算
 */

import type { NurturingStats, CharacterProfile } from './types'
import { getHpTier, type HpTier } from './behaviorEngine'

// ============ 气泡类型定义 ============

/** 气泡类型（8+1） */
export type BubbleTypeConfig =
  | 'greeting'   // 打招呼
  | 'hungry'     // 饥饿
  | 'bored'      // 无聊
  | 'sick'       // 生病
  | 'happy'      // 开心
  | 'sleep'      // 困倦/睡眠
  | 'idle'       // 待机闲聊
  | 'weather'    // 天气相关
  | 'custom'     // 自定义（用户/模组扩展）

/** HP 等级候选条目 */
export interface HpLevelCandidate {
  /** 适用此文本的最低 HP tier（0=濒死, 1=饥饿, 2=正常, 3=充沛） */
  minTier: HpTier
  /** 气泡文本（支持 USERTAG/ITEMNAME 占位符） */
  text: string
}

/** 气泡类型配置 */
export interface BubbleTypeDefinition {
  /** 气泡类型 */
  type: BubbleTypeConfig
  /** 显示名称 */
  name: string
  /** 候选文本列表（按 HP 等级选择） */
  candidates: HpLevelCandidate[]
  /** 触发概率权重（0-1，越高越容易触发） */
  weight: number
  /** 冷却时间（秒） */
  cooldown: number
  /** 是否可以同时显示多个（默认 false） */
  allowMultiple?: boolean
  /** 倒计时配置（可选） */
  countdown?: CountdownConfig
}

/** 倒计时配置 */
export interface CountdownConfig {
  /** 倒计时总秒数 */
  duration: number
  /** 倒计时文本模板（{seconds} 为占位符） */
  template: string
  /** 倒计时结束后的文本 */
  finishText: string
}

/** 气泡实例 */
export interface BubbleInstance {
  /** 唯一 ID */
  id: string
  /** 气泡类型 */
  type: BubbleTypeConfig
  /** 显示文本 */
  text: string
  /** 剩余显示时间（毫秒） */
  remainingMs: number
  /** 是否为倒计时气泡 */
  isCountdown: boolean
  /** 倒计时剩余秒数（非倒计时为 null） */
  countdownSeconds?: number
}

// ============ 占位符替换 ============

/** 占位符上下文 */
export interface PlaceholderContext {
  /** 用户标签/名称 */
  userTag: string
  /** 当前使用物品名称 */
  itemName?: string
  /** 自定义变量 */
  customVars?: Record<string, string>
}

/**
 * 替换文本中的占位符
 * 支持：{USERTAG}, {ITEMNAME}, {自定义变量}
 */
export function replacePlaceholders(text: string, ctx: PlaceholderContext): string {
  let result = text
  result = result.replace(/\{USERTAG\}/g, ctx.userTag)
  result = result.replace(/\{ITEMNAME\}/g, ctx.itemName ?? '')

  // 自定义变量
  if (ctx.customVars) {
    for (const [key, value] of Object.entries(ctx.customVars)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
    }
  }

  return result
}

// ============ 默认气泡配置 ============

/** 各角色的默认气泡配置 */
export function createDefaultBubbleConfigs(): BubbleTypeDefinition[] {
  return [
    {
      type: 'greeting',
      name: '打招呼',
      candidates: [
        { minTier: 3, text: '主人来啦！好开心～' },
        { minTier: 2, text: '你好呀主人～' },
        { minTier: 1, text: '主人……我有点饿了' },
        { minTier: 0, text: '主人……救救我……' },
      ],
      weight: 0.8,
      cooldown: 60,
    },
    {
      type: 'hungry',
      name: '饥饿',
      candidates: [
        { minTier: 1, text: '肚子好饿……' },
        { minTier: 0, text: '好饿好饿……快给我吃的！' },
      ],
      weight: 0.9,
      cooldown: 30,
    },
    {
      type: 'bored',
      name: '无聊',
      candidates: [
        { minTier: 3, text: '好无聊啊，陪我玩嘛～' },
        { minTier: 2, text: '主人不陪我玩吗？' },
        { minTier: 1, text: '又饿又无聊……' },
      ],
      weight: 0.6,
      cooldown: 45,
    },
    {
      type: 'sick',
      name: '生病',
      candidates: [
        { minTier: 0, text: '呜呜……我不舒服……' },
      ],
      weight: 1.0,
      cooldown: 20,
    },
    {
      type: 'happy',
      name: '开心',
      candidates: [
        { minTier: 3, text: '好开心好开心！' },
        { minTier: 2, text: '心情不错呢～' },
      ],
      weight: 0.5,
      cooldown: 60,
    },
    {
      type: 'sleep',
      name: '困倦',
      candidates: [
        { minTier: 2, text: '好困……想睡觉……' },
        { minTier: 1, text: '又饿又困……' },
      ],
      weight: 0.4,
      cooldown: 120,
    },
    {
      type: 'idle',
      name: '待机闲聊',
      candidates: [
        { minTier: 3, text: '今天天气真好～' },
        { minTier: 2, text: '嗯～' },
        { minTier: 1, text: '有点饿了……' },
      ],
      weight: 0.3,
      cooldown: 90,
    },
    {
      type: 'weather',
      name: '天气',
      candidates: [
        { minTier: 2, text: '外面好像下雨了……' },
        { minTier: 2, text: '今天好热啊～' },
      ],
      weight: 0.2,
      cooldown: 180,
    },
    {
      type: 'custom',
      name: '自定义',
      candidates: [],
      weight: 0.1,
      cooldown: 60,
    },
  ]
}

// ============ 气泡配置系统 ============

export class BubbleConfigSystem {
  /** 气泡类型配置（按角色 ID 分组） */
  private configs: Map<string, BubbleTypeDefinition[]> = new Map()
  /** 冷却时间戳（角色 ID → 气泡类型 → 上次触发时间） */
  private cooldowns: Map<string, Map<BubbleTypeConfig, number>> = new Map()

  /**
   * 设置角色的气泡配置
   */
  setBubbleConfigs(characterId: string, configs: BubbleTypeDefinition[]): void {
    this.configs.set(characterId, configs)
  }

  /**
   * 从角色档案生成气泡配置
   */
  initFromCharacter(characterId: string, profile: CharacterProfile): void {
    const configs = createDefaultBubbleConfigs()

    // 使用角色档案的 bubbleMessages 覆盖默认文本
    const bubbleMap = profile.bubbleMessages
    if (bubbleMap) {
      // idle 气泡
      const idleConfig = configs.find((c) => c.type === 'idle')
      if (idleConfig && bubbleMap.idle?.length) {
        idleConfig.candidates = bubbleMap.idle.map((text) => ({
          minTier: 2 as HpTier,
          text,
        }))
      }
      // hungry 气泡
      const hungryConfig = configs.find((c) => c.type === 'hungry')
      if (hungryConfig && bubbleMap.hungry?.length) {
        hungryConfig.candidates = bubbleMap.hungry.map((text) => ({
          minTier: 1 as HpTier,
          text,
        }))
      }
      // happy 气泡（映射到 feed + pet）
      const happyConfig = configs.find((c) => c.type === 'happy')
      if (happyConfig && bubbleMap.pet?.length) {
        happyConfig.candidates = [
          ...bubbleMap.pet.map((text) => ({ minTier: 2 as HpTier, text })),
          ...bubbleMap.feed.map((text) => ({ minTier: 2 as HpTier, text })),
        ]
      }
      // sick 气泡（映射到 sad）
      const sickConfig = configs.find((c) => c.type === 'sick')
      if (sickConfig && bubbleMap.sad?.length) {
        sickConfig.candidates = bubbleMap.sad.map((text) => ({
          minTier: 0 as HpTier,
          text,
        }))
      }
    }

    this.configs.set(characterId, configs)
  }

  /**
   * 获取角色的气泡配置
   */
  getBubbleConfigs(characterId: string): BubbleTypeDefinition[] {
    return this.configs.get(characterId) ?? createDefaultBubbleConfigs()
  }

  /**
   * 选择气泡文本（基于 HP 等级候选选择）
   */
  selectBubbleText(
    characterId: string,
    type: BubbleTypeConfig,
    stats: NurturingStats,
    placeholderCtx: PlaceholderContext,
  ): string | null {
    const configs = this.getBubbleConfigs(characterId)
    const config = configs.find((c) => c.type === type)
    if (!config || config.candidates.length === 0) return null

    // 检查冷却
    if (this.isOnCooldown(characterId, type, config.cooldown)) return null

    const currentTier = getHpTier(stats)

    // 从当前 tier 开始向下查找匹配的候选
    const matching = config.candidates
      .filter((c) => currentTier >= c.minTier)
      .sort((a, b) => b.minTier - a.minTier) // 优先高 tier 的文本

    if (matching.length === 0) return null

    // 随机选择一个匹配的候选
    const selected = matching[Math.floor(Math.random() * matching.length)]

    // 替换占位符
    const text = replacePlaceholders(selected.text, placeholderCtx)

    // 更新冷却时间
    this.updateCooldown(characterId, type)

    return text
  }

  /**
   * 选择随机触发的气泡（基于概率权重）
   */
  selectRandomBubble(
    characterId: string,
    stats: NurturingStats,
    placeholderCtx: PlaceholderContext,
  ): string | null {
    const configs = this.getBubbleConfigs(characterId)
    const currentTier = getHpTier(stats)

    // 过滤可用气泡
    const available = configs.filter((config) => {
      if (config.candidates.length === 0) return false
      if (this.isOnCooldown(characterId, config.type, config.cooldown)) return false
      return config.candidates.some((c) => currentTier >= c.minTier)
    })

    if (available.length === 0) return null

    // 按权重随机选择
    const totalWeight = available.reduce((sum, c) => sum + c.weight, 0)
    let rand = Math.random() * totalWeight
    for (const config of available) {
      rand -= config.weight
      if (rand <= 0) {
        return this.selectBubbleText(characterId, config.type, stats, placeholderCtx)
      }
    }

    return null
  }

  /**
   * 创建倒计时气泡
   */
  createCountdownBubble(
    type: BubbleTypeConfig,
    countdownConfig: CountdownConfig,
  ): BubbleInstance {
    return {
      id: `countdown_${Date.now()}`,
      type,
      text: countdownConfig.template.replace('{seconds}', String(countdownConfig.duration)),
      remainingMs: countdownConfig.duration * 1000,
      isCountdown: true,
      countdownSeconds: countdownConfig.duration,
    }
  }

  /**
   * 更新倒计时气泡
   */
  updateCountdownBubble(bubble: BubbleInstance, deltaMs: number): BubbleInstance {
    if (!bubble.isCountdown) return bubble

    const remaining = Math.max(0, bubble.remainingMs - deltaMs)
    const seconds = Math.ceil(remaining / 1000)

    return {
      ...bubble,
      remainingMs: remaining,
      countdownSeconds: seconds,
      text: seconds > 0
        ? `{seconds} 秒后...`.replace('{seconds}', String(seconds))
        : '完成！',
    }
  }

  // ============ 冷却管理 ============

  private isOnCooldown(characterId: string, type: BubbleTypeConfig, cooldownSec: number): boolean {
    const charCooldowns = this.cooldowns.get(characterId)
    if (!charCooldowns) return false

    const lastTrigger = charCooldowns.get(type)
    if (lastTrigger === undefined) return false

    return Date.now() - lastTrigger < cooldownSec * 1000
  }

  private updateCooldown(characterId: string, type: BubbleTypeConfig): void {
    let charCooldowns = this.cooldowns.get(characterId)
    if (!charCooldowns) {
      charCooldowns = new Map()
      this.cooldowns.set(characterId, charCooldowns)
    }
    charCooldowns.set(type, Date.now())
  }

  /**
   * 重置冷却时间（角色切换时调用）
   */
  resetCooldowns(characterId: string): void {
    this.cooldowns.delete(characterId)
  }
}

// ============ 单例 ============

let bubbleConfigInstance: BubbleConfigSystem | null = null

/** 获取气泡配置系统单例 */
export function getBubbleConfigSystem(): BubbleConfigSystem {
  if (!bubbleConfigInstance) {
    bubbleConfigInstance = new BubbleConfigSystem()
  }
  return bubbleConfigInstance
}

/**
 * 成就/徽章系统 — 追踪用户互动里程碑、解锁成就和徽章
 * 成就/徽章系统设计（PRD §7.5）：完成条件、解锁徽章、统计展示
 *
 * @fileoverview
 * 主要模块：
 * - Achievement 接口：成就定义结构
 * - AchievementStats 接口：成就统计数据结构
 * - ACHIEVEMENTS 常量：25+ 个预设成就列表
 * - BADGE_NAMES/BADGE_COLORS：徽章等级显示配置
 * - AchievementManager 类：成就管理器（单例模式）
 * - getAchievementManager()：获取单例入口
 *
 * 徽章等级（BadgeTier）：none → star → moon → sun → crown
 * 成就类别：互动类、养成类、专注类、收集类、社交类
 *
 * @module achievementSystem
 * @requires ./types - BadgeTier, NurturingStats 类型定义
 * @requires ./behaviorEngine - getAffectionLevel 亲密度等级计算
 */

import type { BadgeTier, NurturingStats } from './types'
import { getAffectionLevel } from './behaviorEngine'

// ============ 成就定义 ============

/**
 * 成就定义接口
 * @interface
 */
export interface Achievement {
  /** 成就唯一 ID */
  id: string
  /** 成就显示名称 */
  name: string
  /** 成就描述 */
  description: string
  /** 成就图标（emoji） */
  icon: string
  /** 成就类别 */
  category: 'interaction' | 'nurturing' | 'focus' | 'collection' | 'special'
  /** 徽章等级 */
  tier: BadgeTier
  /** 解锁条件判断函数 */
  condition: (stats: AchievementStats) => boolean
  /** 金币奖励（可选） */
  reward?: number
}

/**
 * 成就统计数据接口
 * @interface
 */
export interface AchievementStats {
  /** 总点击次数 */
  totalClicks: number
  /** 总摸头次数 */
  totalPets: number
  /** 总喂食次数 */
  totalFeeds: number
  /** 总玩耍次数 */
  totalPlays: number
  /** 总洗澡次数 */
  totalBathes: number
  /** 总聊天轮次 */
  totalChats: number
  /** 总完成番茄钟数 */
  totalPomodoros: number
  /** 总专注分钟数 */
  totalPomodoroMinutes: number
  /** 总获得金币数 */
  totalCoinsEarned: number
  /** 总购买物品数 */
  totalItemsBought: number
  /** 总使用物品数 */
  totalItemsUsed: number
  /** 连续登录天数 */
  consecutiveLoginDays: number
  /** 总登录天数 */
  totalLoginDays: number
  /** 历史最高亲密度等级 */
  maxAffectionLevel: number
  /** 历史最高角色等级 */
  maxCharacterLevel: number
  /** 已解锁角色数 */
  charactersUnlocked: number
  /** 已解锁成就 ID 列表 */
  unlockedAchievements: string[]
}

// ============ 成就列表 ============

/**
 * 预设成就列表（25个）
 * @constant
 */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-click', name: '初次见面', description: '第一次点击宠物', icon: '👋', category: 'interaction', tier: 'star', condition: (s) => s.totalClicks >= 1, reward: 5 },
  { id: 'click-100', name: '摸摸手', description: '点击宠物100次', icon: '👆', category: 'interaction', tier: 'moon', condition: (s) => s.totalClicks >= 100, reward: 20 },
  { id: 'click-500', name: '互动达人', description: '点击宠物500次', icon: '✋', category: 'interaction', tier: 'sun', condition: (s) => s.totalClicks >= 500, reward: 50 },
  { id: 'pet-50', name: '摸头杀', description: '摸头50次', icon: '🤚', category: 'interaction', tier: 'star', condition: (s) => s.totalPets >= 50, reward: 10 },
  { id: 'pet-200', name: '亲密无间', description: '摸头200次', icon: '💖', category: 'interaction', tier: 'sun', condition: (s) => s.totalPets >= 200, reward: 40 },
  { id: 'feed-30', name: '美食家', description: '喂食30次', icon: '🍽️', category: 'interaction', tier: 'moon', condition: (s) => s.totalFeeds >= 30, reward: 15 },
  { id: 'play-20', name: '玩伴', description: '玩耍20次', icon: '🎮', category: 'interaction', tier: 'moon', condition: (s) => s.totalPlays >= 20, reward: 15 },
  { id: 'bathe-10', name: '香喷喷', description: '洗澡10次', icon: '🛁', category: 'interaction', tier: 'star', condition: (s) => s.totalBathes >= 10, reward: 10 },
  { id: 'chat-50', name: '话痨', description: '聊天50轮', icon: '💬', category: 'nurturing', tier: 'moon', condition: (s) => s.totalChats >= 50, reward: 25 },
  { id: 'chat-200', name: '知心好友', description: '聊天200轮', icon: '🗣️', category: 'nurturing', tier: 'sun', condition: (s) => s.totalChats >= 200, reward: 60 },
  { id: 'affection-lv3', name: '好朋友', description: '亲密度达到Lv3', icon: '💛', category: 'nurturing', tier: 'moon', condition: (s) => s.maxAffectionLevel >= 3, reward: 30 },
  { id: 'affection-lv5', name: '挚友', description: '亲密度达到Lv5', icon: '💗', category: 'nurturing', tier: 'crown', condition: (s) => s.maxAffectionLevel >= 5, reward: 100 },
  { id: 'pomodoro-1', name: '初次专注', description: '完成第一个番茄钟', icon: '🍅', category: 'focus', tier: 'star', condition: (s) => s.totalPomodoros >= 1, reward: 10 },
  { id: 'pomodoro-10', name: '专注新手', description: '完成10个番茄钟', icon: '⏰', category: 'focus', tier: 'moon', condition: (s) => s.totalPomodoros >= 10, reward: 30 },
  { id: 'pomodoro-50', name: '专注大师', description: '完成50个番茄钟', icon: '🏆', category: 'focus', tier: 'sun', condition: (s) => s.totalPomodoros >= 50, reward: 80 },
  { id: 'pomodoro-600', name: '时间管理大师', description: '累计专注600分钟', icon: '⏱️', category: 'focus', tier: 'crown', condition: (s) => s.totalPomodoroMinutes >= 600, reward: 120 },
  { id: 'buy-10', name: '购物新手', description: '购买10件物品', icon: '🛒', category: 'collection', tier: 'star', condition: (s) => s.totalItemsBought >= 10, reward: 10 },
  { id: 'buy-50', name: '购物达人', description: '购买50件物品', icon: '🛍️', category: 'collection', tier: 'sun', condition: (s) => s.totalItemsBought >= 50, reward: 40 },
  { id: 'use-30', name: '物品使用', description: '使用30件物品', icon: '📦', category: 'collection', tier: 'moon', condition: (s) => s.totalItemsUsed >= 30, reward: 20 },
  { id: 'login-7', name: '一周陪伴', description: '连续登录7天', icon: '📅', category: 'special', tier: 'moon', condition: (s) => s.consecutiveLoginDays >= 7, reward: 30 },
  { id: 'login-30', name: '月度陪伴', description: '累计登录30天', icon: '📆', category: 'special', tier: 'sun', condition: (s) => s.totalLoginDays >= 30, reward: 60 },
  { id: 'all-chars', name: '全角色收集', description: '解锁全部角色', icon: '🌟', category: 'special', tier: 'crown', condition: (s) => s.charactersUnlocked >= 3, reward: 100 },
]

// ============ 等级徽章计算 ============

/**
 * 根据亲密度等级获取徽章等级
 * @param {number} affectionLevel - 亲密度等级（1-5）
 * @returns {BadgeTier} 对应的徽章等级
 */
export function getBadgeTier(affectionLevel: number): BadgeTier {
  if (affectionLevel >= 5) return 'crown'
  if (affectionLevel >= 3) return 'sun'
  if (affectionLevel >= 2) return 'moon'
  if (affectionLevel >= 1) return 'star'
  return 'none'
}

/**
 * 徽章等级中文名称映射
 * @constant
 */
export const BADGE_NAMES: Record<BadgeTier, string> = {
  none: '无',
  star: '星辰',
  moon: '皓月',
  sun: '骄阳',
  crown: '皇冠',
}

/**
 * 徽章等级颜色映射
 * @constant
 */
export const BADGE_COLORS: Record<BadgeTier, string> = {
  none: '#6b7280',
  star: '#facc15',
  moon: '#a5b4fc',
  sun: '#fb923c',
  crown: '#fcd34d',
}

// ============ 成就管理器 ============

/** localStorage 存储键名 */
const STORAGE_KEY = 'spiritpal-achievements'

/**
 * 成就管理器类
 * 负责追踪用户行为统计、检查成就解锁、持久化存储
 * @class
 */
export class AchievementManager {
  /** 成就统计数据 */
  private stats: AchievementStats
  /** 状态变化监听器集合 */
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.stats = this.load()
  }

  /**
   * 从 localStorage 加载成就统计数据
   * @private
   * @returns {AchievementStats} 加载的统计数据，加载失败返回默认值
   */
  private load(): AchievementStats {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        return {
          totalClicks: 0,
          totalPets: 0,
          totalFeeds: 0,
          totalPlays: 0,
          totalBathes: 0,
          totalChats: 0,
          totalPomodoros: 0,
          totalPomodoroMinutes: 0,
          totalCoinsEarned: 0,
          totalItemsBought: 0,
          totalItemsUsed: 0,
          consecutiveLoginDays: 1,
          totalLoginDays: 1,
          maxAffectionLevel: 0,
          maxCharacterLevel: 1,
          charactersUnlocked: 1,
          unlockedAchievements: [],
          ...parsed,
        }
      }
    } catch {
      // 使用默认值
    }
    return {
      totalClicks: 0,
      totalPets: 0,
      totalFeeds: 0,
      totalPlays: 0,
      totalBathes: 0,
      totalChats: 0,
      totalPomodoros: 0,
      totalPomodoroMinutes: 0,
      totalCoinsEarned: 0,
      totalItemsBought: 0,
      totalItemsUsed: 0,
      consecutiveLoginDays: 1,
      totalLoginDays: 1,
      maxAffectionLevel: 0,
      maxCharacterLevel: 1,
      charactersUnlocked: 1,
      unlockedAchievements: [],
    }
  }

  /**
   * 保存统计数据到 localStorage 并通知监听器
   * @private
   */
  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stats))
    } catch {
      // 忽略存储错误
    }
    this.notifyListeners()
  }

  /**
   * 注册成就变化监听器
   * @param {() => void} listener - 监听器回调函数
   * @returns {() => void} 取消监听的函数
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 通知所有监听器
   * @private
   */
  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn())
  }

  // ============ 更新统计 ============

  /** 记录一次点击 */
  recordClick(): void { this.stats.totalClicks++; this.checkAchievements(); this.save() }
  /** 记录一次摸头 */
  recordPet(): void { this.stats.totalPets++; this.checkAchievements(); this.save() }
  /** 记录一次喂食 */
  recordFeed(): void { this.stats.totalFeeds++; this.checkAchievements(); this.save() }
  /** 记录一次玩耍 */
  recordPlay(): void { this.stats.totalPlays++; this.checkAchievements(); this.save() }
  /** 记录一次洗澡 */
  recordBathe(): void { this.stats.totalBathes++; this.checkAchievements(); this.save() }
  /** 记录一次聊天 */
  recordChat(): void { this.stats.totalChats++; this.checkAchievements(); this.save() }

  /**
   * 记录一次番茄钟完成
   * @param {number} minutes - 专注分钟数
   */
  recordPomodoro(minutes: number): void {
    this.stats.totalPomodoros++
    this.stats.totalPomodoroMinutes += minutes
    this.checkAchievements()
    this.save()
  }

  /**
   * 记录获得金币
   * @param {number} amount - 金币数量
   */
  recordCoinsEarned(amount: number): void { this.stats.totalCoinsEarned += amount; this.save() }
  /** 记录购买物品 */
  recordItemBought(): void { this.stats.totalItemsBought++; this.checkAchievements(); this.save() }
  /** 记录使用物品 */
  recordItemUsed(): void { this.stats.totalItemsUsed++; this.checkAchievements(); this.save() }

  /**
   * 记录用户登录，计算连续登录天数
   */
  recordLogin(): void {
    const today = new Date().toDateString()
    const lastLogin = localStorage.getItem('spiritpal-last-login')
    if (lastLogin !== today) {
      this.stats.totalLoginDays++
      const yesterday = new Date(Date.now() - 86400000).toDateString()
      if (lastLogin === yesterday) {
        this.stats.consecutiveLoginDays++
      } else if (lastLogin !== today) {
        this.stats.consecutiveLoginDays = 1
      }
      localStorage.setItem('spiritpal-last-login', today)
      this.checkAchievements()
      this.save()
    }
  }

  /**
   * 更新历史最高亲密度等级
   * @param {NurturingStats} stats - 当前养成统计
   */
  updateMaxAffectionLevel(stats: NurturingStats): void {
    const lv = getAffectionLevel(stats.affection)
    if (lv > this.stats.maxAffectionLevel) {
      this.stats.maxAffectionLevel = lv
      this.checkAchievements()
      this.save()
    }
  }

  /**
   * 更新历史最高角色等级
   * @param {number} level - 角色等级
   */
  updateMaxCharacterLevel(level: number): void {
    if (level > this.stats.maxCharacterLevel) {
      this.stats.maxCharacterLevel = level
      this.checkAchievements()
      this.save()
    }
  }

  /**
   * 设置已解锁角色数量
   * @param {number} count - 角色数量
   */
  setCharactersUnlocked(count: number): void {
    this.stats.charactersUnlocked = count
    this.checkAchievements()
    this.save()
  }

  // ============ 成就检查 ============

  /** 本次新解锁的成就列表 */
  private newlyUnlocked: Achievement[] = []

  /**
   * 检查所有成就是否满足解锁条件
   * 解锁时自动发放金币奖励
   * @private
   */
  private checkAchievements(): void {
    this.newlyUnlocked = []
    for (const ach of ACHIEVEMENTS) {
      if (!this.stats.unlockedAchievements.includes(ach.id) && ach.condition(this.stats)) {
        this.stats.unlockedAchievements.push(ach.id)
        this.newlyUnlocked.push(ach)
        if (ach.reward) {
          this.stats.totalCoinsEarned += ach.reward
        }
      }
    }
  }

  /**
   * 获取并清空本次新解锁的成就列表
   * @returns {Achievement[]} 新解锁的成就
   */
  getNewlyUnlocked(): Achievement[] {
    const result = [...this.newlyUnlocked]
    this.newlyUnlocked = []
    return result
  }

  // ============ 查询 ============

  /**
   * 获取当前统计数据副本
   * @returns {AchievementStats} 统计数据
   */
  getStats(): AchievementStats {
    return { ...this.stats }
  }

  /**
   * 获取已解锁成就列表
   * @returns {Achievement[]} 已解锁成就
   */
  getUnlockedAchievements(): Achievement[] {
    return ACHIEVEMENTS.filter((a) => this.stats.unlockedAchievements.includes(a.id))
  }

  /**
   * 获取未解锁成就列表
   * @returns {Achievement[]} 未解锁成就
   */
  getLockedAchievements(): Achievement[] {
    return ACHIEVEMENTS.filter((a) => !this.stats.unlockedAchievements.includes(a.id))
  }

  /**
   * 计算指定成就的进度（0-1）
   * @param {Achievement} ach - 成就对象
   * @returns {number} 进度值（0 表示未开始，1 表示已完成）
   */
  getProgress(ach: Achievement): number {
    const s = this.stats
    switch (ach.id) {
      case 'first-click': return Math.min(1, s.totalClicks / 1)
      case 'click-100': return Math.min(1, s.totalClicks / 100)
      case 'click-500': return Math.min(1, s.totalClicks / 500)
      case 'pet-50': return Math.min(1, s.totalPets / 50)
      case 'pet-200': return Math.min(1, s.totalPets / 200)
      case 'feed-30': return Math.min(1, s.totalFeeds / 30)
      case 'play-20': return Math.min(1, s.totalPlays / 20)
      case 'bathe-10': return Math.min(1, s.totalBathes / 10)
      case 'chat-50': return Math.min(1, s.totalChats / 50)
      case 'chat-200': return Math.min(1, s.totalChats / 200)
      case 'pomodoro-1': return Math.min(1, s.totalPomodoros / 1)
      case 'pomodoro-10': return Math.min(1, s.totalPomodoros / 10)
      case 'pomodoro-50': return Math.min(1, s.totalPomodoros / 50)
      case 'pomodoro-600': return Math.min(1, s.totalPomodoroMinutes / 600)
      case 'buy-10': return Math.min(1, s.totalItemsBought / 10)
      case 'buy-50': return Math.min(1, s.totalItemsBought / 50)
      case 'use-30': return Math.min(1, s.totalItemsUsed / 30)
      case 'login-7': return Math.min(1, s.consecutiveLoginDays / 7)
      case 'login-30': return Math.min(1, s.totalLoginDays / 30)
      default: return 0
    }
  }

  // ============ 排行榜 ============

  /**
   * 获取排行榜数据
   * @returns {Array<{ name: string; value: number; unit: string }>} 排行榜数据项
   */
  getRankingData(): Array<{ name: string; value: number; unit: string }> {
    const s = this.stats
    return [
      { name: '总互动次数', value: s.totalClicks + s.totalPets + s.totalFeeds + s.totalPlays, unit: '次' },
      { name: '总聊天轮次', value: s.totalChats, unit: '轮' },
      { name: '总专注时长', value: s.totalPomodoroMinutes, unit: '分钟' },
      { name: '累计金币', value: s.totalCoinsEarned, unit: '枚' },
      { name: '最高亲密度', value: s.maxAffectionLevel, unit: '级' },
      { name: '连续登录', value: s.consecutiveLoginDays, unit: '天' },
      { name: '解锁成就', value: s.unlockedAchievements.length, unit: '个' },
    ]
  }
}

// ============ 单例 ============

/** 全局单例实例 */
let sharedManager: AchievementManager | null = null

/**
 * 获取成就管理器单例
 * @returns {AchievementManager} 成就管理器实例
 */
export function getAchievementManager(): AchievementManager {
  if (!sharedManager) {
    sharedManager = new AchievementManager()
  }
  return sharedManager
}

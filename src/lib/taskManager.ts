/**
 * @file taskManager.ts
 * @description 任务系统模块 — 专注时间追踪与每日目标管理
 *
 * 核心功能：
 * - 记录每日专注分钟数（番茄钟）
 * - 追踪连续达标天数 nDays
 * - 每日目标达标奖励机制
 * - 任务历史记录（保留最近 30 天）
 * - 每日自动重置逻辑
 *
 * - 番茄钟完成时：基础 10 金币
 * - 每日目标达标：额外奖励 = 10 × (1 + nDays × 0.2) × 达标比例
 *
 * 主要模块：
 * - TaskReward: 任务奖励接口
 * - TaskManager: 任务管理器类
 * - getTaskManager(): 获取单例实例
 * - createDefaultTaskData(): 创建默认任务数据
 * - getTodayString()/getYesterdayString(): 日期工具函数
 *
 * 依赖关系：
 * - ./types: TaskData 类型定义
 *
 * 核心接口：
 * - TaskManager.addFocusMinutes(): 记录专注时间
 * - TaskManager.setDailyGoal(): 设置每日目标
 * - TaskManager.getTodayFocusMinutes(): 获取今日专注时长
 * - TaskManager.getConsecutiveDays(): 获取连续达标天数
 */

import type { TaskData } from './types'

/** localStorage 存储键 */
const STORAGE_KEY = 'spiritpal-tasks'
/** 默认每日专注目标：2 小时（120 分钟） */
const DEFAULT_GOAL_MINUTES = 120

// ============ 工具函数 ============

/**
 * 创建默认任务数据
 * @returns 默认 TaskData 对象
 */
function createDefaultTaskData(): TaskData {
  return {
    history: [],
    goal: DEFAULT_GOAL_MINUTES,
    goalCompleted: false,
    nDays: 0,
    tasksTodo: {},
    nTasks: 0,
  }
}

/**
 * 获取今天的日期字符串（YYYY-MM-DD 格式）
 * @returns 今日日期字符串
 */
function getTodayString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * 获取昨天的日期字符串（YYYY-MM-DD 格式）
 * @returns 昨日日期字符串
 */
function getYesterdayString(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
}

// ============ 类型定义 ============

/**
 * 任务奖励接口
 */
export interface TaskReward {
  /** 奖励金币数量 */
  coins: number
  /** 奖励提示消息 */
  message: string
}

// ============ 任务管理器类 ============

/**
 * 任务管理器类
 *
 * 管理专注时间追踪、每日目标和连续达标奖励
 * 数据持久化到 localStorage
 */
export class TaskManager {
  /** 任务数据 */
  private data: TaskData
  /** 奖励回调函数（达标时调用） */
  private rewardCallback: ((reward: TaskReward) => void) | null = null
  /** 状态变化监听器集合 */
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.data = this.load()
    this.checkDailyReset()
  }

  /**
   * 设置奖励回调函数
   * @param callback 奖励触发时的回调函数
   */
  setRewardCallback(callback: (reward: TaskReward) => void): void {
    this.rewardCallback = callback
  }

  /**
   * 订阅状态变化
   * @param listener 状态变化回调函数
   * @returns 取消订阅函数
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 通知所有状态变化监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn())
  }

  /**
   * 从 localStorage 加载任务数据
   * @returns 加载的 TaskData，失败时返回默认值
   */
  private load(): TaskData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TaskData>
        return {
          ...createDefaultTaskData(),
          ...parsed,
          tasksTodo: parsed.tasksTodo ?? {},
          history: Array.isArray(parsed.history) ? parsed.history : [],
        }
      }
    } catch {
      // 解析失败使用默认值
    }
    return createDefaultTaskData()
  }

  /**
   * 保存任务数据到 localStorage 并通知监听器
   */
  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data))
    } catch {
      // 存储失败静默忽略
    }
    this.notifyListeners()
  }

  /**
   * 检查每日重置
   *
   * 逻辑：
   * 1. 如果最后记录日期既不是今天也不是昨天，重置连续天数 nDays = 0
   * 2. 如果最后记录日期不是今天，重置待办任务和目标完成状态
   */
  private checkDailyReset(): void {
    const today = getTodayString()
    const lastEntry = this.data.history[this.data.history.length - 1]

    if (lastEntry) {
      const lastDate = lastEntry[0]
      const yesterday = getYesterdayString()
      // 断签超过一天：连续天数重置
      if (lastDate !== today && lastDate !== yesterday) {
        this.data.nDays = 0
        this.data.goalCompleted = false
      }
    }

    // 新的一天：重置待办和目标完成状态
    if (lastEntry && lastEntry[0] !== today) {
      this.data.tasksTodo = {}
      this.data.goalCompleted = false
    }
  }

  /**
   * 记录专注时间（番茄钟完成时调用）
   *
   * 流程：
   * 1. 查找或创建今日记录
   * 2. 累加专注分钟数
   * 3. 检查是否达成每日目标
   * 4. 如果达成：计算连续天数、发放奖励、触发回调
   * 5. 保留最近 30 天历史
   *
   * @param minutes 专注分钟数
   * @returns 达成目标时返回 TaskReward，否则返回 null
   */
  addFocusMinutes(minutes: number): TaskReward | null {
    const today = getTodayString()
    let todayEntry = this.data.history.find(([d]) => d === today)

    if (!todayEntry) {
      todayEntry = [today, 0]
      this.data.history.push(todayEntry)
    }
    todayEntry[1] += minutes

    // 保留最近 30 天历史
    if (this.data.history.length > 30) {
      this.data.history = this.data.history.slice(-30)
    }

    let reward: TaskReward | null = null

    // 检查是否首次达成今日目标
    if (!this.data.goalCompleted && todayEntry[1] >= this.data.goal) {
      this.data.goalCompleted = true

      // 检查连续达标天数
      const yesterday = getYesterdayString()
      const yesterdayEntry = this.data.history.find(([d]) => d === yesterday)
      if (yesterdayEntry && yesterdayEntry[1] >= this.data.goal) {
        this.data.nDays += 1
      } else {
        this.data.nDays = 1
      }

      const ratio = Math.min(todayEntry[1] / this.data.goal, 1.0)
      const dailyReward = Math.round(10 * ratio * (1 + this.data.nDays * 0.2))
      reward = {
        coins: dailyReward,
        message: `达成每日专注目标！连续 ${this.data.nDays} 天，获得 ${dailyReward} 金币！`,
      }
      if (this.rewardCallback) {
        this.rewardCallback(reward)
      }
    }

    this.save()
    return reward
  }

  /**
   * 设置每日专注目标
   * @param minutes 目标分钟数（10-480 分钟，即 10 分钟到 8 小时）
   */
  setDailyGoal(minutes: number): void {
    this.data.goal = Math.max(10, Math.min(480, minutes))
    this.save()
  }

  /**
   * 获取今日专注分钟数
   * @returns 今日已专注分钟数
   */
  getTodayFocusMinutes(): number {
    const today = getTodayString()
    const entry = this.data.history.find(([d]) => d === today)
    return entry?.[1] ?? 0
  }

  /**
   * 获取连续达标天数
   * @returns 连续达标天数 nDays
   */
  getConsecutiveDays(): number {
    return this.data.nDays
  }

  /**
   * 获取当前每日目标
   * @returns 每日目标分钟数
   */
  getDailyGoal(): number {
    return this.data.goal
  }

  /**
   * 检查今日目标是否已完成
   * @returns true 表示今日已达标
   */
  isGoalCompletedToday(): boolean {
    return this.data.goalCompleted
  }

  /**
   * 获取任务数据副本
   * @returns TaskData 副本
   */
  getData(): TaskData {
    return { ...this.data }
  }

  /**
   * 重置所有任务数据到默认值
   */
  reset(): void {
    this.data = createDefaultTaskData()
    this.save()
  }

  /**
   * 销毁实例：清理监听器和回调，防止内存泄漏
   * 在切换角色或应用退出时调用
   */
  dispose(): void {
    this.listeners.clear()
    this.rewardCallback = null
    if (sharedManager === this) {
      sharedManager = null
    }
  }
}

// ============ 单例 ============

/** 全局单例实例 */
let sharedManager: TaskManager | null = null

/**
 * 获取任务管理器单例
 * @returns TaskManager 实例
 */
export function getTaskManager(): TaskManager {
  if (!sharedManager) {
    sharedManager = new TaskManager()
  }
  return sharedManager
}

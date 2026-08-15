/**
 * 气泡管理器 — 对话气泡显示、消息队列、优先级调度
 *
 * @fileoverview
 * 主要模块：
 * - MessagePriority 枚举：4 级消息优先级（Idle/Reaction/Proactive/Emergency）
 * - PriorityMessage 接口：优先级消息条目
 * - BubbleManager 类：气泡管理器（单例模式），实现双缓冲队列、优先级调度、冷却机制
 * - BUBBLE_COOLDOWN：各气泡类型冷却时间表
 *
 * 气泡类型（原始 9 种 + 扩展 8+1 种）：
 * - fv_lvlup/fv_drop: 亲密度升级/下降
 * - hp_low/hp_zero: 饱食度低/为零
 * - feed_done/feed_required: 喂食完成/需要喂食
 * - pat_focus/pat_frequent/pat_random: 摸头反应
 * - greeting/idle/hungry/sick/mood_high/mood_low/pet/feed/custom: 扩展类型
 *
 * 增强特性：
 * - HP 分层候选选择（根据饱食度段位选择不同气泡文案）
 * - USERTAG/ITEMNAME 占位符替换
 * - 倒计时气泡（如 "3 分钟后午休"）
 * - 消息双缓冲 + 优先级队列（pending 缓冲 + 4 级优先级）
 * - MIN_BUBBLE_INTERVAL_MS = 5000 控制气泡最小间隔
 *
 * @module bubbleManager
 * @requires ./types - BubbleType, NurturingStats, CharacterProfile 类型定义
 */

import type { BubbleType, NurturingStats, CharacterProfile } from './types'

// ============ 消息双缓冲配置 ============
// 参考 Live2DPet desktop-pet-system.js 的 pendingMessage 机制
// 核心思想：新消息总是覆盖 pendingMessage，确保播放最新内容

/** 最小消息间隔（毫秒）— 防止消息过于频繁 */
const MIN_MESSAGE_INTERVAL_MS = 5_000

/** 消息队列最大长度 */
const MAX_MESSAGE_QUEUE_SIZE = 3

// ============ 消息优先级 ============

/** 消息优先级（数值越大优先级越高） */
export enum MessagePriority {
  /** 空闲闲聊 */
  Idle = 0,
  /** 反应型消息（摸头、喂食等交互反馈） */
  Reaction = 1,
  /** 主动型消息（主动说话、环境感知等） */
  Proactive = 2,
  /** 紧急消息（系统警告、饱食度为零等） */
  Emergency = 3,
}

/** 优先级消息条目 */
interface PriorityMessage {
  /** 消息文本 */
  text: string
  /** 优先级 */
  priority: MessagePriority
  /** 入队时间戳 */
  timestamp: number
}

// ============ 气泡冷却时间（毫秒）============
const BUBBLE_COOLDOWN: Record<BubbleType, number> = {
  fv_lvlup: 10000,
  fv_drop: 30000,
  hp_low: 30000,
  hp_zero: 60000,
  feed_done: 5000,
  feed_required: 120000,
  pat_focus: 3000,
  pat_frequent: 8000,
  pat_random: 5000,
  // 8+1 扩展气泡冷却时间
  birthday: 60000,
  greeting: 60000,
  idle: 45000,
  hungry: 30000,
  sick: 60000,
  mood_high: 20000,
  mood_low: 30000,
  pet: 5000,
  feed: 5000,
  custom: 10000,
}

// ============ HP 分层阈值 ============
const HP_TIER = {
  DYING: 20,
  HUNGRY: 50,
  NORMAL: 80,
} as const

type BubbleCallback = (message: string) => void

// ============ 按角色管理实例（提前声明以便 dispose 访问）============
const managers = new Map<string, BubbleManager>()

// ============ 气泡类型 → 默认优先级映射 ============
const BUBBLE_PRIORITY: Record<BubbleType, MessagePriority> = {
  fv_lvlup: MessagePriority.Proactive,
  fv_drop: MessagePriority.Proactive,
  hp_low: MessagePriority.Reaction,
  hp_zero: MessagePriority.Emergency,
  feed_done: MessagePriority.Reaction,
  feed_required: MessagePriority.Proactive,
  pat_focus: MessagePriority.Reaction,
  pat_frequent: MessagePriority.Reaction,
  pat_random: MessagePriority.Idle,
  // 8+1 扩展气泡优先级
  birthday: MessagePriority.Proactive,
  greeting: MessagePriority.Proactive,
  idle: MessagePriority.Idle,
  hungry: MessagePriority.Proactive,
  sick: MessagePriority.Emergency,
  mood_high: MessagePriority.Idle,
  mood_low: MessagePriority.Reaction,
  pet: MessagePriority.Reaction,
  feed: MessagePriority.Reaction,
  custom: MessagePriority.Proactive,
}

export class BubbleManager {
  private characterId: string
  private lastTriggered: Map<BubbleType, number> = new Map()
  private onBubble: BubbleCallback | null = null
  private character: CharacterProfile | null = null
  // 双缓冲状态
  private pendingMessage: PriorityMessage | null = null
  private lastMessageTime = 0
  private currentSessionId = 0
  private isProcessing = false
  private messageQueue: PriorityMessage[] = []
  // 可取消的延迟定时器
  private delayTimer: ReturnType<typeof setTimeout> | null = null

  constructor(characterId: string) {
    this.characterId = characterId
  }

  setCharacter(profile: CharacterProfile | null): void {
    this.character = profile
  }

  setOnBubble(callback: BubbleCallback | null): void {
    this.onBubble = callback
  }

  // 获取角色专属消息或使用默认消息
  private getMessage(type: BubbleType, defaultMsg: string): string {
    if (!this.character) return defaultMsg
    const msgs = this.character.bubbleMessages
    switch (type) {
      case 'hp_low':
      case 'hp_zero':
      case 'feed_required':
      case 'hungry':
        return msgs.hungry[Math.floor(Math.random() * msgs.hungry.length)] ?? defaultMsg
      case 'feed_done':
      case 'feed':
        return msgs.feed[Math.floor(Math.random() * msgs.feed.length)] ?? defaultMsg
      case 'pat_focus':
      case 'pat_frequent':
      case 'pat_random':
      case 'pet':
        return msgs.pet[Math.floor(Math.random() * msgs.pet.length)] ?? defaultMsg
      case 'fv_lvlup':
        return '我们的关系更近了呢～❤️'
      case 'fv_drop':
        return '呜呜……你不理我了吗？'
      // 8+1 扩展气泡类型
      case 'greeting':
        return msgs.idle[Math.floor(Math.random() * msgs.idle.length)] ?? defaultMsg
      case 'idle':
        return msgs.idle[Math.floor(Math.random() * msgs.idle.length)] ?? defaultMsg
      case 'sick':
        return msgs.sad[Math.floor(Math.random() * msgs.sad.length)] ?? defaultMsg
      case 'mood_high':
        return msgs.pet[Math.floor(Math.random() * msgs.pet.length)] ?? defaultMsg
      case 'mood_low':
        return msgs.sad[Math.floor(Math.random() * msgs.sad.length)] ?? defaultMsg
      case 'custom':
        return defaultMsg
      default:
        return defaultMsg
    }
  }

  // 触发气泡（带冷却检查 + 双缓冲 + 优先级）
  trigger(type: BubbleType, customMessage?: string, priority?: MessagePriority): boolean {
    const now = Date.now()
    const cooldown = BUBBLE_COOLDOWN[type] ?? 5000
    const lastTime = this.lastTriggered.get(type) ?? 0

    if (now - lastTime < cooldown) {
      return false
    }

    this.lastTriggered.set(type, now)
    const message = customMessage ?? this.getMessage(type, '')
    if (message) {
      const msgPriority = priority ?? BUBBLE_PRIORITY[type] ?? MessagePriority.Idle
      this.enqueueMessage(message, msgPriority)
    }
    return true
  }

  // ============ 消息双缓冲实现 ============
  // 参考 Live2DPet 的 pendingMessage 机制
  // 新消息总是覆盖 pendingMessage，确保播放最新内容

  /** 入队消息（双缓冲 + 优先级队列） */
  private enqueueMessage(message: string, priority: MessagePriority = MessagePriority.Idle): void {
    const now = Date.now()
    const sessionId = this.currentSessionId
    const msg: PriorityMessage = { text: message, priority, timestamp: now }

    // 紧急消息：直接入队并发送，绕过缓冲
    if (priority === MessagePriority.Emergency) {
      this.cancelCurrentSession()
      this.lastMessageTime = 0
      this.emitBubble(message)
      this.lastMessageTime = Date.now()
      return
    }

    // 最小间隔检查
    if (now - this.lastMessageTime < MIN_MESSAGE_INTERVAL_MS) {
      // 在冷却期内，如果新消息优先级 >= pending 优先级，覆盖 pending
      if (!this.pendingMessage || priority >= this.pendingMessage.priority) {
        this.pendingMessage = msg
      }
      // 否则入队等待
      else if (this.messageQueue.length < MAX_MESSAGE_QUEUE_SIZE) {
        this.insertToQueue(msg)
      }
      return
    }

    // 双缓冲：新消息优先级 >= pending 时覆盖 pending
    if (!this.pendingMessage || priority >= this.pendingMessage.priority) {
      this.pendingMessage = msg
    } else if (this.messageQueue.length < MAX_MESSAGE_QUEUE_SIZE) {
      this.insertToQueue(msg)
    }

    // 如果未在处理，立即开始处理
    if (!this.isProcessing) {
      this.processNextMessage(sessionId)
    }
  }

  /** 按优先级插入到消息队列（保持降序，同优先级按时间升序 FIFO） */
  private insertToQueue(msg: PriorityMessage): void {
    // 队列很小（最大3），线性查找足够高效
    // 找到第一个优先级低于当前消息的位置插入；同优先级追加到后面（FIFO）
    let insertIdx = this.messageQueue.length
    for (let i = 0; i < this.messageQueue.length; i++) {
      const existing = this.messageQueue[i]!
      if (msg.priority > existing.priority) {
        insertIdx = i
        break
      }
    }
    this.messageQueue.splice(insertIdx, 0, msg)
    // 超出长度时移除优先级最低的（末尾）
    if (this.messageQueue.length > MAX_MESSAGE_QUEUE_SIZE) {
      this.messageQueue.pop()
    }
  }

  /** 处理下一条消息 */
  private async processNextMessage(sessionId: number): Promise<void> {
    // 检查 session 是否仍然有效（新消息可能已创建新 session）
    if (sessionId !== this.currentSessionId) return

    // 优先消费 pending，其次从队列取
    let message: PriorityMessage | null = this.pendingMessage
    if (!message && this.messageQueue.length > 0) {
      message = this.messageQueue.shift() ?? null
    }
    if (!message) {
      this.isProcessing = false
      return
    }

    // 消费 pending 消息
    this.pendingMessage = null
    this.isProcessing = true
    this.lastMessageTime = Date.now()

    // 发送消息（异常保护，防止回调错误中断队列处理）
    this.emitBubble(message.text)

    // 等待最小间隔后处理下一条（使用可取消的定时器）
    await new Promise<void>(resolve => {
      this.delayTimer = setTimeout(() => {
        this.delayTimer = null
        resolve()
      }, MIN_MESSAGE_INTERVAL_MS)
    })

    // 检查是否有新消息进入
    if (sessionId === this.currentSessionId && (this.pendingMessage || this.messageQueue.length > 0)) {
      this.processNextMessage(sessionId)
    } else {
      this.isProcessing = false
    }
  }

  /** 取消当前 session（新消息到来时自动调用） */
  private cancelCurrentSession(): void {
    this.currentSessionId++
    this.pendingMessage = null
    this.isProcessing = false
    // 取消待处理的延迟定时器
    if (this.delayTimer !== null) {
      clearTimeout(this.delayTimer)
      this.delayTimer = null
    }
  }

  // 重置冷却（例如切换角色时）
  resetCooldowns(): void {
    this.lastTriggered.clear()
    this.cancelCurrentSession()
  }

  /** 强制发送消息（绕过冷却和双缓冲） */
  forceMessage(message: string): void {
    this.cancelCurrentSession()
    this.lastMessageTime = 0
    this.emitBubble(message)
  }

  /**
   * 安全地触发气泡回调（异常保护，防止回调错误中断队列处理）
   */
  private emitBubble(message: string): void {
    const cb = this.onBubble
    if (!cb) return
    try {
      cb(message)
    } catch (e) {
      console.error('[BubbleManager] onBubble callback error:', e)
    }
  }

  /** 清空待发送消息 */
  clearPending(): void {
    this.pendingMessage = null
    this.messageQueue = []
  }

  /** 获取当前待发送消息文本 */
  getPendingMessage(): string | null {
    return this.pendingMessage?.text ?? null
  }

  /** 获取当前待发送消息优先级 */
  getPendingPriority(): MessagePriority | null {
    return this.pendingMessage?.priority ?? null
  }

  /** 获取队列中消息数量 */
  getQueueSize(): number {
    return this.messageQueue.length
  }

  // ============ 专用触发方法 ============

  /**
   * 发送自定义消息（带优先级）
   * 供外部模块（如 proactiveSpeak、visualPerception）使用
   *
   * @param message 消息文本
   * @param priority 消息优先级（默认 Idle）
   */
  sendMessage(message: string, priority: MessagePriority = MessagePriority.Idle): void {
    this.enqueueMessage(message, priority)
  }

  // 亲密度升级
  triggerAffectionLevelUp(customMsg?: string): void {
    this.trigger('fv_lvlup', customMsg ?? '我们的关系更近了呢～❤️')
  }

  // 喂食完成（由 UI 层调用，避免与 petStore 双重触发）
  triggerFeedDone(): void {
    // 此方法保留供外部调用，但 petStore 中不直接调用，
    // 由 PetWindow 的 handleFeed 统一通过 pickBubble 显示角色专属消息
  }

  // 检查饥饿状态自动气泡
  checkHungerBubbles(stats: NurturingStats): void {
    if (stats.hunger <= 0) {
      this.trigger('hp_zero')
    } else if (stats.hunger < HP_TIER.DYING) {
      this.trigger('hp_low')
    } else if (stats.hunger < HP_TIER.HUNGRY) {
      // 中等饥饿时偶尔提示
      if (Math.random() < 0.3) {
        this.trigger('feed_required')
      }
    }
  }

  // 连续摸头计数反应
  triggerPatReaction(patCount: number): void {
    if (patCount >= 6) {
      this.trigger('pat_frequent', '哎呀……摸太多啦！')
    } else if (patCount >= 3) {
      this.trigger('pat_focus', '嘿嘿……好舒服，继续嘛～')
    } else {
      this.trigger('pat_random')
    }
  }

  // ============ 8+1 扩展触发方法 ============

  /** 打招呼气泡（启动/切换角色时） */
  triggerGreeting(customMsg?: string): void {
    this.trigger('greeting', customMsg)
  }

  /** 空闲闲聊气泡 */
  triggerIdle(customMsg?: string): void {
    this.trigger('idle', customMsg)
  }

  /** 生病气泡 */
  triggerSick(customMsg?: string): void {
    this.trigger('sick', customMsg)
  }

  /** 心情好气泡 */
  triggerMoodHigh(customMsg?: string): void {
    this.trigger('mood_high', customMsg)
  }

  /** 心情低气泡 */
  triggerMoodLow(customMsg?: string): void {
    this.trigger('mood_low', customMsg)
  }

  /** 自定义气泡（用于倒计时、特殊事件等） */
  triggerCustom(message: string): void {
    this.trigger('custom', message)
  }

  // ============ 占位符替换 ============

  /** 占位符值类型 */
  private placeholderValues: Record<string, string> = {}

  /** 设置占位符值 */
  setPlaceholder(key: string, value: string): void {
    this.placeholderValues[key] = value
  }

  /** 替换消息中的占位符 */
  private replacePlaceholders(text: string): string {
    return text.replace(/\{(\w+)\}/g, (match, key: string) => {
      return this.placeholderValues[key] ?? match
    })
  }

  // ============ HP 分层候选选择 ============

  /** 根据饱食度段位选择最合适的气泡文案 */
  pickBubbleByHpTier(stats: NurturingStats): string | null {
    if (stats.hunger <= 0) {
      return this.getMessage('hp_zero', '')
    } else if (stats.hunger < HP_TIER.DYING) {
      return this.getMessage('hp_low', '')
    } else if (stats.hunger < HP_TIER.HUNGRY) {
      return this.getMessage('hungry', '')
    } else if (stats.mood >= 80) {
      return this.getMessage('mood_high', '')
    } else if (stats.mood < 30) {
      return this.getMessage('mood_low', '')
    } else if (stats.health <= 0) {
      return this.getMessage('sick', '')
    }
    return null
  }

  // ============ 倒计时气泡 ============

  /** 活跃倒计时列表 */
  private countdowns: Array<{
    id: string
    endTime: number
    template: string
    intervalId: ReturnType<typeof setInterval> | null
  }> = []

  /**
   * 添加倒计时气泡
   * @param id 倒计时唯一标识
   * @param endTime 结束时间戳（ms）
   * @param template 模板，{COUNTDOWN} 替换为剩余时间
   * @param intervalMs 更新间隔（默认 60000ms = 1分钟）
   */
  addCountdown(
    id: string,
    endTime: number,
    template: string = '{COUNTDOWN}后……',
    intervalMs: number = 60000,
  ): void {
    // 移除同名倒计时
    this.removeCountdown(id)

    const entry = {
      id,
      endTime,
      template,
      intervalId: null as ReturnType<typeof setInterval> | null,
    }

    // 立即显示一次
    this.updateCountdown(entry)

    // 定时更新
    entry.intervalId = setInterval(() => {
      if (Date.now() >= entry.endTime) {
        this.removeCountdown(id)
        return
      }
      this.updateCountdown(entry)
    }, intervalMs)

    this.countdowns.push(entry)
  }

  /** 移除倒计时 */
  removeCountdown(id: string): void {
    const idx = this.countdowns.findIndex((c) => c.id === id)
    if (idx >= 0) {
      const entry = this.countdowns[idx]!
      if (entry.intervalId) clearInterval(entry.intervalId)
      this.countdowns.splice(idx, 1)
    }
  }

  /** 更新倒计时气泡 */
  private updateCountdown(entry: { endTime: number; template: string }): void {
    const remaining = entry.endTime - Date.now()
    if (remaining <= 0) return

    const minutes = Math.floor(remaining / 60000)
    const countdownStr = minutes > 60
      ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
      : minutes > 0
        ? `${minutes} 分钟`
        : `${Math.floor(remaining / 1000)} 秒`

    const message = entry.template.replace('{COUNTDOWN}', countdownStr)
    this.trigger('custom', message)
  }

  /** 清理所有倒计时 */
  clearCountdowns(): void {
    for (const entry of this.countdowns) {
      if (entry.intervalId) clearInterval(entry.intervalId)
    }
    this.countdowns = []
  }

  /**
   * 销毁实例：清理所有定时器、监听器和待处理消息，并从管理Map中删除
   * 在切换角色或应用退出时调用，防止内存泄漏
   */
  dispose(): void {
    this.clearCountdowns()
    this.clearPending()
    this.cancelCurrentSession()
    if (this.delayTimer !== null) {
      clearTimeout(this.delayTimer)
      this.delayTimer = null
    }
    this.onBubble = null
    this.character = null
    this.lastTriggered.clear()
    managers.delete(this.characterId)
  }
}

export function getBubbleManager(characterId?: string): BubbleManager {
  const id = characterId ?? 'default'
  let mgr = managers.get(id)
  if (!mgr) {
    mgr = new BubbleManager(id)
    managers.set(id, mgr)
  }
  return mgr
}

// 获取当前角色的气泡管理器（便捷方法，从 petStore 读取当前角色）
export async function getCurrentBubbleManager(): Promise<BubbleManager> {
  try {
    const { usePetStore } = await import('../stores/petStore')
    const petState = usePetStore.getState()
    const currentId = petState.currentCharacterId ?? 'doro'
    return getBubbleManager(currentId)
  } catch {
    return getBubbleManager('doro')
  }
}

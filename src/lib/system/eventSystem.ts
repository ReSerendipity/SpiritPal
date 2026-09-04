/**
 * 活动系统 — 节日/联动事件驱动宠物特殊行为与限定物品
 * PRD Phase 3-4: 活动系统（节日/联动）
 * P3-28: 运营驱动功能，节日限定动画+特殊物品
 *
 * @fileoverview
 * 主要模块：
 * - EventRarity 类型：活动稀有度（common/rare/legendary）
 * - PetEvent 接口：活动定义（ID/名称/描述/类型/稀有度/日期/限定动画/气泡/物品/特效）
 * - ActiveEvent 接口：当前活动状态（剩余天数/已领取奖励）
 * - EventManager 类：活动管理器（单例），支持活动检测、活动列表、奖励领取、模组扩展
 * - EVENTS：预定义活动列表（春节/情人节/万圣节/圣诞节等）
 *
 * 设计原则：
 * 1. 纯前端：所有节日/活动数据内嵌，无需后端
 * 2. 可扩展：支持未来通过模组（.petmod）添加自定义活动
 * 3. 非侵入：活动不干扰正常使用，仅提供额外体验
 * 4. 时间安全：使用本地时间检测，活动结束后自动失效
 *
 * @module eventSystem
 */

// ============ 类型定义 ============

export type EventRarity = 'common' | 'rare' | 'legendary'

export interface PetEvent {
  /** 活动唯一标识 */
  id: string
  /** 活动名称 */
  name: string
  /** 活动描述 */
  description: string
  /** 活动类型 */
  type: 'festival' | 'seasonal' | 'milestone' | 'community'
  /** 稀有度 */
  rarity: EventRarity
  /** 开始时间（月-日，如 '01-01' 表示 1月1日） */
  startDate: string
  /** 结束时间（月-日） */
  endDate: string
  /** 活动持续天数（跨年时 endDate < startDate） */
  durationDays?: number
  /** 限定动画（宠物播放的特殊动画 ID） */
  specialAnimation?: string
  /** 限定气泡文案 */
  specialBubbles: string[]
  /** 限定物品 ID 列表（仅在活动期间可获取） */
  specialItems: string[]
  /** 宠物状态覆盖（活动期间宠物基础状态变化） */
  petStateOverride?: 'happy' | 'excited' | 'cozy'
  /** 背景特效（CSS 类名） */
  backgroundEffect?: string
  /** 是否每年重复 */
  recurring: boolean
  /** 活动图标 emoji */
  icon: string
}

export interface ActiveEvent extends PetEvent {
  /** 剩余天数 */
  daysRemaining: number
  /** 活动进度（0-1，基于时间跨度） */
  progress: number
}

// ============ 内置节日活动数据 ============

const BUILT_IN_EVENTS: PetEvent[] = [
  // === 中国传统节日 ===
  {
    id: 'spring-festival',
    name: '春节',
    description: '新年快乐！宠物穿上了喜庆的新衣服～',
    type: 'festival',
    rarity: 'legendary',
    startDate: '01-22',
    endDate: '02-05',
    specialAnimation: 'celebrate',
    specialBubbles: ['新年快乐！恭喜发财！🧧', '红包拿来～🧧', '过年啦！好开心～🎆', '祝你新的一年万事如意！✨'],
    specialItems: ['item-red-envelope', 'item-firecracker', 'item-lucky-dumpling'],
    petStateOverride: 'excited',
    backgroundEffect: 'spiritpal-festival-spring',
    recurring: true,
    icon: '🧧',
  },
  {
    id: 'lantern-festival',
    name: '元宵节',
    description: '赏花灯，吃汤圆～',
    type: 'festival',
    rarity: 'rare',
    startDate: '02-05',
    endDate: '02-06',
    specialBubbles: ['看花灯咯～🏮', '汤圆好吃～🥣', '灯谜猜猜看！✨'],
    specialItems: ['item-lantern', 'item-tangyuan'],
    recurring: true,
    icon: '🏮',
  },
  {
    id: 'dragon-boat',
    name: '端午节',
    description: '赛龙舟，吃粽子～',
    type: 'festival',
    rarity: 'rare',
    startDate: '06-09',
    endDate: '06-10',
    specialBubbles: ['粽子好香～🍙', '赛龙舟加油！🐉', '端午安康～🌿'],
    specialItems: ['item-zongzi', 'item-dragon-boat'],
    recurring: true,
    icon: '🐉',
  },
  {
    id: 'mid-autumn',
    name: '中秋节',
    description: '月圆人团圆～',
    type: 'festival',
    rarity: 'rare',
    startDate: '09-16',
    endDate: '09-18',
    specialAnimation: 'stargaze',
    specialBubbles: ['月亮好圆～🌕', '月饼真好吃！🥮', '但愿人长久～🌙'],
    specialItems: ['item-mooncake', 'item-lantern-mid'],
    petStateOverride: 'cozy',
    recurring: true,
    icon: '🌕',
  },
  {
    id: 'double-ninth',
    name: '重阳节',
    description: '登高望远～',
    type: 'festival',
    rarity: 'common',
    startDate: '10-10',
    endDate: '10-11',
    specialBubbles: ['登高望远～🏔️', '重阳安康～🍂'],
    specialItems: ['item-chrysanthemum'],
    recurring: true,
    icon: '🏔️',
  },
  // === 国际节日 ===
  {
    id: 'valentines',
    name: '情人节',
    description: '浪漫的日子～宠物也想表达爱意',
    type: 'festival',
    rarity: 'rare',
    startDate: '02-14',
    endDate: '02-15',
    specialAnimation: 'love',
    specialBubbles: ['情人节快乐！💕', '我好喜欢主人～❤️', '这是我送你的花～🌹'],
    specialItems: ['item-rose', 'item-chocolate-heart', 'item-love-letter'],
    petStateOverride: 'happy',
    backgroundEffect: 'spiritpal-festival-valentines',
    recurring: true,
    icon: '💕',
  },
  {
    id: 'halloween',
    name: '万圣节',
    description: 'Trick or Treat！宠物穿上了南瓜装～',
    type: 'festival',
    rarity: 'rare',
    startDate: '10-31',
    endDate: '11-01',
    specialAnimation: 'trick',
    specialBubbles: ['不给糖就捣蛋！🎃', '呜～吓到你了吗？👻', '南瓜灯好漂亮～🕯️'],
    specialItems: ['item-pumpkin', 'item-candy-bag', 'item-ghost-costume'],
    backgroundEffect: 'spiritpal-festival-halloween',
    recurring: true,
    icon: '🎃',
  },
  {
    id: 'christmas',
    name: '圣诞节',
    description: '圣诞老人来啦～宠物戴上了圣诞帽！',
    type: 'festival',
    rarity: 'legendary',
    startDate: '12-24',
    endDate: '12-26',
    specialAnimation: 'celebrate',
    specialBubbles: ['Merry Christmas！🎄', '圣诞老人会来吗？🎁', '铃儿响叮当～🔔', '一起装饰圣诞树吧！✨'],
    specialItems: ['item-santa-hat', 'item-gift-box', 'item-christmas-tree', 'item-candy-cane'],
    petStateOverride: 'excited',
    backgroundEffect: 'spiritpal-festival-christmas',
    recurring: true,
    icon: '🎄',
  },
  // === 季节活动 ===
  {
    id: 'cherry-blossom',
    name: '樱花季',
    description: '春暖花开，樱花纷飞～',
    type: 'seasonal',
    rarity: 'common',
    startDate: '03-20',
    endDate: '04-15',
    specialBubbles: ['樱花好美～🌸', '春天来了！🌺', '一起赏花吧～🌷'],
    specialItems: ['item-sakura', 'item-flower-crown'],
    petStateOverride: 'happy',
    backgroundEffect: 'spiritpal-season-sakura',
    recurring: true,
    icon: '🌸',
  },
  {
    id: 'summer-beach',
    name: '夏日沙滩',
    description: '炎炎夏日，去海边玩水吧～',
    type: 'seasonal',
    rarity: 'common',
    startDate: '07-01',
    endDate: '08-31',
    specialBubbles: ['好热呀～🍦', '去海边玩水吧！🏖️', '吃西瓜啦～🍉', '太阳好大！☀️'],
    specialItems: ['item-watermelon', 'item-sunscreen', 'item-beach-ball'],
    recurring: true,
    icon: '🏖️',
  },
  {
    id: 'autumn-leaves',
    name: '秋日红叶',
    description: '层林尽染，秋意渐浓～',
    type: 'seasonal',
    rarity: 'common',
    startDate: '10-01',
    endDate: '11-15',
    specialBubbles: ['红叶好美～🍁', '秋高气爽！🍂', '烤红薯好香～🍠'],
    specialItems: ['item-maple-leaf', 'item-roasted-yam'],
    petStateOverride: 'cozy',
    recurring: true,
    icon: '🍁',
  },
  {
    id: 'winter-snow',
    name: '冬日雪景',
    description: '下雪啦！一起堆雪人吧～',
    type: 'seasonal',
    rarity: 'common',
    startDate: '12-01',
    endDate: '12-23',
    specialAnimation: 'shiver',
    specialBubbles: ['下雪啦！❄️', '好冷好冷～⛄', '一起堆雪人！🌨️', '热可可真暖和～☕'],
    specialItems: ['item-snowflake', 'item-hot-cocoa', 'item-scarf'],
    recurring: true,
    icon: '❄️',
  },
  // === 里程碑活动 ===
  {
    id: 'pet-birthday',
    name: '宠物生日',
    description: '今天是宠物的生日！一起庆祝吧～',
    type: 'milestone',
    rarity: 'legendary',
    startDate: '06-01',
    endDate: '06-02',
    specialAnimation: 'celebrate',
    specialBubbles: ['生日快乐！🎂', '谢谢你一直陪着我！🥰', '吹蜡烛咯～🕯️', '许个愿望吧！✨'],
    specialItems: ['item-birthday-cake', 'item-party-hat', 'item-confetti'],
    petStateOverride: 'excited',
    backgroundEffect: 'spiritpal-milestone-birthday',
    recurring: true,
    icon: '🎂',
  },
  {
    id: 'new-year-eve',
    name: '跨年夜',
    description: '新的一年即将到来！',
    type: 'milestone',
    rarity: 'legendary',
    startDate: '12-31',
    endDate: '01-02',
    specialAnimation: 'celebrate',
    specialBubbles: ['新年倒计时！🎆', '3、2、1… 新年快乐！🎉', '新的一年，请多多关照！✨'],
    specialItems: ['item-countdown-clock', 'item-firework'],
    petStateOverride: 'excited',
    recurring: true,
    icon: '🎆',
  },
]

// ============ 活动管理器 ============

type EventListener = (events: ActiveEvent[]) => void

const CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 分钟

// ============ 单例（提前声明以便 dispose 访问）============
let eventMgr: EventSystemManager | null = null

export class EventSystemManager {
  private customEvents: PetEvent[] = []
  private listeners: Set<EventListener> = new Set()
  private checkTimer: ReturnType<typeof setTimeout> | null = null
  private lastActiveIds: Set<string> = new Set()
  /** 活跃活动缓存 */
  private cachedActiveEvents: ActiveEvent[] | null = null
  /** 缓存的月-日 */
  private cachedMonthDay: string = ''

  /** 启动定时检测（每 30 分钟检测一次活动变化） */
  start(): void {
    if (this.checkTimer !== null) return
    // 立即检测一次
    void this.checkAndNotify()
    this.scheduleNextCheck()
  }

  /** 安排下一次检查（setTimeout 链式调度，避免 setInterval 堆积） */
  private scheduleNextCheck(): void {
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer)
    }
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null
      void this.checkAndNotify().finally(() => {
        // 如果有监听器，继续调度
        if (this.listeners.size > 0 || this.customEvents.length > 0) {
          this.scheduleNextCheck()
        }
      })
    }, CHECK_INTERVAL_MS)
  }

  /** 停止定时检测 */
  stop(): void {
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer)
      this.checkTimer = null
    }
  }

  /**
   * 销毁实例：清理定时器、监听器和缓存，并重置单例
   */
  dispose(): void {
    this.stop()
    this.listeners.clear()
    this.customEvents = []
    this.lastActiveIds.clear()
    this.cachedActiveEvents = null
    eventMgr = null
  }

  /** 获取当前月-日字符串（带日级缓存） */
  private getCurrentMonthDay(): string {
    const now = new Date()
    const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (md !== this.cachedMonthDay) {
      this.cachedMonthDay = md
      this.cachedActiveEvents = null // 日期变了，缓存失效
    }
    return md
  }

  /** 获取当前活跃的活动列表 */
  getActiveEvents(): ActiveEvent[] {
    // 命中缓存
    if (this.cachedActiveEvents !== null) return this.cachedActiveEvents

    const currentMonthDay = this.getCurrentMonthDay()
    const result = [...BUILT_IN_EVENTS, ...this.customEvents]
      .filter((evt) => this.isEventActive(evt, currentMonthDay))
      .map((evt) => this.toActiveEvent(evt, currentMonthDay))

    this.cachedActiveEvents = result
    return result
  }

  /** 获取所有内置活动 */
  getAllEvents(): PetEvent[] {
    return [...BUILT_IN_EVENTS, ...this.customEvents]
  }

  /** 添加自定义活动 */
  addCustomEvent(event: PetEvent): void {
    this.customEvents.push(event)
    this.cachedActiveEvents = null // 使缓存失效
    this.notifyListeners()
  }

  /** 移除自定义活动 */
  removeCustomEvent(id: string): void {
    const before = this.customEvents.length
    this.customEvents = this.customEvents.filter((e) => e.id !== id)
    if (this.customEvents.length !== before) {
      this.cachedActiveEvents = null
      this.notifyListeners()
    }
  }

  /** 订阅活动变化 */
  onActiveEventsChange(listener: EventListener): () => void {
    this.listeners.add(listener)
    // 立即回放一次当前状态
    try {
      listener(this.getActiveEvents())
    } catch { /* 忽略 */ }
    return () => { this.listeners.delete(listener) }
  }

  /** 获取指定活动 */
  getEventById(id: string): PetEvent | undefined {
    return [...BUILT_IN_EVENTS, ...this.customEvents].find((e) => e.id === id)
  }

  /** 获取当前活跃活动的所有限定物品 ID */
  getActiveSpecialItems(): string[] {
    return this.getActiveEvents().flatMap((e) => e.specialItems)
  }

  /** 获取当前活跃活动的随机气泡文案 */
  getRandomActiveBubble(): string | null {
    const events = this.getActiveEvents()
    if (events.length === 0) return null
    // 优先选择稀有度高的活动文案
    const priorityOrder: EventRarity[] = ['legendary', 'rare', 'common']
    for (const rarity of priorityOrder) {
      const rareEvents = events.filter((e) => e.rarity === rarity)
      if (rareEvents.length > 0) {
        const evt = rareEvents[Math.floor(Math.random() * rareEvents.length)]
        return evt.specialBubbles[Math.floor(Math.random() * evt.specialBubbles.length)]
      }
    }
    return null
  }

  // ============ 内部方法 ============

  private isEventActive(evt: PetEvent, currentMd: string): boolean {
    if (!evt.recurring) {
      // 非重复活动：检查具体日期（此处简化，仅比较月-日）
    }
    // 跨年活动（如春节 01-22 到 02-05，或跨年夜 12-31 到 01-02）
    if (evt.startDate > evt.endDate) {
      // 跨年：currentMd >= startDate || currentMd <= endDate
      return currentMd >= evt.startDate || currentMd <= evt.endDate
    }
    // 常规：startDate <= currentMd <= endDate
    return currentMd >= evt.startDate && currentMd <= evt.endDate
  }

  private toActiveEvent(evt: PetEvent, _currentMd: string): ActiveEvent {
    // 计算剩余天数
    const [endM, endD] = evt.endDate.split('-').map(Number)
    const now = new Date()
    let endDate = new Date(now.getFullYear(), endM - 1, endD)
    // 如果结束日期已过但活动仍活跃（跨年情况），调整年份
    if (endDate < now && evt.startDate > evt.endDate) {
      endDate = new Date(now.getFullYear() + 1, endM - 1, endD)
    }

    const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / 86400000))

    // 计算进度
    const [startM, startD] = evt.startDate.split('-').map(Number)
    let startDate = new Date(now.getFullYear(), startM - 1, startD)
    if (startDate > now && evt.startDate > evt.endDate) {
      startDate = new Date(now.getFullYear() - 1, startM - 1, startD)
    }

    const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000))
    const elapsed = Math.max(0, Math.ceil((now.getTime() - startDate.getTime()) / 86400000))
    const progress = Math.min(1, elapsed / totalDays)

    return { ...evt, daysRemaining, progress }
  }

  private async checkAndNotify(): Promise<void> {
    const activeEvents = this.getActiveEvents()
    const currentIds = new Set(activeEvents.map((e) => e.id))

    // 检测新活动上线
    for (const id of currentIds) {
      if (!this.lastActiveIds.has(id)) {
        // 新活动上线，可以触发通知
      }
    }

    this.lastActiveIds = currentIds
    this.notifyListeners()
  }

  private notifyListeners(): void {
    const events = this.getActiveEvents()
    for (const listener of this.listeners) {
      try {
        listener(events)
      } catch { /* 忽略 */ }
    }
  }
}

export function getEventSystemManager(): EventSystemManager {
  if (!eventMgr) {
    eventMgr = new EventSystemManager()
  }
  return eventMgr
}

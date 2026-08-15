/**
 * 宠物养成系统状态管理 Store
 * @module stores/petStore
 * @description
 * 管理四维数值、经验等级、金币、背包、装饰品、背景等养成数据。
 * 使用 zustand v5 + persist 中间件，SQLite 持久化（tauri-plugin-sql）。
 *
 * 核心状态：
 * - stats: 按角色独立的养成数值（饱食度、心情、健康、亲密度、等级、经验、金币）
 * - sharedCoins: 跨角色共享金币
 * - currentCharacterId: 当前选中角色 ID
 * - inventory: 背包物品列表
 * - position: 宠物精灵窗口位置（跨角色共享）
 * - wornDecorations: 每个角色已穿戴的装饰品
 * - background: 背景自定义配置
 *
 * 核心功能：
 * - 定时 tick 数值衰减
 * - 离线衰减计算
 * - 互动操作（喂食、玩耍、洗澡、摸头、点击）
 * - 物品购买与使用
 * - 经验等级系统（升级奖励）
 * - 番茄钟奖励
 * - Buff 效果处理
 * - 装饰品穿戴
 * - 自定义角色支持
 *
 * @see {@link ../lib/types/NurturingStats} 养成数值类型定义
 * @see {@link ../lib/characters} 角色配置模块
 * @see {@link ../lib/buffManager} Buff 管理器
 * @see {@link ../lib/taskManager} 任务管理器
 * @see {@link ../lib/bubbleManager} 气泡管理器
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  NurturingStats,
  InventoryItem,
  BadgeTier,
  AnchorPoint,
  WornDecoration,
  BackgroundConfig,
  CharacterProfile,
} from '../lib/types'
import { CHARACTERS, getCharacter, getDefaultCharacter, getAllCharacters, saveCustomCharacter } from '../lib/characters'
import { getBuffManager } from '../lib/buffManager'
import { getTaskManager } from '../lib/taskManager'
import { getBubbleManager } from '../lib/bubbleManager'
import { getDialogueManager } from '../lib/dialogueManager'
import { initDB, sqliteStorage } from '../lib/db'

/**
 * 获取角色对物品的偏好倍率
 * @param characterId 角色 ID
 * @param itemId 物品 ID
 * @returns 偏好倍率（favorite ×2.0, dislike ×0.5, 其他 ×1.0）
 */
function getCharacterMultiplier(characterId: string, itemId: string): number {
  const char = getCharacter(characterId)
  if (!char) return 1.0
  if (char.favoriteItems?.includes(itemId)) return 2.0
  if (char.dislikeItems?.includes(itemId)) return 0.5
  return 1.0
}

/** 属性最大值 */
const MAX_STAT = 100
/** 属性最小值 */
const MIN_STAT = 0
/** 最大等级 */
const MAX_LEVEL = 256
/** 亲密度最大值 */
const MAX_AFFECTION = 9999
/** 七天毫秒数（离线衰减上限） */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
/** 一天毫秒数 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000

// ============ 养成数值衰减/增益常量 ============

/** 每个 tick 饥饿度衰减值 */
const TICK_HUNGER_DECAY = 2
/** 每个 tick 心情衰减值 */
const TICK_MOOD_DECAY = 1.5
/** 饥饿时健康衰减值 */
const TICK_HEALTH_DECAY_HUNGRY = 5
/** 饥饿阈值（低于此值时健康开始衰减） */
const HUNGER_THRESHOLD = 20

// ============ 互动操作增益 ============

/** 玩耍心情增益最小值 */
const PLAY_MOOD_GAIN_MIN = 20
/** 玩耍心情增益最大值 */
const PLAY_MOOD_GAIN_MAX = 30
/** 玩耍饥饿衰减 */
const PLAY_HUNGER_DECAY = 5
/** 洗澡健康增益 */
const BATHE_HEALTH_GAIN = 30
/** 洗澡心情惩罚 */
const BATHE_MOOD_PENALTY = 5
/** 摸头亲密度增益 */
const PET_AFFECTION_GAIN = 5
/** 摸头心情增益 */
const PET_MOOD_GAIN = 2
/** 点击亲密度增益 */
const CLICK_AFFECTION_GAIN = 1

// ============ 经验值增益 ============

/** 喂食经验增益 */
const FEED_EXP_GAIN = 5
/** 玩耍经验增益 */
const PLAY_EXP_GAIN = 5
/** 摸头经验增益 */
const PET_EXP_GAIN = 3
/** 点击经验增益 */
const CLICK_EXP_GAIN = 3
/** 番茄钟经验增益 */
const POMODORO_EXP_GAIN = 25
/** 番茄钟金币增益 */
const POMODORO_COIN_GAIN = 10
/** 升级金币奖励倍率（level × 此值） */
const LEVEL_UP_COIN_MULTIPLIER = 100

// ============ 离线衰减 ============

/** 离线每小时饥饿衰减 */
const OFFLINE_HUNGER_DECAY_PER_HOUR = 2
/** 离线每小时心情衰减 */
const OFFLINE_MOOD_DECAY_PER_HOUR = 1.5
/** 离线饥饿时每小时健康衰减 */
const OFFLINE_HEALTH_DECAY_PER_HOUR_HUNGRY = 5
/** 离线最小计算小时数（低于此时长不计算衰减） */
const OFFLINE_MIN_HOURS = 0.1
/** 离线健康最低值（防止掉至 0） */
const HP_OFFLINE_FLOOR = 10

/**
 * 数值限制函数
 * @param v 输入值
 * @param min 最小值
 * @param max 最大值
 * @returns 限制在 [min, max] 范围内的值
 */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * 创建默认养成数值
 * @returns 默认的 NurturingStats 对象（初始饱食/心情/健康均为 80）
 */
function createDefaultStats(): NurturingStats {
  const now = Date.now()
  return {
    hunger: 80,
    mood: 80,
    health: 80,
    affection: 0,
    level: 1,
    exp: 0,
    coins: 0,
    lastTickAt: now,
    lastInteractionAt: now,
    lastAffectionDecayAt: now,
  }
}

/** 默认数值缓存（避免重复创建对象） */
const DEFAULT_STATS_CACHE = createDefaultStats()

/**
 * 创建当前角色养成数据更新函数（统一 set 模式，消除重复代码）
 * @param currentCharacterId 当前角色 ID
 * @param setFn Zustand set 函数
 * @returns 更新函数，接收 updater 和可选的 extraUpdate
 */
function makeUpdateCurrentStats(
  currentCharacterId: string,
  setFn: (partial: (s: PetStoreState) => Partial<PetStoreState>) => void,
) {
  return (
    updater: (cur: NurturingStats) => Partial<NurturingStats>,
    extraUpdate?: (state: PetStoreState) => Partial<PetStoreState>,
  ) => {
    setFn((state) => {
      const cur = state.stats[currentCharacterId]
      if (!cur) return {}
      const updates = updater(cur)
      return {
        ...extraUpdate?.(state),
        stats: {
          ...state.stats,
          [currentCharacterId]: { ...cur, ...updates, lastInteractionAt: Date.now() },
        },
      }
    })
  }
}

/**
 * 计算离线衰减后的数值（纯函数，无副作用）
 * @param elapsed 离线时长（毫秒）
 * @param cur 当前养成数据
 * @returns 衰减后的 { hunger, mood, health }
 */
export function computeOfflineDecay(
  elapsed: number,
  cur: Pick<NurturingStats, 'hunger' | 'mood' | 'health'>,
): { hunger: number; mood: number; health: number } {
  const hours = elapsed / (1000 * 60 * 60)
  if (hours < OFFLINE_MIN_HOURS) {
    return { hunger: cur.hunger, mood: cur.mood, health: cur.health }
  }
  const hungerDecay = hours * OFFLINE_HUNGER_DECAY_PER_HOUR
  const moodDecay = hours * OFFLINE_MOOD_DECAY_PER_HOUR
  const healthDecay = cur.hunger < HUNGER_THRESHOLD ? hours * OFFLINE_HEALTH_DECAY_PER_HOUR_HUNGRY : 0
  return {
    hunger: clamp(cur.hunger - hungerDecay, MIN_STAT, MAX_STAT),
    mood: clamp(cur.mood - moodDecay, MIN_STAT, MAX_STAT),
    health: clamp(cur.health - healthDecay, HP_OFFLINE_FLOOR, MAX_STAT),
  }
}

/**
 * 计算升级所需经验值
 * @param level 当前等级
 * @returns 升到下一级所需经验值
 */
function expToNextLevel(level: number): number {
  return level * 100
}

/**
 * 宠物 Store 状态接口
 */
interface PetStoreState {
  /** 按角色 ID 索引的养成数值 */
  stats: Record<string, NurturingStats>
  /** 跨角色共享金币 */
  sharedCoins: number
  /** 当前选中的角色 ID */
  currentCharacterId: string
  /** 背包物品列表 */
  inventory: InventoryItem[]
  /** 宠物精灵在窗口内的位置（跨角色共享，持久化） */
  position: { x: number; y: number } | null
  /** 每个角色独立持有的已穿戴装饰品 */
  wornDecorations: Record<string, WornDecoration[]>
  /** 背景自定义配置 */
  background: BackgroundConfig

  /**
   * 初始化角色养成数据（若已存在则跳过）
   * @param id 角色 ID
   */
  initCharacter: (id: string) => void

  /**
   * 切换当前角色
   * @param id 目标角色 ID
   */
  switchCharacter: (id: string) => void

  /**
   * 保存宠物精灵位置
   * @param pos 位置坐标 { x, y }
   */
  setPosition: (pos: { x: number; y: number }) => void

  /**
   * 增加经验值（自动处理升级逻辑）
   * @param amount 经验值增量
   */
  addExp: (amount: number) => void

  /**
   * 喂食操作
   * @param food 食物物品
   */
  feed: (food: InventoryItem) => void

  /** 玩耍操作 */
  play: () => void

  /** 洗澡操作 */
  bathe: () => void

  /** 摸头操作 */
  pet: () => void

  /** 点击操作 */
  click: () => void

  /** 定时 tick：执行数值衰减和亲密度每日衰减 */
  tick: () => void

  /** 应用离线数值衰减（启动时调用） */
  applyOfflineDecay: () => void

  /**
   * 获取等级对应的徽章
   * @param level 等级
   * @returns 徽章等级
   */
  getBadge: (level: number) => BadgeTier

  /**
   * 获取数值对应的颜色等级
   * @param value 数值（0-100）
   * @returns 颜色等级（green/yellow/orange/red）
   */
  getColorTier: (value: number) => 'green' | 'yellow' | 'orange' | 'red'

  /**
   * 增加金币
   * @param amount 金币增量（可为负数）
   */
  addCoins: (amount: number) => void

  /**
   * 消费金币
   * @param amount 消费数量
   * @returns 是否成功（金币不足返回 false）
   */
  spendCoins: (amount: number) => boolean

  /**
   * 购买物品到背包
   * @param item 物品
   * @returns 是否购买成功
   */
  buyItem: (item: InventoryItem) => boolean

  /**
   * 使用背包中的物品
   * @param itemId 物品 ID
   */
  useItem: (itemId: string) => void

  /**
   * 获取心情倍率（影响亲密度获取）
   * @returns 心情倍率（>80: 1.5, <20: 0.5, 其他: 1.0）
   */
  getMoodMultiplier: () => number

  /**
   * 判断宠物是否生病（健康值为 0）
   * @returns 是否生病
   */
  isSick: () => boolean

  /**
   * 完成番茄钟，发放奖励
   * @param minutes 番茄钟分钟数（默认 25）
   */
  completePomodoro: (minutes?: number) => void

  /**
   * 获取当前角色的养成数值
   * @returns 当前角色的 NurturingStats
   */
  getCurrentStats: () => NurturingStats

  /**
   * 穿戴装饰品
   * @param itemId 物品 ID
   * @param anchor 锚点位置
   */
  wearDecoration: (itemId: string, anchor: AnchorPoint) => void

  /**
   * 移除已穿戴的装饰品
   * @param itemId 物品 ID
   */
  removeDecoration: (itemId: string) => void

  /**
   * 获取当前角色已穿戴的装饰品列表
   * @returns 已穿戴装饰品数组
   */
  getCurrentWornDecorations: () => WornDecoration[]

  /**
   * 设置背景配置
   * @param bg 背景配置对象
   */
  setBackground: (bg: BackgroundConfig) => void

  /**
   * 添加自定义角色（AI 创建）
   * @param profile 角色配置文件
   */
  addCustomCharacter: (profile: CharacterProfile) => void
}

/**
 * 宠物养成状态 Store Hook
 * @example
 * ```tsx
 * const stats = usePetStore(s => s.getCurrentStats())
 * const feed = usePetStore(s => s.feed)
 * ```
 */
export const usePetStore = create<PetStoreState>()(
  persist(
    (set, get) => ({
      stats: {},
      sharedCoins: 100,
      currentCharacterId: getDefaultCharacter().id,
      inventory: [],
      position: null,
      wornDecorations: {},
      background: { type: 'none' },

      initCharacter: (id) => {
        const existing = get().stats[id]
        if (existing) {
          setupBuffHandler(id, set)
          const char = getCharacter(id)
          if (char) getBubbleManager(id).setCharacter(char)
          return
        }
        set((state) => ({
          stats: { ...state.stats, [id]: createDefaultStats() },
        }))
        setupBuffHandler(id, set)

        const char = getCharacter(id)
        if (char) {
          getBubbleManager(id).setCharacter(char)
        }
      },

      switchCharacter: (id) => {
        // 允许切换到内置角色、自定义角色和模组角色
        const exists = getAllCharacters().some((c) => c.id === id)
        if (!exists) return
        if (!get().stats[id]) {
          get().initCharacter(id)
        }
        // 重置气泡冷却
        getBubbleManager(id).resetCooldowns()
        set({ currentCharacterId: id })
      },

      setPosition: (pos) => {
        set({ position: pos })
      },

      addExp: (amount) => {
        const { currentCharacterId, stats } = get()
        const cur = stats[currentCharacterId]
        if (!cur) return
        let newExp = cur.exp + amount
        let newLevel = cur.level
        let bonusStats: Partial<NurturingStats> = {}
        let leveledUp = false
        while (newLevel < MAX_LEVEL && newExp >= expToNextLevel(newLevel)) {
          newExp -= expToNextLevel(newLevel)
          newLevel += 1
          leveledUp = true
          bonusStats = {
            hunger: Math.max(cur.hunger, 80),
            mood: Math.max(cur.mood, 80),
            health: Math.max(cur.health, 80),
          }
        }
        if (newLevel >= MAX_LEVEL) {
          newLevel = MAX_LEVEL
          newExp = 0
        }
        set((state) => ({
          stats: {
            ...state.stats,
            [currentCharacterId]: {
              ...cur,
              ...bonusStats,
              exp: newExp,
              level: newLevel,
              lastInteractionAt: Date.now(),
            },
          },
        }))
        if (leveledUp) {
          getBubbleManager(currentCharacterId).triggerAffectionLevelUp()
          get().addCoins(LEVEL_UP_COIN_MULTIPLIER * newLevel)
        }
      },

      feed: (food) => {
        const { currentCharacterId, stats, sharedCoins } = get()
        const cur = stats[currentCharacterId]
        if (!cur) return
        if (sharedCoins < food.price) return
        const multiplier = getCharacterMultiplier(currentCharacterId, food.id)
        const moodGain = Math.round((food.moodRestore ?? Math.floor(Math.random() * 8) + 2) * multiplier)
        const hungerGain = Math.round((food.hungerRestore ?? 0) * multiplier)
        const updateCurrentStats = makeUpdateCurrentStats(currentCharacterId, set)
        updateCurrentStats(
          (c) => ({
            hunger: clamp(c.hunger + hungerGain, MIN_STAT, MAX_STAT),
            mood: clamp(c.mood + moodGain, MIN_STAT, MAX_STAT),
          }),
          (state) => ({ sharedCoins: state.sharedCoins - food.price }),
        )
        if (food.buff) {
          getBuffManager(currentCharacterId).applyBuff(food.buff)
        }
        get().addExp(FEED_EXP_GAIN)
        // 注意：气泡由 UI 层（PetWindow.handleFeed）统一显示，避免双重触发
      },

      play: () => {
        const { currentCharacterId, stats } = get()
        const cur = stats[currentCharacterId]
        if (!cur) return
        const moodGain =
          Math.floor(Math.random() * (PLAY_MOOD_GAIN_MAX - PLAY_MOOD_GAIN_MIN + 1)) + PLAY_MOOD_GAIN_MIN
        const updateCurrentStats = makeUpdateCurrentStats(currentCharacterId, set)
        updateCurrentStats((c) => ({
          mood: clamp(c.mood + moodGain, MIN_STAT, MAX_STAT),
          hunger: clamp(c.hunger - PLAY_HUNGER_DECAY, MIN_STAT, MAX_STAT),
        }))
        get().addExp(PLAY_EXP_GAIN)
      },

      bathe: () => {
        const { currentCharacterId, stats } = get()
        const cur = stats[currentCharacterId]
        if (!cur) return
        const updateCurrentStats = makeUpdateCurrentStats(currentCharacterId, set)
        updateCurrentStats((c) => ({
          health: clamp(c.health + BATHE_HEALTH_GAIN, MIN_STAT, MAX_STAT),
          mood: clamp(c.mood - BATHE_MOOD_PENALTY, MIN_STAT, MAX_STAT),
        }))
        get().addExp(PLAY_EXP_GAIN)
      },

      pet: () => {
        const { currentCharacterId, stats } = get()
        const cur = stats[currentCharacterId]
        if (!cur) return
        const multiplier = get().getMoodMultiplier()
        const affectionGain = Math.round(PET_AFFECTION_GAIN * multiplier)
        const updateCurrentStats = makeUpdateCurrentStats(currentCharacterId, set)
        updateCurrentStats((c) => ({
          affection: clamp(c.affection + affectionGain, 0, MAX_AFFECTION),
          mood: clamp(c.mood + PET_MOOD_GAIN, MIN_STAT, MAX_STAT),
        }))
        get().addExp(PET_EXP_GAIN)
      },

      click: () => {
        const { currentCharacterId, stats } = get()
        const cur = stats[currentCharacterId]
        if (!cur) return
        const multiplier = get().getMoodMultiplier()
        const affectionGain = Math.round(CLICK_AFFECTION_GAIN * multiplier)
        const updateCurrentStats = makeUpdateCurrentStats(currentCharacterId, set)
        updateCurrentStats((c) => ({
          affection: clamp(c.affection + affectionGain, 0, MAX_AFFECTION),
        }))
        get().addExp(CLICK_EXP_GAIN)
      },

      tick: () => {
        const { currentCharacterId, stats } = get()
        const cur = stats[currentCharacterId]
        if (!cur) return

        const buffMgr = getBuffManager(currentCharacterId)
        const isHpStopped = buffMgr.isHpStopped()
        const isFvStopped = buffMgr.isFvStopped()

        // 每日亲密度衰减（未互动时 -5，不低于 0）
        // 每天首次 tick 检查是否已过一天，若过且超过 24h 未互动则 affection -= 5
        const now = Date.now()
        let newAffection = cur.affection
        const lastDecayAt = cur.lastAffectionDecayAt ?? cur.lastTickAt ?? Date.now()
        let newLastAffectionDecayAt = lastDecayAt
        const lastDecayDay = new Date(lastDecayAt).toDateString()
        const today = new Date(now).toDateString()
        if (lastDecayDay !== today) {
          if (!isFvStopped && now - cur.lastInteractionAt >= ONE_DAY_MS) {
            newAffection = Math.max(0, cur.affection - 5)
          }
          newLastAffectionDecayAt = now
        }

        set((state) => ({
          stats: {
            ...state.stats,
            [currentCharacterId]: {
              ...cur,
              hunger: isHpStopped
                ? cur.hunger
                : clamp(cur.hunger - TICK_HUNGER_DECAY, MIN_STAT, MAX_STAT),
              mood: isFvStopped
                ? cur.mood
                : clamp(cur.mood - TICK_MOOD_DECAY, MIN_STAT, MAX_STAT),
              health:
                cur.hunger < HUNGER_THRESHOLD && !isHpStopped
                  ? clamp(cur.health - TICK_HEALTH_DECAY_HUNGRY, MIN_STAT, MAX_STAT)
                  : cur.health,
              affection: newAffection,
              lastTickAt: now,
              lastAffectionDecayAt: newLastAffectionDecayAt,
            },
          },
        }))
      },

      applyOfflineDecay: () => {
        const { currentCharacterId, stats } = get()
        const cur = stats[currentCharacterId]
        if (!cur) return
        const now = Date.now()
        const elapsed = now - cur.lastTickAt
        if (elapsed > SEVEN_DAYS_MS) {
          set((state) => ({
            stats: {
              ...state.stats,
              [currentCharacterId]: { ...cur, lastTickAt: now },
            },
          }))
          return
        }
        const decayed = computeOfflineDecay(elapsed, cur)
        set((state) => ({
          stats: {
            ...state.stats,
            [currentCharacterId]: {
              ...cur,
              hunger: decayed.hunger,
              mood: decayed.mood,
              health: decayed.health,
              lastTickAt: now,
            },
          },
        }))
      },

      getBadge: (level) => {
        if (level >= 256) return 'crown'
        if (level >= 128) return 'sun'
        if (level >= 64) return 'moon'
        if (level >= 32) return 'star'
        return 'none'
      },

      getColorTier: (value) => {
        if (value >= 80) return 'green'
        if (value >= 50) return 'yellow'
        if (value >= 20) return 'orange'
        return 'red'
      },

      addCoins: (amount) => {
        set((state) => ({ sharedCoins: Math.max(0, state.sharedCoins + amount) }))
      },

      spendCoins: (amount) => {
        const { sharedCoins } = get()
        if (sharedCoins < amount) return false
        set((state) => ({ sharedCoins: state.sharedCoins - amount }))
        return true
      },

      buyItem: (item) => {
        const { sharedCoins, inventory } = get()
        if (sharedCoins < item.price) return false
        const existing = inventory.find((i) => i.id === item.id)
        let newInventory: InventoryItem[]
        if (existing) {
          newInventory = inventory.map((i) =>
            i.id === item.id ? { ...i, count: i.count + 1 } : i,
          )
        } else {
          newInventory = [...inventory, { ...item, count: 1 }]
        }
        set({ sharedCoins: sharedCoins - item.price, inventory: newInventory })
        return true
      },

      useItem: (itemId) => {
        const { inventory, currentCharacterId, stats } = get()
        const item = inventory.find((i) => i.id === itemId)
        if (!item || item.count < 1) return
        const cur = stats[currentCharacterId]
        if (!cur) return

        const multiplier = getCharacterMultiplier(currentCharacterId, item.id)
        const updateCurrentStats = makeUpdateCurrentStats(currentCharacterId, set)

        // 基础属性恢复（食物/玩具/药品/装饰品）
        updateCurrentStats((c) => ({
          hunger: item.hungerRestore
            ? clamp(c.hunger + Math.round(item.hungerRestore * multiplier), MIN_STAT, MAX_STAT)
            : c.hunger,
          mood: item.moodRestore
            ? clamp(c.mood + Math.round(item.moodRestore * multiplier), MIN_STAT, MAX_STAT)
            : c.mood,
          health: item.healthRestore
            ? clamp(c.health + Math.round(item.healthRestore * multiplier), MIN_STAT, MAX_STAT)
            : c.health,
          // 收藏品/对话物品/副宠的亲密度奖励
          affection: item.fvReward
            ? clamp(c.affection + Math.round(item.fvReward * multiplier), 0, MAX_AFFECTION)
            : c.affection,
        }))

        // Buff 效果
        if (item.buff) {
          getBuffManager(currentCharacterId).applyBuff(item.buff)
        }

        // 对话物品：触发对话系统
        if (item.type === 'dialogue' && item.dialogueTrigger) {
          try {
            const mgr = getDialogueManager()
            // 确保对话图已注册（如果尚未注册则跳过，不报错）
            if (mgr.getGraph(item.dialogueTrigger)) {
              // 对话触发由 UI 层监听，这里仅标记触发
              // DialoguePanel 会通过事件监听显示对话
            }
          } catch {
            // 对话系统未加载，忽略
          }
        }

        // 收藏品：永久持有不消耗（maxQuantity === 1 时不移除）
        const isPermanentCollection = item.type === 'collection' && item.maxQuantity === 1

        // 消耗物品（非永久收藏品才消耗）
        if (!isPermanentCollection) {
          set((state) => {
            const newInv = state.inventory
              .map((i) => (i.id === itemId ? { ...i, count: i.count - 1 } : i))
              .filter((i) => i.count > 0)
            return { inventory: newInv }
          })
        }

        get().addExp(FEED_EXP_GAIN)
      },

      getMoodMultiplier: () => {
        const cur = get().getCurrentStats()
        if (cur.mood > 80) return 1.5
        if (cur.mood < 20) return 0.5
        return 1.0
      },

      isSick: () => {
        return get().getCurrentStats().health === 0
      },

      completePomodoro: (minutes = 25) => {
        get().addExp(POMODORO_EXP_GAIN)
        set((state) => ({ sharedCoins: state.sharedCoins + POMODORO_COIN_GAIN }))
        const taskReward = getTaskManager().addFocusMinutes(minutes)
        if (taskReward) {
          get().addCoins(taskReward.coins)
        }
      },

      getCurrentStats: () => {
        const { currentCharacterId, stats } = get()
        return stats[currentCharacterId] ?? DEFAULT_STATS_CACHE
      },

      wearDecoration: (itemId, anchor) => {
        const { currentCharacterId, inventory, wornDecorations } = get()
        const item = inventory.find((i) => i.id === itemId)
        if (!item || item.type !== 'accessory') return
        const current = wornDecorations[currentCharacterId] ?? []
        // 移除该物品已有的穿戴，并移除目标锚点上已有的装饰品（同一锚点只保留一个）
        const filtered = current.filter((d) => d.itemId !== itemId && d.anchor !== anchor)
        const newDecorations = [...filtered, { itemId, anchor }]
        set((state) => ({
          wornDecorations: { ...state.wornDecorations, [currentCharacterId]: newDecorations },
        }))
      },

      removeDecoration: (itemId) => {
        const { currentCharacterId, wornDecorations } = get()
        const current = wornDecorations[currentCharacterId] ?? []
        const filtered = current.filter((d) => d.itemId !== itemId)
        set((state) => ({
          wornDecorations: { ...state.wornDecorations, [currentCharacterId]: filtered },
        }))
      },

      getCurrentWornDecorations: () => {
        const { currentCharacterId, wornDecorations } = get()
        return wornDecorations[currentCharacterId] ?? []
      },

      setBackground: (bg) => {
        set({ background: bg })
      },

      addCustomCharacter: (profile) => {
        saveCustomCharacter(profile)
        get().initCharacter(profile.id)
      },
    }),
    {
      name: 'spiritpal-pet-store',
      storage: createJSONStorage(() => sqliteStorage),
    },
  ),
)

/**
 * Buff 效果处理器辅助函数
 * @param characterId 角色 ID
 * @param setFn Zustand set 函数
 */
function setupBuffHandler(
  characterId: string,
  setFn: (partial: Partial<PetStoreState> | ((s: PetStoreState) => Partial<PetStoreState>)) => void,
): void {
  const buffMgr = getBuffManager(characterId)
  buffMgr.setEffectHandler((effect, value) => {
    setFn((state) => {
      const cur = state.stats[characterId]
      if (!cur) return state
      const newStats = { ...cur }
      switch (effect) {
        case 'hp':
          newStats.hunger = clamp(cur.hunger + value, MIN_STAT, MAX_STAT)
          break
        case 'fv':
          newStats.affection = clamp(cur.affection + value, 0, MAX_AFFECTION)
          break
        case 'coin':
          return {
            ...state,
            sharedCoins: state.sharedCoins + value,
            stats: { ...state.stats, [characterId]: newStats },
          }
      }
      return {
        ...state,
        stats: { ...state.stats, [characterId]: newStats },
      }
    })
  })
}

// 注意：BuffManager 自带 ensureTicking() 内部定时器（每秒 tick），无需额外全局定时器。
// 旧版的 startBuffTicker() 会与 BuffManager.ensureTicking() 双重 tick，已移除。

/**
 * 初始化所有内置角色
 * - 初始化 SQLite 数据库（异步，不阻塞 UI）
 * - 为每个内置角色初始化养成数据
 * - 设置任务奖励回调
 */
export function initAllCharacters(): void {
  // 初始化 SQLite 数据库（异步）：创建表 schema + 执行 localStorage 迁移
  // 不阻塞 UI——zustand persist 会自动 await getDb() 完成后 rehydrate
  initDB().catch((e) => {
    console.error('[SpiritPal] SQLite init failed:', e)
  })

  CHARACTERS.forEach((c) => {
    usePetStore.getState().initCharacter(c.id)
  })

  getTaskManager().setRewardCallback((reward) => {
    usePetStore.getState().addCoins(reward.coins)
  })
}

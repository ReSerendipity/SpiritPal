/**
 * @file types.ts
 * @description SpiritPal 桌宠应用核心类型定义文件
 *
 * 包含模块：
 * - 精灵图集常量（ATLAS、ANIMATION_ROWS、OPENPETS_REACTION_MAP）
 * - 角色配置（Personality、SpeakingStyle、InteractionPreferences、SchedulePeriod、PersonalityConfig、CharacterProfile）
 * - 养成系统（NurturingStats、BuffConfig、InventoryItem、SubPetConfig）
 * - 装饰系统（AnchorPoint、WornDecoration、BackgroundConfig）
 * - AI 配置（AIConfig、LLMProvider）
 * - 应用状态（SharedData、AppSettings、PomodoroState、TaskData）
 * - 聊天与记忆（ChatMessage、MemoryEntry、MemoryData）
 * - 气泡类型（BubbleType）
 * - 等级徽章（BadgeTier）
 *
 * 精灵图集规范（来自 OC-Claw codexPet 格式，Phase 1.5 与 OpenPets 像素级兼容）：
 * - 8 列 × 9 行，单格 192×208，整图 1536×1872
 * - cols=8, rows=9, cellW=192, cellH=208
 *
 * 核心接口：
 * - CharacterProfile: 角色完整档案
 * - NurturingStats: 四维养成数值（饱食度/心情/健康/亲密度）
 * - InventoryItem: 背包物品
 * - ChatMessage: 聊天消息（支持 thinkContent 内心独白）
 * - AppSettings: 应用设置
 */

// ============ 精灵图集常量（来自 OC-Claw codexPet 格式）============
// 8 列 × 9 行，单格 192×208，整图 1536×1872
// Phase 1.5: 与 OpenPets (packages/pet-format) 像素级完全兼容！
// 两者均来自 codexPet 格式生态：cols=8, rows=9, cellW=192, cellH=208
// OpenPets 宠物包可直接加载到 SpiritPal（仅需反应名 → ANIMATION_ROWS 行映射）

/**
 * 标准精灵图集配置常量
 * Phase 1.5: 与 OpenPets 像素级兼容 — 8 列 × 9 行，单格 192×208
 */
export const ATLAS = { cellW: 192, cellH: 208, cols: 8, rows: 9 } as const

/**
 * 宠物可见状态机类型
 * 定义宠物所有可能的动画/行为状态
 */
export type PetState = 'idle' | 'walk' | 'sleep' | 'sit' | 'eat' | 'drag' | 'happy' | 'sad' | 'sick' | 'pet'

/**
 * 单行动画描述接口
 * 描述精灵图集中一行动画的配置
 */
export interface AnimationRow {
  /** 精灵图中的行号 */
  row: number
  /** 该行动画的帧数 */
  frames: number
}

/**
 * 动画行表常量
 * 映射动画名称到对应的精灵图行号和帧数
 * Phase 1.5: 已确认与 OpenPets (packages/pet-format) 像素级兼容
 */
export const ANIMATION_ROWS: Record<string, AnimationRow> = {
  idle: { row: 0, frames: 6 },
  walk: { row: 1, frames: 8 },
  'run-left': { row: 2, frames: 8 },
  waving: { row: 3, frames: 4 },
  jumping: { row: 4, frames: 5 },
  failed: { row: 5, frames: 8 },
  waiting: { row: 6, frames: 6 },
  running: { row: 7, frames: 6 },
  review: { row: 8, frames: 6 },
}

/**
 * OpenPets 反应名 → SpiritPal ANIMATION_ROWS 映射常量
 * 参考 OpenPets packages/client/src/protocol.ts:allowedReactions
 * OpenPets 的 11 个编码反应映射到 SpiritPal 的 9 行动画
 */
export const OPENPETS_REACTION_MAP: Record<string, string> = {
  idle: 'idle',
  thinking: 'waiting',     // 思考中 → 等待
  editing: 'running',      // 编辑中 → 运行
  testing: 'review',       // 测试中 → 审查
  success: 'jumping',      // 成功 → 跳跃
  error: 'failed',         // 错误 → 失败
  celebrating: 'waving',   // 庆祝 → 挥手
  working: 'running',      // 工作中 → 运行
  waiting: 'waiting',      // 等待 → 等待
  running: 'running',      // 运行中 → 运行
  review: 'review',        // 审查 → 审查
}

// ============ 角色五维性格 ============

/**
 * 角色五维性格接口
 * 定义角色性格的五个核心维度
 */
export interface Personality {
  /** 温度 0-1（或 -1 到 1）— 待人接物的热情程度 */
  warmth: number
  /** 活泼度 — 动作和语言的活跃程度 */
  liveliness: number
  /** 依赖度 — 对主人的依赖程度 */
  dependence: number
  /** 直率度 — 表达想法的直接程度 */
  directness: number
  /** 理性度 — 思考和决策的理性程度 */
  rationality: number
}

// ============ 说话风格 ============

/** 语气类型 */
export type Tone = 'gentle' | 'lively' | 'cold' | 'enthusiastic'  // 温柔/活泼/冷淡/热情

/** 用词偏好类型 */
export type WordPreference = 'formal' | 'colloquial' | 'internet'  // 正式/口语/网络用语

/**
 * 说话风格接口
 * 定义角色的语言表达风格
 */
export interface SpeakingStyle {
  /** 语气 */
  tone: Tone
  /** 用词偏好 */
  wordPreference: WordPreference
  /** 口头禅列表 */
  catchphrases: string[]
}

// ============ 互动偏好 ============

/** 互动频率类型 */
export type InteractionFrequency = 'high' | 'medium' | 'low'  // 喜欢互动频率

/**
 * 互动偏好接口
 * 定义角色对各类互动的喜好程度
 */
export interface InteractionPreferences {
  /** 是否喜欢被摸头 */
  likeHeadPat: boolean
  /** 是否讨厌被拖拽 */
  hateDrag: boolean
  /** 喜欢的互动频率 */
  interactionFrequency: InteractionFrequency
}

// ============ 作息时段 ============

/** 作息时段类型 */
export type ScheduleType = 'active' | 'sleep'  // 活跃/睡眠

/**
 * 作息时段接口
 * 定义角色一天中的作息安排
 */
export interface SchedulePeriod {
  /** 时段 ID */
  id: string
  /** 开始时间（0-24 小时，支持小数） */
  start: number
  /** 结束时间（0-24 小时） */
  end: number
  /** 时段类型 */
  type: ScheduleType
}

// ============ 完整性格配置（五维 + 说话风格 + 互动偏好 + 作息 + System Prompt）============

/**
 * 完整性格配置接口
 * 包含角色性格、说话风格、互动偏好、作息和系统提示词
 */
export interface PersonalityConfig {
  /** 五维性格 */
  personality: Personality
  /** 说话风格 */
  speakingStyle: SpeakingStyle
  /** 互动偏好 */
  interactionPrefs: InteractionPreferences
  /** 作息时段 */
  schedule: SchedulePeriod[]
  /** LLM System Prompt */
  systemPrompt: string
}

/**
 */
export interface CharacterProfile {
  /** 角色唯一 ID */
  id: string
  /** 角色内部名称 */
  name: string
  /** 角色显示名称 */
  displayName: string
  /** 来源游戏 */
  source: string
  /** 出生背景故事 */
  birthBackground: string
  /** 情感内核 */
  emotionalCore: string
  /** 五维性格 */
  personality: Personality
  /** 标志符号/口头禅 */
  signaturePhrase: string
  /** 经典语录列表 */
  classicQuotes: string[]
  /** LLM System Prompt */
  systemPrompt: string
  /** Few-shot 示例 */
  fewShotExamples: { user: string; assistant: string }[]
  /** 精灵图路径 */
  spriteAsset: string
  /** 精灵图类型 */
  spriteType: 'atlas' | 'svg' | 'gif' | 'video'
  /** 主题色（主色+次色） */
  themeColor: { primary: string; secondary: string }
  /** 各场景气泡消息 */
  bubbleMessages: {
    idle: string[]
    hungry: string[]
    sad: string[]
    pet: string[]
    feed: string[]
    pomodoroDone: string[]
  }
  // favoriteItems 中的物品效果 ×2.0，dislikeItems 中的物品效果 ×0.5
  /** 喜欢的物品 ID 列表（效果 ×2.0） */
  favoriteItems?: string[]
  /** 讨厌的物品 ID 列表（效果 ×0.5） */
  dislikeItems?: string[]
  // Phase 1.6: 自定义精灵图集布局（shimeji 角色为 128×128，内置角色用全局 ATLAS）
  /** 自定义精灵图集布局 */
  atlasLayout?: { cellW: number; cellH: number; cols: number; rows: number }
  // Phase 1.6: 角色类型标记（builtin / community / mod）
  /** 角色类型 */
  type?: 'builtin' | 'community' | 'mod'
  /** 金币自定义配置 */
  coinConfig?: { name: string; icon: string; description?: string }
}

// ============ 四维养成数值（每个角色独立）============

/**
 * 四维养成数值接口
 * 每个角色独立持有一套养成数值
 */
export interface NurturingStats {
  /** 饱食度 0-100 */
  hunger: number
  /** 心情 0-100 */
  mood: number
  /** 健康 0-100 */
  health: number
  /** 亲密度 0-9999 */
  affection: number
  /** 等级 1-256 */
  level: number
  /** 当前经验值 */
  exp: number
  /** 共享金币（存这里便于同步） */
  coins: number
  /** 衰减计算时间戳 */
  lastTickAt: number
  /** 上次互动时间戳 */
  lastInteractionAt: number
  /** 上次亲密度每日衰减时间戳 */
  lastAffectionDecayAt: number
  /** 喂食待渐进恢复的饱食值（VPet 式延迟恢复：立即生效 30%，剩余每秒补 1/10） */
  pendingHunger?: number
  /** 喂食待渐进恢复的心情值 */
  pendingMood?: number
}

// ============ 共享数据（跨角色）============

/**
 * 共享数据接口
 * 跨角色共享的数据（金币、背包、AI配置等）
 */
export interface SharedData {
  /** 金币数量 */
  coins: number
  /** 背包物品列表 */
  inventory: InventoryItem[]
  /** AI 配置 */
  aiConfig: AIConfig
  /** 番茄钟状态 */
  pomodoro: PomodoroState | null
  /** 应用设置 */
  settings: AppSettings
}

/**
 * Buff 配置接口
 */
export interface BuffConfig {
  /** Buff 效果类型 */
  effect: 'hp' | 'fv' | 'coin' | 'HP_stop' | 'FV_stop'
  /** 每 tick 变化量（仅 hp/fv/coin） */
  value: number
  /** tick 间隔（秒） */
  interval: number
  /** 总持续时间（秒），不填则永久 */
  expiration?: number
  /** 描述文本 */
  description: string
}

// ============ 子宠物配置（subpet 类型物品）============

/**
 * 子宠物配置接口（subpet 类型物品）
 */
export interface SubPetConfig {
  /** 子宠物精灵资源路径 */
  spritePath: string
  /** 子宠物名称 */
  name: string
  /** 子宠物大小缩放（0.5 = 半尺寸） */
  scale?: number
  /** 子宠物行为模式 */
  behavior?: 'follow' | 'wander' | 'orbit' | 'idle'
  /** 子宠物移动速度（像素/秒） */
  speed?: number
  /** 子宠物存活时间（秒），不填则永久 */
  duration?: number
  /** 子宠物互动：是否可被点击 */
  interactive?: boolean
}

// ============ 物品类型枚举 ============

/**
 * 物品类型枚举
 * 定义物品的分类，影响使用行为和商店分类
 */
export enum ItemType {
  /** 食物类（消耗品，恢复饱食度/心情） */
  FOOD = 'food',
  /** 玩具类（消耗品，恢复心情） */
  TOY = 'toy',
  /** 药品类（消耗品，恢复健康） */
  MEDICINE = 'medicine',
  /** 装饰品（可穿戴到宠物锚点） */
  ACCESSORY = 'accessory',
  /** 通用消耗品 */
  CONSUMABLE = 'consumable',
  /** 收藏品（永久持有，提供被动效果） */
  COLLECTION = 'collection',
  /** 对话书（触发特殊对话树） */
  DIALOGUE = 'dialogue',
  /** 迷你宠物（召唤独立动画实体陪伴主宠物） */
  SUBPET = 'subpet',
  /** 自动喂食道具 */
  AUTOFEED = 'autofeed',
  /** 金币类道具 */
  COIN = 'coin',
}

/**
 * 物品效果类型枚举
 * 定义物品使用时的效果类型
 */
export enum EffectType {
  /** 增加生命值（饱食度） */
  HP_INCREASE = 'hp_increase',
  /** 增加好感度（亲密度） */
  FV_INCREASE = 'fv_increase',
  /** 增加心情值 */
  MOOD_INCREASE = 'mood_increase',
  /** 增加健康值 */
  HEALTH_INCREASE = 'health_increase',
  /** 金币奖励 */
  COIN_BONUS = 'coin_bonus',
  /** Buff 持续时间延长 */
  BUFF_DURATION = 'buff_duration',
  /** 触发对话 */
  TRIGGER_DIALOGUE = 'trigger_dialogue',
  /** 召唤副宠 */
  SUMMON_SUBPET = 'summon_subpet',
  /** 无效果（纯收藏） */
  NONE = 'none',
}

/**
 * 物品稀有度类型
 */
export type ItemRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'

/**
 * 背包物品接口
 */
export interface InventoryItem {
  /** 物品唯一 ID */
  id: string
  /** 物品名称 */
  name: string
  /** 物品图标路径 */
  icon: string
  /** 物品类型 */
  type: ItemType | 'food' | 'toy' | 'medicine' | 'accessory' | 'consumable' | 'collection' | 'dialogue' | 'subpet' | 'autofeed' | 'coin'
  /** 饱食度恢复量 */
  hungerRestore?: number
  /** 心情恢复量 */
  moodRestore?: number
  /** 健康恢复量 */
  healthRestore?: number
  /** 物品价格 */
  price: number
  /** 物品数量 */
  count: number
  // fvLock 直接影响价格：cost = 50 × (fvLock + 1)
  /** 解锁所需亲密度等级（0-5），即稀有度 */
  fvLock?: number
  /** 随机掉落权重（0-1） */
  dropRate?: number
  /** 物品描述 */
  description?: string
  /** 关联 Buff */
  buff?: BuffConfig
  /** 角色限制 — 仅指定角色 ID 可使用 */
  petLimit?: string[]
  /** 使用时奖励的亲密度值 */
  fvReward?: number
  /** dialogue 类型物品使用时触发的对话 ID */
  dialogueTrigger?: string
  /** subpet 类型物品的配置 */
  subpetConfig?: SubPetConfig
  /** 最大持有数量（收藏类通常=1） */
  maxQuantity?: number
  /** 稀有度标签 */
  rarity?: ItemRarity
  /** 是否通过成就解锁 */
  unlockable?: boolean
  /** 搜索标签 */
  tags?: string[]
}

// ============ 装饰品锚点叠加系统 ============
// 装饰品可穿戴到宠物身上的锚点位置

/**
 * 装饰品锚点类型
 * 定义装饰品可穿戴到宠物身上的位置
 */
export type AnchorPoint = 'head' | 'body' | 'hand_left' | 'hand_right' | 'back'

/**
 * 已穿戴的装饰品接口
 * 每个角色独立持有一组已穿戴装饰品
 */
export interface WornDecoration {
  /** 物品 ID */
  itemId: string
  /** 锚点位置 */
  anchor: AnchorPoint
  /** 偏移量 */
  offset?: { x: number; y: number }
}

// ============ 背景自定义 ============

/** 背景类型 */
export type BackgroundType = 'none' | 'solid' | 'gradient' | 'image'

/**
 * 背景配置接口
 */
export interface BackgroundConfig {
  /** 背景类型 */
  type: BackgroundType
  /** 纯色/渐变色起始色 */
  color?: string
  /** 渐变色结束色 */
  color2?: string
  /** 渐变方向 */
  direction?: string
  /** 背景图片路径 */
  imagePath?: string
}

/**
 * AI 配置接口
 */
export interface AIConfig {
  /** LLM 服务商 ID */
  provider: string
  /** API Key */
  apiKey: string
  /** API Base URL */
  baseUrl: string
  /** 模型名称 */
  model: string
  /** 温度参数 */
  temperature: number
  /** 最大 Token 数 */
  maxTokens: number
}

/**
 * 番茄钟状态接口
 */
export interface PomodoroState {
  /** 是否正在运行 */
  active: boolean
  /** 持续时间（秒） */
  duration: number
  /** 开始时间戳 */
  startedAt: number
  /** 已完成番茄数 */
  completedCount: number
}

/**
 * 应用设置接口
 */
export interface AppSettings {
  /** 宠物大小缩放（0.5 - 2.0） */
  petSize: number
  /** 宠物透明度（0.5 - 1.0） */
  petOpacity: number
  /** 开机自启 */
  autoStart: boolean
  /** 启动时最小化 */
  startMinimized: boolean
  /** 是否启用通知 */
  notifications: boolean
  /** 界面语言 */
  language: 'zh' | 'en' | 'ja' | 'ko' | 'zh-TW'
  /** 宠物界面形态：窗口 / 桌面漫游 */
  petForm: 'window' | 'roam'
  /** 当前角色 ID */
  currentCharacterId: string
  /** 显示窗口边框预览（调试用：虚线框标出宠物窗口的实际边界与尺寸） */
  showWindowBorder: boolean
}

// ============ 聊天消息 ============

/**
 * 聊天消息接口
 */
export interface ChatMessage {
  /** 消息唯一 ID */
  id: string
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system'
  /** 消息内容 */
  content: string
  /** 时间戳 */
  timestamp: number
  /** 是否正在流式输出 */
  isStreaming?: boolean
  // 角色一致性校验相关字段
  /** 用户标记该消息不符性格 */
  flagged?: boolean
  /** 校验检测到的冲突关键词列表 */
  consistencyViolations?: string[]
  // Phase 1.4: Think 标签解析结果（内心独白），不送 TTS
  /** <think> 标签内的思考内容（半透明折叠显示，不送 TTS） */
  thinkContent?: string
}

/**
 * 记忆条目接口
 */
export interface MemoryEntry {
  /** 创建时间（ISO 字符串） */
  created_at: string
  /** 用户消息 */
  user: string
  /** AI 回复 */
  assistant: string
}

/**
 * 记忆数据接口
 */
export interface MemoryData {
  /** 数据版本 */
  version: number
  /** 记忆摘要 */
  summary: string
  /** 记忆条目列表 */
  entries: MemoryEntry[]
  /** 压缩时间 */
  compressed_at?: string
}

/**
 * LLM 服务商预设接口
 */
export interface LLMProvider {
  /** 服务商 ID */
  id: string
  /** 服务商名称 */
  name: string
  /** API Base URL */
  baseUrl: string
  /** 默认模型 */
  defaultModel: string
  /** 支持的模型列表 */
  models: string[]
  /** 是否需要 API Key（Ollama 本地服务为 false，其余默认 true） */
  apiKeyRequired?: boolean
}

// ============ 等级徽章 ============
// 对应 PRD：Lv32 ⭐ / Lv64 🌙 / Lv128 ☀️ / Lv256 👑

/**
 * 等级徽章类型
 * 对应 PRD：Lv32 ⭐ / Lv64 🌙 / Lv128 ☀️ / Lv256 👑
 */
export type BadgeTier = 'none' | 'star' | 'moon' | 'sun' | 'crown'

/**
 * 任务数据接口
 */
export interface TaskData {
  /** 历史记录：[[日期字符串, 专注分钟数]] */
  history: [string, number][]
  /** 每日专注目标（分钟） */
  goal: number
  /** 今日目标是否已完成 */
  goalCompleted: boolean
  /** 连续达标天数 */
  nDays: number
  /** 待办任务：{ taskId: { text, done } } */
  tasksTodo: Record<string, { text: string; done: boolean }>
  /** 累计完成任务数 */
  nTasks: number
}

/**
 * 气泡类型枚举
 */
export type BubbleType =
  | 'fv_lvlup'       // 亲密度升级
  | 'fv_drop'        // 亲密度下降
  | 'hp_low'         // 饱食度低
  | 'hp_zero'        // 饱食度为零
  | 'feed_done'      // 喂食完成
  | 'feed_required'  // 需要喂食
  | 'pat_focus'      // 摸头专注
  | 'pat_frequent'   // 频繁摸头
  | 'pat_random'     // 随机摸头
  | 'birthday'       // 生日祝福
  | 'greeting'       // 打招呼
  | 'idle'           // 空闲闲聊
  | 'hungry'         // 饥饿提示
  | 'sick'           // 生病提示
  | 'mood_high'      // 心情好
  | 'mood_low'       // 心情低
  | 'pet'            // 被摸头
  | 'feed'           // 被喂食
  | 'custom'         // 自定义气泡（如倒计时等）

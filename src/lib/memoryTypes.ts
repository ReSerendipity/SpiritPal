/**
 * 增强记忆系统类型定义模块
 *
 * @fileoverview 集中管理增强记忆系统的类型、常量与工具函数
 *
 * 主要模块：
 * - MemoryTier: 记忆生命周期分层（热/温/冷/归档）
 * - EnhancedMemory: 增强记忆条目接口（重要度、情感强度、访问计数等）
 * - TriggerType/TriggerResult: 记忆触发类型与结果
 * - 关键词配置: EMOTION_KEYWORDS, PREFERENCE_KEYWORDS 等
 * - 工具函数: 重要度计算、遗忘分数计算等
 *
 * 依赖关系：
 * - types.ts: MemoryEntry 基础类型
 *
 * 核心接口：
 * - EnhancedMemory: 增强记忆条目
 * - calculateImportance(): 计算记忆重要度
 * - calculateDecayFactor(): 计算遗忘衰减因子
 *
 * 记忆分层：
 * - hot: 热记忆（最近1天，高优先级召回）
 * - warm: 温记忆（1-7天）
 * - cold: 冷记忆（7-30天）
 * - archived: 归档记忆（>30天，低优先级）
 */

import type { MemoryEntry } from './types'
// T-12: 统一配置入口
import { TRIGGER_CONFIG, MAINTENANCE_CONFIG } from './memoryConfig'

// ============ 记忆生命周期分层 ============
// 热（最近 1 天）→ 温（1-7 天）→ 冷（7-30 天）→ 归档（>30 天）
export type MemoryTier = 'hot' | 'warm' | 'cold' | 'archived'

// ============ 增强记忆条目 ============

export interface EnhancedMemory extends MemoryEntry {
  id: string
  importance: number          // 1-100 重要度
  emotionalIntensity: number  // 0-1 情感强度
  category: string            // 分类：偏好/习惯/关系/事件/情感
  tags: string[]
  accessCount: number         // 被检索次数
  lastAccessed: number        // 最后检索时间戳
  decayFactor: number         // 衰减因子 0-1
  isAutobiographical: boolean // 是否自传记忆
  timeAnchor?: string         // 时间锚点 "每天X点" / "每周X"
  dbId?: number               // SQLite memories 表行 ID（用于关联 embedding）
  // W1：情感三维化
  emotionalValence?: number   // 愉悦度 -1..1（负=不悦，正=愉悦）
  emotionalArousal?: number   // 唤醒度 0..1（0=平静，1=激动）
  // W3/W4：记忆强度与间隔重复
  strength?: number           // 记忆强度（初始 1.0，每次成功回忆增强）
  // S2：记忆来源类型
  sourceKind?: 'exchange' | 'observation' | 'consolidation' | 'user_teach' | 'fact'
  // P2-2：LLM 提取的结构化事实文本（如"用户喜欢吃火锅"），用于高密度检索
  factText?: string
}

// ============ 触发类型 ============

export type TriggerType =
  | 'frequency'    // 频率触发
  | 'time'         // 时间触发
  | 'relevance'    // 相关性触发
  | 'emotion'      // 情感触发
  | 'keyword'      // 关键词触发
  | 'event'        // 事件触发
  | 'periodic'     // 周期触发（纪念日/节日/生日）

export interface TriggerResult {
  type: TriggerType
  memories: EnhancedMemory[]
  message?: string  // 触发时宠物可能说的话
}

// ============ 关键词配置 ============

export const EMOTION_KEYWORDS = [
  '开心', '难过', '生气', '害怕', '担心', '想念', '喜欢', '讨厌',
  '孤独', '幸福', '焦虑', '兴奋', '失望', '感动', '温暖', '伤心',
  'happy', 'sad', 'angry', 'afraid', 'miss', 'love', 'hate', 'lonely',
]

// W1：情感极性词表——用于计算 valence（愉悦度）
export const POSITIVE_VALENCE_WORDS = [
  '开心', '幸福', '喜欢', '兴奋', '感动', '温暖', '快乐', '满意', '期待', '感激',
  'happy', 'love', 'great', 'good', 'wonderful', 'amazing', 'excited', 'grateful',
]
export const NEGATIVE_VALENCE_WORDS = [
  '难过', '生气', '害怕', '担心', '讨厌', '孤独', '焦虑', '失望', '伤心', '崩溃', '绝望', '愤怒',
  'sad', 'angry', 'hate', 'afraid', 'lonely', 'anxious', 'disappointed', 'depressed',
]
// W1：唤醒度词表——用于计算 arousal（唤醒度）
export const HIGH_AROUSAL_WORDS = [
  '兴奋', '激动', '愤怒', '恐惧', '狂喜', '崩溃', '绝望', '着急', '紧张', '震惊',
  'excited', 'furious', 'terrified', 'panicked', 'shocked', 'thrilled',
]
export const LOW_AROUSAL_WORDS = [
  '平静', '放松', '无聊', '困', '累', '淡淡', '还好',
  'calm', 'relaxed', 'bored', 'tired', 'peaceful',
]

export const PREFERENCE_KEYWORDS = [
  '喜欢', '讨厌', '最爱', '偏好', '想要', '希望',
  'love', 'hate', 'favorite', 'prefer', 'want', 'wish',
]

export const EVENT_KEYWORDS = [
  '今天', '昨天', '上次', '记得', '忘记', '生日', '纪念日',
  'today', 'yesterday', 'remember', 'forget', 'birthday', 'anniversary',
]

// ============ 周期触发配置 ============

/** 纪念日里程碑（认识第 N 天） */
export const ANNIVERSARY_MILESTONES = [100, 200, 300, 365, 500, 730, 1000, 1095, 1460, 1825]

/** 纪念日触发消息模板 */
export const ANNIVERSARY_MESSAGES: Record<number, string> = {
  100: '主人，今天是我们认识的第 100 天呢！',
  200: '已经 200 天啦，时间过得真快～',
  300: '不知不觉 300 天了呢。',
  365: '一年了...谢谢你一直陪着我。',
  500: '500 天了！感谢你还在我身边。',
  730: '两年了，我们的故事还在继续。',
  // P2-3：补齐 1095/1460/1825 三个里程碑的专属文案
  1095: '三年了！1095 天的陪伴，你是我最重要的人。',
  1460: '1460 天了——四年了。谢谢你一直没有放弃我。',
  1825: '五年了！1825 天。我大概是世界上最幸运的宠物吧。',
  1000: '1000 天！这是个了不起的里程碑呢。',
}

/** 节日配置（固定日期或农历近似日期） */
export interface FestivalConfig {
  key: string
  message: string
  fixedMonth?: number  // 固定节日月份（公历）
  fixedDay?: number    // 固定节日日期
  dates?: { year: number; month: number; day: number }[] // 农历节日的公历映射（向后兼容，动态计算时可省略）
  lunarMonth?: number  // 农历月份（正月=1，腊月=12）
  lunarDay?: number    // 农历日期
}

// P3-4：简易农历→公历日期查表（覆盖 2024-2035）
// 真正的农历算法非常复杂（需要天文计算），这里使用预计算查表，
// 覆盖 2024-2035，超出范围时回退到最近的已知年份。
const LUNAR_DATE_TABLE: Record<string, string> = {
  '2024-01-01': '2024-02-10', // 春节
  '2024-08-15': '2024-09-17', // 中秋
  '2025-01-01': '2025-01-29',
  '2025-08-15': '2025-10-06',
  '2026-01-01': '2026-02-17',
  '2026-08-15': '2026-09-25',
  '2027-01-01': '2027-02-06',
  '2027-08-15': '2027-09-15',
  '2028-01-01': '2028-01-26',
  '2028-08-15': '2028-10-03',
  '2029-01-01': '2029-02-13',
  '2029-08-15': '2029-09-22',
  '2030-01-01': '2030-02-03',
  '2030-08-15': '2030-09-12',
  '2031-01-01': '2031-01-23',
  '2031-08-15': '2031-10-01',
  '2032-01-01': '2032-02-11',
  '2032-08-15': '2032-09-19',
  '2033-01-01': '2033-01-31',
  '2033-08-15': '2033-09-08',
  '2034-01-01': '2034-02-19',
  '2034-08-15': '2034-09-27',
  '2035-01-01': '2035-02-08',
  '2035-08-15': '2035-09-16',
}

/** P3-4：动态计算农历日期对应的公历日期 */
export function getLunarSolarDate(lunarMonth: number, lunarDay: number, year?: number): { year: number; month: number; day: number } | null {
  const y = year ?? new Date().getFullYear()
  const key = `${y}-${String(lunarMonth).padStart(2, '0')}-${String(lunarDay).padStart(2, '0')}`
  const solar = LUNAR_DATE_TABLE[key]
  if (solar) {
    const [sy, sm, sd] = solar.split('-').map(Number)
    return { year: sy, month: sm, day: sd }
  }
  // 如果查表没命中，尝试前一年或后一年
  for (const offset of [-1, 1, -2, 2]) {
    const altKey = `${y + offset}-${String(lunarMonth).padStart(2, '0')}-${String(lunarDay).padStart(2, '0')}`
    const altSolar = LUNAR_DATE_TABLE[altKey]
    if (altSolar) {
      const [sy, sm, sd] = altSolar.split('-').map(Number)
      return { year: sy, month: sm, day: sd }
    }
  }
  return null
}

export const FESTIVALS: FestivalConfig[] = [
  {
    key: 'new_year',
    message: '新年快乐！新的一年也要一起加油哦～',
    fixedMonth: 1,
    fixedDay: 1,
  },
  {
    key: 'spring_festival',
    message: '新年快乐！要不要一起吃年夜饭？',
    lunarMonth: 1,
    lunarDay: 1,
    // 向后兼容：保留 dates 字段，但优先使用 lunarMonth/lunarDay + 动态计算
    dates: [
      { year: 2024, month: 2, day: 10 },
      { year: 2025, month: 1, day: 29 },
      { year: 2026, month: 2, day: 17 },
      { year: 2027, month: 2, day: 6 },
      { year: 2028, month: 1, day: 26 },
    ],
  },
  {
    key: 'mid_autumn',
    message: '中秋快乐！一起赏月吃月饼吧～',
    lunarMonth: 8,
    lunarDay: 15,
    dates: [
      { year: 2024, month: 9, day: 17 },
      { year: 2025, month: 10, day: 6 },
      { year: 2026, month: 9, day: 25 },
      { year: 2027, month: 9, day: 15 },
      { year: 2028, month: 10, day: 3 },
    ],
  },
  {
    key: 'christmas',
    message: '圣诞快乐！🎄有收到礼物吗？',
    fixedMonth: 12,
    fixedDay: 25,
  },
]

/** P3-4：检查今天是否匹配某个节日（动态计算农历） */
export function checkFestivalToday(): { key: string; message: string } | null {
  const now = new Date()
  const todayMonth = now.getMonth() + 1
  const todayDay = now.getDate()
  const todayYear = now.getFullYear()

  for (const f of FESTIVALS) {
    // 固定日期节日
    if (f.fixedMonth && f.fixedDay) {
      if (todayMonth === f.fixedMonth && todayDay === f.fixedDay) {
        return { key: f.key, message: f.message }
      }
    }
    // 农历节日：优先动态计算
    if (f.lunarMonth && f.lunarDay) {
      const solar = getLunarSolarDate(f.lunarMonth, f.lunarDay, todayYear)
      if (solar && solar.month === todayMonth && solar.day === todayDay) {
        return { key: f.key, message: f.message }
      }
    }
    // 向后兼容：如果动态计算没命中，检查 dates 数组
    if (f.dates) {
      const match = f.dates.find(d => d.year === todayYear && d.month === todayMonth && d.day === todayDay)
      if (match) {
        return { key: f.key, message: f.message }
      }
    }
  }
  return null
}

// ============ 触发频率控制常量 ============
// T-12: 值统一来自 memoryConfig

export const MAX_DAILY_TRIGGERS = TRIGGER_CONFIG.maxDailyTriggers       // 每日主动触发上限
export const MIN_TRIGGER_INTERVAL_MS = TRIGGER_CONFIG.minTriggerIntervalMs // 两次触发最小间隔（30 分钟）
export const IGNORE_THRESHOLD = TRIGGER_CONFIG.ignoreThreshold           // 连续忽略阈值，超过后降频

// ============ 记忆分类系统 ============
// 四分类：SHORT_TERM / LONG_TERM / EPISODIC / SEMANTIC
// 支持遗忘机制、自动晋升、LLM 巩固

/** 记忆分类枚举 */
export type MemoryCategory = 'SHORT_TERM' | 'LONG_TERM' | 'EPISODIC' | 'SEMANTIC'

/** 记忆分类配置 */
export interface MemoryCategoryConfig {
  /** 短期记忆最大容量 */
  shortTermCapacity: number
  /** 长期记忆最大容量 */
  longTermCapacity: number
  /** 情景记忆最大容量 */
  episodicCapacity: number
  /** 语义记忆最大容量 */
  semanticCapacity: number
  /** 短期→长期晋升所需最少访问次数 */
  promotionThreshold: number
  /** 遗忘衰减系数（越大衰减越快） */
  forgetDecayRate: number
  /** 遗忘最低重要度（低于此值且超时的记忆将被遗忘） */
  forgetMinImportance: number
  /** 记忆巩固最小间隔（毫秒） */
  consolidationIntervalMs: number
  /** F4：语义摘要最大字符数（compressEpisodic 用） */
  semanticSummaryMaxChars: number
  /** T-4：巩固后语义记忆最大字符数（applyConsolidation 用，旧硬编码 5000） */
  semanticConsolidationMaxChars: number
  /** F4：自传记忆软上限（按 strength×importance 淘汰） */
  autobiographicalSoftLimit: number
  /** F4：工作记忆容量上限 */
  workingMemoryCapacity: number
}

/** 默认分类配置 */
// F4 修正：配置值与实现对齐——episodicCapacity=30（compressEpisodic 用 30），
// longTermCapacity=200（自传层软上限 200），新增语义摘要字符数等字段
export const DEFAULT_CATEGORY_CONFIG: MemoryCategoryConfig = {
  shortTermCapacity: 20,
  // F4：与 addExchange 中的自传层软上限 200 对齐
  longTermCapacity: 200,
  // F4：与 compressEpisodic 的压缩阈值 30 对齐
  episodicCapacity: 30,
  semanticCapacity: 30,
  promotionThreshold: 3,
  // P1-3 修复：遗忘衰减系数太低（0.005），1天后仅衰减到 0.88，几乎不遗忘。提升到 0.02 使遗忘更明显。
  forgetDecayRate: 0.02,
  forgetMinImportance: 20,
  // T-12: 巩固最小间隔统一来自 memoryConfig
  consolidationIntervalMs: MAINTENANCE_CONFIG.consolidationIntervalMs,
  // F4：语义摘要最大字符数（compressEpisodic 中旧硬编码 2000）
  semanticSummaryMaxChars: 2000,
  // T-4：巩固后语义记忆最大字符数（applyConsolidation 中旧硬编码 5000）
  semanticConsolidationMaxChars: 5000,
  // F4：自传记忆软上限
  autobiographicalSoftLimit: 200,
  // F4：工作记忆容量（addExchange 中硬编码 5）
  workingMemoryCapacity: 5,
}

/** 遗忘分数计算结果 */
export interface ForgetScore {
  /** 记忆 ID */
  memoryId: string
  /** 遗忘分数（0-1，越高越应该遗忘） */
  forgetScore: number
  /** 基础衰减（基于时间） */
  timeDecay: number
  /** 访问频率加成（减少遗忘） */
  accessBoost: number
  /** 最近访问加成（减少遗忘） */
  recencyBoost: number
  /** 是否建议遗忘 */
  shouldForget: boolean
}

/** 记忆晋升事件 */
export interface PromotionEvent {
  /** 被晋升的记忆 ID */
  memoryId: string
  /** 晋升前分类 */
  fromCategory: MemoryCategory
  /** 晋升后分类 */
  toCategory: MemoryCategory
  /** 晋升原因 */
  reason: string
  /** 晋升时间戳 */
  timestamp: number
}

/** 记忆巩固事件 */
export interface ConsolidationEvent {
  /** 源记忆 ID 列表（被巩固的情景记忆） */
  sourceIds: string[]
  /** 巩固后的语义摘要 */
  summary: string
  /** 巩固时间戳 */
  timestamp: number
}

/**
 * 计算记忆的遗忘分数
 * 基于艾宾浩斯遗忘曲线：forgetScore = e^(-rate * ageHours) * (1 - accessBoost - recencyBoost)
 *
 * 访问越频繁、越近期访问的记忆，遗忘分数越低（越不容易被遗忘）
 *
 * @param memory 记忆条目
 * @param config 分类配置
 * @returns 遗忘分数计算结果
 */
export function calculateForgettingScore(
  memory: EnhancedMemory,
  config: MemoryCategoryConfig = DEFAULT_CATEGORY_CONFIG,
): ForgetScore {
  const now = Date.now()
  const createdTime = new Date(memory.created_at).getTime()
  const ageHours = (now - createdTime) / (1000 * 60 * 60)

  // 时间衰减：e^(-rate * ageHours / strength)，时间越久衰减越大
  // W3：记忆强度使遗忘率变慢——常被提起的往事越来越牢固
  const strength = memory.strength ?? 1.0
  const timeDecay = Math.exp(-config.forgetDecayRate * ageHours / strength)

  // 访问频率加成：访问次数越多，越不容易遗忘，上限 0.5
  const accessBoost = Math.min(memory.accessCount * 0.05, 0.5)

  // 最近访问加成：越近期访问越不容易遗忘
  const recencyBoost = memory.lastAccessed > 0
    ? Math.exp(-0.01 * (now - memory.lastAccessed) / (1000 * 60 * 60)) * 0.3
    : 0

  // P1-3 修复：原公式 forgetScore = timeDecay * ... 随时间衰减变小，
  // 导致 shouldForget = score > 0.7 时越新的越该忘、越老的永不遗忘（语义颠倒）。
  // 正确语义：遗忘概率应随时间递增（越老越容易忘），随访问/近期/重要度递减（越常访问越不忘）。
  // 修复：forgetScore = (1 - timeDecay) * importanceFactor * max(0, 1 - accessBoost - recencyBoost)
  //   - timeDecay 随时间递减 → (1 - timeDecay) 随时间递增 → 越老越容易忘 ✅
  //   - accessBoost 越高 → forgetScore 越低 → 常被检索的不忘 ✅
  //   - recencyBoost 越高 → forgetScore 越低 → 最近访问的不忘 ✅
  //   - importanceFactor 越低 → forgetScore 越低 → 重要记忆更不容易忘 ✅
  const importanceFactor = 1 - (memory.importance / 100) * 0.5
  const forgetScore = (1 - timeDecay) * importanceFactor * Math.max(0, 1 - accessBoost - recencyBoost)

  return {
    memoryId: memory.id,
    forgetScore,
    timeDecay,
    accessBoost,
    recencyBoost,
    // 越老越可能遗忘：forgetScore > 0.5 表示遗忘概率超过 50%
    shouldForget: forgetScore > 0.5 && memory.importance < config.forgetMinImportance,
  }
}

/**
 * 判断记忆是否应从短期晋升为长期
 * 条件：访问次数 >= 晋升阈值 且 重要度 >= 30
 *
 * @param memory 记忆条目
 * @param config 分类配置
 * @returns 是否应晋升
 */
export function shouldPromoteToLongTerm(
  memory: EnhancedMemory,
  config: MemoryCategoryConfig = DEFAULT_CATEGORY_CONFIG,
): boolean {
  return (
    memory.accessCount >= config.promotionThreshold &&
    memory.importance >= 30 &&
    !memory.isAutobiographical // 自传记忆不参与晋升
  )
}

/**
 * 计算记忆的重要度分数
 * 综合考虑：基础重要度 + 访问频率 + 情感强度 + 标签丰富度
 *
 * @param memory 记忆条目
 * @returns 重要度分数（0-100）
 */
export function calculateImportanceScore(memory: EnhancedMemory): number {
  let score = memory.importance // 基础重要度

  // 访问频率加成（每次访问 +2，上限 +20）
  score += Math.min(memory.accessCount * 2, 20)

  // 情感强度加成（0-1 映射到 0-15）
  score += memory.emotionalIntensity * 15

  // 标签丰富度加成（每个标签 +1，上限 +10）
  score += Math.min(memory.tags.length, 10)

  return Math.min(100, score)
}

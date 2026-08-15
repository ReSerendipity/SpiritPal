/**
 * 四段式记忆架构增强 — Working/Episodic/Semantic/Autobiographical 四层记忆
 * 在现有三层记忆基础上增加自动传记记忆层
 *
 * @fileoverview
 * 主要模块：
 * - EnhancedMemoryManager 类：增强记忆管理器（单例），支持记忆添加、语义检索、遗忘曲线、记忆晋升、巩固、触发机制
 * - 向后兼容 re-export：从 stringSimilarity 和 memoryTypes 重新导出类型和函数
 * - 记忆触发机制：6 种（频率/时间/相关性/情感/关键词/事件）
 *
 * 四层记忆架构：
 * 1. Working（工作记忆/最近上下文）
 * 2. Episodic（情景记忆/历史对话）
 * 3. Semantic（语义记忆/长期摘要）
 * 4. Autobiographical（自传记忆/重要事件）
 *
 * 记忆触发机制（6种）：
 * 1. 频率触发 — 同一话题出现多次时
 * 2. 时间触发 — 周期性回忆（每天/每周）
 * 3. 相关性触发 — 当前对话与历史高度相关
 * 4. 情感触发 — 情感强度高的记忆优先
 * 5. 关键词触发 — 包含特定关键词
 * 6. 事件触发 — 用户行为触发（如登录、喂食等）
 *
 * [REFACTOR] R2 - 将纯函数和类型常量拆分到独立模块（stringSimilarity.ts, memoryTypes.ts）
 *
 * @module enhancedMemory
 * @requires @tauri-apps/api/core - Tauri invoke
 * @requires ./db - SQLite 持久化层
 * @requires ./vectorSearch - 嵌入向量和余弦相似度
 * @requires ./stringSimilarity - 字符串相似度工具
 * @requires ./memoryTypes - 记忆类型定义和纯函数
 */

import { invoke } from '@tauri-apps/api/core'
import {
  getSetting,
  setSetting,
  addMemory,
  saveEmbedding,
  getAllEmbeddings,
  updateMemoryLastAccessed,
  deleteMemory as deleteMemoryRow,
  clearMemories as clearMemoryRows,
  // S2: 行级 CRUD 函数
  insertMemoryRow,
  updateMemoryRow,
  getMemoriesByTier,
  getMemorySummary,
  upsertMemorySummary,
  getMemoryState,
  upsertMemoryState,
  clearAllMemoryData,
  isMemoryMigrated,
  isLegacyMode,
  type MemoryRow,
  type MemoryStateRow,
} from './db'
// S2: 迁移器
import { needsMigration, migrateCharacterMemory } from './memoryMigrator'
import { embed, isVectorSearchAvailable, searchSimilar, terminateVectorSearch } from './vectorSearch'
import { generateId } from './commonUtils'
// P3-1：深度整合 RAGRetriever — BM25+向量+RRF 多信号并行检索
import { getRAGRetriever, type RAGResult, DEFAULT_RAG_CONFIG } from './ragRetrieval'
// T-12: 统一配置入口
import { INJECTION_CONFIG } from './memoryConfig'

// ============ 从拆分模块导入（R2 重构）============
// [REFACTOR] R2 - 将纯函数和类型常量拆分到独立模块，职责单一化
import {
  stringSimilarity,
  tokenize,
  estimateTokens,
} from './stringSimilarity'
import {
  type EnhancedMemory,
  type MemoryTier,
  type TriggerResult,
  type MemoryCategory,
  type MemoryCategoryConfig,
  type PromotionEvent,
  type ConsolidationEvent,
  EMOTION_KEYWORDS,
  PREFERENCE_KEYWORDS,
  EVENT_KEYWORDS,
  ANNIVERSARY_MILESTONES,
  ANNIVERSARY_MESSAGES,
  MAX_DAILY_TRIGGERS,
  MIN_TRIGGER_INTERVAL_MS,
  IGNORE_THRESHOLD,
  DEFAULT_CATEGORY_CONFIG,
  calculateForgettingScore,
  shouldPromoteToLongTerm,
  calculateImportanceScore,
  POSITIVE_VALENCE_WORDS,
  NEGATIVE_VALENCE_WORDS,
  HIGH_AROUSAL_WORDS,
  LOW_AROUSAL_WORDS,
  checkFestivalToday,
} from './memoryTypes'

// ============ 向后兼容 re-export ============
// 保留从本模块导出已拆分的符号，避免破坏现有调用方
export { stringSimilarity, tokenize, estimateTokens } from './stringSimilarity'
export type {
  EnhancedMemory,
  MemoryTier,
  TriggerType,
  TriggerResult,
  MemoryCategory,
  MemoryCategoryConfig,
  PromotionEvent,
  ConsolidationEvent,
} from './memoryTypes'
import { getEntityManager } from './entityLinking'

// ============ 四段式记忆管理器 ============

/** 保存防抖间隔（毫秒）— 避免频繁写入 SQLite */
const SAVE_DEBOUNCE_MS = 500

// P0-2 / P2-3 配套：获取本地时区的 YYYY-MM-DD 日期字符串。
// 注意：不要用 toISOString()——它在东八区凌晨会回退到前一天，导致"新的一天"判断错位、日记日期漂移。
function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// P0-5 配套：已注入记忆的冷却时长（同一条记忆在此时长内不重复注入到聊天上下文）
// T-12: 值统一来自 memoryConfig
const INJECTION_COOLDOWN_MS = INJECTION_CONFIG.cooldownMs

export class EnhancedMemoryManager {
  private characterId: string
  private storageKey: string
  private workingMemory: EnhancedMemory[]    // 工作记忆（最近5条）
  private episodicMemory: EnhancedMemory[]   // 情景记忆（历史对话）
  private semanticMemory: string             // 语义记忆（摘要）
  private autobiographicalMemory: EnhancedMemory[] // 自传记忆（重要事件）
  private topicFrequency: Map<string, number> = new Map()
  // 触发频率控制状态
  private triggerLog: { timestamp: number; type: string }[] = []  // 触发历史
  private ignoreCount: Record<string, number> = {}  // 各类型连续忽略次数
  private lastPeriodicFireDate: Record<string, string> = {}  // 周期事件当日已触发标记
  private pendingPeriodicEventKey: string | null = null  // 待确认的周期事件键
  // P0-2 修复：真正的"上次对话日期"（YYYY-MM-DD 本地时区），用于时间触发判断。
  // 之前的实现误用 workingMemory[0].lastAccessed，而新记忆创建时 lastAccessed=0
  // 且只有检索命中才更新，导致"新的一天"几乎每条消息都触发（复读机）。
  private lastChatDate: string | null = null
  // P0-5 配套：已注入记忆冷却表，记录每条记忆上次被注入到上下文的时间戳，避免高频复读
  private injectedAt: Map<string, number> = new Map()
  private initPromise: Promise<void>
  // 向量检索状态
  // P0-1 修复：vectorAvailable 缓存改为"失败时间戳 + 冷却"模型，避免一次性探测失败后永久降级。
  //   - null  = 尚未检测
  //   - true  = 已确认可用
  //   - false = 上次探测失败，但会在 VECTOR_RETRY_COOLDOWN_MS 后重探
  // vectorAvailableCheckedAt 记录上一次探测（成功或失败）的时间戳。
  private vectorAvailable: boolean | null = null
  private vectorAvailableCheckedAt: number = 0
  private static readonly VECTOR_RETRY_COOLDOWN_MS = 5 * 60 * 1000 // 失败后 5 分钟重试（与 vectorSearch.ts 对齐）
  private embeddingCache: Map<number, Float32Array> = new Map()  // dbId → embedding
  private embeddingsLoaded: boolean = false  // 是否已从 SQLite 加载过 embedding
  // P3-1：RAG 混合检索器（BM25+向量+RRF）——在构造函数中初始化
  private ragRetriever: ReturnType<typeof getRAGRetriever> | null = null
  private ragIndexBuilt: boolean = false  // RAG 索引是否已构建
  // S3：查询向量缓存——同一查询 60s 内复用 embedding，消除 D7 双重检索
  private queryEmbeddingCache: Map<string, { embedding: Float32Array; timestamp: number }> = new Map()
  private static readonly QUERY_CACHE_TTL_MS = 60_000 // 60 秒
  // S3：统一检索结果缓存——checkTriggers 与 getContextForChat 共享同一次检索
  private lastRetrievalQuery: string = ''
  private lastRetrievalResult: EnhancedMemory[] = []
  private lastRetrievalTimestamp: number = 0
  // OPTIMIZE: 首次互动日期缓存，避免每次遍历所有记忆
  private firstInteractionDateCache: Date | null | undefined = undefined
  // OPTIMIZE: 保存防抖定时器
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private needsSave = false
  // S2: 是否使用行级存储（true=行级路径，false=旧 blob 路径）
  // 由 load() 在初始化时决定：迁移完成 → true，否则 → false（双模式兼容窗口）
  private useRowLevelStorage: boolean = false

  constructor(characterId: string) {
    this.characterId = characterId
    // P3-1：在构造函数中初始化 RAG 检索器（此时 characterId 已赋值）
    this.ragRetriever = getRAGRetriever(characterId)
    this.storageKey = `spiritpal-enhanced-memory-${characterId}`
    this.workingMemory = []
    this.episodicMemory = []
    this.semanticMemory = ''
    this.autobiographicalMemory = []
    this.triggerLog = []
    this.ignoreCount = {}
    this.lastPeriodicFireDate = {}
    this.lastChatDate = null
    this.injectedAt = new Map()
    this.initPromise = this.init()
  }

  /** 异步初始化：加载记忆并应用衰减分层 */
  private async init(): Promise<void> {
    await this.load()
    // 加载后应用衰减分层（热→温→冷→归档）
    this.applyDecay()
  }

  /** 等待异步加载完成（外部调用可选） */
  async ensureLoaded(): Promise<void> {
    await this.initPromise
  }

  // ============ 持久化 ============

  private async load(): Promise<void> {
    // S2: 检查是否需要迁移
    try {
      if (await needsMigration(this.characterId)) {
        console.log(`[S2] Migrating memory for ${this.characterId}...`)
        await migrateCharacterMemory(this.characterId)
      }
    } catch (e) {
      console.warn(`[S2] Migration check failed, falling back to legacy:`, e)
    }

    // S2: 决定使用行级路径还是旧 blob 路径
    try {
      const migrated = await isMemoryMigrated()
      const legacy = await isLegacyMode()
      this.useRowLevelStorage = migrated && !legacy
    } catch {
      this.useRowLevelStorage = false
    }

    if (this.useRowLevelStorage) {
      // S2: 行级路径——从 memories 表 + memory_summaries + memory_state 读取
      await this.loadFromRows()
    } else {
      // 旧路径——从 settings blob 读取
      await this.loadFromBlob()
    }
  }

  /**
   * S2: 从行级存储加载记忆
   */
  private async loadFromRows(): Promise<void> {
    try {
      // 读取三层记忆行
      const rows = await getMemoriesByTier(this.characterId, ['working', 'episodic', 'autobiographical'])

      this.workingMemory = []
      this.episodicMemory = []
      this.autobiographicalMemory = []

      for (const row of rows) {
        const mem = this.rowToMemory(row)
        if (!mem) continue
        if (row.tier === 'working') {
          this.workingMemory.push(mem)
        } else if (row.tier === 'episodic') {
          this.episodicMemory.push(mem)
        } else if (row.tier === 'autobiographical') {
          this.autobiographicalMemory.push(mem)
        }
      }

      // 读取语义摘要
      const summary = await getMemorySummary(this.characterId)
      this.semanticMemory = summary ?? ''

      // 读取触发状态
      const state = await getMemoryState(this.characterId)
      if (state) {
        this.lastChatDate = state.last_chat_date ?? null
        try { this.triggerLog = JSON.parse(state.trigger_log ?? '[]') } catch { this.triggerLog = [] }
        try { this.ignoreCount = JSON.parse(state.ignore_count ?? '{}') } catch { this.ignoreCount = {} }
        try { this.lastPeriodicFireDate = JSON.parse(state.last_periodic_fire_date ?? '{}') } catch { this.lastPeriodicFireDate = {} }
        try {
          const injectedObj = JSON.parse(state.injected_at ?? '{}')
          this.injectedAt = new Map(Object.entries(injectedObj))
        } catch { this.injectedAt = new Map() }
        try {
          const reassessedArr = JSON.parse(state.llm_reassessed_ids ?? '[]')
          this.llmReassessedIds = new Set(reassessedArr)
        } catch { this.llmReassessedIds = new Set() }
      }
    } catch (e) {
      console.error(`[S2] loadFromRows failed for ${this.characterId}:`, e)
      // 回退到旧 blob 路径
      this.useRowLevelStorage = false
      await this.loadFromBlob()
    }
  }

  /**
   * S2: 将 MemoryRow 转为 EnhancedMemory 对象
   */
  private rowToMemory(row: MemoryRow): EnhancedMemory | null {
    if (!row.content) return null
    let tags: string[]
    try { tags = JSON.parse(row.tags ?? '[]') } catch { tags = [] }
    return {
      id: row.memory_id ?? `mem-${row.id}`,
      created_at: new Date(row.created_at).toISOString(),
      user: row.content,
      assistant: row.assistant ?? '',
      importance: row.importance,
      emotionalIntensity: row.emotional_intensity ?? 0,
      category: row.category ?? '日常',
      tags,
      accessCount: row.access_count ?? 0,
      lastAccessed: row.last_accessed,
      decayFactor: row.decay_factor ?? 1.0,
      isAutobiographical: (row.is_autobiographical ?? 0) === 1,
      emotionalValence: row.emotional_valence ?? 0,
      emotionalArousal: row.emotional_arousal ?? 0.3,
      strength: row.strength ?? 1.0,
      sourceKind: (row.source_kind as EnhancedMemory['sourceKind']) ?? 'exchange',
      factText: row.fact_text ?? undefined,
      dbId: row.id,
    } as EnhancedMemory
  }

  /**
   * S2: 旧 blob 加载路径（双模式兼容窗口）
   */
  private async loadFromBlob(): Promise<void> {
    try {
      const raw = await getSetting(this.storageKey)
      if (!raw) return

      let jsonStr: string
      // 检查是否为加密数据（Rust 端加密后带 "ENC1:"/"ENC2:" 前缀）
      // D1 修复：仅判断 ENC1: 会导致新版 ENC2: 密文落入明文分支、JSON.parse 失败而静默丢失全部记忆
      if (raw.startsWith('ENC1:') || raw.startsWith('ENC2:')) {
        try {
          jsonStr = await invoke<string>('decrypt_data', { encrypted: raw, password: '' })
        } catch (e) {
          // F10：解密失败时保留损坏副本，而非直接丢弃
          console.warn(`[EnhancedMemory] 解密失败 ${this.storageKey}，保留损坏副本:`, e)
          try {
            await setSetting(`${this.storageKey}.corrupt`, raw)
          } catch {
            // 保留副本也失败时只能放弃
          }
          return
        }
      } else {
        jsonStr = raw
      }

      const data = JSON.parse(jsonStr)

      // F10：校验和验证——如果数据中包含 _checksum，验证完整性
      if (data._checksum) {
        const storedChecksum = data._checksum as string
        const payload = { ...data }
        delete payload._checksum
        const payloadJson = JSON.stringify(payload)
        const computedChecksum = this.computeChecksum(payloadJson)
        if (storedChecksum !== computedChecksum) {
          console.warn(`[EnhancedMemory] 校验和不匹配 ${this.storageKey}，数据可能损坏`)
          try {
            await setSetting(`${this.storageKey}.corrupt`, raw)
          } catch {
            // 保留副本也失败
          }
        }
      }

      this.workingMemory = data.workingMemory ?? []
      this.episodicMemory = data.episodicMemory ?? []
      this.semanticMemory = data.semanticMemory ?? ''
      this.autobiographicalMemory = data.autobiographicalMemory ?? []
      this.triggerLog = data.triggerLog ?? []
      this.ignoreCount = data.ignoreCount ?? {}
      this.lastPeriodicFireDate = data.lastPeriodicFireDate ?? {}
      this.lastChatDate = data.lastChatDate ?? null
    } catch (e) {
      // [OPTIMIZE] E1 - 记录错误日志，避免静默吞错导致数据加载失败无感知
      // F10：解析失败也保留副本
      console.error(`[EnhancedMemory] 加载记忆失败 ${this.storageKey}:`, e)
      try {
        const raw = await getSetting(this.storageKey)
        if (raw) {
          await setSetting(`${this.storageKey}.corrupt`, raw)
        }
      } catch {
        // 保留副本也失败
      }
    }
  }

  /**
   * 防抖保存：批量合并短时间内的多次修改，减少 SQLite 写入和加密开销
   * 立即执行的场景（如导出/清空）使用 forceSave
   */
  private scheduleSave(): void {
    this.needsSave = true
    if (this.saveDebounceTimer !== null) return
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null
      if (this.needsSave) {
        void this.doSave()
      }
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * 立即执行保存（绕过防抖）
   */
  private async forceSave(): Promise<void> {
    if (this.saveDebounceTimer !== null) {
      clearTimeout(this.saveDebounceTimer)
      this.saveDebounceTimer = null
    }
    await this.doSave()
  }

  /**
   * 实际执行保存操作
   *
   * S2: 行级路径下，记忆行已通过 insertMemoryRow/updateMemoryRow 实时写入，
   * doSave 只负责持久化 memory_state（触发状态）+ memory_summaries（语义摘要）。
   * 旧路径下仍走全量 JSON 序列化 + AES 加密 + 写 settings blob。
   */
  private async doSave(): Promise<void> {
    this.needsSave = false
    try {
      if (this.useRowLevelStorage) {
        // S2: 行级路径——只写 memory_state + memory_summaries
        const stateRow: MemoryStateRow = {
          character_id: this.characterId,
          last_chat_date: this.lastChatDate,
          trigger_log: JSON.stringify(this.triggerLog),
          ignore_count: JSON.stringify(this.ignoreCount),
          last_periodic_fire_date: JSON.stringify(this.lastPeriodicFireDate),
          injected_at: JSON.stringify(Object.fromEntries(this.injectedAt)),
          llm_reassessed_ids: JSON.stringify(Array.from(this.llmReassessedIds)),
        }
        await upsertMemoryState(stateRow)

        // 语义摘要单独写入 memory_summaries
        if (this.semanticMemory) {
          await upsertMemorySummary(this.characterId, this.semanticMemory)
        }
        return
      }

      // 旧路径——全量 JSON 序列化 + AES 加密 + 写 settings blob
      const payload = {
        workingMemory: this.workingMemory,
        episodicMemory: this.episodicMemory,
        semanticMemory: this.semanticMemory,
        autobiographicalMemory: this.autobiographicalMemory,
        triggerLog: this.triggerLog,
        ignoreCount: this.ignoreCount,
        lastPeriodicFireDate: this.lastPeriodicFireDate,
        lastChatDate: this.lastChatDate,
      }
      const jsonStr = JSON.stringify(payload)
      const checksum = this.computeChecksum(jsonStr)
      const jsonWithChecksum = JSON.stringify({ ...payload, _checksum: checksum })

      let toStore: string
      try {
        toStore = await invoke<string>('encrypt_data', { data: jsonWithChecksum, password: '' })
      } catch (e) {
        console.error(`[EnhancedMemory] 加密失败 ${this.storageKey}，拒绝写入明文数据:`, e)
        return
      }

      await setSetting(this.storageKey, toStore)
    } catch (e) {
      console.error(`[EnhancedMemory] 保存记忆失败 ${this.storageKey}:`, e)
    }
  }

  /**
   * F10：简单校验和计算（用于检测数据截断/损坏）
   * 不是加密哈希，仅用于快速检测完整性
   */
  private computeChecksum(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash |= 0 // 转为 32 位整数
    }
    return `${hash}_${str.length}`
  }

  /**
   * 兼容旧接口：触发防抖保存
   * @deprecated 使用 scheduleSave 或 forceSave
   */
  private save(): void {
    this.scheduleSave()
  }

  // ============ 添加记忆 ============

  addExchange(user: string, assistant: string): EnhancedMemory {
    const importance = this.assessImportance(user, assistant)
    const emotionalIntensity = this.assessEmotion(user)
    const category = this.categorize(user)
    const tags = this.extractTags(user)
    // W1：情感三维化
    const { valence, arousal } = this.assessEmotion3D(user)
    // W4：闪光灯记忆——|valence| 高且 arousal 高的事件自动提升为自传记忆
    const isFlashbulb = Math.abs(valence) > 0.5 && arousal > 0.6
    const isAutobiographical = importance >= 70 || emotionalIntensity >= 0.7 || isFlashbulb

    const now = Date.now()
    const memory: EnhancedMemory = {
      id: generateId('mem'),
      created_at: new Date(now).toISOString(),
      user,
      assistant,
      importance,
      emotionalIntensity,
      category,
      tags,
      accessCount: 0,
      // P0-2 修复：创建即写入当前时间。
      lastAccessed: now,
      decayFactor: 1.0,
      isAutobiographical,
      // W1：情感三维化
      emotionalValence: valence,
      emotionalArousal: arousal,
      // W3：记忆强度初始化
      strength: 1.0,
      // S2：记忆来源
      sourceKind: 'exchange',
    }

    // 新记忆添加，使首次互动日期缓存失效
    this.firstInteractionDateCache = undefined

    // 加入工作记忆
    this.workingMemory.push(memory)
    // F4：工作记忆容量从配置读取（旧硬编码 5）
    if (this.workingMemory.length > this.categoryConfig.workingMemoryCapacity) {
      // 溢出到情景记忆
      const overflow = this.workingMemory.shift()!
      this.episodicMemory.push(overflow)
      // S2: 行级路径下更新 tier 从 working → episodic
      if (this.useRowLevelStorage && overflow.dbId !== undefined) {
        void updateMemoryRow(overflow.dbId, { tier: 'episodic' })
      }
      // F4：情景记忆容量从配置读取（旧硬编码 50，实际 compressEpisodic 压到 30）
      if (this.episodicMemory.length > this.categoryConfig.episodicCapacity) {
        this.compressEpisodic()
      }
    }

    // 重要记忆加入自传记忆
    if (isAutobiographical) {
      this.autobiographicalMemory.push(memory)
      // W4：自传层从容量 20 扩展为软上限 200，按 strength×importance 淘汰
      // F4：软上限从配置读取
      const autoLimit = this.categoryConfig.autobiographicalSoftLimit
      if (this.autobiographicalMemory.length > autoLimit) {
        this.autobiographicalMemory.sort((a, b) =>
          (b.strength ?? 1) * b.importance - (a.strength ?? 1) * a.importance,
        )
        this.autobiographicalMemory = this.autobiographicalMemory.slice(0, autoLimit)
      }
    }

    // 更新话题频率
    this.updateTopicFrequency(user)

    // P0-2 修复：记录本次对话发生在哪一天（本地时区）。
    // 时间触发改为基于此字段判断"是否跨越到新的一天"，而非误用 workingMemory[0].lastAccessed。
    this.lastChatDate = localDateString(new Date(now))

    // 保存到 SQLite 并生成嵌入向量（异步，不阻塞记忆添加）
    void this.saveToVectorStore(memory)

    this.scheduleSave()
    return memory
  }

  // ============ P2-2：LLM 事实提取层 ============

  /**
   * P2-2：LLM 事实提取——从对话中提取结构化事实并存储为高密度记忆
   *
   * 每次 addExchange 后异步调用，不阻塞对话流程。
   * LLM 从用户消息中提取 0-3 条关键事实（如"用户养了一只猫"），
   * 每条事实存储为 sourceKind='fact' 的记忆条目，
   * factText 字段存储提取出的事实文本，用于高密度检索。
   *
   * @param userMessage 用户消息
   * @param assistantReply AI 回复
   * @param llmExtractor LLM 事实提取函数（可选，不传则跳过）
   */
  async extractFactsWithLLM(
    userMessage: string,
    assistantReply: string,
    llmExtractor?: (conversation: string) => Promise<string[]>,
  ): Promise<void> {
    if (!llmExtractor) return
    // 短消息不值得提取
    if (userMessage.length < 10) return

    try {
      const conversation = `User: ${userMessage}\nAI: ${assistantReply}`
      const facts = await llmExtractor(conversation)
      if (!facts || facts.length === 0) return

      const now = Date.now()
      for (const fact of facts.slice(0, 3)) {
        if (!fact || fact.trim().length < 3) continue
        await this.addFactMemory(fact.trim(), now)
      }
    } catch {
      // 事实提取失败不影响正常对话
    }
  }

  /**
   * P2-2：添加事实记忆——将提取的事实存储为独立记忆条目
   */
  private async addFactMemory(factText: string, timestamp: number): Promise<void> {
    const factMemory: EnhancedMemory = {
      id: generateId('fact'),
      created_at: new Date(timestamp).toISOString(),
      user: factText,
      assistant: '',
      importance: 60, // 事实记忆默认中高重要度
      emotionalIntensity: 0,
      category: '事实',
      tags: this.extractTags(factText),
      accessCount: 0,
      lastAccessed: timestamp,
      decayFactor: 1.0,
      isAutobiographical: false,
      strength: 1.5, // 事实记忆初始强度更高（更不容易遗忘）
      sourceKind: 'fact',
      factText,
    }

    // 事实记忆加入情景记忆池（参与检索但不占用工作记忆）
    this.episodicMemory.push(factMemory)

    // 异步保存到 SQLite + 生成嵌入
    void this.saveToVectorStore(factMemory)

    this.scheduleSave()
  }

  // ============ 向量存储：保存记忆 + 生成嵌入 ============

  /**
   * 异步保存记忆到 SQLite memories 表并生成嵌入向量
   *
   * S2: 行级路径下使用 insertMemoryRow 写入完整字段（含 assistant/category/tags/emotion 等），
   * 旧路径保持 addMemory 仅写 content+importance。
   */
  private async saveToVectorStore(memory: EnhancedMemory): Promise<void> {
    try {
      let dbId: number
      if (this.useRowLevelStorage) {
        // S2: 行级路径——写入完整记忆行
        const tier = memory.isAutobiographical ? 'autobiographical' : 'working'
        dbId = await insertMemoryRow({
          character_id: this.characterId,
          type: memory.isAutobiographical ? 'long_term' : 'short_term',
          content: memory.user,
          importance: memory.importance,
          created_at: new Date(memory.created_at).getTime(),
          last_accessed: memory.lastAccessed ?? Date.now(),
          memory_id: memory.id,
          assistant: memory.assistant,
          category: memory.category,
          tags: JSON.stringify(memory.tags ?? []),
          emotional_intensity: memory.emotionalIntensity ?? 0,
          emotional_valence: memory.emotionalValence ?? 0,
          emotional_arousal: memory.emotionalArousal ?? 0.3,
          strength: memory.strength ?? 1.0,
          decay_factor: memory.decayFactor ?? 1.0,
          access_count: memory.accessCount ?? 0,
          source_kind: memory.sourceKind ?? 'exchange',
          fact_text: memory.factText ?? null,
          is_autobiographical: memory.isAutobiographical ? 1 : 0,
          tier,
        })
        memory.dbId = dbId
      } else {
        // 旧路径——仅写 content + importance
        const type = memory.isAutobiographical ? 'long_term' : 'short_term'
        dbId = await addMemory(this.characterId, type, memory.user, memory.importance)
        memory.dbId = dbId
      }

      // 生成嵌入向量并存入 SQLite（两种路径共用）
      const embedding = await embed(memory.user)
      await saveEmbedding(dbId, embedding)
      this.embeddingCache.set(dbId, embedding)

      // dbId 已设置，重新保存以持久化 dbId（旧路径需要，行级路径 memory_state 也需要保存）
      this.scheduleSave()
    } catch (e) {
      console.warn('[EnhancedMemory] Failed to save embedding:', e)
    }
  }

  /** 从 SQLite 加载所有嵌入向量到缓存（懒加载，首次搜索时调用） */
  private async ensureEmbeddingsLoaded(): Promise<void> {
    if (this.embeddingsLoaded) return
    try {
      const embeddings = await getAllEmbeddings(this.characterId)
      this.embeddingCache.clear()
      for (const { id, embedding } of embeddings) {
        this.embeddingCache.set(id, embedding)
      }
    this.embeddingsLoaded = true
    // P3-1：构建 RAG 混合检索索引（BM25+向量）
    this.buildRAGIndex()
  } catch (e) {
      console.warn('[EnhancedMemory] Failed to load embeddings:', e)
    }
  }

  /**
   * 在指定记忆池中执行向量检索。
   * 失败时返回空数组（调用方应回退到 LCS）。
   */
  private async vectorSearchInMemories(
    query: string,
    pool: EnhancedMemory[],
    limit: number,
  ): Promise<EnhancedMemory[]> {
    try {
      // P0-1 修复：向量搜索可用性改为"失败时间戳 + 冷却重试"，避免一次失败永久降级。
      // 失败后超过 VECTOR_RETRY_COOLDOWN_MS 即重置缓存，触发重新探测（如模型已就绪/网络已恢复）。
      const shouldRecheck =
        this.vectorAvailable === null ||
        (this.vectorAvailable === false &&
          Date.now() - this.vectorAvailableCheckedAt >=
            EnhancedMemoryManager.VECTOR_RETRY_COOLDOWN_MS)
      if (shouldRecheck) {
        this.vectorAvailable = await isVectorSearchAvailable()
        this.vectorAvailableCheckedAt = Date.now()
      }
      if (!this.vectorAvailable) return []

      // 加载嵌入向量缓存
      await this.ensureEmbeddingsLoaded()

      // 构建 dbId → memory 映射
      const dbIdMap = new Map<number, EnhancedMemory>()
      for (const mem of pool) {
        if (mem.dbId !== undefined) dbIdMap.set(mem.dbId, mem)
      }
      if (dbIdMap.size === 0) return []

      // 获取候选嵌入向量（只包含 pool 中的 dbId）
      const candidates: { id: number; embedding: Float32Array }[] = []
      for (const [dbId, embedding] of this.embeddingCache) {
        if (dbIdMap.has(dbId)) {
          candidates.push({ id: dbId, embedding })
        }
      }
      if (candidates.length === 0) return []

      // 嵌入查询文本
      // F9：使用 queryEmbeddingCache 缓存查询向量，60s 内同一查询复用 embedding
      const cacheKey = query
      const cached = this.queryEmbeddingCache.get(cacheKey)
      let queryEmbedding: Float32Array
      if (cached && Date.now() - cached.timestamp < EnhancedMemoryManager.QUERY_CACHE_TTL_MS) {
        queryEmbedding = cached.embedding
      } else {
        queryEmbedding = await embed(query)
        this.queryEmbeddingCache.set(cacheKey, { embedding: queryEmbedding, timestamp: Date.now() })
      }

      // OPTIMIZE: 使用 searchSimilar（内部 Top-K 堆算法 O(n log k)）替代全量排序 O(n log n)
      // 在候选集较大时（如 1000+ 条记忆）性能提升明显
      const topResults = searchSimilar(queryEmbedding, candidates, limit)

      // P1-2：使用公共多因子加权函数，与 RAG/LCS 路径保持一致
      const now = Date.now()
      // F2：传入当前情绪
      const currentMood = this.getCurrentMood()
      const scored = topResults
        // P2-3：向量最低分阈值统一使用 RAG 配置值，避免配置与运行时不一致
        .filter((r) => r.score > DEFAULT_RAG_CONFIG.vectorMinScore)
        .map((r) => {
          const mem = dbIdMap.get(r.id)!
          const fusedScore = this.computeMultiFactorScore(r.score, mem, query, now, currentMood)
          return { mem, fusedScore }
        })
        .sort((a, b) => b.fusedScore - a.fusedScore)

      return scored.map(({ mem }) => {
        mem.accessCount++
        mem.lastAccessed = now
        if (mem.dbId !== undefined) {
          void updateMemoryLastAccessed(mem.dbId)
        }
        return mem
      })
    } catch (e) {
      console.warn('[EnhancedMemory] Vector search failed, falling back to LCS:', e)
      return []
    }
  }

  // ============ 重要性评估 ============

  private assessImportance(user: string, assistant: string): number {
    let score = 30 // 基础分
    const text = `${user} ${assistant}`

    // 长文本更重要
    if (text.length > 100) score += 15
    if (text.length > 200) score += 10

    // 包含偏好关键词
    PREFERENCE_KEYWORDS.forEach((kw) => {
      if (text.includes(kw)) score += 10
    })

    // 包含事件关键词
    EVENT_KEYWORDS.forEach((kw) => {
      if (text.includes(kw)) score += 8
    })

    // 包含情感关键词
    EMOTION_KEYWORDS.forEach((kw) => {
      if (text.includes(kw)) score += 12
    })

    return Math.min(100, score)
  }

  // ============ 情感强度评估 ============

  private assessEmotion(text: string): number {
    let count = 0
    EMOTION_KEYWORDS.forEach((kw) => {
      if (text.includes(kw)) count++
    })
    // 感叹号增加情感强度
    const exclaims = (text.match(/!/g) || []).length
    count += Math.min(exclaims, 3) * 0.1
    return Math.min(1, count * 0.2)
  }

  // W1：情感三维化——计算 valence（愉悦度 -1..1）和 arousal（唤醒度 0..1）
  private assessEmotion3D(text: string): { valence: number; arousal: number } {
    let positive = 0
    let negative = 0
    let highArousal = 0
    let lowArousal = 0

    POSITIVE_VALENCE_WORDS.forEach((kw) => {
      if (text.includes(kw)) positive++
    })
    NEGATIVE_VALENCE_WORDS.forEach((kw) => {
      if (text.includes(kw)) negative++
    })
    HIGH_AROUSAL_WORDS.forEach((kw) => {
      if (text.includes(kw)) highArousal++
    })
    LOW_AROUSAL_WORDS.forEach((kw) => {
      if (text.includes(kw)) lowArousal++
    })

    // 全角感叹号增加唤醒度
    const exclaims = (text.match(/[！!]/g) || []).length
    highArousal += Math.min(exclaims, 3) * 0.5

    // valence: (positive - negative) / total，归一化到 -1..1
    const totalEmotion = positive + negative
    const valence = totalEmotion > 0 ? (positive - negative) / totalEmotion : 0

    // arousal: highArousal 占比，低唤醒词拉低
    const totalArousal = highArousal + lowArousal
    let arousal = 0.3 // 默认中等唤醒
    if (totalArousal > 0) {
      arousal = Math.min(1, highArousal / Math.max(totalArousal, 1))
    }

    return { valence, arousal }
  }

  // ============ 分类 ============

  private categorize(text: string): string {
    if (PREFERENCE_KEYWORDS.some((kw) => text.includes(kw))) return '偏好'
    if (EMOTION_KEYWORDS.some((kw) => text.includes(kw))) return '情感'
    if (EVENT_KEYWORDS.some((kw) => text.includes(kw))) return '事件'
    if (/习惯|每天|总是|经常|usually|always|every/.test(text)) return '习惯'
    if (/朋友|家人|同事|friend|family|colleague/.test(text)) return '关系'
    return '日常'
  }

  // ============ 标签提取 ============

  private extractTags(text: string): string[] {
    const tokens = tokenize(text)
    // 取出现频率高的词作为标签（简化版：取前5个）
    const freq: Record<string, number> = {}
    tokens.forEach((t) => {
      if (t.length > 1) freq[t] = (freq[t] || 0) + 1
    })
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k)
  }

  // ============ 话题频率追踪 ============

  private updateTopicFrequency(text: string): void {
    const tokens = tokenize(text)
    tokens.forEach((t) => {
      if (t.length > 1) {
        this.topicFrequency.set(t, (this.topicFrequency.get(t) || 0) + 1)
      }
    })
  }

  // ============ 情景记忆压缩 ============

  private compressEpisodic(): void {
    // F4：容量从配置读取（旧硬编码 30）
    const capacity = this.categoryConfig.episodicCapacity
    // 按重要度排序，保留前 N 条
    this.episodicMemory.sort((a, b) => b.importance - a.importance)
    const toCompress = this.episodicMemory.slice(capacity)
    this.episodicMemory = this.episodicMemory.slice(0, capacity)

    // 将被压缩的记忆摘要加入语义记忆
    const summary = toCompress
      .map((m) => `${m.category}: ${m.user.slice(0, 50)}`)
      .join('; ')
    this.semanticMemory = `${this.semanticMemory} ${summary}`.trim().slice(-this.categoryConfig.semanticSummaryMaxChars)
  }

  // ============ 记忆触发机制 ============

  /**
   * 检查记忆触发
   * @param currentInput 当前用户输入（可选）。不传时为主动触发模式，仅检查周期触发。
   */
  async checkTriggers(currentInput?: string): Promise<TriggerResult | null> {
    // 周期触发（纪念日/节日/生日）— 受频率控制
    const periodicTrigger = this.checkPeriodicTrigger()
    if (periodicTrigger) {
      if (this.canTrigger('periodic')) {
        // 标记今日已触发该周期事件，避免同日重复
        if (this.pendingPeriodicEventKey) {
          this.lastPeriodicFireDate[this.pendingPeriodicEventKey] = new Date().toDateString()
          this.pendingPeriodicEventKey = null
        }
        this.recordTrigger('periodic')
        return periodicTrigger
      }
      // 频率受限，清除待确认事件键
      this.pendingPeriodicEventKey = null
      // 主动模式下被限流直接返回 null
      if (!currentInput) return null
    }

    // 以下为响应式触发，需要用户输入
    if (!currentInput) return null

    // T-8: 响应式触发也受预算纪律约束（每日上限 + 全局间隔）
    // 但响应式触发的间隔要求比主动触发宽松（减半），避免过度抑制自然对话中的回忆
    if (!this.canTriggerResponsive()) return null

    // 1. 频率触发：同一话题出现3次以上
    const freqTrigger = this.checkFrequencyTrigger(currentInput)
    if (freqTrigger) {
      this.recordTrigger('frequency')
      return freqTrigger
    }

    // 2. 相关性触发：与历史高度相关（向量检索 + LCS fallback）
    const relevanceTrigger = await this.checkRelevanceTrigger(currentInput)
    if (relevanceTrigger) {
      this.recordTrigger('relevance')
      return relevanceTrigger
    }

    // 3. 情感触发：高情感记忆
    const emotionTrigger = this.checkEmotionTrigger(currentInput)
    if (emotionTrigger) {
      this.recordTrigger('emotion')
      return emotionTrigger
    }

    // 4. 关键词触发
    const keywordTrigger = this.checkKeywordTrigger(currentInput)
    if (keywordTrigger) {
      this.recordTrigger('keyword')
      return keywordTrigger
    }

    // 5. 时间触发：每天首次对话
    const timeTrigger = this.checkTimeTrigger()
    if (timeTrigger) {
      this.recordTrigger('time')
      return timeTrigger
    }

    return null
  }

  // ============ 触发频率控制 ============

  /**
   * 检查是否允许触发
   * 规则：每日主动触发 ≤5 次 / 间隔 ≥30min / 连续忽略 ≥3 次后该类型间隔加倍
   */
  canTrigger(type: string): boolean {
    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    // 清理超过 24 小时的触发记录
    this.triggerLog = this.triggerLog.filter((t) => now - t.timestamp < dayMs)

    // 每日主动触发上限（全局）
    const recentTriggers = this.triggerLog.filter((t) => now - t.timestamp < dayMs)
    if (recentTriggers.length >= MAX_DAILY_TRIGGERS) return false

    // 全局最小间隔 ≥30 分钟
    if (recentTriggers.length > 0) {
      const last = recentTriggers[recentTriggers.length - 1]
      if (now - last.timestamp < MIN_TRIGGER_INTERVAL_MS) return false
    }

    // 连续忽略 ≥3 次：该类型间隔加倍（降频 50%）
    const ignores = this.ignoreCount[type] || 0
    if (ignores >= IGNORE_THRESHOLD) {
      const lastTypeTrigger = [...this.triggerLog]
        .reverse()
        .find((t) => t.type === type)
      if (lastTypeTrigger && now - lastTypeTrigger.timestamp < MIN_TRIGGER_INTERVAL_MS * 2) {
        return false
      }
    }

    return true
  }

  /**
   * T-8: 响应式触发预算检查
   * 仅检查每日总上限，不检查全局间隔（响应式触发是用户驱动的，不是主动打扰）
   */
  canTriggerResponsive(): boolean {
    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    this.triggerLog = this.triggerLog.filter((t) => now - t.timestamp < dayMs)

    const recentTriggers = this.triggerLog.filter((t) => now - t.timestamp < dayMs)
    // 每日总上限（响应式 + 主动共用配额）
    if (recentTriggers.length >= MAX_DAILY_TRIGGERS) return false

    return true
  }

  /** 记录一次触发 */
  recordTrigger(type: string): void {
    this.triggerLog.push({ timestamp: Date.now(), type })
    // 限制日志大小，保留最近 50 条
    if (this.triggerLog.length > 100) {
      this.triggerLog = this.triggerLog.slice(-50)
    }
    this.scheduleSave()
  }

  /**
   * 记录用户响应
   * @param type 触发类型
   * @param responded 用户是否响应（打开聊天并发送消息 = true）
   */
  recordUserResponse(type: string, responded: boolean): void {
    if (responded) {
      // 用户回复，恢复正常频率
      this.ignoreCount[type] = 0
      // W3：用户接住话题→增强最近注入记忆的强度
      for (const m of this.lastRetrievalResult.slice(0, 3)) {
        m.strength = Math.min((m.strength ?? 1) * 1.6 + 0.5, 30)
      }
    } else {
      // 用户忽略，增加连续忽略计数
      this.ignoreCount[type] = (this.ignoreCount[type] || 0) + 1
      // W3：用户无视→轻微下降最近注入记忆的强度
      for (const m of this.lastRetrievalResult.slice(0, 3)) {
        m.strength = Math.max((m.strength ?? 1) * 0.95, 0.5)
      }
    }
    this.scheduleSave()
  }

  // ============ 周期触发检测 ============

  /** 周期触发：纪念日 / 节日 / 生日 */
  private checkPeriodicTrigger(): TriggerResult | null {
    const now = new Date()
    const todayStr = now.toDateString()
    this.pendingPeriodicEventKey = null

    // 1. 纪念日触发（认识第 N 天）
    const anniversary = this.checkAnniversaryTrigger(todayStr)
    if (anniversary) return anniversary

    // 2. 节日触发
    const festival = this.checkFestivalTrigger(todayStr)
    if (festival) return festival

    // 3. 生日触发
    const birthday = this.checkBirthdayTrigger(todayStr)
    if (birthday) return birthday

    return null
  }

  /** 纪念日触发：基于首次互动日期计算认识第 N 天 */
  private checkAnniversaryTrigger(todayStr: string): TriggerResult | null {
    const firstDate = this.getFirstInteractionDate()
    if (!firstDate) return null

    const dayMs = 24 * 60 * 60 * 1000
    const daysSince = Math.floor((Date.now() - firstDate.getTime()) / dayMs)
    // 100 天后才开始触发
    if (daysSince < 100) return null

    // 仅在里程碑日触发
    if (!ANNIVERSARY_MILESTONES.includes(daysSince)) return null

    // 防止同一天重复触发
    const eventKey = `anniversary_${daysSince}`
    if (this.lastPeriodicFireDate[eventKey] === todayStr) return null
    this.pendingPeriodicEventKey = eventKey

    const message =
      ANNIVERSARY_MESSAGES[daysSince] || `主人，今天是我们认识的第 ${daysSince} 天呢！`
    return {
      type: 'periodic',
      memories: this.autobiographicalMemory.slice(-3),
      message,
    }
  }

  /** 节日触发：春节 / 中秋 / 圣诞等 */
  private checkFestivalTrigger(todayStr: string): TriggerResult | null {
    // D10 修复：使用动态农历 checkFestivalToday() 替代硬编码 dates 匹配
    const festival = checkFestivalToday()
    if (!festival) return null

    const year = new Date().getFullYear()
    const eventKey = `festival_${festival.key}_${year}`
    if (this.lastPeriodicFireDate[eventKey] === todayStr) return null
    this.pendingPeriodicEventKey = eventKey
    return {
      type: 'periodic',
      memories: [],
      message: festival.message,
    }
  }

  /** 生日触发：用户设置的宠物生日 */
  private checkBirthdayTrigger(todayStr: string): TriggerResult | null {
    const birthday = this.getPetBirthday()
    if (!birthday) return null

    const now = new Date()
    if (now.getMonth() + 1 !== birthday.month || now.getDate() !== birthday.day) return null

    const eventKey = `birthday_${now.getFullYear()}`
    if (this.lastPeriodicFireDate[eventKey] === todayStr) return null
    this.pendingPeriodicEventKey = eventKey

    return {
      type: 'periodic',
      memories: [],
      message: '生日快乐！今天是你特别的日子呢～',
    }
  }

  /** 获取首次互动日期（所有记忆中最早的创建时间）— 使用缓存避免重复遍历 */
  private getFirstInteractionDate(): Date | null {
    // 返回已缓存的值（null 表示无记忆，undefined 表示未初始化）
    if (this.firstInteractionDateCache !== undefined) {
      return this.firstInteractionDateCache
    }

    const all = [
      ...this.workingMemory,
      ...this.episodicMemory,
      ...this.autobiographicalMemory,
    ]
    if (all.length === 0) {
      this.firstInteractionDateCache = null
      return null
    }
    let earliest = Infinity
    for (const m of all) {
      const t = new Date(m.created_at).getTime()
      if (!isNaN(t) && t < earliest) earliest = t
    }
    this.firstInteractionDateCache = earliest === Infinity ? null : new Date(earliest)
    return this.firstInteractionDateCache
  }

  /** 获取用户设置的宠物生日（localStorage: spiritpal-pet-birthday-<characterId>，格式 MM-DD） */
  private getPetBirthday(): { month: number; day: number } | null {
    try {
      const raw = localStorage.getItem(`spiritpal-pet-birthday-${this.characterId}`)
      if (!raw) return null
      const parts = raw.split('-')
      if (parts.length < 2) return null
      const month = parseInt(parts[0], 10)
      const day = parseInt(parts[1], 10)
      if (isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
        return null
      }
      return { month, day }
    } catch {
      return null
    }
  }

  // 频率触发
  private checkFrequencyTrigger(input: string): TriggerResult | null {
    const tokens = tokenize(input)
    for (const t of tokens) {
      if (t.length > 1 && (this.topicFrequency.get(t) || 0) >= 3) {
        const related = this.episodicMemory
          .filter((m) => m.user.includes(t) || m.tags.includes(t))
          .slice(0, 3)
        if (related.length > 0) {
          return {
            type: 'frequency',
            memories: related,
            message: `我们好像聊过好多次${t}呢～`,
          }
        }
      }
    }
    return null
  }

  // 相关性触发（向量检索优先，LCS fallback）
  // S3 修复：使用统一 retrieve 入口复用检索结果（消除 D7）
  private async checkRelevanceTrigger(input: string): Promise<TriggerResult | null> {
    // S3：优先使用统一检索（复用 getContextForChat 的缓存）
    const retrieved = await this.retrieve(input, 1, { purpose: 'trigger' })
    if (retrieved.length > 0) {
      // 二次验证：LCS 相似度门槛，避免不相关查询误触发
      const bestRetrieved = retrieved[0]
      const lcsScore = stringSimilarity(input.toLowerCase(), bestRetrieved.user.toLowerCase().slice(0, 500))
      if (lcsScore > 0.15) {
        return {
          type: 'relevance',
          memories: retrieved,
          message: `我记得你上次说过类似的话呢～`,
        }
      }
    }

    // Fallback: LCS 字符串相似度
    const all = [...this.episodicMemory, ...this.autobiographicalMemory]
    let best: EnhancedMemory | null = null
    let bestScore = 0

    for (const mem of all) {
      const score = stringSimilarity(input.toLowerCase(), mem.user.toLowerCase().slice(0, 500))
      if (score > bestScore) {
        bestScore = score
        best = mem
      }
    }

    if (best && bestScore > 0.45) {
      best.accessCount++
      best.lastAccessed = Date.now()
      return {
        type: 'relevance',
        memories: [best],
        message: `我记得你上次说过类似的话呢～`,
      }
    }
    return null
  }

  // 情感触发
  private checkEmotionTrigger(input: string): TriggerResult | null {
    const hasEmotion = EMOTION_KEYWORDS.some((kw) => input.includes(kw))
    if (!hasEmotion) return null

    const emotional = this.autobiographicalMemory
      .filter((m) => m.emotionalIntensity >= 0.5)
      .slice(0, 2)

    if (emotional.length > 0) {
      return {
        type: 'emotion',
        memories: emotional,
        message: `我能感受到你的情绪～`,
      }
    }
    return null
  }

  // 关键词触发
  private checkKeywordTrigger(input: string): TriggerResult | null {
    for (const kw of EVENT_KEYWORDS) {
      if (input.includes(kw)) {
        const related = this.autobiographicalMemory
          .filter((m) => m.tags.some((t) => input.includes(t)))
          .slice(0, 2)
        if (related.length > 0) {
          return {
            type: 'keyword',
            memories: related,
            message: `说到这个，我想起了之前的事～`,
          }
        }
      }
    }
    return null
  }

  // 时间触发 — P0-2 修复 + P2-3 晨间问候增强
  // 旧实现读 workingMemory[0]?.lastAccessed（且该值长期为 0），导致"新的一天"几乎每条消息都触发（复读机）。
  // 新实现：基于真正的 lastChatDate 判断"上次对话是否在昨天或更早"，今天已触发过则不再触发。
  // P2-3：晨间问候增强——尝试从 OwnerFacts 获取用户名字，让问候更个性化。
  private checkTimeTrigger(): TriggerResult | null {
    const today = localDateString()
    // 今天还没说过话（lastChatDate 由 addExchange 写入）→ 此时无"跨越新一天"可判定
    if (!this.lastChatDate) return null
    // 上次对话就在今天 → 不是"新的一天"
    if (this.lastChatDate === today) return null

    // 防同日重复：今天已经触发过晨间回顾就不再触发
    if (this.lastPeriodicFireDate['morning_review'] === today) return null

    // 回忆最近一条自传/情景记忆作为"昨天我们聊过"的素材
    const morningMem =
      this.autobiographicalMemory.slice(-1)[0] ??
      this.episodicMemory.slice(-1)[0]
    if (morningMem) {
      // 标记今天已触发，避免后续消息重复触发
      this.lastPeriodicFireDate['morning_review'] = today
      // P2-3：根据时段生成不同问候
      const hour = new Date().getHours()
      let greeting: string
      if (hour >= 5 && hour < 9) {
        greeting = '早安～新的一天开始了！上次我们聊过...'
      } else if (hour >= 9 && hour < 12) {
        greeting = '上午好呀～上次我们聊到...'
      } else if (hour >= 12 && hour < 14) {
        greeting = '中午好～吃过饭了吗？上次我们聊过...'
      } else if (hour >= 14 && hour < 18) {
        greeting = '下午好～还记得上次我们聊到...'
      } else if (hour >= 18 && hour < 22) {
        greeting = '晚上好～今天过得怎么样？上次我们聊过...'
      } else {
        greeting = '夜深了还没睡呀～上次我们聊到...'
      }
      return {
        type: 'time',
        memories: [morningMem],
        message: greeting,
      }
    }
    return null
  }

  // ============ 构建上下文 ============

  async buildContext(query: string): Promise<string> {
    const parts: string[] = []

    // 第四层：自传记忆
    if (this.autobiographicalMemory.length > 0) {
      const auto = this.autobiographicalMemory
        .slice(-3)
        .map((m) => `[${m.category}] ${m.user.slice(0, 80)}`)
        .join('\n')
      parts.push(`【重要记忆】\n${auto}`)
    }

    // 第三层：语义记忆（摘要）
    if (this.semanticMemory) {
      parts.push(`【长期摘要】\n${this.semanticMemory}`)
    }

    // 第二层：情景记忆（向量检索相关历史）
    const retrieved = await this.searchEpisodic(query, 5)
    if (retrieved.length > 0) {
      const recalled = retrieved
        .map((e) => `用户：${e.user}\n角色：${e.assistant}`)
        .join('\n---\n')
      parts.push(`【相关历史回忆】\n${recalled}`)
    }

    // 第一层：工作记忆（最近上下文）
    if (this.workingMemory.length > 0) {
      const recent = this.workingMemory
        .slice(-3)
        .map((e) => `用户：${e.user}\n角色：${e.assistant}`)
        .join('\n---\n')
      parts.push(`【最近对话】\n${recent}`)
    }

    return parts.join('\n\n')
  }

  // ============ 记忆生命周期分层 ============
  // 根据创建时间计算记忆所属的层级
  // 热（最近 1 天）：完整保留
  // 温（1-7 天）：保留摘要
  // 冷（7-30 天）：仅保留关键词
  // 归档（>30 天）：仅保留标题
  private getMemoryTier(memory: EnhancedMemory): MemoryTier {
    const daysSince = (Date.now() - new Date(memory.created_at).getTime()) / 86400000
    if (daysSince < 1) return 'hot'
    if (daysSince < 7) return 'warm'
    if (daysSince < 30) return 'cold'
    return 'archived'
  }

  // ============ 按层级格式化记忆条目 ============
  // 热记忆：完整用户+角色内容
  // 温记忆：截断摘要（各 50 字）
  // 冷记忆：仅保留关键词 tags
  // 归档记忆：仅保留标题（前 20 字）
  private formatMemoryByTier(mem: EnhancedMemory): string {
    const tier = this.getMemoryTier(mem)
    switch (tier) {
      case 'hot':
        return `用户：${mem.user}\n角色：${mem.assistant}`
      case 'warm':
        return `用户：${mem.user.slice(0, 50)}${mem.user.length > 50 ? '…' : ''}\n角色：${mem.assistant.slice(0, 50)}${mem.assistant.length > 50 ? '…' : ''}`
      case 'cold':
        return `关键词：${mem.tags.length > 0 ? mem.tags.join('、') : mem.user.slice(0, 20)}`
      case 'archived':
      default:
        return `标题：${mem.user.slice(0, 20)}${mem.user.length > 20 ? '…' : ''}`
    }
  }

  // ============ 按层级格式化核心记忆（自传记忆）============
  private formatCoreMemoryByTier(mem: EnhancedMemory): string {
    const tier = this.getMemoryTier(mem)
    const prefix = `[${mem.category}]`
    switch (tier) {
      case 'hot':
      case 'warm':
        return `${prefix} ${mem.user.slice(0, 80)}${mem.user.length > 80 ? '…' : ''}`
      case 'cold':
        return `${prefix} 关键词：${mem.tags.length > 0 ? mem.tags.join('、') : mem.user.slice(0, 20)}`
      case 'archived':
      default:
        return `${prefix} ${mem.user.slice(0, 20)}${mem.user.length > 20 ? '…' : ''}`
    }
  }

  // ============ 对话上下文构建（四段式 + token 预算）============
  // 按优先级组装：即时 > 短期 > 长期 > 核心
  // 总 token 不超过 tokenBudget
  async getContextForChat(tokenBudget: number, query?: string): Promise<string> {
    const parts: string[] = []
    let usedTokens = 0

    const tryAddSection = (section: string): boolean => {
      const sectionTokens = estimateTokens(section)
      if (usedTokens + sectionTokens > tokenBudget) return false
      parts.push(section)
      usedTokens += sectionTokens
      return true
    }

    // 1. 即时记忆（immediate）：最近 N 轮对话（工作记忆）
    //    优先级最高，完整保留热记忆内容
    if (this.workingMemory.length > 0) {
      const immediate = this.workingMemory
        .slice(-5)
        .map((e) => this.formatMemoryByTier(e))
        .join('\n---\n')
      tryAddSection(`【即时记忆】\n${immediate}`)
    }

    // 2. 短期记忆（short-term）：近期压缩摘要（情景记忆）
    //    按 query 向量检索相关历史，否则取最近 5 条
    //    P0-5：对已注入过的记忆做 24h 冷却，避免同一回忆每轮都重复出现（复读感）。
    if (this.episodicMemory.length > 0 && usedTokens < tokenBudget) {
      const retrieved = query
        ? await this.retrieve(query, 5, { purpose: 'chat' })
        : this.episodicMemory.slice(-5)
      // 冷却过滤：跳过 INJECTION_COOLDOWN_MS 内已注入的记忆
      const cooled = retrieved.filter((m) => {
        const last = this.injectedAt.get(m.id) ?? 0
        return Date.now() - last >= INJECTION_COOLDOWN_MS
      })
      // 全部在冷却中时，放宽限制：保留检索分数最高的 1 条（避免完全无相关记忆）
      const toInject = cooled.length > 0 ? cooled : retrieved.slice(0, 1)
      // 记录本次注入时间，供后续轮次冷却判断
      for (const m of toInject) this.injectedAt.set(m.id, Date.now())
      if (toInject.length > 0) {
        const shortTerm = toInject
          .map((e) => this.formatMemoryByTier(e))
          .join('\n---\n')
        tryAddSection(`【短期记忆】\n${shortTerm}`)
      }
    }

    // 3. 长期记忆（long-term）：历史摘要（语义记忆）
    if (this.semanticMemory && usedTokens < tokenBudget) {
      // 长期摘要可能很长，按剩余预算截断
      const remainingBudget = tokenBudget - usedTokens
      const maxChars = Math.max(100, remainingBudget * 3) // 粗略 token→char 转换
      const summary = this.semanticMemory.length > maxChars
        ? this.semanticMemory.slice(0, maxChars) + '…'
        : this.semanticMemory
      tryAddSection(`【长期记忆】\n${summary}`)
    }

    // 4. 核心记忆（core）：用户核心信息/偏好（自传记忆）
    //    优先级最低，按重要度排序
    if (this.autobiographicalMemory.length > 0 && usedTokens < tokenBudget) {
      const core = this.autobiographicalMemory
        .slice()
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 5)
        .map((e) => this.formatCoreMemoryByTier(e))
        .join('\n')
      tryAddSection(`【核心记忆】\n${core}`)
    }

    return parts.join('\n\n')
  }

  // ============ S3：统一检索入口 ============

  /**
   * P1-2：公共多因子加权函数——RAG/向量/LCS 三条路径统一调用
   * F2 修正：moodFit 改为接收当前情绪参数，公式改为 1-|mood.valence-mem.valence|
   *
   * 公式：baseScore * 0.5 + recency * 0.15 + importance * 0.3
   *       + emotionalBoost + temporalBoost + moodFit - traumaPenalty
   *
   * @param baseScore 基础检索分（RRF 归一化 / 向量余弦 / LCS 重叠比）
   * @param mem 待评分记忆
   * @param query 原始查询（用于检测时间词）
   * @param now 当前时间戳
   * @param currentMood 用户当前情绪（可选，{valence, arousal}）
   * @returns 加权后的综合分数
   */
  private computeMultiFactorScore(
    baseScore: number,
    mem: EnhancedMemory,
    query: string,
    now: number,
    currentMood?: { valence: number; arousal: number },
  ): number {
    const recency = mem.lastAccessed > 0
      ? 1 / (1 + (now - mem.lastAccessed) / 86400000)
      : 0.1
    const importance = mem.importance / 100
    const emotionalBoost = mem.emotionalIntensity * 0.2

    // P4-3：Temporal Reasoning — 查询包含时间词时，含时间标记的记忆获得加成
    const TIME_KEYWORD_RE = /今天|昨天|明天|上周|下周|这个月|去年|今年|明年|以前|之前|之后/
    const hasTimeQuery = TIME_KEYWORD_RE.test(query)
    const temporalBoost = hasTimeQuery && mem.tags.some(t => TIME_KEYWORD_RE.test(t))
      ? 0.1
      : 0

    // F2 修正：情绪一致性——主人当前情绪与记忆情绪越贴近越易被想起
    // 旧公式 1-|mem.valence| 奖励的是"中性记忆"，而非"情绪一致的记忆"
    // 新公式 1-|mood.valence - mem.valence|，当 currentMood 可用时使用
    let moodFit = 0
    if (currentMood && mem.emotionalValence !== undefined) {
      moodFit = Math.max(0, 1 - Math.abs(currentMood.valence - mem.emotionalValence)) * 0.15
    }

    // W1：低 valence 高 arousal（创伤/冲突类）默认降权
    const traumaPenalty =
      (mem.emotionalValence ?? 0) < -0.5 && (mem.emotionalArousal ?? 0) > 0.6 ? 0.1 : 0

    return baseScore * 0.5
      + recency * 0.15
      + importance * 0.3
      + emotionalBoost
      + temporalBoost
      + moodFit
      - traumaPenalty
  }

  /**
   * S3：统一检索 API —— checkTriggers 与 getContextForChat 共享同一次检索结果
   * 消除 D7（每轮对话两次向量检索无复用）
   *
   * @param query 查询文本
   * @param limit 返回条数
   * @param _opts 选项（purpose 用于去重策略，预留接口暂未实现）
   * @returns 检索到的记忆列表（按相关性排序）
   */
  async retrieve(query: string, limit: number = 5, _opts?: { purpose?: 'chat' | 'trigger' | 'proactive' }): Promise<EnhancedMemory[]> {
    if (!query || query.trim().length === 0) return []

    // S3：同一查询 5 秒内复用缓存结果（消除 D7）
    const now = Date.now()
    if (this.lastRetrievalQuery === query && now - this.lastRetrievalTimestamp < 5_000) {
      return this.lastRetrievalResult.slice(0, limit)
    }

    const results = await this.searchEpisodic(query, Math.max(limit, 5))

    // 缓存结果
    this.lastRetrievalQuery = query
    this.lastRetrievalResult = results
    this.lastRetrievalTimestamp = now

    return results.slice(0, limit)
  }

  // ============ 情景记忆检索（P3-1：RAG 混合检索优先，LCS fallback）============

  /**
   * P3-1：构建/重建 RAG 混合检索索引（公开方法，供外部定时调用）
   */
  buildRAGIndex(): void {
    if (!this.ragRetriever) return
    const allMemories = [...this.episodicMemory, ...this.autobiographicalMemory]
    if (allMemories.length === 0) {
      this.ragIndexBuilt = false
      return
    }
    void this.ragRetriever.buildIndex(allMemories, this.embeddingCache).then(() => {
      this.ragIndexBuilt = true
    }).catch(() => {
      this.ragIndexBuilt = false
    })
  }

  private async searchEpisodic(query: string, limit: number): Promise<EnhancedMemory[]> {
    if (this.episodicMemory.length === 0 || !query) return []
    const queryTokens = new Set(tokenize(query))
    if (queryTokens.size === 0) return this.episodicMemory.slice(-limit)

    // F2：尝试获取当前用户情绪，传入 moodFit 计算
    const currentMood = this.getCurrentMood()

    // P3-1：优先使用 RAG 混合检索（BM25+向量+RRF 多信号融合）
    if (this.ragIndexBuilt && this.ragRetriever) {
      try {
        const ragResults: RAGResult[] = await this.ragRetriever.retrieve(query, this.embeddingCache)
        if (ragResults.length > 0) {
          // P1-2：使用公共多因子加权函数，与向量/LCS 路径保持一致
          const now = Date.now()
          const scored = ragResults.map((r) => {
            const mem = r.memory
            // S3 修复：RRF 分数归一化到 0-1 再参与融合
            const normalizedRRF = Math.min(1, r.score * 61) // rrfK+1 = 61
            // F2：传入 currentMood
            const fusedScore = this.computeMultiFactorScore(normalizedRRF, mem, query, now, currentMood)
            return { mem, fusedScore }
          }).sort((a, b) => b.fusedScore - a.fusedScore)

          // F7：接入 entityLinking——通过实体名查找关联记忆，补充到结果中
          const entityLinked = await this.getEntityLinkedMemories(query, limit)
          const existingIds = new Set(scored.map(s => s.mem.id))
          const entityExtras = entityLinked
            .filter(m => !existingIds.has(m.id))
            .map(mem => ({
              mem,
              fusedScore: this.computeMultiFactorScore(0.3, mem, query, now, currentMood),
            }))
          // T-5：接入视觉记忆——最近的视觉快照与查询语义相关时并入（观察类线索）
          const visualExtras = (await this.getVisualMemoryCandidates(query, limit))
            .filter(m => !existingIds.has(m.id))
            .map(mem => ({
              mem,
              fusedScore: this.computeMultiFactorScore(0.25, mem, query, now, currentMood),
            }))
          const merged = [...scored, ...entityExtras, ...visualExtras]
            .sort((a, b) => b.fusedScore - a.fusedScore)
            .slice(0, limit)

          return merged.map(({ mem }) => {
            mem.accessCount++
            mem.lastAccessed = now
            // W3：成功回忆增强记忆强度（类 SM-2 递增间隔）
            mem.strength = Math.min((mem.strength ?? 1) * 1.6 + 0.5, 30)
            if (mem.dbId !== undefined) {
              void updateMemoryLastAccessed(mem.dbId)
            }
            return mem
          })
        }
      } catch {
        // RAG 检索失败，继续使用向量/LCS 回退
      }
    }

    // 次选：向量检索
    const vectorResults = await this.vectorSearchInMemories(query, this.episodicMemory, limit)
    if (vectorResults.length > 0) return vectorResults

    // Fallback: LCS + 关键词检索（原始逻辑）
    const queryLower = query.toLowerCase()
    const scored = this.episodicMemory.map((mem) => {
      const text = `${mem.user} ${mem.assistant}`.toLowerCase()
      let overlap = 0
      queryTokens.forEach((t) => {
        if (text.includes(t)) overlap++
      })
      const ratio = stringSimilarity(queryLower, text.slice(0, 800))
      const recency = mem.lastAccessed ? 1 / (1 + (Date.now() - mem.lastAccessed) / 86400000) : 0.1
      const importance = mem.importance / 100
      const score = overlap * 2.0 + ratio + recency * 0.15 + importance * 0.3
      return { mem, score }
    })

    return scored
      .filter((s) => s.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => {
        s.mem.accessCount++
        s.mem.lastAccessed = Date.now()
        return s.mem
      })
  }

  // ============ 获取所有记忆（UI使用）============

  getAllMemories(): EnhancedMemory[] {
    return [
      ...this.autobiographicalMemory,
      ...this.episodicMemory,
      ...this.workingMemory,
    ]
  }

  getAutobiographicalMemories(): EnhancedMemory[] {
    return [...this.autobiographicalMemory]
  }

  getEpisodicMemories(): EnhancedMemory[] {
    return [...this.episodicMemory]
  }

  // 获取工作记忆（即时记忆，最近 N 轮对话）
  getWorkingMemories(): EnhancedMemory[] {
    return [...this.workingMemory]
  }

  getSemanticSummary(): string {
    return this.semanticMemory
  }

  // ============ 搜索记忆 ============

  search(query: string): EnhancedMemory[] {
    const all = this.getAllMemories()
    if (!query) return all
    const queryLower = query.toLowerCase()
    return all.filter((m) =>
      m.user.toLowerCase().includes(queryLower) ||
      m.assistant.toLowerCase().includes(queryLower) ||
      m.tags.some((t) => t.includes(queryLower)),
    )
  }

  // ============ 删除记忆 ============

  deleteMemory(id: string): void {
    // P0-3 修复：删除时同步清理 SQLite memories 表的对应行（含 embedding BLOB）。
    // 旧实现只过滤内存数组，留下孤儿 SQLite 行，导致 DB 无限增长、LIMIT 1000 候选集被挤占。
    // 在过滤前先收集要删除的 dbId，异步删除（不阻塞调用方）。
    const toRemove: EnhancedMemory[] = []
    for (const pool of [this.workingMemory, this.episodicMemory, this.autobiographicalMemory]) {
      for (const m of pool) {
        if (m.id === id) toRemove.push(m)
      }
    }
    this.workingMemory = this.workingMemory.filter((m) => m.id !== id)
    this.episodicMemory = this.episodicMemory.filter((m) => m.id !== id)
    this.autobiographicalMemory = this.autobiographicalMemory.filter((m) => m.id !== id)
    // 删除记忆可能改变最早日期，使缓存失效
    this.firstInteractionDateCache = undefined
    // 同步清理 embedding 缓存与 SQLite 行
    for (const m of toRemove) {
      if (m.dbId !== undefined) {
        this.embeddingCache.delete(m.dbId)
        void deleteMemoryRow(m.dbId)
      }
      // P0-5：清理注入冷却记录
      this.injectedAt.delete(m.id)
    }
    this.scheduleSave()
  }

  // ============ D2 修复：孤儿行治理 ============
  // 统一清理被移除记忆的 SQLite 行 + embedding 缓存 + RAG 索引
  private purgeMemoriesFromStore(memories: EnhancedMemory[]): void {
    for (const m of memories) {
      if (m.dbId !== undefined) {
        this.embeddingCache.delete(m.dbId)
        void deleteMemoryRow(m.dbId)
      }
      this.injectedAt.delete(m.id)
      if (this.ragRetriever) {
        this.ragRetriever.removeMemory(m.id)
      }
    }
  }

  // ============ 衰减处理 ============
  // F3 修正：废弃档位式 decayFactor，统一由 calculateForgettingScore（含 strength）决定遗忘
  // decayFactor 字段保留用于 UI 展示，但不再参与排序或检索
  applyDecay(): void {
    const config = this.categoryConfig

    // F3：统一使用 calculateForgettingScore 作为唯一衰减模型
    // 对所有记忆池计算 forgetScore，用于决定是否清理
    const decayedToRemove: EnhancedMemory[] = []
    this.episodicMemory = this.episodicMemory.filter((m) => {
      const score = calculateForgettingScore(m, config)
      // F3：使用 forgetScore 决定是否清理（替代旧的 tier==='archived' && importance<30）
      if (score.shouldForget) {
        decayedToRemove.push(m)
        return false
      }
      // F3：decayFactor 改为从 forgetScore 派生（仅用于 UI/调试，不参与排序）
      m.decayFactor = 1 - score.forgetScore
      return true
    })

    // 对工作记忆和自传记忆也计算 forgetScore（但阈值更高，不轻易清理）
    this.workingMemory.forEach((m) => {
      const score = calculateForgettingScore(m, config)
      m.decayFactor = 1 - score.forgetScore
    })
    this.autobiographicalMemory.forEach((m) => {
      const score = calculateForgettingScore(m, config)
      m.decayFactor = 1 - score.forgetScore
    })

    if (decayedToRemove.length > 0) {
      this.purgeMemoriesFromStore(decayedToRemove)
    }

    this.scheduleSave()
  }

  // ============ 清空 ============

  clear(): void {
    // 清理防抖定时器
    if (this.saveDebounceTimer !== null) {
      clearTimeout(this.saveDebounceTimer)
      this.saveDebounceTimer = null
    }
    this.needsSave = false
    this.workingMemory = []
    this.episodicMemory = []
    this.semanticMemory = ''
    this.autobiographicalMemory = []
    this.topicFrequency.clear()
    this.triggerLog = []
    this.ignoreCount = {}
    this.lastPeriodicFireDate = {}
    this.pendingPeriodicEventKey = null
    // P0-2 / P0-5：清空时一并重置对话日期与注入冷却
    this.lastChatDate = null
    this.injectedAt = new Map()
    // 清除向量检索缓存
    this.embeddingCache.clear()
    this.embeddingsLoaded = false
    this.vectorAvailable = null
    this.vectorAvailableCheckedAt = 0
    // 清空后重置首次互动日期缓存
    this.firstInteractionDateCache = null
    // P0-3 修复：清空时同步删除该角色在 SQLite memories 表的全部行（含 embedding），
    // 避免孤儿数据在新记忆写入后再次被加载回来。
    // S2: 行级路径下同时清理 memory_summaries + memory_state
    if (this.useRowLevelStorage) {
      void clearAllMemoryData(this.characterId)
    } else {
      void clearMemoryRows(this.characterId)
    }
    void this.forceSave()
  }

  // ============ 向量记忆扩展 — 参考 AI-Desktop-Pet memory.py ============
  // LLM 自主写入记忆 + 时间衰减排序 + 记忆合并

  /**
   * F7：通过实体名查找关联的记忆
   * 从 entityLinking 的 EntityManager 获取实体关联的记忆 ID，
   * 然后在 episodicMemory 中找到对应记忆
   * 注意：await ensureLoaded() 避免首次访问时实体表尚未异步加载完成的竞态
   */
  private async getEntityLinkedMemories(query: string, limit: number): Promise<EnhancedMemory[]> {
    try {
      const mgr = getEntityManager(this.characterId)
      await mgr.ensureLoaded()
      // 从查询中提取可能的实体名（简单分词后查实体表）
      const queryTokens = tokenize(query)
      const linkedIds = new Set<string>()
      for (const token of queryTokens) {
        const ids = mgr.getLinkedMemoryIds(token)
        ids.forEach(id => linkedIds.add(id))
      }
      if (linkedIds.size === 0) return []
      // 在所有记忆池中查找匹配的记忆
      const allMemories = [...this.episodicMemory, ...this.autobiographicalMemory, ...this.workingMemory]
      return allMemories
        .filter(m => linkedIds.has(m.id))
        .slice(0, limit)
    } catch {
      // entityLinking 不可用时返回空
      return []
    }
  }

  /**
   * T-5：将最近的视觉记忆并入检索（观察类线索）
   * 从 visualMemoryManager 取最近快照，与查询做字符串相似度匹配；
   * 命中的视觉快照以 sourceKind='observation' 的临时记忆条目参与排序。
   * 动态 import 避免模块加载时序问题；任何失败静默降级。
   */
  private async getVisualMemoryCandidates(query: string, limit: number): Promise<EnhancedMemory[]> {
    try {
      const { getVisualMemoryManager } = await import('./visualMemoryManager')
      const vmMgr = getVisualMemoryManager(this.characterId)
      await vmMgr.ensureLoaded()
      const recent = vmMgr.getRecent(5)
      if (recent.length === 0) return []
      const queryLower = query.toLowerCase()
      return recent
        .filter((m) => stringSimilarity(queryLower, m.description.toLowerCase().slice(0, 200)) > 0.2)
        .slice(0, limit)
        .map((m) => {
          const mem: EnhancedMemory = {
            id: `visual_${m.id}`,
            created_at: new Date(m.timestamp).toISOString(),
            user: m.description,
            assistant: '',
            importance: 40,
            emotionalIntensity: 0,
            category: '感知',
            tags: [m.type],
            accessCount: 0,
            lastAccessed: m.timestamp,
            decayFactor: 1.0,
            isAutobiographical: false,
            sourceKind: 'observation',
          }
          return mem
        })
    } catch {
      // 视觉记忆不可用时返回空
      return []
    }
  }

  /**
   * F2/F7：获取当前用户情绪
   * 从 emotionExtractor 解析出的情绪标签或记忆侧的规则层获取
   * 返回 {valence, arousal} 或 undefined
   */
  /**
   * 获取当前用户情绪（从最近工作记忆推断）
   * T-3: 公开方法，供 RecallEngine 等外部模块使用
   */
  getCurrentMood(): { valence: number; arousal: number } | undefined {
    try {
      // F11 修正：使用静态 import 而非 require()
      // contextAwareness 可能不直接提供情绪，用最近交互的情绪推断
      // 简化实现：从最近的工作记忆中取平均 valence/arousal
      if (this.workingMemory.length > 0) {
        const recent = this.workingMemory.slice(-3)
        let totalV = 0, totalA = 0, count = 0
        for (const m of recent) {
          if (m.emotionalValence !== undefined) {
            totalV += m.emotionalValence
            totalA += m.emotionalArousal ?? 0
            count++
          }
        }
        if (count > 0) {
          return { valence: totalV / count, arousal: totalA / count }
        }
      }
      return undefined
    } catch {
      return undefined
    }
  }

  // T-14: timeDecaySort 已删除（无调用点，已废弃委托 calculateForgettingScore）

  // F3 修正：calculateDecayWeight 已废弃，统一使用 calculateForgettingScore

  /**
   * 合并相似记忆 — 减少冗余
   * 当两条记忆的文本相似度 > 0.7 时，合并为一条
   *
   * 优化：
   * 1. 快速长度过滤：长度差异超过 50% 的文本直接跳过（不可能高相似）
   * 2. 类别/标签预过滤：同类别或有共同标签才进行精确比较
   * 3. 实际 LCS 计算次数减少约 60-80%（在典型数据下）
   */
  mergeSimilarMemories(): number {
    const merged: EnhancedMemory[] = []
    let mergeCount = 0
    const all = [...this.episodicMemory, ...this.autobiographicalMemory]
    const used = new Set<number>()

    for (let i = 0; i < all.length; i++) {
      if (used.has(i)) continue
      let best = all[i]!
      const bestText = best.user
      const bestLen = bestText.length
      const bestCat = best.category
      const bestTags = new Set(best.tags)

      for (let j = i + 1; j < all.length; j++) {
        if (used.has(j)) continue
        const candidate = all[j]!
        const candText = candidate.user
        const candLen = candText.length

        // 快速路径1：长度差异过滤 — 长度差 > 50% 不可能达到 0.7 相似度
        const minLen = Math.min(bestLen, candLen)
        const maxLen = Math.max(bestLen, candLen)
        if (minLen / maxLen < 0.5) continue

        // 快速路径2：空文本跳过
        if (minLen === 0) continue

        // 快速路径3：类别或标签预过滤（有交集才继续）
        // 如果类别不同且没有共同标签，跳过精确比较
        const hasCommonTag = candidate.tags.some((t) => bestTags.has(t))
        if (bestCat !== candidate.category && !hasCommonTag && bestLen > 10 && candLen > 10) {
          continue
        }

        // 精确相似度计算
        const sim = stringSimilarity(bestText, candText)
        if (sim > 0.7) {
          // 合并：取更长的版本，更新时间戳和重要性
          if (candText.length > bestText.length) {
            best = candidate
          }
          best = {
            ...best,
            importance: Math.max(best.importance, candidate.importance),
            accessCount: best.accessCount + candidate.accessCount,
            lastAccessed: Math.max(best.lastAccessed ?? 0, candidate.lastAccessed ?? 0),
          }
          used.add(j)
          mergeCount++
        }
      }
      merged.push(best)
    }

    if (mergeCount > 0) {
      // D2 修复：收集被合并丢弃的记忆，同步删除 SQLite 孤儿行 + embedding + RAG 索引
      const mergedAwayMemories: EnhancedMemory[] = []
      for (let i = 0; i < all.length; i++) {
        if (used.has(i)) mergedAwayMemories.push(all[i]!)
      }
      this.purgeMemoriesFromStore(mergedAwayMemories)
      // 重新分配合并后的记忆到各层
      this.episodicMemory = merged.filter(m => !m.isAutobiographical).slice(-50)
      this.autobiographicalMemory = merged.filter(m => m.isAutobiographical).slice(-20)
      // 记忆合并可能删除内容，使首次互动日期缓存失效
      this.firstInteractionDateCache = undefined
      this.scheduleSave()
    }

    return mergeCount
  }

  // ============ 导出/导入 ============

  export(): string {
    return JSON.stringify({
      workingMemory: this.workingMemory,
      episodicMemory: this.episodicMemory,
      semanticMemory: this.semanticMemory,
      autobiographicalMemory: this.autobiographicalMemory,
      triggerLog: this.triggerLog,
      ignoreCount: this.ignoreCount,
      lastPeriodicFireDate: this.lastPeriodicFireDate,
      // P1-1 修复：导出 lastChatDate，使备份恢复后"新的一天"判定不失效
      lastChatDate: this.lastChatDate,
      // P1-1 修复：导出注入冷却表，使恢复后记忆不会在冷却期内被重复注入
      injectedAt: Array.from(this.injectedAt.entries()),
      // P1-1 修复：导出 LLM 已重评集合，避免恢复后重复重评
      llmReassessedIds: Array.from(this.llmReassessedIds),
    }, null, 2)
  }

  import(jsonStr: string): boolean {
    try {
      const data = JSON.parse(jsonStr)
      // 清理防抖定时器
      if (this.saveDebounceTimer !== null) {
        clearTimeout(this.saveDebounceTimer)
        this.saveDebounceTimer = null
      }
      this.needsSave = false
      this.workingMemory = data.workingMemory ?? []
      this.episodicMemory = data.episodicMemory ?? []
      this.semanticMemory = data.semanticMemory ?? ''
      this.autobiographicalMemory = data.autobiographicalMemory ?? []
      this.triggerLog = data.triggerLog ?? []
      this.ignoreCount = data.ignoreCount ?? {}
      this.lastPeriodicFireDate = data.lastPeriodicFireDate ?? {}
      // P1-1 修复：恢复 lastChatDate，使"新的一天"判定跨备份/恢复有效
      this.lastChatDate = data.lastChatDate ?? null
      // P1-1 修复：恢复注入冷却表
      if (Array.isArray(data.injectedAt)) {
        this.injectedAt = new Map(data.injectedAt)
      }
      // P1-1 修复：恢复 LLM 已重评集合
      if (Array.isArray(data.llmReassessedIds)) {
        this.llmReassessedIds = new Set(data.llmReassessedIds)
      }
      // 导入后重置首次互动日期缓存，下次访问时重新计算
      this.firstInteractionDateCache = undefined
      void this.forceSave()
      return true
    } catch {
      return false
    }
  }

  // ============ 记忆分类系统增强 ============
  // 遗忘机制、自动晋升、LLM 巩固

  /** 分类配置 */
  private categoryConfig: MemoryCategoryConfig = DEFAULT_CATEGORY_CONFIG
  /** 晋升事件日志 */
  private promotionLog: PromotionEvent[] = []
  /** 巩固事件日志 */
  private consolidationLog: ConsolidationEvent[] = []
  /** 上次巩固时间戳 */
  private lastConsolidationAt = 0
  // W2：已 LLM 重评的记忆 ID 集合
  private llmReassessedIds: Set<string> = new Set()

  /**
   * 执行遗忘机制：基于艾宾浩斯遗忘曲线清理低价值记忆
   * @returns 被遗忘的记忆 ID 列表
   */
  applyForgetting(): string[] {
    const forgotten: string[] = []
    const forgottenMemories: EnhancedMemory[] = []
    const config = this.categoryConfig

    // 对情景记忆执行遗忘检查
    this.episodicMemory = this.episodicMemory.filter((mem) => {
      const score = calculateForgettingScore(mem, config)
      if (score.shouldForget) {
        forgotten.push(mem.id)
        forgottenMemories.push(mem)
        return false
      }
      return true
    })

    // 对工作记忆也执行遗忘（阈值更高）
    this.workingMemory = this.workingMemory.filter((mem) => {
      const score = calculateForgettingScore(mem, config)
      if (score.forgetScore > 0.9 && mem.importance < config.forgetMinImportance) {
        forgotten.push(mem.id)
        forgottenMemories.push(mem)
        return false
      }
      return true
    })

    if (forgotten.length > 0) {
      // D2 修复：同步删除 SQLite 孤儿行 + embedding + RAG 索引
      this.purgeMemoriesFromStore(forgottenMemories)
      // 遗忘删除记忆，使首次互动日期缓存失效
      this.firstInteractionDateCache = undefined
      this.scheduleSave()
    }

    return forgotten
  }

  /**
   * 执行自动晋升：将符合条件的短期记忆晋升为长期
   * 条件：访问次数 >= 阈值 且 重要度 >= 30
   * @returns 晋升事件列表
   */
  applyPromotion(): PromotionEvent[] {
    const events: PromotionEvent[] = []
    const config = this.categoryConfig

    // P1-3 修复：收集要晋升的记忆，循环结束后统一从 episodicMemory 移除，避免遍历中修改数组。
    const promotedIds = new Set<string>()
    for (const mem of this.episodicMemory) {
      if (shouldPromoteToLongTerm(mem, config)) {
        // P1-3 修复：先记录晋升前的 accessCount 用于日志，再重置为 0。
        const accessCountBeforeReset = mem.accessCount
        // 晋升为长期记忆：增加重要度并标记为自传记忆
        mem.importance = calculateImportanceScore(mem)
        mem.isAutobiographical = true
        mem.accessCount = 0 // 重置访问计数（晋升后作为长期记忆重新计数）

        // 移入自传记忆（避免重复）
        if (!this.autobiographicalMemory.some((m) => m.id === mem.id)) {
          this.autobiographicalMemory.push(mem)
        }
        // P1-3 修复：标记为已晋升，循环结束后从 episodicMemory 移除源记忆，
        // 避免同一对象同时存在于 episodic 和 autobiographical 两层（getAllMemories 重复）。
        promotedIds.add(mem.id)

        // S2: 行级路径下更新 SQLite 行的 tier + is_autobiographical + importance + access_count
        if (this.useRowLevelStorage && mem.dbId !== undefined) {
          void updateMemoryRow(mem.dbId, {
            tier: 'autobiographical',
            is_autobiographical: 1,
            importance: mem.importance,
            access_count: 0,
          })
        }

        const event: PromotionEvent = {
          memoryId: mem.id,
          fromCategory: 'SHORT_TERM' as MemoryCategory,
          toCategory: 'LONG_TERM' as MemoryCategory,
          // P1-3 修复：使用晋升前的 accessCount，否则日志恒为"访问 0 次"。
          reason: `访问${accessCountBeforeReset}次且重要度${mem.importance}`,
          timestamp: Date.now(),
        }
        events.push(event)
        this.promotionLog.push(event)
      }
    }
    // P1-3 修复：统一移除已晋升的记忆
    if (promotedIds.size > 0) {
      this.episodicMemory = this.episodicMemory.filter((m) => !promotedIds.has(m.id))
    }

    // 自传记忆超出容量时保留最重要的
    if (this.autobiographicalMemory.length > config.longTermCapacity) {
      this.autobiographicalMemory.sort((a, b) => b.importance - a.importance)
      this.autobiographicalMemory = this.autobiographicalMemory.slice(0, config.longTermCapacity)
    }

    // 限制晋升日志大小
    if (this.promotionLog.length > 100) {
      this.promotionLog = this.promotionLog.slice(-50)
    }

    if (events.length > 0) {
      this.scheduleSave()
    }

    return events
  }

  /**
   * 执行记忆巩固：通过 LLM 将情景记忆摘要为语义记忆
   * EPISODIC → SEMANTIC
   *
   * @param llmSummarizer LLM 摘要函数（可选，不传则使用简单拼接摘要）
   * @returns 巩固事件（null 表示未执行）
   */
  async applyConsolidation(
    llmSummarizer?: (memories: EnhancedMemory[]) => Promise<string>,
  ): Promise<ConsolidationEvent | null> {
    const config = this.categoryConfig
    const now = Date.now()

    // 检查巩固间隔
    if (now - this.lastConsolidationAt < config.consolidationIntervalMs) {
      return null
    }

    // 选取需要巩固的情景记忆（重要度低且超过 7 天的旧记忆）
    const DAY_MS = 86400000
    const candidates = this.episodicMemory.filter((mem) => {
      const age = (now - new Date(mem.created_at).getTime()) / DAY_MS
      return age >= 7 && !mem.isAutobiographical
    })

    if (candidates.length < 3) {
      return null // 至少 3 条才能巩固
    }

    let summary: string

    if (llmSummarizer) {
      // 使用 LLM 生成摘要
      try {
        summary = await llmSummarizer(candidates)
      } catch {
        // LLM 失败，回退到简单摘要
        summary = this.generateSimpleSummary(candidates)
      }
    } else {
      // 简单拼接摘要
      summary = this.generateSimpleSummary(candidates)
    }

    // 将摘要追加到语义记忆
    this.semanticMemory = `${this.semanticMemory} [${new Date().toISOString()}] ${summary}`.trim()
    // 语义记忆长度限制
    if (this.semanticMemory.length > this.categoryConfig.semanticConsolidationMaxChars) {
      this.semanticMemory = this.semanticMemory.slice(-this.categoryConfig.semanticConsolidationMaxChars)
    }

    // 从情景记忆中移除已巩固的记忆
    // D2 修复：同步删除 SQLite 孤儿行 + embedding + RAG 索引
    const consolidatedIds = new Set(candidates.map((m) => m.id))
    this.purgeMemoriesFromStore(candidates)
    this.episodicMemory = this.episodicMemory.filter((m) => !consolidatedIds.has(m.id))

    const event: ConsolidationEvent = {
      sourceIds: candidates.map((m) => m.id),
      summary,
      timestamp: now,
    }
    this.consolidationLog.push(event)
    this.lastConsolidationAt = now

    // 限制巩固日志大小
    if (this.consolidationLog.length > 50) {
      this.consolidationLog = this.consolidationLog.slice(-20)
    }

    // 巩固删除了情景记忆，使首次互动日期缓存失效
    this.firstInteractionDateCache = undefined
    this.scheduleSave()
    return event
  }

  /** 简单拼接摘要（LLM 不可用时的回退） */
  private generateSimpleSummary(memories: EnhancedMemory[]): string {
    return memories
      .map((m) => `[${m.category}] ${m.user.slice(0, 60)}`)
      .join('；')
  }

  /** 获取晋升事件日志 */
  getPromotionLog(): PromotionEvent[] {
    return [...this.promotionLog]
  }

  /** 获取巩固事件日志 */
  getConsolidationLog(): ConsolidationEvent[] {
    return [...this.consolidationLog]
  }

  /** 更新分类配置 */
  setCategoryConfig(config: Partial<MemoryCategoryConfig>): void {
    this.categoryConfig = { ...this.categoryConfig, ...config }
  }

  /** 获取分类配置 */
  getCategoryConfig(): MemoryCategoryConfig {
    return { ...this.categoryConfig }
  }

  /**
   * 一次性执行记忆维护：遗忘 + 晋升 + 巩固
   * @param llmSummarizer LLM 摘要函数（可选）
   * @returns 维护结果
   */
  async maintainMemories(llmSummarizer?: (memories: EnhancedMemory[]) => Promise<string>): Promise<{
    forgottenIds: string[]
    promotions: PromotionEvent[]
    consolidation: ConsolidationEvent | null
  }> {
    // 1. 遗忘
    const forgottenIds = this.applyForgetting()
    // 2. 晋升
    const promotions = this.applyPromotion()
    // 3. 巩固
    const consolidation = await this.applyConsolidation(llmSummarizer)

    return { forgottenIds, promotions, consolidation }
  }

  /**
   * W2：LLM 显著性评级——对近期新增记忆批量重评重要性
   * 在维护窗口（6h 或每晚）调用，LLM 分数与规则分数按 0.7/0.3 融合
   *
   * @param llmRater LLM 评级函数，返回每条记忆的重新评分与理由
   */
  async applyLLMReassessment(
    llmRater?: (memories: EnhancedMemory[]) => Promise<Array<{ id: string; importance: number; reason?: string }>>,
  ): Promise<void> {
    if (!llmRater) return
    const DAY_MS = 86400000
    const now = Date.now()
    // 选取 24h 内未重评的记忆
    const candidates = [
      ...this.episodicMemory,
      ...this.workingMemory,
    ].filter((m) =>
      now - new Date(m.created_at).getTime() < DAY_MS &&
      !this.llmReassessedIds.has(m.id),
    )
    if (candidates.length === 0) return

    try {
      const results = await llmRater(candidates)
      for (const result of results) {
        const mem = candidates.find((m) => m.id === result.id)
        if (mem && result.importance >= 0 && result.importance <= 100) {
          // W2：LLM 分数 ×0.7 + 规则分数 ×0.3
          mem.importance = Math.round(0.7 * result.importance + 0.3 * mem.importance)
          this.llmReassessedIds.add(mem.id)
          // W2：如果 LLM 认为很重要但还没在自传层，提升它
          if (result.importance >= 80 && !mem.isAutobiographical) {
            mem.isAutobiographical = true
            if (!this.autobiographicalMemory.some((m) => m.id === mem.id)) {
              this.autobiographicalMemory.push(mem)
            }
          }
        }
      }
      this.scheduleSave()
    } catch {
      // LLM 重评失败不影响正常使用
    }
  }

  /**
   * W5：每晚巩固窗口（睡眠巩固）
   * 在离线时段（2-4 AM）执行深度维护：
   * 1. 遗忘 + 晋升 + 巩固（maintainMemories）
   * 2. LLM 显著性重评（applyLLMReassessment）
   * 3. 相似记忆合并（mergeSimilarMemories）
   * 4. RAG 索引重建
   *
   * @param llmSummarizer LLM 摘要函数（用于 episodic→semantic 巩固）
   * @param llmRater LLM 评级函数（用于 W2 显著性重评）
   * @returns 巩固结果摘要
   */
  async runNightlyConsolidation(
    llmSummarizer?: (memories: EnhancedMemory[]) => Promise<string>,
    llmRater?: (memories: EnhancedMemory[]) => Promise<Array<{ id: string; importance: number; reason?: string }>>,
  ): Promise<{
    forgottenCount: number
    promotionCount: number
    mergedCount: number
    consolidationDone: boolean
    reassessmentDone: boolean
  }> {
    // 1. 遗忘 + 晋升 + 巩固
    const { forgottenIds, promotions, consolidation } = await this.maintainMemories(llmSummarizer)

    // 2. LLM 显著性重评
    let reassessmentDone = false
    if (llmRater) {
      try {
        await this.applyLLMReassessment(llmRater)
        reassessmentDone = true
      } catch {
        // 重评失败不影响整体巩固
      }
    }

    // 3. 相似记忆合并
    const mergedCount = this.mergeSimilarMemories()

    // 4. RAG 索引重建
    this.buildRAGIndex?.()

    // 5. 保存
    this.scheduleSave()

    return {
      forgottenCount: forgottenIds.length,
      promotionCount: promotions.length,
      mergedCount,
      consolidationDone: consolidation !== null,
      reassessmentDone,
    }
  }

  /**
   * T-6: 更新某条记忆的情感三维（valence/arousal）
   * 用于对话结束后由 LLM 情绪标签（emotionExtractor.emotionTagsToMood）回写当轮记忆
   * 行级路径下同步更新 memories 行
   */
  updateMemoryMood(memoryId: string, valence: number, arousal: number): void {
    for (const pool of [this.workingMemory, this.episodicMemory, this.autobiographicalMemory]) {
      const mem = pool.find((m) => m.id === memoryId)
      if (mem) {
        mem.emotionalValence = valence
        mem.emotionalArousal = arousal
        if (this.useRowLevelStorage && mem.dbId !== undefined) {
          void updateMemoryRow(mem.dbId, { emotional_valence: valence, emotional_arousal: arousal })
        }
        this.scheduleSave()
        return
      }
    }
  }

  /**
   * 销毁实例：清理定时器和缓存，防止内存泄漏
   * 在切换角色或应用退出时调用
   */
  dispose(): void {
    if (this.saveDebounceTimer !== null) {
      clearTimeout(this.saveDebounceTimer)
      this.saveDebounceTimer = null
    }
    this.embeddingCache.clear()
    this.needsSave = false
    // 清理向量搜索资源（注意：这是全局的，只在最后一个实例销毁时才真正终止）
    if (enhancedManagers.size <= 1) {
      terminateVectorSearch()
    }
    removeEnhancedMemoryManager(this.characterId)
  }
}

// ============ 单例缓存 ============

const enhancedManagers = new Map<string, EnhancedMemoryManager>()

export function getEnhancedMemoryManager(characterId: string): EnhancedMemoryManager {
  let mgr = enhancedManagers.get(characterId)
  if (!mgr) {
    mgr = new EnhancedMemoryManager(characterId)
    enhancedManagers.set(characterId, mgr)
  }
  return mgr
}

export function removeEnhancedMemoryManager(characterId: string): void {
  enhancedManagers.delete(characterId)
}

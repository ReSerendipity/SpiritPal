/**
 * @file 测试数据工厂 — 统一创建测试实体
 * @module test/testDataFactory
 * @description
 * 提供工厂函数模式创建测试数据，减少全局 mock 的掩盖效应。
 * 与 mockContext 不同，本模块专注数据对象的构建，而非行为模拟。
 *
 * 核心功能：
 * - 基于 Builder 模式，提供合理默认值 + 按需覆盖
 * - 自动填充必填字段（减少样板代码）
 * - 生成确定性 ID（便于快照测试）
 * - 支持批量生成（用于性能/压力测试）
 *
 * @since v3.0 数据治理改进 - 测试数据改进
 *
 * @example
 * ```ts
 * // 创建单个角色
 * const character = createTestCharacter({ id: 'test-cat', name: 'Test Cat' })
 *
 * // 创建带记忆的角色
 * const withMemories = createTestCharacter({
 *   memories: [createTestMemory({ content: 'test' })]
 * })
 *
 * // 批量创建
 * const characters = createTestCharacters(10)
 * ```
 */

import type { MemoryRow } from '@/lib/data/db'
import type { NurturingStats, InventoryItem } from '@/lib/data/types'
import type { AnalyticsEvent, AnalyticsEventName } from '@/lib/system/analytics'

// ============ 角色养成数据工厂 ============

/** 角色养成属性默认值 */
const DEFAULT_STATS: NurturingStats = {
  hunger: 80,
  mood: 70,
  health: 100,
  affection: 500,
  level: 5,
  exp: 0,
  coins: 1000,
  lastTickAt: Date.now(),
  lastInteractionAt: Date.now(),
  lastAffectionDecayAt: Date.now(),
}

/** 角色数据结构 */
export interface TestCharacter {
  id: string
  name: string
  stats: NurturingStats
  inventory: InventoryItem[]
  level: number
  createdAt: number
}

/** 角色创建选项 */
export interface TestCharacterOptions {
  id?: string
  name?: string
  stats?: Partial<NurturingStats>
  inventory?: InventoryItem[]
  level?: number
  createdAt?: number
}

/** 角色 ID 计数器（用于生成确定性 ID） */
let characterIdCounter = 0

/**
 * 创建测试角色
 * @param options - 角色创建选项
 * @returns 角色对象
 */
export function createTestCharacter(options: TestCharacterOptions = {}): TestCharacter {
  characterIdCounter++
  const id = options.id ?? `test-char-${characterIdCounter}`
  return {
    id,
    name: options.name ?? `Test Character ${characterIdCounter}`,
    stats: { ...DEFAULT_STATS, ...options.stats },
    inventory: options.inventory ?? [],
    level: options.level ?? 5,
    createdAt: options.createdAt ?? Date.now(),
  }
}

/**
 * 批量创建测试角色
 * @param count - 角色数量
 * @param baseOptions - 基础选项（每个角色基于此覆盖）
 * @returns 角色数组
 */
export function createTestCharacters(
  count: number,
  baseOptions: TestCharacterOptions = {},
): TestCharacter[] {
  return Array.from({ length: count }, (_, i) =>
    createTestCharacter({
      ...baseOptions,
      id: baseOptions.id ? `${baseOptions.id}-${i}` : undefined,
      name: baseOptions.name ? `${baseOptions.name} ${i + 1}` : undefined,
    }),
  )
}

/**
 * 重置角色 ID 计数器（用于测试隔离）
 */
export function resetCharacterIdCounter(): void {
  characterIdCounter = 0
}

// ============ 记忆数据工厂 ============

/** 记忆行默认值 */
const DEFAULT_MEMORY_ROW: Omit<MemoryRow, 'id' | 'character_id' | 'content'> = {
  type: 'short_term',
  importance: 50,
  created_at: Date.now(),
  last_accessed: Date.now(),
  assistant: '',
  category: '日常',
  tags: '[]',
  emotional_intensity: 0,
  emotional_valence: 0,
  emotional_arousal: 0.3,
  strength: 1.0,
  decay_factor: 1.0,
  access_count: 0,
  source_kind: 'exchange',
  is_autobiographical: 0,
  tier: 'episodic',
  memory_id: null,
  fact_text: null,
  superseded_by: null,
  embedding: null,
}

/** 记忆创建选项 */
export interface TestMemoryOptions {
  id?: number
  character_id?: string
  content?: string
  type?: 'immediate' | 'short_term' | 'long_term' | 'core'
  importance?: number
  created_at?: number
  last_accessed?: number
  category?: string
  tier?: string
  tags?: string
  emotional_intensity?: number
  strength?: number
}

/** 记忆 ID 计数器 */
let memoryIdCounter = 0

/**
 * 创建测试记忆行
 * @param options - 记忆创建选项
 * @returns 记忆行对象
 */
export function createTestMemory(options: TestMemoryOptions = {}): MemoryRow {
  memoryIdCounter++
  return {
    ...DEFAULT_MEMORY_ROW,
    id: options.id ?? memoryIdCounter,
    character_id: options.character_id ?? 'test-char-1',
    content: options.content ?? `Test memory content ${memoryIdCounter}`,
    type: options.type ?? 'short_term',
    importance: options.importance ?? 50,
    created_at: options.created_at ?? Date.now(),
    last_accessed: options.last_accessed ?? Date.now(),
    category: options.category ?? '日常',
    tier: options.tier ?? 'episodic',
  } as MemoryRow
}

/**
 * 批量创建测试记忆
 * @param count - 记忆数量
 * @param baseOptions - 基础选项
 * @returns 记忆行数组
 */
export function createTestMemories(
  count: number,
  baseOptions: TestMemoryOptions = {},
): MemoryRow[] {
  return Array.from({ length: count }, (_, i) =>
    createTestMemory({
      ...baseOptions,
      id: baseOptions.id ? baseOptions.id + i : undefined,
      content: baseOptions.content ? `${baseOptions.content} ${i + 1}` : undefined,
    }),
  )
}

/**
 * 重置记忆 ID 计数器
 */
export function resetMemoryIdCounter(): void {
  memoryIdCounter = 0
}

// ============ 分析事件工厂 ============

/** 分析事件创建选项 */
export interface TestAnalyticsEventOptions<T extends AnalyticsEventName = AnalyticsEventName> {
  name?: T
  timestamp?: number
  data?: Record<string, unknown>
}

/** 分析事件 ID 计数器 */
let analyticsEventCounter = 0

/**
 * 创建测试分析事件
 *
 * 为每种事件类型提供合理的默认数据，减少测试中的样板代码。
 *
 * @param options - 事件创建选项
 * @returns 分析事件对象
 *
 * @example
 * ```ts
 * // 创建启动事件
 * const launch = createTestAnalyticsEvent({ name: 'app_launch' })
 *
 * // 创建自定义聊天事件
 * const chat = createTestAnalyticsEvent({
 *   name: 'chat_send',
 *   data: { message_length: 100, model: 'gpt-4' }
 * })
 * ```
 */
export function createTestAnalyticsEvent<T extends AnalyticsEventName = AnalyticsEventName>(
  options: TestAnalyticsEventOptions<T> = {},
): AnalyticsEvent<T> {
  analyticsEventCounter++
  const name = (options.name ?? 'app_launch') as T

  // 为每种事件类型提供默认数据
  const defaultData = getDefaultAnalyticsData(name)

  return {
    name,
    timestamp: options.timestamp ?? Date.now() + analyticsEventCounter * 1000,
    data: { ...defaultData, ...options.data } as AnalyticsEvent<T>['data'],
  }
}

/**
 * 获取事件类型的默认数据
 */
function getDefaultAnalyticsData(name: AnalyticsEventName): Record<string, unknown> {
  const defaults: Record<AnalyticsEventName, Record<string, unknown>> = {
    app_launch: { platform: 'win32', version: '1.0.0', is_autostart: false },
    pet_interaction: { type: 'click' },
    chat_send: { message_length: 50, model: 'test-model' },
    chat_receive: { response_length: 100, model: 'test-model', latency_ms: 500 },
    memory_trigger: { trigger_type: 'frequency', memory_id: 'test-mem-1' },
    item_use: { item_id: 'test-item', item_type: 'food' },
    tomato_complete: { duration_minutes: 25 },
    setting_change: { setting_key: 'theme', old_value: 'light', new_value: 'dark' },
    mod_install: { mod_id: 'test-mod', mod_name: 'Test Mod' },
    image_switch: { from_image: 'img1', to_image: 'img2' },
    firstrun_complete: { character_id: 'test-char' },
    firstrun_skip: {},
    error_occurred: { context: 'test_context', error_message: 'test error' },
    panel_open: {},
    panel_close: {},
    roam_toggle: { enabled: true },
    edge_snap_toggle: { enabled: false },
  }
  return defaults[name] ?? {}
}

/**
 * 批量创建测试分析事件
 * @param count - 事件数量
 * @param baseOptions - 基础选项
 * @returns 分析事件数组
 */
export function createTestAnalyticsEvents<T extends AnalyticsEventName = AnalyticsEventName>(
  count: number,
  baseOptions: TestAnalyticsEventOptions<T> = {},
): AnalyticsEvent<T>[] {
  return Array.from({ length: count }, () => createTestAnalyticsEvent(baseOptions))
}

/**
 * 重置分析事件计数器
 */
export function resetAnalyticsEventCounter(): void {
  analyticsEventCounter = 0
}

// ============ 背包物品工厂 ============

/** 背包物品默认值 */
const DEFAULT_ITEM: InventoryItem = {
  id: 'test-item-default',
  name: '测试物品',
  icon: 'item-default.png',
  type: 'consumable',
  price: 10,
  count: 1,
}

/** 背包物品创建选项 */
export interface TestInventoryItemOptions {
  id?: string
  name?: string
  icon?: string
  type?: InventoryItem['type']
  price?: number
  count?: number
  description?: string
  hungerRestore?: number
  moodRestore?: number
  healthRestore?: number
}

/**
 * 创建测试背包物品
 * @param options - 物品创建选项
 * @returns 背包物品对象
 */
export function createTestInventoryItem(options: TestInventoryItemOptions = {}): InventoryItem {
  return {
    ...DEFAULT_ITEM,
    ...options,
  }
}

// ============ 批量重置工具 ============

/**
 * 重置所有工厂计数器（用于测试隔离）
 *
 * 应在 beforeEach 中调用，确保每个测试用例从干净状态开始。
 *
 * @example
 * ```ts
 * beforeEach(() => {
 *   resetAllTestFactories()
 * })
 * ```
 */
export function resetAllTestFactories(): void {
  resetCharacterIdCounter()
  resetMemoryIdCounter()
  resetAnalyticsEventCounter()
}

// ============ 复杂场景构建器 ============

/**
 * 创建完整的测试数据集（角色 + 记忆 + 互动历史）
 *
 * 用于集成测试中需要完整数据链的场景。
 *
 * @param options - 数据集配置
 * @returns 完整测试数据集
 */
export interface TestDataSetOptions {
  characterCount?: number
  memoriesPerCharacter?: number
  eventCount?: number
}

export interface TestDataSet {
  characters: TestCharacter[]
  memories: MemoryRow[]
  events: AnalyticsEvent[]
}

export function createTestDataSet(options: TestDataSetOptions = {}): TestDataSet {
  const { characterCount = 2, memoriesPerCharacter = 5, eventCount = 10 } = options

  const characters = createTestCharacters(characterCount)
  const memories: MemoryRow[] = []

  for (const char of characters) {
    const charMemories = createTestMemories(memoriesPerCharacter, {
      character_id: char.id,
    })
    memories.push(...charMemories)
  }

  const events = createTestAnalyticsEvents(eventCount)

  return { characters, memories, events }
}

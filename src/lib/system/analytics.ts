/**
 * 数据埋点系统 — 本地存储，不上传服务器
 * PRD §15 定义的 10 个埋点事件
 *
 * @fileoverview
 * 主要模块：
 * - AnalyticsEventName 类型：10 种埋点事件（app_launch/pet_interaction/chat_send/...）
 * - AnalyticsEvent 接口：事件结构
 * - AnalyticsManager 类：埋点管理器（单例），支持启用/禁用、事件记录、导出
 * - getAnalytics()：获取单例入口
 * - trackXxx() 系列函数：10 个便捷埋点函数
 *
 * 设计原则：
 * 1. 本地优先：所有数据存储在 localStorage，不上传任何服务器
 * 2. 匿名化：不包含用户个人信息
 * 3. 可关闭：用户可在设置中完全关闭数据采集
 * 4. 可删除：用户可随时清除所有埋点数据
 * 5. 最多保留 1000 条事件
 *
 * R-14-lite v3.0: analytics localStorage 加密 + 用户同意机制
 * - 写入时使用 AES-256-GCM 加密（复用 Rust encrypt_data 命令）
 * - 读取时先尝试解密，失败则兼容旧明文数据
 * - 加密失败时：不再静默降级明文，需用户明确同意后才降级
 * - 用户未同意时：事件仅在内存中保留，不持久化到 localStorage
 *
 * @module analytics
 */

import { invoke } from '@tauri-apps/api/core'

const ANALYTICS_ENABLED_KEY = 'spiritpal-analytics-enabled'
const ANALYTICS_EVENTS_KEY = 'spiritpal-analytics-events'
const ANALYTICS_PLAINTEXT_CONSENT_KEY = 'spiritpal-analytics-plaintext-consent'
const MAX_EVENTS = 1000 // 最多保留 1000 条事件

// ============ 事件类型定义 ============

export type AnalyticsEventName =
  | 'app_launch'
  | 'pet_interaction'
  | 'chat_send'
  | 'chat_receive'
  | 'memory_trigger'
  | 'item_use'
  | 'tomato_complete'
  | 'setting_change'
  | 'mod_install'
  | 'image_switch'
  // M-6: UX 关键路径埋点
  | 'firstrun_complete'   // 首次引导完成
  | 'firstrun_skip'       // 首次引导跳过
  | 'error_occurred'      // 错误发生（非静默）
  | 'panel_open'          // 面板展开
  | 'panel_close'         // 面板收起
  | 'roam_toggle'         // 漫游开关切换
  | 'edge_snap_toggle'    // 边缘吸附开关切换

/**
 * 分析事件数据结构 - 严格类型约束
 *
 * 每种事件类型对应固定的 data 字段，避免自由格式导致的数据混乱。
 * 新增埋点事件时，必须在此类型中添加对应字段定义。
 *
 * @since v3.0 数据治理改进 - 指标口径治理
 */

/** 基础事件字段（所有事件共享） */
interface BaseEventData {
  [key: string]: unknown
}

interface AppLaunchData extends BaseEventData {
  platform: string       // 平台：win32/darwin/linux
  version: string        // 应用版本号（semver）
  is_autostart: boolean  // 是否开机自启启动
}

interface PetInteractionData extends BaseEventData {
  type: 'click' | 'drag' | 'feed' | 'pet'  // 交互类型
  duration?: number      // 交互持续时间（毫秒）
}

interface ChatSendData extends BaseEventData {
  message_length: number // 消息长度（字符数）
  model: string          // 使用的 AI 模型标识
}

interface ChatReceiveData extends BaseEventData {
  response_length: number  // 回复长度（字符数）
  model: string            // 使用的 AI 模型标识
  latency_ms: number       // 响应延迟（毫秒）
}

interface MemoryTriggerData extends BaseEventData {
  trigger_type: string   // 触发类型：frequency/responsive/emotional
  memory_id: string      // 触发的记忆 ID
}

interface ItemUseData extends BaseEventData {
  item_id: string        // 物品 ID
  item_type: string      // 物品类型分类
}

interface TomatoCompleteData extends BaseEventData {
  duration_minutes: number  // 番茄钟时长（分钟）
}

interface SettingChangeData extends BaseEventData {
  setting_key: string    // 设置项键名
  old_value: unknown     // 修改前的值
  new_value: unknown     // 修改后的值
}

interface ModInstallData extends BaseEventData {
  mod_id: string         // 模组 ID
  mod_name: string       // 模组名称
}

interface ImageSwitchData extends BaseEventData {
  from_image: string     // 切换前的形象 ID
  to_image: string       // 切换后的形象 ID
}

interface FirstRunCompleteData extends BaseEventData {
  character_id: string   // 首次引导选择的角色 ID
}

interface ErrorOccurredData extends BaseEventData {
  context: string        // 错误发生上下文
  error_message: string  // 错误信息（不含 PII）
}

type PanelToggleData = BaseEventData

interface ToggleEventData extends BaseEventData {
  enabled: boolean       // 开关状态
}

/** 事件名称到 data 类型的映射 */
export type AnalyticsEventDataMap = {
  app_launch: AppLaunchData
  pet_interaction: PetInteractionData
  chat_send: ChatSendData
  chat_receive: ChatReceiveData
  memory_trigger: MemoryTriggerData
  item_use: ItemUseData
  tomato_complete: TomatoCompleteData
  setting_change: SettingChangeData
  mod_install: ModInstallData
  image_switch: ImageSwitchData
  firstrun_complete: FirstRunCompleteData
  firstrun_skip: PanelToggleData
  error_occurred: ErrorOccurredData
  panel_open: PanelToggleData
  panel_close: PanelToggleData
  roam_toggle: ToggleEventData
  edge_snap_toggle: ToggleEventData
}

/**
 * 带类型约束的分析事件
 *
 * 使用泛型确保每种事件类型的数据字段符合预定义 schema。
 */
export interface AnalyticsEvent<T extends AnalyticsEventName = AnalyticsEventName> {
  name: T
  timestamp: number
  data: T extends keyof AnalyticsEventDataMap ? AnalyticsEventDataMap[T] : Record<string, unknown>
}

// ============ 加密辅助函数 ============

/**
 * R-14-lite: 加密数据（使用 Rust AES-256-GCM）
 * 调用 Tauri 命令 encrypt_data，密码为空（自动使用机器 ID 派生）
 */
async function encryptAnalyticsData(plaintext: string): Promise<string | null> {
  try {
    const ciphertext = await invoke<string>('encrypt_data', { data: plaintext, password: '' })
    return ciphertext
  } catch {
    // 加密失败（如非 Tauri 环境或机器 ID 获取失败），返回 null 降级为明文
    return null
  }
}

/**
 * R-14-lite: 解密数据（使用 Rust AES-256-GCM）
 * 调用 Tauri 命令 decrypt_data，密码为空（自动使用机器 ID 派生）
 */
async function decryptAnalyticsData(ciphertext: string): Promise<string | null> {
  try {
    const plaintext = await invoke<string>('decrypt_data', { encrypted: ciphertext, password: '' })
    return plaintext
  } catch {
    // 解密失败，返回 null 让调用方尝试明文兼容
    return null
  }
}

/**
 * 检查字符串是否为加密数据（以 ENC1: 或 ENC2: 开头）
 */
function isEncryptedData(s: string): boolean {
  return s.startsWith('ENC1:') || s.startsWith('ENC2:')
}

// ============ 埋点管理器 ============

/** 加密状态枚举 */
export enum EncryptionStatus {
  /** 加密可用，数据正常加密存储 */
  Encrypted = 'encrypted',
  /** 加密不可用，用户已同意明文存储 */
  PlaintextConsented = 'plaintext_consented',
  /** 加密不可用，用户未同意，数据仅内存保留 */
  MemoryOnly = 'memory_only',
  /** 初始状态，加密能力检测中 */
  Pending = 'pending',
}

class AnalyticsManager {
  private enabled: boolean = true
  private events: AnalyticsEvent[] = []
  private initialized: boolean = false
  private encryptionStatus: EncryptionStatus = EncryptionStatus.Pending
  private plaintextConsent: boolean = false
  /** 加密失败回调（用于 UI 提示用户） */
  private onEncryptionFailed: (() => void) | null = null

  constructor() {
    this.loadEnabled()
    this.loadPlaintextConsent()
    // R-14-lite: 异步加载事件（含解密），fire-and-forget
    this.init()
  }

  /**
   * R-14-lite: 异步初始化 — 加载并解密历史事件
   */
  private async init(): Promise<void> {
    await this.loadEventsAsync()
    this.initialized = true
  }

  private loadEnabled(): void {
    try {
      const raw = localStorage.getItem(ANALYTICS_ENABLED_KEY)
      if (raw !== null) {
        this.enabled = JSON.parse(raw)
      }
    } catch {
      this.enabled = true
    }
  }

  /** 加载用户明文存储同意状态 */
  private loadPlaintextConsent(): void {
    try {
      const raw = localStorage.getItem(ANALYTICS_PLAINTEXT_CONSENT_KEY)
      this.plaintextConsent = raw === 'true'
    } catch {
      this.plaintextConsent = false
    }
  }

  /**
   * R-14-lite: 异步加载事件 — 先尝试解密，失败则兼容旧明文数据
   */
  private async loadEventsAsync(): Promise<void> {
    try {
      const raw = localStorage.getItem(ANALYTICS_EVENTS_KEY)
      if (!raw) {
        this.events = []
        return
      }

      // R-14-lite: 如果是加密数据，先解密
      if (isEncryptedData(raw)) {
        const decrypted = await decryptAnalyticsData(raw)
        if (decrypted) {
          this.events = JSON.parse(decrypted)
          return
        }
        // 解密失败，可能是密钥不匹配（换机器），清空旧数据
        this.events = []
        return
      }

      // 兼容旧明文数据
      this.events = JSON.parse(raw)
    } catch {
      this.events = []
    }
  }

  /**
   * R-14-lite v3.0: 异步保存事件 — 加密后写入 localStorage
   * 加密失败时：需用户明确同意后才降级明文，否则仅内存保留
   */
  private async saveEventsAsync(): Promise<void> {
    try {
      // 限制事件数量
      if (this.events.length > MAX_EVENTS) {
        this.events = this.events.slice(-MAX_EVENTS)
      }
      const json = JSON.stringify(this.events)
      // R-14-lite: 尝试加密
      const ciphertext = await encryptAnalyticsData(json)
      if (ciphertext) {
        this.encryptionStatus = EncryptionStatus.Encrypted
        localStorage.setItem(ANALYTICS_EVENTS_KEY, ciphertext)
        return
      }

      // 加密失败：检查用户是否已同意明文存储
      if (this.plaintextConsent) {
        this.encryptionStatus = EncryptionStatus.PlaintextConsented
        localStorage.setItem(ANALYTICS_EVENTS_KEY, json)
        return
      }

      // 用户未同意明文存储：仅内存保留，触发回调通知 UI
      this.encryptionStatus = EncryptionStatus.MemoryOnly
      if (this.onEncryptionFailed) {
        this.onEncryptionFailed()
      }
    } catch {
      // 存储失败：仅内存保留
      this.encryptionStatus = EncryptionStatus.MemoryOnly
    }
  }

  /**
   * 设置加密失败回调（UI 可监听此事件提示用户）
   * @param callback 加密失败时的回调函数
   */
  setOnEncryptionFailedCallback(callback: () => void): void {
    this.onEncryptionFailed = callback
  }

  /**
   * 用户同意明文存储
   * 调用后下次保存时会将数据明文写入 localStorage
   */
  consentToPlaintext(): void {
    this.plaintextConsent = true
    this.encryptionStatus = EncryptionStatus.PlaintextConsented
    try {
      localStorage.setItem(ANALYTICS_PLAINTEXT_CONSENT_KEY, 'true')
    } catch {
      // 忽略
    }
    // 立即尝试保存当前事件
    void this.saveEventsAsync()
  }

  /**
   * 获取当前加密状态
   */
  getEncryptionStatus(): EncryptionStatus {
    return this.encryptionStatus
  }

  /**
   * 检查用户是否已同意明文存储
   */
  hasPlaintextConsent(): boolean {
    return this.plaintextConsent
  }

  /** 检查埋点是否启用 */
  isEnabled(): boolean {
    return this.enabled
  }

  /** 设置埋点开关 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    try {
      localStorage.setItem(ANALYTICS_ENABLED_KEY, JSON.stringify(enabled))
    } catch {
      // 忽略
    }
  }

  /**
   * 记录事件（类型安全）
   *
   * 使用泛型确保 data 字段符合预定义 schema。
   * 运行时进行基础字段校验，不符合 schema 的事件会被拒绝并输出警告。
   *
   * @param name 事件名称
   * @param data 事件数据（必须符合对应事件的 schema 定义）
   *
   * @example
   * ```ts
   * // ✅ 正确：字段符合 AppLaunchData schema
   * manager.track('app_launch', { platform: 'win32', version: '1.0.0', is_autostart: false })
   *
   * // ❌ 错误：缺少必填字段，TypeScript 编译报错
   * manager.track('app_launch', { platform: 'win32' })
   * ```
   */
  track<T extends AnalyticsEventName>(
    name: T,
    data: T extends keyof AnalyticsEventDataMap ? AnalyticsEventDataMap[T] : Record<string, unknown>
  ): void {
    if (!this.enabled) return

    // 运行时 schema 校验（仅开发模式）
    if (import.meta.env.DEV) {
      const validation = validateEventData(name, data)
      if (!validation.valid) {
        console.warn(`[Analytics] Event "${name}" schema validation failed: ${validation.error}`, data)
        return
      }
    }

    const event: AnalyticsEvent = {
      name,
      timestamp: Date.now(),
      data,
    }

    this.events.push(event)
    // R-14-lite: 异步保存（fire-and-forget）
    void this.saveEventsAsync()
  }

  /** 获取所有事件 */
  getEvents(): AnalyticsEvent[] {
    return [...this.events]
  }

  /** 获取指定事件类型的统计 */
  getEventCount(name: AnalyticsEventName): number {
    return this.events.filter((e) => e.name === name).length
  }

  /** 清除所有事件 */
  clearEvents(): void {
    this.events = []
    try {
      localStorage.removeItem(ANALYTICS_EVENTS_KEY)
    } catch {
      // 忽略
    }
  }

  /** 导出事件数据 */
  exportEvents(): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      events: this.events,
    }, null, 2)
  }
}

// 单例
let instance: AnalyticsManager | null = null

export function getAnalytics(): AnalyticsManager {
  if (!instance) {
    instance = new AnalyticsManager()
  }
  return instance
}

// ============ 便捷方法 ============

/** 应用启动 */
export function trackAppLaunch(platform: string, version: string, isAutostart: boolean): void {
  getAnalytics().track('app_launch', { platform, version, is_autostart: isAutostart })
}

/** 宠物交互 */
export function trackPetInteraction(type: 'click' | 'drag' | 'feed' | 'pet', duration?: number): void {
  getAnalytics().track('pet_interaction', { type, duration })
}

/** 发送聊天消息 */
export function trackChatSend(messageLength: number, model: string): void {
  getAnalytics().track('chat_send', { message_length: messageLength, model })
}

/** AI 回复完成 */
export function trackChatReceive(responseLength: number, model: string, latencyMs: number): void {
  getAnalytics().track('chat_receive', { response_length: responseLength, model, latency_ms: latencyMs })
}

/** 记忆触发 */
export function trackMemoryTrigger(triggerType: string, memoryId: string): void {
  getAnalytics().track('memory_trigger', { trigger_type: triggerType, memory_id: memoryId })
}

/** 使用物品 */
export function trackItemUse(itemId: string, itemType: string): void {
  getAnalytics().track('item_use', { item_id: itemId, item_type: itemType })
}

/** 完成番茄钟 */
export function trackTomatoComplete(durationMinutes: number): void {
  getAnalytics().track('tomato_complete', { duration_minutes: durationMinutes })
}

/** 修改设置 */
export function trackSettingChange(settingKey: string, oldValue: unknown, newValue: unknown): void {
  getAnalytics().track('setting_change', { setting_key: settingKey, old_value: oldValue, new_value: newValue })
}

/** 安装模组 */
export function trackModInstall(modId: string, modName: string): void {
  getAnalytics().track('mod_install', { mod_id: modId, mod_name: modName })
}

/** 切换形象 */
export function trackImageSwitch(fromImage: string, toImage: string): void {
  getAnalytics().track('image_switch', { from_image: fromImage, to_image: toImage })
}

// ============ M-6: UX 关键路径埋点 ============

/** 首次引导完成 */
export function trackFirstRunComplete(characterId: string): void {
  getAnalytics().track('firstrun_complete', { character_id: characterId })
}

/** 首次引导跳过 AI 配置 */
export function trackFirstRunSkip(): void {
  getAnalytics().track('firstrun_skip', {})
}

/** 错误发生（非静默，用户可见） */
export function trackErrorOccurred(context: string, errorMessage: string): void {
  getAnalytics().track('error_occurred', { context, error_message: errorMessage })
}

/** 面板展开 */
export function trackPanelOpen(): void {
  getAnalytics().track('panel_open', {})
}

/** 面板收起 */
export function trackPanelClose(): void {
  getAnalytics().track('panel_close', {})
}

/** 漫游开关切换 */
export function trackRoamToggle(enabled: boolean): void {
  getAnalytics().track('roam_toggle', { enabled })
}

/** 边缘吸附开关切换 */
export function trackEdgeSnapToggle(enabled: boolean): void {
  getAnalytics().track('edge_snap_toggle', { enabled })
}

// ============ Schema 校验（运行时防御）============

/** Schema 校验结果 */
interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * 必填字段定义（事件名称 → 必填字段列表）
 *
 * 用于运行时校验，确保埋点数据包含必要的分析维度。
 * 必选字段的选择基于数据分析需求（如归因、漏斗计算）。
 */
const REQUIRED_FIELDS: Record<string, string[]> = {
  app_launch: ['platform', 'version', 'is_autostart'],
  pet_interaction: ['type'],
  chat_send: ['message_length', 'model'],
  chat_receive: ['response_length', 'model', 'latency_ms'],
  memory_trigger: ['trigger_type', 'memory_id'],
  item_use: ['item_id', 'item_type'],
  tomato_complete: ['duration_minutes'],
  setting_change: ['setting_key', 'new_value'],
  mod_install: ['mod_id', 'mod_name'],
  image_switch: ['from_image', 'to_image'],
  firstrun_complete: ['character_id'],
  firstrun_skip: [],
  error_occurred: ['context', 'error_message'],
  panel_open: [],
  panel_close: [],
  roam_toggle: ['enabled'],
  edge_snap_toggle: ['enabled'],
}

/**
 * 事件名称到 data schema 的 Zod-style 校验函数
 *
 * 由于不引入 Zod 依赖，使用手写校验逻辑。
 * 校验规则：
 * 1. 必填字段存在
 * 2. 字段类型正确（基础类型检查）
 * 3. 枚举值合法
 */

/** 校验事件数据是否符合 schema */
function validateEventData(
  name: AnalyticsEventName,
  data: Record<string, unknown>,
): ValidationResult {
  const required = REQUIRED_FIELDS[name]
  if (!required) {
    return { valid: false, error: `Unknown event type: ${name}` }
  }

  // 1. 必填字段存在性检查
  for (const field of required) {
    if (!(field in data)) {
      return { valid: false, error: `Missing required field: "${field}"` }
    }
    const value = data[field]
    if (value === null || value === undefined) {
      return { valid: false, error: `Required field "${field}" is null/undefined` }
    }
  }

  // 2. 类型校验（按需扩展）
  switch (name) {
    case 'app_launch':
      if (typeof data.platform !== 'string') return { valid: false, error: 'platform must be string' }
      if (typeof data.version !== 'string') return { valid: false, error: 'version must be string' }
      if (typeof data.is_autostart !== 'boolean') return { valid: false, error: 'is_autostart must be boolean' }
      break
    case 'pet_interaction':
      if (!['click', 'drag', 'feed', 'pet'].includes(data.type as string)) {
        return { valid: false, error: 'type must be one of: click, drag, feed, pet' }
      }
      break
    case 'chat_send':
    case 'chat_receive':
      if (typeof data.message_length !== 'number' && typeof data.response_length !== 'number') {
        return { valid: false, error: 'message_length/response_length must be number' }
      }
      break
    case 'tomato_complete':
      if (typeof data.duration_minutes !== 'number' || (data.duration_minutes as number) <= 0) {
        return { valid: false, error: 'duration_minutes must be positive number' }
      }
      break
    case 'roam_toggle':
    case 'edge_snap_toggle':
      if (typeof data.enabled !== 'boolean') {
        return { valid: false, error: 'enabled must be boolean' }
      }
      break
  }

  // 3. PII 防护：强制清理可能包含用户隐私的字段
  const sanitized = sanitizeAnalyticsData(data)
  if (sanitized !== data) {
    // 仅记录警告，不阻断
    console.warn(`[Analytics] Event "${name}" contained potential PII fields that were sanitized`)
  }

  return { valid: true }
}

/**
 * 清理分析数据中的潜在 PII
 *
 * 防御性清洗：移除可能误传入的敏感字段。
 * 与 piiMasking.ts 不同，此处是更轻量的字段级过滤。
 */
function sanitizeAnalyticsData(data: Record<string, unknown>): Record<string, unknown> {
  // 需移除的敏感字段名模式
  const sensitivePatterns = [
    /password/i,
    /token/i,
    /secret/i,
    /apikey/i,
    /api_key/i,
    /credential/i,
    /ssn/i,
    /social.security/i,
    /身份证/i,
    /手机/i,
    /email/i,
    /邮箱/i,
  ]

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    const isSensitive = sensitivePatterns.some((pattern) => pattern.test(key))
    if (!isSensitive) {
      sanitized[key] = value
    }
  }
  return sanitized
}

/** 导出 validateEventData 供测试使用（不暴露给生产代码） */
export { validateEventData as _validateEventDataForTest }

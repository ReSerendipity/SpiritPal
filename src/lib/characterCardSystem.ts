/**
 * 角色卡系统 — JSON 角色卡格式定义、i18n 支持、模板变量、版本管理
 * 参考 Live2DPet 设计
 *
 * @fileoverview
 * 主要模块：
 * - CHARACTER_CARD_VERSION：角色卡版本常量
 * - I18nText 类型：i18n 多语言文本映射
 * - CharacterCard 接口：角色卡完整结构定义
 * - CharacterCardManager 类：角色卡管理器，支持加载、校验、迁移、版本化克隆
 * - migrateCard()：卡片版本迁移
 * - validateCard()：卡片校验
 *
 * 功能：
 * - JSON 角色卡格式定义
 * - i18n 支持（角色卡中的多语言描述）
 * - 模板变量（角色描述中的动态替换）
 * - 版本化自动克隆（更新时保留用户修改）
 * - 卡片校验和迁移
 *
 * @module characterCardSystem
 * @requires ./types - Personality, PersonalityConfig, SpeakingStyle, InteractionPreferences 类型定义
 */

import type { Personality, SpeakingStyle, InteractionPreferences } from './types'

// ============ 角色卡格式 ============

/** 角色卡版本 */
export const CHARACTER_CARD_VERSION = 2

/** i18n 文本映射 */
export type I18nText = Record<string, string> // { zh: "中文", en: "English", ja: "日本語" }

/** 角色卡结构 */
export interface CharacterCard {
  /** 卡片格式版本 */
  version: number
  /** 角色 ID */
  id: string
  /** 角色名（i18n） */
  name: I18nText
  /** 显示名 */
  displayName: string
  /** 来源 */
  source: I18nText
  /** 出生背景（i18n） */
  birthBackground: I18nText
  /** 情感内核（i18n） */
  emotionalCore: I18nText
  /** 性格参数 */
  personality: Personality
  /** 标志符号（i18n） */
  signaturePhrase: I18nText
  /** 经典语录（i18n，数组中的每个元素是 i18n 文本） */
  classicQuotes: I18nText[]
  /** System Prompt（支持模板变量） */
  systemPrompt: I18nText
  /** Few-shot 示例 */
  fewShotExamples: { user: I18nText; assistant: I18nText }[]
  /** 说话风格 */
  speakingStyle: SpeakingStyle
  /** 互动偏好 */
  interactionPrefs: InteractionPreferences
  /** 精灵图资源路径 */
  spriteAsset: string
  /** 精灵图类型 */
  spriteType: 'atlas' | 'svg' | 'gif' | 'video' | 'live2d'
  /** 主题颜色 */
  themeColor: { primary: string; secondary: string }
  /** 气泡消息（i18n） */
  bubbleMessages: {
    idle: I18nText[]
    hungry: I18nText[]
    sad: I18nText[]
    pet: I18nText[]
    feed: I18nText[]
    pomodoroDone: I18nText[]
  }
  /** 模型路径（Live2D 时） */
  modelPath?: string
  /** 图集布局 */
  atlasLayout?: { cellW: number; cellH: number; cols: number; rows: number }
  /** 标签 */
  tags?: string[]
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
  /** 作者 */
  author?: string
  /** 许可证 */
  license?: string
}

// ============ 模板变量 ============

/** 模板变量解析上下文 */
export interface TemplateContext {
  /** 角色名 */
  characterName: string
  /** 当前日期 */
  date: string
  /** 当前时间 */
  time: string
  /** 当前星期 */
  weekday: string
  /** 用户名（如果设置） */
  userName?: string
  /** 宠物昵称 */
  petNickname?: string
  /** 自定义变量 */
  custom?: Record<string, string>
}

/** 模板变量前缀 */
const TEMPLATE_PREFIX = '{{'
/** 模板变量后缀 */
const TEMPLATE_SUFFIX = '}}'

/**
 * 解析模板变量
 * 将 {{variable}} 格式的占位符替换为实际值
 *
 * 支持的内置变量：
 * - {{characterName}} — 角色名
 * - {{date}} — 当前日期 (YYYY-MM-DD)
 * - {{time}} — 当前时间 (HH:MM)
 * - {{weekday}} — 星期几
 * - {{userName}} — 用户名
 * - {{petNickname}} — 宠物昵称
 * - {{custom.xxx}} — 自定义变量
 *
 * @param template 模板字符串
 * @param ctx 模板上下文
 * @returns 解析后的字符串
 */
export function resolveTemplate(template: string, ctx: TemplateContext): string {
  let result = template

  // 内置变量
  const builtins: Record<string, string> = {
    characterName: ctx.characterName,
    date: ctx.date,
    time: ctx.time,
    weekday: ctx.weekday,
    userName: ctx.userName ?? '',
    petNickname: ctx.petNickname ?? '',
  }

  // 替换内置变量
  for (const [key, value] of Object.entries(builtins)) {
    const pattern = `${TEMPLATE_PREFIX}${key}${TEMPLATE_SUFFIX}`
    result = result.replaceAll(pattern, value)
  }

  // 替换自定义变量
  if (ctx.custom) {
    for (const [key, value] of Object.entries(ctx.custom)) {
      const pattern = `${TEMPLATE_PREFIX}custom.${key}${TEMPLATE_SUFFIX}`
      result = result.replaceAll(pattern, value)
    }
  }

  return result
}

/**
 * 创建默认模板上下文
 * @param characterName 角色名
 * @returns 模板上下文
 */
export function createTemplateContext(characterName: string): TemplateContext {
  const now = new Date()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']

  return {
    characterName,
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    weekday: `星期${weekdays[now.getDay()]}`,
  }
}

// ============ i18n 文本解析 ============

/**
 * 从 i18n 文本映射中获取当前语言的文本
 * @param i18nText i18n 文本映射
 * @param locale 语言代码（默认 'zh'）
 * @returns 对应语言的文本，回退到第一个可用的语言
 */
export function getI18nText(i18nText: I18nText, locale: string = 'zh'): string {
  return i18nText[locale] ?? i18nText['zh'] ?? i18nText['en'] ?? Object.values(i18nText)[0] ?? ''
}

// ============ 卡片校验 ============

/** 校验结果 */
export interface CardValidationResult {
  /** 是否通过校验 */
  valid: boolean
  /** 错误列表 */
  errors: string[]
  /** 警告列表 */
  warnings: string[]
}

/**
 * 校验角色卡
 * @param card 角色卡对象
 * @returns 校验结果
 */
export function validateCharacterCard(card: unknown): CardValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!card || typeof card !== 'object') {
    return { valid: false, errors: ['角色卡必须是对象'], warnings }
  }

  const c = card as Record<string, unknown>

  // 必要字段检查
  if (!c.id || typeof c.id !== 'string') errors.push('缺少必要的 id 字段')
  if (!c.name || typeof c.name !== 'object') errors.push('缺少必要的 name 字段（i18n 格式）')
  if (!c.displayName || typeof c.displayName !== 'string') errors.push('缺少必要的 displayName 字段')
  if (!c.personality || typeof c.personality !== 'object') errors.push('缺少必要的 personality 字段')
  if (!c.spriteAsset || typeof c.spriteAsset !== 'string') errors.push('缺少必要的 spriteAsset 字段')
  if (!c.spriteType || typeof c.spriteType !== 'string') errors.push('缺少必要的 spriteType 字段')

  // 版本检查
  if (c.version !== undefined && typeof c.version !== 'number') {
    warnings.push('version 字段应为数字类型')
  }

  // 性格参数检查
  if (c.personality && typeof c.personality === 'object') {
    const p = c.personality as Record<string, unknown>
    const dimensions = ['warmth', 'liveliness', 'dependence', 'directness', 'rationality']
    for (const dim of dimensions) {
      if (typeof p[dim] !== 'number') {
        warnings.push(`性格参数 ${dim} 缺失或类型错误`)
      } else if ((p[dim] as number) < -1 || (p[dim] as number) > 1) {
        warnings.push(`性格参数 ${dim} 超出范围 [-1, 1]`)
      }
    }
  }

  // spriteType 枚举检查
  const validSpriteTypes = ['atlas', 'svg', 'gif', 'video', 'live2d']
  if (c.spriteType && !validSpriteTypes.includes(c.spriteType as string)) {
    errors.push(`spriteType "${c.spriteType}" 不是有效的类型，应为: ${validSpriteTypes.join(', ')}`)
  }

  // i18n 字段检查
  const i18nFields = ['name', 'source', 'birthBackground', 'emotionalCore', 'signaturePhrase', 'systemPrompt']
  for (const field of i18nFields) {
    if (c[field] && typeof c[field] === 'object') {
      const i18n = c[field] as Record<string, unknown>
      if (Object.keys(i18n).length === 0) {
        warnings.push(`${field} 的 i18n 映射为空`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ============ 卡片迁移 ============

/**
 * 将旧版本的角色卡迁移到当前版本
 * @param card 旧版本角色卡
 * @returns 迁移后的角色卡
 */
export function migrateCharacterCard(card: Record<string, unknown>): CharacterCard {
  const version = (card.version as number) ?? 1

  // 从 v1 迁移到 v2
  if (version < 2) {
    // v1 格式：字符串字段 → v2 格式：i18n 字段
    const migrated = { ...card } as Record<string, unknown>
    migrated.version = CHARACTER_CARD_VERSION

    // 字符串字段转 i18n
    const stringToI18n = (value: unknown): I18nText => {
      if (typeof value === 'string') return { zh: value }
      if (typeof value === 'object' && value !== null) return value as I18nText
      return { zh: '' }
    }

    migrated.name = stringToI18n(migrated.name)
    migrated.source = stringToI18n(migrated.source)
    migrated.birthBackground = stringToI18n(migrated.birthBackground)
    migrated.emotionalCore = stringToI18n(migrated.emotionalCore)
    migrated.signaturePhrase = stringToI18n(migrated.signaturePhrase)
    migrated.systemPrompt = stringToI18n(migrated.systemPrompt)

    // 添加缺失的时间戳
    if (!migrated.createdAt) migrated.createdAt = new Date().toISOString()
    if (!migrated.updatedAt) migrated.updatedAt = new Date().toISOString()

    return migrated as unknown as CharacterCard
  }

  return card as unknown as CharacterCard
}

// ============ 版本化自动克隆 ============

/** 用户自定义覆盖数据 */
export interface UserOverrides {
  /** 角色 ID */
  characterId: string
  /** 自定义性格覆盖 */
  personality?: Personality
  /** 自定义说话风格 */
  speakingStyle?: SpeakingStyle
  /** 自定义互动偏好 */
  interactionPrefs?: InteractionPreferences
  /** 自定义 System Prompt */
  systemPrompt?: I18nText
  /** 最后基于的卡片版本 */
  basedOnVersion: number
  /** 覆盖时间 */
  overriddenAt: string
}

const USER_OVERRIDES_STORAGE_KEY = 'spiritpal-character-card-overrides'

/**
 * 保存用户覆盖
 * 当角色卡更新时，保留用户的自定义修改
 */
export function saveUserOverrides(overrides: UserOverrides): void {
  try {
    const all = loadAllUserOverrides()
    all[overrides.characterId] = overrides
    localStorage.setItem(USER_OVERRIDES_STORAGE_KEY, JSON.stringify(all))
  } catch {
    // 忽略
  }
}

/**
 * 加载用户覆盖
 */
export function loadUserOverrides(characterId: string): UserOverrides | null {
  const all = loadAllUserOverrides()
  return all[characterId] ?? null
}

/**
 * 加载所有用户覆盖
 */
export function loadAllUserOverrides(): Record<string, UserOverrides> {
  try {
    const raw = localStorage.getItem(USER_OVERRIDES_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // 忽略
  }
  return {}
}

/**
 * 检查用户覆盖是否需要更新
 * 当角色卡版本号增加时，自动克隆用户覆盖到新版本
 *
 * @param characterId 角色 ID
 * @param currentCardVersion 当前卡片版本
 * @returns 是否需要更新
 */
export function checkUserOverrideNeedsUpdate(
  characterId: string,
  currentCardVersion: number,
): boolean {
  const overrides = loadUserOverrides(characterId)
  if (!overrides) return false
  return overrides.basedOnVersion < currentCardVersion
}

/**
 * 自动克隆用户覆盖到新版本
 * 保留用户的自定义修改，但更新 basedOnVersion
 *
 * @param characterId 角色 ID
 * @param newVersion 新版本号
 */
export function cloneUserOverridesToNewVersion(characterId: string, newVersion: number): void {
  const overrides = loadUserOverrides(characterId)
  if (!overrides) return

  overrides.basedOnVersion = newVersion
  overrides.overriddenAt = new Date().toISOString()
  saveUserOverrides(overrides)
}

/**
 * 删除用户覆盖
 */
export function removeUserOverrides(characterId: string): void {
  try {
    const all = loadAllUserOverrides()
    delete all[characterId]
    localStorage.setItem(USER_OVERRIDES_STORAGE_KEY, JSON.stringify(all))
  } catch {
    // 忽略
  }
}

// ============ 角色卡管理器 ============

export class CharacterCardManager {
  /** 已加载的角色卡 */
  private cards = new Map<string, CharacterCard>()

  /** 当前语言 */
  private locale: string = 'zh'

  /** 注册角色卡 */
  registerCard(card: CharacterCard): void {
    // 校验
    const validation = validateCharacterCard(card)
    if (!validation.valid) {
      console.warn(`[CharacterCard] 角色 ${card.id} 校验失败:`, validation.errors)
    }

    // 迁移旧版本
    if (card.version < CHARACTER_CARD_VERSION) {
      const migrated = migrateCharacterCard(card as unknown as Record<string, unknown>)
      this.cards.set(card.id, migrated)
    } else {
      this.cards.set(card.id, card)
    }

    // 检查用户覆盖是否需要更新
    if (checkUserOverrideNeedsUpdate(card.id, card.version)) {
      cloneUserOverridesToNewVersion(card.id, card.version)
    }
  }

  /** 注销角色卡 */
  unregisterCard(characterId: string): void {
    this.cards.delete(characterId)
  }

  /** 获取角色卡 */
  getCard(characterId: string): CharacterCard | undefined {
    return this.cards.get(characterId)
  }

  /** 获取所有角色卡 */
  getAllCards(): CharacterCard[] {
    return Array.from(this.cards.values())
  }

  /** 获取本地化的角色名 */
  getLocalizedName(characterId: string): string {
    const card = this.cards.get(characterId)
    if (!card) return ''
    return getI18nText(card.name, this.locale)
  }

  /** 获取本地化的 System Prompt（带模板变量解析） */
  getLocalizedSystemPrompt(characterId: string): string {
    const card = this.cards.get(characterId)
    if (!card) return ''

    const raw = getI18nText(card.systemPrompt, this.locale)
    const ctx = createTemplateContext(getI18nText(card.name, this.locale))
    return resolveTemplate(raw, ctx)
  }

  /** 获取本地化的气泡消息 */
  getLocalizedBubbleMessages(
    characterId: string,
    category: keyof CharacterCard['bubbleMessages'],
  ): string[] {
    const card = this.cards.get(characterId)
    if (!card) return []

    const messages = card.bubbleMessages[category]
    return messages.map((m) => getI18nText(m, this.locale))
  }

  /** 设置语言 */
  setLocale(locale: string): void {
    this.locale = locale
  }

  /** 获取语言 */
  getLocale(): string {
    return this.locale
  }

  /** 重置管理器 */
  reset(): void {
    this.cards.clear()
  }
}

// ============ 单例 ============

let characterCardManager: CharacterCardManager | null = null

/** 获取角色卡管理器单例 */
export function getCharacterCardManager(): CharacterCardManager {
  if (!characterCardManager) {
    characterCardManager = new CharacterCardManager()
  }
  return characterCardManager
}

/** 重置角色卡管理器 */
export function resetCharacterCardManager(): void {
  if (characterCardManager) {
    characterCardManager.reset()
    characterCardManager = null
  }
}

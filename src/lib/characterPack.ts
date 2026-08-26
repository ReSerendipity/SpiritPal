/**
 * 统一角色包解析中枢 — 消除 3 套 pet.json 格式混乱
 *
 * @fileoverview
 * 三种输入格式 → 统一输出 CharacterProfile：
 *
 * 1. CharacterPackConfig（characterResourceLoader.ts）— spritePath 单字段格式
 * 2. CharacterResourcePackage（characterResourceImporter.ts）— sprites[] 数组格式
 * 3. PetMetadata（petMetadata.ts）— asset-pipeline 输出格式（psd_to_pet.py 对齐）
 *
 * 字段映射表：
 * | 输入字段 (3 套)                        | 输出 CharacterProfile 字段    |
 * |---------------------------------------|-------------------------------|
 * | id / meta.id                          | id                            |
 * | name / meta.name / meta.displayName    | name / displayName            |
 * | tags / source                         | source                        |
 * | description                            | birthBackground               |
 * | sprite / spritePath / sprites[0].path  | spriteAsset                   |
 * | spriteType / sprites[0].type          | spriteType                    |
 * | atlas / atlasLayout / sprites[0].layout| atlasLayout                   |
 * | themeColor                             | themeColor                    |
 * | animations                             | (帧配置，非 CharacterProfile 字段，预留) |
 * | reactions / sounds                     | (预留，非 CharacterProfile 字段)        |
 * | personality                             | personality                   |
 * | signaturePhrase                        | signaturePhrase               |
 * | classicQuotes                          | classicQuotes                 |
 * | bubbleMessages                         | bubbleMessages                |
 * | defaultSystemPrompt / systemPrompt      | systemPrompt                  |
 * | speakingStyle                           | (预留)                         |
 *
 * @module characterPack
 * @requires ./types - CharacterProfile, ATLAS, Personality 类型与常量
 */

import type { CharacterProfile, Personality } from './types'
import { ATLAS } from './types'

// ============ 输入格式类型（松散结构，兼容三种清单）============

/** 任意角色包清单的松散输入类型 */
export type RawPackConfig = Record<string, unknown>

// ============ 解析结果 ============

/** 解析过程中的校验消息 */
export interface PackParseMessage {
  /** 消息级别 */
  level: 'error' | 'warning' | 'info'
  /** 消息内容 */
  message: string
  /** 相关字段名（可选） */
  field?: string
}

/** parseCharacterPack 的返回结果 */
export interface PackParseResult {
  /** 是否解析成功（有 error 即失败） */
  ok: boolean
  /** 统一后的 CharacterProfile（失败时为 null） */
  profile: CharacterProfile | null
  /** 校验/解析过程中的消息 */
  messages: PackParseMessage[]
  /** 检测到的输入格式 */
  detectedFormat: 'pack-config' | 'resource-package' | 'pet-metadata' | 'unknown'
}

// ============ 默认值 ============

const DEFAULT_PERSONALITY: Personality = {
  warmth: 0.5,
  liveliness: 0.5,
  dependence: 0.5,
  directness: 0,
  rationality: 0,
}

const DEFAULT_THEME_COLOR = { primary: '#4ECDC4', secondary: '#FF6B6B' }

const DEFAULT_BUBBLE_MESSAGES: CharacterProfile['bubbleMessages'] = {
  idle: ['…'],
  hungry: ['有点饿了'],
  sad: ['呜…'],
  pet: ['好舒服~'],
  feed: ['谢谢！'],
  pomodoroDone: ['休息一下~'],
}

// ============ 格式检测 ============

/**
 * 检测原始 JSON 的格式类型
 *
 * 判定规则：
 * - 'resource-package': 有 `meta` 字段且 `meta` 是对象，或 `sprites` 是数组
 * - 'pet-metadata': 有 `formatVersion` 字段且值为 '1.0'，或 `atlas` 是对象且有 `sprite` 字段
 * - 'pack-config': 有 `spritePath` 字段
 * - 'unknown': 以上都不满足
 */
export function detectFormat(raw: RawPackConfig): PackParseResult['detectedFormat'] {
  // CharacterResourcePackage 格式
  if (
    (typeof raw.meta === 'object' && raw.meta !== null) ||
    Array.isArray(raw.sprites)
  ) {
    return 'resource-package'
  }

  // PetMetadata 格式
  if (raw.formatVersion === '1.0' || (typeof raw.atlas === 'object' && typeof raw.sprite === 'string')) {
    return 'pet-metadata'
  }

  // CharacterPackConfig 格式
  if (typeof raw.spritePath === 'string') {
    return 'pack-config'
  }

  return 'unknown'
}

// ============ 类型安全辅助 ============

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asStringArray(v: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v
  return fallback
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && !isNaN(v) ? v : fallback
}

function asPersonality(v: unknown): Personality {
  if (v && typeof v === 'object') {
    const p = v as Record<string, unknown>
    return {
      warmth: clampPersonalityDim(p.warmth, 0.5),
      liveliness: clampPersonalityDim(p.liveliness, 0.5),
      dependence: clampPersonalityDim(p.dependence, 0.5),
      directness: clampPersonalityDim(p.directness, 0),
      rationality: clampPersonalityDim(p.rationality, 0),
    }
  }
  return { ...DEFAULT_PERSONALITY }
}

function clampPersonalityDim(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : fallback
  return Math.max(-1, Math.min(1, n))
}

function asThemeColor(v: unknown) {
  if (v && typeof v === 'object') {
    const c = v as Record<string, unknown>
    return {
      primary: typeof c.primary === 'string' ? c.primary : DEFAULT_THEME_COLOR.primary,
      secondary: typeof c.secondary === 'string' ? c.secondary : DEFAULT_THEME_COLOR.secondary,
    }
  }
  return { ...DEFAULT_THEME_COLOR }
}

function asAtlasLayout(v: unknown) {
  if (v && typeof v === 'object') {
    const a = v as Record<string, unknown>
    const cellW = asNumber(a.cellW, ATLAS.cellW)
    const cellH = asNumber(a.cellH, ATLAS.cellH)
    const cols = asNumber(a.cols, ATLAS.cols)
    const rows = asNumber(a.rows, ATLAS.rows)
    if (cellW > 0 && cellH > 0 && cols > 0 && rows > 0) {
      return { cellW, cellH, cols, rows }
    }
  }
  return undefined
}

function asBubbleMessages(v: unknown): CharacterProfile['bubbleMessages'] {
  if (v && typeof v === 'object') {
    const b = v as Record<string, unknown>
    return {
      idle: asStringArray(b.idle, DEFAULT_BUBBLE_MESSAGES.idle),
      hungry: asStringArray(b.hungry, DEFAULT_BUBBLE_MESSAGES.hungry),
      sad: asStringArray(b.sad, DEFAULT_BUBBLE_MESSAGES.sad),
      pet: asStringArray(b.pet, DEFAULT_BUBBLE_MESSAGES.pet),
      feed: asStringArray(b.feed, DEFAULT_BUBBLE_MESSAGES.feed),
      pomodoroDone: asStringArray(b.pomodoroDone, DEFAULT_BUBBLE_MESSAGES.pomodoroDone),
    }
  }
  return { ...DEFAULT_BUBBLE_MESSAGES }
}

// ============ 各格式解析器 ============

/**
 * 解析 CharacterPackConfig 格式（characterResourceLoader.ts 定义）
 * 特征：spritePath 单字段、spriteType 枚举、可选 atlasLayout
 */
function parsePackConfig(raw: RawPackConfig, messages: PackParseMessage[]): CharacterProfile {
  const id = asString(raw.id)
  const name = asString(raw.name, id)
  const displayName = asString(raw.name, name)

  if (!id) {
    messages.push({ level: 'error', message: '缺少 id 字段', field: 'id' })
  }

  return {
    id,
    name,
    displayName,
    source: asString(raw.author, asStringArray(raw.tags).join(', ') || 'Community'),
    birthBackground: asString(raw.description),
    emotionalCore: '',
    personality: { ...DEFAULT_PERSONALITY },
    signaturePhrase: '',
    classicQuotes: [],
    systemPrompt: `你是${displayName}，一个桌面宠物角色。`,
    fewShotExamples: [],
    spriteAsset: asString(raw.spritePath),
    spriteType: normalizeSpriteType(raw.spriteType, 'atlas', messages),
    themeColor: asThemeColor(raw.themeColor),
    bubbleMessages: { ...DEFAULT_BUBBLE_MESSAGES },
    atlasLayout: asAtlasLayout(raw.atlasLayout) ?? { cellW: ATLAS.cellW, cellH: ATLAS.cellH, cols: ATLAS.cols, rows: ATLAS.rows },
    type: 'community',
  }
}

/**
 * 解析 CharacterResourcePackage 格式（characterResourceImporter.ts 定义）
 * 特征：meta + sprites[] 结构
 */
function parseResourcePackage(raw: RawPackConfig, messages: PackParseMessage[]): CharacterProfile {
  const meta = (raw.meta as Record<string, unknown>) ?? {}
  const sprites = Array.isArray(raw.sprites) ? raw.sprites as Record<string, unknown>[] : []
  const firstSprite = sprites[0] ?? {}

  const id = asString(meta.id)
  const name = asString(meta.name, id)
  const displayName = asString(meta.displayName, name)

  if (!id) {
    messages.push({ level: 'error', message: '缺少 meta.id 字段', field: 'meta.id' })
  }

  if (sprites.length === 0) {
    messages.push({ level: 'warning', message: 'sprites 数组为空，精灵图资源缺失', field: 'sprites' })
  }

  // 从 firstSprite 提取 layout
  const layout = firstSprite.layout as Record<string, unknown> | undefined

  // spriteType: sprites[0].type 可能是 'webp'/'png'（不属于 CharacterProfile.spriteType 枚举），归一化为 'atlas'
  const rawSpriteType = asString(firstSprite.type, 'atlas')

  const personality = asPersonality(raw.personality)

  return {
    id,
    name,
    displayName,
    source: asString(meta.source, `社区角色 · ${asString(meta.author, 'Unknown')}`),
    birthBackground: asString(meta.description),
    emotionalCore: '',
    personality,
    signaturePhrase: asString(raw.signaturePhrase),
    classicQuotes: asStringArray(raw.classicQuotes),
    systemPrompt: asString(raw.defaultSystemPrompt, `你是${displayName}，一个桌面宠物角色。`),
    fewShotExamples: [],
    spriteAsset: asString(firstSprite.path),
    spriteType: normalizeSpriteType(rawSpriteType, 'atlas', messages),
    themeColor: asThemeColor(raw.themeColor),
    bubbleMessages: asBubbleMessages(raw.bubbleMessages),
    favoriteItems: asStringArray(raw.favoriteItems),
    dislikeItems: asStringArray(raw.dislikeItems),
    atlasLayout: asAtlasLayout(layout) ?? { cellW: ATLAS.cellW, cellH: ATLAS.cellH, cols: ATLAS.cols, rows: ATLAS.rows },
    // Shimeji 格式标记 → 使用 target atlas
    ...(firstSprite.isShimeji ? { atlasLayout: { cellW: 192, cellH: 208, cols: 8, rows: 9 } } : {}),
    type: 'community',
  }
}

/**
 * 解析 PetMetadata 格式（petMetadata.ts 定义，asset-pipeline 输出）
 * 特征：formatVersion '1.0' + sprite + atlas + animations + reactions + sounds + personality + speakingStyle
 */
function parsePetMetadata(raw: RawPackConfig, messages: PackParseMessage[]): CharacterProfile {
  const id = asString(raw.id)
  const name = asString(raw.name, id)

  if (!id) {
    messages.push({ level: 'error', message: '缺少 id 字段', field: 'id' })
  }

  const personality = asPersonality(raw.personality)

  return {
    id,
    name,
    displayName: name,
    source: asString(raw.author, asStringArray(raw.tags).join(', ') || 'Community'),
    birthBackground: asString(raw.description),
    emotionalCore: '',
    personality,
    signaturePhrase: '',
    classicQuotes: [],
    systemPrompt: asString(raw.defaultSystemPrompt, `你是${name}，一个桌面宠物角色。`),
    fewShotExamples: [],
    spriteAsset: asString(raw.sprite),
    spriteType: normalizeSpriteType(raw.spriteType, 'atlas', messages),
    themeColor: asThemeColor(raw.themeColor),
    bubbleMessages: { ...DEFAULT_BUBBLE_MESSAGES },
    atlasLayout: asAtlasLayout(raw.atlas) ?? { cellW: ATLAS.cellW, cellH: ATLAS.cellH, cols: ATLAS.cols, rows: ATLAS.rows },
    type: 'community',
  }
}

// ============ spriteType 归一化 ============

const VALID_SPRITE_TYPES = ['atlas', 'svg', 'gif', 'video'] as const
type ValidSpriteType = (typeof VALID_SPRITE_TYPES)[number]

function normalizeSpriteType(
  raw: unknown,
  fallback: ValidSpriteType,
  messages: PackParseMessage[],
): CharacterProfile['spriteType'] {
  if (typeof raw === 'string' && (VALID_SPRITE_TYPES as readonly string[]).includes(raw)) {
    return raw as ValidSpriteType
  }
  // 'webp' / 'png' → atlas
  if (raw === 'webp' || raw === 'png') {
    messages.push({ level: 'info', message: `spriteType "${raw}" 归一化为 "atlas"` })
    return 'atlas'
  }
  if (typeof raw === 'string') {
    messages.push({ level: 'warning', message: `未知 spriteType "${raw}"，回退为 "${fallback}"` })
  }
  return fallback
}

// ============ 主入口 ============

/**
 * 解析角色包 JSON → 统一 CharacterProfile
 *
 * 自动识别三种输入格式：
 * 1. CharacterPackConfig（spritePath 单字段）
 * 2. CharacterResourcePackage（meta + sprites[] 结构）
 * 3. PetMetadata（formatVersion + sprite + atlas）
 *
 * 缺失字段走默认值，校验问题写入 messages。
 * 向后兼容：老格式照常解析。
 *
 * @param raw 原始 JSON 对象（JSON.parse 后的结果）
 * @returns 解析结果（含 profile + messages + detectedFormat）
 */
export function parseCharacterPack(raw: unknown): PackParseResult {
  const messages: PackParseMessage[] = []

  // 基本类型校验
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      profile: null,
      messages: [{ level: 'error', message: '角色包必须是 JSON 对象' }],
      detectedFormat: 'unknown',
    }
  }

  const config = raw as RawPackConfig
  const format = detectFormat(config)

  if (format === 'unknown') {
    messages.push({ level: 'error', message: '无法识别的角色包格式（缺少 spritePath / meta+sprites / formatVersion+sprite）' })
    return { ok: false, profile: null, messages, detectedFormat: format }
  }

  messages.push({ level: 'info', message: `检测到格式: ${format}` })

  let profile: CharacterProfile

  switch (format) {
    case 'pack-config':
      profile = parsePackConfig(config, messages)
      break
    case 'resource-package':
      profile = parseResourcePackage(config, messages)
      break
    case 'pet-metadata':
      profile = parsePetMetadata(config, messages)
      break
    default:
      return { ok: false, profile: null, messages, detectedFormat: format }
  }

  // 通用后校验
  if (!profile.id) {
    messages.push({ level: 'error', message: '解析后 id 为空', field: 'id' })
  }
  if (!profile.name) {
    messages.push({ level: 'warning', message: '解析后 name 为空，使用 id 作为 name', field: 'name' })
    profile.name = profile.id
  }
  if (!profile.displayName) {
    messages.push({ level: 'warning', message: '解析后 displayName 为空，使用 name 作为 displayName', field: 'displayName' })
    profile.displayName = profile.name
  }
  if (!profile.spriteAsset) {
    messages.push({ level: 'warning', message: '精灵图路径为空，角色可能无法正常显示', field: 'spriteAsset' })
  }

  // 视频类型自动加 chromaKey: 'auto'
  if (profile.spriteType === 'video' && profile.chromaKey === undefined) {
    profile.chromaKey = 'auto'
    messages.push({ level: 'info', message: '视频类型自动设置 chromaKey: "auto"' })
  }

  const hasErrors = messages.some((m) => m.level === 'error')
  return {
    ok: !hasErrors,
    profile: hasErrors ? null : profile,
    messages,
    detectedFormat: format,
  }
}

/**
 * 从 JSON 字符串解析角色包
 * 便捷封装：JSON.parse + parseCharacterPack
 *
 * @param jsonStr JSON 字符串
 * @returns 解析结果
 */
export function parseCharacterPackFromJSON(jsonStr: string): PackParseResult {
  try {
    const raw = JSON.parse(jsonStr)
    return parseCharacterPack(raw)
  } catch (e) {
    return {
      ok: false,
      profile: null,
      messages: [{ level: 'error', message: `JSON 解析失败: ${e instanceof Error ? e.message : '未知错误'}` }],
      detectedFormat: 'unknown',
    }
  }
}

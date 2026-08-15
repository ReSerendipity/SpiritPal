/**
 * 宠物元数据格式模块
 *
 * @fileoverview 定义pet.json跨平台宠物包共享标准格式（参考OpenPets）
 *
 * 主要模块：
 * - PetMetadata: pet.json完整元数据接口
 * - PetAtlasConfig: 精灵图布局配置
 * - PetAnimation: 动画定义
 * - validatePetMetadata(): 元数据校验函数
 *
 * 依赖关系：
 * - types.ts: Personality/SpeakingStyle类型，ATLAS/ANIMATION_ROWS/OPENPETS_REACTION_MAP常量
 *
 * 核心接口：
 * - PetMetadata: pet.json完整结构
 * - validatePetMetadata(): 验证pet.json格式有效性
 * - loadPetMetadata(): 从文件加载元数据
 * - exportPetMetadata(): 导出为JSON字符串
 *
 * 核心功能（参考OpenPets packages/pet-format，MIT协议）：
 * 1. reactions字段：跨平台宠物包共享的反应映射
 * 2. 角色元数据：id/name/version/author/license/description/tags
 * 3. 动画映射：state → spritesheet行号/帧范围
 * 4. 音效映射：动作→音效文件
 * 5. 性格默认值：初始性格参数
 * 6. 精灵资源配置：sprite路径、类型、布局、主题色
 */

import type { Personality, SpeakingStyle } from './types'
import { ATLAS, ANIMATION_ROWS, OPENPETS_REACTION_MAP } from './types'

// ============ pet.json 元数据格式 ============

/** pet.json 完整元数据 */
export interface PetMetadata {
  /** 元数据格式版本 */
  formatVersion: '1.0'

  // ---- 基础信息 ----
  /** 角色唯一标识 */
  id: string
  /** 角色显示名称 */
  name: string
  /** 角色版本 */
  version: string
  /** 作者 */
  author: string
  /** 许可证 */
  license: string
  /** 角色描述 */
  description: string
  /** 标签/关键词 */
  tags: string[]

  // ---- 精灵资源 ----
  /** 精灵图文件路径（相对于包根目录） */
  sprite: string
  /** 精灵图类型 */
  spriteType: 'atlas' | 'svg' | 'gif' | 'video'
  /** 精灵图布局 */
  atlas: PetAtlasConfig
  /** 主题色 */
  themeColor: { primary: string; secondary: string }

  // ---- 动画映射 ----
  /** 动画定义：状态名 → 行/帧映射 */
  animations: PetAnimationMap
  /** 跨平台反应映射（OpenPets 兼容） */
  reactions: PetReactionMap

  // ---- 音效 ----
  /** 音效映射：事件名 → 音频文件路径 */
  sounds: Record<string, string>

  // ---- 性格默认值 ----
  /** 五维性格默认值 */
  personality: Personality
  /** 说话风格默认值 */
  speakingStyle: SpeakingStyle
  /** 默认系统提示词 */
  defaultSystemPrompt: string

  // ---- 兼容性 ----
  /** 兼容的应用列表 */
  compatibility: {
    spiritpal: string    // SpiritPal 版本范围
    openpets?: string // OpenPets 版本范围（可选）
    windowpet?: string // WindowPet 版本范围（可选）
  }
}

/** 精灵图集配置 */
export interface PetAtlasConfig {
  /** 单帧宽度 */
  cellW: number
  /** 单帧高度 */
  cellH: number
  /** 最大列数 */
  cols: number
  /** 最大行数 */
  rows: number
}

/** 动画映射条目 */
export interface PetAnimationEntry {
  /** 精灵图行号（0-indexed） */
  row: number
  /** 帧数 */
  frames: number
  /** 帧率 */
  fps?: number
  /** 是否循环 */
  loop?: boolean
  /** 下一动画状态 */
  next?: string | null
}

/** 动画映射：状态名 → 动画条目 */
export type PetAnimationMap = Record<string, PetAnimationEntry>

/** 反应映射：跨平台反应名 → 本地状态名 */
export type PetReactionMap = Record<string, string>

// ============ 默认元数据 ============

/** SpiritPal 标准角色的默认反应映射 */
export const DEFAULT_REACTIONS: PetReactionMap = {
  ...OPENPETS_REACTION_MAP,
  // SpiritPal 扩展反应
  coding_thinking: 'waiting',
  coding_editing: 'running',
  coding_testing: 'review',
  coding_success: 'jumping',
  coding_error: 'failed',
  coding_celebrating: 'waving',
}

/** 从 ANIMATION_ROWS 生成默认动画映射 */
export function createDefaultAnimationMap(): PetAnimationMap {
  const map: PetAnimationMap = {}
  for (const [name, rowDef] of Object.entries(ANIMATION_ROWS)) {
    map[name] = {
      row: rowDef.row,
      frames: rowDef.frames,
      fps: name.includes('run') ? 14 : 10,
      loop: !['jumping', 'waving'].includes(name),
      next: ['jumping', 'waving'].includes(name) ? 'idle' : undefined,
    }
  }
  return map
}

/** 创建标准 SpiritPal 元数据 */
export function createPetMetadata(
  overrides: Partial<PetMetadata> & Pick<PetMetadata, 'id' | 'name'>,
): PetMetadata {
  return {
    formatVersion: '1.0',
    version: '1.0.0',
    author: 'Unknown',
    license: 'MIT',
    description: '',
    tags: [],
    sprite: 'spritesheet.webp',
    spriteType: 'atlas',
    atlas: { cellW: ATLAS.cellW, cellH: ATLAS.cellH, cols: ATLAS.cols, rows: ATLAS.rows },
    themeColor: { primary: '#4ECDC4', secondary: '#FF6B6B' },
    animations: createDefaultAnimationMap(),
    reactions: DEFAULT_REACTIONS,
    sounds: {},
    personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0, rationality: 0 },
    speakingStyle: { tone: 'gentle', wordPreference: 'colloquial', catchphrases: [] },
    defaultSystemPrompt: '',
    compatibility: { spiritpal: '>=0.1.0' },
    ...overrides,
  }
}

// ============ 元数据验证 ============

/** 验证结果 */
export interface MetadataValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * 验证 pet.json 元数据
 */
export function validatePetMetadata(meta: PetMetadata): MetadataValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 必填字段检查
  if (!meta.id) errors.push('id 不能为空')
  if (!meta.name) errors.push('name 不能为空')
  if (!meta.version) errors.push('version 不能为空')
  if (!meta.author) warnings.push('author 为空，建议补充')
  if (!meta.license) errors.push('license 不能为空')

  // 许可证检查
  const allowedLicenses = ['MIT', 'CC0', 'CC-BY', 'CC-BY-SA', 'Apache-2.0', 'BSD-3-Clause']
  if (meta.license && !allowedLicenses.includes(meta.license) && !meta.license.startsWith('CC-BY')) {
    warnings.push(`许可证 ${meta.license} 可能不兼容 MIT，请确认`)
  }

  // 精灵图尺寸检查
  if (meta.atlas.cellW <= 0 || meta.atlas.cellH <= 0) {
    errors.push('精灵图帧尺寸必须为正数')
  }

  // 动画映射检查
  for (const [name, anim] of Object.entries(meta.animations)) {
    if (anim.row < 0 || anim.row >= meta.atlas.rows) {
      errors.push(`动画 "${name}" 的行号 ${anim.row} 超出范围`)
    }
    if (anim.frames <= 0 || anim.frames > meta.atlas.cols) {
      errors.push(`动画 "${name}" 的帧数 ${anim.frames} 超出范围 [1, ${meta.atlas.cols}]`)
    }
  }

  // 反应映射检查
  for (const [reaction, target] of Object.entries(meta.reactions)) {
    if (!meta.animations[target] && !ANIMATION_ROWS[target]) {
      warnings.push(`反应 "${reaction}" 映射到 "${target}"，但该动画不存在`)
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ============ 元数据序列化 ============

/**
 * 序列化 pet.json 元数据为 JSON 字符串
 */
export function serializePetMetadata(meta: PetMetadata): string {
  return JSON.stringify(meta, null, 2)
}

/**
 * 从 JSON 字符串解析 pet.json 元数据
 */
export function parsePetMetadata(json: string): PetMetadata | null {
  try {
    const data = JSON.parse(json) as PetMetadata
    // 基本格式检查
    if (!data.id || !data.name) return null
    return data
  } catch {
    return null
  }
}

/**
 * 从外部格式（如 OpenPets/WindowPet）转换为 SpiritPal 元数据
 */
export function convertFromExternalFormat(
  source: 'openpets' | 'windowpet',
  data: Record<string, unknown>,
): PetMetadata | null {
  try {
    if (source === 'openpets') {
      return convertFromOpenPets(data)
    } else if (source === 'windowpet') {
      return convertFromWindowPet(data)
    }
    return null
  } catch {
    return null
  }
}

/** 从 OpenPets 格式转换 */
function convertFromOpenPets(data: Record<string, unknown>): PetMetadata {
  const id = (data.id as string) ?? 'unknown'
  return createPetMetadata({
    id,
    name: (data.name as string) ?? id,
    version: (data.version as string) ?? '1.0.0',
    author: (data.author as string) ?? 'Unknown',
    license: (data.license as string) ?? 'MIT',
    description: (data.description as string) ?? '',
    reactions: {
      ...DEFAULT_REACTIONS,
      ...((data.reactions as Record<string, string>) ?? {}),
    },
  })
}

/** 从 WindowPet 格式转换 */
function convertFromWindowPet(data: Record<string, unknown>): PetMetadata {
  const id = (data.id as string) ?? 'unknown'
  return createPetMetadata({
    id,
    name: (data.name as string) ?? id,
    version: '1.0.0',
    author: (data.author as string) ?? 'Unknown',
    license: (data.license as string) ?? 'MIT',
    description: (data.description as string) ?? '',
    atlas: (data.atlas as PetAtlasConfig) ?? {
      cellW: 128, cellH: 128, cols: 8, rows: 9,
    },
  })
}

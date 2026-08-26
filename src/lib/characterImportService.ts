/**
 * 统一角色导入服务 — 所有 UI 的唯一入口
 *
 * @fileoverview
 * P1-2 统一入口：importCharacter(source) 接受 File / 目录路径 / JSON 字符串，
 * 自动识别格式 → parseCharacterPack → 校验 → 持久化（saveCustomCharacter）。
 *
 * 三条导入路径汇聚于此：
 * 1. JSON 角色卡（SillyTavern V2 / CharacterProfile JSON / pet.json）
 * 2. PNG 嵌卡（SillyTavern PNG tEXt chunk）
 * 3. 资源包目录（含 pet.json 的目录，通过 Rust 命令扫描）
 *
 * @module characterImportService
 * @requires ./characterPack - parseCharacterPack 统一解析
 * @requires ./characters - saveCustomCharacter 持久化
 * @requires ./characterCardImporter - SillyTavern 卡导入器
 */

import type { CharacterProfile } from './types'
import { parseCharacterPack, parseCharacterPackFromJSON, type PackParseResult } from './characterPack'
import { saveCustomCharacter } from './characters'
import {
  extractCharCardFromPNG,
  parseCharCardFromJSON,
  importCharacterCard,
  type SillyTavernCharacterCard,
} from './characterCardImporter'

// ============ 类型定义 ============

/** 导入来源类型 */
export type ImportSourceKind = 'json-file' | 'png-file' | 'json-string' | 'directory'

/** 导入来源 */
export interface ImportSource {
  /** 来源类型 */
  kind: ImportSourceKind
  /** JSON 字符串（kind='json-string' 时使用） */
  jsonStr?: string
  /** File 对象（kind='json-file' 或 'png-file' 时使用） */
  file?: File
  /** 目录路径（kind='directory' 时使用） */
  dirPath?: string
}

/** 统一导入结果 */
export interface UnifiedImportResult {
  /** 是否成功 */
  ok: boolean
  /** 新导入的角色 ID（成功时） */
  characterId?: string
  /** 导入的 CharacterProfile（成功时） */
  profile?: CharacterProfile
  /** 错误消息列表（失败时） */
  errors: string[]
  /** 警告消息列表 */
  warnings: string[]
  /** 检测到的来源格式 */
  detectedFormat?: string
}

// ============ 主入口 ============

/**
 * 统一角色导入入口 — 所有 UI 调用此函数
 *
 * 自动识别格式 → 解析 → 校验 → 持久化
 *
 * @param source 导入来源
 * @returns 统一结果
 */
export async function importCharacter(source: ImportSource): Promise<UnifiedImportResult> {
  switch (source.kind) {
    case 'json-string':
      return importFromJSONString(source.jsonStr ?? '')
    case 'json-file':
      return importFromFile(source.file!)
    case 'png-file':
      return importFromPNGFile(source.file!)
    case 'directory':
      return importFromDirectory(source.dirPath ?? '')
    default:
      return {
        ok: false,
        errors: [`未知的导入来源类型: ${source.kind}`],
        warnings: [],
      }
  }
}

// ============ JSON 字符串导入 ============

/**
 * 从 JSON 字符串导入角色
 * 先尝试解析为统一角色包格式，如果失败则尝试 SillyTavern 卡格式
 */
async function importFromJSONString(jsonStr: string): Promise<UnifiedImportResult> {
  // 1. 先尝试 parseCharacterPack（统一角色包格式）
  const packResult = parseCharacterPackFromJSON(jsonStr)

  if (packResult.ok && packResult.profile) {
    return finalizeImport(packResult)
  }

  // 2. 统一格式解析失败，尝试 SillyTavern 角色卡格式
  const card = parseCharCardFromJSON(jsonStr)
  if (card) {
    return importFromSillyTavernCard(card)
  }

  // 3. 两种格式都失败
  return {
    ok: false,
    errors: [
      ...packResult.messages.filter((m) => m.level === 'error').map((m) => m.message),
      '无法识别的 JSON 格式：既不是角色包也不是 SillyTavern 角色卡',
    ],
    warnings: packResult.messages.filter((m) => m.level === 'warning').map((m) => m.message),
    detectedFormat: packResult.detectedFormat,
  }
}

// ============ File 导入 ============

/**
 * 从 File 对象导入角色（JSON 文件）
 */
async function importFromFile(file: File): Promise<UnifiedImportResult> {
  try {
    const text = await file.text()
    return importFromJSONString(text)
  } catch (e) {
    return {
      ok: false,
      errors: [`读取文件失败: ${e instanceof Error ? e.message : '未知错误'}`],
      warnings: [],
    }
  }
}

/**
 * 从 PNG 文件导入角色（SillyTavern 嵌卡）
 */
async function importFromPNGFile(file: File): Promise<UnifiedImportResult> {
  try {
    const buffer = await file.arrayBuffer()
    const card = extractCharCardFromPNG(buffer)

    if (!card) {
      return {
        ok: false,
        errors: ['PNG 文件中未找到嵌入的角色卡数据（tEXt chunk: chara）'],
        warnings: [],
      }
    }

    return importFromSillyTavernCard(card)
  } catch (e) {
    return {
      ok: false,
      errors: [`读取 PNG 文件失败: ${e instanceof Error ? e.message : '未知错误'}`],
      warnings: [],
    }
  }
}

// ============ SillyTavern 角色卡导入 ============

/**
 * 从 SillyTavern 角色卡导入
 * 使用 characterCardImporter 的 importCharacterCard 生成 Partial<CharacterProfile>
 * 然后补全缺失字段 → 持久化
 */
async function importFromSillyTavernCard(card: SillyTavernCharacterCard): Promise<UnifiedImportResult> {
  const cardResult = await importCharacterCard(card)

  if (!cardResult.success || !cardResult.profile) {
    return {
      ok: false,
      errors: cardResult.errors,
      warnings: cardResult.warnings,
    }
  }

  // 补全 Partial<CharacterProfile> → 完整 CharacterProfile
  const partial = cardResult.profile
  const profile: CharacterProfile = {
    id: partial.id ?? `st-${Date.now().toString(36)}`,
    name: partial.name ?? card.name,
    displayName: partial.displayName ?? card.name,
    source: partial.source ?? 'SillyTavern Import',
    birthBackground: partial.birthBackground ?? '',
    emotionalCore: partial.emotionalCore ?? '',
    personality: partial.personality ?? { warmth: 0, liveliness: 0, dependence: 0, directness: 0, rationality: 0 },
    signaturePhrase: partial.signaturePhrase ?? '',
    classicQuotes: partial.classicQuotes ?? [],
    systemPrompt: partial.systemPrompt ?? '',
    fewShotExamples: partial.fewShotExamples ?? [],
    spriteAsset: partial.spriteAsset ?? '',
    spriteType: partial.spriteType ?? 'atlas',
    themeColor: partial.themeColor ?? { primary: '#4ECDC4', secondary: '#FF6B6B' },
    bubbleMessages: partial.bubbleMessages ?? {
      idle: ['…'],
      hungry: ['有点饿了'],
      sad: ['呜…'],
      pet: ['好舒服~'],
      feed: ['谢谢！'],
      pomodoroDone: ['休息一下~'],
    },
    type: 'community',
  }

  // 持久化
  saveCustomCharacter(profile)

  return {
    ok: true,
    characterId: profile.id,
    profile,
    errors: [],
    warnings: cardResult.warnings,
    detectedFormat: 'sillytavern-card',
  }
}

// ============ 目录导入 ============

/**
 * 从目录导入角色（通过 Rust 命令扫描）
 * 扫描含 pet.json 的子目录 → 解析 → 持久化
 */
async function importFromDirectory(dirPath: string): Promise<UnifiedImportResult> {
  try {
    // 动态 import 避免在非 Tauri 环境报错
    const { invoke } = await import('@tauri-apps/api/core')

    // 1. 扫描目录
    const dirs: string[] = await invoke('scan_character_directory', { path: dirPath })

    if (!dirs || dirs.length === 0) {
      return {
        ok: false,
        errors: [`目录 ${dirPath} 中未找到包含 pet.json 的角色包子目录`],
        warnings: [],
      }
    }

    // 2. 读取第一个 pet.json（单次导入，批量留给后续迭代）
    const firstDir = dirs[0]!
    const petJsonStr: string = await invoke('read_text_file', { path: `${firstDir}/pet.json` })

    // 3. 解析
    const packResult = parseCharacterPackFromJSON(petJsonStr)

    if (!packResult.ok || !packResult.profile) {
      return finalizeImport(packResult)
    }

    // 4. 如果有多个角色包，添加警告
    const warnings = [...packResult.messages.filter((m) => m.level === 'warning').map((m) => m.message)]
    if (dirs.length > 1) {
      warnings.push(`发现 ${dirs.length} 个角色包，已导入第一个，其余需重复导入操作`)
    }

    // 5. 持久化
    const profile = packResult.profile
    saveCustomCharacter(profile)

    return {
      ok: true,
      characterId: profile.id,
      profile,
      errors: [],
      warnings,
      detectedFormat: packResult.detectedFormat,
    }
  } catch (e) {
    return {
      ok: false,
      errors: [`目录导入失败: ${e instanceof Error ? e.message : String(e)}`],
      warnings: [],
    }
  }
}

// ============ 辅助 ============

/**
 * 将 parseCharacterPack 的结果转为统一导入结果
 * 成功则持久化，失败则返回错误
 */
function finalizeImport(packResult: PackParseResult): UnifiedImportResult {
  if (!packResult.ok || !packResult.profile) {
    return {
      ok: false,
      errors: packResult.messages.filter((m) => m.level === 'error').map((m) => m.message),
      warnings: packResult.messages.filter((m) => m.level === 'warning').map((m) => m.message),
      detectedFormat: packResult.detectedFormat,
    }
  }

  const profile = packResult.profile
  saveCustomCharacter(profile)

  return {
    ok: true,
    characterId: profile.id,
    profile,
    errors: [],
    warnings: packResult.messages.filter((m) => m.level === 'warning').map((m) => m.message),
    detectedFormat: packResult.detectedFormat,
  }
}

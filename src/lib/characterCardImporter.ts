/**
 * SillyTavern 角色卡导入器 — 将外部角色卡格式转换为 SpiritPal 五维性格参数
 * 参考 super-agent-party 的角色卡导入设计
 *
 * @fileoverview
 * 主要模块：
 * - SillyTavernCharacterCard 接口：SillyTavern V2 角色卡数据结构
 * - PersonalityInferenceResult 接口：性格推断结果
 * - importFromJSON()：从 JSON 导入角色卡
 * - extractFromPNG()：从 PNG 文件提取嵌入的角色卡数据
 * - inferPersonalityFromDescription()：LLM 驱动的性格推断（从描述推断五维参数）
 * - validateAndNormalize()：参数验证与归一化
 *
 * 核心功能：
 * 1. 解析 SillyTavern 角色卡 JSON 格式
 * 2. 从 PNG 文件提取嵌入的角色卡数据
 * 3. 映射到 SpiritPal 五维性格参数（warmth/liveliness/dependence/directness/rationality）
 * 4. LLM 驱动的性格推断（从角色描述推断五维参数）
 * 5. 参数验证与归一化（0-100 范围）
 *
 * @module characterCardImporter
 * @requires ./types - CharacterProfile, Personality, AIConfig, ChatMessage 类型定义
 * @requires ./llmClient - LLM 客户端
 * @requires ./jsonUtils - JSON 提取工具
 */

import type { CharacterProfile, Personality } from './types'
import { getLLMClient } from './llmClient'
import type { AIConfig, ChatMessage } from './types'
import { extractJSONString } from './jsonUtils'

// ============ SillyTavern 角色卡格式 ============

/** SillyTavern V2 角色卡数据 */
export interface SillyTavernCharacterCard {
  /** 角色名称 */
  name: string
  /** 角色描述（详细性格、背景等） */
  description: string
  /** 首条消息 */
  first_mes: string
  /** 替代首条消息 */
  alternate_greetings?: string[]
  /** 场景设定 */
  scenario?: string
  /** 角色性格摘要（简短标签式描述） */
  personality?: string
  /** System Prompt */
  system_prompt?: string
  /** 后续提示 */
  post_history_instructions?: string
  /** 标签 */
  tags?: string[]
  /** 创建者 */
  creator?: string
  /** 版本 */
  character_version?: string
  /** 扩展数据（V2 卡特有） */
  data?: {
    name?: string
    description?: string
    first_mes?: string
    alternate_greetings?: string[]
    scenario?: string
    personality?: string
    system_prompt?: string
    post_history_instructions?: string
    tags?: string[]
    creator?: string
    character_version?: string
    /** 扩展字段 */
    extensions?: Record<string, unknown>
  }
  /** 扩展字段 */
  extensions?: Record<string, unknown>
}

/** 导入结果 */
export interface ImportResult {
  /** 是否成功 */
  success: boolean
  /** 导入的角色配置 */
  profile?: Partial<CharacterProfile>
  /** 验证警告 */
  warnings: string[]
  /** 验证错误 */
  errors: string[]
}

// ============ PNG 提取 ============

/** PNG tEXt chunk 中的角色卡 key */
const CHAR_CARD_KEY = 'chara'

/**
 * 从 PNG 文件的 ArrayBuffer 中提取嵌入的角色卡数据
 * SillyTavern 将角色卡以 Base64 编码的 JSON 存储在 PNG tEXt chunk 中
 *
 * @param buffer PNG 文件的 ArrayBuffer
 * @returns 角色卡 JSON 数据（null 表示未找到）
 */
export function extractCharCardFromPNG(buffer: ArrayBuffer): SillyTavernCharacterCard | null {
  const bytes = new Uint8Array(buffer)

  // 验证 PNG 签名
  const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return null
    }
  }

  // 遍历 PNG chunks，寻找 tEXt chunk
  let offset = 8 // 跳过 PNG 签名

  while (offset < bytes.length) {
    // 读取 chunk 长度（4 字节大端序）
    const chunkLength =
      ((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)

    // 读取 chunk 类型（4 字节 ASCII）
    const chunkType = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    )

    // tEXt chunk 格式：keyword\0text
    if (chunkType === 'tEXt') {
      const dataStart = offset + 8
      // 找到 null 分隔符
      let nullIdx = dataStart
      while (nullIdx < dataStart + chunkLength && bytes[nullIdx] !== 0) {
        nullIdx++
      }

      const keyword = new TextDecoder().decode(
        bytes.slice(dataStart, nullIdx),
      )

      if (keyword === CHAR_CARD_KEY) {
        // 提取 Base64 编码的角色卡数据
        const textData = new TextDecoder().decode(
          bytes.slice(nullIdx + 1, dataStart + chunkLength),
        )

        try {
          // Base64 解码 → JSON 解析
          const decoded = atob(textData)
          const card = JSON.parse(decoded) as SillyTavernCharacterCard
          return normalizeCard(card)
        } catch (e) {
          console.warn('[CharCardImporter] Failed to decode char card from PNG:', e)
          return null
        }
      }
    }

    // IEND chunk，结束遍历
    if (chunkType === 'IEND') break

    // 移动到下一个 chunk（长度 + 类型 + 数据 + CRC = 4 + 4 + chunkLength + 4）
    offset += 12 + chunkLength
  }

  return null
}

/**
 * 从 JSON 字符串解析角色卡
 * @param jsonStr JSON 字符串
 * @returns 角色卡数据（null 表示解析失败）
 */
export function parseCharCardFromJSON(jsonStr: string): SillyTavernCharacterCard | null {
  try {
    const card = JSON.parse(jsonStr) as SillyTavernCharacterCard
    return normalizeCard(card)
  } catch {
    return null
  }
}

/**
 * 归一化角色卡数据
 * SillyTavern V2 卡可能在 data 字段中嵌套数据，需展平
 */
function normalizeCard(card: SillyTavernCharacterCard): SillyTavernCharacterCard {
  // V2 格式：数据在 data 字段中
  if (card.data) {
    return {
      name: card.data.name ?? card.name ?? '',
      description: card.data.description ?? card.description ?? '',
      first_mes: card.data.first_mes ?? card.first_mes ?? '',
      alternate_greetings: card.data.alternate_greetings ?? card.alternate_greetings ?? [],
      scenario: card.data.scenario ?? card.scenario ?? '',
      personality: card.data.personality ?? card.personality ?? '',
      system_prompt: card.data.system_prompt ?? card.system_prompt ?? '',
      post_history_instructions: card.data.post_history_instructions ?? card.post_history_instructions ?? '',
      tags: card.data.tags ?? card.tags ?? [],
      creator: card.data.creator ?? card.creator ?? '',
      character_version: card.data.character_version ?? card.character_version ?? '',
    }
  }

  return card
}

// ============ 性格映射 ============

/** 性格关键词到五维参数的映射规则 */
interface PersonalityMappingRule {
  /** 关键词列表 */
  keywords: string[]
  /** 匹配时对五维参数的增量 */
  delta: Partial<Personality>
}

const PERSONALITY_RULES: PersonalityMappingRule[] = [
  // 温暖/友善
  { keywords: ['温柔', '善良', '体贴', '关心', '暖', 'caring', 'kind', 'warm', 'sweet'],
    delta: { warmth: 0.3, liveliness: 0.1, dependence: 0.1 } },
  // 冷淡/严肃
  { keywords: ['冷漠', '冷淡', '严肃', '冷酷', 'cold', 'serious', 'stoic', 'aloof'],
    delta: { warmth: -0.3, directness: 0.2, rationality: 0.2 } },
  // 活泼/开朗
  { keywords: ['活泼', '开朗', '外向', '热情', '元气', 'lively', 'cheerful', 'energetic', 'bubbly'],
    delta: { liveliness: 0.4, warmth: 0.1 } },
  // 沉静/内向
  { keywords: ['安静', '内向', '沉静', '害羞', 'quiet', 'shy', 'introverted', 'reserved'],
    delta: { liveliness: -0.3, dependence: 0.1 } },
  // 粘人/依赖
  { keywords: ['粘人', '依赖', '撒娇', 'clingy', 'dependent', 'attached'],
    delta: { dependence: 0.4, warmth: 0.1 } },
  // 独立/自主
  { keywords: ['独立', '自主', '坚强', 'independent', 'strong', 'self-reliant'],
    delta: { dependence: -0.3, rationality: 0.1 } },
  // 直率/坦白
  { keywords: ['直率', '坦白', '直接', '直言', 'blunt', 'direct', 'honest', 'frank'],
    delta: { directness: 0.4 } },
  // 含蓄/委婉
  { keywords: ['含蓄', '委婉', '委曲', '隐晦', 'subtle', 'indirect', 'diplomatic'],
    delta: { directness: -0.3, warmth: 0.1 } },
  // 理性/冷静
  { keywords: ['理性', '冷静', '逻辑', '分析', 'rational', 'logical', 'analytical', 'calm'],
    delta: { rationality: 0.4, directness: 0.1 } },
  // 感性/情绪化
  { keywords: ['感性', '情绪', '多愁', '浪漫', 'emotional', 'romantic', 'sensitive', 'moody'],
    delta: { rationality: -0.3, warmth: 0.1, dependence: 0.1 } },
  // 傲娇/吐槽
  { keywords: ['傲娇', '吐槽', '毒舌', 'tsundere', 'sarcastic', 'snarky'],
    delta: { warmth: -0.1, directness: 0.3, liveliness: 0.2 } },
  // 可爱/萌
  { keywords: ['可爱', '萌', '呆萌', 'cute', 'adorable', 'moe'],
    delta: { warmth: 0.2, liveliness: 0.2, dependence: 0.1 } },
]

/**
 * 从角色描述文本推断五维性格参数
 * 基于关键词匹配的规则推断
 *
 * @param description 角色描述文本
 * @param personality 角色性格标签
 * @returns 五维性格参数
 */
export function inferPersonalityFromDescription(
  description: string,
  personality?: string,
): Personality {
  const text = `${description} ${personality ?? ''}`.toLowerCase()

  // 初始化五维参数
  const result: Personality = {
    warmth: 0,
    liveliness: 0,
    dependence: 0,
    directness: 0,
    rationality: 0,
  }

  // 应用匹配规则
  for (const rule of PERSONALITY_RULES) {
    const matched = rule.keywords.some((kw) => text.includes(kw.toLowerCase()))
    if (matched) {
      if (rule.delta.warmth !== undefined) result.warmth += rule.delta.warmth
      if (rule.delta.liveliness !== undefined) result.liveliness += rule.delta.liveliness
      if (rule.delta.dependence !== undefined) result.dependence += rule.delta.dependence
      if (rule.delta.directness !== undefined) result.directness += rule.delta.directness
      if (rule.delta.rationality !== undefined) result.rationality += rule.delta.rationality
    }
  }

  // 归一化到 -1 到 1
  result.warmth = Math.max(-1, Math.min(1, result.warmth))
  result.liveliness = Math.max(-1, Math.min(1, result.liveliness))
  result.dependence = Math.max(-1, Math.min(1, result.dependence))
  result.directness = Math.max(-1, Math.min(1, result.directness))
  result.rationality = Math.max(-1, Math.min(1, result.rationality))

  return result
}

/**
 * 使用 LLM 推断五维性格参数
 * 当关键词匹配不够准确时，使用 LLM 从角色描述推断
 *
 * @param description 角色描述
 * @param config AI 配置
 * @returns 五维性格参数（null 表示推断失败）
 */
export async function inferPersonalityWithLLM(
  description: string,
  config?: AIConfig,
): Promise<Personality | null> {
  if (!config) return null

  const systemPrompt = `你是一个性格分析器。根据给定的角色描述，推断角色的五维性格参数。
每个维度的值为 -1 到 1 之间的小数：
- warmth: 温度（-1=冷漠, 1=温暖）
- liveliness: 活泼（-1=沉静, 1=活泼）
- dependence: 依赖（-1=独立, 1=粘人）
- directness: 直率（-1=含蓄, 1=直率）
- rationality: 理性（-1=感性, 1=理性）

只返回 JSON 格式，不要包含其他文本。示例：
{"warmth": 0.5, "liveliness": -0.3, "dependence": 0.2, "directness": 0.1, "rationality": -0.4}`

  try {
    const client = getLLMClient(config)
    const messages: ChatMessage[] = [
      { id: 'sys', role: 'system', content: systemPrompt, timestamp: Date.now() },
      { id: 'user', role: 'user', content: description, timestamp: Date.now() },
    ]
    const response = await client.chatOnce(messages)
    const jsonStr = extractJSONString(response)
    if (!jsonStr) return null

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>

    // 验证并归一化
    const clamp = (v: unknown): number => {
      const n = typeof v === 'number' ? v : 0
      return Math.max(-1, Math.min(1, n))
    }

    return {
      warmth: clamp(parsed.warmth),
      liveliness: clamp(parsed.liveliness),
      dependence: clamp(parsed.dependence),
      directness: clamp(parsed.directness),
      rationality: clamp(parsed.rationality),
    }
  } catch {
    return null
  }
}

// ============ 角色卡导入主入口 ============

/**
 * 导入 SillyTavern 角色卡
 * 支持从 JSON 字符串或 PNG 文件导入
 *
 * @param card 角色卡数据
 * @param llmConfig LLM 配置（可选，用于 LLM 驱动的性格推断）
 * @returns 导入结果
 */
export async function importCharacterCard(
  card: SillyTavernCharacterCard,
  llmConfig?: AIConfig,
): Promise<ImportResult> {
  const warnings: string[] = []
  const errors: string[] = []

  // 验证必要字段
  if (!card.name?.trim()) {
    errors.push('角色名称不能为空')
  }

  if (errors.length > 0) {
    return { success: false, warnings, errors }
  }

  // 映射到 SpiritPal 角色配置
  const profile: Partial<CharacterProfile> = {}

  // 基础信息
  profile.id = `st-${card.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`
  profile.name = card.name
  profile.displayName = card.name

  // 背景故事
  profile.birthBackground = card.description?.slice(0, 200) ?? ''

  // System Prompt
  profile.systemPrompt = [
    card.system_prompt,
    card.scenario ? `场景: ${card.scenario}` : '',
    card.personality ? `性格: ${card.personality}` : '',
    card.post_history_instructions ? `后续指令: ${card.post_history_instructions}` : '',
  ].filter(Boolean).join('\n\n')

  // 标志短语（首条消息作为口头禅的候选）
  profile.signaturePhrase = card.first_mes?.slice(0, 30) ?? ''

  // 五维性格参数推断
  const descriptionText = [
    card.description,
    card.personality,
  ].filter(Boolean).join('\n')

  // 优先使用 LLM 推断，回退到关键词匹配
  let personality: Personality | null = null
  if (llmConfig) {
    personality = await inferPersonalityWithLLM(descriptionText, llmConfig)
    if (personality) {
      warnings.push('性格参数由 LLM 推断，建议人工校验')
    }
  }

  if (!personality) {
    personality = inferPersonalityFromDescription(
      card.description ?? '',
      card.personality,
    )
    warnings.push('性格参数由关键词匹配推断，精度有限')
  }

  profile.personality = personality

  // 验证性格参数
  const dims = ['warmth', 'liveliness', 'dependence', 'directness', 'rationality'] as const
  for (const dim of dims) {
    const val = personality[dim]
    if (Math.abs(val) < 0.1) {
      warnings.push(`性格维度 "${dim}" 接近中性，可能推断不够准确`)
    }
  }

  return {
    success: true,
    profile,
    warnings,
    errors,
  }
}

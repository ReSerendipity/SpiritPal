/**
 * 五维性格引擎模块
 *
 * @fileoverview 将五维性格参数合成为自然语言描述和System Prompt片段（基于PRD §7.3）
 *
 * 主要模块：
 * - 五维描述函数: warmthDesc/livelinessDesc/dependenceDesc/directnessDesc/rationalityDesc
 * - generateSystemPrompt(): 生成完整System Prompt
 * - PersonalityEngine: 性格引擎主类
 *
 * 依赖关系：
 * - types.ts: Personality/PersonalityConfig/CharacterProfile等类型
 *
 * 核心接口：
 * - personalityToText(): 将五维参数转为自然语言描述
 * - generateSystemPrompt(): 根据性格配置生成LLM System Prompt
 * - adjustSpeakingStyle(): 调整说话风格参数
 * - getInteractionPreferences(): 获取交互偏好
 *
 * 五维性格模型（PRD §7.3）：
 * - warmth (温度): -1=冷漠疏离, 0=中立, 1=热情温暖
 * - liveliness (活泼): -1=沉静内敛, 0=平衡, 1=活泼好动
 * - dependence (依赖): -1=独立自主, 0=平衡, 1=粘人依赖
 * - directness (直率): -1=含蓄委婉, 0=平衡, 1=直率坦诚
 * - rationality (理性): -1=感性冲动, 0=平衡, 1=理性冷静
 */

import type { Personality, PersonalityConfig, CharacterProfile, SpeakingStyle, InteractionPreferences, SchedulePeriod } from './types'

// ============ 性格参数 → 自然语言描述 ============

function warmthDesc(v: number): string {
  if (v >= 0.7) return '非常热情温暖，总是主动关心他人，语气充满温度'
  if (v >= 0.3) return '比较温和友善，会主动表达关心'
  if (v >= -0.3) return '态度平和，不过分热情也不冷漠'
  if (v >= -0.7) return '比较冷淡，不太主动表达情感'
  return '冷漠疏离，极少主动表达情感，语气冷淡'
}

function livelinessDesc(v: number): string {
  if (v >= 0.7) return '非常活泼好动，语气轻快，常用感叹号和语气词'
  if (v >= 0.3) return '比较活泼，偶尔使用语气词和感叹号'
  if (v >= -0.3) return '性格平和，语气平稳'
  if (v >= -0.7) return '比较安静沉稳，语气平静'
  return '非常沉静内敛，说话简短克制'
}

function dependenceDesc(v: number): string {
  if (v >= 0.7) return '非常依赖主人，经常寻求关注和陪伴，害怕被冷落'
  if (v >= 0.3) return '比较依赖主人，喜欢陪伴和互动'
  if (v >= -0.3) return '既享受陪伴也能独处，较为平衡'
  if (v >= -0.7) return '比较独立，不需要太多关注也能自处'
  return '非常独立自主，几乎不寻求关注，享受独处'
}

function directnessDesc(v: number): string {
  if (v >= 0.7) return '非常直率坦诚，有什么说什么，不拐弯抹角'
  if (v >= 0.3) return '比较直率，倾向于直接表达想法'
  if (v >= -0.3) return '表达方式适中，既不特别直白也不特别委婉'
  if (v >= -0.7) return '比较含蓄委婉，喜欢用暗示和比喻'
  return '非常含蓄委婉，总是旁敲侧击，从不直说'
}

function rationalityDesc(v: number): string {
  if (v >= 0.7) return '非常理性冷静，说话逻辑清晰，很少被情绪左右'
  if (v >= 0.3) return '比较理性，遇事冷静分析'
  if (v >= -0.3) return '理性与感性并存，视情况而定'
  if (v >= -0.7) return '比较感性，容易被情绪影响'
  return '非常感性冲动，情绪波动大，容易被感情左右'
}

// ============ 说话风格映射 ============

function toneWords(p: Personality): string[] {
  const words: string[] = []
  if (p.warmth > 0.5) words.push('呀', '呢', '~')
  if (p.liveliness > 0.5) words.push('!', '啦', '嘿')
  if (p.dependence > 0.5) words.push('嘛', '呜')
  if (p.warmth < -0.3) words.push('哼')
  if (p.rationality > 0.5) words.push('所以', '因此')
  return words
}

function emojiStyle(p: Personality): string {
  if (p.warmth > 0.5 && p.liveliness > 0.3) return '😊💕✨🎉'
  if (p.warmth < -0.3) return '😐'
  if (p.liveliness < -0.3) return '🌙'
  if (p.rationality > 0.5) return '📊💡'
  return '✨'
}

function avgLength(p: Personality): string {
  if (p.liveliness > 0.5) return 'short'
  if (p.rationality > 0.5) return 'long'
  return 'medium'
}

function formalityLevel(p: Personality): string {
  if (p.rationality > 0.5) return '偏书面化，逻辑清晰'
  if (p.warmth > 0.3) return '口语化，亲切自然'
  return '日常口语'
}

// ============ System Prompt 合成引擎 ============

export function composePersonalityPrompt(p: Personality): string {
  const lines: string[] = []

  lines.push('【性格特征】')
  lines.push(`- 温度：${warmthDesc(p.warmth)}`)
  lines.push(`- 活泼：${livelinessDesc(p.liveliness)}`)
  lines.push(`- 依赖：${dependenceDesc(p.dependence)}`)
  lines.push(`- 直率：${directnessDesc(p.directness)}`)
  lines.push(`- 理性：${rationalityDesc(p.rationality)}`)

  lines.push('')
  lines.push('【说话风格】')
  const tones = toneWords(p)
  if (tones.length > 0) {
    lines.push(`- 常用语气词：${tones.join('、')}`)
  }
  lines.push(`- 表情风格：${emojiStyle(p)}`)
  lines.push(`- 句子长度偏好：${avgLength(p)}`)
  lines.push(`- 正式程度：${formalityLevel(p)}`)

  // 互动指导
  lines.push('')
  lines.push('【互动指导】')
  if (p.dependence > 0.5) {
    lines.push('- 会主动询问主人近况，期待回应')
  }
  if (p.warmth > 0.5) {
    lines.push('- 主动安慰主人，表达关心')
  }
  if (p.rationality > 0.5) {
    lines.push('- 给建议时条理分明，先分析后建议')
  }
  if (p.liveliness > 0.5) {
    lines.push('- 回复节奏快，充满活力')
  }
  if (p.directness > 0.5) {
    lines.push('- 直说想法，不绕弯子')
  }

  return lines.join('\n')
}

// ============ 完整 System Prompt 合成 ============

export function composeFullSystemPrompt(
  basePrompt: string,
  personality: Personality,
  customPersonality?: Personality,
): string {
  const effective = customPersonality ?? personality
  const personalityPrompt = composePersonalityPrompt(effective)
  return `${basePrompt}\n\n${personalityPrompt}`
}

// ============ 性格参数标签 ============

export const PERSONALITY_LABELS: Record<keyof Personality, { label: string; min: string; max: string }> = {
  warmth: { label: '温度', min: '冷漠', max: '温暖' },
  liveliness: { label: '活泼', min: '沉静', max: '活泼' },
  dependence: { label: '依赖', min: '独立', max: '粘人' },
  directness: { label: '直率', min: '含蓄', max: '直率' },
  rationality: { label: '理性', min: '感性', max: '理性' },
}

// ============ 性格参数持久化 ============

const PERSONALITY_STORAGE_KEY = 'spiritpal-personality-overrides'

export function loadPersonalityOverrides(): Record<string, Personality> {
  try {
    const raw = localStorage.getItem(PERSONALITY_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // 忽略
  }
  return {}
}

export function savePersonalityOverride(characterId: string, personality: Personality): void {
  try {
    const all = loadPersonalityOverrides()
    all[characterId] = personality
    localStorage.setItem(PERSONALITY_STORAGE_KEY, JSON.stringify(all))
  } catch {
    // 忽略
  }
}

export function removePersonalityOverride(characterId: string): void {
  try {
    const all = loadPersonalityOverrides()
    delete all[characterId]
    localStorage.setItem(PERSONALITY_STORAGE_KEY, JSON.stringify(all))
  } catch {
    // 忽略
  }
}

export function getEffectivePersonality(
  characterId: string,
  defaultPersonality: Personality,
): Personality {
  const overrides = loadPersonalityOverrides()
  return overrides[characterId] ?? defaultPersonality
}

// ============ 完整性格配置持久化（F1.8 性格可视化编辑器）============

const PERSONALITY_CONFIG_STORAGE_KEY = 'spiritpal-personality-config-overrides'

// 根据五维参数推断默认说话风格
function inferSpeakingStyle(p: Personality): SpeakingStyle {
  let tone: SpeakingStyle['tone'] = 'gentle'
  if (p.warmth > 0.6) tone = p.liveliness > 0.4 ? 'enthusiastic' : 'gentle'
  else if (p.warmth < 0.2) tone = 'cold'
  else if (p.liveliness > 0.5) tone = 'lively'

  let wordPreference: SpeakingStyle['wordPreference'] = 'colloquial'
  if (p.rationality > 0.5) wordPreference = 'formal'
  else if (p.liveliness > 0.5) wordPreference = 'internet'

  return { tone, wordPreference, catchphrases: [] }
}

// 根据五维参数推断默认互动偏好
function inferInteractionPrefs(p: Personality): InteractionPreferences {
  return {
    likeHeadPat: p.warmth > 0.3 && p.dependence > 0.0,
    hateDrag: p.warmth < 0.4 && p.rationality > 0.3,
    interactionFrequency: p.dependence > 0.5 ? 'high' : p.dependence < -0.2 ? 'low' : 'medium',
  }
}

// 默认作息时段
const DEFAULT_SCHEDULE_PERIODS: SchedulePeriod[] = [
  { id: 'd1', start: 7, end: 22, type: 'active' },
  { id: 'd2', start: 22, end: 24, type: 'sleep' },
  { id: 'd3', start: 0, end: 7, type: 'sleep' },
]

// 从角色档案构建默认的完整性格配置
export function buildDefaultPersonalityConfig(character: CharacterProfile): PersonalityConfig {
  return {
    personality: { ...character.personality },
    speakingStyle: inferSpeakingStyle(character.personality),
    interactionPrefs: inferInteractionPrefs(character.personality),
    schedule: DEFAULT_SCHEDULE_PERIODS.map((s) => ({ ...s })),
    systemPrompt: character.systemPrompt,
  }
}

export function loadPersonalityConfigOverrides(): Record<string, PersonalityConfig> {
  try {
    const raw = localStorage.getItem(PERSONALITY_CONFIG_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // 忽略
  }
  return {}
}

export function savePersonalityConfigOverride(characterId: string, config: PersonalityConfig): void {
  try {
    const all = loadPersonalityConfigOverrides()
    all[characterId] = config
    localStorage.setItem(PERSONALITY_CONFIG_STORAGE_KEY, JSON.stringify(all))
    // 同步保存五维性格覆盖（兼容旧的 PersonalityPanel）
    savePersonalityOverride(characterId, config.personality)
  } catch {
    // 忽略
  }
}

export function removePersonalityConfigOverride(characterId: string): void {
  try {
    const all = loadPersonalityConfigOverrides()
    delete all[characterId]
    localStorage.setItem(PERSONALITY_CONFIG_STORAGE_KEY, JSON.stringify(all))
    removePersonalityOverride(characterId)
  } catch {
    // 忽略
  }
}

export function getEffectivePersonalityConfig(
  characterId: string,
  defaults: PersonalityConfig,
): PersonalityConfig {
  const overrides = loadPersonalityConfigOverrides()
  return overrides[characterId] ?? defaults
}

// ============ Chapter 14: 五维性格引擎增强 ============

/**
 * 情绪映射联动 — 高温暖度 → 偏好 [joy] 情绪
 * 根据性格参数推断偏好的情绪类型
 */
export function mapPersonalityToEmotions(p: Personality): string[] {
  const emotions: string[] = []

  // 温暖度高 → 偏好积极情绪
  if (p.warmth > 0.5) {
    emotions.push('joy', 'love', 'gratitude')
  }
  // 温暖度低 → 偏好消极/中性情绪
  if (p.warmth < -0.3) {
    emotions.push('cold', 'indifference')
  }

  // 活泼度高 → 偏好高唤醒情绪
  if (p.liveliness > 0.5) {
    emotions.push('excitement', 'playful', 'curious')
  }
  // 活泼度低 → 偏好低唤醒情绪
  if (p.liveliness < -0.3) {
    emotions.push('calm', 'serene', 'contemplative')
  }

  // 依赖度高 → 偏好亲密情绪
  if (p.dependence > 0.5) {
    emotions.push('attachment', 'longing', 'comfort')
  }
  // 依赖度低 → 偏好独立情绪
  if (p.dependence < -0.3) {
    emotions.push('pride', 'satisfaction')
  }

  // 直率高 → 偏好坦诚情绪表达
  if (p.directness > 0.5) {
    emotions.push('frustration', 'determination')
  }
  // 含蓄 → 偏好微妙情绪
  if (p.directness < -0.3) {
    emotions.push('wistful', 'nostalgia')
  }

  // 理性高 → 偏好认知情绪
  if (p.rationality > 0.5) {
    emotions.push('focused', 'analytical')
  }
  // 感性 → 偏好情感情绪
  if (p.rationality < -0.3) {
    emotions.push('empathy', 'sorrow')
  }

  // 始终包含基础情绪
  if (emotions.length === 0) {
    emotions.push('neutral', 'content')
  }

  return emotions
}

/**
 * 性格漂移 — 基于交互历史，性格参数缓慢变化
 * @param current 当前性格参数
 * @param interaction 交互类型
 * @param intensity 交互强度 (0-1)
 * @returns 漂移后的性格参数
 */
export function applyPersonalityDrift(
  current: Personality,
  interaction: 'praise' | 'scold' | 'ignore' | 'play' | 'feed' | 'chat' | 'longAbsence',
  intensity: number = 0.5,
): Personality {
  const drift = 0.02 * intensity // 每次交互最大漂移 0.02
  const result = { ...current }

  switch (interaction) {
    case 'praise':
      // 被夸奖：温暖度和依赖度轻微上升
      result.warmth = clampPersonality(result.warmth + drift * 0.5)
      result.dependence = clampPersonality(result.dependence + drift * 0.3)
      break
    case 'scold':
      // 被责备：温暖度轻微下降，独立度上升
      result.warmth = clampPersonality(result.warmth - drift * 0.3)
      result.dependence = clampPersonality(result.dependence - drift * 0.5)
      result.directness = clampPersonality(result.directness - drift * 0.2)
      break
    case 'ignore':
      // 被忽略：依赖度下降，独立度上升
      result.dependence = clampPersonality(result.dependence - drift * 0.4)
      result.warmth = clampPersonality(result.warmth - drift * 0.2)
      break
    case 'play':
      // 一起玩：活泼度和温暖度上升
      result.liveliness = clampPersonality(result.liveliness + drift * 0.3)
      result.warmth = clampPersonality(result.warmth + drift * 0.2)
      break
    case 'feed':
      // 喂食：依赖度和温暖度轻微上升
      result.dependence = clampPersonality(result.dependence + drift * 0.2)
      result.warmth = clampPersonality(result.warmth + drift * 0.1)
      break
    case 'chat':
      // 聊天：温暖度和理性微调
      result.warmth = clampPersonality(result.warmth + drift * 0.2)
      break
    case 'longAbsence':
      // 长时间不见：依赖度下降，独立度上升
      result.dependence = clampPersonality(result.dependence - drift * 0.6)
      result.liveliness = clampPersonality(result.liveliness - drift * 0.2)
      break
  }

  return result
}

/** 性格参数夹紧到 [-1, 1] */
function clampPersonality(v: number): number {
  return Math.max(-1, Math.min(1, v))
}

/**
 * 跨角色性格比较
 * @returns 两个性格的相似度 (0-1)
 */
export function comparePersonalities(a: Personality, b: Personality): number {
  const dimensions: (keyof Personality)[] = ['warmth', 'liveliness', 'dependence', 'directness', 'rationality']
  let sumSquaredDiff = 0
  for (const dim of dimensions) {
    const diff = a[dim] - b[dim]
    sumSquaredDiff += diff * diff
  }
  // 欧几里得距离，最大距离 = sqrt(5 * 4) = sqrt(20) ≈ 4.47
  const maxDistance = Math.sqrt(20)
  const distance = Math.sqrt(sumSquaredDiff)
  // 转换为相似度 (1 = 完全相同, 0 = 完全相反)
  return 1 - distance / maxDistance
}

/**
 * 性格可视化数据 — 返回五维雷达图数据
 */
export function getPersonalityRadarData(p: Personality): Array<{ dimension: string; value: number; label: string }> {
  return [
    { dimension: 'warmth',     value: (p.warmth + 1) / 2,     label: PERSONALITY_LABELS.warmth.label },
    { dimension: 'liveliness', value: (p.liveliness + 1) / 2, label: PERSONALITY_LABELS.liveliness.label },
    { dimension: 'dependence', value: (p.dependence + 1) / 2, label: PERSONALITY_LABELS.dependence.label },
    { dimension: 'directness', value: (p.directness + 1) / 2, label: PERSONALITY_LABELS.directness.label },
    { dimension: 'rationality',value: (p.rationality + 1) / 2,label: PERSONALITY_LABELS.rationality.label },
  ]
}

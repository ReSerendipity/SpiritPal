/**
 * 角色一致性后处理校验 — 检测 AI 回复是否偏离角色性格，生成修正提示
 * 基于 PRD 角色一致性要求：支持关键词检测与修正 prompt 生成
 *
 * @fileoverview
 * 主要模块：
 * - PersonalityArchetype 类型：5 种性格原型（soft/energetic/sharp/intellectual/tsundere）
 * - ARCHETYPE_LABELS：性格原型中文名映射
 * - CONFLICT_KEYWORDS：各性格类型的冲突关键词库（不应使用的词汇）
 * - ConsistencyCheckResult 接口：一致性检查结果
 * - checkCharacterConsistency()：检查 AI 回复是否符合角色性格
 * - generateCorrectionPrompt()：生成修正 prompt
 * - getArchetypeFromPersonality()：从五维性格参数推断性格原型
 *
 * 支持五种性格类型：软萌 / 元气 / 毒舌 / 知性 / 傲娇
 * 每种类型有对应的冲突关键词库，检测 AI 回复是否包含偏离性格的词汇
 *
 * @module characterConsistency
 * @requires ./types - Personality 类型定义
 * @requires ./characters - getCharacter 角色获取函数
 */

import type { Personality } from './types'
import { getCharacter } from './characters'

// ============ 性格类型定义 ============
export type PersonalityArchetype = 'soft' | 'energetic' | 'sharp' | 'intellectual' | 'tsundere'

export const ARCHETYPE_LABELS: Record<PersonalityArchetype, string> = {
  soft: '软萌',
  energetic: '元气',
  sharp: '毒舌',
  intellectual: '知性',
  tsundere: '傲娇',
}

// ============ 角色性格冲突关键词库 ============
// 按性格类型分组，列出该类型角色不应使用的词汇
const CONFLICT_KEYWORDS: Record<PersonalityArchetype, string[]> = {
  // 软萌角色不应说：脏话、攻击性词汇、冷漠语气词
  soft: [
    // 脏话
    '卧槽', '操', '草泥马', '妈的', '他妈', '靠', '滚蛋', '去死', '傻逼', '贱',
    // 攻击性词汇
    '讨厌你', '恨你', '烦死了', '别烦我', '少啰嗦', '别理我', '闭嘴', '你烦不烦',
    '懒得理你', '恶心', '去你的',
    // 冷漠语气词
    '哦', '随便', '无所谓', '不关心', '不在乎', '随你便', '爱怎样怎样', '与我无关',
    '关我什么事', '关你什么事', '哼，随便',
  ],
  // 元气角色不应说：消沉/丧气词汇（元气角色应积极向上）
  energetic: [
    '没意思', '算了', '不想动', '好累啊', '烦死了', '没希望', '没救了', '放弃吧',
    '随便吧', '就这样吧', '不想做了', '太麻烦了', '没动力', '好无聊',
    '我做不到', '我不行', '太失败了', '没意义', '活着好累',
  ],
  // 毒舌角色不应说：过于温柔/撒娇的词汇（但可以嘴硬心软）
  sharp: [
    // 过于撒娇的语气
    '嘤嘤嘤', '呜呜呜', '哼唧', '嘤', '抱抱', '亲亲', '么么哒', '贴贴',
    '人家', '本宝宝', '小可爱', '求求你', '不要嘛', '人家害怕',
    // 过于直白的温柔
    '我会永远陪着你', '你最好了', '最爱你了', '离不开你',
  ],
  // 知性角色不应说：网络流行语、低俗词汇
  intellectual: [
    // 网络流行语
    'yyds', '绝绝子', '乌鱼子', '芭比Q', 'emoha', '栓Q', '破防了', '6六六', '666',
    'xswl', 'awsl', '绝了', '蚌埠住了', '小镇做题家', '社死', '内卷', '躺平',
    '摆烂', '种草', '拔草',
    // 低俗词汇
    '卧槽', '操', '草', '牛逼', '屌', '逗比', '蛋疼', '二逼',
  ],
  // 傲娇角色不应说：直接表白/过于坦率的情感表达
  tsundere: [
    '我喜欢你', '我爱你', '我离不开你', '你是我最重要的人', '我好想你',
    '我很在乎你', '我为你担心', '我舍不得你', '你是我的全部',
    '没有你我活不下去', '我最喜欢你了', '永远爱你',
    '好想好想你', '我每天都在想你', '你是我的唯一',
  ],
}

// ============ 根据五维参数推断性格类型 ============
export function inferArchetype(personality: Personality): PersonalityArchetype {
  const { warmth, liveliness, dependence, directness, rationality } = personality

  // 知性：高理性 + 低活泼
  if (rationality > 0.4 && liveliness < 0) return 'intellectual'

  // 毒舌：低温度 + 高直率
  if (warmth < 0.2 && directness > 0.2) return 'sharp'

  // 傲娇：低温度但高依赖（外冷内热）
  if (warmth < 0.4 && dependence > 0.3 && directness < 0.2) return 'tsundere'

  // 软萌：高温度 + 低直率 + 低理性
  if (warmth > 0.5 && directness < 0.1) return 'soft'

  // 元气：高活泼 + 中高温度
  if (liveliness > 0.4 && warmth > 0.2) return 'energetic'

  // 默认根据最显著特征判断
  if (warmth >= 0.5) return 'soft'
  if (liveliness >= 0.5) return 'energetic'
  if (rationality >= 0.5) return 'intellectual'
  if (directness >= 0.3) return 'sharp'
  return 'tsundere'
}

// ============ 获取角色的性格类型 ============
// 优先从角色档案的 systemPrompt/catchphrase 中推断，其次从五维参数推断
export function getCharacterArchetype(characterId: string): PersonalityArchetype {
  const character = getCharacter(characterId)
  if (!character) return 'soft'
  return inferArchetype(character.personality)
}

// ============ 一致性校验结果 ============
export interface ConsistencyResult {
  isConsistent: boolean
  violations: string[]
}

// ============ 校验回复一致性 ============
// 检查回复是否包含与角色性格冲突的关键词
export function checkConsistency(reply: string, characterId: string): ConsistencyResult {
  const archetype = getCharacterArchetype(characterId)
  const keywords = CONFLICT_KEYWORDS[archetype]
  const violations: string[] = []
  const lowerReply = reply.toLowerCase()

  for (const kw of keywords) {
    // 对英文网络用语做小写匹配，中文直接 includes
    const lowerKw = kw.toLowerCase()
    if (lowerReply.includes(lowerKw)) {
      violations.push(kw)
    }
  }

  return {
    isConsistent: violations.length === 0,
    violations,
  }
}

// ============ 生成修正 Prompt ============
// 提示 AI 重新生成符合性格的回复
export function generateCorrectionPrompt(characterId: string, violations: string[]): string {
  const character = getCharacter(characterId)
  const archetype = getCharacterArchetype(characterId)
  const archetypeLabel = ARCHETYPE_LABELS[archetype]
  const charName = character?.displayName ?? characterId

  const violationList = violations.map((v) => `「${v}」`).join('、')

  const archetypeGuidance: Record<PersonalityArchetype, string> = {
    soft: '你是软萌角色，语气应温柔可爱、温暖治愈。不要使用脏话、攻击性词汇或冷漠语气词。可以用"呀""呢""~"等软萌语气词，主动关心主人。',
    energetic: '你是元气角色，语气应积极向上、充满活力。不要使用消沉、丧气或放弃的词汇。多用感叹号和积极的语气词，鼓励主人。',
    sharp: '你是毒舌角色，嘴上不饶人但内心可以柔软（嘴硬心软）。不要使用过于撒娇的词汇如"嘤嘤嘤""抱抱"。可以毒舌但不要真正伤害主人。',
    intellectual: '你是知性角色，说话应逻辑清晰、措辞得体。不要使用网络流行语或低俗词汇。用词典雅，分析问题有条理。',
    tsundere: '你是傲娇角色，不要直接表白或过于坦率地表达情感。情感应通过暗示、别扭的方式表达，比如"哼，才不是为你呢"。',
  }

  return [
    `【角色一致性修正】`,
    `你的回复中出现了不符合「${charName}」（${archetypeLabel}型）性格的词汇：${violationList}。`,
    ``,
    archetypeGuidance[archetype],
    ``,
    `请基于以上性格要求，重新生成一条符合角色设定的回复。保持角色一致性，避免使用上述冲突词汇。`,
  ].join('\n')
}

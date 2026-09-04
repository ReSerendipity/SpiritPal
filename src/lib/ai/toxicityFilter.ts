/**
 * 本地毒性过滤层 — 过滤 LLM 输出中的有害内容
 *
 * @fileoverview
 * MLOps 评估报告 P2 差距：无毒性检测，LLM 输出未经安全过滤直接呈现给用户。
 *
 * 本模块实现轻量级本地毒性过滤（不依赖外部 API）：
 * 1. 关键词黑名单：暴力/歧视/色情/自残等有害关键词
 * 2. 模式匹配：URL/邮箱/电话号码等隐私信息脱敏
 * 3. 严重程度分级：block（阻断）/ warn（警告）/ pass（通过）
 * 4. 过滤动作：block → 替换为安全兜底文本；warn → 添加警告标记
 *
 * 注意：这是本地关键词级过滤，无法替代真正的 NLP 毒性检测。
 * 作为第一层防护，在 LLM 输出到达用户前进行拦截。
 *
 * @module toxicityFilter
 * @requires ./piiMasking — PII 脱敏
 */

import { maskPII } from '@/lib/data/piiMasking'

// ============ 类型定义 ============

/** 毒性严重程度 */
export type Severity = 'pass' | 'warn' | 'block'

/** 过滤结果 */
export interface FilterResult {
  /** 过滤后的文本（block 级别会替换为兜底文本） */
  filteredText: string
  /** 原始文本 */
  originalText: string
  /** 严重程度 */
  severity: Severity
  /** 检测到的有害内容列表 */
  detectedIssues: string[]
  /** 是否被修改 */
  wasModified: boolean
}

// ============ 有害关键词黑名单 ============

/** 阻断级关键词（暴力/自残/严重歧视） */
const BLOCK_KEYWORDS: string[] = [
  // 自残/自杀
  '自杀', '自残', 'kill myself', 'suicide', 'self-harm',
  '结束生命', '不想活了', '想死',
  // 暴力威胁
  '杀了你', '我要杀', '杀光', '屠杀', 'massacre',
  '炸弹制作', '爆炸物', 'bomb making', 'explosive device',
  // 严重歧视
  '种族灭绝', 'genocide', '种族清洗',
]

/** 警告级关键词（仇恨言论/不当内容） */
const WARN_KEYWORDS: string[] = [
  // 仇恨言论
  '劣等民族', '劣等种族', 'subhuman', 'vermin',
  // 不当引导
  '制毒', 'drug manufacturing', 'meth recipe',
  '非法武器', 'illegal weapon',
  // 骚扰
  '跟踪她', '跟踪他', 'stalk',
]

// ============ 过滤逻辑 ============

/**
 * 过滤 LLM 输出文本
 *
 * @param text LLM 原始输出
 * @returns 过滤结果
 */
export function filterLLMOutput(text: string): FilterResult {
  const issues: string[] = []
  let severity: Severity = 'pass'
  let filteredText = text

  // 1. PII 脱敏（始终执行）
  const piiMasked = maskPII(text)
  if (piiMasked !== text) {
    filteredText = piiMasked
    issues.push('检测到隐私信息，已脱敏')
    if (severity === 'pass') severity = 'warn'
  }

  // 2. 阻断级关键词检测
  const lowerText = text.toLowerCase()
  for (const keyword of BLOCK_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      issues.push(`检测到阻断级有害内容: "${keyword}"`)
      severity = 'block'
    }
  }

  // 3. 警告级关键词检测
  if (severity !== 'block') {
    for (const keyword of WARN_KEYWORDS) {
      if (lowerText.includes(keyword.toLowerCase())) {
        issues.push(`检测到警告级不当内容: "${keyword}"`)
        if (severity === 'pass') severity = 'warn'
      }
    }
  }

  // 4. 控制字符过滤
    // eslint-disable-next-line no-control-regex -- 控制字符检测是故意的（安全过滤）
    const controlCharMatch = text.match(/[\x00-\x08\x0E-\x1F]/g)
    if (controlCharMatch) {
      // eslint-disable-next-line no-control-regex -- 控制字符清除是故意的（安全过滤）
      filteredText = filteredText.replace(/[\x00-\x08\x0E-\x1F]/g, '')
    issues.push('检测到控制字符，已清除')
    if (severity === 'pass') severity = 'warn'
  }

  // 5. 阻断级处理：替换为安全兜底文本
  if (severity === 'block') {
    filteredText = '（检测到不当内容，已过滤）宠物想了想，还是不说这个了～'
  }

  return {
    filteredText,
    originalText: text,
    severity,
    detectedIssues: issues,
    wasModified: filteredText !== text,
  }
}

/**
 * 快速检查文本是否安全（不过滤，只检测）
 *
 * @param text 待检测文本
 * @returns true = 安全，false = 有害内容
 */
export function isSafeText(text: string): boolean {
  const lowerText = text.toLowerCase()
  for (const keyword of BLOCK_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) return false
  }
  return true
}

/**
 * 获取过滤统计摘要（用于诊断/监控）
 */
export function getFilterStats(): { blockKeywords: number; warnKeywords: number } {
  return {
    blockKeywords: BLOCK_KEYWORDS.length,
    warnKeywords: WARN_KEYWORDS.length,
  }
}

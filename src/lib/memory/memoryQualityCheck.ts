/**
 * 记忆质量校验 — 巩固后 semantic 摘要与原文语义相似度自动评估
 *
 * @fileoverview
 * MLOps 评估报告 P2 差距：记忆巩固后无质量校验，摘要可能丢失关键信息。
 *
 * 本模块在记忆巩固（episodic → semantic 晋升）后自动评估摘要质量：
 * 1. 关键词覆盖率：原文中的关键实体/概念是否在摘要中出现
 * 2. 语义相似度：摘要与原文的 token 重叠率（Jaccard 相似度）
 * 3. 信息密度：摘要的信息量是否合理（不过短=信息丢失，不过长=未有效压缩）
 * 4. 幻觉检测：摘要中是否包含原文中不存在的新信息（关键词超出原文）
 *
 * 质量不达标时：
 * - 记录告警（通过 runtimeMonitor）
 * - 标记该摘要需要人工复核
 * - 低分摘要保留原文（不替换）
 *
 * @module memoryQualityCheck
 * @requires ./stringSimilarity — Jaccard 相似度
 * @requires ./runtimeMonitor — 告警
 */

import { runtimeMonitor } from '@/lib/system/runtimeMonitor'
import { tokenize, stringSimilarity } from '@/lib/system/stringSimilarity'

// ============ 类型定义 ============

/** 记忆质量评估结果 */
export interface MemoryQualityResult {
  /** 综合质量分数（0-1） */
  overallScore: number
  /** 关键词覆盖率（0-1） */
  keywordCoverage: number
  /** 语义相似度（0-1） */
  semanticSimilarity: number
  /** 信息密度合理性（0-1） */
  densityScore: number
  /** 幻觉检测分数（0-1，越高越好=幻觉越少） */
  hallucinationScore: number
  /** 是否通过质量校验 */
  passed: boolean
  /** 不通过时的原因列表 */
  issues: string[]
}

// ============ 常量 ============

/** 质量通过阈值 */
const QUALITY_PASS_THRESHOLD = 0.5

/** 摘要最小合理长度（字符数） */
const MIN_SUMMARY_LENGTH = 10

/** 摘要最大合理长度与原文的比例 */
const MAX_SUMMARY_RATIO = 0.8

/** 摘要最小合理长度与原文的比例 */
const MIN_SUMMARY_RATIO = 0.05

// ============ 评估函数 ============

/**
 * 评估记忆巩固后摘要的质量
 *
 * @param originalText 原文（对话记录拼接）
 * @param summary 摘要（LLM 生成的总结）
 * @returns 质量评估结果
 */
export function evaluateMemoryQuality(
  originalText: string,
  summary: string,
): MemoryQualityResult {
  const issues: string[] = []

  // 1. 关键词覆盖率
  const keywordCoverage = computeKeywordCoverage(originalText, summary)
  if (keywordCoverage < 0.2) {
    issues.push('关键实体覆盖率过低，摘要可能遗漏重要信息')
  }

  // 2. 语义相似度
  const semanticSimilarity = stringSimilarity(originalText, summary)
  if (semanticSimilarity < 0.15) {
    issues.push('语义相似度过低，摘要可能偏离原文')
  }

  // 3. 信息密度
  const densityScore = computeDensityScore(originalText, summary)
  if (densityScore < 0.3) {
    issues.push('信息密度不合理，摘要过短或过长')
  }

  // 4. 幻觉检测
  const hallucinationScore = computeHallucinationScore(originalText, summary)
  if (hallucinationScore < 0.5) {
    issues.push('摘要中包含原文中不存在的新关键词，可能存在幻觉')
  }

  // 综合分数
  const overallScore = Math.round(
    (keywordCoverage * 0.35 +
    semanticSimilarity * 0.25 +
    densityScore * 0.20 +
    hallucinationScore * 0.20) * 100,
  ) / 100

  const passed = overallScore >= QUALITY_PASS_THRESHOLD && issues.length === 0

  // 不通过时告警
  if (!passed) {
    runtimeMonitor.emitAlertProxy('memory_quality_low', {
      score: overallScore,
      issues,
      summaryLength: summary.length,
      originalLength: originalText.length,
    })
  }

  return {
    overallScore,
    keywordCoverage,
    semanticSimilarity,
    densityScore,
    hallucinationScore,
    passed,
    issues,
  }
}

/**
 * 计算关键词覆盖率
 * 提取原文中的关键词（去停用词后），检查在摘要中出现的比例
 */
function computeKeywordCoverage(originalText: string, summary: string): number {
  const originalTokens = new Set(tokenize(originalText))
  const summaryTokens = new Set(tokenize(summary))

  if (originalTokens.size === 0) return 1.0

  // 计算原文关键词在摘要中出现的比例
  let covered = 0
  for (const token of originalTokens) {
    if (summaryTokens.has(token)) {
      covered++
    }
  }

  return Math.round((covered / originalTokens.size) * 100) / 100
}

/**
 * 计算信息密度合理性
 * 摘要长度应该在原文的 5%-80% 之间
 */
function computeDensityScore(originalText: string, summary: string): number {
  const originalLen = originalText.length
  const summaryLen = summary.length

  if (originalLen === 0) return 1.0
  if (summaryLen < MIN_SUMMARY_LENGTH) return 0.0

  const ratio = summaryLen / originalLen

  if (ratio > MAX_SUMMARY_RATIO) {
    // 摘要过长 = 未有效压缩
    return Math.max(0, 1 - (ratio - MAX_SUMMARY_RATIO) * 2)
  }

  if (ratio < MIN_SUMMARY_RATIO) {
    // 摘要过短 = 信息丢失
    return Math.max(0, ratio / MIN_SUMMARY_RATIO * 0.5)
  }

  // 合理区间
  return 1.0
}

/**
 * 幻觉检测
 * 检查摘要中是否包含原文中完全不存在的关键词
 */
function computeHallucinationScore(originalText: string, summary: string): number {
  const originalTokens = new Set(tokenize(originalText))
  const summaryTokens = new Set(tokenize(summary))

  if (summaryTokens.size === 0) return 0.5

  // 计算摘要中有多少关键词在原文中不存在
  let novelKeywords = 0
  for (const token of summaryTokens) {
    if (!originalTokens.has(token)) {
      novelKeywords++
    }
  }

  const noveltyRatio = novelKeywords / summaryTokens.size

  // 新关键词比例越高，幻觉分数越低
  // 但允许一定比例的新关键词（如摘要中的连接词）
  if (noveltyRatio <= 0.3) return 1.0
  if (noveltyRatio <= 0.5) return 0.7
  if (noveltyRatio <= 0.7) return 0.4
  return 0.1
}

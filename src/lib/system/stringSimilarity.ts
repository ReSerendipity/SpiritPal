/**
 * @file stringSimilarity.ts
 * @description 字符串相似度与分词工具模块（纯函数，无副作用）
 *
 * 主要功能：
 * 1. 基于 LCS（最长公共子序列）计算字符串相似度比率
 * 2. 中英文混合分词（CJK 单字 + 拉丁单词）
 * 3. 混合文本 token 数量估算（CJK 1 token/字，拉丁 4 chars/token）
 *
 * 主要模块：
 * - lcsLength(): LCS 长度计算（内部函数，一维滚动数组优化）
 * - stringSimilarity(): 字符串相似度比率（0-1）
 * - tokenize(): 文本分词（CJK 单字 + 拉丁单词，小写化）
 * - estimateTokens(): 估算 token 数量
 *
 * 依赖关系：无外部依赖（纯字符串处理）
 *
 * 核心接口：
 * - stringSimilarity(a, b): 计算两个字符串的相似度
 * - tokenize(text): 文本分词
 * - estimateTokens(text): 估算 token 数
 *
 * [REFACTOR] R2 - 从 enhancedMemory.ts 拆分，职责单一化：
 *   - 消除 enhancedMemory.ts 与 memoryManager.ts 的循环依赖风险
 *   - 纯函数无副作用，便于单元测试
 *   - 复用 LCS 算法支持中文/拉丁文混合文本
 */

// ============ 字符串相似度：基于最长公共子序列（LCS）============
// 移植自原 memoryManager.ts，避免循环依赖
// OPTIMIZE: 使用单数组 + 临时变量实现，空间复杂度从 O(2n) 优化到 O(n)
// 通过在计算前保存对角线值，避免使用两个完整数组
function lcsLength(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return 0

  // 确保 n 是较短的字符串，最小化数组大小
  const [shorter, longer] = m < n ? [a, b] : [b, a]
  const shortLen = shorter.length
  const longLen = longer.length

  // 单数组滚动优化：只需一个长度为 shortLen+1 的数组
  // prevDiag 保存 dp[i-1][j-1] 的值（对角线）
  const dp = new Array<number>(shortLen + 1).fill(0)

  for (let i = 1; i <= longLen; i++) {
    let prevDiag = 0 // dp[i-1][0] 始终为 0
    for (let j = 1; j <= shortLen; j++) {
      const temp = dp[j] // 保存当前 dp[j]（即下一列的 prevDiag）
      if (longer[i - 1] === shorter[j - 1]) {
        dp[j] = prevDiag + 1
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1])
      }
      prevDiag = temp
    }
  }
  return dp[shortLen]
}

/**
 * 相似度比率：LCS 长度 / 较长字符串长度（0-1）
 * - 1 表示完全相同
 * - 0 表示完全无公共字符
 */
export function stringSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0
  const lcs = lcsLength(a, b)
  return lcs / Math.max(a.length, b.length)
}

// ============ 分词：CJK 单字 + 拉丁单词 ============
// 移植自原 memoryManager.ts
/**
 * 将文本切分为 token 数组
 * - CJK 字符（中日韩统一表意文字 + 扩展）按单字切分
 * - 拉丁字母数字按单词切分
 * - 所有 token 转小写，便于大小写无关匹配
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  if (!text) return tokens
  // 正则：匹配 CJK 字符（中日韩统一表意文字 + 扩展）或拉丁字母数字单词
  const re = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]|[a-zA-Z0-9]+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    tokens.push(match[0].toLowerCase())
  }
  return tokens
}

// ============ Token 估算（混合 CJK + 拉丁）============
// CJK 字符约 1 token/字，拉丁字符约 4 chars/token
/**
 * 估算文本的 token 数量（粗略估算）
 * - CJK 字符：1 token/字
 * - 拉丁字符：4 chars/token
 * 用于构建对话上下文时控制 token 预算
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      cjk++
    } else {
      other++
    }
  }
  return Math.ceil(cjk + other / 4)
}
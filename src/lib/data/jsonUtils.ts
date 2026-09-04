/**
 * JSON 提取工具模块
 *
 * @fileoverview 从 LLM 返回的非结构化文本中提取 JSON 字符串/对象
 *
 * 主要模块：
 * - extractJSONString: 提取 JSON 字符串（三策略降级）
 * - extractJSONObject: 提取并解析为 JSON 对象
 *
 * 依赖关系：
 * - 无外部依赖，纯字符串处理
 *
 * 核心接口：
 * - extractJSONString(): 从文本中提取 JSON 字符串
 * - extractJSONObject(): 提取并解析为 JSON 对象
 *
 * 提取策略（按优先级）：
 * 1. 直接 JSON.parse 整段文本
 * 2. 从 ```json ... ``` 代码块中提取
 * 3. 匹配第一个 { 到最后一个 } 的子串
 *
 * 使用场景：
 * LLM 返回可能包含解释文本、Markdown 代码块等，本工具提取其中的 JSON 部分，
 * 供 llmClient.ts 和 aiAgent.ts 等模块共用（DRY 原则）
 */

/**
 * 从文本中提取 JSON 字符串
 *
 * 依次尝试三种策略：
 * 1. 直接 JSON.parse 整段文本
 * 2. 从 ```json ... ``` 代码块中提取
 * 3. 从第一个 { 到最后一个 } 的子串
 *
 * @returns JSON 字符串（可直接 JSON.parse），若未找到则返回 null
 */
export function extractJSONString(text: string): string | null {
  // 策略 1：直接解析
  try {
    JSON.parse(text)
    return text
  } catch {
    // 不是纯 JSON
  }

  // 策略 2：从 ```json ... ``` 代码块中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim()
  }

  // 策略 3：从第一个 { 到最后一个 } 的子串
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1)
  }

  return null
}

/**
 * 从文本中提取并解析 JSON 对象
 *
 * @returns 解析后的对象，若未找到有效 JSON 则返回 null
 */
export function extractJSONObject(text: string): Record<string, unknown> | null {
  const jsonStr = extractJSONString(text)
  if (!jsonStr) return null
  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 解析失败
  }
  return null
}

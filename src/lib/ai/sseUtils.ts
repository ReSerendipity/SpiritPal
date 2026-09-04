/**
 * @file sseUtils.ts
 * @description SSE 流解析工具模块 — 提取 LLM 客户端公共流读取逻辑
 *
 * 核心优化：
 * 1. DRY 提取：chatOpenAI/chatOllama/chatClaude/chatGemini 4 个 provider 共用此逻辑
 * 2. 使用 string[] 数组代替 += 拼接，将 O(n²) 字符串拼接降为 O(n)
 * 3. 统一 SSE/逐行 JSON 两种协议的解析框架
 * 4. 支持自定义 delta 提取和终止判断
 *
 * 主要模块：
 * - DeltaExtractor: 从 JSON 对象提取文本增量的类型
 * - TerminationChecker: 判断流是否终止的类型
 * - StreamLineType: SSE 行类型（sse/raw_json）
 * - readTextStream(): 读取文本流并逐块回调
 *
 * 依赖关系：无外部依赖（使用 Web Streams API 和 TextDecoder）
 *
 * 核心接口：
 * - readTextStream(): 读取 ReadableStream，解析 SSE/JSON 行，回调文本增量
 *
 * [Quality Review] DRY 提取：替代 4 个 LLM provider 中重复的流读取逻辑
 */

/** 从解析后的 JSON 对象中提取文本增量 */
export type DeltaExtractor = (json: unknown) => string | null

/** 判断流是否应终止 */
export type TerminationChecker = (json: unknown) => boolean

/** SSE 行类型 */
export type StreamLineType = 'sse' | 'raw_json'

/**
 * 读取文本流并逐块回调
 *
 * [Quality Review] DRY 提取 — 替代 4 个 LLM provider 中重复的流读取逻辑。
 * 使用 string[] 累积文本避免 O(n²) 字符串拼接。
 *
 * @param body      ReadableStream（来自 fetch response.body）
 * @param options   解析配置
 * @param onChunk   每收到一个文本片段时调用
 * @returns         完整文本
 */
export async function readTextStream(
  body: ReadableStream<Uint8Array>,
  options: {
    lineType: StreamLineType
    extractDelta: DeltaExtractor
    isTerminated?: TerminationChecker
  },
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  // [Quality Review] 使用数组代替 += 拼接，避免大响应 O(n²) 开销
  const chunks: string[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // 最后一行可能不完整，保留到下一轮
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        // SSE 协议：行以 "data:" 开头
        // 原始 JSON 协议：整行即 JSON
        let data: string
        if (options.lineType === 'sse') {
          if (!trimmed.startsWith('data:')) continue
          data = trimmed.slice(5).trim()
          if (!data || data === '[DONE]') continue
        } else {
          data = trimmed
        }

        try {
          const json = JSON.parse(data)
          const delta = options.extractDelta(json)
          if (typeof delta === 'string' && delta.length > 0) {
            chunks.push(delta)
            onChunk?.(delta)
          }
          if (options.isTerminated?.(json)) {
            return chunks.join('')
          }
        } catch {
          // 单行 JSON 解析失败则跳过（可能是心跳或注释行）
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return chunks.join('')
}

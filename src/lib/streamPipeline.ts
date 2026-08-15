/**
 * @file streamPipeline.ts
 * @description 流式管道模块 — 4 层异步 Generator 管道架构
 *
 * 核心设计：
 * 4 层 async generator 管道实现背压控制：
 * 1. Layer 1 (Split): SentenceDivider 将流式文本拆分为完整句子 + ThinkTagParser 处理 think 标签
 * 2. Layer 2 (Action): 将句子映射为显示动作 + TTS 任务
 * 3. Layer 3 (Display): 产出显示事件供 UI 渲染
 * 4. Layer 4 (TTS): 将文本并行发送至 TTS，与显示解耦（可选层）
 *
 * 背压控制机制：
 * - 使用 async generator 实现：下游消费慢时，上游自动暂停，避免内存膨胀
 * - 各层可独立配置和替换
 *
 * 主要模块：
 * - StreamEventType: 流式事件类型枚举
 * - StreamEvent: 流式事件接口
 * - PipelineOptions: 管道配置接口
 * - PipelineStats: 管道统计信息接口
 * - streamPipeline(): 主管道函数
 * - createPipelineWithStats(): 带统计收集的管道
 * - collectPipelineEvents(): 同步收集所有事件
 *
 * 依赖关系：
 * - ./sentenceDivider: SentenceDivider 句子分割器
 * - ./thinkTagParser: ThinkTagParser think 标签解析器
 *
 * 核心接口：
 * - streamPipeline(): 创建 4 层处理管道，返回事件流 AsyncGenerator
 * - createPipelineWithStats(): 创建带统计的管道消费者
 * - collectPipelineEvents(): 批量收集所有事件（用于测试/非实时场景）
 *
 * Phase 2.2: Split→Action→Display→TTS 四层独立处理
 * 参考：Open-LLM-VTuber 的 live2d_model.py + sentence_divider.py 流式架构
 */

import { SentenceDivider, type SentenceDividerCallbacks } from './sentenceDivider'
import { ThinkTagParser, ThinkTagState } from './thinkTagParser'

// ============ 类型定义 ============

/** 流式管道事件类型 */
export enum StreamEventType {
  /** 文本增量（用于 UI 逐字显示） */
  TextDelta = 'text_delta',
  /** 完整句子（分割后的句子边界） */
  Sentence = 'sentence',
  /** Think 内容（内心独白，半透明显示） */
  ThinkContent = 'think_content',
  /** TTS 请求（将此文本发送给 TTS） */
  TTSRequest = 'tts_request',
  /** TTS 音频就绪（TTS 合成完成） */
  TTSAudioReady = 'tts_audio_ready',
  /** 流结束 */
  StreamEnd = 'stream_end',
  /** 错误 */
  Error = 'error',
}

/** 流式管道事件 */
export interface StreamEvent {
  /** 事件类型 */
  type: StreamEventType
  /** 事件数据 */
  data: string
  /** 句子序号（从 0 开始） */
  sentenceIndex?: number
  /** 是否为首句 */
  isFirst?: boolean
  /** 是否为 Think 内容 */
  isThink?: boolean
  /** 时间戳 */
  timestamp: number
}

/** 管道配置选项 */
export interface PipelineOptions {
  /** 句子分割选项 */
  sentenceDivider?: SentenceDividerCallbacks
  /** 是否启用 TTS 层（默认 false） */
  enableTTS?: boolean
  /** TTS 回调（接收文本，返回音频） */
  ttsCallback?: (text: string, sentenceIndex: number) => Promise<ArrayBuffer | null>
  /** 显示回调（接收显示事件） */
  onDisplay?: (event: StreamEvent) => void
  /** 是否在首句前注入 loading 状态 */
  showLoadingBeforeFirstSentence?: boolean
}

/** 管道统计信息 */
export interface PipelineStats {
  /** 总输入 chunk 数 */
  totalChunks: number
  /** 总输出句子数 */
  totalSentences: number
  /** 首句延迟（毫秒，从首个 chunk 到首句输出） */
  firstSentenceLatencyMs: number | null
  /** Think 内容长度 */
  thinkContentLength: number
  /** TTS 请求次数 */
  ttsRequestCount: number
  /** 管道总耗时（毫秒） */
  totalDurationMs: number | null
}

// ============ Layer 1: Split（句子分割）============

/**
 * Layer 1: 将流式文本 chunk 拆分为完整句子
 * 
 * 输入：AsyncIterable<string>（LLM 流式输出）
 * 输出：AsyncGenerator<SentenceEvent>（完整句子事件）
 * 
 * 使用 SentenceDivider 处理分割逻辑
 * 同时处理 Think 标签，将 think 内容和 reply 内容分别输出
 */
async function* splitLayer(
  source: AsyncIterable<string>,
  callbacks?: SentenceDividerCallbacks,
): AsyncGenerator<StreamEvent> {
  const divider = new SentenceDivider(callbacks)
  const thinkParser = new ThinkTagParser()
  let sentenceIndex = 0

  for await (const chunk of source) {
    if (!chunk) continue

    // Think 标签解析
    const parseResult = thinkParser.push(chunk)

    // 如果在 think 标签内，累积 think 内容
    if (parseResult.state === ThinkTagState.Inside) {
      // 提取新增的 think 内容
      const newThink = parseResult.thinkContent
      if (newThink) {
        yield {
          type: StreamEventType.ThinkContent,
          data: newThink,
          isThink: true,
          timestamp: Date.now(),
        }
      }
      continue
    }

    // 正常文本：通过 SentenceDivider 分割
    const sentences = divider.push(chunk)

    for (const sentence of sentences) {
      yield {
        type: StreamEventType.Sentence,
        data: sentence.text,
        sentenceIndex,
        isFirst: sentenceIndex === 0,
        isThink: false,
        timestamp: Date.now(),
      }
      sentenceIndex++
    }
  }

  // 流结束：刷新剩余内容
  thinkParser.flush()
  const remaining = divider.flush()
  if (remaining) {
    yield {
      type: StreamEventType.Sentence,
      data: remaining.text,
      sentenceIndex,
      isFirst: sentenceIndex === 0,
      isThink: false,
      timestamp: Date.now(),
    }
  }
}

// ============ Layer 2: Action（动作映射）============

/**
 * Layer 2: 将句子映射为显示动作 + TTS 任务
 * 
 * 输入：句子事件
 * 输出：显示事件 + TTS 请求事件
 * 
 * 跳过 Think 内容（不送 TTS）
 * 对正常句子同时产出 Display 和 TTS 事件
 */
async function* actionLayer(
  source: AsyncGenerator<StreamEvent>,
  enableTTS: boolean,
): AsyncGenerator<StreamEvent> {
  for await (const event of source) {
    // Think 内容：仅显示，不送 TTS
    if (event.type === StreamEventType.ThinkContent) {
      yield {
        ...event,
        type: StreamEventType.TextDelta,
      }
      continue
    }

    // 正常句子：同时产出显示事件 + TTS 请求
    if (event.type === StreamEventType.Sentence) {
      // 显示事件
      yield {
        ...event,
        type: StreamEventType.TextDelta,
      }

      // TTS 请求事件（如果启用）
      if (enableTTS && !event.isThink) {
        yield {
          type: StreamEventType.TTSRequest,
          data: event.data,
          sentenceIndex: event.sentenceIndex,
          isThink: false,
          timestamp: Date.now(),
        }
      }
    }
  }
}

// ============ Layer 3: Display（显示层）============

/**
 * Layer 3: 产出显示事件供 UI 渲染
 * 
 * 直接透传 TextDelta 和 ThinkContent 事件
 * UI 层根据事件类型决定渲染方式：
 * - TextDelta: 正常追加到聊天区域
 * - ThinkContent: 半透明/折叠显示
 */
async function* displayLayer(
  source: AsyncGenerator<StreamEvent>,
  onDisplay?: (event: StreamEvent) => void,
): AsyncGenerator<StreamEvent> {
  for await (const event of source) {
    // 显示相关事件
    if (
      event.type === StreamEventType.TextDelta ||
      event.type === StreamEventType.ThinkContent
    ) {
      // 触发显示回调
      onDisplay?.(event)
      yield event
    }
  }
}

// ============ Layer 4: TTS（语音合成层）============

/**
 * Layer 4: 将 TTS 请求发送给 TTS 引擎
 * 
 * 并行发送 TTS 请求，但通过 sentenceIndex 保持顺序
 * TTS 结果通过 TTSAudioReady 事件返回
 * 
 * 注意：此层为可选层，仅在 enableTTS=true 时激活
 */
async function* ttsLayer(
  source: AsyncGenerator<StreamEvent>,
  ttsCallback?: (text: string, sentenceIndex: number) => Promise<ArrayBuffer | null>,
): AsyncGenerator<StreamEvent> {
  // 收集 TTS 请求，并行处理
  const ttsPromises: Promise<void>[] = []
  const audioResults: Map<number, ArrayBuffer> = new Map()
  const ttsYieldQueue: StreamEvent[] = []

  for await (const event of source) {
    // TTS 请求事件：异步合成
    if (event.type === StreamEventType.TTSRequest && ttsCallback) {
      const idx = event.sentenceIndex ?? 0
      const text = event.data

      // 并行发起 TTS 请求
      const ttsPromise = ttsCallback(text, idx)
        .then((audio) => {
          if (audio) {
            audioResults.set(idx, audio)
            ttsYieldQueue.push({
              type: StreamEventType.TTSAudioReady,
              data: '',
              sentenceIndex: idx,
              timestamp: Date.now(),
            })
          }
        })
        .catch(() => {
          // TTS 失败不影响显示
        })

      ttsPromises.push(ttsPromise)
    }

    // 其他事件直接透传
    yield event
  }

  // 等待所有 TTS 请求完成
  await Promise.all(ttsPromises)

  // 按序号排序输出 TTS 结果
  const sortedResults = ttsYieldQueue.sort(
    (a, b) => (a.sentenceIndex ?? 0) - (b.sentenceIndex ?? 0),
  )
  for (const result of sortedResults) {
    yield result
  }
}

// ============ 主管道函数 ============

/**
 * 流式管道主函数
 * 
 * 4 层 async generator 管道：
 * Source → Split → Action → Display → TTS
 * 
 * 使用 async generator 实现背压：
 * - 消费端（UI/TTS）处理慢时，生产端（LLM）自动暂停
 * - 各层独立可配置，支持替换和跳过
 * 
 * @param source LLM 流式输出源（AsyncIterable<string>）
 * @param options 管道配置选项
 * @returns AsyncGenerator<StreamEvent> 管道输出事件流
 * 
 * @example
 * ```ts
 * // 从 LLM 客户端获取流式输出
 * const stream = llmClient.chatStream(messages)
 * 
 * // 通过管道处理
 * for await (const event of streamPipeline(stream, { enableTTS: true })) {
 *   switch (event.type) {
 *     case StreamEventType.TextDelta:
 *       // 更新 UI 显示
 *       appendToChat(event.data)
 *       break
 *     case StreamEventType.ThinkContent:
 *       // 半透明显示 think 内容
 *       appendThinkContent(event.data)
 *       break
 *     case StreamEventType.TTSAudioReady:
 *       // 播放 TTS 音频
 *       playAudio(audioResults.get(event.sentenceIndex!))
 *       break
 *   }
 * }
 * ```
 */
export async function* streamPipeline(
  source: AsyncIterable<string>,
  options: PipelineOptions = {},
): AsyncGenerator<StreamEvent> {
  const {
    sentenceDivider,
    enableTTS = false,
    ttsCallback,
    onDisplay,
  } = options

  // 构建管道：Split → Action → Display → [TTS]
  let pipe = splitLayer(source, sentenceDivider)
  pipe = actionLayer(pipe, enableTTS)
  pipe = displayLayer(pipe, onDisplay)

  if (enableTTS) {
    pipe = ttsLayer(pipe, ttsCallback)
  }

  // 透传管道事件
  let firstSentenceTime: number | null = null

  for await (const event of pipe) {
    if (event.type === StreamEventType.Sentence) {
      if (firstSentenceTime === null) {
        firstSentenceTime = event.timestamp
      }
    }

    yield event
  }

  // 流结束事件
  yield {
    type: StreamEventType.StreamEnd,
    data: '',
    timestamp: Date.now(),
  }
}

// ============ 管道统计收集器 ============

/**
 * 创建带统计收集的管道
 * 
 * 在消费管道事件的同时收集统计信息
 * 
 * @returns 管道消费者和统计查询函数
 */
export function createPipelineWithStats() {
  const stats: PipelineStats = {
    totalChunks: 0,
    totalSentences: 0,
    firstSentenceLatencyMs: null,
    thinkContentLength: 0,
    ttsRequestCount: 0,
    totalDurationMs: null,
  }

  let startTime = 0
  let firstChunkTime = 0

  /** 开始计时 */
  function startTiming(): void {
    startTime = Date.now()
    firstChunkTime = 0
  }

  /** 处理事件，更新统计 */
  function processEvent(event: StreamEvent): void {
    switch (event.type) {
      case StreamEventType.TextDelta:
        stats.totalChunks++
        if (firstChunkTime === 0) {
          firstChunkTime = event.timestamp
        }
        break
      case StreamEventType.Sentence:
        stats.totalSentences++
        if (stats.firstSentenceLatencyMs === null && firstChunkTime > 0) {
          stats.firstSentenceLatencyMs = event.timestamp - firstChunkTime
        }
        break
      case StreamEventType.ThinkContent:
        stats.thinkContentLength += event.data.length
        break
      case StreamEventType.TTSRequest:
        stats.ttsRequestCount++
        break
      case StreamEventType.StreamEnd:
        if (startTime > 0) {
          stats.totalDurationMs = event.timestamp - startTime
        }
        break
    }
  }

  /** 获取当前统计快照 */
  function getStats(): PipelineStats {
    return { ...stats }
  }

  return { startTiming, processEvent, getStats }
}

// ============ 同步包装器 ============

/**
 * 同步消费管道，收集所有事件
 * 
 * 用于不需要实时渲染的场景（如批量处理、测试）
 * 
 * @param source LLM 流式输出源
 * @param options 管道配置选项
 * @returns 所有事件数组 + 统计信息
 */
export async function collectPipelineEvents(
  source: AsyncIterable<string>,
  options: PipelineOptions = {},
): Promise<{ events: StreamEvent[]; stats: PipelineStats }> {
  const collector = createPipelineWithStats()
  const events: StreamEvent[] = []

  collector.startTiming()

  for await (const event of streamPipeline(source, options)) {
    collector.processEvent(event)
    events.push(event)
  }

  return { events, stats: collector.getStats() }
}

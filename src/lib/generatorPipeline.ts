/**
 * LLM 流式输出处理管道模块
 *
 * @fileoverview 实现 4 层异步生成器管道，逐步处理 LLM 流式输出
 *
 * 主要模块：
 * - SplitOutput/ActionOutput/DisplayOutput/TTSOutput: 各层管道输出接口
 * - PipelineConfig/PipelineCallbacks: 管道配置与回调
 * - GeneratorPipeline: 管道主类，封装 4 层处理逻辑
 * - processWithPipeline: 快捷处理函数
 *
 * 依赖关系：
 * - sentenceDivider.ts: SentenceDivider 句子分割器
 * - emotionExtractor.ts: 情绪标签提取
 * - thinkTagParser.ts: Think 标签解析器
 * - animationConfig.ts: AnimationId 动画类型定义
 *
 * 核心接口：
 * - GeneratorPipeline.process(): 处理流式 LLM 输出的主入口
 * - TTSOutput: 管道最终输出，包含显示文本、TTS 文本、动画等
 *
 * 管道架构（参考 Open-LLM-VTuber）：
 * Layer 1: SentenceDivider — 流式文本 → 句子分割 + Think 解析
 * Layer 2: ActionExtractor — 句子 → 情绪/动画标签提取
 * Layer 3: DisplayFormatter — 句子 → UI 显示文本格式化
 * Layer 4: TTSScheduler — 句子 → TTS 任务调度与文本清理
 *
 * 参考仓库：Open-LLM-VTuber（MIT 许可）
 */

import { SentenceDivider, type DividedSentence } from './sentenceDivider'
import { extractEmotion, type EmotionExtraction } from './emotionExtractor'
import { ThinkTagParser, type ThinkParseResult } from './thinkTagParser'
import type { AnimationId } from './animationConfig'

// ============ 管道层级定义 ============

/** Layer 1 输出：句子 + Think 解析 */
export interface SplitOutput {
  /** 分割出的句子 */
  sentence: DividedSentence
  /** Think 标签解析结果 */
  thinkResult: ThinkParseResult
}

/** Layer 2 输出：动作提取结果 */
export interface ActionOutput {
  /** 原始句子（清理后） */
  cleanText: string
  /** 提取到的动画 ID 列表 */
  animations: AnimationId[]
  /** Think 内容 */
  thinkContent: string
  /** 句子序号 */
  index: number
  /** 是否为完整句子 */
  isComplete: boolean
}

/** Layer 3 输出：格式化显示文本 */
export interface DisplayOutput {
  /** 显示文本（已格式化） */
  displayText: string
  /** 动画 ID 列表 */
  animations: AnimationId[]
  /** Think 内容（半透明显示） */
  thinkContent: string
  /** 句子序号 */
  index: number
  /** 是否为完整句子 */
  isComplete: boolean
}

/** Layer 4 输出：TTS 调度结果 */
export interface TTSOutput {
  /** TTS 文本（不含情绪标签、不含 Think 内容） */
  ttsText: string
  /** 显示文本 */
  displayText: string
  /** 动画 ID 列表 */
  animations: AnimationId[]
  /** Think 内容 */
  thinkContent: string
  /** 句子序号 */
  index: number
  /** 是否为完整句子 */
  isComplete: boolean
  /** 是否应该送 TTS（思考内容不送 TTS） */
  shouldTTS: boolean
}

// ============ 管道配置 ============

export interface PipelineConfig {
  /** 是否启用 Think 标签解析（默认 true） */
  enableThinkTag?: boolean
  /** 是否启用情绪标签提取（默认 true） */
  enableEmotionExtraction?: boolean
  /** 是否启用 TTS 调度（默认 true） */
  enableTTS?: boolean
  /** 是否在 TTS 文本中保留省略号（默认 false） */
  keepEllipsisInTTS?: boolean
}

const DEFAULT_CONFIG: Required<PipelineConfig> = {
  enableThinkTag: true,
  enableEmotionExtraction: true,
  enableTTS: true,
  keepEllipsisInTTS: false,
}

// ============ 管道回调 ============

export interface PipelineCallbacks {
  /** 当一个句子经过全管道处理后 */
  onTTSOutput?: (output: TTSOutput) => void
  /** 当检测到动画时 */
  onAnimationDetected?: (animations: AnimationId[]) => void
  /** 当检测到 Think 内容时 */
  onThinkContent?: (thinkContent: string) => void
}

// ============ Layer 1: 句子分割 + Think 解析 ============

/**
 * Layer 1: 将流式 chunk 分割为句子，同时解析 Think 标签
 *
 * @param chunks 流式文本异步迭代器
 * @param config 管道配置
 */
async function* layer1Split(
  chunks: AsyncIterable<string>,
  config: Required<PipelineConfig>,
): AsyncGenerator<SplitOutput> {
  const divider = new SentenceDivider()
  const thinkParser = config.enableThinkTag ? new ThinkTagParser() : null

  for await (const chunk of chunks) {
    // Think 标签解析
    let thinkResult: ThinkParseResult | null = null
    if (thinkParser) {
      thinkResult = thinkParser.push(chunk)
    }

    // 句子分割
    const sentences = divider.push(chunk)
    for (const sentence of sentences) {
      yield {
        sentence,
        thinkResult: thinkResult ?? {
          thinkContent: '',
          replyContent: '',
          state: 0 as never, // Outside
        },
      }
    }
  }

  // flush 剩余
  const lastSentence = divider.flush()
  const lastThink = thinkParser?.flush()

  if (lastSentence) {
    yield {
      sentence: lastSentence,
      thinkResult: lastThink ?? {
        thinkContent: '',
        replyContent: '',
        state: 0 as never,
      },
    }
  }
}

// ============ Layer 2: 动作提取 ============

/**
 * Layer 2: 从句子中提取动作标签（情绪/动画）
 *
 * @param splitStream Layer 1 的输出流
 * @param config 管道配置
 */
async function* layer2ExtractAction(
  splitStream: AsyncIterable<SplitOutput>,
  config: Required<PipelineConfig>,
): AsyncGenerator<ActionOutput> {
  for await (const { sentence, thinkResult } of splitStream) {
    let cleanText = sentence.text
    let animations: AnimationId[] = []

    // 提取情绪标签
    if (config.enableEmotionExtraction) {
      const extraction: EmotionExtraction = extractEmotion(cleanText)
      animations = extraction.animations
      cleanText = extraction.cleanText
    }

    yield {
      cleanText,
      animations,
      thinkContent: thinkResult.thinkContent,
      index: sentence.index,
      isComplete: sentence.isComplete,
    }
  }
}

// ============ Layer 3: 显示格式化 ============

/**
 * Layer 3: 格式化文本用于 UI 显示
 * - 清理多余空格
 * - 移除残留的情绪标签
 * - 保留 Think 内容用于半透明显示
 *
 * @param actionStream Layer 2 的输出流
 */
async function* layer3FormatDisplay(
  actionStream: AsyncIterable<ActionOutput>,
): AsyncGenerator<DisplayOutput> {
  for await (const { cleanText, animations, thinkContent, index, isComplete } of actionStream) {
    // 格式化显示文本
    const displayText = cleanText
      // 移除残留情绪标签
      .replace(/\[(?:emotion:|motion:)?[\w]+\]/gi, '')
      // 压缩连续空白
      .replace(/\s+/g, ' ')
      .trim()

    yield {
      displayText,
      animations,
      thinkContent,
      index,
      isComplete,
    }
  }
}

// ============ Layer 4: TTS 调度 ============

/**
 * Layer 4: 调度 TTS 任务
 * - Think 内容不送 TTS
 * - 空白句子不送 TTS
 * - 清理不适合语音朗读的字符
 *
 * @param displayStream Layer 3 的输出流
 * @param config 管道配置
 */
async function* layer4ScheduleTTS(
  displayStream: AsyncIterable<DisplayOutput>,
  config: Required<PipelineConfig>,
): AsyncGenerator<TTSOutput> {
  for await (const { displayText, animations, thinkContent, index, isComplete } of displayStream) {
    // TTS 文本处理
    let ttsText = displayText
    if (!config.keepEllipsisInTTS) {
      ttsText = ttsText.replace(/…+|\.{3,}/g, '')
    }
    ttsText = ttsText.trim()

    // 判断是否应该送 TTS
    const shouldTTS = config.enableTTS
      && ttsText.length > 0
      && !thinkContent // Think 内容不送 TTS（这里简化判断：如果当前是纯 think 块则不送）

    yield {
      ttsText,
      displayText,
      animations,
      thinkContent,
      index,
      isComplete,
      shouldTTS,
    }
  }
}

// ============ 管道主类 ============

/**
 * LLM 流式输出处理管道
 * 4 层 async generator pipeline: split → action → display → TTS
 *
 * 使用方式：
 * ```ts
 * const pipeline = new GeneratorPipeline(callbacks, config)
 * for await (const output of pipeline.process(chunkStream)) {
 *   // 处理每个句子的 TTS 输出
 * }
 * ```
 */
export class GeneratorPipeline {
  private config: Required<PipelineConfig>
  private callbacks: PipelineCallbacks

  constructor(callbacks: PipelineCallbacks = {}, config: PipelineConfig = {}) {
    this.callbacks = callbacks
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 处理流式 LLM 输出
   * 依次通过 4 层管道处理
   *
   * @param chunks 流式文本异步迭代器
   * @returns TTS 输出的异步迭代器
   */
  async *process(chunks: AsyncIterable<string>): AsyncGenerator<TTSOutput> {
    // 构建管道：Layer1 → Layer2 → Layer3 → Layer4
    const layer1 = layer1Split(chunks, this.config)
    const layer2 = layer2ExtractAction(layer1, this.config)
    const layer3 = layer3FormatDisplay(layer2)
    const layer4 = layer4ScheduleTTS(layer3, this.config)

    for await (const output of layer4) {
      // 触发回调
      if (output.animations.length > 0) {
        this.callbacks.onAnimationDetected?.(output.animations)
      }
      if (output.thinkContent) {
        this.callbacks.onThinkContent?.(output.thinkContent)
      }
      this.callbacks.onTTSOutput?.(output)

      yield output
    }
  }

  /**
   * 处理单次流式响应（便捷方法）
   * 将 ReadableStream 转换为管道输入
   *
   * @param stream ReadableStream<string>
   * @returns 所有 TTS 输出的数组
   */
  async processStream(stream: ReadableStream<string>): Promise<TTSOutput[]> {
    const results: TTSOutput[] = []

    // 将 ReadableStream 转换为 AsyncIterable
    const asyncIterable = this.streamToAsyncIterable(stream)

    for await (const output of this.process(asyncIterable)) {
      results.push(output)
    }

    return results
  }

  /** 将 ReadableStream 转换为 AsyncIterable */
  private async *streamToAsyncIterable(stream: ReadableStream<string>): AsyncIterable<string> {
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        yield value
      }
    } finally {
      reader.releaseLock()
    }
  }

  /** 更新配置 */
  updateConfig(config: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /** 获取当前配置 */
  getConfig(): Readonly<Required<PipelineConfig>> {
    return this.config
  }
}

// ============ 独立管道函数 ============

/**
 * 快捷管道处理函数
 * 直接处理流式 chunk 迭代器，无需创建 GeneratorPipeline 实例
 *
 * @param chunks 流式文本异步迭代器
 * @param callbacks 管道回调
 * @param config 管道配置
 */
export async function* processWithPipeline(
  chunks: AsyncIterable<string>,
  callbacks: PipelineCallbacks = {},
  config: PipelineConfig = {},
): AsyncGenerator<TTSOutput> {
  const pipeline = new GeneratorPipeline(callbacks, config)
  yield* pipeline.process(chunks)
}

// ============ 单例 ============

let pipelineInstance: GeneratorPipeline | null = null

/**
 * 获取 GeneratorPipeline 单例
 * @param callbacks 管道回调（仅首次创建时生效）
 * @param config 管道配置（仅首次创建时生效）
 * @returns GeneratorPipeline 实例
 */
export function getGeneratorPipeline(
  callbacks?: PipelineCallbacks,
  config?: PipelineConfig,
): GeneratorPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new GeneratorPipeline(callbacks, config)
  }
  return pipelineInstance
}

/**
 * 重置 GeneratorPipeline 单例（测试用）
 */
export function resetGeneratorPipeline(): void {
  pipelineInstance = null
}

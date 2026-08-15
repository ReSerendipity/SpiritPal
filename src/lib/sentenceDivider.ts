/**
 * @file sentenceDivider.ts
 * @description 流式句子分割模块 — 从 LLM 流式输出中实时检测句子边界
 *
 * 核心机制：
 * 1. 从 LLM 流式输出中实时检测句子边界
 * 2. 首句逗号分割：第一个逗号处即拆分，降低首句延迟
 * 3. 缓冲不完整句子直到遇到边界标点
 * 4. 同时支持中文和英文标点
 *
 * 主要模块：
 * - DividedSentence: 分割出的句子接口
 * - SentenceDividerCallbacks: 分割器回调接口
 * - SentenceDivider: 流式句子分割器类
 * - divideSentences(): Async Generator 辅助函数
 *
 * 依赖关系：无外部依赖
 *
 * 核心接口：
 * - SentenceDivider.push(): 处理流式 chunk
 * - SentenceDivider.flush(): 刷新剩余缓冲区
 * - divideSentences(): 将 chunk 迭代器转换为句子迭代器
 * - getSentenceDivider(): 获取单例实例
 *
 * 分割优先级：
 * 1. 完整句子边界（句号/问号/感叹号）
 * 2. 首句逗号分割（降低首句延迟）
 * 3. 超长缓冲强制分割（200字符）
 *
 * 参考仓库：Open-LLM-VTuber（MIT 许可）
 * - sentence_divider.py:318,342-403 — 流式句子分割与边界检测
 * - sentence_divider.py:AccumulatingSentenceDivider — 累积式分割器
 */

// ============ 配置常量 ============

/** 句子结束标点（中英文） */
const SENTENCE_END_PUNCTUATION = new Set([
  '。', '！', '？', '.', '!', '?',
  '…', '……',
])

/** 句子内部逗号（用于首句提前分割） */
const COMMA_PUNCTUATION = new Set([
  '，', ',', '、', '；', ';',
])

/** 最大缓冲长度 — 超过此长度强制分割 */
const MAX_BUFFER_LENGTH = 200

/** 首句逗号分割阈值 — 仅在首句且缓冲长度 >= 此值时在逗号处分割 */
const FIRST_SENTENCE_COMMA_MIN_LENGTH = 6

// ============ 类型定义 ============

/** 分割出的句子 */
export interface DividedSentence {
  /** 句子文本 */
  text: string
  /** 是否为完整句子（以结束标点结尾） */
  isComplete: boolean
  /** 是否为首句逗号分割 */
  isFirstSentenceComma: boolean
  /** 句子序号（从 0 开始） */
  index: number
}

/** 句子分割器回调 */
export interface SentenceDividerCallbacks {
  /** 当一个句子就绪时触发 */
  onSentenceReady?: (sentence: DividedSentence) => void
}

// ============ 句子分割器 ============

/**
 * 流式句子分割器
 * 参考开源项目 Open-LLM-VTuber SentenceDivider
 *
 * 逐 chunk 累积文本，在句子边界处拆分输出：
 * - 句号/问号/感叹号 → 完整句子边界
 * - 首句逗号 → 提前分割，降低首句延迟
 * - 超长缓冲 → 强制分割
 */
export class SentenceDivider {
  private buffer = ''
  private sentenceIndex = 0
  private isFirstSentence = true
  private callbacks: SentenceDividerCallbacks

  constructor(callbacks: SentenceDividerCallbacks = {}) {
    this.callbacks = callbacks
  }

  /**
   * 处理一个流式 chunk
   * 累积到 buffer 中，检测句子边界并输出就绪的句子
   *
   * @param chunk 流式文本片段
   * @returns 本次分割出的句子列表（可能为空）
   */
  push(chunk: string): DividedSentence[] {
    this.buffer += chunk
    const sentences: DividedSentence[] = []

    while (this.buffer.length > 0) {
      const result = this.trySplit()
      if (!result) break
      sentences.push(result)
      this.callbacks.onSentenceReady?.(result)
    }

    return sentences
  }

  /**
   * 尝试从 buffer 中分割出一个句子
   * 优先级：完整句子边界 > 首句逗号 > 超长强制分割
   */
  private trySplit(): DividedSentence | null {
    // 1. 查找完整句子边界（句号/问号/感叹号）
    const endIdx = this.findSentenceEnd()
    if (endIdx !== -1) {
      return this.splitAt(endIdx + 1, true, false)
    }

    // 2. 首句逗号分割（降低延迟）
    if (this.isFirstSentence && this.buffer.length >= FIRST_SENTENCE_COMMA_MIN_LENGTH) {
      const commaIdx = this.findComma()
      if (commaIdx !== -1) {
        return this.splitAt(commaIdx + 1, false, true)
      }
    }

    // 3. 超长缓冲强制分割
    if (this.buffer.length >= MAX_BUFFER_LENGTH) {
      // 在最近的逗号或空格处分割
      const splitIdx = this.findBestSplitPoint()
      return this.splitAt(splitIdx, false, false)
    }

    return null
  }

  /** 查找句子结束标点位置 */
  private findSentenceEnd(): number {
    for (let i = 0; i < this.buffer.length; i++) {
      if (SENTENCE_END_PUNCTUATION.has(this.buffer[i]!)) {
        // 省略号特殊处理：…… 或 ... 作为一个整体
        if (this.buffer[i] === '…' && i + 1 < this.buffer.length && this.buffer[i + 1] === '…') {
          return i + 1
        }
        if (this.buffer[i] === '.' && i + 2 < this.buffer.length
          && this.buffer[i + 1] === '.' && this.buffer[i + 2] === '.') {
          return i + 2
        }
        return i
      }
    }
    return -1
  }

  /** 查找逗号位置 */
  private findComma(): number {
    for (let i = 0; i < this.buffer.length; i++) {
      if (COMMA_PUNCTUATION.has(this.buffer[i]!)) {
        return i
      }
    }
    return -1
  }

  /** 查找最佳强制分割点（最近的逗号或空格） */
  private findBestSplitPoint(): number {
    // 从 MAX_BUFFER_LENGTH 位置向前搜索
    const searchStart = Math.min(this.buffer.length, MAX_BUFFER_LENGTH)

    for (let i = searchStart - 1; i >= Math.max(0, searchStart - 50); i--) {
      const ch = this.buffer[i]!
      if (COMMA_PUNCTUATION.has(ch) || ch === ' ' || ch === '\t') {
        return i
      }
    }

    // 找不到合适的分割点，直接在 MAX_BUFFER_LENGTH 处分割
    return searchStart
  }

  /** 在指定位置分割 buffer */
  private splitAt(endIdx: number, isComplete: boolean, isFirstSentenceComma: boolean): DividedSentence {
    const text = this.buffer.substring(0, endIdx).trim()
    this.buffer = this.buffer.substring(endIdx)

    const sentence: DividedSentence = {
      text,
      isComplete,
      isFirstSentenceComma,
      index: this.sentenceIndex,
    }

    this.sentenceIndex++
    this.isFirstSentence = false

    return sentence
  }

  /**
   * 刷新剩余 buffer（流结束时调用）
   * 将 buffer 中的剩余文本作为最后一个句子输出
   */
  flush(): DividedSentence | null {
    const remaining = this.buffer.trim()
    this.buffer = ''

    if (!remaining) return null

    const sentence: DividedSentence = {
      text: remaining,
      isComplete: false,
      isFirstSentenceComma: false,
      index: this.sentenceIndex,
    }

    this.sentenceIndex++
    this.callbacks.onSentenceReady?.(sentence)
    return sentence
  }

  /** 重置分割器 */
  reset(): void {
    this.buffer = ''
    this.sentenceIndex = 0
    this.isFirstSentence = true
  }

  /** 获取当前缓冲区内容（只读） */
  getBuffer(): string {
    return this.buffer
  }

  /** 获取已分割的句子数 */
  getSentenceCount(): number {
    return this.sentenceIndex
  }
}

// ============ Async Generator 辅助 ============

/**
 * 将流式 chunk 迭代器转换为句子迭代器
 * 用于 async generator pipeline
 *
 * @param chunks 流式文本片段的异步迭代器
 * @returns 句子的异步迭代器
 */
export async function* divideSentences(
  chunks: AsyncIterable<string>,
): AsyncGenerator<DividedSentence> {
  const divider = new SentenceDivider()

  for await (const chunk of chunks) {
    const sentences = divider.push(chunk)
    for (const sentence of sentences) {
      yield sentence
    }
  }

  // 流结束时 flush 剩余内容
  const last = divider.flush()
  if (last) {
    yield last
  }
}

// ============ 单例 ============

let instance: SentenceDivider | null = null

export function getSentenceDivider(callbacks?: SentenceDividerCallbacks): SentenceDivider {
  if (!instance) {
    instance = new SentenceDivider(callbacks)
  }
  return instance
}

export function resetSentenceDivider(): void {
  if (instance) {
    instance.reset()
    instance = null
  }
}

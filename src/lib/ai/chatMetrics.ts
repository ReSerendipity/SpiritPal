import type { MessageMetrics } from '@/lib/data/types'
import { ThinkTagParser } from '@/lib/render/thinkTagParser'

export interface CallUsage {
  input?: number
  output?: number
  cachedInput?: number
  reasoning?: number
  inputTokensPerSec?: number
  outputTokensPerSec?: number
}

export class ChatMetricsRecorder {
  private readonly wallStart = Date.now()
  private readonly start = performance.now()
  private readonly parser = new ThinkTagParser()
  private firstOutput?: number
  private firstText?: number
  private lastOutput?: number
  private previousReply = ''
  private previousThink = ''

  constructor(private readonly config: { model: string; provider: string }) {}

  observe(chunk: string): void {
    const parsed = this.parser.push(chunk)
    const time = performance.now() - this.start
    if (this.previousReply && !this.previousThink && parsed.thinkContent.startsWith(this.previousReply)) {
      this.firstText = undefined
    }
    if (parsed.replyContent !== this.previousReply || parsed.thinkContent !== this.previousThink) {
      this.firstOutput ??= time
      this.lastOutput = time
    }
    if (parsed.replyContent.trim()) this.firstText ??= time
    this.previousReply = parsed.replyContent
    this.previousThink = parsed.thinkContent
  }

  snapshot(usage: CallUsage | null, status: MessageMetrics['status']): MessageMetrics {
    // 中断/失败时服务商有时回 0/0 占位；这不是可核对的真实用量，按未提供处理。
    const reported =
      usage && (status === 'completed' || (usage.input ?? 0) > 0 || (usage.output ?? 0) > 0) ? usage : null
    const durationMs = Math.max(0, performance.now() - this.start)
    const generationMs =
      this.lastOutput !== undefined && this.firstOutput !== undefined
        ? Math.max(0, this.lastOutput - this.firstOutput)
        : undefined
    return {
      requestStartTs: this.wallStart,
      responseEndTs: this.wallStart + durationMs,
      durationMs,
      firstTokenTs: this.firstOutput === undefined ? undefined : this.wallStart + this.firstOutput,
      ttftMs: this.firstOutput,
      firstTextTs: this.firstText === undefined ? undefined : this.wallStart + this.firstText,
      firstTextMs: this.firstText,
      generationMs,
      promptTokens: reported?.input,
      completionTokens: reported?.output,
      cachedInputTokens: reported?.cachedInput,
      reasoningTokens: reported?.reasoning,
      tokensPerSec:
        generationMs && reported?.output !== undefined ? reported.output / (generationMs / 1000) : undefined,
      inputTokensPerSec: reported?.inputTokensPerSec,
      serverOutputTokensPerSec: reported?.outputTokensPerSec,
      usageSource: reported?.input !== undefined || reported?.output !== undefined ? 'reported' : 'unavailable',
      model: this.config.model,
      provider: this.config.provider,
      status,
    }
  }
}

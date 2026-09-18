/**
 * 消息底部技术指标条
 *
 * 每条助手消息完成后显示一行简要数据（tokens / 耗时 / 速率），
 * 点击可展开详细指标（prompt tokens、completion tokens、TTFT、模型名等）。
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { MessageMetrics } from '@/lib/data/types'

interface MessageMetricsBarProps {
  metrics: MessageMetrics
}

/** 格式化数字：大于 1000 显示为 k */
function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** 格式化耗时：<1s 显示 ms，否则显示 s */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function MessageMetricsBar({ metrics }: MessageMetricsBarProps) {
  const [expanded, setExpanded] = useState(false)

  const totalTokens = metrics.promptTokens + metrics.completionTokens
  const speed = metrics.tokensPerSec ?? (
    metrics.durationMs > 0
      ? Math.round(metrics.completionTokens / (metrics.durationMs / 1000))
      : 0
  )

  return (
    <div className="mt-1 select-none">
      {/* 简要行 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[10px] text-ink-faint/70 hover:bg-ink/4 hover:text-ink-faint transition-colors"
        title={expanded ? '收起详情' : '展开详情'}
      >
        <span>{fmtNum(totalTokens)} tok</span>
        <span className="opacity-40">·</span>
        <span>{fmtDuration(metrics.durationMs)}</span>
        {speed > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span>{speed} tok/s</span>
          </>
        )}
        {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="mt-1 rounded-lg border border-ink/8 bg-cream-deep/50 px-2.5 py-2 text-[10px] leading-relaxed">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <DetailRow label="输入 tokens" value={fmtNum(metrics.promptTokens)} />
            <DetailRow label="输出 tokens" value={fmtNum(metrics.completionTokens)} />
            <DetailRow label="总耗时" value={fmtDuration(metrics.durationMs)} />
            <DetailRow
              label="首 token 延迟"
              value={metrics.ttftMs != null ? fmtDuration(metrics.ttftMs) : '—'}
            />
            <DetailRow
              label="输出速率"
              value={speed > 0 ? `${speed} tok/s` : '—'}
            />
            <DetailRow
              label="模型"
              value={metrics.model ?? '—'}
            />
            {metrics.provider && (
              <DetailRow label="Provider" value={metrics.provider} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-ink-faint/60">{label}</span>
      <span className="font-medium text-ink-muted">{value}</span>
    </div>
  )
}

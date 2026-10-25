import { useId, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MessageMetrics } from '@/lib/data/types'

function provided(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function MessageMetricsBar({ metrics }: { metrics: MessageMetrics }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const unknown = t('chatUi.context.notProvided')
  const number = (value: number | undefined): string => (provided(value) ? String(Math.round(value)) : unknown)
  const duration = (value: number | undefined): string => {
    if (!provided(value)) return unknown
    return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`
  }
  const speed = (value: number | undefined): string => (provided(value) ? `${Number(value.toFixed(1))} tok/s` : unknown)
  const time = (value: number | undefined): string => {
    if (!provided(value) || !Number.isFinite(new Date(value).getTime())) return unknown
    return new Date(value).toLocaleString(undefined, { hour12: false })
  }
  const statusKeys = {
    streaming: 'chatUi.metrics.statusStreaming',
    completed: 'chatUi.metrics.statusCompleted',
    aborted: 'chatUi.metrics.statusAborted',
    failed: 'chatUi.metrics.statusFailed',
  } as const
  const total =
    provided(metrics.promptTokens) && provided(metrics.completionTokens)
      ? metrics.promptTokens + metrics.completionTokens
      : undefined
  const source =
    metrics.usageSource === 'reported'
      ? t('chatUi.metrics.reported')
      : metrics.usageSource === 'unavailable'
        ? t('chatUi.metrics.unknownUsage')
        : t('chatUi.metrics.historic')

  return (
    <div className="chat-metrics">
      <button
        type="button"
        className="chat-metrics-summary"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          {t('chatUi.metrics.input')} {number(metrics.promptTokens)}
        </span>
        <span>
          {t('chatUi.metrics.output')} {number(metrics.completionTokens)}
        </span>
        <span>
          {t('chatUi.metrics.firstOutput')} {duration(metrics.ttftMs)}
        </span>
        <span>
          {t('chatUi.metrics.duration')} {duration(metrics.durationMs)}
        </span>
        {provided(total) && <span className="chat-metrics-total">{number(total)} tok</span>}
        <span className="chat-metrics-source">{source}</span>
        <span className="chat-sr-only">{expanded ? t('chatUi.metrics.collapse') : t('chatUi.metrics.expand')}</span>
        {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {expanded && (
        <div id={id} className="chat-metrics-details">
          <dl className="chat-metrics-grid">
            <DetailRow label={t('chatUi.metrics.inTokens')} value={number(metrics.promptTokens)} />
            <DetailRow label={t('chatUi.metrics.outTokens')} value={number(metrics.completionTokens)} />
            <DetailRow label={t('chatUi.metrics.totalTokens')} value={number(total)} />
            <DetailRow label={t('chatUi.metrics.source')} value={source} />
            <DetailRow label={t('chatUi.metrics.firstOutputLatency')} value={duration(metrics.ttftMs)} />
            <DetailRow label={t('chatUi.metrics.firstTextLatency')} value={duration(metrics.firstTextMs)} />
            <DetailRow label={t('chatUi.metrics.generationTime')} value={duration(metrics.generationMs)} />
            <DetailRow label={t('chatUi.metrics.totalTime')} value={duration(metrics.durationMs)} />
            <DetailRow label={t('chatUi.metrics.outputRate')} value={speed(metrics.tokensPerSec)} />
            <DetailRow label={t('chatUi.metrics.serverOutputRate')} value={speed(metrics.serverOutputTokensPerSec)} />
            {/* This value is only supplied with server input timing; never infer it from total duration. */}
            {provided(metrics.inputTokensPerSec) && (
              <DetailRow label={t('chatUi.metrics.inputRate')} value={speed(metrics.inputTokensPerSec)} />
            )}
            <DetailRow label={t('chatUi.metrics.cachedInput')} value={number(metrics.cachedInputTokens)} />
            <DetailRow label={t('chatUi.metrics.reasoning')} value={number(metrics.reasoningTokens)} />
            <DetailRow
              label={t('chatUi.metrics.status')}
              value={metrics.status ? t(statusKeys[metrics.status] ?? 'chatUi.context.notProvided') : unknown}
            />
            <DetailRow label={t('chatUi.metrics.model')} value={metrics.model || unknown} />
            <DetailRow label={t('chatUi.metrics.provider')} value={metrics.provider || unknown} />
            <DetailRow label={t('chatUi.metrics.requestStart')} value={time(metrics.requestStartTs)} />
            <DetailRow label={t('chatUi.metrics.firstOutputAt')} value={time(metrics.firstTokenTs)} />
            <DetailRow label={t('chatUi.metrics.firstTextAt')} value={time(metrics.firstTextTs)} />
            <DetailRow label={t('chatUi.metrics.responseEnd')} value={time(metrics.responseEndTs)} />
          </dl>
          <p className="chat-note">{t('chatUi.metrics.note')}</p>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="chat-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '@/lib/data/types'
import { useChatViewStore } from '@/stores/chatViewStore'
import { MessageMetricsBar } from './MessageMetricsBar'

// Structural compatibility while the shared ChatMessage memoryTrace field lands.
// No extra memory lookup or model call: display the captured request snapshot only.
type MessageWithTrace = ChatMessage & {
  memoryTrace?: {
    mode: 'enabled' | 'disabled' | 'temporary'
    sections: { id: string; label: string; content: string; estimatedTokens: number }[]
    capturedAt: number
    error?: string
  }
}

export function MessageMemoryTrace({ message }: { message?: ChatMessage }) {
  const { t } = useTranslation()
  const trace = (message as MessageWithTrace | undefined)?.memoryTrace
  const showTimestamps = useChatViewStore((state) => state.showTimestamps)
  if (!trace) return <p className="chat-note">{t('chatUi.context.noTrace')}</p>
  const captured = new Date(trace.capturedAt)
  const validDate = Number.isFinite(captured.getTime())

  return (
    <div className="chat-memory-trace">
      <div className="chat-memory-meta">
        <span className="chat-badge">
          {trace.mode === 'disabled'
            ? t('chatUi.context.disabled')
            : trace.mode === 'temporary'
              ? t('chatUi.context.temporary')
              : t('chatUi.context.auto')}
        </span>
        {showTimestamps && validDate && (
          <time dateTime={captured.toISOString()} title={t('chatUi.context.capturedAt')}>
            {captured.toLocaleString(undefined, { hour12: false })}
          </time>
        )}
      </div>
      {trace.error && (
        <p role="alert" className="chat-error">
          {trace.error}
        </p>
      )}
      {trace.sections.length > 0 ? (
        <>
          <p className="chat-note">{t('chatUi.context.sentInfo')}</p>
          {trace.sections.map((section) => (
            <details className="chat-memory-section" key={section.id}>
              <summary>
                <span>{section.label}</span>
                <span className="chat-note">
                  {Number.isFinite(section.estimatedTokens) && section.estimatedTokens >= 0
                    ? t('chatUi.context.tokensApprox', { count: Math.round(section.estimatedTokens) })
                    : t('chatUi.context.tokensMissing')}
                </span>
              </summary>
              <div className="chat-memory-content">{section.content}</div>
            </details>
          ))}
        </>
      ) : (
        <p className="chat-note">{t('chatUi.context.noMemory')}</p>
      )}
    </div>
  )
}

export function ChatContextPanel({ message, onManage }: { message?: ChatMessage; onManage?: () => void }) {
  const { t } = useTranslation()
  const showMemory = useChatViewStore((state) => state.showMemory)
  const showMetrics = useChatViewStore((state) => state.showMetrics)
  const id = useId()

  return (
    <section className="chat-context-panel" aria-labelledby={id}>
      <header className="chat-context-heading">
        <h2 id={id}>{t('chatUi.context.title')}</h2>
      </header>
      <section className="chat-context-section" aria-label={t('chatUi.context.model')}>
        <h3>{t('chatUi.context.model')}</h3>
        <p className="chat-context-model">{message?.metrics?.model || t('chatUi.context.notProvided')}</p>
        {showMetrics &&
          (message?.metrics ? (
            <MessageMetricsBar key={message.id} metrics={message.metrics} />
          ) : (
            <p className="chat-note">{t('chatUi.context.noMetrics')}</p>
          ))}
      </section>
      <section className="chat-context-section" aria-label={t('chatUi.context.memory')}>
        <div className="chat-context-heading">
          <h3>{t('chatUi.context.memory')}</h3>
          {onManage && (
            <button type="button" className="chat-button" onClick={onManage}>
              {t('chatUi.context.manage')}
            </button>
          )}
        </div>
        {showMemory ? (
          <MessageMemoryTrace key={message?.id} message={message} />
        ) : (
          <p className="chat-note">{t('chatUi.context.hidden')}</p>
        )}
      </section>
    </section>
  )
}

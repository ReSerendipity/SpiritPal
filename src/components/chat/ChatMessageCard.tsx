import { useMemo, useState, type ReactNode } from 'react'
import { Copy, Pencil, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Markdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { filterLLMOutput } from '@/lib/ai/toxicityFilter'
import type { ChatMessage } from '@/lib/data/types'
import { useChatViewStore } from '@/stores/chatViewStore'
import { MessageMemoryTrace } from './ChatContextPanel'
import { MessageMetricsBar } from './MessageMetricsBar'

interface ChatMessageCardProps {
  message: ChatMessage
  onEdit?: (message: ChatMessage) => void
  onRegenerate?: (message: ChatMessage) => void
  actions?: ReactNode
}

const sendStatusKeys = {
  pending: 'chatUi.status.pending',
  aborted: 'chatUi.status.aborted',
  failed: 'chatUi.status.failed',
  timeout: 'chatUi.status.timeout',
} as const

export function ChatMessageCard({ message, onEdit, onRegenerate, actions }: ChatMessageCardProps) {
  const { t } = useTranslation()
  const { showMetrics, showThinking, showMemory, showTimestamps, compact } = useChatViewStore()
  const [copyResult, setCopyResult] = useState<{
    id: string
    content: string
    status: 'copying' | 'success' | 'error'
  } | null>(null)
  const assistant = message.role === 'assistant'
  const content = useMemo(
    () => (assistant ? filterLLMOutput(message.content).filteredText : message.content),
    [assistant, message.content],
  )
  const thinking = useMemo(
    () => (message.thinkContent?.trim() ? filterLLMOutput(message.thinkContent).filteredText : ''),
    [message.thinkContent],
  )
  const markdownComponents = useMemo<Components>(
    () => ({
      pre: ({ children }) => (
        <pre className="chat-code-scroll" tabIndex={0} aria-label={t('chatUi.message.code')}>
          {children}
        </pre>
      ),
      table: ({ children }) => (
        <div className="chat-table-scroll" tabIndex={0} role="region" aria-label={t('chatUi.message.table')}>
          <table>{children}</table>
        </div>
      ),
    }),
    [t],
  )
  const copyStatus = copyResult?.id === message.id && copyResult.content === content ? copyResult.status : null
  const generating = Boolean(message.isStreaming || message.sendStatus === 'pending')
  const status =
    message.sendStatus && message.sendStatus !== 'pending'
      ? t(sendStatusKeys[message.sendStatus])
      : message.isStreaming
        ? t('chatUi.status.generating')
        : message.sendStatus === 'pending'
          ? message.role === 'user'
            ? t('chatUi.status.sending')
            : t('chatUi.status.pending')
          : undefined
  const timestamp = new Date(message.timestamp)
  const validTimestamp = Number.isFinite(timestamp.getTime())

  async function copyMessage() {
    const result = { id: message.id, content }
    setCopyResult({ ...result, status: 'copying' })
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(content)
      setCopyResult({ ...result, status: 'success' })
    } catch {
      setCopyResult({ ...result, status: 'error' })
    }
  }

  return (
    <article
      className={`chat-message chat-message--${message.role}${compact ? ' chat-message--compact' : ''}`}
      aria-label={
        assistant
          ? t('chatUi.aria.assistant')
          : message.role === 'user'
            ? t('chatUi.aria.user')
            : t('chatUi.aria.system')
      }
    >
      <div className="chat-message-card">
        <header className="chat-message-header">
          <span className="chat-message-author">
            {assistant
              ? t('chatUi.role.assistant')
              : message.role === 'user'
                ? t('chatUi.role.user')
                : t('chatUi.role.system')}
          </span>
          {showTimestamps && validTimestamp && (
            <time dateTime={timestamp.toISOString()} title={timestamp.toLocaleString()}>
              {timestamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}
            </time>
          )}
          {status && (
            <span
              className={`chat-message-status${message.sendStatus === 'failed' || message.sendStatus === 'timeout' ? ' chat-error' : ''}`}
              role="status"
            >
              {status}
            </span>
          )}
        </header>
        {assistant && showThinking && thinking && (
          <details key={`${message.id}-thinking`} className="chat-thinking">
            <summary>{t('chatUi.message.thinking')}</summary>
            <div className="chat-thinking-content">{thinking}</div>
          </details>
        )}
        <div className={`chat-message-content${assistant ? ' chat-markdown' : ' chat-plain-text'}`}>
          {content.trim() ? (
            assistant ? (
              <Markdown rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
                {content}
              </Markdown>
            ) : (
              content
            )
          ) : assistant && !message.isStreaming ? (
            <p className="chat-note">{t('chatUi.message.noReply')}</p>
          ) : null}
        </div>
        {assistant && showMetrics && message.metrics && (
          <MessageMetricsBar key={message.id} metrics={message.metrics} />
        )}
        {assistant && showMemory && (
          <details key={`${message.id}-memory`} className="chat-message-memory">
            <summary>{t('chatUi.message.memory')}</summary>
            <MessageMemoryTrace message={message} />
          </details>
        )}
        <footer className="chat-message-actions">
          <button
            type="button"
            className="chat-button"
            onClick={() => void copyMessage()}
            disabled={copyStatus === 'copying'}
          >
            <Copy size={14} aria-hidden="true" />
            {t('chatUi.message.copy')}
          </button>
          {message.role === 'user' && onEdit && (
            <button type="button" className="chat-button" disabled={generating} onClick={() => onEdit(message)}>
              <Pencil size={14} aria-hidden="true" />
              {t('chatUi.message.edit')}
            </button>
          )}
          {assistant && onRegenerate && (
            <button type="button" className="chat-button" disabled={generating} onClick={() => onRegenerate(message)}>
              <RotateCcw size={14} aria-hidden="true" />
              {t('chatUi.message.regenerate')}
            </button>
          )}
          {actions}
          {copyStatus === 'success' && (
            <span role="status" className="chat-note">
              {t('chatUi.message.copied')}
            </span>
          )}
        </footer>
        {copyStatus === 'error' && (
          <p role="alert" className="chat-error">
            {t('chatUi.message.copyFailed')}
          </p>
        )}
      </div>
    </article>
  )
}

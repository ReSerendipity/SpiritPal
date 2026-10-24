import { useId, useRef, useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatViewStore, type ChatViewOption } from '@/stores/chatViewStore'

const options: { key: ChatViewOption; labelKey: string }[] = [
  { key: 'showMetrics', labelKey: 'chatUi.controls.metrics' },
  { key: 'showThinking', labelKey: 'chatUi.controls.thinking' },
  { key: 'showMemory', labelKey: 'chatUi.controls.memory' },
  { key: 'showTimestamps', labelKey: 'chatUi.controls.timestamps' },
  { key: 'compact', labelKey: 'chatUi.controls.compact' },
]

export function ChatViewControls() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const view = useChatViewStore()
  const full = view.showMetrics && view.showThinking && view.showMemory && view.showTimestamps
  const simple = !view.showMetrics && !view.showThinking && !view.showMemory && !view.showTimestamps

  return (
    <div
      className="chat-view-controls"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
          trigger.current?.focus()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="chat-button"
        aria-label={t('chatUi.controls.label')}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span className="chat-view-trigger-text">{t('chatUi.controls.label')}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <fieldset id={id} className="chat-view-options">
          <legend>{t('chatUi.controls.label')}</legend>
          <div className="chat-view-modes">
            <button type="button" className="chat-button" aria-pressed={full} onClick={() => view.setMode('full')}>
              {t('chatUi.controls.full')}
            </button>
            <button type="button" className="chat-button" aria-pressed={simple} onClick={() => view.setMode('simple')}>
              {t('chatUi.controls.simple')}
            </button>
          </div>
          <div className="chat-view-checkboxes">
            {options.map(({ key, labelKey }) => (
              <label key={key} className="chat-view-option">
                <input
                  type="checkbox"
                  checked={view[key]}
                  onChange={(event) => view.setOption(key, event.target.checked)}
                />
                <span>{t(labelKey)}</span>
              </label>
            ))}
          </div>
          <p className="chat-note">{t('chatUi.controls.note')}</p>
        </fieldset>
      )}
    </div>
  )
}

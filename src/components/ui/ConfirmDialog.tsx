import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { setConfirmHandler, type ConfirmDialogOptions, type ConfirmHandler } from '@/lib/system/confirmDialog'
import { BrandButton } from './BrandButton'

interface ConfirmDialogProps extends ConfirmDialogOptions {
  onConfirm: () => void
  onCancel: () => void
}

/** 应用内确认框（受控展示组件） */
export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel = '确定',
  cancelLabel = '取消',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? descriptionId : undefined}
        className="w-full max-w-sm rounded-2xl border border-ink/10 bg-surface p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className={tone === 'danger' ? 'text-error' : 'text-tangerine'} />
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
        </div>
        {message && (
          <p id={descriptionId} className="mt-2 text-sm leading-5 text-ink-muted">
            {message}
          </p>
        )}
        {detail && (
          <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-ink/5 px-2 py-1.5 text-xs leading-5 text-ink">
            {detail}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <BrandButton variant="ghost" size="sm" onClick={onCancel} autoFocus>
            {cancelLabel}
          </BrandButton>
          <button
            type="button"
            onClick={onConfirm}
            className={`spiritpal-focusable rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50 ${
              tone === 'danger' ? 'bg-error hover:bg-error/90' : 'bg-tangerine hover:bg-tangerine-deep'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

type ConfirmRequest = {
  options: ConfirmDialogOptions
  resolve: (approved: boolean) => void
}

/** 全局确认框宿主：每个窗口根组件挂载一次 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const pendingRef = useRef<ConfirmRequest | null>(null)

  useEffect(() => {
    const handler: ConfirmHandler = (options) =>
      new Promise<boolean>((resolve) => {
        // 同一时刻只展示一个确认框；并发请求直接拒绝，避免误操作
        if (pendingRef.current) {
          resolve(false)
          return
        }
        const next = { options, resolve }
        pendingRef.current = next
        setRequest(next)
      })
    setConfirmHandler(handler)
    return () => {
      setConfirmHandler(null)
      pendingRef.current?.resolve(false)
      pendingRef.current = null
    }
  }, [])

  const finish = useCallback((approved: boolean) => {
    const current = pendingRef.current
    pendingRef.current = null
    setRequest(null)
    current?.resolve(approved)
  }, [])

  return (
    <>
      {children}
      {request && <ConfirmDialog {...request.options} onConfirm={() => finish(true)} onCancel={() => finish(false)} />}
    </>
  )
}

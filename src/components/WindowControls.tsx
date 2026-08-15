/**
 * 无边框窗口控制组件
 *
 * 提供窗口拖拽、最小化、最大化/还原、关闭功能。
 * 适用于所有无边框窗口（pet-window、settings-window、chat-window），
 * 替代系统原生标题栏，保持跨平台一致的视觉风格。
 *
 * 功能：
 * - 标题栏拖拽（data-tauri-drag-region）
 * - 最小化按钮
 * - 最大化/还原切换
 * - 关闭按钮
 * - 可选：显示窗口标题
 */
import { useCallback, useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Square, X, Copy } from 'lucide-react'

interface WindowControlsProps {
  /** 窗口标题文字 */
  title?: string
  /** 标题栏背景色，默认透明 */
  className?: string
  /** 自定义关闭回调（默认隐藏窗口） */
  onClose?: () => void
}

export function WindowControls({ title, className = '', onClose }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    try {
      const win = getCurrentWindow()
      let disposed = false

      win.isMaximized().then((max) => {
        if (!disposed) setIsMaximized(max)
      }).catch(() => {})

      const unlisten = win.onResized(() => {
        if (disposed) return
        win.isMaximized().then((max) => {
          if (!disposed) setIsMaximized(max)
        }).catch(() => {})
      })

      return () => {
        disposed = true
        unlisten.then((fn) => fn()).catch(() => {})
      }
    } catch {
      // 测试环境或非 Tauri 环境下 getCurrentWindow 可能不可用
      return () => {}
    }
  }, [])

  const handleMinimize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    void getCurrentWindow().minimize()
  }, [])

  const handleMaximize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    void getCurrentWindow().toggleMaximize()
  }, [])

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onClose) {
      onClose()
    } else {
      void getCurrentWindow().hide()
    }
  }, [onClose])

  return (
    <div
      className={`flex h-8 shrink-0 select-none items-center ${className}`}
      data-tauri-drag-region
    >
      {/* 标题文字 */}
      {title && (
        <span
          className="ml-3 flex-1 truncate text-xs font-medium text-ink-muted"
          data-tauri-drag-region
        >
          {title}
        </span>
      )}

      {/* 控制按钮 */}
      <div className="flex h-full items-center">
        {/* 最小化 */}
        <button
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-ink-muted transition-colors hover:bg-ink/8 hover:text-ink"
          aria-label="最小化"
        >
          <Minus size={14} />
        </button>

        {/* 最大化/还原 */}
        <button
          onClick={handleMaximize}
          className="flex h-full w-11 items-center justify-center text-ink-muted transition-colors hover:bg-ink/8 hover:text-ink"
          aria-label={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? <Copy size={12} /> : <Square size={12} />}
        </button>

        {/* 关闭 */}
        <button
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-ink-muted transition-colors hover:bg-red-500 hover:text-white"
          aria-label="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

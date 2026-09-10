/**
 * 自动更新通知弹窗组件
 *
 * 功能概述：
 * - 应用启动后自动检查新版本（可配置延迟）
 * - 检测到新版本时弹出 Modal 通知
 * - 显示版本号、更新说明、下载进度
 * - 支持「立即更新」下载并安装、「稍后提醒」关闭
 * - 下载完成后提示重启应用
 *
 * 2026-09-10 加固（任务书 P0-1.5 / P2-2，报告1 §四-7 "更新链路每步可见"）：
 * - 完整状态机：idle → checking → available / up-to-date / error → downloading(进度) → verifying → installing → restarting
 * - 检查失败显示原因（网络 / TLS / 校验失败），不再静默
 * - 手动检查入口：托盘菜单「检查更新」emit Tauri 事件、设置页「检查更新」按钮 dispatch CustomEvent
 *
 * 事件协议：
 * - Tauri 事件 `check-updates-from-tray`：托盘菜单触发（src-tauri/src/setup/mod.rs）
 * - DOM CustomEvent `spiritpal:check-updates`：设置页「检查更新」按钮触发
 */
import { listen } from '@tauri-apps/api/event'
import { useState, useEffect, useCallback, useRef } from 'react'
import { checkForUpdates, downloadAndInstallUpdate, type UpdateInfo, type UpdatePhase } from '@/lib/system/updater'

// ============ Props ============

interface UpdateNotificationProps {
  /** 是否自动检查更新（默认 true） */
  autoCheck?: boolean
  /** 自动检查延迟（毫秒，默认 30 秒） */
  autoCheckDelay?: number
  /** 自定义关闭回调 */
  onClose?: () => void
}

// ============ 状态机 ============

type UpdateViewState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; info: UpdateInfo }
  | { phase: 'downloading'; downloaded: number; total: number }
  | { phase: 'verifying' }
  | { phase: 'installing' }
  | { phase: 'restarting' }
  | { phase: 'up-to-date' }
  | { phase: 'error'; message: string }

// ============ 组件 ============

/**
 * 自动更新通知弹窗
 *
 * 显示新版本信息，提供更新操作：
 * - 立即更新：下载并安装新版本，完成后提示重启
 * - 稍后提醒：关闭弹窗，下次启动再检查
 *
 * @example
 * ```tsx
 * <UpdateNotification autoCheck autoCheckDelay={30000} />
 * ```
 */
export function UpdateNotification({ autoCheck = true, autoCheckDelay = 30000, onClose }: UpdateNotificationProps) {
  const [view, setView] = useState<UpdateViewState>({ phase: 'idle' })
  const [isVisible, setIsVisible] = useState(false)
  // 自动检查静默：无新版本/已是最新时不打扰用户；手动检查必须给出可见结果
  const manualRef = useRef(false)

  const showError = useCallback((message: string) => {
    setView({ phase: 'error', message })
    setIsVisible(true)
  }, [])

  // 执行一次检查（自动/手动共用）
  const runCheck = useCallback(
    async (isManual: boolean) => {
      manualRef.current = isManual
      setView({ phase: 'checking' })
      if (isManual) setIsVisible(true)
      const result = await checkForUpdates()
      if (result.available && result.info) {
        setView({ phase: 'available', info: result.info })
        setIsVisible(true)
      } else if (result.error) {
        showError(`检查更新失败：${result.error}`)
      } else {
        // 无新版本
        if (isManual) {
          setView({ phase: 'up-to-date' })
          setIsVisible(true)
          // 提示 2.5 秒后自动关闭
          setTimeout(() => {
            setIsVisible(false)
            setView({ phase: 'idle' })
          }, 2500)
        } else {
          setView({ phase: 'idle' })
        }
      }
    },
    [showError],
  )

  // 自动检查更新
  useEffect(() => {
    if (!autoCheck) return
    const timer = setTimeout(() => void runCheck(false), autoCheckDelay)
    return () => clearTimeout(timer)
  }, [autoCheck, autoCheckDelay, runCheck])

  // 监听托盘「检查更新」菜单事件（Tauri 环境）
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    void (async () => {
      try {
        const fn = await listen('check-updates-from-tray', () => {
          if (!cancelled) void runCheck(true)
        })
        if (cancelled) fn()
        else unlisten = fn
      } catch {
        // 非 Tauri 环境（纯浏览器 / vitest）：无托盘事件，静默跳过
      }
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [runCheck])

  // 监听设置页「检查更新」按钮事件（DOM CustomEvent，跨组件解耦）
  useEffect(() => {
    const handler = () => void runCheck(true)
    window.addEventListener('spiritpal:check-updates', handler)
    return () => window.removeEventListener('spiritpal:check-updates', handler)
  }, [runCheck])

  // 立即更新
  const handleUpdateNow = useCallback(async () => {
    if (view.phase !== 'available') return

    setView({ phase: 'downloading', downloaded: 0, total: 0 })

    const onPhase = (phase: UpdatePhase) => {
      if (phase === 'downloading') {
        setView((v) => (v.phase === 'downloading' ? v : { phase: 'downloading', downloaded: 0, total: 0 }))
      } else if (phase === 'verifying') setView({ phase: 'verifying' })
      else if (phase === 'installing') setView({ phase: 'installing' })
      else if (phase === 'restarting') setView({ phase: 'restarting' })
    }

    const result = await downloadAndInstallUpdate((progress) => {
      setView((v) =>
        v.phase === 'downloading'
          ? { phase: 'downloading', downloaded: v.downloaded + progress.downloaded, total: progress.total || v.total }
          : { phase: 'downloading', downloaded: progress.downloaded, total: progress.total },
      )
    }, onPhase)

    if (!result.success) {
      showError(`下载或安装失败：${result.error ?? '未知错误'}`)
    }
    // 成功路径：relaunch 已触发，应用即将退出重启，无需额外 UI
  }, [view.phase, showError])

  // 稍后提醒
  const handleLater = useCallback(() => {
    setIsVisible(false)
    setView({ phase: 'idle' })
    onClose?.()
  }, [onClose])

  // 关闭弹窗
  const handleClose = useCallback(() => {
    setIsVisible(false)
    setView({ phase: 'idle' })
    onClose?.()
  }, [onClose])

  // 不显示时返回 null
  if (!isVisible) return null

  // 进度百分比
  const progressPercent =
    view.phase === 'downloading' && view.total > 0 ? Math.min(100, Math.round((view.downloaded / view.total) * 100)) : 0

  const isBusy =
    view.phase === 'checking' ||
    view.phase === 'downloading' ||
    view.phase === 'verifying' ||
    view.phase === 'installing' ||
    view.phase === 'restarting'

  const title =
    view.phase === 'error'
      ? '更新失败'
      : view.phase === 'up-to-date'
        ? '已是最新版本'
        : view.phase === 'verifying' || view.phase === 'installing' || view.phase === 'restarting'
          ? '正在安装更新'
          : view.phase === 'downloading'
            ? '正在下载更新'
            : view.phase === 'checking'
              ? '正在检查更新'
              : view.phase === 'available'
                ? '发现新版本'
                : '更新'

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={!isBusy ? handleClose : undefined} />

      {/* 弹窗主体 */}
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 animate-in fade-in zoom-in-95">
        {/* 关闭按钮 */}
        {!isBusy && view.phase !== 'up-to-date' && (
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* 图标 */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              view.phase === 'error'
                ? 'bg-red-100 dark:bg-red-900/30'
                : view.phase === 'up-to-date'
                  ? 'bg-green-100 dark:bg-green-900/30'
                  : 'bg-blue-100 dark:bg-blue-900/30'
            }`}
          >
            <svg
              className={`w-5 h-5 ${
                view.phase === 'error'
                  ? 'text-red-500'
                  : view.phase === 'up-to-date'
                    ? 'text-green-500'
                    : 'text-blue-500'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {view.phase === 'up-to-date' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              ) : view.phase === 'error' ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              ) : (
                <>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.863A5.5 5.5 0 0115.9 6l.1.001A5.002 5.002 0 0120 11a5 5 0 01-5 5H7z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12v6m-3-3l3 3 3-3" />
                </>
              )}
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
            {view.phase === 'available' && (
              <p className="text-sm text-gray-500 dark:text-gray-400">SpiritPal v{view.info.version}</p>
            )}
            {view.phase === 'up-to-date' && (
              <p className="text-sm text-gray-500 dark:text-gray-400">当前已是最新版本</p>
            )}
          </div>
        </div>

        {/* 更新说明 */}
        {view.phase === 'available' && view.info.body && (
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 max-h-40 overflow-y-auto">
            <pre className="whitespace-pre-wrap font-sans">{view.info.body}</pre>
          </div>
        )}

        {/* 检查中提示 */}
        {view.phase === 'checking' && (
          <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">正在检查更新，请稍候...</div>
        )}

        {/* 下载进度 */}
        {view.phase === 'downloading' && (
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
              <span>正在下载更新...</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* 校验/安装/重启提示 */}
        {(view.phase === 'verifying' || view.phase === 'installing' || view.phase === 'restarting') && (
          <div className="mb-4 text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
            {view.phase === 'verifying' && '更新包下载完成，正在校验签名...'}
            {view.phase === 'installing' && '正在安装更新，请稍候...'}
            {view.phase === 'restarting' && '安装完成，应用即将重启...'}
          </div>
        )}

        {/* 已是最新提示 */}
        {view.phase === 'up-to-date' && (
          <div className="mb-4 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
            当前已是最新版本。
          </div>
        )}

        {/* 错误提示（失败原因可见，不吞错误） */}
        {view.phase === 'error' && (
          <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 break-all">
            {view.message}
            <div className="mt-1 text-xs opacity-80">请检查网络连接后重试；更新失败不影响当前版本正常运行。</div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 justify-end">
          {view.phase === 'error' || view.phase === 'up-to-date' ? (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
            >
              确定
            </button>
          ) : view.phase === 'available' ? (
            <>
              <button
                onClick={handleLater}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                稍后提醒
              </button>
              <button
                onClick={handleUpdateNow}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
              >
                立即更新
              </button>
            </>
          ) : (
            <button
              disabled
              className="px-4 py-2 text-sm font-medium text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-lg cursor-not-allowed"
            >
              {view.phase === 'checking' ? '检查中...' : '更新中...'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ 手动触发更新的辅助函数 ============

/**
 * 手动触发更新检查（供设置页「检查更新」按钮等调用）
 *
 * 通过 DOM CustomEvent 通知 UpdateNotification 弹窗展示完整状态机，
 * 避免组件间直接状态耦合。无 UpdateNotification 挂载时静默。
 *
 * @returns 更新信息（始终返回 null；检查结果由弹窗展示，本函数仅触发流程）
 */
// eslint-disable-next-line react-refresh/only-export-components -- 该函数是供设置页调用的公共工具函数，保持导出以维持既有 API
export function manualCheckForUpdates(): Promise<UpdateInfo | null> {
  window.dispatchEvent(new CustomEvent('spiritpal:check-updates'))
  return Promise.resolve(null)
}

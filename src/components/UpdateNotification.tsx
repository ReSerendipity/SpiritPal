/**
 * 自动更新通知弹窗组件
 *
 * 功能概述：
 * - 应用启动后自动检查新版本（可配置延迟）
 * - 检测到新版本时弹出Modal通知
 * - 显示版本号、更新说明、下载进度
 * - 支持「立即更新」下载并安装、「稍后提醒」关闭
 * - 下载完成后提示重启应用
 *
 * 核心Hooks/状态：
 * - useState: 弹窗可见性、更新信息、下载状态、进度、错误、完成状态
 * - useEffect: 自动检查更新定时器
 * - useCallback: 检查更新、开始下载、关闭弹窗
 *
 * 使用模块：
 * - updater: 版本检查、下载安装逻辑
 */
import { useState, useEffect, useCallback } from 'react'
import { checkForUpdates, downloadAndInstallUpdate, type UpdateInfo } from '@/lib/updater'

// ============ Props ============

interface UpdateNotificationProps {
  /** 是否自动检查更新（默认 true） */
  autoCheck?: boolean
  /** 自动检查延迟（毫秒，默认 30 秒） */
  autoCheckDelay?: number
  /** 自定义关闭回调 */
  onClose?: () => void
}

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
export function UpdateNotification({
  autoCheck = true,
  autoCheckDelay = 30000,
  onClose,
}: UpdateNotificationProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadTotal, setDownloadTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isComplete, setIsComplete] = useState(false)

  // 自动检查更新
  useEffect(() => {
    if (!autoCheck) return

    const timer = setTimeout(async () => {
      const result = await checkForUpdates()
      if (result.available && result.info) {
        setUpdateInfo(result.info)
        setIsVisible(true)
      }
    }, autoCheckDelay)

    return () => clearTimeout(timer)
  }, [autoCheck, autoCheckDelay])

  // 立即更新
  const handleUpdateNow = useCallback(async () => {
    if (!updateInfo) return

    setIsDownloading(true)
    setError(null)
    setDownloadProgress(0)
    setDownloadTotal(0)

    const success = await downloadAndInstallUpdate((progress) => {
      setDownloadProgress((prev) => prev + progress.downloaded)
      setDownloadTotal(progress.total)
    })

    if (success) {
      setIsDownloading(false)
      setIsComplete(true)
    } else {
      setIsDownloading(false)
      setError('下载或安装失败，请稍后重试。')
    }
  }, [updateInfo])

  // 稍后提醒
  const handleLater = useCallback(() => {
    setIsVisible(false)
    onClose?.()
  }, [onClose])

  // 关闭弹窗
  const handleClose = useCallback(() => {
    setIsVisible(false)
    setUpdateInfo(null)
    setError(null)
    setIsComplete(false)
    onClose?.()
  }, [onClose])

  // 不显示时返回 null
  if (!isVisible) return null

  // 进度百分比
  const progressPercent = downloadTotal > 0
    ? Math.min(100, Math.round((downloadProgress / downloadTotal) * 100))
    : 0

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={!isDownloading ? handleClose : undefined}
      />

      {/* 弹窗主体 */}
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 animate-in fade-in zoom-in-95">
        {/* 关闭按钮 */}
        {!isDownloading && (
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
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.863A5.5 5.5 0 0115.9 6l.1.001A5.002 5.002 0 0120 11a5 5 0 01-5 5H7z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12v6m-3-3l3 3 3-3" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {isComplete ? '更新完成' : '发现新版本'}
            </h3>
            {updateInfo && !isComplete && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                SpiritPal v{updateInfo.version}
              </p>
            )}
          </div>
        </div>

        {/* 更新说明 */}
        {updateInfo?.body && !isComplete && (
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 max-h-40 overflow-y-auto">
            <pre className="whitespace-pre-wrap font-sans">{updateInfo.body}</pre>
          </div>
        )}

        {/* 下载进度 */}
        {isDownloading && (
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

        {/* 更新完成提示 */}
        {isComplete && (
          <div className="mb-4 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
            更新已下载完成，应用即将重启...
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
            {error}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 justify-end">
          {isComplete ? (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
            >
              确定
            </button>
          ) : isDownloading ? (
            <button
              disabled
              className="px-4 py-2 text-sm font-medium text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-lg cursor-not-allowed"
            >
              更新中...
            </button>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  )
}

// ============ 手动触发更新的辅助函数 ============

/**
 * 手动触发更新检查
 * 供设置页面的「检查更新」按钮调用
 *
 * @returns 更新信息，无更新时返回 null
 */
// eslint-disable-next-line react-refresh/only-export-components -- 该函数是供设置页调用的公共工具函数，保持导出以维持既有 API
export async function manualCheckForUpdates(): Promise<UpdateInfo | null> {
  const result = await checkForUpdates()
  if (result.error) {
    console.warn('[UpdateNotification] 检查更新失败:', result.error)
  }
  return result.info ?? null
}

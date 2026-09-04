/**
 * 数据管理面板组件
 *
 * 功能概述：
 * - WebDAV云同步配置：支持坚果云、pCloud等WebDAV服务
 * - 连接测试与配置保存
 * - 手动触发同步和自动同步（5分钟间隔）
 * - 数据备份导出：导出所有应用数据为JSON文件
 * - 数据恢复导入：从备份文件恢复数据
 * - 数据重置：清除所有数据（双重确认）
 * - 密码安全存储（系统Keychain）
 * - AES加密数据传输
 *
 * 核心Hooks/状态：
 * - useState: WebDAV配置、测试结果、同步状态、消息提示
 * - useEffect: 加载已保存配置、订阅同步状态
 * - useRef: 文件输入引用
 *
 * 使用模块：
 * - dataManager: 数据导入导出管理器
 * - webdavClient: WebDAV客户端
 * - syncManager: 同步管理器（自动同步、状态订阅）
 */
import { useState, useRef, useEffect } from 'react'
import { Download, Upload, AlertCircle, Check, Database, RotateCcw, Cloud, CloudOff, Link, Loader2, Trash2 } from 'lucide-react'
import { getDataManager } from '@/lib/data/dataManager'
import { cleanupZombieData, getZombieDataReport, type ZombieDataReport } from '@/lib/data/zombieDataCleanup'
// P1: 数据健康检查 — 接入启动链路（runMigrations + runDirtyDataChecks）的结果展示
import {
  getDataHealthSnapshot,
  subscribeDataHealth,
  runGovernanceChecks,
  resolveDirtyIssue,
  migrationFailureText,
  type DataHealthSnapshot,
} from '@/lib/data/dataHealth'
import { syncManager, type SyncStatus } from '@/lib/system/syncManager'
import { getWebDAVClient, type WebDAVTestResult } from '@/lib/system/webdavClient'
// P1: 本地自动备份 — 退出自动备份加密库（保留 3 份）+ 列出/恢复/删除
import {
  listDbBackups,
  restoreDbBackup,
  deleteDbBackup,
  type DBBackupInfoTs,
} from '@/lib/data/dbBackup'
// B-3: 数据治理 —— 迁移遗留（.legacy）数据清理

/**
 * 数据管理面板
 *
 * 提供WebDAV云同步配置、数据备份导出、数据恢复导入和数据重置功能。
 */
export function DataPanel() {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mgr = getDataManager()

  // 已保存的 WebDAV 配置（同步读取一次，用于惰性初始化表单状态）
  const savedConfig = syncManager.getConfig()

  // WebDAV 同步状态
  const [webdavEnabled, setWebdavEnabled] = useState(
    () => !!savedConfig.webdav && savedConfig.enabled && savedConfig.transport === 'webdav',
  )
  const [webdavServerUrl, setWebdavServerUrl] = useState(
    () => savedConfig.webdav?.serverUrl ?? 'https://dav.jianguoyun.com/dav/',
  )
  const [webdavUsername, setWebdavUsername] = useState(() => savedConfig.webdav?.username ?? '')
  const [webdavPassword, setWebdavPassword] = useState('')
  const [webdavTesting, setWebdavTesting] = useState(false)
  const [webdavTestResult, setWebdavTestResult] = useState<WebDAVTestResult | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncManager.getStatus())
  // B-3: 数据治理 —— 迁移遗留数据报告与清理状态
  const [zombieReport, setZombieReport] = useState<ZombieDataReport | null>(null)
  const [cleaning, setCleaning] = useState(false)
  // P1: 数据健康快照（启动时由 runGovernanceChecks 广播）
  const [health, setHealth] = useState<DataHealthSnapshot | null>(() => getDataHealthSnapshot())
  const [healthChecking, setHealthChecking] = useState(false)
  // P1: 本地自动备份列表
  const [backups, setBackups] = useState<DBBackupInfoTs[]>([])

  // 从 Keychain 加载密码（异步回调中 setState）+ 订阅同步状态
  useEffect(() => {
    void getWebDAVClient().loadPassword().then((pwd) => {
      if (pwd) setWebdavPassword('••••••••') // 显示占位符
    })
    return syncManager.subscribe((status) => setSyncStatus(status))
  }, [])

  // B-3: 加载数据治理报告（只读统计，不清理）
  useEffect(() => {
    void getZombieDataReport()
      .then(setZombieReport)
      .catch(() => setZombieReport(null))
  }, [])

  // P1: 订阅数据健康快照；启动时若尚未检查（如直接进入设置页），主动补一次
  useEffect(() => {
    const unsub = subscribeDataHealth(setHealth)
    if (!getDataHealthSnapshot()) {
      setHealthChecking(true)
      void runGovernanceChecks()
        .then(setHealth)
        .catch(() => setHealth(null))
        .finally(() => setHealthChecking(false))
    }
    return unsub
  }, [])

  // P1: 手动重新检测数据健康
  async function handleRecheckHealth() {
    setHealthChecking(true)
    try {
      setHealth(await runGovernanceChecks())
    } catch (e) {
      flash('error', `数据健康检测失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setHealthChecking(false)
    }
  }

  // P1: 加载本地自动备份列表
  function loadBackups() {
    void listDbBackups()
      .then(setBackups)
      .catch(() => setBackups([]))
  }

  useEffect(() => {
    loadBackups()
  }, [])

  // P1: 恢复指定备份（需重启生效）
  async function handleRestoreBackup(name: string) {
    if (!window.confirm(`从备份「${name}」恢复？恢复后当前数据将被覆盖，且需重启应用生效。`)) return
    try {
      await restoreDbBackup(name)
      flash('success', `已从备份恢复，请重启应用生效`)
    } catch (e) {
      flash('error', `恢复失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // P1: 删除指定备份
  async function handleDeleteBackup(name: string) {
    if (!window.confirm(`删除备份「${name}」？该操作不可恢复。`)) return
    try {
      await deleteDbBackup(name)
      loadBackups()
      flash('success', '备份已删除')
    } catch (e) {
      flash('error', `删除失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function flash(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  async function handleExport() {
    await mgr.exportToFile()
    flash('success', '配置文件已导出')
  }

  async function handleEncryptedExport() {
    const password = window.prompt('设置加密导出密码（用于解密备份文件，请牢记）:')
    if (!password) return
    const confirmPwd = window.prompt('再次输入密码确认:')
    if (password !== confirmPwd) {
      flash('error', '两次密码不一致，已取消')
      return
    }
    if (password.length < 6) {
      flash('error', '密码至少 6 位')
      return
    }
    try {
      await mgr.downloadEncryptedExport(password)
      flash('success', '加密备份(.spiritpal)已导出，请用设置的密码解密导入')
    } catch (e) {
      flash('error', `加密导出失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const result = await mgr.importFromFile(file)
    flash(result.success ? 'success' : 'error', result.message)
    e.target.value = ''
  }

  async function handleReset() {
    if (confirm('⚠️ 确定要重置所有数据吗？这将清除所有设置、记忆、养成数据、模组和截图。此操作不可撤销！')) {
      if (confirm('再次确认：这将永久删除所有 SpiritPal 数据，确定继续吗？')) {
        await mgr.resetAll()
        flash('success', '所有数据已重置。请重启应用。')
      }
    }
  }

  // B-3: 手动清理迁移遗留数据（force：清除全部 .legacy 副本，包括无时间戳的旧行）
  async function handleCleanupLegacy() {
    const count = zombieReport?.legacyBlobCount ?? 0
    if (count === 0) {
      flash('success', '没有需要清理的迁移遗留数据')
      return
    }
    if (!confirm(`将删除 ${count} 条迁移遗留副本（约 ${formatBytes(zombieReport!.totalEstimatedBytes)}）。这些是行级迁移前的旧数据备份，确认后无法恢复。`)) {
      return
    }
    setCleaning(true)
    try {
      const result = await cleanupZombieData({ forceLegacyCleanup: true })
      flash('success', `已清理 ${result.totalCleaned} 条迁移遗留数据`)
      const report = await getZombieDataReport()
      setZombieReport(report)
    } catch (e) {
      flash('error', `清理失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCleaning(false)
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // WebDAV 连接测试
  async function handleTestWebDAV() {
    setWebdavTesting(true)
    setWebdavTestResult(null)
    try {
      const client = getWebDAVClient()
      await client.configure({
        serverUrl: webdavServerUrl,
        username: webdavUsername,
        autoSync: webdavEnabled,
        autoSyncInterval: 300000,
      })
      // 如果密码不是占位符，设置新密码
      if (webdavPassword && webdavPassword !== '••••••••') {
        await client.setPassword(webdavPassword)
      }
      const result = await client.testConnection()
      setWebdavTestResult(result)
    } catch (err) {
      setWebdavTestResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setWebdavTesting(false)
    }
  }

  // 保存 WebDAV 配置
  async function handleSaveWebDAV() {
    try {
      const client = getWebDAVClient()
      await client.configure({
        serverUrl: webdavServerUrl,
        username: webdavUsername,
        autoSync: webdavEnabled,
        autoSyncInterval: 300000,
      })
      // 如果密码不是占位符，保存新密码
      if (webdavPassword && webdavPassword !== '••••••••') {
        await client.setPassword(webdavPassword)
      }
      // 配置 syncManager
      syncManager.configure({
        enabled: webdavEnabled,
        transport: 'webdav',
        autoSyncInterval: webdavEnabled ? 300000 : 0,
        webdav: {
          serverUrl: webdavServerUrl,
          username: webdavUsername,
        },
      })
      if (webdavEnabled) {
        syncManager.startAutoSync()
      } else {
        syncManager.stopAutoSync()
      }
      flash('success', 'WebDAV 同步配置已保存')
    } catch (err) {
      flash('error', `保存失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 手动触发同步
  async function handleSyncNow() {
    try {
      const result = await syncManager.sync()
      if (result.success) {
        flash('success', `同步成功（${result.appliedFields.length} 个字段已更新）`)
      } else {
        flash('error', `同步失败: ${result.error ?? '未知错误'}`)
      }
    } catch (err) {
      flash('error', `同步出错: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const syncStatusText: Record<SyncStatus, string> = {
    idle: '未同步',
    syncing: '同步中...',
    success: '已同步',
    error: '同步失败',
    offline: '离线',
  }

  const syncStatusColor: Record<SyncStatus, string> = {
    idle: 'text-ink-muted',
    syncing: 'text-blue-400',
    success: 'text-green-400',
    error: 'text-red-400',
    offline: 'text-yellow-400',
  }

  return (
    <div className="space-y-5">
      {message && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          message.type === 'success' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'
        }`}>
          {message.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
          {message.text}
        </div>
      )}

      {/* 数据健康检查（P1：迁移失败 / 脏数据告警） */}
      <div className={`rounded-xl p-4 ${health && (health.dirtyTotal > 0 || health.migrationFailed > 0) ? 'bg-yellow-900/20' : 'bg-surface/60'}`}>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-ink-muted" />
            <h3 className="text-sm font-semibold">数据健康检查</h3>
            {healthChecking && <Loader2 size={13} className="animate-spin text-ink-muted" />}
          </div>
          <button
            onClick={handleRecheckHealth}
            disabled={healthChecking}
            className="flex items-center gap-1 rounded-lg border border-ink/20 px-2.5 py-1 text-[11px] text-ink-muted hover:bg-ink/5 disabled:opacity-50"
          >
            <RotateCcw size={11} /> 重新检测
          </button>
        </div>

        {health && health.migrationFailed === 0 && health.dirtyTotal === 0 && (
          <p className="text-[11px] text-green-300">
            数据库结构健康（Schema v{health.schemaVersion}），未发现脏数据。
          </p>
        )}

        {health && health.migrationFailed > 0 && (
          <div className="mb-2 rounded-lg bg-red-900/25 px-3 py-2 text-[11px] text-red-300">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertCircle size={12} /> {migrationFailureText(health.migrationFailed, health.schemaVersion)}
            </div>
            <div className="text-red-300/80">详情见数据库 schema_migration_log 表。</div>
          </div>
        )}

        {health && health.dirtyTotal > 0 && (
          <div className="rounded-lg bg-yellow-900/20 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-yellow-300">
              <AlertCircle size={12} />
              发现 {health.dirtyTotal} 条未解决脏数据（最高严重度：{health.highestSeverity ?? '无'}）
            </div>
            {health.topIssues.map((issue, idx) => (
              <div key={`${issue.table}-${idx}`} className="flex items-start justify-between gap-2 py-0.5 text-[11px] text-yellow-200/80">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-yellow-500/90">[{issue.severity}]</span> {issue.description}
                </span>
                {issue.id != null && (
                  <button
                    onClick={() => {
                      void resolveDirtyIssue(issue.id as number)
                    }}
                    className="shrink-0 rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] hover:bg-yellow-800/40"
                  >
                    已解决
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!health && !healthChecking && (
          <p className="text-[11px] text-ink-muted">启动时数据健康检查尚未运行，点击「重新检测」查看。</p>
        )}
      </div>

      {/* WebDAV 云同步 */}
      <div className="rounded-xl bg-surface/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {webdavEnabled ? <Cloud size={16} className="text-indigo-300" /> : <CloudOff size={16} className="text-ink-muted" />}
            <h3 className="text-sm font-semibold">WebDAV 云同步</h3>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <span className="text-[11px] text-ink-muted">启用</span>
            <input
              type="checkbox"
              checked={webdavEnabled}
              onChange={(e) => setWebdavEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-ink/20 bg-cream-deep text-indigo-500 focus:ring-indigo-500"
            />
          </label>
        </div>
        <p className="mb-3 text-[11px] text-ink-muted">
          通过 WebDAV 协议自动同步宠物养成数据、设置和聊天记录到坚果云等云存储服务。多设备间数据自动合并。
        </p>

        {webdavEnabled && (
          <div className="space-y-3">
            {/* 服务器地址 */}
            <div>
              <label className="mb-1 block text-[11px] text-ink-muted">服务器地址</label>
              <input
                type="url"
                value={webdavServerUrl}
                onChange={(e) => setWebdavServerUrl(e.target.value)}
                placeholder="https://dav.jianguoyun.com/dav/"
                className="w-full rounded-lg border border-ink/20 bg-cream-deep/50 px-3 py-1.5 text-xs text-ink placeholder-ink-muted focus:border-indigo-500 focus:outline-none"
              />
              <div className="mt-1 flex flex-wrap gap-1">
                {['https://dav.jianguoyun.com/dav/', 'https://webdav.pcloud.com/'].map((url) => (
                  <button
                    key={url}
                    onClick={() => setWebdavServerUrl(url)}
                    className="rounded bg-cream-deep px-2 py-0.5 text-[10px] text-ink-muted hover:bg-ink-faint hover:text-ink"
                  >
                    {url.includes('jianguoyun') ? '坚果云' : 'pCloud'}
                  </button>
                ))}
              </div>
            </div>

            {/* 用户名 */}
            <div>
              <label className="mb-1 block text-[11px] text-ink-muted">用户名 / 邮箱</label>
              <input
                type="text"
                value={webdavUsername}
                onChange={(e) => setWebdavUsername(e.target.value)}
                placeholder="your@email.com"
                className="w-full rounded-lg border border-ink/20 bg-cream-deep/50 px-3 py-1.5 text-xs text-ink placeholder-ink-muted focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* 密码 / 应用密码 */}
            <div>
              <label className="mb-1 block text-[11px] text-ink-muted">应用密码</label>
              <input
                type="password"
                value={webdavPassword}
                onChange={(e) => setWebdavPassword(e.target.value)}
                placeholder="第三方应用专用密码"
                className="w-full rounded-lg border border-ink/20 bg-cream-deep/50 px-3 py-1.5 text-xs text-ink placeholder-ink-muted focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-[10px] text-ink-muted">
                坚果云用户请使用「设置 → 安全选项 → 第三方应用密码」生成的专用密码
              </p>
            </div>

            {/* 连接测试结果 */}
            {webdavTestResult && (
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] ${
                webdavTestResult.success
                  ? 'bg-green-900/30 text-green-300'
                  : 'bg-red-900/30 text-red-300'
              }`}>
                {webdavTestResult.success ? <Check size={14} /> : <AlertCircle size={14} />}
                {webdavTestResult.serverInfo || webdavTestResult.error}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <button
                onClick={handleTestWebDAV}
                disabled={webdavTesting || !webdavServerUrl || !webdavUsername}
                className="flex items-center gap-1.5 rounded-lg bg-ink-faint px-3 py-1.5 text-xs text-ink hover:bg-blush-soft disabled:opacity-50"
              >
                {webdavTesting ? <Loader2 size={14} className="animate-spin" /> : <Link size={14} />}
                测试连接
              </button>
              <button
                onClick={handleSaveWebDAV}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500"
              >
                <Cloud size={14} /> 保存配置
              </button>
            </div>

            {/* 同步状态 + 手动同步 */}
            <div className="flex items-center justify-between rounded-lg bg-cream-deep/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-ink-muted">同步状态:</span>
                <span className={`text-[11px] font-medium ${syncStatusColor[syncStatus]}`}>
                  {syncStatusText[syncStatus]}
                </span>
              </div>
              <button
                onClick={handleSyncNow}
                disabled={syncStatus === 'syncing'}
                className="rounded bg-ink-faint px-2.5 py-1 text-[10px] text-ink hover:bg-blush-soft disabled:opacity-50"
              >
                立即同步
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 备份导出 */}
      <div className="rounded-xl bg-surface/60 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Database size={16} className="text-amber-300" />
          <h3 className="text-sm font-semibold">数据备份</h3>
        </div>
        <p className="mb-3 text-[11px] text-ink-muted">
          导出所有应用数据（设置、AI 配置、养成数据、记忆、模组、成就），用于备份或迁移到其他设备。
        </p>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
        >
          <Download size={16} /> 导出全部数据
        </button>
        <button
          onClick={handleEncryptedExport}
          className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/20"
        >
          <Database size={16} /> 导出加密备份 (.spiritpal)
        </button>
      </div>

      {/* P1: 本地自动备份（退出自动备份加密库 — 无云端备份下的 durability） */}
      <div className="rounded-xl bg-surface/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-indigo-300" />
            <h3 className="text-sm font-semibold">本地自动备份</h3>
          </div>
          <button
            onClick={loadBackups}
            className="flex items-center gap-1 rounded-lg border border-ink/20 px-2.5 py-1 text-[11px] text-ink-muted hover:bg-ink/5"
          >
            <RotateCcw size={11} /> 刷新
          </button>
        </div>
        <p className="mb-3 text-[11px] text-ink-muted">
          每次退出应用时自动备份本地加密数据库（保留最近 3 份），用于防误删 / 物理损坏恢复。
          换机或重装请使用上方「导出加密备份 (.spiritpal)」生成可迁移的完整备份。
        </p>
        {backups.length === 0 ? (
          <p className="text-[11px] text-ink-muted">暂无自动备份（首次正常退出后生成）</p>
        ) : (
          <ul className="space-y-1 rounded-lg bg-cream-deep/30 px-3 py-2">
            {backups.map((b) => {
              const d = new Date(b.modifiedAt)
              return (
                <li key={b.name} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-ink-muted">
                    {Number.isNaN(d.getTime()) ? b.name : d.toLocaleString()} · {formatBytes(b.sizeBytes)}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => void handleRestoreBackup(b.name)}
                      className="rounded bg-indigo-900/40 px-1.5 py-0.5 text-[10px] hover:bg-indigo-800/40"
                    >
                      恢复
                    </button>
                    <button
                      onClick={() => void handleDeleteBackup(b.name)}
                      className="rounded bg-red-900/30 px-1.5 py-0.5 text-[10px] hover:bg-red-800/40"
                    >
                      删除
                    </button>
                  </div>
                </li>
              )
            })}
            <li className="pt-1 text-[10px] text-ink-faint">
              共 {backups.length} 份（自动保留最近 3 份）
            </li>
          </ul>
        )}
      </div>

      {/* 数据导入 */}
      <div className="rounded-xl bg-surface/60 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Upload size={16} className="text-blue-300" />
          <h3 className="text-sm font-semibold">数据恢复</h3>
        </div>
        <p className="mb-3 text-[11px] text-ink-muted">
          从备份文件恢复数据。将覆盖当前的同名数据。导入后建议重启应用以完全生效。
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          <Upload size={16} /> 选择备份文件
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImportFile}
          className="hidden"
        />
      </div>

      {/* B-3: 数据治理 —— 迁移遗留数据清理 */}
      <div className="rounded-xl bg-surface/60 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Trash2 size={16} className="text-teal-300" />
          <h3 className="text-sm font-semibold">数据治理</h3>
        </div>
        <p className="mb-3 text-[11px] text-ink-muted">
          记忆迁移到行级存储后，旧 blob 会以 .legacy 副本保留 7 天作为回滚保险。您可以在此查看并手动清理这些迁移遗留数据。
        </p>
        {zombieReport &&
        (zombieReport.legacyBlobCount > 0 ||
          zombieReport.expiredEpisodeCount > 0 ||
          zombieReport.expiredEntityCount > 0) ? (
          <ul className="mb-3 space-y-1 rounded-lg bg-cream-deep/30 px-3 py-2 text-[11px] text-ink-muted">
            <li>迁移遗留副本：{zombieReport.legacyBlobCount} 条（约 {formatBytes(zombieReport.totalEstimatedBytes)}）</li>
            <li>过期上下文快照：{zombieReport.expiredEpisodeCount} 条</li>
            <li>孤立实体节点：{zombieReport.expiredEntityCount} 条</li>
          </ul>
        ) : (
          <p className="mb-3 text-[11px] text-green-400">没有发现迁移遗留数据</p>
        )}
        <button
          onClick={handleCleanupLegacy}
          disabled={
            cleaning ||
            ((zombieReport?.legacyBlobCount ?? 0) === 0 &&
              (zombieReport?.expiredEpisodeCount ?? 0) === 0 &&
              (zombieReport?.expiredEntityCount ?? 0) === 0)
          }
          className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {cleaning ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          清理迁移遗留数据
        </button>
      </div>

      {/* 危险区域 */}
      <div className="rounded-xl border border-red-600/30 bg-red-900/10 p-4">
        <div className="mb-2 flex items-center gap-2">
          <AlertCircle size={16} className="text-red-400" />
          <h3 className="text-sm font-semibold text-red-300">危险操作</h3>
        </div>
        <p className="mb-3 text-[11px] text-ink-muted">
          重置将清除所有 SpiritPal 数据，包括设置、记忆、养成数据、模组和截图。此操作不可撤销。
        </p>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 rounded-lg bg-red-600/30 px-4 py-2 text-sm text-red-300 hover:bg-red-600/50"
        >
          <RotateCcw size={16} /> 重置所有数据
        </button>
      </div>
    </div>
  )
}

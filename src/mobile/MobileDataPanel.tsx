/**
 * 移动端数据管理面板（P1-4-be/fe）
 * @module mobile/MobileDataPanel
 * @description
 * 把桌面端 DataPanel 的核心数据能力接到移动端：数据库完整性检查、
 * 立即备份、本地备份列表（恢复/删除）、重置全部数据。
 *
 * 交互差异：桌面用 window.confirm/prompt（Tauri 移动端 WebView 不支持），
 * 移动端统一改为卡片内确认态（与 P1-1 会话删除确认同模式）。
 *
 * @see {@link ../components/DataPanel} 桌面端数据面板（能力参照）
 * @see {@link ../lib/data/dbBackup} 备份 API（Rust backup_db_at_rest 系列）
 */
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import {
  Database,
  Plus,
  RotateCcw,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Check,
  Loader2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getDataManager } from '@/lib/data/dataManager'
import {
  listDbBackups,
  restoreDbBackup,
  deleteDbBackup,
  checkDbIntegrity,
  type DBBackupInfoTs,
} from '@/lib/data/dbBackup'

interface MobileDataPanelProps {
  /** 返回设置主页 */
  onBack: () => void
  bgClass: string
  textClass: string
  cardBgClass: string
  cardBorderClass: string
  subtitleClass: string
}

/** 字节数格式化（DataPanel.formatBytes 的移动端内联版） */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 移动端数据管理面板
 * @returns 数据管理界面组件
 */
export function MobileDataPanel({
  onBack,
  bgClass,
  textClass,
  cardBgClass,
  cardBorderClass,
  subtitleClass,
}: MobileDataPanelProps) {
  const { t } = useTranslation()
  const [backups, setBackups] = useState<DBBackupInfoTs[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [integrity, setIntegrity] = useState<boolean | null>(null)
  // 卡片内确认态（替代 window.confirm）
  const [confirmRestoreName, setConfirmRestoreName] = useState<string | null>(null)
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)
  const [confirmResetStep, setConfirmResetStep] = useState<0 | 1 | 2>(0)

  function flash(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  function loadBackups() {
    void listDbBackups()
      .then(setBackups)
      .catch(() => setBackups([]))
  }

  useEffect(() => {
    loadBackups()
  }, [])

  /** 立即备份（与退出加密备份同一 Rust 命令） */
  async function handleBackupNow() {
    setBusy(true)
    try {
      await invoke('backup_db_at_rest')
      flash('success', t('settings.data.backupOk'))
      loadBackups()
    } catch (e) {
      flash('error', `${t('settings.data.backupFail')}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 恢复备份（覆盖当前数据，需重启生效） */
  async function handleRestore(name: string) {
    setBusy(true)
    try {
      await restoreDbBackup(name)
      flash('success', t('settings.data.restoreOk'))
      setConfirmRestoreName(null)
      loadBackups()
    } catch (e) {
      flash('error', `${t('settings.data.restoreFail')}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 删除备份（不可恢复） */
  async function handleDelete(name: string) {
    setBusy(true)
    try {
      await deleteDbBackup(name)
      flash('success', t('settings.data.deleteOk'))
      setConfirmDeleteName(null)
      loadBackups()
    } catch (e) {
      flash('error', `${t('settings.data.deleteFail')}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 数据库完整性检查 */
  async function handleCheckIntegrity() {
    setBusy(true)
    try {
      const ok = await checkDbIntegrity()
      setIntegrity(ok)
    } catch (e) {
      flash('error', String(e instanceof Error ? e.message : e))
      setIntegrity(false)
    } finally {
      setBusy(false)
    }
  }

  /** 重置所有数据（双重确认后执行；GDPR 删除权：localStorage + SQLite 全清） */
  async function handleReset() {
    setBusy(true)
    try {
      await getDataManager().resetAll()
      setConfirmResetStep(0)
      flash('success', t('settings.data.resetOk'))
    } catch (e) {
      flash('error', `${t('settings.data.resetFail')}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
      <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
        <button onClick={onBack} className="text-sm text-tangerine">
          {t('settings.mobile.back')}
        </button>
        <h2 className="text-base font-semibold">{t('settings.data.title')}</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* 操作反馈 */}
        {message && (
          <div
            className={`mb-3 rounded-xl border p-3 text-xs ${
              message.type === 'success'
                ? 'border-tangerine/40 bg-tangerine-soft/40 text-ink'
                : 'border-error/40 bg-error/10 text-error'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* 完整性检查 */}
        <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-ink-faint" />
            <span className="text-sm font-medium">{t('settings.data.integrity')}</span>
            <button
              onClick={() => void handleCheckIntegrity()}
              disabled={busy}
              className={`ml-auto flex items-center gap-1 rounded-lg border border-ink/10 px-2 py-1 text-xs ${
                busy ? 'opacity-50' : 'hover:bg-ink/5'
              }`}
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {t('settings.data.runCheck')}
            </button>
          </div>
          {integrity !== null && (
            <p className={`mt-1.5 text-xs ${integrity ? 'text-ink' : 'text-error'}`}>
              {integrity ? t('settings.data.integrityOk') : t('settings.data.integrityFail')}
            </p>
          )}
        </div>

        {/* 立即备份 */}
        <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
          <div className="flex items-center gap-2">
            <Database size={16} className="text-ink-faint" />
            <span className="text-sm font-medium">{t('settings.data.backupNow')}</span>
            <button
              onClick={() => void handleBackupNow()}
              disabled={busy}
              className={`ml-auto flex items-center gap-1 rounded-lg bg-tangerine px-3 py-1.5 text-xs text-white ${
                busy ? 'opacity-50' : 'hover:bg-tangerine-deep'
              }`}
            >
              <Plus size={13} />
              {t('settings.data.doBackup')}
            </button>
          </div>
          <p className={`mt-1 text-xs ${subtitleClass}`}>{t('settings.data.backupHint')}</p>
        </div>

        {/* 备份列表 */}
        <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
          <h3 className="mb-2 text-sm font-medium">{t('settings.data.backups')}</h3>
          {backups.length === 0 && (
            <p className={`text-xs ${subtitleClass}`}>{t('settings.data.backupsEmpty')}</p>
          )}
          <div className="space-y-2">
            {backups.map((b) => (
              <div key={b.name} className="rounded-lg border border-ink/10 bg-cream-deep p-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-xs text-ink" title={b.name}>
                    {b.name}
                  </span>
                  <span className={`flex-shrink-0 text-[10px] ${subtitleClass}`}>
                    {formatBytes(b.sizeBytes)} · {new Date(b.modifiedAt).toLocaleString()}
                  </span>
                </div>
                {confirmRestoreName === b.name ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex-1 text-[11px] text-error">{t('settings.data.confirmRestore')}</span>
                    <button
                      onClick={() => setConfirmRestoreName(null)}
                      aria-label={t('app.cancel')}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 text-ink"
                    >
                      <X size={13} />
                    </button>
                    <button
                      onClick={() => void handleRestore(b.name)}
                      disabled={busy}
                      aria-label={t('app.confirm')}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-tangerine text-white"
                    >
                      <Check size={13} />
                    </button>
                  </div>
                ) : confirmDeleteName === b.name ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex-1 text-[11px] text-error">{t('settings.data.confirmDelete')}</span>
                    <button
                      onClick={() => setConfirmDeleteName(null)}
                      aria-label={t('app.cancel')}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 text-ink"
                    >
                      <X size={13} />
                    </button>
                    <button
                      onClick={() => void handleDelete(b.name)}
                      disabled={busy}
                      aria-label={t('app.confirm')}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-error text-white"
                    >
                      <Check size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      onClick={() => setConfirmRestoreName(b.name)}
                      aria-label={`${t('settings.data.restore')}: ${b.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-ink/5"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteName(b.name)}
                      aria-label={`${t('settings.data.delete')}: ${b.name}`}
                      className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-ink/5 hover:text-error"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 危险区域：重置全部数据 */}
        <div className="mb-4 rounded-xl border border-error/30 bg-error/5 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-error" />
            <h3 className="text-sm font-semibold text-error">{t('settings.data.dangerZone')}</h3>
          </div>
          {confirmResetStep === 0 ? (
            <button
              onClick={() => setConfirmResetStep(1)}
              className="mt-2 w-full rounded-lg border border-error/40 py-2 text-xs text-error hover:bg-error/10"
            >
              {t('settings.data.resetAll')}
            </button>
          ) : confirmResetStep === 1 ? (
            <div className="mt-2">
              <p className="text-xs text-ink">{t('settings.data.confirmReset1')}</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setConfirmResetStep(0)}
                  className="flex-1 rounded-lg border border-ink/10 py-2 text-xs text-ink"
                >
                  {t('app.cancel')}
                </button>
                <button
                  onClick={() => setConfirmResetStep(2)}
                  className="flex-1 rounded-lg border border-error/40 py-2 text-xs text-error"
                >
                  {t('settings.data.continueReset')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <p className="text-xs font-medium text-error">{t('settings.data.confirmReset2')}</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setConfirmResetStep(0)}
                  className="flex-1 rounded-lg border border-ink/10 py-2 text-xs text-ink"
                >
                  {t('app.cancel')}
                </button>
                <button
                  onClick={() => void handleReset()}
                  disabled={busy}
                  className={`flex-1 rounded-lg bg-error py-2 text-xs text-white ${busy ? 'opacity-50' : ''}`}
                >
                  {t('settings.data.resetAll')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

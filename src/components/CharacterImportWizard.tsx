/**
 * 角色导入向导 — 统一入口 UI
 *
 * @fileoverview
 * P1-3: 设置页「导入角色」向导，拖入即用。
 * 支持 JSON 角色卡 / PNG 嵌卡 / 资源包目录导入。
 * 导入成功后显示预览 + 「立即使用」按钮。
 * 失败时逐条显示 errors（红色）/ warnings（黄色）。
 *
 * @module CharacterImportWizard
 */

import { useState, useCallback, useRef } from 'react'
import { Upload, FileJson, ImageIcon, FolderOpen, CheckCircle2, AlertCircle, AlertTriangle, X, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { importCharacter, type UnifiedImportResult } from '@/lib/nurture/characterImportService'
import { usePetStore } from '@/stores/petStore'
import { useSettingsStore } from '@/stores/settingsStore'

// ============ 组件 Props ============

interface CharacterImportWizardProps {
  /** 关闭回调 */
  onClose: () => void
}

// ============ 组件 ============

export function CharacterImportWizard({ onClose }: CharacterImportWizardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [result, setResult] = useState<UnifiedImportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const switchPetChar = usePetStore((s) => s.switchCharacter)
  const switchSettingsChar = useSettingsStore((s) => s.switchCharacter)

  // ============ 导入处理 ============

  const handleFile = useCallback(async (file: File) => {
    setLoading(true)
    setResult(null)

    try {
      const ext = file.name.toLowerCase().split('.').pop()
      const kind = ext === 'png' ? 'png-file' as const : 'json-file' as const
      const importResult = await importCharacter({ kind, file })
      setResult(importResult)
    } catch (e) {
      setResult({
        ok: false,
        errors: [String(e)],
        warnings: [],
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    await handleFile(files[0]!)
  }, [handleFile])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await handleFile(file)
  }, [handleFile])

  const handleDirectorySelect = useCallback(async () => {
    setLoading(true)
    setResult(null)

    try {
      // 使用 Tauri dialog 选择目录
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ directory: true, multiple: false })

      if (typeof selected === 'string' && selected) {
        const importResult = await importCharacter({ kind: 'directory', dirPath: selected })
        setResult(importResult)
      }
    } catch (e) {
      setResult({
        ok: false,
        errors: [String(e)],
        warnings: [],
      })
    } finally {
      setLoading(false)
    }
  }, [])

  // ============ 使用导入的角色 ============

  const handleUseCharacter = useCallback(() => {
    if (result?.ok && result.characterId) {
      switchPetChar(result.characterId)
      switchSettingsChar(result.characterId)
      onClose()
    }
  }, [result, switchPetChar, switchSettingsChar, onClose])

  // ============ 渲染 ============

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-100">
            <Upload size={20} className="text-amber-400" />
            {t('settings.import_character', { defaultValue: '导入角色' })}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        {/* 拖拽区 */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all ${
            dragOver
              ? 'border-amber-400 bg-amber-400/10'
              : 'border-white/10 hover:border-white/30'
          }`}
        >
          <Upload size={32} className="mb-2 text-gray-500" />
          <p className="text-sm text-gray-400">
            {t('settings.import_drag_hint', { defaultValue: '拖入 JSON / PNG 文件，或点击选择' })}
          </p>
          <div className="mt-3 flex gap-3 text-xs text-gray-600">
            <span className="flex items-center gap-1"><FileJson size={12} /> JSON</span>
            <span className="flex items-center gap-1"><ImageIcon size={12} /> PNG</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.png"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* 分隔线 */}
        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs text-gray-600">{t('settings.or', { defaultValue: '或' })}</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        {/* 目录选择 */}
        <button
          onClick={handleDirectorySelect}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 px-4 py-3 text-sm text-gray-400 hover:border-white/40 hover:text-gray-200 disabled:opacity-50"
        >
          <FolderOpen size={16} />
          {t('settings.import_from_directory', { defaultValue: '从目录导入角色包' })}
        </button>

        {/* 加载中 */}
        {loading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" />
            {t('settings.importing', { defaultValue: '正在导入...' })}
          </div>
        )}

        {/* 导入结果 */}
        {result && !loading && (
          <div className="mt-4 space-y-3">
            {result.ok && result.profile ? (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 size={18} />
                  <span className="text-sm font-medium">
                    {t('settings.import_success', { defaultValue: '导入成功' })}
                  </span>
                </div>

                {/* 角色预览 */}
                <div className="mt-3 flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-lg text-lg font-bold"
                    style={{ background: result.profile.themeColor.primary }}
                  >
                    {result.profile.displayName.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-200">
                      {result.profile.displayName}
                    </div>
                    <div className="text-xs text-gray-500">
                      ID: {result.profile.id} · {result.profile.spriteType}
                    </div>
                  </div>
                </div>

                {/* 警告 */}
                {result.warnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {result.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-1 text-xs text-yellow-400">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 立即使用按钮 */}
                <button
                  onClick={handleUseCharacter}
                  className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
                >
                  {t('settings.use_now', { defaultValue: '立即使用' })}
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <div className="flex items-center gap-2 text-red-400">
                  <AlertCircle size={18} />
                  <span className="text-sm font-medium">
                    {t('settings.import_failed', { defaultValue: '导入失败' })}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {result.errors.map((err, i) => (
                    <div key={i} className="flex items-start gap-1 text-xs text-red-300">
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                      <span>{err}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

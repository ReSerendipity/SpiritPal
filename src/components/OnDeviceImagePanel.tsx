/**
 * 端侧图像管理面板（设置页）
 *
 * **能力层面板**：设备能力判定 + 模型文件完整性 + 引擎加载/释放。
 * **不含生成界面** —— 具体场景（宠物形象 / 聊天配图 / 照片编辑）待定，
 * 定下来后在 `src/lib/ai/imageStudio.ts`（已提供 generateImage 等封装）之上做生成 UI。
 *
 * 数据来源（Tauri 命令，**仅移动端注册**，见 `src-tauri/src/ondevice/image.rs`）：
 * - `ondevice_image_probe`         → RAM / OpenCL / 模型目录
 * - `ondevice_image_missing_files` → 模型文件缺失清单
 * - `ondevice_image_load` / `ondevice_image_release`
 *
 * ⚠️ 与端侧 LLM **共享同一串行调度槽**（见 `ondevice/image.rs` 头注）：图像引擎加载期间
 *    LLM 对话会排队；且 12GB 设备上二者不可能同时常驻。UI 在加载前给出该提示。
 *
 * ⚠️ 模型权重为 **Qwen Research License（研究 / 非商用）** 且不随包分发，需用户自取。
 *    见 THIRD_PARTY_NOTICES.md 与 COMPLIANCE_CHECKLIST.md §8。
 *
 * @module components/OnDeviceImagePanel
 */
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Gauge, HardDrive, Image as ImageIcon, RefreshCw, Wand2, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BrandButton } from '@/components/ui'
import { imageCapability, IMAGE_MODEL_GB, type ImageCapability } from '@/lib/ai/onDeviceTiers'
import { isMobileRuntime } from '@/lib/system/platform'

/** 与 Rust `ondevice::image::ImageDeviceInfo` 对应（Tauri 透传 snake_case 键） */
interface ImageDeviceInfo {
  ram_gb: number
  opencl: boolean
  model_dir: string
}

/** 与 Rust `ondevice::image::MissingFilesInfo` 对应 */
interface MissingInfo {
  missing: string
  complete: boolean
}

/**
 * 端侧图像管理面板。
 * 非移动端直接返回说明卡片 —— `ondevice_image_*` 命令只在移动端注册。
 *
 * @param onOpenGenerator 打开文生图面板（由设置页路由提供）；省略时隐藏入口。
 */
export function OnDeviceImagePanel({ onOpenGenerator }: { onOpenGenerator?: () => void }) {
  const { t } = useTranslation()
  const mobile = isMobileRuntime()
  const [dev, setDev] = useState<ImageDeviceInfo | null>(null)
  const [cap, setCap] = useState<ImageCapability | null>(null)
  const [missing, setMissing] = useState<MissingInfo | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /** 拉取设备信息 + 模型完整性 */
  const refresh = useCallback(async () => {
    if (!mobile) return
    setError('')
    try {
      const info = await invoke<ImageDeviceInfo>('ondevice_image_probe')
      setDev(info)
      // 存储门槛由下方文案提示用户自查（Rust 侧不做 statvfs），此处传足量避免误判
      setCap(imageCapability(info.ram_gb, info.opencl, Number.MAX_SAFE_INTEGER))
      const m = await invoke<MissingInfo>('ondevice_image_missing_files', {
        modelDir: info.model_dir,
      })
      setMissing(m)
    } catch (e) {
      setError(String(e))
    }
  }, [mobile])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const load = useCallback(async () => {
    if (!dev) return
    setBusy(true)
    setError('')
    try {
      await invoke('ondevice_image_load', { modelDir: dev.model_dir, optionsJson: '{}' })
      setLoaded(true)
      await refresh()
    } catch (e) {
      setError(`${t('settings.image.loadFailed')}：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [dev, refresh, t])

  const release = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      await invoke('ondevice_image_release')
      setLoaded(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  if (!mobile) {
    return (
      <section className="rounded-xl bg-cream-deep/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <ImageIcon size={16} className="text-tangerine-deep" />
          <h3 className="text-sm font-medium text-ink">{t('settings.image.title')}</h3>
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">{t('settings.image.desktopOnly')}</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl bg-cream-deep/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon size={16} className="text-tangerine-deep" />
          <h3 className="text-sm font-medium text-ink">{t('settings.image.title')}</h3>
        </div>
        <BrandButton variant="ghost" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw size={14} className="mr-1" />
          {t('settings.image.refresh')}
        </BrandButton>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-ink-muted">{t('settings.image.desc')}</p>

      {/* 设备能力判定 */}
      {cap && dev && (
        <div className="mb-3 rounded-lg bg-cream-deep/70 p-3" data-testid="image-capability-card">
          <div className="flex items-center gap-2">
            <Gauge size={14} className="shrink-0 text-ink-muted" />
            <span className="text-xs font-medium text-ink">{t('settings.image.device')}</span>
            <span
              data-testid="image-capability-badge"
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                cap.feasible ? 'bg-success/15 text-success' : 'bg-error/15 text-error'
              }`}
            >
              {cap.feasible ? t('settings.image.capable') : t('settings.image.notCapable')}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-ink-muted">
            {t('settings.image.ram')} ≈{dev.ram_gb.toFixed(1)} GB · {t('settings.image.opencl')}{' '}
            {dev.opencl ? '✓' : '✗'}
            {cap.recommendedTier ? ` · ${cap.recommendedTier}` : ''}
          </p>
          <p className="mt-1 text-[10px] leading-4 text-ink-faint">{cap.note}</p>
          <p className="mt-1 text-[10px] leading-4 text-ink-faint">
            {t('settings.image.storageHint', {
              size: (IMAGE_MODEL_GB.base + IMAGE_MODEL_GB.turboExtra).toFixed(1),
            })}
          </p>
        </div>
      )}

      {/* 模型目录与完整性 */}
      {dev && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-cream-deep/70 p-3">
          <HardDrive size={14} className="mt-0.5 shrink-0 text-ink-muted" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-muted">{t('settings.image.modelFiles')}</span>
              {missing && (
                <span
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                    missing.complete ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                  }`}
                >
                  {missing.complete ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                  {missing.complete ? t('settings.image.complete') : t('settings.image.incomplete')}
                </span>
              )}
            </div>
            <code className="mt-0.5 block break-all text-[11px] text-ink">{dev.model_dir}</code>
            {missing && !missing.complete && (
              <div className="mt-1 break-all text-[10px] leading-4 text-ink-faint">{missing.missing}</div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-error/15 p-3 text-xs text-error">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* 加载 / 释放 */}
      <div className="flex flex-wrap items-center gap-2">
        {loaded ? (
          <>
            <span className="flex items-center gap-1 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
              <CheckCircle2 size={10} />
              {t('settings.image.loaded')}
            </span>
            <BrandButton variant="ghost" onClick={() => void release()} disabled={busy}>
              {t('settings.image.unload')}
            </BrandButton>
          </>
        ) : (
          <BrandButton onClick={() => void load()} disabled={busy || !cap?.feasible}>
            <Zap size={14} className="mr-1" />
            {busy ? t('settings.image.loading') : t('settings.image.load')}
          </BrandButton>
        )}
        {onOpenGenerator && (
          <BrandButton
            variant="ghost"
            onClick={onOpenGenerator}
            disabled={busy || !missing?.complete}
            title={missing?.complete ? undefined : t('settings.image.genNeedModel')}
          >
            <Wand2 size={14} className="mr-1" />
            {t('settings.image.genOpen')}
          </BrandButton>
        )}
      </div>

      <p className="mt-3 text-[10px] leading-4 text-ink-faint">{t('settings.image.sharedScheduler')}</p>
    </section>
  )
}

export default OnDeviceImagePanel

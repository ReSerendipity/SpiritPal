/**
 * 端侧图像生成面板（文生图最小可用版）
 *
 * 定位：**不绑定具体场景**的最小文生图——prompt + 比例/尺寸档 + 步数 + seed + 进度 + 结果预览。
 * 场景化能力（宠物换装 / 表情包 / 照片编辑）待用途确定后再扩展；
 * 编辑链路的 Kotlin/Rust 侧已就绪（`inputImage` / `sizeTier`），届时只需加选图入口。
 *
 * 数据流（全部经 `src/lib/ai/imageStudio.ts`，见该文件对分钟级任务与取消语义的说明）：
 *   1. `defaultImageOutputPath()` 定产物落点（appCacheDir/spiritpal-images）
 *   2. `generateImage()` 阻塞到生成结束，进度经 `ondevice://image_progress` 回灌
 *   3. 完成后 `readImageAsObjectUrl()` 读回 PNG 展示
 *
 * ⚠️ 与端侧 LLM 共享串行调度槽：生成期间（分钟级）LLM 对话排队。
 * ⚠️ 取消**不能真正中断**推理（上游无中止通道），只停止等待与 UI 更新。
 * ⚠️ 权重为 Qwen Research License（研究 / 非商用）且需用户自备。
 *
 * @module components/ImageGenPanel
 */
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Sparkles, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BrandButton } from '@/components/ui'
import { cancelImage, defaultImageOutputPath, generateImage, readImageAsObjectUrl } from '@/lib/ai/imageStudio'
import {
  IMAGE_RATIOS,
  IMAGE_TIER_BASE_PX,
  imageSize,
  type ImageRatioId,
  type ImageSizeTier,
} from '@/lib/ai/onDeviceTiers'
import { isMobileRuntime } from '@/lib/system/platform'

/** 与 Rust `ondevice::image::ImageDeviceInfo` 对应（snake_case 透传） */
interface ImageDeviceInfo {
  ram_gb: number
  opencl: boolean
  model_dir: string
}

/** 尺寸档位（前端分档表 → 上游 Turbo/base 通用；base 走 width/height）。 */
const SIZE_TIERS: ImageSizeTier[] = ['standard', 'fast', 'tiny']

/** 开箱即用的示例 prompt（与 textarea 的 placeholder 保持一致）。 */
const DEFAULT_PROMPT = '一只戴围巾的橘猫，坐在窗台上，午后阳光'

/** 步数档：6 步 Turbo（推荐，约快一倍） / 20 步 base。 */
const STEP_PRESETS = [6, 20] as const

export function ImageGenPanel() {
  const { t } = useTranslation()
  const mobile = isMobileRuntime()

  const [dev, setDev] = useState<ImageDeviceInfo | null>(null)
  // 默认给一个示例 prompt：最小可用版应「开箱即生成」，也让按钮默认可用
  // （曾因初值为空导致按钮静默禁用，而用户看到 placeholder 以为已填好，无从解释）。
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [ratio, setRatio] = useState<ImageRatioId>('1:1')
  const [tier, setTier] = useState<ImageSizeTier>('standard')
  const [steps, setSteps] = useState<number>(6)
  const [seed, setSeed] = useState<number>(42)
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')
  const [outPath, setOutPath] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')

  // 组件卸载 / 新任务开始时释放上一个 Blob URL，避免内存泄漏
  const previewRef = useRef('')
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    },
    [],
  )

  /** 拉模型目录（生成需要模型已就位；能力判定在管理面板做） */
  useEffect(() => {
    if (!mobile) return
    void invoke<ImageDeviceInfo>('ondevice_image_probe')
      .then(setDev)
      .catch(() => setDev(null))
  }, [mobile])

  const setPreview = useCallback((url: string) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = url
    setPreviewUrl(url)
  }, [])

  const size = imageSize(ratio, tier)

  const generate = useCallback(async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError('')
    setPercent(0)
    setPreview('')
    setOutPath('')
    const sessionId = `img-${Date.now().toString(36)}`
    try {
      const outputPng = await defaultImageOutputPath()
      setOutPath(outputPng)
      await generateImage(
        {
          prompt: prompt.trim(),
          width: size.width,
          height: size.height,
          steps,
          seed,
          outputPng,
        },
        setPercent,
        sessionId,
      )
      setPercent(100)
      // 读回展示（ scope：$APPCACHE/spiritpal-images/** ）
      setPreview(await readImageAsObjectUrl(outputPng))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, prompt, seed, size.height, size.width, setPreview, steps])

  const cancel = useCallback(async () => {
    // ⚠️ 只停止等待：后台推理仍会跑完当前任务（上游无中止通道）
    await cancelImage(`img-${Date.now().toString(36)}`).catch(() => {})
    setBusy(false)
  }, [])

  if (!mobile) {
    return (
      <section className="rounded-xl bg-cream-deep/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Wand2 size={16} className="text-tangerine-deep" />
          <h3 className="text-sm font-medium text-ink">{t('settings.image.gen.title')}</h3>
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">{t('settings.image.desktopOnly')}</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl bg-cream-deep/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Wand2 size={16} className="text-tangerine-deep" />
        <h3 className="text-sm font-medium text-ink">{t('settings.image.gen.title')}</h3>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-ink-muted">{t('settings.image.gen.desc')}</p>

      {/* prompt */}
      <label className="mb-1 block text-[11px] font-medium text-ink-muted" htmlFor="image-gen-prompt">
        {t('settings.image.gen.prompt')}
      </label>
      <textarea
        id="image-gen-prompt"
        className="mb-3 h-20 w-full resize-none rounded-lg border border-cream-deep bg-cream/60 p-2 text-xs text-ink outline-none focus:border-tangerine"
        value={prompt}
        maxLength={800}
        placeholder={t('settings.image.gen.promptPlaceholder')}
        aria-label={t('settings.image.gen.prompt')}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
      />

      {/* 比例 / 尺寸档 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          aria-label={t('settings.image.gen.ratio')}
          className="rounded-lg border border-cream-deep bg-cream/60 px-2 py-1 text-[11px] text-ink"
          value={ratio}
          disabled={busy}
          onChange={(e) => setRatio(e.target.value as ImageRatioId)}
        >
          {IMAGE_RATIOS.map((r) => (
            // ratio id（如 "1:1"）本身就是直观标签，且含冒号不适合做 i18n 键
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>
        <select
          aria-label={t('settings.image.gen.size')}
          className="rounded-lg border border-cream-deep bg-cream/60 px-2 py-1 text-[11px] text-ink"
          value={tier}
          disabled={busy}
          onChange={(e) => setTier(e.target.value as ImageSizeTier)}
        >
          {SIZE_TIERS.map((tt) => (
            <option key={tt} value={tt}>
              {t(`settings.image.gen.tier.${tt}`)}（{IMAGE_TIER_BASE_PX[tt]}px）
            </option>
          ))}
        </select>
        <span className="text-[10px] text-ink-faint" data-testid="image-gen-size">
          {size.width}×{size.height}
        </span>
      </div>

      {/* 步数 / seed */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          aria-label={t('settings.image.gen.steps')}
          className="rounded-lg border border-cream-deep bg-cream/60 px-2 py-1 text-[11px] text-ink"
          value={steps}
          disabled={busy}
          onChange={(e) => setSteps(Number(e.target.value))}
        >
          {STEP_PRESETS.map((s) => (
            <option key={s} value={s}>
              {s} {t('settings.image.gen.stepsUnit')}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-ink-muted" htmlFor="image-gen-seed">
          seed
          <input
            id="image-gen-seed"
            type="number"
            className="w-20 rounded-lg border border-cream-deep bg-cream/60 px-2 py-1 text-[11px] text-ink"
            value={seed}
            disabled={busy}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
          />
        </label>
        <BrandButton variant="ghost" disabled={busy} onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>
          {t('settings.image.gen.randomSeed')}
        </BrandButton>
      </div>

      {/* 操作区 */}
      <div className="mb-3 flex items-center gap-2">
        <BrandButton
          onClick={() => void generate()}
          disabled={busy || !prompt.trim() || !dev}
          title={!prompt.trim() ? t('settings.image.gen.needPrompt') : undefined}
        >
          {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Sparkles size={14} className="mr-1" />}
          {busy ? t('settings.image.gen.generating') : t('settings.image.gen.generate')}
        </BrandButton>
        {busy && (
          <BrandButton variant="ghost" onClick={() => void cancel()}>
            {t('settings.image.gen.cancel')}
          </BrandButton>
        )}
      </div>

      {/* 进度 */}
      {busy && (
        <div className="mb-3" data-testid="image-gen-progress">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream-deep">
            <div className="h-full rounded-full bg-tangerine transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-[10px] text-ink-faint">{percent}%</p>
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-error/15 p-3 text-xs text-error">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* 结果 */}
      {previewUrl && (
        <div className="mb-2" data-testid="image-gen-result">
          <img
            src={previewUrl}
            alt={t('settings.image.gen.resultAlt')}
            className="w-full rounded-lg border border-cream-deep"
          />
          <p className="mt-1 break-all text-[10px] text-ink-faint">{outPath}</p>
        </div>
      )}

      <p className="text-[10px] leading-4 text-ink-faint">{t('settings.image.gen.footnote')}</p>
    </section>
  )
}

export default ImageGenPanel

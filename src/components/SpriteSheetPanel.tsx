/**
 * 精灵图工具面板组件
 *
 * 功能概述：
 * - 上传GIF/视频/图片文件
 * - 配置精灵图参数（行列数、帧尺寸、帧率、间距、背景色）
 * - 帧提取进度显示
 * - 预览提取的帧缩略图
 * - 生成精灵图集PNG + 元数据JSON
 * - 下载导出精灵图和配置文件
 * - PRD Phase 4: F4.9-2 GIF/视频转精灵图工具
 *
 * 核心Hooks/状态：
 * - useState: 精灵图配置、文件、文件类型、处理阶段、进度、帧数据、结果、错误
 * - useRef: 文件输入引用
 * - useCallback: 帧提取函数
 *
 * 使用模块：
 * - spriteSheetTool: 帧提取、精灵图生成、下载工具函数
 */
import { useState, useRef, useCallback } from 'react'
import {
  Upload, Film, Image as ImageIcon, Download,
  Loader2, Grid3x3, Settings2, AlertCircle, Check, Layers,
} from 'lucide-react'
import {
  extractFrames, extractFramesFromImage, generateSpriteSheet,
  downloadSpriteSheet, DEFAULT_CONFIG,
  type SpriteSheetConfig, type SpriteSheetResult,
} from '../lib/spriteSheetTool'
import { validateUploadMagic } from '../lib/uploadMagic'

type Stage = 'idle' | 'extracting' | 'ready' | 'done'

/**
 * 精灵图制作工具面板
 *
 * 提供GIF/视频/图片转精灵图集的完整工具流程。
 */
export function SpriteSheetPanel() {
  const [config, setConfig] = useState<SpriteSheetConfig>(DEFAULT_CONFIG)
  const [file, setFile] = useState<File | null>(null)
  const [fileType, setFileType] = useState<'video' | 'image' | 'gif' | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [frames, setFrames] = useState<HTMLCanvasElement[]>([])
  const [result, setResult] = useState<SpriteSheetResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outputName, setOutputName] = useState('pet-sprite')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function flashError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  // 判断文件类型
  function detectFileType(file: File): 'video' | 'image' | 'gif' {
    if (file.type.startsWith('video/')) return 'video'
    if (file.type === 'image/gif') return 'gif'
    return 'image'
  }

  // 处理文件选择
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return

    // [SECURITY] 魔数校验：叠加 Rust 端纵深防御，阻断伪装媒体文件（未知扩展名跳过）
    const magicError = await validateUploadMagic(f)
    if (magicError) {
      flashError(magicError)
      e.target.value = ''
      return
    }

    const ftype = detectFileType(f)
    setFile(f)
    setFileType(ftype)
    setStage('idle')
    setFrames([])
    setResult(null)
    setProgress(0)

    // 自动填充输出名称（基于文件名）
    const baseName = f.name.replace(/\.[^.]+$/, '')
    setOutputName(baseName || 'pet-sprite')

    e.target.value = ''
  }

  // 提取帧
  const handleExtract = useCallback(async () => {
    if (!file || !fileType) return

    setStage('extracting')
    setProgress(0)
    setError(null)
    setFrames([])
    setResult(null)

    try {
      let extracted: HTMLCanvasElement[]

      if (fileType === 'video' || fileType === 'gif') {
        // GIF 在浏览器中也可作为视频处理（部分浏览器支持）
        // 对于 GIF，如果视频方式失败则退回图片方式
        try {
          extracted = await extractFrames(file, config, (p) => setProgress(p))
        } catch {
          // GIF 作为视频处理失败，尝试作为图片处理
          extracted = await extractFramesFromImage(file, config)
        }
      } else {
        extracted = await extractFramesFromImage(file, config)
      }

      if (extracted.length === 0) {
        flashError('未能从文件中提取到帧')
        setStage('idle')
        return
      }

      setFrames(extracted)
      setStage('ready')
    } catch (err) {
      flashError(`帧提取失败：${err instanceof Error ? err.message : '未知错误'}`)
      setStage('idle')
    }
  }, [file, fileType, config])

  // 生成精灵图
  function handleGenerate() {
    if (frames.length === 0) return

    const res = generateSpriteSheet(frames, config)
    setResult(res)
    setStage('done')
  }

  // 下载
  function handleDownload() {
    if (!result) return
    downloadSpriteSheet(result, outputName || 'pet-sprite')
  }

  // 重置
  function handleReset() {
    setFile(null)
    setFileType(null)
    setStage('idle')
    setFrames([])
    setResult(null)
    setProgress(0)
    setError(null)
  }

  // 更新配置
  function updateConfig(key: keyof SpriteSheetConfig, value: number) {
    setConfig((prev) => ({ ...prev, [key]: value }))
    // 配置变化后清除已有结果
    if (stage === 'done') {
      setResult(null)
      setStage('ready')
    }
  }

  const totalSlots = config.rows * config.cols

  return (
    <div className="space-y-5">
      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* 文件上传区 */}
      {stage === 'idle' && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink/15 bg-surface/30 p-10 text-center transition-colors hover:border-amber-400 hover:bg-amber-400/5"
        >
          <Upload size={40} className="mb-3 text-ink-muted" />
          <div className="text-sm text-ink">点击选择文件</div>
          <div className="mt-1 text-xs text-ink-muted">
            支持 GIF / MP4 / WebM / PNG / JPG
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,image/gif,image/png,image/jpeg,image/webp"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {/* 文件信息 + 配置区 */}
      {file && stage !== 'idle' && (
        <>
          {/* 文件信息条 */}
          <div className="flex items-center justify-between rounded-lg bg-surface/50 px-3 py-2">
            <div className="flex items-center gap-2">
              {fileType === 'video' ? <Film size={16} className="text-blue-300" /> : <ImageIcon size={16} className="text-green-300" />}
              <span className="text-xs text-ink">{file.name}</span>
              <span className="text-[10px] text-ink-muted">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
            <button
              onClick={handleReset}
              className="text-xs text-ink-muted hover:text-amber-300"
            >
              重新选择
            </button>
          </div>

          {/* 配置参数 */}
          {stage !== 'extracting' && (
            <div className="rounded-xl bg-surface/30 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-ink-muted">
                <Settings2 size={14} /> 精灵图参数
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <ConfigInput
                  label="行数"
                  value={config.rows}
                  min={1}
                  max={32}
                  onChange={(v) => updateConfig('rows', v)}
                />
                <ConfigInput
                  label="列数"
                  value={config.cols}
                  min={1}
                  max={32}
                  onChange={(v) => updateConfig('cols', v)}
                />
                <ConfigInput
                  label="帧宽 (px)"
                  value={config.frameWidth}
                  min={16}
                  max={512}
                  onChange={(v) => updateConfig('frameWidth', v)}
                />
                <ConfigInput
                  label="帧高 (px)"
                  value={config.frameHeight}
                  min={16}
                  max={512}
                  onChange={(v) => updateConfig('frameHeight', v)}
                />
                <ConfigInput
                  label="帧率 (fps)"
                  value={config.fps}
                  min={1}
                  max={60}
                  onChange={(v) => updateConfig('fps', v)}
                />
                <div className="flex flex-col">
                  <label className="mb-1 text-[10px] text-ink-muted">总槽位</label>
                  <div className="flex h-9 items-center rounded-lg bg-surface px-3 text-sm text-amber-300">
                    {totalSlots}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-[10px] text-ink-muted">
                输出图尺寸：{config.cols * config.frameWidth} × {config.rows * config.frameHeight} px
              </div>
            </div>
          )}

          {/* 提取中 */}
          {stage === 'extracting' && (
            <div className="flex flex-col items-center py-8">
              <Loader2 size={32} className="mb-3 animate-spin text-amber-400" />
              <div className="text-sm text-ink">正在提取帧...</div>
              <div className="mt-2 h-2 w-48 overflow-hidden rounded-full bg-cream-deep">
                <div
                  className="h-full rounded-full bg-amber-400 transition-all"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-ink-muted">
                {Math.round(progress * 100)}%
              </div>
            </div>
          )}

          {/* 帧预览 */}
          {stage === 'ready' && frames.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <Grid3x3 size={14} />
                  已提取 {frames.length} 帧
                  {frames.length > totalSlots && (
                    <span className="text-amber-400">
                      （超出 {totalSlots} 槽位，仅取前 {totalSlots} 帧）
                    </span>
                  )}
                </div>
                <button
                  onClick={handleExtract}
                  className="text-xs text-ink-muted hover:text-amber-300"
                >
                  重新提取
                </button>
              </div>

              {/* 帧缩略图网格 */}
              <div className="max-h-48 overflow-y-auto rounded-lg border border-ink/10 bg-surface/30 p-2">
                <div className="flex flex-wrap gap-1">
                  {frames.slice(0, totalSlots).map((frame, i) => (
                    <div
                      key={i}
                      className="relative overflow-hidden rounded border border-ink/5"
                      style={{ width: 48, height: 48 }}
                    >
                      <img
                        src={frame.toDataURL()}
                        alt={`frame-${i}`}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute bottom-0 right-0 bg-black/60 px-0.5 text-[8px] text-ink">
                        {i}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 生成按钮 */}
              <button
                onClick={handleGenerate}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-amber-400"
              >
                <Layers size={16} /> 生成精灵图集
              </button>
            </div>
          )}

          {/* 生成结果 */}
          {stage === 'done' && result && (
            <div className="space-y-4">
              {/* 成功提示 */}
              <div className="flex items-center gap-2 rounded-lg bg-green-900/30 px-3 py-2 text-xs text-green-300">
                <Check size={14} />
                精灵图生成成功！共 {result.frameCount} 帧，{result.metadata.rows} 行 × {result.metadata.cols} 列
              </div>

              {/* 预览 */}
              <div className="rounded-xl border border-ink/10 bg-surface/30 p-4">
                <div className="mb-2 text-xs text-ink-muted">精灵图预览</div>
                <div className="overflow-auto rounded-lg bg-cream-deep/50 p-2">
                  <img
                    src={result.dataUrl}
                    alt="sprite-sheet"
                    className="max-w-full"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
                <div className="mt-2 text-[10px] text-ink-muted">
                  尺寸：{config.cols * config.frameWidth} × {config.rows * config.frameHeight} px
                </div>
              </div>

              {/* 元数据 JSON */}
              <div className="rounded-xl border border-ink/10 bg-surface/30 p-4">
                <div className="mb-2 text-xs text-ink-muted">元数据 JSON</div>
                <pre className="max-h-40 overflow-auto rounded-lg bg-cream-deep p-3 text-[11px] text-green-300">
                  {JSON.stringify(result.metadata, null, 2)}
                </pre>
              </div>

              {/* 输出名称 + 下载 */}
              <div className="flex gap-2">
                <input
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  placeholder="输出文件名"
                  className="flex-1 rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
                >
                  <Download size={16} /> 下载
                </button>
              </div>

              <button
                onClick={handleReset}
                className="w-full rounded-lg bg-cream-deep px-4 py-2 text-sm text-ink hover:bg-blush-soft"
              >
                制作新的精灵图
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ============ 配置输入子组件 ============
function ConfigInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col">
      <label className="mb-1 text-[10px] text-ink-muted">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseInt(e.target.value) || min
          onChange(Math.max(min, Math.min(max, v)))
        }}
        className="h-9 rounded-lg bg-surface px-3 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
      />
    </div>
  )
}

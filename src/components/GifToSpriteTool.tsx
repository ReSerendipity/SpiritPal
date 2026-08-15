/**
 * GIF转精灵图工具组件
 *
 * 功能概述：
 * - 使用gifuct-js库解析GIF逐帧像素数据
 * - 支持拖拽上传和点击选择文件
 * - 网格布局配置：行列数、帧宽高、帧间距
 * - 背景设置：透明背景或自定义背景色
 * - 帧率配置和动画行名称自定义
 * - PNG精灵图集导出和act_conf.json配置生成
 * - 帧预览缩略图和生成结果预览
 * - 支持非GIF静态图片作为单帧处理
 *
 * 核心Hooks/状态：
 * - useState: 精灵图配置、文件、处理阶段、帧数据、输出结果、错误信息
 * - useRef: 文件输入引用
 * - useCallback: GIF帧解析函数
 * - useEffect: 帧数变化时同步动画名称数组
 */
import { useState, useRef, useCallback } from 'react'
import {
  X, Upload, Download, Loader2, Grid3x3, Film, Image as ImageIcon,
  AlertCircle, Check, FileJson, Settings2, Layers,
} from 'lucide-react'
import { parseGIF, decompressFrames } from 'gifuct-js'
import type { ParsedGif, ParsedFrame } from 'gifuct-js'
import { validateUploadMagic } from '../lib/uploadMagic'

// ============ 配置类型 ============
/** 精灵图配置 */
interface SpriteConfig {
  /** 网格行数 */
  rows: number
  /** 网格列数 */
  cols: number
  /** 单帧宽度 */
  frameWidth: number
  /** 单帧高度 */
  frameHeight: number
  /** 帧间距（px） */
  spacing: number
  /** 背景色（透明色复选框关闭时生效） */
  bgColor: string
  /** 是否透明背景 */
  transparent: boolean
  /** 帧率 */
  fps: number
}

// ============ act_conf.json 结构 ============
/** 动画条目 */
interface AnimEntry {
  /** 动画名称 */
  name: string
  /** 所在行号 */
  row: number
  /** 帧数 */
  frames: number
  /** 帧率 */
  fps: number
}

/** act_conf.json配置结构 */
interface ActConf {
  /** 单帧宽度 */
  frameWidth: number
  /** 单帧高度 */
  frameHeight: number
  /** 列数 */
  cols: number
  /** 行数 */
  rows: number
  /** 总帧数 */
  totalFrames: number
  /** 帧间距 */
  spacing: number
  /** 是否透明 */
  transparent: boolean
  /** 动画列表 */
  animations: AnimEntry[]
}

const DEFAULT_CONFIG: SpriteConfig = {
  rows: 4,
  cols: 8,
  frameWidth: 128,
  frameHeight: 128,
  spacing: 0,
  bgColor: '#ffffff',
  transparent: true,
  fps: 10,
}

type Stage = 'idle' | 'parsing' | 'ready' | 'done'

/** 组件Props接口 */
interface Props {
  /** 关闭工具回调 */
  onClose: () => void
}

/**
 * GIF转精灵图工具
 *
 * 提供完整的GIF精灵图制作流程：文件上传→帧解析→网格配置→生成导出。
 */
export function GifToSpriteTool({ onClose }: Props) {
  const [config, setConfig] = useState<SpriteConfig>(DEFAULT_CONFIG)
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [frames, setFrames] = useState<HTMLCanvasElement[]>([])
  const [spriteDataUrl, setSpriteDataUrl] = useState<string | null>(null)
  const [actConf, setActConf] = useState<ActConf | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  // 动画行名称（用户可编辑，用于 act_conf.json）
  const [animNames, setAnimNames] = useState<string[]>(['idle', 'walk', 'run', 'jump'])
  const [outputName, setOutputName] = useState('pet-sprite')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function flashError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }

  // ============ 核心：解析 GIF 并提取完整帧 ============
  // GIF 帧通常是增量更新的（只包含变化部分），需要合成完整帧
  const parseGifToFrames = useCallback(async (gifFile: File): Promise<HTMLCanvasElement[]> => {
    const buffer = await gifFile.arrayBuffer()
    const parsed: ParsedGif = parseGIF(buffer)
    const parsedFrames: ParsedFrame[] = decompressFrames(parsed, true)

    if (parsedFrames.length === 0) {
      throw new Error('GIF 中未找到任何帧')
    }

    const gifW = parsed.lsd.width
    const gifH = parsed.lsd.height

    // 全尺寸 GIF 合成画布
    const gifCanvas = document.createElement('canvas')
    gifCanvas.width = gifW
    gifCanvas.height = gifH
    const gifCtx = gifCanvas.getContext('2d')!

    // 临时画布（绘制单帧 patch）
    const tempCanvas = document.createElement('canvas')
    const tempCtx = tempCanvas.getContext('2d')!

    const result: HTMLCanvasElement[] = []
    let frameImageData: ImageData | null = null

    for (let i = 0; i < parsedFrames.length; i++) {
      const frame = parsedFrames[i]
      const dims = frame.dims

      // 处理 disposal：上一帧 disposalType === 2 时清除上一帧区域
      if (i > 0) {
        const prev = parsedFrames[i - 1]
        if (prev.disposalType === 2) {
          gifCtx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height)
        }
      }

      // 将 patch 数据写入临时画布
      if (!frameImageData || frameImageData.width !== dims.width || frameImageData.height !== dims.height) {
        tempCanvas.width = dims.width
        tempCanvas.height = dims.height
        frameImageData = tempCtx.createImageData(dims.width, dims.height)
      }
      frameImageData.data.set(frame.patch)
      tempCtx.putImageData(frameImageData, 0, 0)

      // 将临时画布绘制到全尺寸 GIF 画布的指定位置
      gifCtx.drawImage(tempCanvas, dims.left, dims.top)

      // 复制当前完整帧到独立画布
      const frameCanvas = document.createElement('canvas')
      frameCanvas.width = config.frameWidth
      frameCanvas.height = config.frameHeight
      const fCtx = frameCanvas.getContext('2d')!
      if (!config.transparent) {
        fCtx.fillStyle = config.bgColor
        fCtx.fillRect(0, 0, config.frameWidth, config.frameHeight)
      }
      // 等比缩放 GIF 完整画面到帧尺寸（居中裁剪）
      const scale = Math.max(config.frameWidth / gifW, config.frameHeight / gifH)
      const dw = gifW * scale
      const dh = gifH * scale
      const dx = (config.frameWidth - dw) / 2
      const dy = (config.frameHeight - dh) / 2
      fCtx.drawImage(gifCanvas, dx, dy, dw, dh)
      result.push(frameCanvas)
    }

    return result
  }, [config.frameWidth, config.frameHeight, config.bgColor, config.transparent])

  // ============ 处理文件选择 ============
  async function handleFile(gifFile: File) {
    if (!gifFile.type.startsWith('image/')) {
      flashError('请选择图片文件')
      return
    }
    // [SECURITY] 魔数校验：TS 端类型检查之上叠加 Rust 端魔数校验（纵深防御），阻断伪装图片
    const magicError = await validateUploadMagic(gifFile)
    if (magicError) {
      flashError(magicError)
      return
    }
    // 优先支持 GIF，但也可尝试普通图片
    setFile(gifFile)
    setStage('parsing')
    setError(null)
    setFrames([])
    setSpriteDataUrl(null)
    setActConf(null)
    const baseName = gifFile.name.replace(/\.[^.]+$/, '')
    setOutputName(baseName || 'pet-sprite')

    try {
      let extracted: HTMLCanvasElement[]
      if (gifFile.type === 'image/gif') {
        extracted = await parseGifToFrames(gifFile)
      } else {
        // 非 GIF 图片，作为单帧处理
        extracted = await extractSingleImage(gifFile)
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
  }

  // 非 GIF 图片作为单帧
  async function extractSingleImage(imgFile: File): Promise<HTMLCanvasElement[]> {
    const img = new Image()
    const url = URL.createObjectURL(imgFile)
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = config.frameWidth
    canvas.height = config.frameHeight
    const ctx = canvas.getContext('2d')!
    if (!config.transparent) {
      ctx.fillStyle = config.bgColor
      ctx.fillRect(0, 0, config.frameWidth, config.frameHeight)
    }
    const scale = Math.max(config.frameWidth / img.width, config.frameHeight / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    const dx = (config.frameWidth - dw) / 2
    const dy = (config.frameHeight - dh) / 2
    ctx.drawImage(img, dx, dy, dw, dh)
    URL.revokeObjectURL(url)
    return [canvas]
  }

  // ============ 拖拽 ============
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void handleFile(f)
  }

  // ============ 生成精灵图集 ============
  function handleGenerate() {
    if (frames.length === 0) return
    const { rows, cols, frameWidth, frameHeight, spacing, transparent, bgColor, fps } = config
    const totalSlots = rows * cols
    const useFrames = frames.slice(0, totalSlots)

    const canvas = document.createElement('canvas')
    canvas.width = cols * frameWidth + (cols - 1) * spacing
    canvas.height = rows * frameHeight + (rows - 1) * spacing
    const ctx = canvas.getContext('2d')!

    if (!transparent) {
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }

    useFrames.forEach((frame, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = col * (frameWidth + spacing)
      const y = row * (frameHeight + spacing)
      ctx.drawImage(frame, x, y, frameWidth, frameHeight)
    })

    const dataUrl = canvas.toDataURL(transparent ? 'image/png' : 'image/png')
    setSpriteDataUrl(dataUrl)

    // 生成 act_conf.json
    const animations: AnimEntry[] = []
    const usedRows = Math.ceil(useFrames.length / cols)
    for (let r = 0; r < Math.max(usedRows, animNames.length); r++) {
      const framesInRow = Math.min(cols, useFrames.length - r * cols)
      if (framesInRow <= 0 && r >= usedRows) break
      const name = animNames[r] || `anim-${r}`
      animations.push({
        name,
        row: r,
        frames: Math.max(0, framesInRow),
        fps,
      })
    }

    const conf: ActConf = {
      frameWidth,
      frameHeight,
      cols,
      rows,
      totalFrames: useFrames.length,
      spacing,
      transparent,
      animations: animations.filter((a) => a.frames > 0),
    }
    setActConf(conf)
    setStage('done')
  }

  // ============ 下载 ============
  function handleDownload() {
    if (!spriteDataUrl || !actConf) return
    // 下载 PNG
    const a = document.createElement('a')
    a.href = spriteDataUrl
    a.download = `${outputName}-spritesheet.png`
    a.click()

    // 下载 act_conf.json
    const json = JSON.stringify(actConf, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const b = document.createElement('a')
    b.href = url
    b.download = `${outputName}-act_conf.json`
    b.click()
    URL.revokeObjectURL(url)
  }

  function handleReset() {
    setFile(null)
    setStage('idle')
    setFrames([])
    setSpriteDataUrl(null)
    setActConf(null)
    setError(null)
  }

  function updateConfig<K extends keyof SpriteConfig>(key: K, value: SpriteConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }))
    if (stage === 'done') {
      setSpriteDataUrl(null)
      setActConf(null)
      setStage('ready')
    }
  }

  // 帧数变化时同步动画名称数组（渲染期调整状态：仅当行数变化时执行）
  const usedRows = Math.ceil(frames.length / config.cols)
  const [prevRows, setPrevRows] = useState(usedRows)
  if (prevRows !== usedRows) {
    setPrevRows(usedRows)
    setAnimNames((prev) => {
      const next = [...prev]
      while (next.length < usedRows) {
        next.push(`anim-${next.length}`)
      }
      return next.slice(0, Math.max(usedRows, next.length))
    })
  }

  const totalSlots = config.rows * config.cols

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex h-[90vh] w-[860px] max-w-[95vw] flex-col rounded-2xl bg-gray-900 text-white shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-2">
            <Film size={18} className="text-amber-400" />
            <h2 className="text-base font-semibold">GIF 转精灵图工具</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-white/10" title="关闭">
            <X size={18} />
          </button>
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* 上传区 */}
          {stage === 'idle' && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
                isDragging
                  ? 'border-amber-400 bg-amber-400/10'
                  : 'border-white/15 bg-gray-800/30 hover:border-amber-400 hover:bg-amber-400/5'
              }`}
            >
              <Upload size={44} className="mb-3 text-gray-500" />
              <div className="text-sm text-gray-300">点击选择 GIF 文件，或拖拽到此区域</div>
              <div className="mt-1 text-xs text-gray-500">支持 GIF 动图（逐帧解析）和 PNG/JPG 静态图</div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/gif,image/png,image/jpeg,image/webp"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = '' }}
                className="hidden"
              />
            </div>
          )}

          {/* 解析中 */}
          {stage === 'parsing' && (
            <div className="flex flex-col items-center py-12">
              <Loader2 size={36} className="mb-3 animate-spin text-amber-400" />
              <div className="text-sm text-gray-300">正在解析 GIF 帧数据...</div>
            </div>
          )}

          {/* 文件信息 + 配置 */}
          {file && stage !== 'idle' && stage !== 'parsing' && (
            <>
              {/* 文件信息条 */}
              <div className="mb-4 flex items-center justify-between rounded-lg bg-gray-800/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <ImageIcon size={16} className="text-green-300" />
                  <span className="text-xs text-gray-300">{file.name}</span>
                  <span className="text-[10px] text-gray-500">{(file.size / 1024).toFixed(1)} KB</span>
                </div>
                <button onClick={handleReset} className="text-xs text-gray-400 hover:text-amber-300">重新选择</button>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {/* 左列：配置 */}
                <div className="space-y-4">
                  {/* 网格配置 */}
                  <div className="rounded-xl bg-gray-800/50 p-4">
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-amber-300">
                      <Settings2 size={14} /> 网格布局配置
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                      <ConfigInput label="行数" value={config.rows} min={1} max={32} onChange={(v) => updateConfig('rows', v)} />
                      <ConfigInput label="列数" value={config.cols} min={1} max={32} onChange={(v) => updateConfig('cols', v)} />
                      <ConfigInput label="帧宽 (px)" value={config.frameWidth} min={16} max={512} onChange={(v) => updateConfig('frameWidth', v)} />
                      <ConfigInput label="帧高 (px)" value={config.frameHeight} min={16} max={512} onChange={(v) => updateConfig('frameHeight', v)} />
                      <ConfigInput label="间距 (px)" value={config.spacing} min={0} max={32} onChange={(v) => updateConfig('spacing', v)} />
                      <ConfigInput label="帧率 (fps)" value={config.fps} min={1} max={60} onChange={(v) => updateConfig('fps', v)} />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">总槽位 {totalSlots} · 输出 {config.cols * config.frameWidth + (config.cols - 1) * config.spacing}×{config.rows * config.frameHeight + (config.rows - 1) * config.spacing}px</span>
                    </div>
                  </div>

                  {/* 背景配置 */}
                  <div className="rounded-xl bg-gray-800/50 p-4">
                    <div className="mb-3 text-xs font-semibold text-amber-300">背景设置</div>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={config.transparent}
                          onChange={(e) => updateConfig('transparent', e.target.checked)}
                          className="accent-amber-400"
                        />
                        透明背景（导出 PNG 带 alpha 通道）
                      </label>
                      {!config.transparent && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">背景色</span>
                          <input
                            type="color"
                            value={config.bgColor}
                            onChange={(e) => updateConfig('bgColor', e.target.value)}
                            className="h-8 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
                          />
                          <span className="text-xs text-gray-500">{config.bgColor}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 动画行名称配置 */}
                  {frames.length > 0 && (
                    <div className="rounded-xl bg-gray-800/50 p-4">
                      <div className="mb-2 text-xs font-semibold text-amber-300">动画行名称（用于 act_conf.json）</div>
                      <div className="space-y-1.5">
                        {animNames.map((name, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="w-8 text-[10px] text-gray-500">行{idx}</span>
                            <input
                              value={name}
                              onChange={(e) => {
                                const next = [...animNames]
                                next[idx] = e.target.value
                                setAnimNames(next)
                              }}
                              className="flex-1 rounded bg-gray-800 px-2 py-1 text-xs"
                            />
                            <span className="text-[9px] text-gray-500">
                              {Math.min(config.cols, Math.max(0, frames.length - idx * config.cols))} 帧
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 生成按钮 */}
                  {stage === 'ready' && (
                    <button
                      onClick={handleGenerate}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-amber-400"
                    >
                      <Layers size={16} /> 生成精灵图集
                    </button>
                  )}
                </div>

                {/* 右列：帧预览 */}
                <div className="space-y-4">
                  {frames.length > 0 && (
                    <div className="rounded-xl bg-gray-800/50 p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
                        <Grid3x3 size={14} />
                        已提取 {frames.length} 帧
                        {frames.length > totalSlots && (
                          <span className="text-amber-400">（仅取前 {totalSlots} 帧）</span>
                        )}
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-gray-900/50 p-2">
                        <div className="flex flex-wrap gap-1">
                          {frames.slice(0, totalSlots).map((frame, i) => (
                            <div
                              key={i}
                              className="relative overflow-hidden rounded border border-white/5"
                              style={{ width: 48, height: 48 }}
                            >
                              <img src={frame.toDataURL()} alt={`f${i}`} className="h-full w-full object-cover" />
                              <span className="absolute bottom-0 right-0 bg-black/60 px-0.5 text-[8px] text-gray-300">{i}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 生成结果 */}
                  {stage === 'done' && spriteDataUrl && actConf && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 rounded-lg bg-green-900/30 px-3 py-2 text-xs text-green-300">
                        <Check size={14} />
                        精灵图生成成功！共 {actConf.totalFrames} 帧，{actConf.rows} 行 × {actConf.cols} 列
                      </div>
                      <div className="rounded-xl border border-white/10 bg-gray-800/30 p-3">
                        <div className="mb-2 text-xs text-gray-400">精灵图预览</div>
                        <div className="overflow-auto rounded-lg bg-gray-900/50 p-2" style={{ maxHeight: '240px' }}>
                          <img
                            src={spriteDataUrl}
                            alt="sprite-sheet"
                            className="max-w-full"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-gray-800/30 p-3">
                        <div className="mb-2 flex items-center gap-1 text-xs text-gray-400">
                          <FileJson size={12} /> act_conf.json
                        </div>
                        <pre className="max-h-40 overflow-auto rounded-lg bg-gray-900 p-3 text-[10px] text-green-300">
                          {JSON.stringify(actConf, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 底部 */}
        {stage === 'done' && (
          <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
            <div className="flex items-center gap-2">
              <input
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                placeholder="输出文件名"
                className="w-48 rounded-lg bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <span className="text-[10px] text-gray-500">.png + -act_conf.json</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
              >
                重新制作
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
              >
                <Download size={16} /> 下载精灵图 + 配置
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============ 配置输入子组件 ============
/**
 * 数字配置输入组件
 * 带标签和数值范围限制的数字输入框
 */
function ConfigInput({
  label, value, min, max, onChange,
}: {
  /** 输入框标签 */
  label: string
  /** 当前值 */
  value: number
  /** 最小值 */
  min: number
  /** 最大值 */
  max: number
  /** 值变化回调 */
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col">
      <label className="mb-1 text-[10px] text-gray-400">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseInt(e.target.value) || min
          onChange(Math.max(min, Math.min(max, v)))
        }}
        className="h-9 rounded-lg bg-gray-800 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
      />
    </div>
  )
}

/**
 * 色度键（Chroma Key）兜底模块
 *
 * @fileoverview
 * 解决 Windows WebView2 在显示视频时丢弃 alpha 通道导致透明 webm 黑底的问题。
 *
 * 背景（参考 OC-Claw 技术学习报告 + 2026-08-26 运行时实测）：
 * - WebView2 的 canvas getImageData 能读到 VP9 alpha 平面（透明区 alpha≈14），
 *   但显示合成阶段丢弃 alpha → 用户看到的透明区域是黑色。
 * - 因此「canvas 能读到 alpha」不能作为「显示正常、无需色度键」的信号
 *   （旧逻辑 hasAlphaChannel→跳过检测 在 WebView2 上必然误判，黑底原样显示）。
 *
 * 本模块提供：
 * - applyChromaKey()：对 ImageData 执行近黑像素抠像（纯逻辑，可单测）
 * - applyAlphaKey()：按 alpha 阈值抠像（帧自带 alpha 时使用，纯逻辑）
 * - hasAlphaChannel()：检测图像是否自带 alpha 通道（纯逻辑）
 * - cornerNearBlackRatio()：统计四角近黑像素占比（纯逻辑）
 * - detectVideoChromaKeyNeed()：从 <video> 取帧综合判定是否需要色度键（DOM 桥接）
 *
 * 判定规则：
 * 1. 四角近黑占比 >= 30% → 需要色度键（背景在显示上是深色/黑色，WebView2 下必现黑底）
 * 2. 否则 → 不需要（背景非黑，透明显示正常，或白底素材留给后续适配）
 *
 * 抠像策略（drawChromaKeyFrame 逐帧选择）：
 * - 帧自带 alpha → 按 alpha 阈值（<192 置透明）：背景 alpha≈14 被抠，不透明身体保留，
 *   不会误伤黑色身体部分（alpha=255）
 * - 帧无 alpha（纯黑幕不透明视频）→ 近黑 RGB（<=12）抠像（OC-Claw 原始方案）
 *
 * @module chromaKey
 */

/** 近黑判定阈值：RGB 均 <= 12 视为背景黑（与 OC-Claw 一致） */
export const CHROMA_KEY_THRESHOLD = 12

/** 有 alpha 判定：透明像素占比超过 1% 视为自带 alpha 通道 */
export const CHROMA_KEY_ALPHA_RATIO = 0.01

/** 按 alpha 抠像的阈值：alpha < 该值视为背景透明区（WebView2 解码 VP9 alpha 时透明区约 0~100，身体约 220~255） */
export const CHROMA_KEY_ALPHA_THRESHOLD = 192

/** 需要色度键的边缘近黑占比阈值 */
export const CHROMA_KEY_MIN_EDGE_BLACK_RATIO = 0.3

/** 角块占画面比例（宽高各 10%） */
export const CHROMA_KEY_CORNER_RATIO = 0.1

/** 采样步长（每 N 个像素采样 1 个，加速检测） */
export const CHROMA_KEY_SAMPLE_STEP = 8

// ============ 纯逻辑（可单测，不依赖 DOM） ============

/** applyChromaKey 结果 */
export interface ChromaKeyResult {
  /** 抠像后的 ImageData（原地修改） */
  imageData: ImageData
  /** 被置为透明的像素数 */
  keyedPixels: number
}

/**
 * 对 ImageData 执行色度键抠像：RGB 均 <= threshold 的像素 alpha 置 0。
 * 原地修改 data 并返回统计结果。
 */
export function applyChromaKey(
  imageData: ImageData,
  threshold: number = CHROMA_KEY_THRESHOLD,
): ChromaKeyResult {
  const d = imageData.data
  let keyed = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] <= threshold && d[i + 1] <= threshold && d[i + 2] <= threshold) {
      d[i + 3] = 0
      keyed++
    }
  }
  return { imageData, keyedPixels: keyed }
}

/**
 * 对 ImageData 执行 alpha 通道抠像：alpha < alphaThreshold 的像素 alpha 置 0。
 * 用于帧自带 alpha 的素材（WebView2 解码出的 alpha 平面可用，但显示合成丢弃 alpha）。
 * 原地修改 data 并返回统计结果。
 */
export function applyAlphaKey(
  imageData: ImageData,
  alphaThreshold: number = CHROMA_KEY_ALPHA_THRESHOLD,
): ChromaKeyResult {
  const d = imageData.data
  let keyed = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < alphaThreshold) {
      d[i + 3] = 0
      keyed++
    }
  }
  return { imageData, keyedPixels: keyed }
}

/**
 * 检测图像是否自带 alpha 通道。
 * 采样（每 sampleStep 个像素取 1 个），透明像素占比 > alphaRatio 判定为有 alpha。
 */
export function hasAlphaChannel(
  imageData: ImageData,
  sampleStep: number = CHROMA_KEY_SAMPLE_STEP,
  alphaRatio: number = CHROMA_KEY_ALPHA_RATIO,
): boolean {
  const d = imageData.data
  let transparent = 0
  let total = 0
  for (let i = 3; i < d.length; i += 4 * sampleStep) {
    total++
    if (d[i] < 255) transparent++
  }
  if (total === 0) return false
  return transparent / total > alphaRatio
}

/**
 * 统计四角区域近黑像素的平均占比。
 * 四角各取 cornerRatio 比例的区域，返回四角占比的平均值（0-1）。
 * 角色主体通常在画面中心，背景在边缘——四角近黑是黑幕色度键素材的强信号。
 */
export function cornerNearBlackRatio(
  imageData: ImageData,
  threshold: number = CHROMA_KEY_THRESHOLD,
  cornerRatio: number = CHROMA_KEY_CORNER_RATIO,
  sampleStep: number = CHROMA_KEY_SAMPLE_STEP,
): number {
  const { width, height, data } = imageData
  if (width <= 0 || height <= 0) return 0

  const cw = Math.max(1, Math.floor(width * cornerRatio))
  const ch = Math.max(1, Math.floor(height * cornerRatio))
  // 四角区域：[x0, x1) × [y0, y1)
  const corners: Array<[number, number, number, number]> = [
    [0, 0, cw, ch],
    [width - cw, 0, width, ch],
    [0, height - ch, cw, height],
    [width - cw, height - ch, width, height],
  ]

  let sumRatio = 0
  for (const [x0, y0, x1, y1] of corners) {
    let black = 0
    let total = 0
    for (let y = y0; y < y1; y += sampleStep) {
      for (let x = x0; x < x1; x += sampleStep) {
        const idx = (y * width + x) * 4
        total++
        if (data[idx] <= threshold && data[idx + 1] <= threshold && data[idx + 2] <= threshold) {
          black++
        }
      }
    }
    if (total > 0) sumRatio += black / total
  }
  return sumRatio / corners.length
}

// ============ DOM 桥接（依赖 <video>/<canvas>） ============

/**
 * 从 <video> 取当前帧，判定是否需要色度键兜底。
 *
 * 判定：四角近黑占比 >= CHROMA_KEY_MIN_EDGE_BLACK_RATIO → true，否则 false。
 *
 * 注意：不做 hasAlphaChannel 短路。2026-08-26 运行时实测（WebView2）：
 * canvas getImageData 能读到 VP9 alpha 平面（透明区 alpha≈14），但显示合成
 * 丢弃 alpha → 黑底可见。「有 alpha」≠「显示正常」，因此仅依据显示层可观察的
 * 背景色（四角近黑）判定。
 *
 * 任何异常（跨域/安全策略导致 getImageData 失败）返回 false，保持原播放路径。
 */
export function detectVideoChromaKeyNeed(
  video: HTMLVideoElement,
  minEdgeBlackRatio: number = CHROMA_KEY_MIN_EDGE_BLACK_RATIO,
): boolean {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return false

  const canvas = document.createElement('canvas')
  canvas.width = vw
  canvas.height = vh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false

  try {
    ctx.drawImage(video, 0, 0, vw, vh)
    const imageData = ctx.getImageData(0, 0, vw, vh)
    return cornerNearBlackRatio(imageData) >= minEdgeBlackRatio
  } catch {
    // 跨域/安全限制等任何异常：不启用色度键，保持原有播放路径
    return false
  }
}

/**
 * 将一帧视频以色度键抠像后绘制到目标 canvas（contain 适配）。
 * 内部使用离屏 canvas 在视频原始分辨率上抠像，避免缩放插值破坏黑边判定。
 *
 * 抠像策略按帧内容选择：
 * - 帧自带 alpha → applyAlphaKey（按 alpha 阈值；WebView2 解码的 alpha 平面可用，
 *   背景 alpha≈14 被抠，不透明身体保留，不会误伤黑色身体部分）
 * - 帧无 alpha → applyChromaKey（近黑 RGB 抠像，OC-Claw 原始方案，兼容纯黑幕素材）
 *
 * @param ctx 目标 canvas 2D 上下文（显示层）
 * @param canvas 目标 canvas 元素
 * @param video 视频源（取当前帧）
 * @param offscreenRef 离屏 canvas 复用引用（避免重复分配）
 * @param threshold 近黑 RGB 抠像阈值（无 alpha 素材时使用）
 * @param alphaThreshold alpha 抠像阈值（自带 alpha 素材时使用）
 */
export function drawChromaKeyFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  offscreenRef: { current: HTMLCanvasElement | null },
  threshold: number = CHROMA_KEY_THRESHOLD,
  alphaThreshold: number = CHROMA_KEY_ALPHA_THRESHOLD,
): void {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return

  let off = offscreenRef.current
  if (!off) {
    off = document.createElement('canvas')
    offscreenRef.current = off
  }
  if (off.width !== vw || off.height !== vh) {
    off.width = vw
    off.height = vh
  }
  const octx = off.getContext('2d', { willReadFrequently: true })
  if (!octx) return

  try {
    octx.drawImage(video, 0, 0, vw, vh)
    const imageData = octx.getImageData(0, 0, vw, vh)
    if (hasAlphaChannel(imageData)) {
      applyAlphaKey(imageData, alphaThreshold)
    } else {
      applyChromaKey(imageData, threshold)
    }
    octx.putImageData(imageData, 0, 0)
  } catch {
    return // 抠像失败：跳过本帧，保持上一帧
  }

  // contain 适配绘制到显示 canvas
  const cw = canvas.width
  const ch = canvas.height
  ctx.clearRect(0, 0, cw, ch)
  const scale = Math.min(cw / vw, ch / vh)
  const dw = vw * scale
  const dh = vh * scale
  const dx = (cw - dw) / 2
  const dy = (ch - dh) / 2
  ctx.drawImage(off, dx, dy, dw, dh)
}

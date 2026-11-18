/**
 * @file frameChangeDetector.ts
 * @description 截屏帧变化检测 — 用 dHash 感知哈希先筛后送，避免近重复截图触发 VLM 分析
 *
 * 参考竞品：Miru sensor.py（30% 像素差 + 缩略图 + JPEG 质量 60，先筛后送）
 *
 * 设计：
 * - 把截图缩到 9×8 灰度，做水平相邻差分得到 64bit dHash（16 位十六进制）
 * - 汉明距离 ≤ 阈值视为“同一画面”，直接跳过 LLM 分析
 * - 解码/Canvas 不可用（Node、权限异常）时返回 null，调用方按“已变化”处理（保守策略）
 *
 * 依赖：浏览器 createImageBitmap + Canvas 2D；无 npm 依赖
 */

/** 哈希网格宽（比 8 多 1 列用于相邻差分） */
const HASH_WIDTH = 9
/** 哈希网格高 */
const HASH_HEIGHT = 8

/** 默认汉明距离阈值（64bit 中允许 6bit 抖动，容忍光标闪烁/抗锯齿） */
export const DEFAULT_SIMILARITY_THRESHOLD = 6

/**
 * 从 9×8 灰度数组计算 dHash
 * @param gray 灰度数组，长度必须为 72，按行优先排列
 * @returns 16 位十六进制哈希；入参长度不符时返回 null
 */
export function dHashFromGray(gray: Uint8Array | number[]): string | null {
  if (gray.length !== HASH_WIDTH * HASH_HEIGHT) return null

  let lo = 0
  let hi = 0
  let bitIndex = 0
  for (let y = 0; y < HASH_HEIGHT; y++) {
    for (let x = 0; x < HASH_WIDTH - 1; x++) {
      const left = gray[y * HASH_WIDTH + x]!
      const right = gray[y * HASH_WIDTH + x + 1]!
      if (left > right) {
        // JS 位运算按 32bit 截断，这里分高低两段累计，避免移位超过 31 位时回绕
        if (bitIndex < 32) lo |= 1 << bitIndex
        else hi |= 1 << (bitIndex - 32)
      }
      bitIndex++
    }
  }

  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0')
}

/**
 * 计算两个 16 位十六进制哈希的汉明距离
 * @returns 距离；任一哈希格式非法时返回 64（视为完全不同）
 */
export function hammingDistanceHex(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) return 64

  let distance = 0
  for (let i = 0; i < 16; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)
    // 半字节内 4bit 的 popcount
    distance += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1)
  }
  return distance
}

/**
 * 判断两帧是否近似重复
 * @param a 上一帧哈希
 * @param b 当前帧哈希
 * @param threshold 汉明距离阈值
 */
export function isNearDuplicate(a: string, b: string, threshold: number = DEFAULT_SIMILARITY_THRESHOLD): boolean {
  return hammingDistanceHex(a, b) <= threshold
}

/** 取得 9×8 绘制上下文（优先 OffscreenCanvas，退化到 DOM Canvas） */
function createHashContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(HASH_WIDTH, HASH_HEIGHT)
    return canvas.getContext('2d', { willReadFrequently: true })
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = HASH_WIDTH
    canvas.height = HASH_HEIGHT
    return canvas.getContext('2d', { willReadFrequently: true })
  }
  return null
}

/** 把 9×8 ImageData 转灰度数组 */
function toGray(data: Uint8ClampedArray): Uint8Array {
  const gray = new Uint8Array(HASH_WIDTH * HASH_HEIGHT)
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4]!
    const g = data[i * 4 + 1]!
    const b = data[i * 4 + 2]!
    // ITU-R BT.601 亮度权重
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }
  return gray
}

/**
 * 从图片 Data URL 计算 dHash
 * @param dataUrl 截图 Data URL（Rust take_screenshot 返回的 JPEG/PNG）
 * @returns 16 位十六进制哈希；解码失败或环境不支持 Canvas 时返回 null
 */
export async function computeFrameHash(dataUrl: string): Promise<string | null> {
  try {
    if (!dataUrl.startsWith('data:image/')) return null

    const ctx = createHashContext()
    if (!ctx) return null

    let source: CanvasImageSource | null = null
    if (typeof createImageBitmap === 'function') {
      const blob = await (await fetch(dataUrl)).blob()
      source = await createImageBitmap(blob)
    } else if (typeof Image !== 'undefined') {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('image decode failed'))
        el.src = dataUrl
      })
      source = img
    }
    if (!source) return null

    ctx.drawImage(source, 0, 0, HASH_WIDTH, HASH_HEIGHT)
    const imageData = ctx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT)
    return dHashFromGray(toGray(imageData.data))
  } catch {
    return null
  }
}

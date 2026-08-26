/**
 * chromaKey 色度键模块单元测试
 *
 * 纯逻辑部分（applyChromaKey / hasAlphaChannel / cornerNearBlackRatio）
 * 使用 duck-typed ImageData（仅访问 data/width/height），无需 DOM。
 */
import { describe, it, expect } from 'vitest'
import {
  applyChromaKey,
  applyAlphaKey,
  hasAlphaChannel,
  cornerNearBlackRatio,
  CHROMA_KEY_THRESHOLD,
  CHROMA_KEY_ALPHA_THRESHOLD,
  CHROMA_KEY_MIN_EDGE_BLACK_RATIO,
} from '../chromaKey'

/** 构造测试用 ImageData（duck-typed） */
function makeImageData(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { data, width, height } as unknown as ImageData
}

describe('applyChromaKey', () => {
  it('将 RGB 均 <= 阈值的近黑像素 alpha 置 0', () => {
    const img = makeImageData(2, 1, (x) => {
      if (x === 0) return [0, 0, 0, 255]   // 纯黑 → 抠掉
      return [255, 100, 50, 255]            // 彩色 → 保留
    })
    const { keyedPixels } = applyChromaKey(img)
    expect(keyedPixels).toBe(1)
    const d = img.data
    expect(d[3]).toBe(0)                    // 黑像素透明
    expect(d[7]).toBe(255)                  // 彩色像素保留
  })

  it('默认阈值 12：暗色非黑像素（如 8,8,8）也被视为背景', () => {
    const img = makeImageData(1, 1, () => [8, 8, 8, 255])
    applyChromaKey(img)
    expect(img.data[3]).toBe(0)
  })

  it('阈值生效：自定义 threshold 仅抠更黑的像素', () => {
    const img = makeImageData(1, 1, () => [10, 10, 10, 255])
    applyChromaKey(img, 5)
    expect(img.data[3]).toBe(255)           // 10 > 5，保留
    applyChromaKey(img, 12)
    expect(img.data[3]).toBe(0)             // 10 <= 12，抠掉
  })

  it('不影响 alpha 已为 0 的像素', () => {
    const img = makeImageData(1, 1, () => [0, 0, 0, 0])
    const { keyedPixels } = applyChromaKey(img)
    expect(keyedPixels).toBe(1)
    expect(img.data[3]).toBe(0)
  })

  it('CHROMA_KEY_THRESHOLD 与 OC-Claw 一致（12）', () => {
    expect(CHROMA_KEY_THRESHOLD).toBe(12)
  })
})

describe('applyAlphaKey', () => {
  it('alpha 低于阈值（背景 ≈14）→ 置透明', () => {
    const img = makeImageData(2, 1, (x) => (x === 0 ? [0, 0, 0, 14] : [18, 18, 18, 14]))
    const { keyedPixels } = applyAlphaKey(img)
    expect(keyedPixels).toBe(2)
    expect(img.data[3]).toBe(0)
    expect(img.data[7]).toBe(0)
  })

  it('不透明身体（alpha=255，含纯黑 RGB）→ 保留', () => {
    const img = makeImageData(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [160, 161, 153, 255]))
    const { keyedPixels } = applyAlphaKey(img)
    expect(keyedPixels).toBe(0)
    expect(img.data[3]).toBe(255)
    expect(img.data[7]).toBe(255)
  })

  it('阈值可自定义：alpha=100 低于 192 → 抠；alpha=200 高于 128 → 留', () => {
    const img = makeImageData(1, 1, () => [10, 10, 10, 100])
    applyAlphaKey(img, 192)
    expect(img.data[3]).toBe(0)
    const img2 = makeImageData(1, 1, () => [10, 10, 10, 200])
    applyAlphaKey(img2, 128)
    expect(img2.data[3]).toBe(200)
  })

  it('CHROMA_KEY_ALPHA_THRESHOLD = 192（实测 WebView2 解码：背景≈14 / 身体 220~255）', () => {
    expect(CHROMA_KEY_ALPHA_THRESHOLD).toBe(192)
  })
})

describe('hasAlphaChannel', () => {
  it('全不透明 → false', () => {
    const img = makeImageData(4, 4, () => [10, 20, 30, 255])
    expect(hasAlphaChannel(img)).toBe(false)
  })

  it('含透明像素（占比超过 1%）→ true', () => {
    const img = makeImageData(4, 4, (x) => (x === 0 ? [0, 0, 0, 0] : [10, 20, 30, 255]))
    expect(hasAlphaChannel(img)).toBe(true)
  })

  it('透明占比低于 alphaRatio（1/1250 ≈ 0.08%）→ false', () => {
    // 100x100 仅 (0,0) 透明；采样步长 8 共约 1250 个采样点，透明占比远低于 1%
    const img = makeImageData(100, 100, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 0] : [10, 20, 30, 255]))
    expect(hasAlphaChannel(img)).toBe(false)
  })
})

describe('cornerNearBlackRatio', () => {
  it('全黑画面 → 1', () => {
    const img = makeImageData(10, 10, () => [0, 0, 0, 255])
    expect(cornerNearBlackRatio(img)).toBe(1)
  })

  it('全白画面 → 0', () => {
    const img = makeImageData(10, 10, () => [255, 255, 255, 255])
    expect(cornerNearBlackRatio(img)).toBe(0)
  })

  it('仅左上角黑 → 四角平均 0.25', () => {
    // 10x10，cornerRatio 0.1 → 角块 1x1，即四个角像素
    const img = makeImageData(10, 10, (x, y) => {
      const isCorner = (x === 0 || x === 9) && (y === 0 || y === 9)
      const isTopLeft = x === 0 && y === 0
      if (isTopLeft) return [0, 0, 0, 255]
      void isCorner
      return [255, 255, 255, 255]
    })
    expect(cornerNearBlackRatio(img)).toBeCloseTo(0.25, 5)
  })

  it('中心角色 + 黑边背景 → 判定为需要色度键（>= 30%）', () => {
    // 20x20：四角 4x4 区域黑色，中心 12x12 白色（角色）
    const img = makeImageData(20, 20, (x, y) => {
      const inCorner = x < 4 || x >= 16 || y < 4 || y >= 16
      return inCorner ? [0, 0, 0, 255] : [255, 255, 255, 255]
    })
    const ratio = cornerNearBlackRatio(img)
    expect(ratio).toBeGreaterThanOrEqual(CHROMA_KEY_MIN_EDGE_BLACK_RATIO)
    expect(ratio).toBe(1) // 四角全是黑
  })
})

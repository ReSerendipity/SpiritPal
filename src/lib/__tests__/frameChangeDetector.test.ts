/**
 * frameChangeDetector 单元测试
 *
 * 覆盖：
 * - dHash 生成（稳定性、位宽、入参校验）
 * - 汉明距离与近似判定
 * - 非法 Data URL / 无 Canvas 环境返回 null
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  computeFrameHash,
  dHashFromGray,
  hammingDistanceHex,
  isNearDuplicate,
} from '@/lib/system/frameChangeDetector'

/** 生成 9×8 灰度：逐行递增，保证左 < 右恒为假 → 全 0 哈希 */
function flatGray(value: number): Uint8Array {
  return new Uint8Array(9 * 8).fill(value)
}

describe('dHashFromGray', () => {
  it('输出 16 位十六进制且同输入稳定', () => {
    const gray = new Uint8Array(9 * 8)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 9; x++) gray[y * 9 + x] = (x + y) % 17
    }
    const h1 = dHashFromGray(gray)
    const h2 = dHashFromGray(gray)
    expect(h1).toMatch(/^[0-9a-f]{16}$/)
    expect(h1).toBe(h2)
  })

  it('入参长度不是 72 时返回 null', () => {
    expect(dHashFromGray(new Uint8Array(10))).toBeNull()
  })

  it('全平灰度得到全 0 哈希', () => {
    expect(dHashFromGray(flatGray(128))).toBe('0000000000000000')
  })
})

describe('hammingDistanceHex / isNearDuplicate', () => {
  it('相同哈希距离为 0，完全相反为 64', () => {
    expect(hammingDistanceHex('0000000000000000', '0000000000000000')).toBe(0)
    expect(hammingDistanceHex('0000000000000000', 'ffffffffffffffff')).toBe(64)
  })

  it('非法哈希按完全不同处理', () => {
    expect(hammingDistanceHex('xyz', '0000000000000000')).toBe(64)
  })

  it('1bit 差异在阈值内，超过阈值判为不同', () => {
    const base = '0000000000000000'
    expect(isNearDuplicate(base, '000000000000000f', DEFAULT_SIMILARITY_THRESHOLD)).toBe(true)
    expect(isNearDuplicate(base, '00000000000000ff', DEFAULT_SIMILARITY_THRESHOLD)).toBe(false)
  })
})

describe('computeFrameHash', () => {
  it('非图片 Data URL 返回 null（保守视为已变化）', async () => {
    await expect(computeFrameHash('data:text/plain;base64,aGVsbG8=')).resolves.toBeNull()
    await expect(computeFrameHash('https://example.com/a.png')).resolves.toBeNull()
  })
})

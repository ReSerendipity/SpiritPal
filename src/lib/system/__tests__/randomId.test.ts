import { describe, it, expect, afterEach, vi } from 'vitest'
import { genId } from '../randomId'

afterEach(() => vi.restoreAllMocks())

describe('genId（CSPRNG 随机 ID）', () => {
  it('格式为 <13 位毫秒时间戳>-<12 位小写 hex>', () => {
    expect(genId()).toMatch(/^\d{13}-[0-9a-f]{12}$/)
  })

  it('时间戳前缀与当前时间一致（误差 1s 内）', () => {
    const before = Date.now()
    const [ts] = genId().split('-')
    const after = Date.now()
    expect(Number(ts)).toBeGreaterThanOrEqual(before)
    expect(Number(ts)).toBeLessThanOrEqual(after)
  })

  it('同一毫秒内批量生成不重复（1000 个）', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => genId()))
    expect(ids.size).toBe(1000)
  })

  it('走 crypto.getRandomValues 而非 Math.random（防回归到弱随机）', () => {
    const grv = vi.spyOn(crypto, 'getRandomValues')
    const mr = vi.spyOn(Math, 'random')
    genId()
    expect(grv).toHaveBeenCalledTimes(1)
    expect(mr).not.toHaveBeenCalled()
  })
})

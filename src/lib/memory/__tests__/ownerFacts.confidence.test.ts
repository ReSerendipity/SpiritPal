// P2-7：规则层抽取置信度按规则差异化（原先一刀切 0.6 → 统一显示 60%）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOwnerFactsManager } from '@/lib/memory/ownerFacts'

vi.mock('@/lib/data/db', () => ({
  getOwnerFacts: vi.fn(() => Promise.resolve([])),
  upsertOwnerFact: vi.fn(() => Promise.resolve()),
  deleteOwnerFact: vi.fn(() => Promise.resolve()),
  clearOwnerFacts: vi.fn(() => Promise.resolve()),
}))

describe('ownerFacts 规则层置信度差异化（P2-7）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('不同规则给出不同置信度：name 0.9 > location 0.85 > preference 0.7', async () => {
    const mgr = getOwnerFactsManager('doro-conf-check')
    await mgr.ensureLoaded()
    await mgr.extractAndSave('我叫小林，我住在杭州，我喜欢爬山')

    const facts = mgr.getAllFacts()
    const byKey = new Map(facts.map((f) => [f.key, f]))
    expect(byKey.get('name')?.confidence).toBe(0.9)
    expect(byKey.get('location')?.confidence).toBe(0.85)
    expect(byKey.get('preference')?.confidence).toBe(0.7)
    // 三条置信度互不相同（差异化而非一刀切）
    expect(new Set(facts.map((f) => f.confidence)).size).toBe(3)
  })

  it('用户显式提供（userProvided）置信度仍为 1.0', async () => {
    const mgr = getOwnerFactsManager('doro-conf-check-2')
    await mgr.ensureLoaded()
    await mgr.upsertFact('name', '小林', 0.9, true)
    expect(mgr.getAllFacts().find((f) => f.key === 'name')?.confidence).toBe(1.0)
  })
})

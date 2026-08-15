// characterConsistency 单元测试 — 性格类型推断、冲突关键词检测、修正 prompt 生成
import { describe, it, expect } from 'vitest'
import {
  inferArchetype,
  getCharacterArchetype,
  checkConsistency,
  generateCorrectionPrompt,
  ARCHETYPE_LABELS,
} from '../characterConsistency'
import type { Personality } from '../types'

function makePersonality(overrides: Partial<Personality> = {}): Personality {
  return {
    warmth: 0.5,
    liveliness: 0.5,
    dependence: 0.5,
    directness: 0.5,
    rationality: 0.5,
    ...overrides,
  }
}

describe('ARCHETYPE_LABELS', () => {
  it('包含 5 种性格类型标签', () => {
    expect(Object.keys(ARCHETYPE_LABELS)).toHaveLength(5)
    expect(ARCHETYPE_LABELS.soft).toBe('软萌')
    expect(ARCHETYPE_LABELS.energetic).toBe('元气')
    expect(ARCHETYPE_LABELS.sharp).toBe('毒舌')
    expect(ARCHETYPE_LABELS.intellectual).toBe('知性')
    expect(ARCHETYPE_LABELS.tsundere).toBe('傲娇')
  })
})

describe('inferArchetype', () => {
  it('高理性 + 低活泼 → 知性', () => {
    expect(
      inferArchetype(makePersonality({ rationality: 0.8, liveliness: -0.6 })),
    ).toBe('intellectual')
  })

  it('低温度 + 高直率 → 毒舌', () => {
    expect(
      inferArchetype(makePersonality({ warmth: 0.1, directness: 0.5 })),
    ).toBe('sharp')
  })

  it('低温度 + 高依赖 + 低直率 → 傲娇', () => {
    expect(
      inferArchetype(makePersonality({ warmth: 0.3, dependence: 0.5, directness: 0.1 })),
    ).toBe('tsundere')
  })

  it('高温度 + 低直率 → 软萌', () => {
    expect(
      inferArchetype(makePersonality({ warmth: 0.9, directness: -0.3 })),
    ).toBe('soft')
  })

  it('高活泼 + 中高温度 → 元气', () => {
    expect(
      inferArchetype(makePersonality({ liveliness: 0.8, warmth: 0.4 })),
    ).toBe('energetic')
  })

  it('默认分支：高温度 → 软萌', () => {
    // 不匹配任何特定条件，走默认 warmth>=0.5
    expect(
      inferArchetype(makePersonality({ warmth: 0.6, liveliness: 0.4, rationality: 0.4, directness: 0.2 })),
    ).toBe('soft')
  })

  it('默认分支：高活泼 → 元气', () => {
    expect(
      inferArchetype(makePersonality({ warmth: 0.4, liveliness: 0.6, rationality: 0.4, directness: 0.2 })),
    ).toBe('energetic')
  })

  it('默认分支：高理性 → 知性', () => {
    // warmth<0.5, liveliness<0.5, rationality>=0.5
    expect(
      inferArchetype(makePersonality({ warmth: 0.4, liveliness: 0.4, rationality: 0.6, directness: 0.2 })),
    ).toBe('intellectual')
  })

  it('默认分支：高直率 → 毒舌', () => {
    // warmth<0.5, liveliness<0.5, rationality<0.5, directness>=0.3
    expect(
      inferArchetype(makePersonality({ warmth: 0.4, liveliness: 0.4, rationality: 0.4, directness: 0.4 })),
    ).toBe('sharp')
  })

  it('默认分支：都不满足 → 傲娇', () => {
    // warmth<0.5, liveliness<0.5, rationality<0.5, directness<0.3
    expect(
      inferArchetype(makePersonality({ warmth: 0.4, liveliness: 0.4, rationality: 0.4, directness: 0.2 })),
    ).toBe('tsundere')
  })
})

describe('getCharacterArchetype', () => {
  it('doro → 软萌', () => {
    expect(getCharacterArchetype('doro')).toBe('soft')
  })

  it('feibi → 元气', () => {
    expect(getCharacterArchetype('feibi')).toBe('energetic')
  })

  it('未知角色 → 默认软萌', () => {
    expect(getCharacterArchetype('nonexistent')).toBe('soft')
  })
})

describe('checkConsistency', () => {
  it('软萌角色说脏话 → 不一致', () => {
    const result = checkConsistency('卧槽，今天真累', 'doro')
    expect(result.isConsistent).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations).toContain('卧槽')
  })

  it('软萌角色说冷漠语气词 → 不一致', () => {
    const result = checkConsistency('哦，随便吧', 'doro')
    expect(result.isConsistent).toBe(false)
    expect(result.violations).toContain('哦')
    expect(result.violations).toContain('随便')
  })

  it('软萌角色正常回复 → 一致', () => {
    const result = checkConsistency('主人主人，要不要来一个欧润吉？', 'doro')
    expect(result.isConsistent).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('元气角色说消沉词汇 → 不一致', () => {
    // feibi 是元气，冲突词含 '好累啊'
    const result = checkConsistency('好累啊，不想动了', 'feibi')
    expect(result.isConsistent).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('返回 violations 数组结构正确', () => {
    const result = checkConsistency('卧槽', 'doro')
    expect(Array.isArray(result.violations)).toBe(true)
    expect(typeof result.isConsistent).toBe('boolean')
  })
})

describe('generateCorrectionPrompt', () => {
  it('包含角色名和性格标签', () => {
    const prompt = generateCorrectionPrompt('doro', ['卧槽'])
    expect(prompt).toContain('多罗')
    expect(prompt).toContain('软萌')
  })

  it('包含冲突词汇列表', () => {
    const prompt = generateCorrectionPrompt('doro', ['卧槽', '随便'])
    expect(prompt).toContain('「卧槽」')
    expect(prompt).toContain('「随便」')
  })

  it('包含修正标识', () => {
    const prompt = generateCorrectionPrompt('doro', ['卧槽'])
    expect(prompt).toContain('角色一致性修正')
  })

  it('包含性格指导语', () => {
    const prompt = generateCorrectionPrompt('doro', ['卧槽'])
    expect(prompt).toContain('软萌角色')
    expect(prompt.length).toBeGreaterThan(50)
  })

  it('未知角色使用 characterId 作为名称', () => {
    const prompt = generateCorrectionPrompt('nonexistent', ['卧槽'])
    // 未知角色默认 soft，名称回退到 id
    expect(prompt).toContain('nonexistent')
  })
})

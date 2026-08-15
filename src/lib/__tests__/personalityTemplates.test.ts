// personalityTemplates 单元测试 — 5 种性格预设模板完整性
import { describe, it, expect } from 'vitest'
import { PERSONALITY_TEMPLATES, getTemplate } from '../personalityTemplates'

const EXPECTED_IDS = ['soft', 'energetic', 'poisonous', 'intellectual', 'tsundere']
const EXPECTED_NAMES = ['软萌', '元气', '毒舌', '知性', '傲娇']

describe('PERSONALITY_TEMPLATES', () => {
  it('包含 5 种预设模板', () => {
    expect(PERSONALITY_TEMPLATES).toHaveLength(5)
  })

  it('每个模板有完整的基础字段', () => {
    for (const tpl of PERSONALITY_TEMPLATES) {
      expect(typeof tpl.id).toBe('string')
      expect(tpl.id.length).toBeGreaterThan(0)
      expect(typeof tpl.name).toBe('string')
      expect(tpl.name.length).toBeGreaterThan(0)
      expect(typeof tpl.description).toBe('string')
      expect(typeof tpl.emoji).toBe('string')
      expect(tpl.config).toBeDefined()
    }
  })

  it('模板 id 唯一', () => {
    const ids = PERSONALITY_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('包含预期的 5 种 id', () => {
    const ids = PERSONALITY_TEMPLATES.map((t) => t.id)
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id)
    }
  })

  it('包含预期的 5 种名称', () => {
    const names = PERSONALITY_TEMPLATES.map((t) => t.name)
    for (const name of EXPECTED_NAMES) {
      expect(names).toContain(name)
    }
  })
})

describe('模板 config 完整性', () => {
  it('每个模板的 personality 五维参数齐全', () => {
    for (const tpl of PERSONALITY_TEMPLATES) {
      const p = tpl.config.personality
      expect(typeof p.warmth).toBe('number')
      expect(typeof p.liveliness).toBe('number')
      expect(typeof p.dependence).toBe('number')
      expect(typeof p.directness).toBe('number')
      expect(typeof p.rationality).toBe('number')
    }
  })

  it('每个模板有 systemPrompt（非空字符串）', () => {
    for (const tpl of PERSONALITY_TEMPLATES) {
      expect(typeof tpl.config.systemPrompt).toBe('string')
      expect(tpl.config.systemPrompt.length).toBeGreaterThan(20)
    }
  })

  it('每个模板有 speakingStyle 含 tone 和 catchphrases', () => {
    for (const tpl of PERSONALITY_TEMPLATES) {
      expect(tpl.config.speakingStyle).toBeDefined()
      expect(typeof tpl.config.speakingStyle.tone).toBe('string')
      expect(Array.isArray(tpl.config.speakingStyle.catchphrases)).toBe(true)
      expect(tpl.config.speakingStyle.catchphrases.length).toBeGreaterThan(0)
    }
  })

  it('每个模板有 interactionPrefs', () => {
    for (const tpl of PERSONALITY_TEMPLATES) {
      expect(typeof tpl.config.interactionPrefs.likeHeadPat).toBe('boolean')
      expect(typeof tpl.config.interactionPrefs.hateDrag).toBe('boolean')
      expect(['high', 'medium', 'low']).toContain(tpl.config.interactionPrefs.interactionFrequency)
    }
  })

  it('每个模板有 schedule 时段列表', () => {
    for (const tpl of PERSONALITY_TEMPLATES) {
      expect(Array.isArray(tpl.config.schedule)).toBe(true)
      expect(tpl.config.schedule.length).toBeGreaterThan(0)
    }
  })
})

describe('各模板特征值验证', () => {
  it('软萌模板 warmth 高、directness 低', () => {
    const soft = getTemplate('soft')!
    expect(soft.config.personality.warmth).toBeGreaterThan(0.5)
    expect(soft.config.personality.directness).toBeLessThan(0.5)
  })

  it('元气模板 liveliness 最高', () => {
    const energetic = getTemplate('energetic')!
    expect(energetic.config.personality.liveliness).toBeGreaterThan(0.5)
  })

  it('毒舌模板 directness 最高', () => {
    const poisonous = getTemplate('poisonous')!
    expect(poisonous.config.personality.directness).toBeGreaterThan(0.5)
  })

  it('知性模板 rationality 最高', () => {
    const intellectual = getTemplate('intellectual')!
    expect(intellectual.config.personality.rationality).toBeGreaterThan(0.5)
  })

  it('傲娇模板存在且 warmth 中等', () => {
    const tsundere = getTemplate('tsundere')!
    expect(tsundere).toBeDefined()
    expect(tsundere.config.personality.warmth).toBeGreaterThanOrEqual(0.3)
  })
})

describe('getTemplate', () => {
  it('按 id 返回对应模板', () => {
    const tpl = getTemplate('soft')
    expect(tpl).toBeDefined()
    expect(tpl!.id).toBe('soft')
  })

  it('未知 id 返回 undefined', () => {
    expect(getTemplate('nonexistent')).toBeUndefined()
  })
})

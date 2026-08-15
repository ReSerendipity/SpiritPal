// personalityEngine 单元测试 — 五维性格参数 → System Prompt 合成
import { describe, it, expect, beforeEach } from 'vitest'
import {
  composePersonalityPrompt,
  composeFullSystemPrompt,
  PERSONALITY_LABELS,
  loadPersonalityOverrides,
  savePersonalityOverride,
  removePersonalityOverride,
  getEffectivePersonality,
  buildDefaultPersonalityConfig,
  loadPersonalityConfigOverrides,
  savePersonalityConfigOverride,
  removePersonalityConfigOverride,
  getEffectivePersonalityConfig,
} from '../personalityEngine'
import type { Personality, CharacterProfile } from '../types'

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

function makeCharacter(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    id: 'test',
    name: 'test',
    displayName: '测试',
    source: 'test',
    birthBackground: 'test',
    emotionalCore: 'test',
    personality: makePersonality(),
    signaturePhrase: 'test',
    classicQuotes: [],
    systemPrompt: 'base prompt',
    fewShotExamples: [],
    spriteAsset: '/test.png',
    spriteType: 'atlas',
    themeColor: { primary: '#FFF', secondary: '#000' },
    bubbleMessages: {
      idle: [], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [],
    },
    ...overrides,
  }
}

describe('composePersonalityPrompt', () => {
  it('包含性格特征部分', () => {
    const prompt = composePersonalityPrompt(makePersonality())
    expect(prompt).toContain('【性格特征】')
    expect(prompt).toContain('温度')
    expect(prompt).toContain('活泼')
    expect(prompt).toContain('依赖')
    expect(prompt).toContain('直率')
    expect(prompt).toContain('理性')
  })

  it('包含说话风格部分', () => {
    const prompt = composePersonalityPrompt(makePersonality())
    expect(prompt).toContain('【说话风格】')
    expect(prompt).toContain('表情风格')
    expect(prompt).toContain('句子长度偏好')
  })

  it('高温暖时显示热情描述', () => {
    const prompt = composePersonalityPrompt(makePersonality({ warmth: 0.8 }))
    expect(prompt).toContain('非常热情温暖')
  })

  it('低温暖时显示冷漠描述', () => {
    const prompt = composePersonalityPrompt(makePersonality({ warmth: -0.8 }))
    expect(prompt).toContain('冷漠疏离')
  })

  it('高活泼时包含感叹号描述', () => {
    const prompt = composePersonalityPrompt(makePersonality({ liveliness: 0.8 }))
    expect(prompt).toContain('非常活泼好动')
  })

  it('高依赖时包含主动询问互动指导', () => {
    const prompt = composePersonalityPrompt(makePersonality({ dependence: 0.7 }))
    expect(prompt).toContain('主动询问主人近况')
  })

  it('高直率时包含直说想法', () => {
    const prompt = composePersonalityPrompt(makePersonality({ directness: 0.7 }))
    expect(prompt).toContain('直说想法')
  })

  it('高理性时包含条理分明', () => {
    const prompt = composePersonalityPrompt(makePersonality({ rationality: 0.7 }))
    expect(prompt).toContain('条理分明')
  })

  it('高温暖时 emoji 含 💕', () => {
    const prompt = composePersonalityPrompt(makePersonality({ warmth: 0.7, liveliness: 0.5 }))
    expect(prompt).toContain('💕')
  })

  it('低温暖时 emoji 含 😐', () => {
    const prompt = composePersonalityPrompt(makePersonality({ warmth: -0.5, liveliness: -0.5 }))
    expect(prompt).toContain('😐')
  })
})

describe('composeFullSystemPrompt', () => {
  it('包含 base prompt 和性格 prompt', () => {
    const full = composeFullSystemPrompt('base', makePersonality())
    expect(full).toContain('base')
    expect(full).toContain('【性格特征】')
  })

  it('使用 customPersonality 覆盖默认', () => {
    const full = composeFullSystemPrompt(
      'base',
      makePersonality({ warmth: 0.5 }),
      makePersonality({ warmth: 0.9 }),
    )
    expect(full).toContain('非常热情温暖')
  })
})

describe('PERSONALITY_LABELS', () => {
  it('包含 5 个维度的标签', () => {
    expect(Object.keys(PERSONALITY_LABELS).length).toBe(5)
    expect(PERSONALITY_LABELS.warmth.label).toBe('温度')
    expect(PERSONALITY_LABELS.liveliness.label).toBe('活泼')
    expect(PERSONALITY_LABELS.dependence.label).toBe('依赖')
    expect(PERSONALITY_LABELS.directness.label).toBe('直率')
    expect(PERSONALITY_LABELS.rationality.label).toBe('理性')
  })
})

describe('性格参数持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('loadPersonalityOverrides / savePersonalityOverride', () => {
    it('空时返回空对象', () => {
      expect(loadPersonalityOverrides()).toEqual({})
    })

    it('保存后可读取', () => {
      const p = makePersonality({ warmth: 0.9 })
      savePersonalityOverride('doro', p)
      const loaded = loadPersonalityOverrides()
      expect(loaded.doro).toEqual(p)
    })

    it('删除后不再存在', () => {
      savePersonalityOverride('doro', makePersonality())
      removePersonalityOverride('doro')
      expect(loadPersonalityOverrides().doro).toBeUndefined()
    })
  })

  describe('getEffectivePersonality', () => {
    it('无覆盖时返回默认', () => {
      const def = makePersonality({ warmth: 0.5 })
      expect(getEffectivePersonality('doro', def)).toEqual(def)
    })

    it('有覆盖时返回覆盖值', () => {
      const def = makePersonality({ warmth: 0.5 })
      const override = makePersonality({ warmth: 0.9 })
      savePersonalityOverride('doro', override)
      expect(getEffectivePersonality('doro', def).warmth).toBe(0.9)
    })
  })
})

describe('完整性格配置持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('buildDefaultPersonalityConfig', () => {
    it('根据角色档案构建默认配置', () => {
      const char = makeCharacter()
      const cfg = buildDefaultPersonalityConfig(char)
      expect(cfg.personality).toEqual(char.personality)
      expect(cfg.systemPrompt).toBe(char.systemPrompt)
      expect(cfg.schedule.length).toBeGreaterThan(0)
      expect(cfg.speakingStyle).toBeDefined()
      expect(cfg.interactionPrefs).toBeDefined()
    })

    it('高温暖高活泼推断 enthusiastic tone', () => {
      const char = makeCharacter({
        personality: makePersonality({ warmth: 0.8, liveliness: 0.6 }),
      })
      const cfg = buildDefaultPersonalityConfig(char)
      expect(cfg.speakingStyle.tone).toBe('enthusiastic')
    })

    it('低温暖推断 cold tone', () => {
      const char = makeCharacter({
        personality: makePersonality({ warmth: 0.1 }),
      })
      const cfg = buildDefaultPersonalityConfig(char)
      expect(cfg.speakingStyle.tone).toBe('cold')
    })

    it('高理性推断 formal wordPreference', () => {
      const char = makeCharacter({
        personality: makePersonality({ rationality: 0.7 }),
      })
      const cfg = buildDefaultPersonalityConfig(char)
      expect(cfg.speakingStyle.wordPreference).toBe('formal')
    })

    it('高依赖推断 high interactionFrequency', () => {
      const char = makeCharacter({
        personality: makePersonality({ dependence: 0.7 }),
      })
      const cfg = buildDefaultPersonalityConfig(char)
      expect(cfg.interactionPrefs.interactionFrequency).toBe('high')
    })

    it('低依赖推断 low interactionFrequency', () => {
      const char = makeCharacter({
        personality: makePersonality({ dependence: -0.3 }),
      })
      const cfg = buildDefaultPersonalityConfig(char)
      expect(cfg.interactionPrefs.interactionFrequency).toBe('low')
    })
  })

  describe('loadPersonalityConfigOverrides / savePersonalityConfigOverride', () => {
    it('保存后可读取', () => {
      const char = makeCharacter()
      const cfg = buildDefaultPersonalityConfig(char)
      savePersonalityConfigOverride('test', cfg)
      const loaded = loadPersonalityConfigOverrides()
      expect(loaded.test).toBeDefined()
      expect(loaded.test.personality).toEqual(cfg.personality)
    })

    it('删除后不再存在', () => {
      const char = makeCharacter()
      const cfg = buildDefaultPersonalityConfig(char)
      savePersonalityConfigOverride('test', cfg)
      removePersonalityConfigOverride('test')
      expect(loadPersonalityConfigOverrides().test).toBeUndefined()
    })
  })

  describe('getEffectivePersonalityConfig', () => {
    it('无覆盖返回默认', () => {
      const char = makeCharacter()
      const def = buildDefaultPersonalityConfig(char)
      expect(getEffectivePersonalityConfig('test', def)).toEqual(def)
    })

    it('有覆盖返回覆盖值', () => {
      const char = makeCharacter()
      const def = buildDefaultPersonalityConfig(char)
      const override = { ...def, systemPrompt: 'overridden' }
      savePersonalityConfigOverride('test', override)
      const effective = getEffectivePersonalityConfig('test', def)
      expect(effective.systemPrompt).toBe('overridden')
    })
  })
})

// characters 单元测试 — 4 个角色配置完整性、自定义角色持久化、查询函数
import { describe, it, expect, beforeEach } from 'vitest'
import {
  CHARACTERS,
  getCharacter,
  getDefaultCharacter,
  loadCustomCharacters,
  saveCustomCharacter,
  getAllCharacters,
} from '../characters'
import type { CharacterProfile } from '../types'

const EXPECTED_IDS = ['doro', 'feibi', 'gugugaga']

describe('CHARACTERS', () => {
  it('包含 3 个内置角色', () => {
    expect(CHARACTERS).toHaveLength(3)
  })

  it('包含预期的 4 个角色 id', () => {
    const ids = CHARACTERS.map((c) => c.id)
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id)
    }
  })

  it('角色 id 唯一', () => {
    const ids = CHARACTERS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('角色配置完整性', () => {
  it('每个角色有完整的基础字段', () => {
    for (const c of CHARACTERS) {
      expect(typeof c.id).toBe('string')
      expect(c.id.length).toBeGreaterThan(0)
      expect(typeof c.name).toBe('string')
      expect(typeof c.displayName).toBe('string')
      expect(c.displayName.length).toBeGreaterThan(0)
      expect(typeof c.source).toBe('string')
      expect(typeof c.birthBackground).toBe('string')
      expect(typeof c.emotionalCore).toBe('string')
    }
  })

  it('每个角色有 personality 五维参数', () => {
    for (const c of CHARACTERS) {
      const p = c.personality
      expect(typeof p.warmth).toBe('number')
      expect(typeof p.liveliness).toBe('number')
      expect(typeof p.dependence).toBe('number')
      expect(typeof p.directness).toBe('number')
      expect(typeof p.rationality).toBe('number')
    }
  })

  it('每个角色有 systemPrompt（非空）', () => {
    for (const c of CHARACTERS) {
      expect(typeof c.systemPrompt).toBe('string')
      expect(c.systemPrompt.length).toBeGreaterThan(20)
    }
  })

  it('每个角色有 signaturePhrase 和 classicQuotes', () => {
    for (const c of CHARACTERS) {
      expect(typeof c.signaturePhrase).toBe('string')
      expect(c.signaturePhrase.length).toBeGreaterThan(0)
      expect(Array.isArray(c.classicQuotes)).toBe(true)
      expect(c.classicQuotes.length).toBeGreaterThan(0)
    }
  })

  it('每个角色有 spriteAsset 和 spriteType', () => {
    for (const c of CHARACTERS) {
      expect(typeof c.spriteAsset).toBe('string')
      expect(['atlas', 'svg', 'gif', 'video']).toContain(c.spriteType)
    }
  })

  it('每个角色有 themeColor（primary + secondary）', () => {
    for (const c of CHARACTERS) {
      expect(c.themeColor).toBeDefined()
      expect(typeof c.themeColor.primary).toBe('string')
      expect(typeof c.themeColor.secondary).toBe('string')
    }
  })

  it('每个角色有 bubbleMessages 6 个分类', () => {
    for (const c of CHARACTERS) {
      const b = c.bubbleMessages
      expect(Array.isArray(b.idle)).toBe(true)
      expect(b.idle.length).toBeGreaterThan(0)
      expect(Array.isArray(b.hungry)).toBe(true)
      expect(b.hungry.length).toBeGreaterThan(0)
      expect(Array.isArray(b.sad)).toBe(true)
      expect(Array.isArray(b.pet)).toBe(true)
      expect(Array.isArray(b.feed)).toBe(true)
      expect(Array.isArray(b.pomodoroDone)).toBe(true)
    }
  })

  it('每个角色有 fewShotExamples', () => {
    for (const c of CHARACTERS) {
      expect(Array.isArray(c.fewShotExamples)).toBe(true)
      expect(c.fewShotExamples.length).toBeGreaterThan(0)
    }
  })
})

describe('各角色特征值', () => {
  it('doro displayName 为多罗，signaturePhrase 含欧润吉', () => {
    const doro = getCharacter('doro')!
    expect(doro.displayName).toBe('多罗')
    expect(doro.signaturePhrase).toContain('欧润吉')
  })

  it('feibi displayName 为菲比', () => {
    const feibi = getCharacter('feibi')!
    expect(feibi.displayName).toBe('菲比')
  })

  it('gugugaga 是 video 类型精灵图', () => {
    const gugu = getCharacter('gugugaga')!
    expect(gugu.spriteType).toBe('video')
  })
})

describe('getCharacter', () => {
  it('按 id 返回内置角色', () => {
    const doro = getCharacter('doro')
    expect(doro).toBeDefined()
    expect(doro!.id).toBe('doro')
  })

  it('未知 id 返回 undefined', () => {
    expect(getCharacter('nonexistent')).toBeUndefined()
  })
})

describe('getDefaultCharacter', () => {
  it('返回第一个角色（doro）', () => {
    const def = getDefaultCharacter()
    expect(def.id).toBe('doro')
  })
})

describe('自定义角色持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loadCustomCharacters 初始返回空数组', () => {
    expect(loadCustomCharacters()).toEqual([])
  })

  it('saveCustomCharacter 新增角色后可加载', () => {
    const custom: CharacterProfile = {
      id: 'custom1',
      name: 'custom1',
      displayName: '自定义角色',
      source: 'test',
      birthBackground: 'test',
      emotionalCore: 'test',
      personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0.5, rationality: 0.5 },
      signaturePhrase: 'test',
      classicQuotes: [],
      systemPrompt: 'test',
      fewShotExamples: [],
      spriteAsset: '/test.png',
      spriteType: 'svg',
      themeColor: { primary: '#fff', secondary: '#000' },
      bubbleMessages: { idle: [], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [] },
    }
    saveCustomCharacter(custom)
    const loaded = loadCustomCharacters()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('custom1')
  })

  it('saveCustomCharacter 同 id 覆盖已有角色', () => {
    const custom: CharacterProfile = {
      id: 'custom1',
      name: 'custom1',
      displayName: '原名',
      source: 'test',
      birthBackground: 'test',
      emotionalCore: 'test',
      personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0.5, rationality: 0.5 },
      signaturePhrase: 'test',
      classicQuotes: [],
      systemPrompt: 'test',
      fewShotExamples: [],
      spriteAsset: '/test.png',
      spriteType: 'svg',
      themeColor: { primary: '#fff', secondary: '#000' },
      bubbleMessages: { idle: [], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [] },
    }
    saveCustomCharacter(custom)
    custom.displayName = '新名'
    saveCustomCharacter(custom)
    const loaded = loadCustomCharacters()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].displayName).toBe('新名')
  })

  it('getCharacter 可查询自定义角色', () => {
    const custom: CharacterProfile = {
      id: 'custom2',
      name: 'custom2',
      displayName: '自定义',
      source: 'test',
      birthBackground: 'test',
      emotionalCore: 'test',
      personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0.5, rationality: 0.5 },
      signaturePhrase: 'test',
      classicQuotes: [],
      systemPrompt: 'test',
      fewShotExamples: [],
      spriteAsset: '/test.png',
      spriteType: 'svg',
      themeColor: { primary: '#fff', secondary: '#000' },
      bubbleMessages: { idle: [], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [] },
    }
    saveCustomCharacter(custom)
    const found = getCharacter('custom2')
    expect(found).toBeDefined()
    expect(found!.displayName).toBe('自定义')
  })
})

describe('getAllCharacters', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('包含所有内置角色', () => {
    const all = getAllCharacters()
    for (const id of EXPECTED_IDS) {
      expect(all.find((c) => c.id === id)).toBeDefined()
    }
  })

  it('包含自定义角色', () => {
    const custom: CharacterProfile = {
      id: 'custom3',
      name: 'custom3',
      displayName: '自定义3',
      source: 'test',
      birthBackground: 'test',
      emotionalCore: 'test',
      personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0.5, rationality: 0.5 },
      signaturePhrase: 'test',
      classicQuotes: [],
      systemPrompt: 'test',
      fewShotExamples: [],
      spriteAsset: '/test.png',
      spriteType: 'svg',
      themeColor: { primary: '#fff', secondary: '#000' },
      bubbleMessages: { idle: [], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [] },
    }
    saveCustomCharacter(custom)
    const all = getAllCharacters()
    expect(all.find((c) => c.id === 'custom3')).toBeDefined()
  })
})

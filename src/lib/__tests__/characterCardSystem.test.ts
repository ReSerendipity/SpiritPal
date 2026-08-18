/**
 * characterCardSystem 测试骨架
 *
 * 覆盖纯函数 + CharacterCardManager + 用户覆盖（localStorage）。
 * 该模块无 Tauri 原生依赖（仅依赖 ./types 类型），可全量单测。
 * 用户覆盖相关函数依赖 localStorage（jsdom 环境由 setup.ts 提供，beforeEach 清空）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  CHARACTER_CARD_VERSION,
  resolveTemplate,
  createTemplateContext,
  getI18nText,
  validateCharacterCard,
  migrateCharacterCard,
  saveUserOverrides,
  loadUserOverrides,
  loadAllUserOverrides,
  checkUserOverrideNeedsUpdate,
  cloneUserOverridesToNewVersion,
  removeUserOverrides,
  CharacterCardManager,
  getCharacterCardManager,
  resetCharacterCardManager,
  type CharacterCard,
  type TemplateContext,
} from '@/lib/characterCardSystem'

// ============ 测试数据 ============

function makeValidCard(overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    version: CHARACTER_CARD_VERSION,
    id: 'doro',
    name: { zh: '多萝', en: 'Doro' },
    displayName: '多萝',
    source: { zh: '原创' },
    birthBackground: { zh: '来自魔法森林的小精灵' },
    emotionalCore: { zh: '温柔善良' },
    personality: { warmth: 0.8, liveliness: 0.6, dependence: 0.4, directness: 0, rationality: 0 },
    signaturePhrase: { zh: '你好呀！' },
    classicQuotes: [{ zh: '很高兴见到你' }],
    systemPrompt: { zh: '你是{{characterName}}' },
    fewShotExamples: [],
    speakingStyle: { tone: 'gentle', wordPreference: 'colloquial', catchphrases: [] },
    interactionPrefs: { likeHeadPat: true, hateDrag: false, interactionFrequency: 'medium' },
    spriteAsset: '/pets/doro/spritesheet.webp',
    spriteType: 'atlas',
    themeColor: { primary: '#FFB6C1', secondary: '#A777E3' },
    bubbleMessages: {
      idle: [{ zh: '在想什么呢～' }],
      hungry: [],
      sad: [],
      pet: [],
      feed: [],
      pomodoroDone: [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeCtx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    characterName: '多萝',
    date: '2026-08-18',
    time: '13:45',
    weekday: '星期二',
    ...overrides,
  }
}

// ============ 导出存在 ============

describe('characterCardSystem 导出', () => {
  it('导出核心常量与函数', () => {
    expect(CHARACTER_CARD_VERSION).toBe(2)
    expect(typeof resolveTemplate).toBe('function')
    expect(typeof createTemplateContext).toBe('function')
    expect(typeof getI18nText).toBe('function')
    expect(typeof validateCharacterCard).toBe('function')
    expect(typeof migrateCharacterCard).toBe('function')
    expect(typeof CharacterCardManager).toBe('function')
  })
})

// ============ resolveTemplate ============

describe('resolveTemplate', () => {
  it('替换内置变量', () => {
    const out = resolveTemplate('我是{{characterName}}，今天是{{date}} {{weekday}} {{time}}', makeCtx())
    expect(out).toBe('我是多萝，今天是2026-08-18 星期二 13:45')
  })

  it('替换自定义变量 custom.xxx', () => {
    const ctx = makeCtx({ custom: { mood: '开心' } })
    expect(resolveTemplate('心情：{{custom.mood}}', ctx)).toBe('心情：开心')
  })

  it('未提供的可选变量替换为空串', () => {
    const ctx = makeCtx() // 无 userName / petNickname
    expect(resolveTemplate('用户{{userName}}，宠物{{petNickname}}', ctx)).toBe('用户，宠物')
  })

  it('无占位符时原样返回', () => {
    expect(resolveTemplate('没有变量', makeCtx())).toBe('没有变量')
  })

  it('无 custom 上下文时不报错', () => {
    expect(resolveTemplate('普通文本', makeCtx())).toBe('普通文本')
  })
})

// ============ getI18nText ============

describe('getI18nText', () => {
  it('命中指定语言', () => {
    expect(getI18nText({ zh: '中文', en: 'English' }, 'en')).toBe('English')
  })

  it('未命中时回退到 zh', () => {
    expect(getI18nText({ zh: '中文', en: 'English' }, 'ja')).toBe('中文')
  })

  it('无 zh 时回退到 en', () => {
    expect(getI18nText({ en: 'English' }, 'ja')).toBe('English')
  })

  it('都没有时回退到第一个值', () => {
    expect(getI18nText({ fr: 'Bonjour' }, 'ja')).toBe('Bonjour')
  })

  it('空对象返回空串', () => {
    expect(getI18nText({}, 'zh')).toBe('')
  })
})

// ============ createTemplateContext ============

describe('createTemplateContext', () => {
  it('包含角色名和日期/时间/星期字段', () => {
    const ctx = createTemplateContext('测试')
    expect(ctx.characterName).toBe('测试')
    expect(ctx.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(ctx.time).toMatch(/^\d{2}:\d{2}$/)
    expect(ctx.weekday).toMatch(/^星期[日一二三四五六]$/)
  })
})

// ============ validateCharacterCard ============

describe('validateCharacterCard', () => {
  it('非对象返回无效', () => {
    const r = validateCharacterCard(null)
    expect(r.valid).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('合法卡片通过校验', () => {
    const r = validateCharacterCard(makeValidCard())
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('缺少必要字段时记录错误', () => {
    const r = validateCharacterCard({ id: 'x' })
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes('name'))).toBe(true)
    expect(r.errors.some((e) => e.includes('displayName'))).toBe(true)
    expect(r.errors.some((e) => e.includes('spriteAsset'))).toBe(true)
  })

  it('非法 spriteType 记录错误', () => {
    const r = validateCharacterCard(makeValidCard({ spriteType: 'invalid' as never }))
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes('spriteType'))).toBe(true)
  })

  it('性格参数越界记录警告', () => {
    const card = makeValidCard()
    card.personality.warmth = 2
    const r = validateCharacterCard(card)
    expect(r.valid).toBe(true) // 警告不影响 valid
    expect(r.warnings.some((w) => w.includes('warmth'))).toBe(true)
  })

  it('version 非数字记录警告', () => {
    const r = validateCharacterCard(makeValidCard({ version: '2' as never }))
    expect(r.warnings.some((w) => w.includes('version'))).toBe(true)
  })
})

// ============ migrateCharacterCard ============

describe('migrateCharacterCard', () => {
  it('v1 字符串字段迁移为 i18n', () => {
    const migrated = migrateCharacterCard({
      version: 1,
      id: 'doro',
      name: '多萝',
      source: '原创',
      birthBackground: '背景',
      emotionalCore: '内核',
      signaturePhrase: '签名',
      systemPrompt: 'prompt',
    })
    expect(migrated.version).toBe(CHARACTER_CARD_VERSION)
    expect(migrated.name).toEqual({ zh: '多萝' })
    expect(migrated.source).toEqual({ zh: '原创' })
    expect(migrated.createdAt).toBeTruthy()
    expect(migrated.updatedAt).toBeTruthy()
  })

  it('已是 v2 时原样返回', () => {
    const card = makeValidCard()
    const migrated = migrateCharacterCard(card as unknown as Record<string, unknown>)
    expect(migrated).toBe(card)
  })
})

// ============ 用户覆盖（localStorage）============

describe('用户覆盖', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('保存并加载用户覆盖', () => {
    saveUserOverrides({
      characterId: 'doro',
      basedOnVersion: 1,
      overriddenAt: '2026-01-01T00:00:00.000Z',
      systemPrompt: { zh: '自定义' },
    })
    const loaded = loadUserOverrides('doro')
    expect(loaded).not.toBeNull()
    expect(loaded!.systemPrompt).toEqual({ zh: '自定义' })
  })

  it('loadAllUserOverrides 返回全部', () => {
    saveUserOverrides({ characterId: 'a', basedOnVersion: 1, overriddenAt: 'x' })
    saveUserOverrides({ characterId: 'b', basedOnVersion: 1, overriddenAt: 'x' })
    expect(Object.keys(loadAllUserOverrides()).sort()).toEqual(['a', 'b'])
  })

  it('checkUserOverrideNeedsUpdate 比较版本', () => {
    saveUserOverrides({ characterId: 'a', basedOnVersion: 1, overriddenAt: 'x' })
    expect(checkUserOverrideNeedsUpdate('a', 2)).toBe(true)
    expect(checkUserOverrideNeedsUpdate('a', 1)).toBe(false)
    expect(checkUserOverrideNeedsUpdate('missing', 2)).toBe(false)
  })

  it('cloneUserOverridesToNewVersion 更新版本号', () => {
    saveUserOverrides({ characterId: 'a', basedOnVersion: 1, overriddenAt: 'x' })
    cloneUserOverridesToNewVersion('a', 3)
    expect(loadUserOverrides('a')!.basedOnVersion).toBe(3)
  })

  it('removeUserOverrides 删除覆盖', () => {
    saveUserOverrides({ characterId: 'a', basedOnVersion: 1, overriddenAt: 'x' })
    removeUserOverrides('a')
    expect(loadUserOverrides('a')).toBeNull()
  })

  it('localStorage 损坏时 loadAll 返回空对象', () => {
    localStorage.setItem('spiritpal-character-card-overrides', '{ invalid')
    expect(loadAllUserOverrides()).toEqual({})
  })
})

// ============ CharacterCardManager ============

describe('CharacterCardManager', () => {
  let mgr: CharacterCardManager

  beforeEach(() => {
    localStorage.clear()
    mgr = new CharacterCardManager()
  })

  it('注册并获取卡片', () => {
    const card = makeValidCard()
    mgr.registerCard(card)
    expect(mgr.getCard('doro')).toBe(card)
    expect(mgr.getAllCards()).toHaveLength(1)
  })

  it('旧版本卡片注册时自动迁移', () => {
    const v1 = {
      version: 1,
      id: 'old',
      name: '旧卡',
      displayName: '旧卡',
      personality: { warmth: 0, liveliness: 0, dependence: 0, directness: 0, rationality: 0 },
      spriteAsset: '/x.png',
      spriteType: 'atlas',
    } as unknown as CharacterCard
    mgr.registerCard(v1)
    expect(mgr.getCard('old')!.version).toBe(CHARACTER_CARD_VERSION)
  })

  it('getLocalizedName 使用当前 locale', () => {
    mgr.registerCard(makeValidCard())
    mgr.setLocale('en')
    expect(mgr.getLocalizedName('doro')).toBe('Doro')
    expect(mgr.getLocale()).toBe('en')
  })

  it('getLocalizedSystemPrompt 解析模板变量', () => {
    mgr.registerCard(makeValidCard())
    const prompt = mgr.getLocalizedSystemPrompt('doro')
    expect(prompt).toContain('多萝')
  })

  it('getLocalizedBubbleMessages 返回本地化数组', () => {
    mgr.registerCard(makeValidCard())
    const msgs = mgr.getLocalizedBubbleMessages('doro', 'idle')
    expect(msgs).toEqual(['在想什么呢～'])
  })

  it('查询不存在的卡片返回空值', () => {
    expect(mgr.getCard('missing')).toBeUndefined()
    expect(mgr.getLocalizedName('missing')).toBe('')
    expect(mgr.getLocalizedSystemPrompt('missing')).toBe('')
    expect(mgr.getLocalizedBubbleMessages('missing', 'idle')).toEqual([])
  })

  it('unregisterCard 移除卡片', () => {
    mgr.registerCard(makeValidCard())
    mgr.unregisterCard('doro')
    expect(mgr.getCard('doro')).toBeUndefined()
  })

  it('reset 清空卡片', () => {
    mgr.registerCard(makeValidCard())
    mgr.reset()
    expect(mgr.getAllCards()).toHaveLength(0)
  })
})

// ============ 单例 ============

describe('单例', () => {
  it('getCharacterCardManager 返回同一实例', () => {
    expect(getCharacterCardManager()).toBe(getCharacterCardManager())
  })

  it('resetCharacterCardManager 重置单例', () => {
    const a = getCharacterCardManager()
    a.registerCard(makeValidCard())
    resetCharacterCardManager()
    expect(getCharacterCardManager().getAllCards()).toHaveLength(0)
  })
})

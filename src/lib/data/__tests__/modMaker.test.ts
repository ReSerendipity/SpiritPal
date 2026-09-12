// modMaker 纯逻辑测试 — 表单状态构建、校验、导出结构与 ModManager 导入往返验证
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/data/db', () => ({
  saveMod: vi.fn(() => Promise.resolve()),
  getMods: vi.fn(() => Promise.resolve([])),
  deleteMod: vi.fn(() => Promise.resolve()),
  updateModEnabled: vi.fn(() => Promise.resolve()),
}))

import {
  BUBBLE_KEYS,
  buildCharacterMod,
  buildManifest,
  createEmptyEditorState,
  validateEditorState,
} from '@/lib/data/modMaker'
import { ModManager } from '@/lib/data/modManager'

describe('createEmptyEditorState', () => {
  it('应返回可编辑的完整草稿结构', () => {
    const state = createEmptyEditorState()
    expect(state.id).toBe('custom-pet')
    expect(state.version).toBe('0.1.0')
    expect(state.animations.length).toBeGreaterThan(0)
    expect(state.bubbleMessages.idle).toBeInstanceOf(Array)
    // 模板气泡键完整
    for (const key of BUBBLE_KEYS) {
      expect(Array.isArray(state.bubbleMessages[key])).toBe(true)
    }
  })
})

describe('buildManifest', () => {
  it('应把表单字段映射为 PetmodManifest', () => {
    const state = createEmptyEditorState()
    const manifest = buildManifest({
      ...state,
      id: 'my-pet',
      displayName: '小宠',
      version: '1.2.3',
      author: 'tester',
      description: 'desc',
    })
    expect(manifest).toMatchObject({
      id: 'my-pet',
      name: '小宠',
      version: '1.2.3',
      author: 'tester',
      description: 'desc',
    })
  })
})

describe('buildCharacterMod', () => {
  it('多行文本应正确切分为 classicQuotes / favoriteItems', () => {
    const state = createEmptyEditorState()
    state.classicQuotesText = '第一句\n第二句\n\n第三句'
    state.favoriteItemsText = '苹果\n香蕉'
    state.dislikeItemsText = ''
    const mod = buildCharacterMod(state)
    expect(mod.petConf.classicQuotes).toEqual(['第一句', '第二句', '第三句'])
    expect(mod.petConf.favoriteItems).toEqual(['苹果', '香蕉'])
    expect(mod.petConf.dislikeItems).toEqual([])
  })

  it('应保留动画行字段并钳制 tier 到 0-3', () => {
    const state = createEmptyEditorState()
    state.animations = [
      { state: 'idle', baseProb: 10, tier: 5, minAffectionLevel: -2, inPlaylist: true },
      { state: 'sad', baseProb: 4, tier: 1, minAffectionLevel: 1, inPlaylist: false },
    ]
    const mod = buildCharacterMod(state)
    expect(mod.actConf?.animations).toHaveLength(2)
    expect(mod.actConf?.animations[0]).toMatchObject({
      state: 'idle',
      baseProb: 10,
      tier: 3,
      minAffectionLevel: 0,
      inPlaylist: true,
    })
    expect(mod.actConf?.animations[1]?.inPlaylist).toBe(false)
  })

  it('空 key 的 motionMap/anchor 不应出现在产物中', () => {
    const state = createEmptyEditorState()
    state.motionMap = [
      { key: '', value: 'ignored' },
      { key: 'happy', value: 'jump' },
    ]
    const mod = buildCharacterMod(state)
    expect(mod.actConf?.motionMap).toEqual({ happy: 'jump' })
  })

  it('物品行应剥离 count 字段并保留三个分类', () => {
    const state = createEmptyEditorState()
    state.foods = [{ id: 'apple', name: '苹果', icon: 'a.png', type: 'food', price: 5 }]
    const mod = buildCharacterMod(state)
    expect(mod.itemsConf?.foods).toEqual([
      { id: 'apple', name: '苹果', icon: 'a.png', type: 'food', price: 5 },
    ])
    expect((mod.itemsConf?.foods[0] as Record<string, unknown>).count).toBeUndefined()
  })
})

describe('validateEditorState', () => {
  it('合法状态应通过校验', () => {
    const state = createEmptyEditorState()
    state.author = 'tester'
    expect(validateEditorState(state)).toEqual([])
  })

  it('非法 id / 版本 / 必填缺失应报错', () => {
    const state = createEmptyEditorState()
    state.id = 'Not Valid!'
    state.version = 'abc'
    state.author = ''
    state.displayName = ''
    const errors = validateEditorState(state)
    expect(errors.length).toBeGreaterThanOrEqual(4)
    expect(errors.join('\n')).toContain('kebab-case')
    expect(errors.join('\n')).toContain('SemVer')
  })
})

describe('导出产物 → ModManager 导入往返验证', () => {
  it('buildCharacterMod 产物经 installFromJSON 应被正常安装', async () => {
    const manager = new ModManager()
    await manager.ensureLoaded()

    const state = createEmptyEditorState()
    state.id = 'round-trip-pet'
    state.displayName = '往返宠物'
    state.author = 'qa'
    state.version = '1.0.0'
    const mod = buildCharacterMod(state)

    // 模拟"导出为 JSON → 重新导入"的往返
    const installed = manager.installFromJSON(JSON.stringify(mod))
    expect(installed).not.toBeNull()
    expect(installed?.id).toBe('round-trip-pet')
    expect(installed?.displayName).toBe('往返宠物')

    const reloaded = manager.getMod('round-trip-pet')
    expect(reloaded?.modData.petConf.id).toBe('round-trip-pet')
    expect(reloaded?.modData.dialogueConf.systemPrompt).toBe(mod.dialogueConf.systemPrompt)
  })
})

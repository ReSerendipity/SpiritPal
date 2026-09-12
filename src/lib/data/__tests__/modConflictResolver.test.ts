/**
 * @file modConflictResolver.test.ts
 * @description 字段级 MOD 冲突检测与解析建议单测
 *
 * 契约：
 *  1. 同角色 id 且关键 pet_conf 字段不同 → pet_conf_field / error
 *  2. 不同角色且无重叠 → 无冲突
 *  3. 同名动画 → animation_name / warning
 *  4. 同 ID 物品 → item_id / warning
 *  5. 同角色下同气泡类别 → dialogue_id / warning
 *  6. resolveConflict：keep_a/keep_b 指定胜者；可合并冲突 merge；身份级冲突 merge 降级 manual
 *  7. detectModConflicts 两两配对
 */

import { describe, it, expect } from 'vitest'
import {
  detectPairConflicts,
  detectModConflicts,
  resolveConflict,
  type ModConflictInput,
} from '@/lib/data/modConflictResolver'
import type { CharacterMod, PetConfJSON } from '@/lib/data/modManager'

function makePetConf(overrides: Partial<PetConfJSON> = {}): PetConfJSON {
  return {
    id: 'char-a',
    name: 'char-a',
    displayName: '角色A',
    source: 'mod',
    birthBackground: '',
    emotionalCore: '',
    personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0, rationality: 0 },
    signaturePhrase: '',
    classicQuotes: [],
    themeColor: { primary: '#fff', secondary: '#000' },
    favoriteItems: [],
    dislikeItems: [],
    spriteAsset: '/a.webp',
    spriteType: 'atlas',
    activeHours: { start: 8, end: 23 },
    ...overrides,
  }
}

function makeMod(id: string, petConf: PetConfJSON, extra: Partial<CharacterMod> = {}): ModConflictInput {
  return {
    id,
    modData: {
      petConf,
      dialogueConf: {
        systemPrompt: 'x',
        fewShotExamples: [],
        bubbleMessages: { idle: [], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [] },
      },
      ...extra,
    },
  }
}

describe('detectPairConflicts', () => {
  it('不同角色且无重叠 → 无冲突', () => {
    const a = makeMod('mod-a', makePetConf({ id: 'char-a' }))
    const b = makeMod('mod-b', makePetConf({ id: 'char-b' }))
    expect(detectPairConflicts(a, b)).toEqual([])
  })

  it('同角色 id 且关键 pet_conf 字段不同 → pet_conf_field / error', () => {
    const a = makeMod('mod-a', makePetConf({ id: 'char-x', displayName: '甲' }))
    const b = makeMod('mod-b', makePetConf({ id: 'char-x', displayName: '乙' }))
    const res = detectPairConflicts(a, b)
    const pc = res.find((c) => c.type === 'pet_conf_field')
    expect(pc).toBeDefined()
    expect(pc?.severity).toBe('error')
    expect(pc?.targetCharacterId).toBe('char-x')
    expect(pc?.detail).toContain('角色名')
  })

  it('同名动画 → animation_name / warning', () => {
    const a = makeMod('mod-a', makePetConf({ id: 'char-a' }), {
      actConf: { animations: [{ state: 'happy' } as never, { state: 'idle' } as never], hpTiers: {} as never, anchors: {} },
    })
    const b = makeMod('mod-b', makePetConf({ id: 'char-b' }), {
      actConf: { animations: [{ state: 'happy' } as never], hpTiers: {} as never, anchors: {} },
    })
    const res = detectPairConflicts(a, b)
    const anim = res.find((c) => c.type === 'animation_name')
    expect(anim?.severity).toBe('warning')
    expect(anim?.field).toBe('animation:happy')
  })

  it('同 ID 物品 → item_id / warning', () => {
    const a = makeMod('mod-a', makePetConf({ id: 'char-a' }), {
      itemsConf: { foods: [{ id: 'apple', name: '苹果', icon: '', type: 'food', price: 0 }], toys: [], medicines: [] },
    })
    const b = makeMod('mod-b', makePetConf({ id: 'char-b' }), {
      itemsConf: { foods: [], toys: [{ id: 'apple', name: '苹果改', icon: '', type: 'toy', price: 0 }], medicines: [] },
    })
    const res = detectPairConflicts(a, b)
    const item = res.find((c) => c.type === 'item_id')
    expect(item?.severity).toBe('warning')
    expect(item?.field).toBe('item:apple')
  })

  it('同角色下同气泡类别 → dialogue_id / warning', () => {
    const a = makeMod('mod-a', makePetConf({ id: 'char-x' }), {
      dialogueConf: {
        systemPrompt: 'a',
        fewShotExamples: [],
        bubbleMessages: { idle: ['a1'], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [] },
      },
    })
    const b = makeMod('mod-b', makePetConf({ id: 'char-x' }), {
      dialogueConf: {
        systemPrompt: 'b',
        fewShotExamples: [],
        bubbleMessages: { idle: ['b1'], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [] },
      },
    })
    const res = detectPairConflicts(a, b)
    const dlg = res.find((c) => c.type === 'dialogue_id')
    expect(dlg?.severity).toBe('warning')
    expect(dlg?.field).toBe('bubble:idle')
  })
})

describe('detectModConflicts 两两配对', () => {
  it('三个 Mod 检测出全部成对冲突', () => {
    const mods = [
      makeMod('mod-a', makePetConf({ id: 'char-x' })),
      makeMod('mod-b', makePetConf({ id: 'char-x' })),
      makeMod('mod-c', makePetConf({ id: 'char-y' })),
    ]
    const res = detectModConflicts(mods)
    // a-b 同角色 → pet_conf_field error；a-c / b-c 无重叠
    expect(res.filter((c) => c.type === 'pet_conf_field')).toHaveLength(1)
  })
})

describe('resolveConflict', () => {
  const pc = {
    type: 'pet_conf_field' as const,
    severity: 'error' as const,
    modAId: 'mod-a',
    modBId: 'mod-b',
    targetCharacterId: 'char-x',
    field: 'displayName',
    detail: 'x',
  }
  const anim = {
    type: 'animation_name' as const,
    severity: 'warning' as const,
    modAId: 'mod-a',
    modBId: 'mod-b',
    targetCharacterId: 'char-a',
    field: 'animation:happy',
    detail: 'x',
  }

  it('keep_a 选中 A', () => {
    const r = resolveConflict(pc, 'keep_a')
    expect(r.winnerModId).toBe('mod-a')
  })

  it('keep_b 选中 B', () => {
    const r = resolveConflict(pc, 'keep_b')
    expect(r.winnerModId).toBe('mod-b')
  })

  it('可合并冲突 merge 保持双方', () => {
    const r = resolveConflict(anim, 'merge')
    expect(r.strategy).toBe('merge')
    expect(r.winnerModId).toBeNull()
  })

  it('身份级冲突 merge 降级为 manual', () => {
    const r = resolveConflict(pc, 'merge')
    expect(r.strategy).toBe('manual')
    expect(r.winnerModId).toBeNull()
  })

  it('manual 交由用户', () => {
    const r = resolveConflict(pc, 'manual')
    expect(r.strategy).toBe('manual')
  })
})

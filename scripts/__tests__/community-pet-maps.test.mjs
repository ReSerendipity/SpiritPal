// 社区宠物接入纯函数单测（id 规范化 / 撞内置冲突表 / 视频状态命名对齐）
import { describe, it, expect } from 'vitest'
import {
  BUILTIN_IDS,
  normalizeId,
  OC_CLAW_ID_MAP,
  VIDEO_STATE_FILES,
  XQ_STATE_MAP,
  DSHPET_STATE_MAP,
} from '../community-pet-maps.mjs'

describe('normalizeId（id 规范化与冲突表）', () => {
  it('点号转连字符：OC-Claw 的 doro.codex-pet → doro-codex', () => {
    expect(normalizeId('doro.codex-pet', 'occlaw')).toBe('doro-codex')
    expect(normalizeId('phoebe.codex-pet', 'occlaw')).toBe('phoebe-codex')
  })

  it('普通 kebab-case 原样保留', () => {
    expect(normalizeId('elaina-2', 'occlaw')).toBe('elaina-2')
    expect(normalizeId('notebook-buddy', 'openpets')).toBe('notebook-buddy')
    expect(normalizeId('ChrisKitty', 'dyberpet')).toBe('chriskitty')
  })

  it('撞内置 id 时追加来源后缀（内置优先）', () => {
    expect(normalizeId('doro', 'occlaw')).toBe('doro-occlaw')
    expect(normalizeId('feibi', 'community')).toBe('feibi-community')
    for (const id of BUILTIN_IDS) {
      expect(normalizeId(id, 'x') === id).toBe(false)
    }
  })

  it('OC_CLAW_ID_MAP 覆盖 11 只 OC-Claw 全部 id（无遗漏）', () => {
    const srcIds = [
      'doro.codex-pet', 'elaina-2', 'homie', 'linnea-2', 'mambo',
      'naruto', 'nezuko', 'phoebe.codex-pet', 'skirk-2', 'taffy', 'wukong',
    ]
    for (const s of srcIds) {
      const out = normalizeId(s, 'occlaw')
      expect(out.length).toBeGreaterThan(0)
      expect(out).toMatch(/^[a-z0-9-]+$/)
    }
    expect(Object.keys(OC_CLAW_ID_MAP)).toHaveLength(2) // 仅撞内置的两只需要显式映射
  })
})

describe('视频状态命名对齐（VIDEO_STATE_FILES vs SpriteRenderer stateToVideoFile）', () => {
  it('8 个状态全部有映射，且文件名与约定一致', () => {
    expect(Object.keys(VIDEO_STATE_FILES).sort()).toEqual([
      'angry', 'dance', 'eat', 'headpat', 'idle', 'rest', 'spin', 'walk',
    ])
    expect(VIDEO_STATE_FILES.idle).toBe('idle.webm')
    expect(VIDEO_STATE_FILES.rest).toBe('rest.webm') // sleep/sit/sad 共用
    expect(VIDEO_STATE_FILES.spin).toBe('spin.webm') // drag 用
    expect(VIDEO_STATE_FILES.dance).toBe('dance.webm') // happy 用
    expect(VIDEO_STATE_FILES.angry).toBe('angry.webm') // sick 用
    expect(VIDEO_STATE_FILES.headpat).toBe('headpat.webm') // pet 用
  })

  it('香企鹅与大肥鱼的状态映射与 VIDEO_STATE_FILES 键集合一致', () => {
    expect(Object.keys(XQ_STATE_MAP).sort()).toEqual(Object.keys(VIDEO_STATE_FILES).sort())
    expect(Object.keys(DSHPET_STATE_MAP).sort()).toEqual(Object.keys(VIDEO_STATE_FILES).sort())
    for (const [state, file] of Object.entries(XQ_STATE_MAP)) {
      expect(file).toMatch(/^[a-z]+$/)
    }
    for (const [state, name] of Object.entries(DSHPET_STATE_MAP)) {
      expect(name.length).toBeGreaterThan(0)
    }
  })
})

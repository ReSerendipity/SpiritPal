// communityLoader 单元测试 — manifest 自动发现链路、模板人设、许可证放行、角色合并
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { CharacterPackConfig } from '@/lib/render/characterResourceLoader'

const MIT_CONFIG: CharacterPackConfig = {
  id: 'doro-codex',
  name: 'Doro',
  version: '1.0.0',
  author: 'OC-Claw',
  license: 'MIT',
  description: 'A tiny white chibi pet.',
  spritePath: 'spritesheet.webp',
  spriteType: 'atlas',
}

const GPL_AUDITED_CONFIG: CharacterPackConfig = {
  ...MIT_CONFIG,
  id: 'chris-kitty',
  name: 'ChrisKitty',
  license: 'GPL-3.0',
  licenseMeta: { type: 'GPL-3.0', audited: true },
}

const GPL_RAW_CONFIG: CharacterPackConfig = {
  ...MIT_CONFIG,
  id: 'gpl-raw',
  name: 'GPL Raw',
  license: 'GPL-3.0',
}

// 用 vi.resetModules + 动态 import 规避 communityLoader 模块级缓存
async function freshCommunityLoader() {
  vi.resetModules()
  return await import('@/lib/render/communityLoader')
}

function mockFetchWith(packs: CharacterPackConfig[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const u = String(input)
      if (u === '/pets/manifest.json') {
        return { ok: true, json: async () => ({ packs: packs.map((p) => p.id) }) }
      }
      const id = u.replace(/^\/pets\//, '').replace(/\/pet\.json$/, '')
      const cfg = packs.find((p) => p.id === id)
      return cfg ? { ok: true, json: async () => cfg } : { ok: false, json: async () => null }
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('loadCommunityCharacters（manifest 自动发现）', () => {
  it('通过 manifest 发现并加载全部宠物包', async () => {
    mockFetchWith([MIT_CONFIG, GPL_AUDITED_CONFIG])
    const { loadCommunityCharacters } = await freshCommunityLoader()
    const loaded = await loadCommunityCharacters()
    expect(loaded.length).toBe(2)
    const ids = loaded.map((c) => c.id)
    expect(ids).toContain('doro-codex')
    expect(ids).toContain('chris-kitty')
  })

  it('loadPack 规范化补全模板人设（systemPrompt/bubbleMessages/personality）', async () => {
    mockFetchWith([MIT_CONFIG])
    const { loadCommunityCharacters } = await freshCommunityLoader()
    const loaded = await loadCommunityCharacters()
    const doro = loaded.find((c) => c.id === 'doro-codex')
    expect(doro).toBeDefined()
    // spritePath → spriteAsset（相对路径 /pets/<id>/<spritePath>）
    expect(doro!.spriteAsset).toBe('/pets/doro-codex/spritesheet.webp')
    expect(doro!.spriteType).toBe('atlas')
    // 模板人设
    expect(doro!.systemPrompt).toContain('Doro')
    expect(doro!.bubbleMessages.idle.length).toBeGreaterThan(0)
    expect(doro!.bubbleMessages.hungry.length).toBeGreaterThan(0)
    expect(typeof doro!.personality.warmth).toBe('number')
    // 来源/类型标记
    expect(doro!.source).toBe('Community')
    expect(doro!.type).toBe('community')
  })

  it('licenseMeta.audited 放行 GPL 等非白名单许可证', async () => {
    mockFetchWith([GPL_RAW_CONFIG, GPL_AUDITED_CONFIG])
    const { loadCommunityCharacters } = await freshCommunityLoader()
    const loaded = await loadCommunityCharacters()
    const ids = loaded.map((c) => c.id)
    // audited 的 GPL 通过；裸 GPL 被 validateLicense 拒绝
    expect(ids).toContain('chris-kitty')
    expect(ids).not.toContain('gpl-raw')
  })

  it('失败时静默降级为空数组，不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })))
    const { loadCommunityCharacters } = await freshCommunityLoader()
    const loaded = await loadCommunityCharacters()
    expect(loaded).toEqual([])
  })
})

describe('getAllCharacters / getCharacter 合并 community（内置优先）', () => {
  it('getAllCharacters 追加已加载的社区宠物', async () => {
    mockFetchWith([MIT_CONFIG])
    const { loadCommunityCharacters } = await freshCommunityLoader()
    await loadCommunityCharacters()
    const { getAllCharacters } = await import('@/lib/data/characters')
    const all = getAllCharacters()
    const ids = all.map((c) => c.id)
    // 内置 3 只 + 社区 doro-codex
    expect(ids).toContain('doro')
    expect(ids).toContain('doro-codex')
    expect(ids).not.toContain('elaina-2') // 未在 manifest 中，不出现
  })

  it('getCharacter 能查到社区宠物（内置优先不冲突）', async () => {
    mockFetchWith([MIT_CONFIG])
    const { loadCommunityCharacters } = await freshCommunityLoader()
    await loadCommunityCharacters()
    const { getCharacter } = await import('@/lib/data/characters')
    expect(getCharacter('doro-codex')?.id).toBe('doro-codex')
    expect(getCharacter('doro')?.id).toBe('doro') // 内置优先
  })

  it('未加载时 getLoadedCommunityCharacters 返回空', async () => {
    const { getLoadedCommunityCharacters } = await freshCommunityLoader()
    expect(getLoadedCommunityCharacters()).toEqual([])
  })
})

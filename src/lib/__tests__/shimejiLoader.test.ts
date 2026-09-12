// shimejiLoader 单元测试 — 重点覆盖 Tauri 环境分支（浏览器测试无法触及的场景）
//
// 背景坑（KNOWN_GOTCHAS #77）：旧实现只要检测到 Tauri 就无条件把 profile fetch 基准
// 路径改成 convertFileSrc(resourceDir + '/pets/shimeji/profiles')，而 dev 模式
// resourceDir() 返回 src-tauri/（其下无 pets），导致全部 fetch 失败 → 空数组 →
// shimeji 角色不加载 → 切换后宠物不显示。本测试模拟该环境，验证修复后相对路径优先回退。
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { CharacterProfile } from '@/lib/data/types'

const mocks = vi.hoisted(() => ({
  resourceDir: vi.fn(),
  convertFileSrc: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({ resourceDir: mocks.resourceDir }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: mocks.convertFileSrc }))

// shimeji profile 的最小样例（真实 profile 字段更多，normalizeShimejiProfile 会补全）
function sampleProfile(id: string): Partial<CharacterProfile> & { id: string } {
  return {
    id,
    name: id,
    displayName: id,
    spriteAsset: `/pets/shimeji/${id}.png`,
    spriteType: 'atlas',
  }
}

// 用 vi.resetModules + 动态 import 规避模块级缓存（shimejiCache）
async function freshShimejiLoader() {
  vi.resetModules()
  return await import('@/lib/render/shimejiLoader')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('loadShimejiCharacters — Tauri dev 环境（asset 路径无 pets）', () => {
  it('相对路径优先命中，即使 asset 路径全部失败也能加载角色（复现并验证 #77 修复）', async () => {
    // dev 模式：resourceDir 返回 src-tauri，convertFileSrc 产出指向不存在目录的 asset URL
    mocks.resourceDir.mockResolvedValue('C:\\project\\src-tauri')
    mocks.convertFileSrc.mockImplementation(
      (p: string) => `http://asset.localhost/${encodeURIComponent(p.replace(/\\/g, '/'))}`,
    )

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const u = String(input)
        // 仅相对路径 `/pets/shimeji/profiles/...` 可访问；asset 路径（dev 无 pets）一律失败
        if (!u.startsWith('/pets/shimeji/profiles/')) {
          return { ok: false, json: async () => null }
        }
        if (u === '/pets/shimeji/profiles/manifest.json') {
          return { ok: true, json: async () => ({ ids: ['ayaka', 'albedo'] }) }
        }
        const id = u.replace('/pets/shimeji/profiles/', '').replace(/\.json$/, '')
        return { ok: true, json: async () => sampleProfile(id) }
      }),
    )

    const { loadShimejiCharacters } = await freshShimejiLoader()
    const loaded = await loadShimejiCharacters()

    expect(loaded.length).toBe(2)
    const ids = loaded.map((c) => c.id)
    expect(ids).toContain('ayaka')
    expect(ids).toContain('albedo')
  })

  it('spriteAsset 保持相对路径，不被 convertFileSrc 转成 asset://（与内置/社区角色统一）', async () => {
    mocks.resourceDir.mockResolvedValue('C:\\project\\src-tauri')
    mocks.convertFileSrc.mockImplementation((p: string) => `http://asset.localhost/${p}`)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const u = String(input)
        if (!u.startsWith('/pets/shimeji/profiles/')) return { ok: false, json: async () => null }
        if (u === '/pets/shimeji/profiles/manifest.json') {
          return { ok: true, json: async () => ({ ids: ['ayaka'] }) }
        }
        const id = u.replace('/pets/shimeji/profiles/', '').replace(/\.json$/, '')
        return { ok: true, json: async () => sampleProfile(id) }
      }),
    )

    const { loadShimejiCharacters } = await freshShimejiLoader()
    const loaded = await loadShimejiCharacters()
    const ayaka = loaded.find((c) => c.id === 'ayaka')
    expect(ayaka).toBeDefined()
    expect(ayaka!.spriteAsset).toBe('/pets/shimeji/ayaka.png')
    expect(ayaka!.spriteAsset).not.toContain('asset.localhost')
  })

  it('相对路径不可用时回退到 asset 路径（生产打包：public 未产出但 bundle resources 含 pets）', async () => {
    mocks.resourceDir.mockResolvedValue('C:\\installed\\resources')
    mocks.convertFileSrc.mockImplementation((p: string) => `http://asset.localhost/${p}`)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const u = String(input)
        // 相对路径失败，仅 asset 路径可用
        if (u.startsWith('/pets/shimeji/profiles/')) return { ok: false, json: async () => null }
        if (u.includes('/pets/shimeji/profiles/manifest.json')) {
          return { ok: true, json: async () => ({ ids: ['ganyu'] }) }
        }
        if (u.includes('/pets/shimeji/profiles/')) {
          const id = u.split('/').pop()!.replace(/\.json$/, '')
          return { ok: true, json: async () => sampleProfile(id) }
        }
        return { ok: false, json: async () => null }
      }),
    )

    const { loadShimejiCharacters } = await freshShimejiLoader()
    const loaded = await loadShimejiCharacters()
    expect(loaded.map((c) => c.id)).toContain('ganyu')
  })
})

describe('loadShimejiCharacters — 非 Tauri 环境（纯浏览器/vitest）', () => {
  it('resourceDir 抛错时仅用相对路径加载', async () => {
    mocks.resourceDir.mockRejectedValue(new Error('not in tauri'))

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const u = String(input)
        if (u === '/pets/shimeji/profiles/manifest.json') {
          return { ok: true, json: async () => ({ ids: ['childe'] }) }
        }
        const id = u.replace('/pets/shimeji/profiles/', '').replace(/\.json$/, '')
        return id ? { ok: true, json: async () => sampleProfile(id) } : { ok: false, json: async () => null }
      }),
    )

    const { loadShimejiCharacters } = await freshShimejiLoader()
    const loaded = await loadShimejiCharacters()
    expect(loaded.map((c) => c.id)).toContain('childe')
  })

  it('全部路径失败时降级为空数组，不抛错', async () => {
    mocks.resourceDir.mockRejectedValue(new Error('not in tauri'))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })))
    const { loadShimejiCharacters } = await freshShimejiLoader()
    const loaded = await loadShimejiCharacters()
    expect(loaded).toEqual([])
  })
})

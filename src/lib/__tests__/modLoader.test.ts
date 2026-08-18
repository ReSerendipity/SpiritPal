/**
 * modLoader 测试骨架
 *
 * 重点覆盖纯逻辑：checkDependencies（依赖检查）、resolveLoadOrder（拓扑排序）、
 * registerManifest 注册表、以及依赖 fs mock 的 loadManifest / validateMod / batchLoad。
 * startWatch / stopWatch 依赖 Tauri FS watch（setup.ts 未 mock），故跳过并在注释说明。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModLoader } from '@/lib/modLoader'
import type { PetmodManifest, ModDependency } from '@/lib/modManager'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'

// ============ 测试数据 ============

function makeManifest(id: string, deps?: ModDependency[]): PetmodManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    author: 'test',
    description: `${id} 描述`,
    dependencies: deps,
  }
}

function dep(id: string, version = '^1.0.0'): ModDependency {
  return { id, version }
}

// ============ 导出存在 ============

describe('modLoader 导出', () => {
  it('导出 ModLoader 类', () => {
    expect(typeof ModLoader).toBe('function')
    const loader = new ModLoader()
    expect(typeof loader.checkDependencies).toBe('function')
    expect(typeof loader.resolveLoadOrder).toBe('function')
    expect(typeof loader.loadManifest).toBe('function')
  })
})

// ============ checkDependencies ============

describe('checkDependencies', () => {
  let loader: ModLoader

  beforeEach(() => {
    loader = new ModLoader()
  })

  it('无依赖时满足', () => {
    const r = loader.checkDependencies(makeManifest('a'), [])
    expect(r.satisfied).toBe(true)
    expect(r.unsatisfied).toEqual([])
  })

  it('依赖存在且版本满足时通过', () => {
    const r = loader.checkDependencies(makeManifest('a', [dep('b')]), [makeManifest('b')])
    expect(r.satisfied).toBe(true)
  })

  it('依赖缺失时记录 unsatisfied', () => {
    const r = loader.checkDependencies(makeManifest('a', [dep('missing')]), [makeManifest('b')])
    expect(r.satisfied).toBe(false)
    expect(r.unsatisfied).toEqual([dep('missing')])
  })

  it('可选依赖缺失时不阻断', () => {
    const r = loader.checkDependencies(makeManifest('a', [{ id: 'missing', version: '^1.0.0', optional: true }]), [])
    expect(r.satisfied).toBe(true)
  })

  it('版本约束不满足时记录 unsatisfied', () => {
    // b 版本 0.9.0，不满足 ^1.0.0
    const b = makeManifest('b')
    b.version = '0.9.0'
    const r = loader.checkDependencies(makeManifest('a', [dep('b', '^1.0.0')]), [b])
    expect(r.satisfied).toBe(false)
    expect(r.unsatisfied).toEqual([dep('b', '^1.0.0')])
  })
})

// ============ resolveLoadOrder ============

describe('resolveLoadOrder', () => {
  let loader: ModLoader

  beforeEach(() => {
    loader = new ModLoader()
  })

  it('无依赖时返回所有 ID', () => {
    const r = loader.resolveLoadOrder([makeManifest('a'), makeManifest('b'), makeManifest('c')])
    expect(r.order.sort()).toEqual(['a', 'b', 'c'])
    expect(r.cycles).toEqual([])
    expect(r.missing).toEqual([])
  })

  it('依赖关系：被依赖者先加载', () => {
    // a 依赖 b，则 b 应在 a 之前
    const r = loader.resolveLoadOrder([makeManifest('a', [dep('b')]), makeManifest('b')])
    expect(r.order.indexOf('b')).toBeLessThan(r.order.indexOf('a'))
  })

  it('缺失依赖记录到 missing', () => {
    const r = loader.resolveLoadOrder([makeManifest('a', [dep('missing')]), makeManifest('b')])
    expect(r.missing).toEqual([{ modId: 'a', dep: dep('missing') }])
    // a 无有效依赖，仍可被排序（missing 不阻断拓扑）
    expect(r.order).toContain('a')
  })

  it('循环依赖检测：A↔B', () => {
    const r = loader.resolveLoadOrder([makeManifest('a', [dep('b')]), makeManifest('b', [dep('a')])])
    expect(r.cycles.length).toBeGreaterThan(0)
    // 循环中的节点不应出现在 order 中
    const cycleIds = r.cycles.flat()
    expect(cycleIds).toContain('a')
    expect(cycleIds).toContain('b')
    expect(r.order).not.toContain('a')
    expect(r.order).not.toContain('b')
  })

  it('三节点链式依赖按拓扑排序', () => {
    const r = loader.resolveLoadOrder([
      makeManifest('a', [dep('b')]),
      makeManifest('b', [dep('c')]),
      makeManifest('c'),
    ])
    expect(r.order).toEqual(['c', 'b', 'a'])
  })
})

// ============ 清单注册表 ============

describe('manifest 注册表', () => {
  it('registerManifest / getRegisteredManifests / unregisterManifest', () => {
    const loader = new ModLoader()
    const m = makeManifest('a')
    loader.registerManifest(m)
    expect(loader.getRegisteredManifests()).toEqual([m])
    loader.unregisterManifest('a')
    expect(loader.getRegisteredManifests()).toEqual([])
  })
})

// ============ loadManifest（依赖 fs mock）============

describe('loadManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('加载 petmod.json', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(makeManifest('a')))

    const loader = new ModLoader()
    const manifest = await loader.loadManifest('/test/mod')
    expect(manifest).not.toBeNull()
    expect(manifest!.id).toBe('a')
  })

  it('petmod.json 不存在时回退 manifest.json', async () => {
    // 第一次 exists 为 false（petmod.json），第二次 true（manifest.json）
    vi.mocked(exists)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(makeManifest('compat')))

    const loader = new ModLoader()
    const manifest = await loader.loadManifest('/test/mod')
    expect(manifest!.id).toBe('compat')
  })

  it('两者都不存在时返回 null', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const loader = new ModLoader()
    expect(await loader.loadManifest('/test/mod')).toBeNull()
  })

  it('读取失败时返回 null', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockRejectedValue(new Error('io'))
    const loader = new ModLoader()
    expect(await loader.loadManifest('/test/mod')).toBeNull()
  })
})

// ============ validateMod（依赖 fs mock）============

describe('validateMod', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('清单合法 + 文件存在 + 依赖满足 → valid', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    const loader = new ModLoader()
    const r = await loader.validateMod(makeManifest('a'), '/test/mod', [])
    expect(r.valid).toBe(true)
    expect(r.manifest.valid).toBe(true)
  })

  it('pet_conf.json 缺失 → 完整性错误', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const loader = new ModLoader()
    const r = await loader.validateMod(makeManifest('a'), '/test/mod', [])
    expect(r.valid).toBe(false)
    expect(r.integrityErrors.some((e) => e.includes('pet_conf.json'))).toBe(true)
  })

  it('依赖不满足 → dependencyErrors', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    const loader = new ModLoader()
    const r = await loader.validateMod(makeManifest('a', [dep('missing')]), '/test/mod', [])
    expect(r.valid).toBe(false)
    expect(r.dependencyErrors.some((e) => e.includes('missing'))).toBe(true)
  })
})

// ============ batchLoad（依赖 fs mock）============

describe('batchLoad', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('加载合法清单并跳过损坏目录', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile)
      .mockResolvedValueOnce(JSON.stringify(makeManifest('good'))) // 第一个目录
      .mockResolvedValueOnce('{ invalid json') // 第二个目录（损坏）

    const loader = new ModLoader()
    const r = await loader.batchLoad(['/mod/good', '/mod/bad'])
    expect(r.loaded.map((m) => m.id)).toContain('good')
    expect(r.skipped.length).toBeGreaterThan(0)
  })

  it('skipBrokenMods=false 时非法清单不跳过（仍进入加载流程）', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    // 返回非法清单（缺少 name/version/author）
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ id: 'broken' }))

    const loader = new ModLoader({ skipBrokenMods: false })
    const r = await loader.batchLoad(['/mod/broken'])
    expect(r.loaded.map((m) => m.id)).toContain('broken')
    expect(r.skipped).toEqual([])
  })
})

// ============ 热重载订阅（纯逻辑，不触发 fs watch）============

describe('onHotReload', () => {
  it('订阅与取消订阅', () => {
    const loader = new ModLoader()
    const listener = vi.fn()
    const unsub = loader.onHotReload(listener)
    expect(typeof unsub).toBe('function')
    unsub()
  })
})

// ============ 跳过项说明 ============

// startWatch / stopWatch 依赖 @tauri-apps/plugin-fs 的 watch()（setup.ts 未 mock，会返回 undefined），
// 且涉及真实的文件监听生命周期与防抖定时器，属于 Tauri 原生能力，故不在本骨架中测试。
// 若需覆盖，应在 setup.ts 补 mock watch() 返回 unwatch 函数，并使用 fake timers 验证防抖回调。
describe.skip('startWatch / stopWatch（依赖未 mock 的 Tauri FS watch）', () => {
  it('enableHotReload=false 时直接返回', () => {
    const loader = new ModLoader({ enableHotReload: false })
    // 此处仅说明：config.enableHotReload=false 时 startWatch 应早退，但依赖异步边界
    expect(loader).toBeTruthy()
  })
})

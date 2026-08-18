/**
 * pluginManager 测试骨架
 *
 * pluginManager 依赖 pluginPermissions（纯 TS 逻辑，无 Tauri 依赖），
 * 因此直接使用真实沙箱管理器做集成测试，更贴近生产行为。
 * @tauri-apps/api/event 的 emit 由 setup.ts 全局 mock。
 * buildContext 为私有方法，通过 startPlugin 注入的 registerFn 间接验证沙箱能力。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emit } from '@tauri-apps/api/event'
import {
  PluginManager,
  getPluginManager,
  resetPluginManager,
} from '@/lib/pluginManager'
import { resetPluginSandboxManager } from '@/lib/pluginPermissions'
import type {
  PluginManifest,
  Plugin,
  PluginPermission,
  SpiritPalPluginContext,
} from '@/lib/pluginSdk'

// ============ 测试数据 ============

function makeManifest(
  id: string,
  permissions: PluginPermission[] = [],
): PluginManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: `${id} 插件`,
    author: 'test',
    permissions,
  }
}

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return { start: vi.fn(), stop: vi.fn(), ...overrides }
}

// ============ 导出存在 ============

describe('pluginManager 导出', () => {
  it('导出 PluginManager 类与单例函数', () => {
    expect(typeof PluginManager).toBe('function')
    expect(typeof getPluginManager).toBe('function')
    expect(typeof resetPluginManager).toBe('function')
  })
})

// ============ 注册 ============

describe('registerPlugin', () => {
  beforeEach(() => {
    resetPluginSandboxManager()
    resetPluginManager()
  })

  it('null 表示批准全部权限 → granted + approved', () => {
    const mgr = new PluginManager()
    const approval = mgr.registerPlugin(makeManifest('p1', ['pet:speak']), () => makePlugin(), null)
    expect(approval.granted).toBe(true)
    expect(mgr.getPluginState('p1')).toBe('approved')
    expect(mgr.getLoadedPluginIds()).toContain('p1')
  })

  it('显式权限列表 → 批准对应权限', () => {
    const mgr = new PluginManager()
    const approval = mgr.registerPlugin(
      makeManifest('p2', ['pet:speak', 'ui:bubble']),
      () => makePlugin(),
      ['pet:speak'],
    )
    expect(approval.granted).toBe(true)
    expect(approval.permissions).toEqual(['pet:speak'])
    expect(mgr.hasPermission('p2', 'pet:speak')).toBe(true)
    expect(mgr.hasPermission('p2', 'ui:bubble')).toBe(false)
  })

  it('undefined 表示未选择 → 拒绝全部 → error 状态', () => {
    const mgr = new PluginManager()
    const approval = mgr.registerPlugin(makeManifest('p3', ['pet:speak']), () => makePlugin())
    expect(approval.granted).toBe(false)
    expect(mgr.getPluginState('p3')).toBe('error')
  })

  it('无权限声明的插件注册成功', () => {
    const mgr = new PluginManager()
    const approval = mgr.registerPlugin(makeManifest('p4'), () => makePlugin(), null)
    expect(approval.granted).toBe(true)
    expect(mgr.getPluginState('p4')).toBe('approved')
  })

  it('getManifest 返回注册清单', () => {
    const mgr = new PluginManager()
    const manifest = makeManifest('p5')
    mgr.registerPlugin(manifest, () => makePlugin(), null)
    expect(mgr.getManifest('p5')).toBe(manifest)
  })
})

// ============ 生命周期 ============

describe('startPlugin / stopPlugin', () => {
  let mgr: PluginManager

  beforeEach(() => {
    resetPluginSandboxManager()
    resetPluginManager()
    vi.clearAllMocks()
    mgr = new PluginManager()
  })

  it('happy path：启动调用 registerFn 与 instance.start()', async () => {
    const instance = makePlugin()
    mgr.registerPlugin(makeManifest('p1'), () => instance, null)
    await mgr.startPlugin('p1')
    expect(instance.start).toHaveBeenCalled()
    expect(mgr.getPluginState('p1')).toBe('running')
  })

  it('启动不存在的插件抛错', async () => {
    await expect(mgr.startPlugin('missing')).rejects.toThrow(/not found/)
  })

  it('非 approved 状态启动抛错', async () => {
    // 未批准（undefined）→ error 状态
    mgr.registerPlugin(makeManifest('p2', ['pet:speak']), () => makePlugin())
    await expect(mgr.startPlugin('p2')).rejects.toThrow(/approved/)
  })

  it('registerFn 抛错 → error 状态且记录 error', async () => {
    mgr.registerPlugin(
      makeManifest('p3'),
      () => {
        throw new Error('boom')
      },
      null,
    )
    await mgr.startPlugin('p3')
    expect(mgr.getPluginState('p3')).toBe('error')
  })

  it('stopPlugin 调用 instance.stop() 并置 stopped', async () => {
    const instance = makePlugin()
    mgr.registerPlugin(makeManifest('p4'), () => instance, null)
    await mgr.startPlugin('p4')
    await mgr.stopPlugin('p4')
    expect(instance.stop).toHaveBeenCalled()
    expect(mgr.getPluginState('p4')).toBe('stopped')
  })

  it('stopPlugin 不存在插件抛错', async () => {
    await expect(mgr.stopPlugin('missing')).rejects.toThrow(/not found/)
  })
})

// ============ 暂停 / 恢复 ============

describe('pausePlugin / resumePlugin', () => {
  let mgr: PluginManager

  beforeEach(() => {
    resetPluginSandboxManager()
    resetPluginManager()
    mgr = new PluginManager()
  })

  it('运行中插件可暂停并恢复', async () => {
    const instance = makePlugin({ pause: vi.fn(), resume: vi.fn() })
    mgr.registerPlugin(makeManifest('p1'), () => instance, null)
    await mgr.startPlugin('p1')
    mgr.pausePlugin('p1')
    expect(mgr.getPluginState('p1')).toBe('paused')
    expect(instance.pause).toHaveBeenCalled()
    mgr.resumePlugin('p1')
    expect(mgr.getPluginState('p1')).toBe('running')
    expect(instance.resume).toHaveBeenCalled()
  })

  it('非运行状态暂停无副作用', () => {
    mgr.registerPlugin(makeManifest('p2'), () => makePlugin(), null)
    mgr.pausePlugin('p2') // approved 状态，不应改变
    expect(mgr.getPluginState('p2')).toBe('approved')
  })
})

// ============ 卸载 ============

describe('unloadPlugin', () => {
  beforeEach(() => {
    resetPluginSandboxManager()
    resetPluginManager()
  })

  it('卸载运行中的插件（先 stop）', async () => {
    const mgr = new PluginManager()
    const instance = makePlugin()
    mgr.registerPlugin(makeManifest('p1'), () => instance, null)
    await mgr.startPlugin('p1')
    await mgr.unloadPlugin('p1')
    expect(mgr.getPluginState('p1')).toBeUndefined()
    expect(mgr.getLoadedPluginIds()).not.toContain('p1')
    expect(instance.stop).toHaveBeenCalled()
  })

  it('卸载不存在的插件无副作用', async () => {
    const mgr = new PluginManager()
    await mgr.unloadPlugin('missing') // 不应抛错
    expect(mgr.getLoadedPluginIds()).toEqual([])
  })
})

// ============ 沙箱上下文（通过 registerFn 注入间接验证）============

describe('buildContext（沙箱能力）', () => {
  beforeEach(() => {
    resetPluginSandboxManager()
    resetPluginManager()
    vi.clearAllMocks()
  })

  it('拥有 pet:speak 权限时 say() 触发事件', async () => {
    const mgr = new PluginManager()
    let capturedCtx: SpiritPalPluginContext | null = null

    mgr.registerPlugin(
      makeManifest('p1', ['pet:speak']),
      (ctx) => {
        capturedCtx = ctx
        return makePlugin()
      },
      null,
    )
    await mgr.startPlugin('p1')

    capturedCtx!.pets.say('你好')
    expect(emit).toHaveBeenCalledWith('spiritpal-mcp-say', expect.stringContaining('你好'))
  })

  it('无 pet:speak 权限时 say() 静默（不触发事件）', async () => {
    const mgr = new PluginManager()
    let capturedCtx: SpiritPalPluginContext | null = null

    mgr.registerPlugin(
      makeManifest('p2', []),
      (ctx) => {
        capturedCtx = ctx
        return makePlugin()
      },
      null,
    )
    await mgr.startPlugin('p2')

    capturedCtx!.pets.say('你好')
    expect(emit).not.toHaveBeenCalled()
  })

  it('无 net:http 权限时 fetch 抛错', async () => {
    const mgr = new PluginManager()
    let capturedCtx: SpiritPalPluginContext | null = null

    mgr.registerPlugin(
      makeManifest('p3', []),
      (ctx) => {
        capturedCtx = ctx
        return makePlugin()
      },
      null,
    )
    await mgr.startPlugin('p3')

    await expect(capturedCtx!.net.fetch('https://example.com')).rejects.toThrow(/Permission denied/)
  })
})

// ============ 单例 ============

describe('单例', () => {
  beforeEach(() => {
    resetPluginSandboxManager()
    resetPluginManager()
  })

  it('getPluginManager 返回同一实例', () => {
    expect(getPluginManager()).toBe(getPluginManager())
  })

  it('resetPluginManager 重置单例', () => {
    const a = getPluginManager()
    resetPluginManager()
    expect(getPluginManager()).not.toBe(a)
  })
})

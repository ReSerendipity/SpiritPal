/**
 * visualMemoryManager 测试骨架
 *
 * 聚焦内存操作（record / getRecent / getByType / buildContext / clear），
 * 持久化路径（blob + row-level）通过 mock db 和 invoke 隔离。
 *
 * 依赖：../db（getSetting / setSetting / isVisualMemoryMigrated / ...）、
 *       @tauri-apps/api/core（invoke，setup.ts 全局 mock）、
 *       ../commonUtils（generateId，真实实现）。
 *
 * 跳过项：T-1 行级存储迁移（需要 mock insertVisualMemory / clearVisualMemories 等）
 *        及 ENC1/ENC2 加密解密路径（需要 mock invoke 返回特定格式），
 *        这些涉及多步异步交互，测试成本高，由集成测试覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  VisualMemoryManager,
  getVisualMemoryManager,
  removeVisualMemoryManager,
} from '@/lib/visualMemoryManager'

// ============ Mock db ============

vi.mock('../db', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
  getVisualMemories: vi.fn(() => Promise.resolve([])),
  insertVisualMemory: vi.fn(() => Promise.resolve()),
  clearVisualMemories: vi.fn(() => Promise.resolve()),
  isVisualMemoryMigrated: vi.fn(() => Promise.resolve(false)),
  setVisualMemoryMigrated: vi.fn(() => Promise.resolve()),
}))

// ============ 导出存在 ============

describe('visualMemoryManager 导出', () => {
  it('导出 VisualMemoryManager 类 + 单例函数', () => {
    expect(typeof VisualMemoryManager).toBe('function')
    expect(typeof getVisualMemoryManager).toBe('function')
    expect(typeof removeVisualMemoryManager).toBe('function')
  })
})

// ============ 构造与加载 ============

describe('VisualMemoryManager', () => {
  let mgr: VisualMemoryManager

  beforeEach(() => {
    vi.clearAllMocks()
    // 清除之前同一 characterId 的缓存单例
    removeVisualMemoryManager('test-char')
    mgr = getVisualMemoryManager('test-char')
  })

  it('ensureLoaded 不抛错', async () => {
    await expect(mgr.ensureLoaded()).resolves.not.toThrow()
  })

  it('初始状态为空', () => {
    expect(mgr.size).toBe(0)
    expect(mgr.getAll()).toEqual([])
  })

  // ============ record ============

  describe('record', () => {
    it('记录一条 mood 记忆', async () => {
      const mem = await mgr.record('mood', '心情很好', 'positive')
      expect(mem.id).toMatch(/^vm_/)
      expect(mem.type).toBe('mood')
      expect(mem.description).toBe('心情很好')
      expect(mem.sentiment).toBe('positive')
      expect(mem.characterId).toBe('test-char')
      expect(mem.timestamp).toBeGreaterThan(0)
      expect(mgr.size).toBe(1)
    })

    it('默认 sentiment 为 neutral', async () => {
      const mem = await mgr.record('scene', '在写代码')
      expect(mem.sentiment).toBe('neutral')
    })

    it('record 返回对象包含 imagePath 和 relatedMemoryId', async () => {
      const mem = await mgr.record('custom', 'test', 'neutral', '/img/test.png', 'mem-123')
      expect(mem.imagePath).toBe('/img/test.png')
      expect(mem.relatedMemoryId).toBe('mem-123')
    })
  })

  // ============ 便捷方法 ============

  describe('便捷记录方法', () => {
    it('recordWeather 类型为 weather', async () => {
      await mgr.recordWeather('晴天 28°C', 'positive')
      expect(mgr.getByType('weather')).toHaveLength(1)
    })

    it('recordMood 类型为 mood', async () => {
      await mgr.recordMood('开心')
      expect(mgr.getByType('mood')).toHaveLength(1)
    })

    it('recordScene 类型为 scene', async () => {
      await mgr.recordScene('在写代码')
      expect(mgr.getByType('scene')).toHaveLength(1)
    })

    it('recordScreenshot 类型为 screenshot 且含 imagePath', async () => {
      await mgr.recordScreenshot('/screenshots/1.png', '桌面截图')
      const screenshots = mgr.getByType('screenshot')
      expect(screenshots).toHaveLength(1)
      expect(screenshots[0].imagePath).toBe('/screenshots/1.png')
    })
  })

  // ============ 检索 ============

  describe('检索', () => {
    beforeEach(async () => {
      await mgr.record('mood', '开心', 'positive')
      await mgr.record('weather', '晴天', 'neutral')
      await mgr.record('scene', '写代码', 'neutral')
      await mgr.record('mood', '累了', 'negative')
    })

    it('getRecent 返回最近 N 条（倒序）', () => {
      const recent = mgr.getRecent(2)
      expect(recent).toHaveLength(2)
      expect(recent[0].description).toBe('累了')
      expect(recent[1].description).toBe('写代码')
    })

    it('getByType 按类型筛选', () => {
      expect(mgr.getByType('mood')).toHaveLength(2)
      expect(mgr.getByType('weather')).toHaveLength(1)
      expect(mgr.getByType('custom')).toHaveLength(0)
    })

    it('getAll 返回全部副本', () => {
      const all = mgr.getAll()
      expect(all).toHaveLength(4)
      // 副本不应影响内部状态
      all.pop()
      expect(mgr.size).toBe(4)
    })

    it('getMemoriesWithImages 筛选含 imagePath 的记忆', async () => {
      await mgr.recordScreenshot('/screenshots/1.png', '截图')
      const withImages = mgr.getMemoriesWithImages()
      expect(withImages).toHaveLength(1)
      expect(withImages[0].imagePath).toBe('/screenshots/1.png')
    })
  })

  // ============ buildContext ============

  describe('buildContext', () => {
    it('空记忆时返回空串', () => {
      expect(mgr.buildContext()).toBe('')
    })

    it('有记忆时返回最近感知标题', async () => {
      await mgr.record('mood', '开心', 'positive')
      await mgr.record('weather', '晴天', 'neutral')
      const ctx = mgr.buildContext()
      expect(ctx).toContain('【最近感知】')
      expect(ctx).toContain('晴天')
      expect(ctx).toContain('开心')
    })

    it('tokenBudget 限制输出长度', async () => {
      // 添加多条记忆，确保 tokenBudget 截断生效
      for (let i = 0; i < 10; i++) {
        await mgr.record('mood', `状态${i}`)
      }
      // 预算仅够标题时：实现要求至少含 1 条记忆才输出，故返回空串
      expect(mgr.buildContext(10)).toBe('')
      // 预算容纳标题 + 若干行时，输出被截断（getRecent(3) 至多 3 行）
      const ctx = mgr.buildContext(200)
      expect(ctx).toContain('【最近感知】')
      expect(ctx.split('\n').length).toBeLessThanOrEqual(4)
    })
  })

  // ============ 容量限制 ============

  describe('容量限制', () => {
    it('超过 50 条时裁剪保留最近 50 条', async () => {
      for (let i = 0; i < 55; i++) {
        await mgr.record('mood', `记忆${i}`)
      }
      expect(mgr.size).toBe(50)
      // 最早 5 条被裁剪，保留的是 #5 ~ #54（倒序后最后一条即最早保留的 #5）
      expect(mgr.getRecent(50)[49].description).toBe('记忆5')
    })
  })

  // ============ clear ============

  describe('clear', () => {
    it('清空记忆', async () => {
      await mgr.record('mood', '开心')
      await mgr.clear()
      expect(mgr.size).toBe(0)
    })
  })

  // ============ 单例缓存 ============

  describe('单例缓存', () => {
    it('同一 characterId 返回同一实例', () => {
      const a = getVisualMemoryManager('shared')
      const b = getVisualMemoryManager('shared')
      expect(a).toBe(b)
    })

    it('不同 characterId 返回不同实例', () => {
      const a = getVisualMemoryManager('c1')
      const b = getVisualMemoryManager('c2')
      expect(a).not.toBe(b)
    })

    it('removeVisualMemoryManager 移除缓存', () => {
      const a = getVisualMemoryManager('c3')
      removeVisualMemoryManager('c3')
      const b = getVisualMemoryManager('c3')
      expect(a).not.toBe(b)
    })
  })
})

// ============ 跳过项说明 ============

// 以下测试跳过，原因：
// 1. T-1 行级存储迁移（loadFromRows / migrateToRows / insertVisualMemory 等）：
//    需要 mock SQLite 行级操作并验证迁移流程，涉及多步异步交互且与旧 blob 兼容逻辑耦合，
//    测试成本高，由集成测试覆盖。
// 2. ENC1/ENC2 加密/解密路径（loadFromBlob 中的 decrypt_data invoke）：
//    需要 mock invoke 返回特定密文格式，且需 mock decrypt_data 返回对应明文，
//    当前仅验证空初始状态（getSetting 返回 null）的首家路径。
// 3. dispose 依赖 removeVisualMemoryManager（已通过单例缓存测试间接覆盖）。
describe.skip('T-1 行级存储迁移（需 SQLite 集成测试）', () => {
  it('loadFromRows 加载行级数据', () => {
    // 需要 mock isVisualMemoryMigrated → true 且 getVisualMemories 返回行数据
  })
  it('migrateToRows 迁移旧 blob 到行级', () => {
    // 需要 mock getSetting 返回旧 blob 数据，并验证 insertVisualMemory 调用
  })
})
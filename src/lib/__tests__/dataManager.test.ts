// dataManager 模块测试 — 配置导入/导出 + 全量数据备份/恢复
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../modManager', () => ({
  getModManager: vi.fn(() => ({
    getMods: vi.fn(() => [
      { id: 'mod1', displayName: '模组1', enabled: true },
    ]),
  })),
}))

vi.mock('../enhancedMemory', () => ({
  getEnhancedMemoryManager: vi.fn(() => ({})),
}))

vi.mock('../achievementSystem', () => ({
  getAchievementManager: vi.fn(() => ({})),
}))

vi.mock('../characters', () => ({
  CHARACTERS: [
    { id: 'doro', name: 'Doro' },
    { id: 'feibi', name: 'Feibi' },
  ],
}))

vi.mock('../secureStorage', () => ({
  getApiKey: vi.fn(() => Promise.resolve('test-api-key')),
  setApiKey: vi.fn(() => Promise.resolve()),
}))

// [REFACTOR] R3 - 添加 db 模块 mock（dataManager 现在通过 getSetting/setSetting 读写 SQLite）
// getSetting 返回 null → readStoreData fallback 到 localStorage（兼容测试）
// setSetting 空实现 → writeStoreData 只写 localStorage（兼容测试验证）
vi.mock('../db', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
}))

import { DataManager, getDataManager } from '../dataManager'
import { setApiKey } from '../secureStorage'

describe('DataManager', () => {
  let mgr: DataManager

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    // 重置单例
    ;(DataManager as any).instance = null
    mgr = DataManager.getInstance()
  })

  describe('getInstance 单例', () => {
    it('返回同一实例', () => {
      const m1 = DataManager.getInstance()
      const m2 = DataManager.getInstance()
      expect(m1).toBe(m2)
    })

    it('getDataManager 返回实例', () => {
      expect(getDataManager()).toBe(DataManager.getInstance())
    })
  })

  describe('exportAll', () => {
    it('导出包含版本信息', async () => {
      const json = await mgr.exportAll()
      const data = JSON.parse(json)
      expect(data.version).toBeTruthy()
      expect(data.exportedAt).toBeTruthy()
      expect(data.appVersion).toBeTruthy()
    })

    it('导出包含设置数据', async () => {
      localStorage.setItem('spiritpal-settings-store', JSON.stringify({
        state: { theme: 'dark', language: 'zh' },
      }))
      const json = await mgr.exportAll()
      const data = JSON.parse(json)
      expect(data.settings).toEqual({ theme: 'dark', language: 'zh' })
    })

    it('导出包含 AI 配置（不含 apiKey 明文）', async () => {
      localStorage.setItem('spiritpal-ai-config', JSON.stringify({
        provider: 'deepseek',
        model: 'deepseek-chat',
      }))
      const json = await mgr.exportAll()
      const data = JSON.parse(json)
      expect(data.aiConfig).toBeTruthy()
      expect(data.aiConfig.apiKey).toBeUndefined()
    })

    it('导出包含宠物养成数据', async () => {
      localStorage.setItem('spiritpal-pet-store', JSON.stringify({
        state: {
          stats: { doro: { level: 5 } },
          inventory: [{ id: 'item1' }],
        },
      }))
      const json = await mgr.exportAll()
      const data = JSON.parse(json)
      expect(data.petStats).toBeTruthy()
      expect(data.inventory).toBeTruthy()
    })

    it('导出包含成就数据', async () => {
      localStorage.setItem('spiritpal-achievements', JSON.stringify({ totalClicks: 10 }))
      const json = await mgr.exportAll()
      const data = JSON.parse(json)
      expect(data.achievements).toBeTruthy()
    })

    it('导出包含模组数据', async () => {
      const json = await mgr.exportAll()
      const data = JSON.parse(json)
      expect(data.mods).toBeTruthy()
      expect(Array.isArray(data.mods)).toBe(true)
    })

    it('导出包含记忆数据', async () => {
      localStorage.setItem('spiritpal-memory-doro', JSON.stringify({ memories: [] }))
      localStorage.setItem('spiritpal-enhanced-memory-doro', JSON.stringify({ working: [] }))
      const json = await mgr.exportAll()
      const data = JSON.parse(json)
      expect(data.memories).toBeTruthy()
      expect(data.enhancedMemories).toBeTruthy()
    })
  })

  describe('importAll', () => {
    it('无效 JSON 返回失败', async () => {
      const result = await mgr.importAll('invalid json')
      expect(result.success).toBe(false)
      expect(result.message).toContain('解析失败')
    })

    it('缺少 version 返回失败', async () => {
      const result = await mgr.importAll(JSON.stringify({ foo: 'bar' }))
      expect(result.success).toBe(false)
      expect(result.message).toContain('版本信息')
    })

    it('导入设置数据', async () => {
      const data = {
        version: '1.0',
        settings: { theme: 'light' },
      }
      const result = await mgr.importAll(JSON.stringify(data))
      expect(result.success).toBe(true)
      const stored = JSON.parse(localStorage.getItem('spiritpal-settings-store')!)
      expect(stored.state.theme).toBe('light')
    })

    it('导入 AI 配置（apiKey 不导入 secureStorage）', async () => {
      const data = {
        version: '1.0',
        aiConfig: { provider: 'openai', apiKey: 'sk-xxx', model: 'gpt-4' },
      }
      const result = await mgr.importAll(JSON.stringify(data))
      expect(result.success).toBe(true)
      expect(setApiKey).not.toHaveBeenCalled()
      const stored = JSON.parse(localStorage.getItem('spiritpal-ai-config')!)
      expect(stored.provider).toBe('openai')
      expect(stored.apiKey).toBeUndefined() // apiKey 不应明文存储
    })

    it('导入宠物养成数据', async () => {
      const data = {
        version: '1.0',
        petStats: { doro: { level: 10 } },
        inventory: [{ id: 'item1' }],
      }
      const result = await mgr.importAll(JSON.stringify(data))
      expect(result.success).toBe(true)
      const stored = JSON.parse(localStorage.getItem('spiritpal-pet-store')!)
      expect(stored.state.stats.doro.level).toBe(10)
    })

    it('导入记忆数据', async () => {
      const data = {
        version: '1.0',
        memories: { doro: { mems: [1, 2] } },
        enhancedMemories: { doro: { working: [] } },
      }
      const result = await mgr.importAll(JSON.stringify(data))
      expect(result.success).toBe(true)
      expect(localStorage.getItem('spiritpal-memory-doro')).toBeTruthy()
      expect(localStorage.getItem('spiritpal-enhanced-memory-doro')).toBeTruthy()
    })

    it('导入成就数据', async () => {
      const data = {
        version: '1.0',
        achievements: { totalClicks: 100 },
      }
      const result = await mgr.importAll(JSON.stringify(data))
      expect(result.success).toBe(true)
      expect(localStorage.getItem('spiritpal-achievements')).toContain('100')
    })

    it('导入模组数据', async () => {
      const data = {
        version: '1.0',
        mods: [{ id: 'mod1', name: '测试' }],
      }
      const result = await mgr.importAll(JSON.stringify(data))
      expect(result.success).toBe(true)
      expect(localStorage.getItem('spiritpal-mods')).toBeTruthy()
    })

    it('返回恢复项数量', async () => {
      const data = {
        version: '1.0',
        settings: { theme: 'light' },
        achievements: { totalClicks: 10 },
      }
      const result = await mgr.importAll(JSON.stringify(data))
      expect(result.message).toMatch(/\d+/)
    })
  })

  describe('resetAll', () => {
    it('清除所有 spiritpal-* 键', async () => {
      localStorage.setItem('spiritpal-settings-store', '{}')
      localStorage.setItem('spiritpal-achievements', '{}')
      localStorage.setItem('other-key', 'keep')
      await mgr.resetAll()
      expect(localStorage.getItem('spiritpal-settings-store')).toBeNull()
      expect(localStorage.getItem('spiritpal-achievements')).toBeNull()
      expect(localStorage.getItem('other-key')).toBe('keep')
    })
  })

  describe('exportToFile', () => {
    it('创建下载链接', async () => {
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      })
      await mgr.exportToFile()
      expect(clickSpy).toHaveBeenCalled()
      clickSpy.mockRestore()
    })
  })

  describe('importFromFile', () => {
    it('从 File 读取并导入', async () => {
      const json = JSON.stringify({ version: '1.0', settings: { theme: 'dark' } })
      const file = new File([json], 'backup.json', { type: 'application/json' })
      const result = await mgr.importFromFile(file)
      expect(result.success).toBe(true)
      expect(localStorage.getItem('spiritpal-settings-store')).toBeTruthy()
    })
  })
})

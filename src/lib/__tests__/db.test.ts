// db 模块测试 — SQLite 持久化层（mock tauri-plugin-sql）
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 使用 vi.hoisted 创建可配置的 mockDb
const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    execute: vi.fn((_sql: string, ..._params: any[]) => Promise.resolve()),
    select: vi.fn((_sql: string, ..._params: any[]) => Promise.resolve([] as any[])),
    close: vi.fn(() => Promise.resolve()),
  }
  return { mockDb }
})

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn(() => Promise.resolve(mockDb)),
  },
}))

import {
  getDb,
  initDB,
  closeDatabase,
  getSetting,
  setSetting,
  removeSetting,
  getCharacterStats,
  saveCharacterStats,
  getAllCharacters,
  addMemory,
  saveEmbedding,
  updateMemoryLastAccessed,
  getAllEmbeddings,
  getMemories,
  saveMod,
  getMods,
  deleteMod,
  updateModEnabled,
  saveInventoryItem,
  getInventory,
  saveSchedule,
  getSchedules,
  sqliteStorage,
  migrateFromLocalStorage,
} from '../db'

describe('db', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockDb.execute.mockReturnValue(Promise.resolve())
    mockDb.select.mockReturnValue(Promise.resolve([]))
    localStorage.clear()
    // 重置模块级单例状态（dbInstance / dbInitPromise / settingsCache），
    // 避免上一个用例残留的缓存数据污染当前用例
    closeDatabase()
    // 初始化数据库（幂等）
    await initDB()
    // 清除迁移标记：initDB 内部的迁移已写入该标记，
    // 不清理会导致后续 migrateFromLocalStorage 用例直接跳过
    await removeSetting('__sqlite_migration_done')
  })

  describe('initDB / getDb', () => {
    it('getDb 返回数据库实例', async () => {
      const db = await getDb()
      expect(db).toBeDefined()
    })

    it('initDB 幂等（重复调用不重复建表）', async () => {
      const executeCountBefore = mockDb.execute.mock.calls.length
      await initDB()
      const executeCountAfter = mockDb.execute.mock.calls.length
      // 第二次调用不应再执行建表语句
      expect(executeCountAfter).toBe(executeCountBefore)
    })

    it('initDB 创建所有表', async () => {
      // initDB 是幂等的（dbInstance 缓存），需重置模块以重新执行建表语句
      vi.resetModules()
      const { initDB: freshInitDB } = await import('../db')
      await freshInitDB()
      // 通过检查 execute 被调用时包含 CREATE TABLE 来验证
      const calls = mockDb.execute.mock.calls.map((c) => String(c[0]))
      expect(calls.some((s) => s.includes('CREATE TABLE'))).toBe(true)
      expect(calls.some((s) => s.includes('characters'))).toBe(true)
      expect(calls.some((s) => s.includes('settings'))).toBe(true)
      expect(calls.some((s) => s.includes('memories'))).toBe(true)
      expect(calls.some((s) => s.includes('mods'))).toBe(true)
      expect(calls.some((s) => s.includes('inventory'))).toBe(true)
      expect(calls.some((s) => s.includes('schedules'))).toBe(true)
    })
  })

  describe('settings 表操作', () => {
    it('getSetting 返回值', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([{ value: 'test-value' }]))
      const result = await getSetting('test-key')
      expect(result).toBe('test-value')
    })

    it('getSetting 不存在时返回 null', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([]))
      const result = await getSetting('nonexistent')
      expect(result).toBeNull()
    })

    it('setSetting 调用 execute', async () => {
      await setSetting('key1', 'value1')
      expect(mockDb.execute).toHaveBeenCalled()
      const call = mockDb.execute.mock.calls[mockDb.execute.mock.calls.length - 1]
      expect(call[0]).toContain('INSERT INTO settings')
    })

    it('removeSetting 调用 execute', async () => {
      await removeSetting('key1')
      expect(mockDb.execute).toHaveBeenCalled()
      const call = mockDb.execute.mock.calls[mockDb.execute.mock.calls.length - 1]
      expect(call[0]).toContain('DELETE FROM settings')
    })
  })

  describe('characters 表操作', () => {
    it('getCharacterStats 返回 JSON 字符串', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([{ stats: '{"level":1}' }]))
      const result = await getCharacterStats('doro')
      expect(result).toBe('{"level":1}')
    })

    it('getCharacterStats 不存在返回 null', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([]))
      const result = await getCharacterStats('nonexistent')
      expect(result).toBeNull()
    })

    it('saveCharacterStats 序列化并保存', async () => {
      await saveCharacterStats('doro', { level: 5, exp: 100 })
      expect(mockDb.execute).toHaveBeenCalled()
      const call = mockDb.execute.mock.calls[mockDb.execute.mock.calls.length - 1]
      expect(call[0]).toContain('INSERT INTO characters')
      expect(call[1]).toContain('doro')
    })

    it('getAllCharacters 返回所有角色', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([
        { id: 'doro', stats: '{}', updated_at: 100 },
        { id: 'feibi', stats: '{}', updated_at: 200 },
      ]))
      const result = await getAllCharacters()
      expect(result).toHaveLength(2)
    })
  })

  describe('memories 表操作', () => {
    it('addMemory 返回插入的 ID', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([{ id: 42 }]))
      const id = await addMemory('doro', 'short_term', '测试记忆', 80)
      expect(id).toBe(42)
    })

    it('saveEmbedding 调用 execute', async () => {
      const embedding = new Float32Array([1, 2, 3])
      await saveEmbedding(1, embedding)
      expect(mockDb.execute).toHaveBeenCalled()
    })

    it('updateMemoryLastAccessed 调用 execute', async () => {
      await updateMemoryLastAccessed(1)
      expect(mockDb.execute).toHaveBeenCalled()
    })

    it('getAllEmbeddings 返回嵌入数组', async () => {
      // 返回 base64 编码的 Float32Array
      const arr = new Float32Array([1, 2, 3])
      const bytes = new Uint8Array(arr.buffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const b64 = btoa(binary)
      mockDb.select.mockReturnValue(Promise.resolve([{ id: 1, embedding: b64 }]))
      const result = await getAllEmbeddings('doro')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
      expect(result[0].embedding).toBeInstanceOf(Float32Array)
    })

    it('getAllEmbeddings 不传 characterId 时查询全部', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([]))
      await getAllEmbeddings()
      expect(mockDb.select).toHaveBeenCalled()
    })

    it('getMemories 返回记忆列表', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([
        { id: 1, content: '记忆1' },
        { id: 2, content: '记忆2' },
      ]))
      const result = await getMemories('doro')
      expect(result).toHaveLength(2)
    })

    it('getMemories 按 type 过滤', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([]))
      await getMemories('doro', 'long_term')
      const call = mockDb.select.mock.calls[mockDb.select.mock.calls.length - 1]
      expect(call[0]).toContain('type = $2')
    })
  })

  describe('mods 表操作', () => {
    it('saveMod 调用 execute', async () => {
      await saveMod({ id: 'mod1', name: '测试模组', config: { test: true }, enabled: true })
      expect(mockDb.execute).toHaveBeenCalled()
    })

    it('getMods 返回模组列表', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([
        { id: 'mod1', name: '模组1', version: '1.0', config: '{}', enabled: 1, installed_at: 100 },
      ]))
      const result = await getMods()
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('mod1')
    })

    it('deleteMod 调用 execute', async () => {
      await deleteMod('mod1')
      expect(mockDb.execute).toHaveBeenCalled()
    })

    it('updateModEnabled 调用 execute', async () => {
      await updateModEnabled('mod1', true)
      expect(mockDb.execute).toHaveBeenCalled()
    })
  })

  describe('inventory 表操作', () => {
    it('saveInventoryItem 调用 execute', async () => {
      await saveInventoryItem({ id: 'inv1', item_id: 'food1', quantity: 5 })
      expect(mockDb.execute).toHaveBeenCalled()
    })

    it('getInventory 返回物品列表', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([{ id: 'inv1', item_id: 'food1', quantity: 5 }]))
      const result = await getInventory()
      expect(result).toHaveLength(1)
    })

    it('getInventory 按 characterId 过滤', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([]))
      await getInventory('doro')
      const call = mockDb.select.mock.calls[mockDb.select.mock.calls.length - 1]
      expect(call[0]).toContain('character_id')
    })
  })

  describe('schedules 表操作', () => {
    it('saveSchedule 调用 execute', async () => {
      await saveSchedule({ id: 'sch1', title: '测试日程', time: Date.now() })
      expect(mockDb.execute).toHaveBeenCalled()
    })

    it('getSchedules 返回排序列表', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([
        { id: 'sch1', title: '日程1', time: 100 },
      ]))
      const result = await getSchedules()
      expect(result).toHaveLength(1)
    })
  })

  describe('sqliteStorage 适配器', () => {
    it('getItem 调用 getSetting', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([{ value: 'stored-value' }]))
      const result = await sqliteStorage.getItem('test-key')
      expect(result).toBe('stored-value')
    })

    it('getItem 出错时返回 null', async () => {
      mockDb.select.mockRejectedValue(new Error('DB error'))
      const result = await sqliteStorage.getItem('test-key')
      expect(result).toBeNull()
    })

    it('setItem 调用 setSetting', async () => {
      await sqliteStorage.setItem('test-key', 'test-value')
      expect(mockDb.execute).toHaveBeenCalled()
    })

    it('setItem 出错时不抛出', async () => {
      mockDb.execute.mockRejectedValue(new Error('DB error'))
      await expect(sqliteStorage.setItem('test-key', 'test-value')).resolves.toBeUndefined()
    })

    it('removeItem 调用 removeSetting', async () => {
      await sqliteStorage.removeItem('test-key')
      expect(mockDb.execute).toHaveBeenCalled()
    })

    it('removeItem 出错时不抛出', async () => {
      mockDb.execute.mockRejectedValue(new Error('DB error'))
      await expect(sqliteStorage.removeItem('test-key')).resolves.toBeUndefined()
    })
  })

  describe('migrateFromLocalStorage', () => {
    it('迁移 spiritpal-* 键到 settings 表', async () => {
      localStorage.setItem('spiritpal-test-key', 'test-value')
      // 先清除迁移标记（initDB 中可能已设置）
      mockDb.select.mockReturnValue(Promise.resolve([]))
      await migrateFromLocalStorage()
      // 应该调用了 setSetting（通过 execute）
      expect(mockDb.execute).toHaveBeenCalled()
    })

    it('已迁移时跳过', async () => {
      mockDb.select.mockReturnValue(Promise.resolve([{ value: '1' }]))
      const executeBefore = mockDb.execute.mock.calls.length
      await migrateFromLocalStorage()
      const executeAfter = mockDb.execute.mock.calls.length
      expect(executeAfter).toBe(executeBefore)
    })

    it('迁移 spiritpal-pet-store 中的角色数据', async () => {
      const storeData = {
        state: {
          stats: {
            doro: { level: 1, exp: 0 },
            feibi: { level: 2, exp: 50 },
          },
        },
      }
      localStorage.setItem('spiritpal-pet-store', JSON.stringify(storeData))
      mockDb.select.mockReturnValue(Promise.resolve([]))
      await migrateFromLocalStorage()
      // 应该为每个角色调用 saveCharacterStats
      expect(mockDb.execute).toHaveBeenCalled()
    })

    it('迁移 spiritpal-mods 中的模组数据', async () => {
      const mods = [{ id: 'mod1', displayName: '测试模组', version: '1.0' }]
      localStorage.setItem('spiritpal-mods', JSON.stringify(mods))
      localStorage.setItem('spiritpal-mods-enabled', JSON.stringify(['mod1']))
      mockDb.select.mockReturnValue(Promise.resolve([]))
      await migrateFromLocalStorage()
      expect(mockDb.execute).toHaveBeenCalled()
    })
  })
})

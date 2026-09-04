// db 模块测试 — SQLite 持久化层（D-1 收口：mock @tauri-apps/api/core 的 invoke 按 cmd 路由）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 使用 vi.hoisted 创建可配置的 invoke mock：按 cmd 返回 behavior map 中的值
const { invokeMock } = vi.hoisted(() => {
  const behavior = new Map<string, unknown>()
  const invoke = vi.fn((cmd: string, _args?: Record<string, unknown>) => {
    // 无返回值的写命令 / 初始化命令 → resolve undefined
    if (
      cmd === 'sp_db_migrate' ||
      cmd === 'decrypt_db_at_rest' ||
      cmd === 'sp_settings_set' ||
      cmd === 'sp_settings_remove' ||
      cmd === 'sp_db_integrity'
    ) {
      return Promise.resolve(cmd === 'sp_db_integrity' ? ['ok'] : undefined)
    }
    return Promise.resolve(behavior.has(cmd) ? behavior.get(cmd) : null)
  })
  return { invokeMock: { invoke, behavior } }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock.invoke,
  convertFileSrc: vi.fn((p: string) => p),
}))

// P1-2: mock 跨窗口事件（emit/listen）
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

import {
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
} from '@/lib/data/db'

describe('db', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    invokeMock.behavior.clear()
    localStorage.clear()
    // 重置模块级单例状态（settingsCache / settingsCache），避免缓存污染
    closeDatabase()
    // 初始化数据库（幂等）
    await initDB()
    // 清除迁移标记：initDB 内部的迁移已写入该标记
    await removeSetting('__sqlite_migration_done')
  })

  afterEach(() => {
    invokeMock.behavior.clear()
  })

  describe('initDB', () => {
    it('initDB 调用 sp_db_migrate（Rust 侧建表）', async () => {
      const calls = invokeMock.invoke.mock.calls.map((c) => String(c[0]))
      expect(calls.some((c) => c.includes('sp_db_migrate'))).toBe(true)
    })

    it('resetModules 后 initDB 仍走 sp_db_migrate', async () => {
      vi.resetModules()
      const { initDB: freshInitDB } = await import('@/lib/data/db')
      await freshInitDB()
      const calls = invokeMock.invoke.mock.calls.map((c) => String(c[0]))
      expect(calls.some((c) => c.includes('sp_db_migrate'))).toBe(true)
    })
  })

  describe('settings 表操作', () => {
    it('getSetting 返回值', async () => {
      invokeMock.behavior.set('sp_settings_get', 'test-value')
      const result = await getSetting('test-key')
      expect(result).toBe('test-value')
    })

    it('getSetting 不存在时返回 null', async () => {
      invokeMock.behavior.set('sp_settings_get', null)
      const result = await getSetting('nonexistent')
      expect(result).toBeNull()
    })

    it('setSetting 调用 sp_settings_set', async () => {
      await setSetting('key1', 'value1')
      const calls = invokeMock.invoke.mock.calls.filter((c) => c[0] === 'sp_settings_set')
      // 全量并行下 initDB 的迁移幂等标记（__sqlite_migration_done）可能作为异步残留追加在尾部，
      // 因此断言改为定位 key1 的调用而非假设它是"最后一次"（测试意图：setSetting 正确触发 sp_settings_set）
      const call = calls.find((c) => ((c[1] ?? {}) as { key?: string }).key === 'key1')
      expect(call).toBeDefined()
      const args = (call?.[1] ?? {}) as { key?: string }
      expect(args.key).toBe('key1')
    })

    it('removeSetting 调用 sp_settings_remove', async () => {
      await removeSetting('key1')
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_settings_remove')
      expect(call).toBeDefined()
    })
  })

  describe('characters 表操作', () => {
    it('getCharacterStats 返回 JSON 字符串', async () => {
      invokeMock.behavior.set('sp_char_get_stats', '{"level":1}')
      const result = await getCharacterStats('doro')
      expect(result).toBe('{"level":1}')
    })

    it('getCharacterStats 不存在返回 null', async () => {
      invokeMock.behavior.set('sp_char_get_stats', null)
      const result = await getCharacterStats('nonexistent')
      expect(result).toBeNull()
    })

    it('saveCharacterStats 调用 sp_char_save_stats', async () => {
      await saveCharacterStats('doro', { level: 5, exp: 100 })
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_char_save_stats')
      expect(call).toBeDefined()
      expect(((call?.[1] ?? {}) as { characterId?: string }).characterId).toBe('doro')
    })

    it('getAllCharacters 返回所有角色', async () => {
      invokeMock.behavior.set('sp_char_list', [
        { id: 'doro', stats: '{}', updated_at: 100 },
        { id: 'feibi', stats: '{}', updated_at: 200 },
      ])
      const result = await getAllCharacters()
      expect(result).toHaveLength(2)
    })
  })

  describe('memories 表操作', () => {
    it('addMemory 返回插入的 ID', async () => {
      invokeMock.behavior.set('sp_mem_add', 42)
      const id = await addMemory('doro', 'short_term', '测试记忆', 80)
      expect(id).toBe(42)
    })

    it('saveEmbedding 调用 sp_mem_save_embedding', async () => {
      const embedding = new Float32Array([1, 2, 3])
      await saveEmbedding(1, embedding)
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_mem_save_embedding')
      expect(call).toBeDefined()
    })

    it('updateMemoryLastAccessed 调用 sp_mem_touch', async () => {
      await updateMemoryLastAccessed(1)
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_mem_touch')
      expect(call).toBeDefined()
    })

    it('getAllEmbeddings 返回嵌入数组', async () => {
      // 返回 base64 编码的 Float32Array
      const arr = new Float32Array([1, 2, 3])
      const bytes = new Uint8Array(arr.buffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const b64 = btoa(binary)
      invokeMock.behavior.set('sp_mem_get_embeddings', [{ id: 1, embedding: b64 }])
      const result = await getAllEmbeddings('doro')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
      expect(result[0].embedding).toBeInstanceOf(Float32Array)
    })

    it('getMemories 返回记忆列表', async () => {
      invokeMock.behavior.set('sp_mem_list', [
        { id: 1, content: '记忆1' },
        { id: 2, content: '记忆2' },
      ])
      const result = await getMemories('doro')
      expect(result).toHaveLength(2)
    })
  })

  describe('mods 表操作', () => {
    it('saveMod 调用 sp_mods_save', async () => {
      await saveMod({ id: 'mod1', name: '测试模组', config: { test: true }, enabled: true })
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_mods_save')
      expect(call).toBeDefined()
    })

    it('getMods 返回模组列表', async () => {
      invokeMock.behavior.set('sp_mods_list', [
        { id: 'mod1', name: '模组1', version: '1.0', config: '{}', enabled: 1, installed_at: 100 },
      ])
      const result = await getMods()
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('mod1')
    })

    it('deleteMod 调用 sp_mods_delete', async () => {
      await deleteMod('mod1')
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_mods_delete')
      expect(call).toBeDefined()
    })

    it('updateModEnabled 调用 sp_mods_set_enabled', async () => {
      await updateModEnabled('mod1', true)
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_mods_set_enabled')
      expect(call).toBeDefined()
    })
  })

  describe('inventory 表操作', () => {
    it('saveInventoryItem 调用 sp_inventory_save', async () => {
      await saveInventoryItem({ id: 'inv1', item_id: 'food1', quantity: 5 })
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_inventory_save')
      expect(call).toBeDefined()
    })

    it('getInventory 返回物品列表', async () => {
      invokeMock.behavior.set('sp_inventory_list', [{ id: 'inv1', item_id: 'food1', quantity: 5 }])
      const result = await getInventory()
      expect(result).toHaveLength(1)
    })

    it('getInventory 按 characterId 过滤', async () => {
      invokeMock.behavior.set('sp_inventory_list', [])
      await getInventory('doro')
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_inventory_list')
      expect(((call?.[1] ?? {}) as { characterId?: string }).characterId).toBe('doro')
    })
  })

  describe('schedules 表操作', () => {
    it('saveSchedule 调用 sp_schedules_save', async () => {
      await saveSchedule({ id: 'sch1', title: '测试日程', time: Date.now() })
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_schedules_save')
      expect(call).toBeDefined()
    })

    it('getSchedules 返回排序列表', async () => {
      invokeMock.behavior.set('sp_schedules_list', [{ id: 'sch1', title: '日程1', time: 100 }])
      const result = await getSchedules()
      expect(result).toHaveLength(1)
    })
  })

  describe('sqliteStorage 适配器', () => {
    it('getItem 调用 getSetting', async () => {
      invokeMock.behavior.set('sp_settings_get', 'stored-value')
      const result = await sqliteStorage.getItem('test-key')
      expect(result).toBe('stored-value')
    })

    it('getItem 出错时返回 null', async () => {
      invokeMock.invoke.mockRejectedValueOnce(new Error('DB error'))
      const result = await sqliteStorage.getItem('test-key')
      expect(result).toBeNull()
    })

    it('setItem 调用 setSetting', async () => {
      await sqliteStorage.setItem('test-key', 'test-value')
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_settings_set')
      expect(call).toBeDefined()
    })

    it('removeItem 调用 removeSetting', async () => {
      await sqliteStorage.removeItem('test-key')
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_settings_remove')
      expect(call).toBeDefined()
    })
  })

  describe('migrateFromLocalStorage', () => {
    it('迁移 spiritpal-* 键到 settings 表', async () => {
      localStorage.setItem('spiritpal-test-key', 'test-value')
      invokeMock.behavior.set('sp_settings_get', null)
      await migrateFromLocalStorage()
      const call = invokeMock.invoke.mock.calls.find((c) => c[0] === 'sp_settings_set')
      expect(call).toBeDefined()
    })

    it('已迁移时跳过', async () => {
      invokeMock.behavior.set('sp_settings_get', '1')
      const setCallsBefore = invokeMock.invoke.mock.calls.filter((c) => c[0] === 'sp_settings_set').length
      await migrateFromLocalStorage()
      const setCallsAfter = invokeMock.invoke.mock.calls.filter((c) => c[0] === 'sp_settings_set').length
      expect(setCallsAfter).toBe(setCallsBefore)
    })
  })
})
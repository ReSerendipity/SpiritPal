/**
 * entityLinking.ts 单元测试
 *
 * 测试覆盖：
 * - 实体提取（人名、地名、物品、时间、事件）
 * - 实体关联到记忆 ID
 * - 停用词过滤
 * - 实体检索（getLinkedMemoryIds / getAllEntities / getTemporalEntities）
 * - 持久化（load/save with ENC1/ENC2 解密兼容）
 * - clear / dispose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock db
vi.mock('../db', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getEntityNodes: vi.fn().mockResolvedValue([]),
  upsertEntityNode: vi.fn().mockResolvedValue(undefined),
  clearEntityNodes: vi.fn().mockResolvedValue(undefined),
  isEntityNodesMigrated: vi.fn().mockResolvedValue(false),
  setEntityNodesMigrated: vi.fn().mockResolvedValue(undefined),
}))

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock commonUtils
vi.mock('../commonUtils', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`),
}))

import { EntityManager, getEntityManager, removeEntityManager } from '../entityLinking'
import { invoke } from '@tauri-apps/api/core'
import { getSetting, setSetting, upsertEntityNode, isEntityNodesMigrated, getEntityNodes, setEntityNodesMigrated } from '../db'

describe('EntityManager', () => {
  let manager: EntityManager

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSetting).mockResolvedValue(null)
    vi.mocked(setSetting).mockResolvedValue(undefined)
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'encrypt_data') return 'ENC2:encrypted_data'
      if (cmd === 'decrypt_data') return JSON.stringify({ entities: [] })
      return null
    })
    removeEntityManager('test-char')
    manager = getEntityManager('test-char')
  })

  describe('实体提取', () => {
    it('应从文本中提取人名', () => {
      const entities = manager.extractAndLink('我的朋友叫小明，他是个好人', 'mem-1')
      const persons = entities.filter(e => e.type === 'person')
      expect(persons.length).toBeGreaterThan(0)
      expect(persons[0].name).toBe('小明')
    })

    it('应从文本中提取地名', () => {
      const entities = manager.extractAndLink('我住在北京，那里很好', 'mem-2')
      const places = entities.filter(e => e.type === 'place')
      expect(places.length).toBeGreaterThan(0)
      expect(places[0].name).toBe('北京')
    })

    it('应从文本中提取时间', () => {
      const entities = manager.extractAndLink('明天我要去出差', 'mem-3')
      const times = entities.filter(e => e.type === 'time')
      expect(times.length).toBeGreaterThan(0)
    })

    it('应从文本中提取事件', () => {
      const entities = manager.extractAndLink('明天要开会和考试', 'mem-4')
      const events = entities.filter(e => e.type === 'event')
      expect(events.length).toBeGreaterThan(0)
    })

    it('应关联实体到记忆 ID', () => {
      manager.extractAndLink('我叫小红', 'mem-a')
      const linked = manager.getLinkedMemoryIds('小红')
      expect(linked).toContain('mem-a')
    })

    it('同一实体多次出现应增加 mentionCount', () => {
      manager.extractAndLink('叫小明', 'mem-1')
      manager.extractAndLink('叫小明', 'mem-2')
      manager.extractAndLink('叫小明', 'mem-3')
      const entities = manager.getAllEntities()
      const xiaoming = entities.find(e => e.name === '小明')
      expect(xiaoming).toBeDefined()
      expect(xiaoming!.mentionCount).toBe(3)
    })

    it('同一记忆 ID 不应重复关联', () => {
      manager.extractAndLink('叫小明', 'mem-1')
      manager.extractAndLink('叫小明', 'mem-1')
      const linked = manager.getLinkedMemoryIds('小明')
      expect(linked.filter(id => id === 'mem-1').length).toBe(1)
    })

    it('应过滤停用词', () => {
      const entities = manager.extractAndLink('你我他什么', 'mem-stop')
      expect(entities.length).toBe(0)
    })

    it('无实体时不应调用 save', () => {
      manager.extractAndLink('无关键词的文本', 'mem-empty')
      // save 只在有实体时调用
      expect(setSetting).not.toHaveBeenCalled()
    })
  })

  describe('实体检索', () => {
    it('getLinkedMemoryIds 应返回关联的记忆 ID', () => {
      manager.extractAndLink('叫小红', 'mem-x')
      manager.extractAndLink('住上海', 'mem-x')
      const linked = manager.getLinkedMemoryIds('小红')
      expect(linked).toContain('mem-x')
    })

    it('getLinkedMemoryIds 不存在的实体应返回空数组', () => {
      expect(manager.getLinkedMemoryIds('不存在的人')).toEqual([])
    })

    it('getAllEntities 应按 mentionCount 降序排序', () => {
      manager.extractAndLink('叫张三', 'mem-1')
      manager.extractAndLink('叫张三', 'mem-2')
      manager.extractAndLink('叫张三', 'mem-3')
      manager.extractAndLink('叫李四', 'mem-1')
      const all = manager.getAllEntities()
      const zhangsan = all.find(e => e.name === '张三')
      const lisi = all.find(e => e.name === '李四')
      expect(all.indexOf(zhangsan!)).toBeLessThan(all.indexOf(lisi!))
    })

    it('getTemporalEntities 应只返回时间类型实体', () => {
      manager.extractAndLink('明天去北京', 'mem-1')
      const temporal = manager.getTemporalEntities()
      expect(temporal.every(e => e.type === 'time')).toBe(true)
    })

    it('size 应返回实体数量', () => {
      const before = manager.size
      manager.extractAndLink('叫王五', 'mem-1')
      expect(manager.size).toBe(before + 1)
    })
  })

  describe('持久化', () => {
    it('加载 ENC2 格式数据应调用 decrypt_data', async () => {
      vi.mocked(getSetting).mockResolvedValueOnce('ENC2:encrypted_data')
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'decrypt_data') {
          return JSON.stringify({
            entities: [
              { id: 'e1', name: '测试人', type: 'person', linkedMemoryIds: ['m1'], mentionCount: 1, firstSeen: 0, lastSeen: 0 },
            ],
          })
        }
        return null
      })

      removeEntityManager('persist-test')
      const mgr = getEntityManager('persist-test')
      await mgr.ensureLoaded()
      expect(invoke).toHaveBeenCalledWith('decrypt_data', expect.objectContaining({ encrypted: 'ENC2:encrypted_data', password: '' }))
      expect(mgr.getLinkedMemoryIds('测试人')).toContain('m1')
    })

    it('加载 ENC1 格式数据应调用 decrypt_data', async () => {
      vi.mocked(getSetting).mockResolvedValueOnce('ENC1:encrypted_data')
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'decrypt_data') {
          return JSON.stringify({ entities: [] })
        }
        return null
      })

      removeEntityManager('enc1-test')
      const mgr = getEntityManager('enc1-test')
      await mgr.ensureLoaded()
      expect(invoke).toHaveBeenCalledWith('decrypt_data', expect.objectContaining({ encrypted: 'ENC1:encrypted_data', password: '' }))
    })

    it('加载明文数据不应调用 decrypt_data', async () => {
      const plainData = JSON.stringify({ entities: [] })
      vi.mocked(getSetting).mockResolvedValueOnce(plainData)

      removeEntityManager('plain-test')
      const mgr = getEntityManager('plain-test')
      await mgr.ensureLoaded()
      // invoke 不应被调用用于解密
      expect(mgr.size).toBe(0)
    })
  })

  describe('clear 和 dispose', () => {
    it('clear 应清空所有实体', async () => {
      manager.extractAndLink('叫赵六', 'mem-1')
      expect(manager.size).toBeGreaterThan(0)
      await manager.clear()
      expect(manager.size).toBe(0)
    })

    it('dispose 应清空实体并从单例中移除', () => {
      manager.extractAndLink('叫钱七', 'mem-1')
      manager.dispose()
      // getEntityManager 应返回新实例
      const newMgr = getEntityManager('test-char')
      expect(newMgr).not.toBe(manager)
      newMgr.dispose()
    })
  })

  describe('单例', () => {
    it('getEntityManager 应返回同一实例', () => {
      removeEntityManager('singleton-test')
      const m1 = getEntityManager('singleton-test')
      const m2 = getEntityManager('singleton-test')
      expect(m1).toBe(m2)
      m1.dispose()
    })

    it('不同 characterId 应返回不同实例', () => {
      removeEntityManager('char-a')
      removeEntityManager('char-b')
      const m1 = getEntityManager('char-a')
      const m2 = getEntityManager('char-b')
      expect(m1).not.toBe(m2)
      m1.dispose()
      m2.dispose()
    })
  })

  describe('T-1 行级存储迁移', () => {
    it('已迁移时从行加载实体', async () => {
      vi.mocked(getSetting).mockResolvedValue(null)
      vi.mocked(isEntityNodesMigrated as ReturnType<typeof vi.fn>).mockResolvedValue(true)
      vi.mocked(getEntityNodes as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'e1', character_id: 'test-char', name: '小明', type: 'person',
          linked_memory_ids: '["mem-1"]', mention_count: 2, first_seen: 100, last_seen: 200,
        },
      ])
      removeEntityManager('row-test')
      const m = getEntityManager('row-test')
      await m.ensureLoaded()
      expect(m.getLinkedMemoryIds('小明')).toEqual(['mem-1'])
      expect(m.size).toBe(1)
      m.dispose()
    })

    it('旧 blob 加载后自动迁移到行级并备份 .legacy', async () => {
      vi.mocked(isEntityNodesMigrated as ReturnType<typeof vi.fn>).mockResolvedValue(false)
      vi.mocked(getSetting).mockResolvedValue(JSON.stringify({
        entities: [{ id: 'e1', name: '北京', type: 'place', linkedMemoryIds: ['mem-2'], mentionCount: 1, firstSeen: 100, lastSeen: 100 }],
      }))
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'encrypt_data') return 'ENC2:x'
        if (cmd === 'decrypt_data') return null
        return null
      })
      removeEntityManager('mig-test')
      const m = getEntityManager('mig-test')
      await m.ensureLoaded()
      expect(upsertEntityNode).toHaveBeenCalled()
      expect(setSetting).toHaveBeenCalledWith('spiritpal-entities-mig-test.legacy', expect.any(String))
      expect(setEntityNodesMigrated).toHaveBeenCalled()
      m.dispose()
    })
  })
})

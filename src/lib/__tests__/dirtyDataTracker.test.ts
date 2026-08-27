/**
 * 脏数据追踪器单元测试
 *
 * 测试覆盖：
 * 1. 基础设施创建（表 + 索引）
 * 2. 数据持久化（幂等）
 * 3. 各类检测规则
 * 4. 标记已解决 + 自动修复检测
 * 5. 摘要报告生成
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock db 模块
const mockDb = {
  execute: vi.fn(),
  select: vi.fn(),
}

vi.mock('../db', () => ({
  getDb: vi.fn(() => Promise.resolve(mockDb)),
}))

// Mock auditLogger
vi.mock('../auditLogger', () => ({
  auditLog: vi.fn(() => Promise.resolve()),
  AuditEventType: { SECURITY_EVENT: 'security_event' },
}))

import {
  runDirtyDataChecks,
  getDirtyDataSummary,
  markDirtyDataResolved,
  markTableResolved,
  getIssuesForTable,
  cleanupResolvedDirtyData,
} from '../dirtyDataTracker'

describe('dirtyDataTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 })
    mockDb.select.mockResolvedValue([])
  })

  describe('runDirtyDataChecks', () => {
    it('should create dirty_data_registry table on first run', async () => {
      mockDb.select.mockResolvedValue([])
      await runDirtyDataChecks()

      // 应该执行 CREATE TABLE
      const createTableCall = mockDb.execute.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('dirty_data_registry')
      )
      expect(createTableCall).toBeDefined()
    })

    it('should detect orphan references in inventory', async () => {
      // 设置 mock 行为：让 checkInventoryOrphans 返回数据
      // 所有其他检测返回空数组
      mockDb.select.mockImplementation(async (query: string) => {
        // 对于孤引用查询返回数据
        if (query.includes('inventory i') && query.includes('LEFT JOIN characters')) {
          return [{ id: 'inv-1', character_id: 'char-deleted' }]
        }
        // 对于现有问题的去重检查：返回空表示是新问题
        if (query.includes('dirty_data_registry')) {
          return []
        }
        return []
      })

      await runDirtyDataChecks()

      // 至少有一次 INSERT 操作写入脏数据
      const insertCall = mockDb.execute.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('INSERT INTO dirty_data_registry')
      )
      expect(insertCall).toBeDefined()
    })

    it('should detect invalid JSON in characters.stats', async () => {
      mockDb.select.mockImplementation(async (query: string) => {
        if (query.includes('SELECT id, stats FROM characters')) {
          return [{ id: 'char-1', stats: 'not-json-{{{' }]
        }
        return []
      })

      await runDirtyDataChecks()

      const insertCall = mockDb.execute.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO dirty_data_registry')
      )
      expect(insertCall).toBeDefined()
      // 验证 description 包含角色信息
      expect((insertCall?.[1] as unknown[])?.[5]).toContain('char-1')
    })

    it('should deduplicate issues (same table+row+type)', async () => {
      let selectCallCount = 0
      mockDb.select.mockImplementation(async (query: string) => {
        selectCallCount++
        // 第一次检测到无效 JSON
        if (query.includes('SELECT id, stats FROM characters')) {
          return [{ id: 'char-1', stats: 'invalid-json' }]
        }
        // 去重检查返回已有记录
        if (query.includes('SELECT id FROM dirty_data_registry') && query.includes('table_name =')) {
          return [{ id: 100 }]
        }
        return []
      })

      await runDirtyDataChecks()

      // 应该是 UPDATE 而不是 INSERT
      const updateCall = mockDb.execute.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE dirty_data_registry SET detected_at')
      )
      expect(updateCall).toBeDefined()
      // 不应该有 INSERT
      const insertCall = mockDb.execute.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('INSERT INTO dirty_data_registry')
      )
      expect(insertCall).toBeUndefined()
    })
  })

  describe('getDirtyDataSummary', () => {
    it('should return no issues when empty', async () => {
      mockDb.select.mockResolvedValue([])

      const summary = await getDirtyDataSummary()

      expect(summary.hasIssues).toBe(false)
      expect(summary.totalIssues).toBe(0)
      expect(summary.highestSeverity).toBeNull()
    })

    it('should return summary with issues', async () => {
      mockDb.select.mockImplementation(async (query: string) => {
        if (query.includes('GROUP BY data_type')) {
          return [
            { data_type: 'ORPHAN_REFERENCE', cnt: 2 },
            { data_type: 'CONSTRAINT_VIOLATION', cnt: 1 },
          ]
        }
        if (query.includes('GROUP BY severity')) {
          return [
            { severity: 'medium', cnt: 2 },
            { severity: 'high', cnt: 1 },
          ]
        }
        if (query.includes('WHERE resolved = 0')) {
          return [
            {
              id: 1,
              table_name: 'inventory',
              column_name: null,
              row_id: 'inv-1',
              data_type: 'ORPHAN_REFERENCE',
              severity: 'medium',
              description: 'test issue',
              detected_at: Date.now(),
              resolved: 0,
              resolved_at: null,
              details: null,
            },
          ]
        }
        return []
      })

      const summary = await getDirtyDataSummary()

      expect(summary.hasIssues).toBe(true)
      expect(summary.totalIssues).toBe(3)
      expect(summary.highestSeverity).toBe('high')
      expect(summary.topIssues).toHaveLength(1)
      expect(summary.topIssues[0].table).toBe('inventory')
    })
  })

  describe('markDirtyDataResolved', () => {
    it('should mark issue as resolved', async () => {
      const issueId = 42
      await markDirtyDataResolved(issueId)

      const updateCall = mockDb.execute.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE dirty_data_registry SET resolved = 1')
      )
      expect(updateCall).toBeDefined()
      expect((updateCall?.[1] as unknown[])?.[1]).toBe(issueId)
    })
  })

  describe('markTableResolved', () => {
    it('should mark all issues for table as resolved', async () => {
      mockDb.execute.mockResolvedValue({ rowsAffected: 5 })

      const count = await markTableResolved('inventory')

      expect(count).toBe(5)
      const updateCall = mockDb.execute.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE dirty_data_registry') &&
          call[0].includes('table_name = ?')
      )
      expect(updateCall).toBeDefined()
    })
  })

  describe('getIssuesForTable', () => {
    it('should return issues for specific table', async () => {
      mockDb.select.mockImplementation(async (query: string) => {
        if (query.includes('table_name = ?')) {
          return [
            {
              id: 1,
              table_name: 'characters',
              column_name: 'stats',
              row_id: 'char-1',
              data_type: 'DATA_TYPE_MISMATCH',
              severity: 'high',
              description: 'Invalid JSON',
              detected_at: Date.now(),
              resolved: 0,
              resolved_at: null,
              details: null,
            },
          ]
        }
        return []
      })

      const issues = await getIssuesForTable('characters')

      expect(issues).toHaveLength(1)
      expect(issues[0].table).toBe('characters')
      expect(issues[0].severity).toBe('high')
    })
  })

  describe('cleanupResolvedDirtyData', () => {
    it('should delete old resolved records', async () => {
      mockDb.execute.mockResolvedValue({ rowsAffected: 10 })

      const deleted = await cleanupResolvedDirtyData(30)

      expect(deleted).toBe(10)
      const deleteCall = mockDb.execute.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('DELETE FROM dirty_data_registry')
      )
      expect(deleteCall).toBeDefined()
    })

    it('should use correct threshold for cleanup', async () => {
      mockDb.execute.mockResolvedValue({ rowsAffected: 0 })

      await cleanupResolvedDirtyData(7)

      const deleteCall = mockDb.execute.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('DELETE FROM dirty_data_registry')
      )
      // threshold 参数应该小于当前时间 - 7天
      const threshold = (deleteCall?.[1] as unknown[])?.[0] as number
      expect(threshold).toBeLessThan(Date.now())
      expect(threshold).toBeGreaterThan(Date.now() - 8 * 24 * 60 * 60 * 1000)
    })
  })
})

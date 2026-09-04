/**
 * 脏数据追踪器单元测试
 *
 * 测试覆盖：
 * 1. 数据持久化（幂等）
 * 2. 检测编排（Rust sp_dirty_scan）
 * 3. 标记已解决 + 自动修复检测
 * 4. 摘要报告生成
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock db 模块（干净数据注册表的语义化封装，走 invoke 的 sp_dirty_*）
const mocks = vi.hoisted(() => ({
  scanDirtyData: vi.fn(),
  listDirtyIssues: vi.fn(),
  upsertDirtyIssue: vi.fn(),
  resolveDirtyIssue: vi.fn(),
  resolveDirtyIssuesForTable: vi.fn(),
  cleanupResolvedDirtyData: vi.fn(),
}))

vi.mock('@/lib/data/db', () => mocks)

// Mock auditLogger
vi.mock('@/lib/system/auditLogger', () => ({
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
} from '@/lib/data/dirtyDataTracker'

/** 构造一条 dirty_data_registry 行（DirtyRegistryRow 映射） */
function makeRow(overrides: Record<string, unknown> = {}) {
  const table: string = (overrides.table as string) ?? 'inventory'
  const rowId: string = (overrides.rowId as string) ?? 'inv-1'
  return {
    id: 1,
    kind: 'ORPHAN_REFERENCE',
    target_id: `${table}::${rowId}`,
    payload: JSON.stringify({
      table,
      column: 'character_id',
      severity: 'medium',
      description: 'test issue',
      details: null,
    }),
    detected_at: Date.now(),
    resolved_at: null,
    ...overrides,
  }
}

describe('dirtyDataTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scanDirtyData.mockResolvedValue([])
    mocks.listDirtyIssues.mockResolvedValue([])
    mocks.upsertDirtyIssue.mockResolvedValue(undefined)
    mocks.resolveDirtyIssue.mockResolvedValue(undefined)
    mocks.resolveDirtyIssuesForTable.mockResolvedValue(0)
    mocks.cleanupResolvedDirtyData.mockResolvedValue(0)
  })

  describe('runDirtyDataChecks', () => {
    it('should persist detected issues via upsertDirtyIssue', async () => {
      mocks.scanDirtyData.mockResolvedValueOnce([
        {
          table: 'inventory', column: 'character_id', rowId: 'inv-1',
          dataType: 'ORPHAN_REFERENCE', severity: 'medium',
          description: '背包物品引用的角色 char-deleted 不存在', detectedAt: 100,
        },
      ])

      await runDirtyDataChecks()

      expect(mocks.scanDirtyData).toHaveBeenCalled()
      expect(mocks.upsertDirtyIssue).toHaveBeenCalled()
      const args = mocks.upsertDirtyIssue.mock.calls[0]
      expect(args[0]).toBe('ORPHAN_REFERENCE')
      expect(args[1]).toBe('inventory::inv-1')
      expect(args[2]).toContain('"table":"inventory"')
    })

    it('should detect invalid JSON in characters.stats via sp_dirty_scan', async () => {
      mocks.scanDirtyData.mockResolvedValueOnce([
        {
          table: 'characters', column: 'stats', rowId: 'char-1',
          dataType: 'DATA_TYPE_MISMATCH', severity: 'high',
          description: '角色 char-1 的 stats 字段不是有效 JSON',
          details: 'not-json-{{{', detectedAt: 200,
        },
      ])

      await runDirtyDataChecks()

      const args = mocks.upsertDirtyIssue.mock.calls[0]
      expect(args[0]).toBe('DATA_TYPE_MISMATCH')
      // 持久化的 description 来自检测结果
      expect(args[2]).toContain('char-1')
    })

    it('should resolve previously-open issues no longer present', async () => {
      // 当前检测不到任何问题
      mocks.scanDirtyData.mockResolvedValueOnce([])
      // 但注册表中有一条未解决的旧问题
      mocks.listDirtyIssues.mockResolvedValueOnce([makeRow({ id: 9 })])

      await runDirtyDataChecks()

      // 旧问题不再存在 → 自动解决
      expect(mocks.resolveDirtyIssue).toHaveBeenCalledWith(9, expect.any(Number))
    })
  })

  describe('getDirtyDataSummary', () => {
    it('should return no issues when empty', async () => {
      mocks.listDirtyIssues.mockResolvedValue([])

      const summary = await getDirtyDataSummary()

      expect(summary.hasIssues).toBe(false)
      expect(summary.totalIssues).toBe(0)
      expect(summary.highestSeverity).toBeNull()
    })

    it('should return summary with issues', async () => {
      mocks.listDirtyIssues.mockResolvedValueOnce([
        makeRow({ id: 1, table: 'inventory', rowId: 'inv-1', payload: JSON.stringify({ table: 'inventory', column: null, severity: 'medium', description: 'x', details: null }) }),
        makeRow({ id: 2, table: 'characters', rowId: 'char-1', kind: 'CONSTRAINT_VIOLATION', payload: JSON.stringify({ table: 'characters', column: 'stats', severity: 'high', description: 'y', details: null }) }),
      ])

      const summary = await getDirtyDataSummary()

      expect(summary.hasIssues).toBe(true)
      expect(summary.totalIssues).toBe(2)
      expect(summary.highestSeverity).toBe('high')
      expect(summary.topIssues).toHaveLength(2)
    })
  })

  describe('markDirtyDataResolved', () => {
    it('should mark issue as resolved', async () => {
      const issueId = 42
      await markDirtyDataResolved(issueId)

      expect(mocks.resolveDirtyIssue).toHaveBeenCalledWith(42, expect.any(Number))
    })
  })

  describe('markTableResolved', () => {
    it('should mark all issues for table as resolved', async () => {
      mocks.resolveDirtyIssuesForTable.mockResolvedValueOnce(5)

      const count = await markTableResolved('inventory')

      expect(count).toBe(5)
      expect(mocks.resolveDirtyIssuesForTable).toHaveBeenCalledWith('inventory', expect.any(Number))
    })
  })

  describe('getIssuesForTable', () => {
    it('should return issues for specific table', async () => {
      mocks.listDirtyIssues.mockResolvedValueOnce([
        makeRow({
          id: 1,
          table: 'characters',
          rowId: 'char-1',
          kind: 'DATA_TYPE_MISMATCH',
          payload: JSON.stringify({ table: 'characters', column: 'stats', severity: 'high', description: 'Invalid JSON', details: null }),
        }),
        makeRow({ id: 2, table: 'inventory', rowId: 'inv-2' }), // 其他表应被过滤
      ])

      const issues = await getIssuesForTable('characters')

      expect(issues).toHaveLength(1)
      expect(issues[0].table).toBe('characters')
      expect(issues[0].severity).toBe('high')
    })
  })

  describe('cleanupResolvedDirtyData', () => {
    it('should delete old resolved records', async () => {
      mocks.cleanupResolvedDirtyData.mockResolvedValueOnce(10)

      const deleted = await cleanupResolvedDirtyData(30)

      expect(deleted).toBe(10)
      // threshold ≈ now - 30 天
      const threshold = mocks.cleanupResolvedDirtyData.mock.calls[0][0] as number
      expect(threshold).toBeLessThan(Date.now())
      expect(threshold).toBeGreaterThan(Date.now() - 31 * 24 * 60 * 60 * 1000)
    })
  })
})
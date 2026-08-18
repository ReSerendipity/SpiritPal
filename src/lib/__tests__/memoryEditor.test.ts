/**
 * memoryEditor.test.ts
 *
 * 记忆自编辑工具单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MemoryEditor,
  createMemoryEditor,
  type MemorySearchOptions,
  type MemoryBatchOperation,
  type MemoryEditResult,
} from '../memoryEditor'
import { EnhancedMemoryManager } from '../enhancedMemory'
import { type EnhancedMemory } from '../memoryTypes'

// Mock EnhancedMemoryManager
vi.mock('../enhancedMemory', () => ({
  EnhancedMemoryManager: vi.fn(),
}))

describe('MemoryEditor', () => {
  let memoryEditor: MemoryEditor
  let mockMemoryManager: EnhancedMemoryManager
  let mockMemories: EnhancedMemory[]

  beforeEach(() => {
    // 创建测试记忆数据
    mockMemories = [
      {
        id: 'mem-1',
        created_at: '2026-01-01T10:00:00.000Z',
        user: '今天天气真好，心情很愉快',
        assistant: '',
        importance: 80,
        emotionalIntensity: 0.7,
        category: '日常',
        tags: ['天气', '心情'],
        accessCount: 5,
        lastAccessed: Date.now() - 10000,
        decayFactor: 1.0,
        isAutobiographical: false,
        emotionalValence: 0.8,
        emotionalArousal: 0.6,
        strength: 1.0,
        sourceKind: 'exchange',
      },
      {
        id: 'mem-2',
        created_at: '2026-01-02T15:30:00.000Z',
        user: '工作中遇到了一个难题，感觉压力很大',
        assistant: '',
        importance: 60,
        emotionalIntensity: -0.3,
        category: '工作',
        tags: ['工作', '压力'],
        accessCount: 2,
        lastAccessed: Date.now() - 5000,
        decayFactor: 1.0,
        isAutobiographical: false,
        emotionalValence: -0.4,
        emotionalArousal: 0.7,
        strength: 1.0,
        sourceKind: 'exchange',
      },
      {
        id: 'mem-3',
        created_at: '2026-01-03T20:15:00.000Z',
        user: '和朋友们聚餐，聊了很多有趣的话题',
        assistant: '',
        importance: 70,
        emotionalIntensity: 0.5,
        category: '社交',
        tags: ['朋友', '聚餐'],
        accessCount: 8,
        lastAccessed: Date.now(),
        decayFactor: 1.0,
        isAutobiographical: true,
        emotionalValence: 0.6,
        emotionalArousal: 0.5,
        strength: 1.0,
        sourceKind: 'exchange',
      },
    ]

    // Mock EnhancedMemoryManager 实例
    mockMemoryManager = {
      getAllMemories: vi.fn().mockReturnValue(mockMemories),
    } as unknown as EnhancedMemoryManager

    vi.clearAllMocks()
    memoryEditor = createMemoryEditor(mockMemoryManager)
  })

  describe('基础 CRUD 操作', () => {
    it('应该成功创建记忆', async () => {
      const result = await memoryEditor.createMemory('测试记忆内容', {
        category: '测试',
        tags: ['测试标签'],
        importance: 50,
        emotionalIntensity: 0.3,
      })

      expect(result.success).toBe(true)
      expect(result.details?.createdMemoryId).toBeDefined()
    })

    it('应该成功读取记忆', async () => {
      const result = await memoryEditor.readMemory('mem-1')

      expect(result.success).toBe(true)
    })

    it('读取不存在的记忆应该失败', async () => {
      const result = await memoryEditor.readMemory('mem-999')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('应该成功更新记忆', async () => {
      const result = await memoryEditor.updateMemory('mem-1', {
        content: '更新后的内容',
        importance: 90,
      })

      expect(result.success).toBe(true)
      expect(result.details?.updatedMemoryId).toBe('mem-1')
    })

    it('更新不存在的记忆应该失败', async () => {
      const result = await memoryEditor.updateMemory('mem-999', {
        content: '更新后的内容',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('应该成功删除记忆', async () => {
      const result = await memoryEditor.deleteMemory('mem-1')

      expect(result.success).toBe(true)
      expect(result.details?.deletedMemoryId).toBe('mem-1')
    })

    it('删除不存在的记忆应该失败', async () => {
      const result = await memoryEditor.deleteMemory('mem-999')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('搜索功能', () => {
    it('应该按关键词搜索记忆', async () => {
      const options: MemorySearchOptions = {
        query: '天气',
      }

      const result = await memoryEditor.searchMemories(options)

      expect(result.success).toBe(true)
      expect(result.affectedCount).toBe(1)
      const memories = result.details?.memories as EnhancedMemory[]
      expect(memories[0].id).toBe('mem-1')
    })

    it('应该按分类过滤记忆', async () => {
      const options: MemorySearchOptions = {
        categories: ['工作'],
      }

      const result = await memoryEditor.searchMemories(options)

      expect(result.success).toBe(true)
      expect(result.affectedCount).toBe(1)
      const memories = result.details?.memories as EnhancedMemory[]
      expect(memories[0].id).toBe('mem-2')
    })

    it('应该按重要性范围过滤记忆', async () => {
      const options: MemorySearchOptions = {
        importanceRange: {
          min: 70,
          max: 100,
        },
      }

      const result = await memoryEditor.searchMemories(options)

      expect(result.success).toBe(true)
      expect(result.affectedCount).toBe(2)
    })

    it('应该按标签过滤记忆', async () => {
      const options: MemorySearchOptions = {
        tags: ['朋友'],
      }

      const result = await memoryEditor.searchMemories(options)

      expect(result.success).toBe(true)
      expect(result.affectedCount).toBe(1)
      const memories = result.details?.memories as EnhancedMemory[]
      expect(memories[0].id).toBe('mem-3')
    })

    it('应该按重要性排序', async () => {
      const options: MemorySearchOptions = {
        sortBy: 'importance',
        sortOrder: 'desc',
      }

      const result = await memoryEditor.searchMemories(options)

      expect(result.success).toBe(true)
      const memories = result.details?.memories as EnhancedMemory[]
      expect(memories[0].importance).toBeGreaterThanOrEqual(memories[1].importance)
    })

    it('应该限制结果数量', async () => {
      const options: MemorySearchOptions = {
        limit: 2,
      }

      const result = await memoryEditor.searchMemories(options)

      expect(result.success).toBe(true)
      expect(result.affectedCount).toBeLessThanOrEqual(2)
    })
  })

  describe('批量操作', () => {
    it('应该执行批量删除', async () => {
      const operation: MemoryBatchOperation = {
        type: 'delete',
        memoryIds: ['mem-1', 'mem-2'],
      }

      const result = await memoryEditor.executeBatchOperation(operation)

      expect(result.success).toBe(true)
      expect(result.affectedCount).toBe(2)

      const batchResults = result.details?.batchResults as Array<{ memoryId: string; success: boolean }>
      if (batchResults) {
        expect(batchResults.every(r => r.success)).toBe(true)
      }
    })

    it('应该执行批量更新重要性', async () => {
      const operation: MemoryBatchOperation = {
        type: 'update_importance',
        memoryIds: ['mem-1', 'mem-2'],
        params: {
          importance: 90,
        },
      }

      const result = await memoryEditor.executeBatchOperation(operation)

      expect(result.success).toBe(true)
      expect(result.affectedCount).toBe(2)
    })

    it('应该执行批量更新分类', async () => {
      const operation: MemoryBatchOperation = {
        type: 'update_category',
        memoryIds: ['mem-1'],
        params: {
          category: '新分类',
        },
      }

      const result = await memoryEditor.executeBatchOperation(operation)

      expect(result.success).toBe(true)
      expect(result.affectedCount).toBe(1)
    })

    it('缺少参数的批量操作应该失败', async () => {
      const operation: MemoryBatchOperation = {
        type: 'update_importance',
        memoryIds: ['mem-1'],
        // 缺少 importance 参数
      }

      const result = await memoryEditor.executeBatchOperation(operation)

      expect(result.success).toBe(false)
      const batchResults = result.details?.batchResults as Array<{ memoryId: string; success: boolean; error?: string }>
      if (batchResults) {
        expect(batchResults[0].success).toBe(false)
        expect(batchResults[0].error).toContain('Missing importance parameter')
      }
    })
  })

  describe('统计信息', () => {
    it('应该获取完整的统计信息', async () => {
      const result = await memoryEditor.getMemoryStats()

      expect(result.success).toBe(true)
      expect(result.affectedCount).toBe(3)

      const stats = result.details?.stats as { 
        totalCount: number
        categoryDistribution: Record<string, number>
        importanceDistribution: { low: number; medium: number; high: number }
        emotionalIntensityDistribution: { neutral: number; positive: number; negative: number }
      }

      if (stats) {
        expect(stats.totalCount).toBe(3)
        expect(stats.categoryDistribution['日常']).toBe(1)
        expect(stats.categoryDistribution['工作']).toBe(1)
        expect(stats.categoryDistribution['社交']).toBe(1)
        expect(stats.importanceDistribution.high).toBe(2)
        expect(stats.importanceDistribution.medium).toBe(1)
        expect(stats.emotionalIntensityDistribution.positive).toBe(2)
        expect(stats.emotionalIntensityDistribution.negative).toBe(1)
      }
    })
  })

  describe('操作日志', () => {
    it('应该记录操作日志', async () => {
      await memoryEditor.createMemory('测试记忆')
      await memoryEditor.readMemory('mem-1')
      await memoryEditor.deleteMemory('mem-2')

      const log = memoryEditor.getOperationLog()
      expect(log).toHaveLength(3)
      expect(log[0].operation).toBe('create')
      expect(log[1].operation).toBe('read')
      expect(log[2].operation).toBe('delete')
    })

    it('应该清空操作日志', async () => {
      await memoryEditor.createMemory('测试记忆')
      expect(memoryEditor.getOperationLog()).toHaveLength(1)

      memoryEditor.clearOperationLog()
      expect(memoryEditor.getOperationLog()).toHaveLength(0)
    })
  })

  describe('便捷函数', () => {
    it('createMemoryEditor 应该返回 MemoryEditor 实例', () => {
      const editor = createMemoryEditor(mockMemoryManager)
      expect(editor).toBeInstanceOf(MemoryEditor)
    })
  })

  describe('错误处理', () => {
    it('应该处理搜索记忆时的错误', async () => {
      vi.spyOn(mockMemoryManager, 'getAllMemories').mockImplementation(() => {
        throw new Error('Search failed')
      })

      const result = await memoryEditor.searchMemories({ query: 'test' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Search failed')
    })

    it('应该处理获取统计信息时的错误', async () => {
      vi.spyOn(mockMemoryManager, 'getAllMemories').mockImplementation(() => {
        throw new Error('Stats failed')
      })

      const result = await memoryEditor.getMemoryStats()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Stats failed')
    })
  })
})
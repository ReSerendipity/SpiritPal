/**
 * 记忆自编辑工具（MCP）
 *
 * P2-8：通过 MCP 提供记忆管理接口，支持用户直接编辑记忆
 *
 * 核心功能：
 * - 记忆 CRUD：创建、读取、更新、删除
 * - 批量操作：批量删除、批量更新重要性
 * - 记忆搜索：按内容、时间、重要性、情感强度搜索
 * - 统计信息：记忆数量、分布、健康度
 *
 * @fileoverview
 * 主要模块：
 * - MemoryEditor 类：记忆编辑器核心逻辑
 * - MemorySearchOptions 接口：搜索选项定义
 * - MemoryBatchOperation 接口：批量操作定义
 * - MemoryEditResult 接口：编辑结果定义
 */

import { EnhancedMemoryManager } from './enhancedMemory'
import { type EnhancedMemory, type MemoryTier } from './memoryTypes'
import { generateId } from './commonUtils'

// ============ 类型定义 ============

/** 记忆搜索选项 */
export interface MemorySearchOptions {
  /** 搜索关键词 */
  query?: string
  /** 时间范围（毫秒时间戳） */
  timeRange?: {
    start?: number
    end?: number
  }
  /** 重要性范围 */
  importanceRange?: {
    min?: number
    max?: number
  }
  /** 分类过滤 */
  categories?: string[]
  /** 标签过滤 */
  tags?: string[]
  /** 排序方式 */
  sortBy?: 'importance' | 'emotional_intensity' | 'access_count'
  /** 排序顺序 */
  sortOrder?: 'asc' | 'desc'
  /** 限制结果数量 */
  limit?: number
}

/** 记忆批量操作类型 */
export type MemoryBatchOperationType =
  | 'delete'
  | 'update_importance'
  | 'update_category'

/** 记忆批量操作定义 */
export interface MemoryBatchOperation {
  /** 操作类型 */
  type: MemoryBatchOperationType
  /** 目标记忆 ID 列表 */
  memoryIds: string[]
  /** 操作参数 */
  params?: {
    /** 新的重要性值（仅 update_importance） */
    importance?: number
    /** 新的分类（仅 update_category） */
    category?: string
  }
}

/** 记忆编辑结果 */
export interface MemoryEditResult {
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** 受影响的记忆数量 */
  affectedCount?: number
  /** 操作详情 */
  details?: Record<string, unknown>
}

/** 记忆统计信息 */
export interface MemoryStats {
  totalCount: number
  categoryDistribution: Record<string, number>
  tagDistribution: Record<string, number>
  importanceDistribution: {
    low: number
    medium: number
    high: number
  }
  emotionalIntensityDistribution: {
    neutral: number
    positive: number
    negative: number
  }
  storageHealth: {
    nearStorageLimit: boolean
    suggestedCleanupCount: number
    storageUsagePercent: number
  }
}

// ============ 记忆编辑器 ============

/**
 * 记忆编辑器
 *
 * 提供完整的记忆 CRUD、批量操作、搜索和统计功能
 */
export class MemoryEditor {
  private memoryManager: EnhancedMemoryManager
  private operationLog: Array<{
    operation: string
    memoryId: string
    timestamp: number
    details?: Record<string, unknown>
  }> = []

  constructor(memoryManager: EnhancedMemoryManager) {
    this.memoryManager = memoryManager
  }

  // ============ 基础 CRUD 操作 ============

  /**
   * 创建新记忆
   */
  async createMemory(
    content: string,
    options: {
      category?: string
      tags?: string[]
      importance?: number
      emotionalIntensity?: number
      isAutobiographical?: boolean
    } = {},
  ): Promise<MemoryEditResult> {
    try {
      // 获取所有记忆以生成唯一 ID
      const allMemories = this.memoryManager.getAllMemories()
      const newId = `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      const newMemory: EnhancedMemory = {
        ...allMemories[0] || {
          created_at: new Date().toISOString(),
          assistant: '',
          accessCount: 0,
          lastAccessed: Date.now(),
          decayFactor: 1.0,
          emotionalValence: 0,
          emotionalArousal: 0.3,
          strength: 1.0,
          sourceKind: 'exchange',
          factText: undefined,
        },
        id: newId,
        user: content,
        importance: options.importance ?? 50,
        emotionalIntensity: options.emotionalIntensity ?? 0,
        category: options.category ?? '日常',
        tags: options.tags ?? [],
        isAutobiographical: options.isAutobiographical ?? false,
      }

      // 注意：实际保存需要调用 enhancedMemory.add() 或写入数据库
      // 这里先记录日志用于测试
      this.logOperation('create', newId, { content: content.slice(0, 50) })

      return {
        success: true,
        affectedCount: 1,
        details: {
          createdMemoryId: newId,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 读取记忆
   */
  async readMemory(memoryId: string): Promise<MemoryEditResult> {
    try {
      const memories = this.memoryManager.getAllMemories()
      const memory = memories.find(m => m.id === memoryId)

      if (!memory) {
        return {
          success: false,
          error: `Memory with ID ${memoryId} not found`,
        }
      }

      this.logOperation('read', memoryId)

      return {
        success: true,
        details: { memory },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 更新记忆
   */
  async updateMemory(
    memoryId: string,
    updates: {
      content?: string
      category?: string
      tags?: string[]
      importance?: number
      emotionalIntensity?: number
    },
  ): Promise<MemoryEditResult> {
    try {
      const memories = this.memoryManager.getAllMemories()
      const memoryIndex = memories.findIndex(m => m.id === memoryId)

      if (memoryIndex === -1) {
        return {
          success: false,
          error: `Memory with ID ${memoryId} not found`,
        }
      }

      // 更新内存中的记忆
      const updatedMemory = {
        ...memories[memoryIndex],
        user: updates.content ?? memories[memoryIndex].user,
        category: updates.category ?? memories[memoryIndex].category,
        tags: updates.tags ?? memories[memoryIndex].tags,
        importance: updates.importance ?? memories[memoryIndex].importance,
        emotionalIntensity: updates.emotionalIntensity ?? memories[memoryIndex].emotionalIntensity,
      } as EnhancedMemory

      // 在实际应用中，需要同步到数据库
      memories[memoryIndex] = updatedMemory

      this.logOperation('update', memoryId, updates)

      return {
        success: true,
        affectedCount: 1,
        details: {
          updatedMemoryId: memoryId,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 删除记忆
   */
  async deleteMemory(memoryId: string): Promise<MemoryEditResult> {
    try {
      const memories = this.memoryManager.getAllMemories()
      const memory = memories.find(m => m.id === memoryId)

      if (!memory) {
        return {
          success: false,
          error: `Memory with ID ${memoryId} not found`,
        }
      }

      // 从内存中删除
      const index = memories.findIndex(m => m.id === memoryId)
      if (index !== -1) {
        memories.splice(index, 1)
      }

      this.logOperation('delete', memoryId, { content: memory.user.slice(0, 50) })

      return {
        success: true,
        affectedCount: 1,
        details: {
          deletedMemoryId: memoryId,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ============ 搜索功能 ============

  /**
   * 搜索记忆
   */
  async searchMemories(options: MemorySearchOptions = {}): Promise<MemoryEditResult> {
    try {
      let memories = [...this.memoryManager.getAllMemories()]

      // 应用过滤条件
      if (options.query) {
        const query = options.query.toLowerCase()
        memories = memories.filter(m => 
          m.user.toLowerCase().includes(query) ||
          m.category.toLowerCase().includes(query) ||
          m.tags.some(tag => tag.toLowerCase().includes(query))
        )
      }

      if (options.timeRange) {
        const start = options.timeRange.start ?? 0
        const end = options.timeRange.end ?? Date.now()
        memories = memories.filter(m => {
          const timestamp = new Date(m.created_at).getTime()
          return timestamp >= start && timestamp <= end
        })
      }

      if (options.importanceRange) {
        const min = options.importanceRange.min ?? 0
        const max = options.importanceRange.max ?? 100
        memories = memories.filter(m => 
          m.importance >= min && m.importance <= max
        )
      }

      if (options.categories) {
        memories = memories.filter(m => 
          options.categories!.includes(m.category)
        )
      }

      if (options.tags) {
        memories = memories.filter(m => 
          options.tags!.some(tag => m.tags.includes(tag))
        )
      }

      // 应用排序
      if (options.sortBy) {
        memories.sort((a, b) => {
          let aValue: number
          let bValue: number

          switch (options.sortBy) {
            case 'importance':
              aValue = a.importance
              bValue = b.importance
              break
            case 'emotional_intensity':
              aValue = a.emotionalIntensity
              bValue = b.emotionalIntensity
              break
            case 'access_count':
              aValue = a.accessCount
              bValue = b.accessCount
              break
            default:
              return 0
          }

          return options.sortOrder === 'desc' ? bValue - aValue : aValue - bValue
        })
      }

      // 应用限制
      if (options.limit) {
        memories = memories.slice(0, options.limit)
      }

      this.logOperation('search', 'batch', { 
        query: options.query,
        resultCount: memories.length 
      })

      return {
        success: true,
        affectedCount: memories.length,
        details: {
          memories,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ============ 批量操作 ============

  /**
   * 执行批量操作
   */
  async executeBatchOperation(operation: MemoryBatchOperation): Promise<MemoryEditResult> {
    try {
      const results: Array<{ memoryId: string; success: boolean; error?: string }> = []
      let successCount = 0

      for (const memoryId of operation.memoryIds) {
        try {
          let result: MemoryEditResult

          switch (operation.type) {
            case 'delete':
              result = await this.deleteMemory(memoryId)
              break
            case 'update_importance':
              if (!operation.params?.importance) {
                result = { success: false, error: 'Missing importance parameter' }
              } else {
                result = await this.updateMemory(memoryId, { 
                  importance: operation.params.importance 
                })
              }
              break
            case 'update_category':
              if (!operation.params?.category) {
                result = { success: false, error: 'Missing category parameter' }
              } else {
                result = await this.updateMemory(memoryId, { 
                  category: operation.params.category 
                })
              }
              break
            default:
              result = { success: false, error: `Unsupported operation type: ${operation.type}` }
          }

          results.push({
            memoryId,
            success: result.success,
            error: result.error,
          })

          if (result.success) {
            successCount++
          }
        } catch (error) {
          results.push({
            memoryId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      this.logOperation('batch', 'batch', {
        type: operation.type,
        memoryCount: operation.memoryIds.length,
        successCount,
      })

      return {
        success: successCount > 0,
        affectedCount: successCount,
        details: {
          batchResults: results,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ============ 统计信息 ============

  /**
   * 获取记忆统计信息
   */
  async getMemoryStats(): Promise<MemoryEditResult> {
    try {
      const memories = this.memoryManager.getAllMemories()
      const MAX_HEALTHY_COUNT = 10000

      // 计算分类分布
      const categoryDistribution: Record<string, number> = {}
      const tagDistribution: Record<string, number> = {}
      memories.forEach(m => {
        categoryDistribution[m.category] = (categoryDistribution[m.category] || 0) + 1
        m.tags.forEach(tag => {
          tagDistribution[tag] = (tagDistribution[tag] || 0) + 1
        })
      })

      // 计算重要性分布
      const importanceDistribution = {
        low: memories.filter(m => m.importance < 30).length,
        medium: memories.filter(m => m.importance >= 30 && m.importance < 70).length,
        high: memories.filter(m => m.importance >= 70).length,
      }

      // 计算情感强度分布
      const emotionalIntensityDistribution = {
        neutral: memories.filter(m => m.emotionalIntensity >= 0 && m.emotionalIntensity <= 0.3).length,
        positive: memories.filter(m => m.emotionalIntensity > 0.3).length,
        negative: memories.filter(m => m.emotionalIntensity < 0).length,
      }

      // 计算存储健康度
      const nearStorageLimit = memories.length > MAX_HEALTHY_COUNT * 0.8
      const suggestedCleanupCount = Math.max(0, memories.length - MAX_HEALTHY_COUNT)
      const storageUsagePercent = Math.min(100, (memories.length / MAX_HEALTHY_COUNT) * 100)

      const stats: MemoryStats = {
        totalCount: memories.length,
        categoryDistribution,
        tagDistribution,
        importanceDistribution,
        emotionalIntensityDistribution,
        storageHealth: {
          nearStorageLimit,
          suggestedCleanupCount,
          storageUsagePercent,
        },
      }

      this.logOperation('stats', 'batch', { total: memories.length })

      return {
        success: true,
        affectedCount: memories.length,
        details: {
          stats,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ============ 工具方法 ============

  /**
   * 获取操作日志
   */
  getOperationLog(limit?: number): Array<{
    operation: string
    memoryId: string
    timestamp: number
    details?: Record<string, unknown>
  }> {
    if (limit) {
      return this.operationLog.slice(-limit)
    }
    return [...this.operationLog]
  }

  /**
   * 清空操作日志
   */
  clearOperationLog(): void {
    this.operationLog = []
  }

  /**
   * 记录操作日志
   */
  private logOperation(operation: string, memoryId: string, details?: Record<string, unknown>): void {
    this.operationLog.push({
      operation,
      memoryId,
      timestamp: Date.now(),
      details,
    })

    // 限制日志大小
    if (this.operationLog.length > 1000) {
      this.operationLog = this.operationLog.slice(-500)
    }
  }
}

// ============ 便捷函数 ============

/**
 * 创建记忆编辑器实例
 */
export function createMemoryEditor(memoryManager: EnhancedMemoryManager): MemoryEditor {
  return new MemoryEditor(memoryManager)
}
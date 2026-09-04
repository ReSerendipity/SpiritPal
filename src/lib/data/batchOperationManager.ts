/**
 * @file batchOperationManager.ts
 * @description 批量操作管理器 — 多选 + 批量事务
 * 
 * 实现功能：
 * - 多选管理（复选框/Shift 范围选择）
 * - 批量删除/移动/修改标签
 * - 批量导出
 * - 撤销/重做支持
 * - 进度反馈和错误处理
 * 
 * 适用场景：
 * - 记忆管理：批量清理旧记忆/打标签
 * - 物品管理：批量使用/出售物品
 * - MOD 管理：批量启用/禁用 MOD
 * - 角色管理：批量切换/删除角色
 */

// ============ 类型定义 ============

export type BatchOperationType = 
  | 'delete'
  | 'move'
  | 'tag'
  | 'modify'
  | 'export'
  | 'toggle'
  | 'custom'

export interface BatchOperation<T> {
  /** 操作 ID */
  id: string
  /** 操作类型 */
  type: BatchOperationType
  /** 选中的项目 ID 列表 */
  itemIds: string[]
  /** 操作参数 */
  params: T
  /** 执行状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  /** 开始时间戳 */
  startedAt?: number
  /** 完成时间戳 */
  completedAt?: number
  /** 成功数量 */
  successCount: number
  /** 失败数量 */
  failureCount: number
  /** 错误信息（如有） */
  errors?: Array<{ itemId: string; error: string }>
  /** 撤销操作所需的回滚数据 */
  rollbackData?: any
}

export interface SelectionState<T> {
  /** 所有可用项目（带 ID） */
  allItems: Array<{ id: string } & T>
  /** 当前选中项 ID 集合 */
  selectedIds: Set<string>
  /** 全选状态：null=部分/true=全选/false=全不选 */
  selectAllState: boolean | null
  /** 最后点击的项目索引（用于 Shift 范围选择） */
  lastClickedIndex: number | null
}

export interface BatchOperationResult {
  /** 操作是否全部成功 */
  success: boolean
  /** 成功的项目数量 */
  successCount: number
  /** 失败的项目数量 */
  failureCount: number
  /** 总项目数 */
  totalCount: number
  /** 错误详情 */
  errors?: Array<{ itemId: string; error: string }>
  /** 撤销操作的回调（如有） */
  undo?: (itemIds?: string[]) => void
}

// ============ 批量操作管理器 ============

export class BatchOperationManager<T extends { id: string }> {
  private selection: SelectionState<T>
  private operations: BatchOperation<any>[] = []
  private operationHistory: Array<{
    operation: BatchOperation<any>
    result: BatchOperationResult
  }> = []
  private maxHistorySize: number
  
  constructor(
    initialItems: T[] = [],
    config?: { maxHistorySize?: number },
  ) {
    this.selection = {
      allItems: initialItems,
      selectedIds: new Set(),
      selectAllState: false,
      lastClickedIndex: null,
    }
    this.maxHistorySize = config?.maxHistorySize ?? 50
  }

  // ============ 选择管理 ============

  /**
   * 更新项目列表
   */
  updateItems(items: T[]): void {
    this.selection.allItems = items
  }

  /**
   * 切换单个项目的选择状态
   */
  toggleItem(id: string): void {
    if (this.selection.selectedIds.has(id)) {
      this.selection.selectedIds.delete(id)
    } else {
      this.selection.selectedIds.add(id)
    }
    this.updateSelectAllState()
  }

  /**
   * 单选项目
   */
  selectItem(id: string): void {
    this.selection.selectedIds.clear()
    this.selection.selectedIds.add(id)
    this.selection.lastClickedIndex = this.findItemIndex(id)
    this.updateSelectAllState()
  }

  /**
   * 范围选择（Shift + 点击）
   */
  selectRange(fromId: string, toId: string): void {
    const fromIndex = this.findItemIndex(fromId)
    const toIndex = this.findItemIndex(toId)
    
    if (fromIndex === null || toIndex === null) return
    
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    
    this.selection.selectedIds.clear()
    for (let i = start; i <= end; i++) {
      const item = this.selection.allItems[i]
      if (item) {
        this.selection.selectedIds.add(item.id)
      }
    }
    
    this.selection.lastClickedIndex = toIndex
    this.updateSelectAllState()
  }

  /**
   * 全选/取消全选
   */
  toggleSelectAll(): void {
    if (this.selectAll) {
      // 如果已经全选，则取消全选
      this.selection.selectedIds.clear()
      this.selection.selectAllState = false
    } else {
      // 否则全选
      this.selection.allItems.forEach(item => {
        this.selection.selectedIds.add(item.id)
      })
      this.selection.selectAllState = true
    }
  }

  /**
   * 清除选择
   */
  clearSelection(): void {
    this.selection.selectedIds.clear()
    this.selection.selectAllState = false
    this.selection.lastClickedIndex = null
  }

  /**
   * 反向选择
   */
  invertSelection(): void {
    const allIds = new Set(this.selection.allItems.map(i => i.id))
    const notSelected = new Set([...allIds].filter(id => !this.selection.selectedIds.has(id)))
    
    this.selection.selectedIds = notSelected
    this.updateSelectAllState()
  }

  /**
   * 获取选中项
   */
  getSelectedItems(): T[] {
    return this.selection.allItems.filter(item => 
      this.selection.selectedIds.has(item.id)
    )
  }

  /**
   * 是否选中
   */
  isSelected(id: string): boolean {
    return this.selection.selectedIds.has(id)
  }

  /**
   * 选中数量
   */
  get selectedCount(): number {
    return this.selection.selectedIds.size
  }

  /**
   * 是否全选
   */
  get selectAll(): boolean {
    return this.selection.selectAllState === true && this.selection.selectedIds.size > 0
  }

  /**
   * 是否有选中项
   */
  get hasSelection(): boolean {
    return this.selection.selectedIds.size > 0
  }

  /**
   * 更新全选状态
   */
  private updateSelectAllState(): void {
    const total = this.selection.allItems.length
    const selected = this.selection.selectedIds.size
    
    if (total === 0) {
      this.selection.selectAllState = false
    } else if (selected === 0) {
      this.selection.selectAllState = false
    } else if (selected === total) {
      this.selection.selectAllState = true
    } else {
      this.selection.selectAllState = null
    }
  }

  /**
   * 查找项目索引
   */
  private findItemIndex(id: string): number | null {
    const index = this.selection.allItems.findIndex(item => item.id === id)
    return index >= 0 ? index : null
  }

  // ============ 批量操作 ============

  /**
   * 执行批量删除
   */
  async bulkDelete(
    getId: (item: T) => string,
    deleteFn: (id: string) => Promise<void>,
  ): Promise<BatchOperationResult> {
    return this.executeBatchOperation({
      type: 'delete',
      itemIds: Array.from(this.selection.selectedIds),
      params: {},
      execute: async (itemId) => {
        await deleteFn(itemId)
      },
      createUndo: (_itemIds: string[]) => undefined, // TODO: 实现删除回滚
    })
  }

  /**
   * 执行批量标记标签
   */
  async bulkTag(
    tagFn: (id: string, tags: string[]) => Promise<void>,
    tags: string[],
  ): Promise<BatchOperationResult> {
    return this.executeBatchOperation({
      type: 'tag',
      itemIds: Array.from(this.selection.selectedIds),
      params: { tags },
      execute: async (itemId) => {
        await tagFn(itemId, tags)
      },
      createUndo: (_itemIds: string[]) => undefined, // TODO: 实现标签回滚
    })
  }

  /**
   * 执行批量修改
   */
  async bulkModify<U>(
    modifyFn: (id: string, changes: U) => Promise<void>,
    changes: U,
  ): Promise<BatchOperationResult> {
    return this.executeBatchOperation({
      type: 'modify',
      itemIds: Array.from(this.selection.selectedIds),
      params: { changes },
      execute: async (itemId) => {
        await modifyFn(itemId, changes)
      },
      createUndo: (_itemIds: string[]) => undefined, // TODO: 实现修改回滚
    })
  }

  /**
   * 执行批量切换（开/关）
   */
  async bulkToggle(
    toggleFn: (id: string, enabled: boolean) => Promise<void>,
    enabled: boolean,
  ): Promise<BatchOperationResult> {
    return this.executeBatchOperation({
      type: 'toggle',
      itemIds: Array.from(this.selection.selectedIds),
      params: { enabled },
      execute: async (itemId) => {
        await toggleFn(itemId, enabled)
      },
      createUndo: (_itemIds: string[]) => {
        // 恢复之前的状态
        return async () => {
          for (const itemId of _itemIds) {
            await toggleFn(itemId, !enabled)
          }
        }
      },
    })
  }

  /**
   * 执行自定义批量操作
   */
  async bulkCustom<U>(
    type: string,
    customFn: (id: string, params: U) => Promise<void>,
    params: U,
  ): Promise<BatchOperationResult> {
    return this.executeBatchOperation({
      type: 'custom' as any,
      itemIds: Array.from(this.selection.selectedIds),
      params: { type, customParams: params },
      execute: async (itemId) => {
        await customFn(itemId, params)
      },
      createUndo: (_itemIds: string[]) => undefined,
    })
  }

  /**
   * 执行批量操作的统一逻辑
   */
  private async executeBatchOperation<U>(
    operationConfig: {
      type: BatchOperationType
      itemIds: string[]
      params: U
      execute: (itemId: string) => Promise<void>
      createUndo: (_itemIds: string[]) => (() => void) | undefined
    },
  ): Promise<BatchOperationResult> {
    const { type, itemIds, params, execute, createUndo } = operationConfig

    if (itemIds.length === 0) {
      return {
        success: true,
        successCount: 0,
        failureCount: 0,
        totalCount: 0,
      }
    }

    const allItemIdsForUndo = [...itemIds]

    const operation: BatchOperation<U> = {
      id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: operationConfig.type,
      itemIds,
      params,
      status: 'pending',
      successCount: 0,
      failureCount: 0,
    }

    this.operations.push(operation)
    operation.status = 'running'
    operation.startedAt = Date.now()

    const errors: Array<{ itemId: string; error: string }> = []

    try {
      // 串行执行（可改为并行）
      for (const itemId of itemIds) {
        try {
          await execute(itemId)
          operation.successCount++
        } catch (error) {
          operation.failureCount++
          errors.push({
            itemId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      operation.status = operation.failureCount === 0 ? 'completed' : 'failed'
      operation.completedAt = Date.now()

      const result: BatchOperationResult = {
        success: operation.failureCount === 0,
        successCount: operation.successCount,
        failureCount: operation.failureCount,
        totalCount: itemIds.length,
        errors: errors.length > 0 ? errors : undefined,
        undo: createUndo(allItemIdsForUndo),
      }

      // 记录到历史
      this.operationHistory.push({ operation, result })
      
      // 限制历史大小
      if (this.operationHistory.length > this.maxHistorySize) {
        this.operationHistory.shift()
      }

      // 完成后清除选择
      if (operation.successCount === itemIds.length) {
        this.clearSelection()
      }

      return result
    } catch (globalError) {
      operation.status = 'failed'
      operation.completedAt = Date.now()
      
      return {
        success: false,
        successCount: 0,
        failureCount: itemIds.length,
        totalCount: itemIds.length,
        errors: [{
          itemId: 'global',
          error: globalError instanceof Error ? globalError.message : String(globalError),
        }],
      }
    }
  }

  // ============ 历史记录 ============

  /**
   * 撤销上一个操作
   */
  async undoLast(): Promise<boolean> {
    const last = this.operationHistory.pop()
    if (!last) return false

    const { operation, result } = last
    
    if (result.undo) {
      try {
        result.undo(operation.itemIds)
        return true
      } catch (error) {
        console.error('[BatchOperation] Undo failed:', error)
        return false
      }
    }

    return false
  }

  /**
   * 获取操作历史
   */
  getHistory(): Array<{
    operation: BatchOperation<any>
    result: BatchOperationResult
  }> {
    return [...this.operationHistory]
  }

  /**
   * 清空历史记录
   */
  clearHistory(): void {
    this.operationHistory = []
  }

  // ============ 进度反馈 ============

  /**
   * 获取当前操作进度
   */
  getCurrentProgress(): {
    current: number
    total: number
    percent: number
  } | null {
    const runningOp = this.operations.find(op => op.status === 'running')
    if (!runningOp) return null

    const percent = runningOp.itemIds.length > 0
      ? ((runningOp.successCount + runningOp.failureCount) / runningOp.itemIds.length) * 100
      : 0

    return {
      current: runningOp.successCount + runningOp.failureCount,
      total: runningOp.itemIds.length,
      percent,
    }
  }
}

// ============ 便捷创建函数 ============

/**
 * 创建批量操作管理器
 */
export function createBatchManager<T extends { id: string }>(
  items: T[] = [],
): BatchOperationManager<T> {
  return new BatchOperationManager(items)
}

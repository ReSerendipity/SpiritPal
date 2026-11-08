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

export type BatchOperationType = 'delete' | 'move' | 'tag' | 'modify' | 'export' | 'toggle' | 'custom'

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
  /** 撤销操作所需的回滚数据（由调用方自解释，本模块不解析其结构） */
  rollbackData?: unknown
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
  /**
   * 撤销操作的回调（如有）。
   *
   * - 入参可选：不传 = 撤销本操作**全部成功项**；传子集 = 只撤销其中真正成功的那些
   *   （失败项不会被"撤销"，否则会把没改过的数据反向改坏）。
   * - 可能返回 Promise：调用方必须 `await`，否则撤销失败会被吞掉。
   */
  undo?: (itemIds?: string[]) => void | Promise<void>
  /** 本操作是否可撤销。为 `false` 时 `undo` 恒为 undefined，界面据此如实提示，不要假装能撤 */
  undoable: boolean
}

/** 构建撤销闭包时拿到的现场 */
export interface BatchUndoContext {
  /** 本操作提交的全部项目 ID */
  itemIds: string[]
  /** 真正执行成功的项目 ID（撤销只针对这批） */
  succeededIds: string[]
  /** 失败项与原因 */
  failures: Array<{ itemId: string; error: string }>
  /** 成功项在执行**之前**留下的现场快照（由调用方提供的 snapshot 采集） */
  snapshots: Map<string, unknown>
}

/** 撤销闭包：入参是待撤销的 ID 子集（已由管理器过滤为成功项） */
type UndoFn = (itemIds: string[]) => void | Promise<void>

// ============ 批量操作管理器 ============

export class BatchOperationManager<T extends { id: string }> {
  private selection: SelectionState<T>
  private operations: BatchOperation<unknown>[] = []
  private operationHistory: Array<{
    operation: BatchOperation<unknown>
    result: BatchOperationResult
  }> = []
  private maxHistorySize: number

  constructor(initialItems: T[] = [], config?: { maxHistorySize?: number }) {
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
      this.selection.allItems.forEach((item) => {
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
    const allIds = new Set(this.selection.allItems.map((i) => i.id))
    const notSelected = new Set([...allIds].filter((id) => !this.selection.selectedIds.has(id)))

    this.selection.selectedIds = notSelected
    this.updateSelectAllState()
  }

  /**
   * 获取选中项
   */
  getSelectedItems(): T[] {
    return this.selection.allItems.filter((item) => this.selection.selectedIds.has(item.id))
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
    const index = this.selection.allItems.findIndex((item) => item.id === id)
    return index >= 0 ? index : null
  }

  // ============ 批量操作 ============

  /**
   * 执行批量删除
   *
   * 传了 `rollback` 才可撤销：`snapshot` 在删除**之前**取被删对象，`restore` 在撤销时把它写回。
   * 不传 `rollback` 时结果里 `undoable` 为 false —— 宁可如实说"撤不了"，也不返回一个假撤销。
   */
  async bulkDelete(
    _getId: (item: T) => string,
    deleteFn: (id: string) => Promise<void>,
    rollback?: {
      snapshot: (id: string) => T | Promise<T>
      restore: (item: T) => Promise<void>
    },
  ): Promise<BatchOperationResult> {
    return this.executeBatchOperation({
      type: 'delete',
      itemIds: Array.from(this.selection.selectedIds),
      params: {},
      execute: async (itemId) => {
        await deleteFn(itemId)
      },
      snapshot: rollback ? (itemId) => rollback.snapshot(itemId) : undefined,
      createUndo: rollback
        ? (ctx) => async (ids) => {
            for (const id of ids) {
              const item = ctx.snapshots.get(id) as T | undefined
              if (item === undefined) continue
              await rollback.restore(item)
            }
          }
        : undefined,
    })
  }

  /**
   * 执行批量标记标签
   *
   * 传 `rollback.readTags` 才可撤销；撤销靠"把旧标签整组写回"，因此 `tagFn` 必须是
   * **整体替换 tags** 的语义（增量追加式实现无法用这种方式回滚）。
   */
  async bulkTag(
    tagFn: (id: string, tags: string[]) => Promise<void>,
    tags: string[],
    rollback?: { readTags: (id: string) => string[] | Promise<string[]> },
  ): Promise<BatchOperationResult> {
    return this.executeBatchOperation({
      type: 'tag',
      itemIds: Array.from(this.selection.selectedIds),
      params: { tags },
      execute: async (itemId) => {
        await tagFn(itemId, tags)
      },
      snapshot: rollback ? (itemId) => rollback.readTags(itemId) : undefined,
      createUndo: rollback
        ? (ctx) => async (ids) => {
            for (const id of ids) {
              const prev = ctx.snapshots.get(id) as string[] | undefined
              if (prev === undefined) continue
              await tagFn(id, prev)
            }
          }
        : undefined,
    })
  }

  /**
   * 执行批量修改
   *
   * 传 `rollback.readPrevious` 才可撤销：撤销时用**同一把 `modifyFn`** 把旧值写回，
   * 所以 `modifyFn` 必须是 patch 语义、且旧值与 `changes` 同形（如 `{confidence: 0.8}`）。
   */
  async bulkModify<U>(
    modifyFn: (id: string, changes: U) => Promise<void>,
    changes: U,
    rollback?: { readPrevious: (id: string) => U | Promise<U> },
  ): Promise<BatchOperationResult> {
    return this.executeBatchOperation({
      type: 'modify',
      itemIds: Array.from(this.selection.selectedIds),
      params: { changes },
      execute: async (itemId) => {
        await modifyFn(itemId, changes)
      },
      snapshot: rollback ? (itemId) => rollback.readPrevious(itemId) : undefined,
      createUndo: rollback
        ? (ctx) => async (ids) => {
            for (const id of ids) {
              const prev = ctx.snapshots.get(id) as U | undefined
              if (prev === undefined) continue
              await modifyFn(id, prev)
            }
          }
        : undefined,
    })
  }

  /**
   * 执行批量切换（开/关）
   *
   * 切换是二元操作，旧值即 `!enabled`，所以不传 rollback 也能撤销；
   * **但只撤销真正切换成功的项**（此前把所有 itemIds 一并反向切换，会把没动过的项改坏）。
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
      createUndo: () =>
        async (ids) => {
          for (const id of ids) {
            await toggleFn(id, !enabled)
          }
        },
    })
  }

  /**
   * 执行自定义批量操作
   *
   * 自定义操作管理器无法推断怎么回滚，撤销闭包必须由调用方给（`rollback.makeUndo`）。
   */
  async bulkCustom<U>(
    type: string,
    customFn: (id: string, params: U) => Promise<void>,
    params: U,
    rollback?: {
      snapshot?: (id: string) => unknown
      makeUndo: (ctx: BatchUndoContext) => UndoFn | undefined
    },
  ): Promise<BatchOperationResult> {
    return this.executeBatchOperation({
      type: 'custom',
      itemIds: Array.from(this.selection.selectedIds),
      params: { type, customParams: params },
      execute: async (itemId) => {
        await customFn(itemId, params)
      },
      snapshot: rollback?.snapshot,
      createUndo: rollback?.makeUndo,
    })
  }

  /**
   * 执行批量操作的统一逻辑
   */
  private async executeBatchOperation<U>(operationConfig: {
    type: BatchOperationType
    itemIds: string[]
    params: U
    execute: (itemId: string) => Promise<void>
    /** 在 `execute` 之前采集现场（异步也可）；只保留成功项的快照 */
    snapshot?: (itemId: string) => unknown | Promise<unknown>
    /** 由现场构建撤销闭包；不提供 = 本操作不可撤销 */
    createUndo?: (ctx: BatchUndoContext) => UndoFn | undefined
  }): Promise<BatchOperationResult> {
    const { itemIds, params, execute, snapshot, createUndo } = operationConfig

    if (itemIds.length === 0) {
      return {
        success: true,
        successCount: 0,
        failureCount: 0,
        totalCount: 0,
        undoable: false,
      }
    }

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
    const snapshots = new Map<string, unknown>()
    const succeededIds: string[] = []

    try {
      // 串行执行（可改为并行）
      for (const itemId of itemIds) {
        try {
          if (snapshot) {
            // 先取现场再动手：失败项的快照没有意义，成功后才有
            snapshots.set(itemId, await snapshot(itemId))
          }
          await execute(itemId)
          operation.successCount++
          succeededIds.push(itemId)
        } catch (error) {
          operation.failureCount++
          snapshots.delete(itemId)
          errors.push({
            itemId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      operation.status = operation.failureCount === 0 ? 'completed' : 'failed'
      operation.completedAt = Date.now()

      const ctx: BatchUndoContext = { itemIds, succeededIds, failures: errors, snapshots }
      const rawUndo = createUndo ? createUndo(ctx) : undefined
      const undo: BatchOperationResult['undo'] = rawUndo
        ? (subset) => {
            const targets = (subset ?? succeededIds).filter((id) => succeededIds.includes(id))
            if (targets.length === 0) return
            return rawUndo(targets)
          }
        : undefined

      // 现场留档：撤销数据跟着这次操作进历史，便于事后排查"为什么撤不回来"
      operation.rollbackData = { succeededIds: [...succeededIds], snapshots: Array.from(snapshots.entries()) }

      const result: BatchOperationResult = {
        success: operation.failureCount === 0,
        successCount: operation.successCount,
        failureCount: operation.failureCount,
        totalCount: itemIds.length,
        errors: errors.length > 0 ? errors : undefined,
        undo,
        undoable: Boolean(undo),
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
        errors: [
          {
            itemId: 'global',
            error: globalError instanceof Error ? globalError.message : String(globalError),
          },
        ],
        undoable: false,
      }
    }
  }

  // ============ 历史记录 ============

  /**
   * 撤销上一个操作
   *
   * 与旧实现的区别：① 真的 `await` 撤销闭包（旧的既不 await、也把异步失败吞了）；
   * ② 不可撤销的操作不再被静默弹出历史（否则那条记录白白消失、界面还以为"撤过了"）；
   * ③ 撤销失败时保留历史项，便于重试与排查。
   */
  async undoLast(): Promise<boolean> {
    const last = this.operationHistory[this.operationHistory.length - 1]
    if (!last) return false

    const { operation, result } = last

    if (!result.undo) {
      // 不可撤销：保留历史，让界面能如实显示"此项不可撤销"
      return false
    }

    try {
      await result.undo(operation.itemIds)
      this.operationHistory.pop()
      return true
    } catch (error) {
      console.error('[BatchOperation] Undo failed:', error)
      return false
    }
  }

  /**
   * 获取操作历史
   */
  getHistory(): Array<{
    operation: BatchOperation<unknown>
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
    const runningOp = this.operations.find((op) => op.status === 'running')
    if (!runningOp) return null

    const percent =
      runningOp.itemIds.length > 0
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
export function createBatchManager<T extends { id: string }>(items: T[] = []): BatchOperationManager<T> {
  return new BatchOperationManager(items)
}

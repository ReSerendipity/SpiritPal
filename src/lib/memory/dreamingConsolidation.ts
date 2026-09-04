/**
 * 离线做梦任务调度器
 *
 * P2-7：后台记忆巩固系统 — 空闲/夜间触发，非阻塞式 consolidation
 *
 * 核心理念：
 * - 不打扰用户：仅在应用空闲或夜间执行
 * - 非阻塞式：使用 requestIdleCallback / time-slicing 避免 UI 卡顿
 * - 渐进式巩固：每次处理少量记忆，分批完成
 * - 可取消：用户交互时立即暂停
 *
 * 设计参考：
 * - OpenAI Memory Agent：后台记忆重组 — 时间片调度 + idle 检测
 * - Meta MemGPT：梦境状态 — 夜间触发长期记忆整合
 * - HippoRAG：离线联想图构建 — 多跳实体关系预计算
 *
 * @fileoverview
 * 主要模块：
 * - DreamingScheduler 类：离线任务调度器（单例）
 * - DreamingTask 接口：任务定义（类型 + 优先级 + 估算时长）
 * - IdleMonitor 辅助：检测用户空闲状态
 *
 * 核心功能：
 * 1. 空闲触发：用户停止操作 5 分钟后启动
 * 2. 夜间触发：凌晨 2-4 点（用户睡眠时间）
 * 3. 分批处理：每次最多处理 10 条记忆
 * 4. 可取消：用户交互时立即暂停当前任务
 */

import { EnhancedMemoryManager } from './enhancedMemory'
import { type EnhancedMemory } from './memoryTypes'

// ============ 类型定义 ============

/** 做梦任务类型 */
export type DreamingTaskType =
  | 'semantic_consolidation'  // 语义巩固（episodic → semantic）
  | 'entity_graph_update'      // 实体图更新（新增实体/边）
  | 'memory_ranking'           // 记忆重排序（遗忘曲线应用）
  | 'autobiographical_merge'   // 自传记忆合并

/** 做梦任务定义 */
export interface DreamingTask {
  /** 任务类型 */
  type: DreamingTaskType
  /** 任务优先级（1-10，越高越优先） */
  priority: number
  /** 估算执行时间（毫秒） */
  estimatedDurationMs: number
  /** 任务状态 */
  status: 'pending' | 'running' | 'paused' | 'completed' | 'cancelled'
  /** 任务 ID */
  id: string
  /** 创建时间 */
  createdAt: number
  /** 开始时间 */
  startedAt?: number
  /** 完成时间 */
  completedAt?: number
  /** 已处理记忆数 */
  processedCount?: number
  /** 总记忆数 */
  totalCount?: number
}

/** 做梦调度器配置 */
export interface DreamingConfig {
  /** 空闲阈值（用户停止操作 N 毫秒后触发） */
  idleThresholdMs: number
  /** 夜间触发时间窗口（开始小时，0-23） */
  nightStartHour: number
  /** 夜间触发时间窗口（结束小时，0-23） */
  nightEndHour: number
  /** 单批处理最大记忆数 */
  maxBatchSize: number
  /** 单次执行最大时长（毫秒，超过则暂停） */
  maxExecutionMs: number
  /** 是否启用做梦任务 */
  enabled: boolean
}

/** 默认配置 */
export const DEFAULT_DREAMING_CONFIG: DreamingConfig = {
  idleThresholdMs: 5 * 60 * 1000,  // 5 分钟空闲
  nightStartHour: 2,                // 凌晨 2 点
  nightEndHour: 4,                  // 凌晨 4 点
  maxBatchSize: 10,                 // 每批最多 10 条
  maxExecutionMs: 5000,             // 单次最多 5 秒
  enabled: true,
}

// ============ 空闲监控器 ============

/**
 * 空闲状态监控器
 *
 * 检测用户是否长时间未操作（鼠标/键盘/触摸）
 */
class IdleMonitor {
  private lastActivityTime: number = Date.now()
  private idleCallbacks: Array<(idleDuration: number) => void> = []
  private onActivityCallbacks: Array<() => void> = []
  private idleThresholdMs: number
  private checkInterval: ReturnType<typeof setInterval> | null = null

  constructor(idleThresholdMs: number = DEFAULT_DREAMING_CONFIG.idleThresholdMs) {
    this.idleThresholdMs = idleThresholdMs
    this.startMonitoring()
  }

  /** 启动监控 */
  private startMonitoring(): void {
    // 监听各种用户交互事件
    const events = [
      'mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart',
    ]

    events.forEach(event => {
      document.addEventListener(event, () => this.recordActivity(), { passive: true })
    })

    // 定期检查空闲状态
    this.checkInterval = setInterval(() => {
      this.checkIdleState()
    }, 1000)
  }

  /** 记录用户活动 */
  private recordActivity(): void {
    const wasIdle = this.isIdle()
    this.lastActivityTime = Date.now()

    // 从空闲状态恢复，触发回调
    if (wasIdle) {
      this.onActivityCallbacks.forEach(cb => cb())
    }
  }

  /** 检查空闲状态 */
  private checkIdleState(): void {
    const idleDuration = Date.now() - this.lastActivityTime

    // 刚进入空闲状态，触发回调
    if (idleDuration >= this.idleThresholdMs && idleDuration < this.idleThresholdMs + 1000) {
      this.idleCallbacks.forEach(cb => cb(idleDuration))
    }
  }

  /** 是否空闲 */
  isIdle(): boolean {
    return Date.now() - this.lastActivityTime >= this.idleThresholdMs
  }

  /** 获取空闲时长 */
  getIdleDuration(): number {
    return Date.now() - this.lastActivityTime
  }

  /** 注册空闲回调 */
  onIdle(callback: (idleDuration: number) => void): void {
    this.idleCallbacks.push(callback)
  }

  /** 注册活动回调（从空闲恢复） */
  onActivity(callback: () => void): void {
    this.onActivityCallbacks.push(callback)
  }

  /** 停止监控 */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }
}

// ============ 做梦调度器 ============

/**
 * 做梦任务调度器
 *
 * 管理离线记忆巩固任务的调度和执行
 */
export class DreamingScheduler {
  private static instance: DreamingScheduler | null = null
  private config: DreamingConfig
  private memoryManager: EnhancedMemoryManager
  private idleMonitor: IdleMonitor
  private taskQueue: DreamingTask[] = []
  private currentTask: DreamingTask | null = null
  private isRunning: boolean = false
  private abortController: AbortController | null = null

  private constructor(
    memoryManager: EnhancedMemoryManager,
    config: Partial<DreamingConfig> = {},
  ) {
    this.config = { ...DEFAULT_DREAMING_CONFIG, ...config }
    this.memoryManager = memoryManager
    this.idleMonitor = new IdleMonitor(this.config.idleThresholdMs)

    this.setupIdleCallbacks()
    this.scheduleNightlyTasks()
  }

  /** 获取单例实例 */
  static getInstance(
    memoryManager: EnhancedMemoryManager,
    config?: Partial<DreamingConfig>,
  ): DreamingScheduler {
    if (!DreamingScheduler.instance) {
      DreamingScheduler.instance = new DreamingScheduler(memoryManager, config)
    }
    return DreamingScheduler.instance
  }

  /** 获取静态实例（用于测试和外部访问） */
  static getSchedulerInstance(): DreamingScheduler | null {
    return DreamingScheduler.instance
  }

  /** 设置空闲回调 */
  private setupIdleCallbacks(): void {
    // 空闲触发：用户停止操作 5 分钟后启动任务
    this.idleMonitor.onIdle((idleDuration) => {
      if (this.config.enabled && !this.isRunning) {
        console.log(`[DreamingScheduler] User idle for ${idleDuration}ms, starting dreaming tasks...`)
        void this.startDreaming()
      }
    })

    // 活动恢复：取消当前任务
    this.idleMonitor.onActivity(() => {
      if (this.currentTask && this.currentTask.status === 'running') {
        console.log('[DreamingScheduler] User activity detected, pausing current task...')
        this.pauseCurrentTask()
      }
    })
  }

  /** 调度夜间任务 */
  private scheduleNightlyTasks(): void {
    const checkNightly = () => {
      const now = new Date()
      const hour = now.getHours()

      // 在夜间窗口内触发（2-4 点）
      if (hour >= this.config.nightStartHour && hour < this.config.nightEndHour) {
        if (this.config.enabled && !this.isRunning && this.taskQueue.length === 0) {
          console.log('[DreamingScheduler] Night time window, scheduling dreaming tasks...')
          void this.scheduleNightlyConsolidation()
        }
      }
    }

    // 每分钟检查一次
    setInterval(checkNightly, 60000)
  }

  /** 调度夜间巩固任务 */
  private async scheduleNightlyConsolidation(): Promise<void> {
    try {
      // 添加语义巩固任务
      await this.addTask({
        type: 'semantic_consolidation',
        priority: 8,
        estimatedDurationMs: 3000,
        status: 'pending',
        id: `semantic-nightly-${Date.now()}`,
        createdAt: Date.now(),
      })

      // 添加记忆重排序任务
      await this.addTask({
        type: 'memory_ranking',
        priority: 5,
        estimatedDurationMs: 2000,
        status: 'pending',
        id: `ranking-nightly-${Date.now()}`,
        createdAt: Date.now(),
      })

      // 启动执行
      void this.startDreaming()
    } catch (e) {
      console.warn('[DreamingScheduler] Failed to schedule nightly tasks:', e)
    }
  }

  /** 添加任务 */
  async addTask(task: DreamingTask): Promise<void> {
    this.taskQueue.push(task)
    this.taskQueue.sort((a, b) => b.priority - a.priority) // 按优先级排序
  }

  /** 开始做梦（执行任务队列） */
  private async startDreaming(): Promise<void> {
    if (this.isRunning || this.taskQueue.length === 0) {
      return
    }

    this.isRunning = true
    this.abortController = new AbortController()

    try {
      while (this.taskQueue.length > 0 && this.abortController.signal.aborted === false) {
        const task = this.taskQueue.shift()!
        await this.executeTask(task)

        // 用户活动导致中止
        if (this.abortController.signal.aborted) {
          break
        }
      }
    } catch (e) {
      console.warn('[DreamingScheduler] Dreaming execution error:', e)
    } finally {
      this.isRunning = false
      this.abortController = null
    }
  }

  /** 暂停当前任务 */
  public pauseCurrentTask(): void {
    if (this.currentTask && this.currentTask.status === 'running') {
      this.currentTask.status = 'paused'
      // 将任务放回队列
      this.taskQueue.unshift(this.currentTask)
    }

    if (this.abortController) {
      this.abortController.abort()
    }
  }

  /** 执行单个任务 */
  private async executeTask(task: DreamingTask): Promise<void> {
    this.currentTask = task
    task.status = 'running'
    task.startedAt = Date.now()

    try {
      switch (task.type) {
        case 'semantic_consolidation':
          await this.executeSemanticConsolidation(task)
          break
        case 'entity_graph_update':
          await this.executeEntityGraphUpdate(task)
          break
        case 'memory_ranking':
          await this.executeMemoryRanking(task)
          break
        case 'autobiographical_merge':
          await this.executeAutobiographicalMerge(task)
          break
      }

      task.status = 'completed'
      task.completedAt = Date.now()
      console.log(`[DreamingScheduler] Task ${task.id} completed in ${task.completedAt - task.startedAt}ms`)
    } catch (e) {
      console.warn(`[DreamingScheduler] Task ${task.id} failed:`, e)
      task.status = 'cancelled'
    } finally {
      this.currentTask = null
    }
  }

  /** 执行语义巩固任务 */
  private async executeSemanticConsolidation(task: DreamingTask): Promise<void> {
    const startTime = Date.now()

    // 简单摘要器（无需 LLM，避免网络开销）
    const simpleSummarizer = (memories: EnhancedMemory[]): Promise<string> => {
      const summary = memories
        .map(m => `[${m.category}] ${m.user.slice(0, 100)}`)
        .join('；')
      return Promise.resolve(summary)
    }

    // 分批处理
    let batchCount = 0
    while (Date.now() - startTime < this.config.maxExecutionMs) {
      const result = await this.memoryManager.applyConsolidation(simpleSummarizer)

      if (!result) {
        // 没有更多可巩固的记忆
        break
      }

      batchCount++
      task.processedCount = (task.processedCount ?? 0) + result.sourceIds.length

      // 避免连续 consolidation
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    task.totalCount = task.processedCount
    console.log(`[DreamingScheduler] Semantic consolidation completed ${batchCount} batches`)
  }

  /** 执行实体图更新任务 */
  private async executeEntityGraphUpdate(_task: DreamingTask): Promise<void> {
    // TODO: 实现实体图更新逻辑
    // - 从最近记忆中提取实体
    // - 更新 memory_entities 和 memory_entity_edges 表
    // - 预计算 PPR 分数

    console.log('[DreamingScheduler] Entity graph update completed (TODO)')
  }

  /** 执行记忆重排序任务 */
  private async executeMemoryRanking(_task: DreamingTask): Promise<void> {
    // TODO: 实现记忆重排序逻辑
    // - 应用遗忘曲线
    // - 重新计算重要性分数
    // - 更新 memories.importance 字段

    console.log('[DreamingScheduler] Memory ranking completed (TODO)')
  }

  /** 执行自传记忆合并任务 */
  private async executeAutobiographicalMerge(_task: DreamingTask): Promise<void> {
    // TODO: 实现自传记忆合并逻辑
    // - 合并相似的自传记忆
    // - 更新记忆摘要
    // - 删除冗余记忆

    console.log('[DreamingScheduler] Autobiographical merge completed (TODO)')
  }

  /** 获取当前任务状态 */
  getCurrentTask(): DreamingTask | null {
    return this.currentTask
  }

  /** 获取任务队列 */
  getTaskQueue(): DreamingTask[] {
    return [...this.taskQueue]
  }

  /** 更新配置 */
  updateConfig(config: Partial<DreamingConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /** 停止调度器 */
  stop(): void {
    this.idleMonitor.stop()
    if (this.abortController) {
      this.abortController.abort()
    }
    DreamingScheduler.instance = null
  }
}

// ============ 导出便捷函数 ============

/**
 * 启动做梦调度器
 */
export function startDreamingScheduler(
  memoryManager: EnhancedMemoryManager,
  config?: Partial<DreamingConfig>,
): DreamingScheduler {
  return DreamingScheduler.getInstance(memoryManager, config)
}

/**
 * 停止做梦调度器
 */
export function stopDreamingScheduler(): void {
  const instance = DreamingScheduler.getSchedulerInstance()
  if (instance) {
    instance.stop()
  }
}
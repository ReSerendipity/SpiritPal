/**
 * Agent 调度器 — 30 秒轮询调度器，提供周期性任务执行和 cron-like 调度
 * 参考 super-agent-party 的调度设计
 *
 * @fileoverview
 * 主要模块：
 * - ScheduledTask 接口：调度任务定义（执行函数、调度配置、状态、重试策略）
 * - TaskSchedule 接口：任务调度配置（interval/cron/once 三种类型）
 * - parseCronExpression()：简化 cron 表达式解析
 * - AgentScheduler 类：调度器类（单例模式），支持任务注册、启动/停止、错误重试
 * - getAgentScheduler()：获取单例入口
 *
 * 核心功能：
 * 1. AgentScheduler 周期任务执行
 * 2. 30 秒默认轮询间隔
 * 3. 任务注册（cron-like 调度）
 * 4. 错误恢复和重试
 *
 * @module agentScheduler
 */

/** 调度任务状态 */
export type ScheduledTaskStatus = 'idle' | 'running' | 'paused' | 'failed'

/** 调度任务定义 */
export interface ScheduledTask {
  /** 任务 ID */
  id: string
  /** 任务名称 */
  name: string
  /** 执行函数 */
  execute: () => Promise<void>
  /** 调度配置 */
  schedule: TaskSchedule
  /** 状态 */
  status: ScheduledTaskStatus
  /** 上次执行时间 */
  lastRunAt: number | null
  /** 上次错误 */
  lastError: string | null
  /** 连续失败次数 */
  consecutiveFailures: number
  /** 最大重试次数（0=不重试） */
  maxRetries: number
  /** 重试间隔（毫秒） */
  retryDelayMs: number
}

/** 任务调度配置 */
export interface TaskSchedule {
  /** 调度类型 */
  type: 'interval' | 'cron' | 'once'
  /** 轮询间隔（毫秒，type=interval 时使用） */
  intervalMs?: number
  // cron 表达式（type=cron 时使用，如 "每30秒" 可用 intervalMs=30000 替代）
  cronExpression?: string
  /** 一次性执行时间（type=once 时使用） */
  runAt?: number
}

/** 调度器配置 */
export interface SchedulerConfig {
  /** 默认轮询间隔（毫秒） */
  defaultIntervalMs: number
  /** 单次任务最大执行时间（毫秒） */
  maxExecutionTimeMs: number
  /** 全局暂停标志 */
  paused: boolean
}

// ============ cron 表达式解析（简化版） ============

/**
 * 解析简化 cron 表达式
 * 格式: 星号/N 表示每 N 秒执行; M 表示每分钟第 M 秒执行
 */
export function parseCronExpression(expression: string): { intervalMs: number } | null {
  const parts = expression.trim().split(/\s+/)
  if (parts.length < 5) return null

  // 处理 "*/N" 格式
  const firstPart = parts[0]
  if (firstPart.startsWith('*/')) {
    const n = parseInt(firstPart.slice(2))
    if (isNaN(n) || n <= 0) return null
    return { intervalMs: n * 1000 }
  }

  // 处理固定秒数
  const seconds = parseInt(firstPart)
  if (!isNaN(seconds) && seconds >= 0 && seconds < 60) {
    return { intervalMs: 60000 } // 每分钟执行
  }

  return null
}

// ============ Agent 调度器 ============

export class AgentScheduler {
  private tasks = new Map<string, ScheduledTask>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private config: SchedulerConfig
  private listeners = new Set<(task: ScheduledTask, event: string) => void>()

  constructor(config?: Partial<SchedulerConfig>) {
    this.config = {
      defaultIntervalMs: 30000,
      maxExecutionTimeMs: 120000,
      paused: false,
      ...config,
    }
  }

  // ============ 任务注册 ============

  /**
   * 注册调度任务
   */
  register(task: Omit<ScheduledTask, 'status' | 'lastRunAt' | 'lastError' | 'consecutiveFailures'>): string {
    const fullTask: ScheduledTask = {
      ...task,
      status: 'idle',
      lastRunAt: null,
      lastError: null,
      consecutiveFailures: 0,
    }
    this.tasks.set(task.id, fullTask)
    return task.id
  }

  /**
   * 注册间隔任务（快捷方法）
   */
  registerInterval(
    id: string,
    name: string,
    execute: () => Promise<void>,
    intervalMs?: number,
  ): string {
    return this.register({
      id,
      name,
      execute,
      schedule: { type: 'interval', intervalMs: intervalMs ?? this.config.defaultIntervalMs },
      maxRetries: 3,
      retryDelayMs: 5000,
    })
  }

  /**
   * 注册 cron 任务（快捷方法）
   */
  registerCron(
    id: string,
    name: string,
    execute: () => Promise<void>,
    cronExpression: string,
  ): string {
    return this.register({
      id,
      name,
      execute,
      schedule: { type: 'cron', cronExpression },
      maxRetries: 3,
      retryDelayMs: 5000,
    })
  }

  /**
   * 注册一次性任务（快捷方法）
   */
  registerOnce(
    id: string,
    name: string,
    execute: () => Promise<void>,
    runAt: number,
  ): string {
    return this.register({
      id,
      name,
      execute,
      schedule: { type: 'once', runAt },
      maxRetries: 0,
      retryDelayMs: 0,
    })
  }

  /**
   * 移除任务
   */
  unregister(id: string): void {
    this.tasks.delete(id)
  }

  // ============ 调度控制 ============

  /**
   * 启动调度器
   */
  start(): void {
    if (this.pollTimer) return

    this.pollTimer = setInterval(() => {
      if (this.config.paused) return
      void this.tick()
    }, 1000) // 每秒检查一次
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /**
   * 暂停/恢复
   */
  setPaused(paused: boolean): void {
    this.config.paused = paused
  }

  // ============ 手动触发 ============

  /**
   * 手动触发指定任务
   */
  async runNow(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`任务 "${id}" 不存在`)
    await this.executeTask(task)
  }

  // ============ 查询 ============

  getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values())
  }

  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id)
  }

  // ============ 订阅 ============

  subscribe(listener: (task: ScheduledTask, event: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ============ 内部方法 ============

  private async tick(): Promise<void> {
    const now = Date.now()

    for (const task of this.tasks.values()) {
      if (task.status === 'running') continue
      if (task.status === 'failed' && task.consecutiveFailures >= task.maxRetries) continue

      const shouldRun = this.shouldRunTask(task, now)
      if (shouldRun) {
        // 不 await，允许并行执行
        void this.executeTask(task)
      }
    }
  }

  private shouldRunTask(task: ScheduledTask, now: number): boolean {
    const { schedule, lastRunAt } = task

    switch (schedule.type) {
      case 'interval': {
        const interval = schedule.intervalMs ?? this.config.defaultIntervalMs
        return lastRunAt === null || (now - lastRunAt) >= interval
      }
      case 'cron': {
        if (!schedule.cronExpression) return false
        const parsed = parseCronExpression(schedule.cronExpression)
        if (!parsed) return false
        return lastRunAt === null || (now - (lastRunAt ?? 0)) >= parsed.intervalMs
      }
      case 'once': {
        if (!schedule.runAt) return false
        return now >= schedule.runAt && lastRunAt === null
      }
      default:
        return false
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    task.status = 'running'
    this.notifyListeners(task, 'start')

    try {
      // 执行超时保护
      await Promise.race([
        task.execute(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('执行超时')), this.config.maxExecutionTimeMs),
        ),
      ])

      task.status = 'idle'
      task.lastRunAt = Date.now()
      task.lastError = null
      task.consecutiveFailures = 0
      this.notifyListeners(task, 'success')

      // 一次性任务执行后自动移除
      if (task.schedule.type === 'once') {
        this.tasks.delete(task.id)
      }
    } catch (e) {
      task.status = 'failed'
      task.lastError = e instanceof Error ? e.message : String(e)
      task.consecutiveFailures += 1
      this.notifyListeners(task, 'error')

      // 延迟重试
      if (task.consecutiveFailures < task.maxRetries && task.retryDelayMs > 0) {
        setTimeout(() => {
          if (task.status === 'failed') {
            task.status = 'idle'
          }
        }, task.retryDelayMs)
      }
    }
  }

  private notifyListeners(task: ScheduledTask, event: string): void {
    this.listeners.forEach((fn) => fn({ ...task }, event))
  }

  // ============ 销毁 ============

  destroy(): void {
    this.stop()
    this.tasks.clear()
    this.listeners.clear()
  }
}

// ============ 单例 ============

let sharedScheduler: AgentScheduler | null = null

export function getAgentScheduler(config?: Partial<SchedulerConfig>): AgentScheduler {
  if (!sharedScheduler) {
    sharedScheduler = new AgentScheduler(config)
  }
  return sharedScheduler
}

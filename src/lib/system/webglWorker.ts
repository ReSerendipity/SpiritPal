/**
 * @file webglWorker.ts
 * @description WebGL Worker 隔离 — 渲染线程与主线程分离
 *
 * 实现功能：
 * - Dedicated Worker 运行 WebGL 渲染循环
 * - OffscreenCanvas 支持（Chrome/Firefox）
 * - Transferable Objects 零拷贝传输
 * - 消息协议设计（request/response pattern）
 * - 错误处理与回退机制
 * - 性能监控与调试接口
 *
 * 参考：Three.js Worker Renderer / Babylon.js WebGPU Worker
 */

// ============ 类型定义 ============

export interface WorkerMessage {
  /** 消息 ID（用于追踪） */
  id: string
  /** 消息类型 */
  type: 'init' | 'render' | 'update' | 'resize' | 'destroy' | 'stats'
  /**
   * 数据载荷：字段随 type 变化（init 带 canvasId/canvasTransferable，render 带 commands，
   * resize 带 width/height，update 带 deltaTime/emitterPos）。
   * 要精确表达需改成按 type 判别的联合，并同时改 worker 侧的字段读取与 send 的动态构造 ——
   * 那是重设计 IPC 协议而非清 lint，故保留宽松类型并豁免。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 跨 realm IPC 载荷，形状随 type 变化；见上
  payload?: any
  /** 时间戳 */
  timestamp: number
}

export interface WorkerResponse {
  /** 对应消息 ID */
  messageId: string
  /** 响应类型 */
  type: 'success' | 'error' | 'stats'
  /** 响应数据 */
  data?: unknown
  /** 错误信息 */
  error?: string
}

export interface RenderCommand {
  /** 命令类型 */
  command: 'drawSprite' | 'drawParticle' | 'clear' | 'present'
  /**
   * 命令参数：drawSprite/drawParticle 各自读不同键（如 params.color 当数组下标用）。
   * 改 unknown 会让 worker 侧出现 4 处索引报错，需逐处加断言 —— 属改 worker 代码而非清 lint。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 渲染命令参数表，键集随 command 变化
  params: Record<string, any>
}

export interface WebGLWorkerConfig {
  /** Worker 脚本路径 */
  workerUrl: string
  /** 是否启用 OffscreenCanvas */
  useOffscreenCanvas: boolean
  /** 消息超时时间（ms） */
  timeout: number
  /** 最大重试次数 */
  maxRetries: number
}

const DEFAULT_WORKER_CONFIG: WebGLWorkerConfig = {
  workerUrl: './webgl.worker.js',
  useOffscreenCanvas: true,
  timeout: 5000,
  maxRetries: 3,
}

// ============ WebGL Worker 管理器 ============

export class WebGLWorkerManager {
  private worker: Worker | null = null
  private config: WebGLWorkerConfig
  // pendingRequests 混合了不同 send<T> 的 resolve：(value: unknown) => void 因参数逆变
  // 无法接受 new Promise<T> 的 resolve（TS2322），故此处保留 any 作为类型擦除的容器
  private pendingRequests: Map<string, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 异构 pending 表，resolve 需抹平 T
    resolve: (value: any) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }> = new Map()

  private requestCounter: number = 0

  constructor(config?: Partial<WebGLWorkerConfig>) {
    this.config = { ...DEFAULT_WORKER_CONFIG, ...(config || {}) }

    // 监听 Worker 消息
    if (typeof Worker !== 'undefined') {
      try {
        this.initWorker()
      } catch (error) {
        console.error('[WebGLWorker] Failed to initialize:', error)
      }
    } else {
      console.warn('[WebGLWorker] Web Workers not supported, falling back to main thread')
    }
  }

  /**
   * 初始化 Worker
   */
  private initWorker(): void {
    try {
      this.worker = new Worker(this.config.workerUrl, {
        type: 'module',
      })

      this.worker.onmessage = this.handleWorkerMessage.bind(this)
      this.worker.onerror = this.handleWorkerError.bind(this)

      console.log('[WebGLWorker] Worker initialized successfully')
    } catch (error) {
      console.error('[WebGLWorker] Worker initialization failed:', error)
    }
  }

  /**
   * 发送消息到 Worker
   */
  async send<T = unknown>(
    type: WorkerMessage['type'],
    payload?: unknown,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const messageId = `msg_${++this.requestCounter}_${Date.now()}`

      const message: WorkerMessage = {
        id: messageId,
        type,
        payload,
        timestamp: performance.now(),
      }

      // 设置超时定时器
      const timer = setTimeout(() => {
        const pending = this.pendingRequests.get(messageId)
        if (pending) {
          this.pendingRequests.delete(messageId)
          reject(new Error(`Worker request timed out after ${this.config.timeout}ms`))
        }
      }, this.config.timeout)

      // 保存回调
      this.pendingRequests.set(messageId, { resolve, reject, timer })

      // 发送消息
      try {
        this.worker?.postMessage(message)
      } catch (error) {
        clearTimeout(timer)
        this.pendingRequests.delete(messageId)
        reject(error as Error)
      }
    })
  }

  /**
   * 发送离屏画布（零拷贝传输）
   */
  async transferCanvas(canvas: HTMLCanvasElement): Promise<void> {
    let offscreen: OffscreenCanvas | undefined

    if (this.config.useOffscreenCanvas && canvas.transferControlToOffscreen) {
      offscreen = canvas.transferControlToOffscreen()

      const message: WorkerMessage = {
        id: `canvas_${Date.now()}`,
        type: 'init',
        payload: { canvasTransferable: true },
        timestamp: performance.now(),
      }

      // 使用 Transferable Objects 零拷贝传输
      this.worker?.postMessage(
        message,
        [offscreen] // 第二个参数指定可转移对象
      )

      console.log('[WebGLWorker] Canvas transferred with OffscreenCanvas')
    } else {
      // Fallback: 使用常规消息传递
      await this.send('init', { canvasId: canvas.id })
      console.log('[WebGLWorker] Using fallback canvas transfer')
    }
  }

  /**
   * 渲染一帧
   */
  async render(commands: RenderCommand[]): Promise<void> {
    await this.send('render', { commands })
  }

  /**
   * 调整尺寸
   */
  async resize(width: number, height: number): Promise<void> {
    await this.send('resize', { width, height })
  }

  /**
   * 获取性能统计
   */
  async getStats(): Promise<unknown> {
    return this.send('stats')
  }

  /**
   * 销毁 Worker
   */
  destroy(): void {
    // 清理所有待处理请求
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
    }
    this.pendingRequests.clear()

    // 终止 Worker
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
      console.log('[WebGLWorker] Worker terminated')
    }
  }

  /**
   * 处理 Worker 消息
   */
  private handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data
    const pending = this.pendingRequests.get(response.messageId)

    if (!pending) {
      console.warn('[WebGLWorker] Unexpected response:', response)
      return
    }

    // 清理定时器
    clearTimeout(pending.timer)
    this.pendingRequests.delete(response.messageId)

    if (response.type === 'error') {
      pending.reject(new Error(response.error || 'Unknown worker error'))
    } else if (response.type === 'stats') {
      pending.resolve(response.data)
    } else {
      pending.resolve(response.data)
    }
  }

  /**
   * 处理 Worker 错误
   */
  private handleWorkerError(error: ErrorEvent): void {
    console.error('[WebGLWorker] Worker error:', error)

    // 尝试重启 Worker
    this.worker = null
    setTimeout(() => {
      try {
        this.initWorker()
      } catch (e) {
        console.error('[WebGLWorker] Failed to restart worker:', e)
      }
    }, 1000)
  }

  /**
   * 检查 Worker 是否可用
   */
  isAvailable(): boolean {
    return this.worker !== null
  }
}

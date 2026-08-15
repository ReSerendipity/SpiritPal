/**
 * @file ttsTaskManager.ts
 * @description TTS 任务管理器模块 — 并行生成、有序回放
 *
 * 核心机制（参考 Open-LLM-VTuber TTSTaskManager）：
 * 1. 为每个 TTS 任务分配递增序号（seq）
 * 2. 并行生成 TTS 音频（提高响应速度，减少等待）
 * 3. 有序回放：乱序完成的任务在缓冲区中按 seq 重排，严格按顺序播放
 * 4. 新对话到来时取消所有待处理任务（cancelAll）
 * 5. 超时保护：30 秒未完成的任务自动跳过，避免永久阻塞
 * 6. 缓冲区容量限制：最多 20 个待播放任务，超出时强制播放最早的
 * 7. Blob URL 资源管理：播放完成后及时释放，防止内存泄漏
 * 8. 代际机制：cancelAll/reset 时递增 generation，废弃旧的异步回调
 *
 * 参考仓库：Open-LLM-VTuber（MIT 许可）
 * - tts_task_manager.py — TTSTaskManager 实现
 *
 * 主要模块：
 * - TTSTaskState: TTS 任务状态枚举
 * - TTSAudioData/TTSTask: TTS 音频数据和任务接口
 * - TTSGenerateFn/TTSPlayFn: TTS 生成/播放函数类型
 * - TTSTaskManagerCallbacks: 回调接口
 * - TTSTaskManager: TTS 任务管理器类
 * - getTTSTaskManager()/resetTTSTaskManager(): 单例管理
 *
 * 依赖关系：无外部依赖（由 ttsEngine.ts 提供 generate/play 函数）
 *
 * 核心接口：
 * - TTSTaskManager.addTask(): 添加 TTS 任务
 * - TTSTaskManager.cancelAll(): 取消所有任务
 * - TTSTaskManager.getIsPlaying(): 检查是否正在播放
 */

// ============ 配置常量 ============

/** 缓冲区最大容量（超过此数强制播放最早的已完成任务） */
const MAX_BUFFER_SIZE = 20

/** 任务超时时间（毫秒）— 超过此时间未完成的任务被跳过，避免永久阻塞 */
const TASK_TIMEOUT_MS = 30_000

// ============ 类型定义 ============

/**
 * TTS 任务状态枚举
 */
export enum TTSTaskState {
  /** 排队中，等待生成 */
  Pending = 'pending',
  /** 正在生成音频 */
  Generating = 'generating',
  /** 已生成完成，等待播放 */
  Completed = 'completed',
  /** 正在播放 */
  Playing = 'playing',
  /** 已播放完毕 */
  Played = 'played',
  /** 已取消（新对话到来或生成失败） */
  Cancelled = 'cancelled',
  /** 超时未完成 */
  TimedOut = 'timed_out',
}

/**
 * TTS 音频数据接口
 */
export interface TTSAudioData {
  /** 音频 URL（Blob URL 或 data URI） */
  url: string
  /** 音频时长（毫秒，估算值） */
  durationMs: number
}

/**
 * TTS 任务接口
 */
export interface TTSTask {
  /** 任务序号（递增，用于排序保证播放顺序） */
  seq: number
  /** 要转语音的文本 */
  text: string
  /** 任务状态 */
  state: TTSTaskState
  /** 生成的音频数据 */
  audio: TTSAudioData | null
  /** 创建时间戳 */
  createdAt: number
  /** 完成时间戳 */
  completedAt: number | null
}

/**
 * TTS 生成函数签名
 * 输入文本，异步返回音频数据
 */
export type TTSGenerateFn = (text: string) => Promise<TTSAudioData>

/**
 * TTS 播放函数签名
 * 输入音频数据，异步播放直到完成
 */
export type TTSPlayFn = (audio: TTSAudioData) => Promise<void>

/**
 * TTS 任务管理器回调接口
 */
export interface TTSTaskManagerCallbacks {
  /** 当一个任务完成音频生成时调用 */
  onTaskCompleted?: (task: TTSTask) => void
  /** 当一个任务开始播放时调用 */
  onTaskPlaying?: (task: TTSTask) => void
  /** 当一个任务被取消时调用 */
  onTaskCancelled?: (task: TTSTask) => void
  /** 当一个任务超时时调用 */
  onTaskTimedOut?: (task: TTSTask) => void
  /** 当所有任务都播放完毕时调用 */
  onAllPlayed?: () => void
}

// ============ TTS 任务管理器类 ============

/**
 * TTS 并行有序回放管理器
 *
 * 工作流程：
 * 1. addTask(text) 提交文本，分配递增 seq，立即开始异步并行生成
 * 2. 生成完成的任务进入 completedBuffer，按 seq 排序
 * 3. 播放循环检查：当下一个 seq 的任务已完成且当前未在播放时，取出播放
 * 4. 播放完成后 seq++，继续检查下一个
 * 5. cancelAll() 取消所有待处理任务，用于新对话开始时清理
 *
 * 关键设计：
 * - 并行生成：多个句子同时请求 TTS，减少首字延迟
 * - 有序回放：通过 seq 保证句子播放顺序与文本顺序一致
 * - 超时跳过：生成超时的任务自动跳过，不阻塞后续任务
 * - 缓冲区限制：防止内存无限增长
 * - 代际安全：generation 计数器确保 cancelAll 后旧异步回调不会污染新状态
 */
export class TTSTaskManager {
  /** 下一个任务序号（递增） */
  private nextSeq = 0
  /** 所有任务 Map（seq -> task） */
  private tasks: Map<number, TTSTask> = new Map()
  /** 已完成等待播放的任务缓冲区（按 seq 排序） */
  private completedBuffer: TTSTask[] = []
  /** 下一个应该播放的任务序号 */
  private nextPlaySeq = 0
  /** 当前是否正在播放 */
  private isPlaying = false
  /** TTS 音频生成函数 */
  private generateFn: TTSGenerateFn
  /** TTS 音频播放函数 */
  private playFn: TTSPlayFn
  /** 回调函数 */
  private callbacks: TTSTaskManagerCallbacks
  /** 已取消的任务序号集合（用于生成过程中检查） */
  private cancelledSeqs: Set<number> = new Set()
  /** 代际计数器，每次 cancelAll/reset 递增，用于废弃旧的异步操作 */
  private generation = 0

  constructor(
    generateFn: TTSGenerateFn,
    playFn: TTSPlayFn,
    callbacks: TTSTaskManagerCallbacks = {},
  ) {
    this.generateFn = generateFn
    this.playFn = playFn
    this.callbacks = callbacks
  }

  /**
   * 添加 TTS 任务
   *
   * 立即分配 seq 并开始异步生成，生成完成后进入缓冲区等待有序播放
   *
   * @param text 要转语音的文本
   * @returns 任务序号 seq
   */
  addTask(text: string): number {
    const seq = this.nextSeq++
    const task: TTSTask = {
      seq,
      text,
      state: TTSTaskState.Pending,
      audio: null,
      createdAt: Date.now(),
      completedAt: null,
    }

    this.tasks.set(seq, task)

    // 异步开始并行生成
    this.generateTask(task)

    return seq
  }

  /**
   * 异步生成 TTS 音频
   *
   * 流程：
   * 1. 检查任务是否已被取消
   * 2. 标记为 Generating 状态
   * 3. 调用 generateFn 生成音频
   * 4. 检查代际（generation）是否变化
   * 5. 再次检查是否被取消（生成期间可能 cancelAll）
   * 6. 标记为 Completed，加入完成缓冲区
   * 7. 按 seq 排序缓冲区
   * 8. 检查缓冲区大小限制
   * 9. 触发回调并尝试播放下一个
   *
   * @param task 要生成的任务
   */
  private async generateTask(task: TTSTask): Promise<void> {
    const gen = this.generation

    // 快速路径：任务已被取消，直接返回
    if (this.cancelledSeqs.has(task.seq)) {
      task.state = TTSTaskState.Cancelled
      this.callbacks.onTaskCancelled?.(task)
      return
    }

    task.state = TTSTaskState.Generating

    try {
      const audio = await this.generateFn(task.text)

      // 异步操作完成后检查代际：如果已被 cancelAll/reset 重置，释放资源并返回
      if (this.generation !== gen) {
        this.revokeAudioURL(audio.url)
        return
      }

      // 生成完成后再次检查是否已被取消
      if (this.cancelledSeqs.has(task.seq)) {
        task.state = TTSTaskState.Cancelled
        this.callbacks.onTaskCancelled?.(task)
        this.revokeAudioURL(audio.url)
        return
      }

      task.state = TTSTaskState.Completed
      task.audio = audio
      task.completedAt = Date.now()

      // 加入完成缓冲区并按 seq 排序（保证有序播放）
      this.completedBuffer.push(task)
      this.completedBuffer.sort((a, b) => a.seq - b.seq)

      // 缓冲区容量限制：超过 MAX_BUFFER_SIZE 时强制移除最早的任务
      if (this.completedBuffer.length > MAX_BUFFER_SIZE) {
        const oldest = this.completedBuffer.shift()!
        if (oldest.audio) {
          this.revokeAudioURL(oldest.audio.url)
        }
      }

      this.callbacks.onTaskCompleted?.(task)

      // 新任务完成，尝试启动播放
      this.tryPlayNext()
    } catch {
      // 如果代际已变，说明是 cancelAll 导致的失败，不处理状态
      if (this.generation !== gen) return

      // 生成失败，标记为取消并跳过
      task.state = TTSTaskState.Cancelled
      this.callbacks.onTaskCancelled?.(task)

      // 如果失败的是下一个应该播放的任务，跳过它继续
      if (task.seq === this.nextPlaySeq) {
        this.nextPlaySeq++
        this.tryPlayNext()
      }
    }
  }

  /**
   * 尝试播放下一个就绪的任务
   *
   * 条件：
   * 1. 当前没有正在播放的任务（!isPlaying）
   * 2. 检查并跳过超时任务
   * 3. 缓冲区中第一个任务的 seq 等于 nextPlaySeq
   *
   * 如果下一个 seq 的任务还没完成（在生成中或已取消），则等待
   */
  private tryPlayNext(): void {
    if (this.isPlaying) return

    // 先检查超时任务，避免阻塞
    this.checkTimeouts()

    // 从缓冲区中查找下一个应该播放的任务
    while (this.completedBuffer.length > 0) {
      const next = this.completedBuffer[0]!

      // seq 匹配：播放这个任务
      if (next.seq === this.nextPlaySeq) {
        this.completedBuffer.shift()
        this.playTask(next)
        return
      }

      // seq 小于期望值：已被跳过的任务，移除并释放资源
      if (next.seq < this.nextPlaySeq) {
        this.completedBuffer.shift()
        if (next.audio) {
          this.revokeAudioURL(next.audio.url)
        }
        continue
      }

      // seq 大于期望值：前面的任务还没完成，继续等待
      break
    }
  }

  /**
   * 播放一个任务
   *
   * 流程：
   * 1. 标记为 Playing 状态，触发回调
   * 2. 调用 playFn 播放音频
   * 3. 无论成功失败都标记为 Played
   * 4. 释放 Blob URL 资源（finally 块保证执行）
   * 5. 检查代际，若已重置则不继续操作状态
   * 6. nextPlaySeq++
   * 7. 检查是否所有任务播放完毕
   * 8. 尝试播放下一个
   *
   * @param task 要播放的任务
   */
  private async playTask(task: TTSTask): Promise<void> {
    if (!task.audio) return

    const gen = this.generation

    this.isPlaying = true
    task.state = TTSTaskState.Playing
    this.callbacks.onTaskPlaying?.(task)

    try {
      await this.playFn(task.audio)
      task.state = TTSTaskState.Played
    } catch {
      // 播放失败也标记为已播放，继续前进不阻塞
      task.state = TTSTaskState.Played
    } finally {
      // 释放音频 Blob URL 资源（无论成功失败都执行）
      this.revokeAudioURL(task.audio!.url)
    }

    // 播放完成后检查代际：如果已被 cancelAll/reset 重置，不再操作状态
    if (this.generation !== gen) {
      this.isPlaying = false
      return
    }

    this.nextPlaySeq++
    this.isPlaying = false

    // 检查是否所有任务都播放完毕
    if (this.tasks.size > 0 && this.nextPlaySeq >= this.nextSeq) {
      this.callbacks.onAllPlayed?.()
      this.tasks.clear()
      return
    }

    // 继续尝试播放下一个
    this.tryPlayNext()
  }

  /**
   * 检查超时任务
   *
   * 扫描所有 Pending/Generating 状态的任务：
   * - 超过 TASK_TIMEOUT_MS 未完成的标记为 TimedOut
   * - 如果超时的是 nextPlaySeq，跳过它避免永久阻塞
   */
  private checkTimeouts(): void {
    const now = Date.now()

    for (const [seq, task] of this.tasks) {
      if (task.state === TTSTaskState.Generating || task.state === TTSTaskState.Pending) {
        if (now - task.createdAt > TASK_TIMEOUT_MS) {
          task.state = TTSTaskState.TimedOut
          this.callbacks.onTaskTimedOut?.(task)
          this.cancelledSeqs.add(seq)

          // 如果超时的是下一个应该播放的序号，跳过它
          if (seq === this.nextPlaySeq) {
            this.nextPlaySeq++
          }
        }
      }
    }

    // 跳过已取消的序号（连续跳过多个）
    while (this.cancelledSeqs.has(this.nextPlaySeq) && this.nextPlaySeq < this.nextSeq) {
      this.nextPlaySeq++
    }

    // 超时跳过后可能可以继续播放了
    if (this.nextPlaySeq < this.nextSeq) {
      this.tryPlayNext()
    }
  }

  /**
   * 取消所有待处理任务
   *
   * 新对话到来时调用，清理上一轮对话的所有任务：
   * 1. 递增代际计数器，废弃所有正在进行的异步操作
   * 2. 标记所有未完成任务为 Cancelled
   * 3. 释放缓冲区中的音频资源
   * 4. 清空所有状态，重置序号计数器
   */
  cancelAll(): void {
    // 递增代际计数器，所有在途异步回调检测到代际变化后将自行退出
    this.generation++

    // 标记所有未完成的任务为已取消
    for (const [seq, task] of this.tasks) {
      if (task.state !== TTSTaskState.Played && task.state !== TTSTaskState.Cancelled) {
        task.state = TTSTaskState.Cancelled
        this.cancelledSeqs.add(seq)
        this.callbacks.onTaskCancelled?.(task)
      }
    }

    // 释放缓冲区中所有音频资源
    for (const task of this.completedBuffer) {
      if (task.audio) {
        this.revokeAudioURL(task.audio.url)
      }
    }

    // 重置所有状态
    this.completedBuffer = []
    this.tasks.clear()
    this.nextSeq = 0
    this.nextPlaySeq = 0
    this.isPlaying = false
    this.cancelledSeqs.clear()
  }

  /**
   * 释放 Blob URL 资源
   *
   * 仅释放 blob: 协议的 URL（data URI 不需要释放）
   *
   * @param url 要释放的 URL
   */
  private revokeAudioURL(url: string): void {
    if (url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        // 忽略释放失败
      }
    }
  }

  // ============ 查询方法 ============

  /**
   * 获取指定序号的任务
   * @param seq 任务序号
   * @returns 任务对象，不存在时返回 undefined
   */
  getTask(seq: number): TTSTask | undefined {
    return this.tasks.get(seq)
  }

  /**
   * 获取所有任务（只读数组）
   * @returns 所有任务的数组副本
   */
  getAllTasks(): ReadonlyArray<TTSTask> {
    return [...this.tasks.values()]
  }

  /**
   * 获取完成缓冲区当前大小
   * @returns 缓冲区中等待播放的任务数
   */
  getBufferSize(): number {
    return this.completedBuffer.length
  }

  /**
   * 检查是否正在播放
   * @returns true 表示正在播放音频
   */
  getIsPlaying(): boolean {
    return this.isPlaying
  }

  /**
   * 获取下一个播放序号
   * @returns 下一个应该播放的任务 seq
   */
  getNextPlaySeq(): number {
    return this.nextPlaySeq
  }

  /**
   * 重置管理器
   * 等价于 cancelAll()
   */
  reset(): void {
    this.cancelAll()
  }
}

// ============ 单例 ============

/** 全局单例实例 */
let instance: TTSTaskManager | null = null

/**
 * 获取 TTS 任务管理器单例
 *
 * 首次调用时必须提供 generateFn 和 playFn；后续调用可省略参数复用已有实例
 *
 * @param generateFn TTS 音频生成函数（首次调用时必需）
 * @param playFn TTS 音频播放函数（首次调用时必需）
 * @param callbacks 可选回调函数
 * @returns TTSTaskManager 实例
 */
export function getTTSTaskManager(
  generateFn?: TTSGenerateFn,
  playFn?: TTSPlayFn,
  callbacks?: TTSTaskManagerCallbacks,
): TTSTaskManager {
  if (!instance) {
    // 默认空实现（防止未初始化时调用出错，实际使用必须提供真实函数）
    const defaultGenerate: TTSGenerateFn = async () => ({ url: '', durationMs: 0 })
    const defaultPlay: TTSPlayFn = async () => {}
    instance = new TTSTaskManager(
      generateFn ?? defaultGenerate,
      playFn ?? defaultPlay,
      callbacks,
    )
  }
  return instance
}

/**
 * 重置 TTS 任务管理器（用于切换引擎或重新初始化）
 *
 * 取消所有任务并清空单例，下次 getTTSTaskManager() 时会创建新实例
 */
export function resetTTSTaskManager(): void {
  if (instance) {
    instance.cancelAll()
    instance = null
  }
}

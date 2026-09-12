/**
 * @file voiceRecorder.ts
 * @description 麦克风音频采集模块 — 基于浏览器原生 MediaRecorder API
 *
 * 功能：
 * - 请求麦克风权限并采集音频
 * - 支持开始/停止/取消录音
 * - 停止后输出 Blob（webm/opus 或浏览器支持的其他容器），可直接送 Whisper 类接口
 * - 明确的状态机：idle → recording → stopped / error
 *
 * 说明：
 * - 本模块只负责"采集"，识别见 @/lib/ai/stt.ts
 * - Tauri 桌面端麦克风权限需在 capability/系统侧授权（TODO：Rust 侧未配置）
 * - 不引入任何 npm 依赖，纯浏览器 API
 */

/** 录音器状态机 */
export type RecorderState = 'idle' | 'recording' | 'stopped' | 'error'

/** 一次录音产出的音频数据 */
export interface RecordedAudio {
  blob: Blob
  mimeType: string
  /** 录音时长（毫秒） */
  durationMs: number
}

/** 从未知错误对象中提取可读信息 */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** 挑选 MediaRecorder 支持的 MIME 类型（优先 webm/opus，其次浏览器默认） */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t
    } catch {
      // 某些环境 isTypeSupported 抛异常，忽略后继续尝试
    }
  }
  return undefined
}

/**
 * 语音录制器
 *
 * 典型用法：
 * ```ts
 * const rec = new VoiceRecorder()
 * await rec.start()
 * // ... 用户说话
 * const audio = await rec.stop()
 * await transcribeWithWhisper(audio.blob, config)
 * ```
 */
export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private state: RecorderState = 'idle'
  private startedAt = 0
  private lastAudio: RecordedAudio | null = null
  private stopResolve: ((audio: RecordedAudio) => void) | null = null
  private stopReject: ((err: Error) => void) | null = null

  /** 当前状态 */
  getState(): RecorderState {
    return this.state
  }

  /** 是否正在录音 */
  isRecording(): boolean {
    return this.state === 'recording'
  }

  /** 当前环境是否支持录音（MediaRecorder + getUserMedia） */
  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined'
    )
  }

  /**
   * 开始录音。
   * - 重复调用（已在录音）直接 resolve
   * - 权限被拒绝 / 设备不可用 / 环境不支持时 reject 并置为 error
   */
  async start(): Promise<void> {
    if (this.state === 'recording') return
    if (!VoiceRecorder.isSupported()) {
      this.state = 'error'
      throw new Error('当前环境不支持麦克风录音（MediaRecorder / getUserMedia 不可用）')
    }

    this.chunks = []
    this.lastAudio = null
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      this.state = 'error'
      throw new Error(`麦克风权限被拒绝或设备不可用：${errMsg(err)}`, { cause: err })
    }
    this.stream = stream

    const mimeType = pickMimeType()
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch (err) {
      this.cleanupStream()
      this.state = 'error'
      throw new Error(`MediaRecorder 初始化失败：${errMsg(err)}`, { cause: err })
    }
    this.mediaRecorder = recorder

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data)
    }
    recorder.onerror = () => {
      this.state = 'error'
      this.cleanupStream()
      this.stopReject?.(new Error('录音过程中发生错误'))
      this.stopResolve = null
      this.stopReject = null
    }
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || ''
      const blob = new Blob(this.chunks, { type })
      const audio: RecordedAudio = {
        blob,
        mimeType: type,
        durationMs: Math.max(0, performance.now() - this.startedAt),
      }
      this.lastAudio = audio
      this.cleanupStream()
      this.mediaRecorder = null
      this.state = 'stopped'
      this.stopResolve?.(audio)
      this.stopResolve = null
      this.stopReject = null
    }

    this.startedAt = performance.now()
    // 每 250ms 收集一次数据块，避免长时间单次 buffer
    recorder.start(250)
    this.state = 'recording'
  }

  /**
   * 停止录音并产出 Blob。
   * 未在录音时 reject。
   */
  stop(): Promise<RecordedAudio> {
    return new Promise((resolve, reject) => {
      const recorder = this.mediaRecorder
      if (!recorder || this.state !== 'recording') {
        reject(new Error('当前未在录音'))
        return
      }
      this.stopResolve = resolve
      this.stopReject = reject
      try {
        recorder.stop()
      } catch (err) {
        this.cleanupStream()
        this.mediaRecorder = null
        this.state = 'error'
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** 取消录音（丢弃已采集数据，不产出 Blob） */
  cancel(): void {
    const recorder = this.mediaRecorder
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      try {
        recorder.stop()
      } catch {
        // 忽略取消时的异常
      }
    }
    this.cleanupStream()
    this.mediaRecorder = null
    this.chunks = []
    this.lastAudio = null
    this.stopResolve = null
    this.stopReject = null
    this.state = 'idle'
  }

  /** 最近一次停止后的音频 Blob（未完成录音时为 null） */
  getAudioBlob(): Blob | null {
    return this.lastAudio?.blob ?? null
  }

  /** 最近一次停止后的完整音频数据 */
  getAudioData(): RecordedAudio | null {
    return this.lastAudio
  }

  private cleanupStream(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop()
        } catch {
          // 忽略轨道停止异常
        }
      }
      this.stream = null
    }
  }
}

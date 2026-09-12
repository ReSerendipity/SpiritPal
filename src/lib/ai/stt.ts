/**
 * @file stt.ts
 * @description 语音识别（Speech-To-Text）模块
 *
 * 两种识别后端：
 * 1. browser — 浏览器原生 Web Speech API（SpeechRecognition），零依赖、实时流式
 *    - 主方案：无需上传音频文件，识别结果通过回调实时吐出
 *    - 支持中英文（lang 可配，默认 zh-CN，浏览器自动混合识别中英）
 *    - 可用性依赖浏览器内核（Chrome / Edge WebView2 内置；Firefox 不支持）
 * 2. whisper — OpenAI 兼容 Whisper 转录接口（/v1/audio/transcriptions）
 *    - 可选后端：用于不支持 Web Speech 的环境，需 API Key
 *    - 输入为 VoiceRecorder 产出的 Blob
 *
 * 设计原则：
 * - 主路径零网络、零配置；Whisper 仅作为可选降级
 * - 网络请求统一走 safeFetch（SSRF 保护 + Tauri 代理）
 *
 * 主要导出：
 * - isSpeechRecognitionSupported(): 是否支持浏览器实时识别
 * - STTEngine: 实时识别引擎（start/stop/abort）
 * - transcribeWithWhisper(blob, config): 一次性音频文件转录
 */

// 统一网络出口：Whisper API 请求走 safeFetch（与 ttsEngine 一致）
import { safeFetch } from '@/lib/system/ssrfProtection'

// ============ Web Speech API 最小类型声明 ============
// TS 标准 DOM 库未覆盖 SpeechRecognition，这里只声明用到的最小子集。

interface SpeechRecognitionResultLike {
  transcript: string
  confidence: number
  isFinal: boolean
}

interface SpeechRecognitionResultListLike {
  readonly length: number
  item(index: number): SpeechRecognitionResultLike
  [index: number]: SpeechRecognitionResultLike
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLike
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string
  readonly message?: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/** 取 SpeechRecognition 构造器（含 webkit 前缀兼容），不支持时返回 null */
function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as SpeechRecognitionCtor | undefined
  return ctor ?? null
}

/** 当前环境是否支持 Web Speech API 实时识别 */
export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null
}

// ============ 实时识别引擎 ============

/** 实时识别回调集合 */
export interface RealtimeSTTCallbacks {
  /** 实时（含中间结果）文本，每次回调均为"截至目前的完整文本" */
  onPartial?: (text: string) => void
  /** 一句话定稿后的文本 */
  onFinal?: (text: string) => void
  /** 识别出错（用户主动停止的 aborted 不计为错误） */
  onError?: (error: string) => void
  /** 识别会话结束（自动结束或手动 stop 后触发） */
  onEnd?: () => void
}

/** 识别参数 */
export interface STTOptions {
  /** 识别语言，默认 zh-CN（浏览器通常可中英混合识别） */
  lang?: string
  /** 是否返回中间结果，默认 true */
  interimResults?: boolean
  /** 是否连续识别，默认 true（由用户点按钮控制停止） */
  continuous?: boolean
}

/** 错误码 → 可读文案 */
function sttErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风权限被拒绝，请在系统/浏览器设置中允许麦克风'
    case 'no-speech':
      return '没有检测到语音，请靠近麦克风再试'
    case 'audio-capture':
      return '未检测到麦克风设备'
    case 'network':
      return '语音识别网络错误'
    default:
      return `识别出错（${code}）`
  }
}

/**
 * 浏览器实时语音识别引擎。
 *
 * 生命周期：start() → 持续 onPartial/onFinal → stop()（或浏览器自动结束触发 onEnd）。
 * 组件卸载时务必调用 abort() 释放会话。
 */
export class STTEngine {
  private recognition: SpeechRecognitionLike | null = null
  private callbacks: RealtimeSTTCallbacks | null = null
  private active = false
  /** 已定稿文本累加（连续模式下多句话合并） */
  private finalBuffer = ''

  /** 是否支持浏览器识别 */
  isSupported(): boolean {
    return isSpeechRecognitionSupported()
  }

  /** 识别会话是否进行中 */
  isActive(): boolean {
    return this.active
  }

  /**
   * 开始实时识别。不支持环境下直接 throw。
   */
  start(callbacks: RealtimeSTTCallbacks, options: STTOptions = {}): void {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      throw new Error('当前环境不支持 Web Speech API 语音识别（需 Chrome/Edge 内核）')
    }
    this.stopInternal()
    this.callbacks = callbacks
    this.finalBuffer = ''

    const rec = new Ctor()
    rec.lang = options.lang ?? 'zh-CN'
    rec.continuous = options.continuous ?? true
    rec.interimResults = options.interimResults ?? true
    rec.maxAlternatives = 1

    rec.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (!r) continue
        if (r.isFinal) {
          this.finalBuffer += r.transcript
        } else {
          interim += r.transcript
        }
      }
      const full = this.finalBuffer + interim
      callbacks.onPartial?.(full)
      // 中间结果为空且有定稿文本时，视为一句话定稿
      if (!interim && this.finalBuffer) {
        callbacks.onFinal?.(this.finalBuffer)
      }
    }
    rec.onerror = (event) => {
      // 用户主动 stop() 触发的 aborted 不算错误
      if (event.error !== 'aborted') {
        callbacks.onError?.(sttErrorMessage(event.error))
      }
    }
    rec.onend = () => {
      this.active = false
      callbacks.onEnd?.()
    }

    this.recognition = rec
    this.active = true
    rec.start()
  }

  /** 正常停止（等待 onend 触发收尾） */
  stop(): void {
    try {
      this.recognition?.stop()
    } catch {
      // 已停止的会话重复 stop 忽略
    }
  }

  /** 立即中止并释放引用（不等 onend） */
  abort(): void {
    try {
      this.recognition?.abort()
    } catch {
      // 忽略
    }
    this.active = false
    this.recognition = null
    this.callbacks = null
  }

  private stopInternal(): void {
    if (this.recognition) {
      try {
        this.recognition.abort()
      } catch {
        // 忽略
      }
    }
    this.recognition = null
    this.active = false
  }
}

// ============ Whisper 可选后端 ============

/** Whisper 转录接口配置 */
export interface WhisperSTTConfig {
  /** API Key（从 secureStorage 读取，勿明文落盘） */
  apiKey: string
  /** 自定义端点（兼容 OpenAI 协议即可），默认 OpenAI 官方 */
  endpoint?: string
  /** 模型名，默认 whisper-1 */
  model?: string
  /** 语言代码（如 zh），可选 */
  language?: string
}

/**
 * 一次性音频文件转录（Whisper 兼容接口）。
 * 用于 Web Speech API 不可用的环境，输入为 VoiceRecorder 产出的 Blob。
 */
export async function transcribeWithWhisper(blob: Blob, config: WhisperSTTConfig): Promise<string> {
  if (!config.apiKey) {
    throw new Error('Whisper 识别需要配置 API Key')
  }
  const endpoint = config.endpoint ?? 'https://api.openai.com/v1/audio/transcriptions'
  const form = new FormData()
  form.append('file', blob, 'audio.webm')
  form.append('model', config.model ?? 'whisper-1')
  if (config.language) form.append('language', config.language)

  const resp = await safeFetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  })
  if (!resp.ok) {
    throw new Error(`Whisper 识别失败：HTTP ${resp.status}`)
  }
  const data = (await resp.json()) as { text?: string }
  if (!data.text || !data.text.trim()) {
    throw new Error('Whisper 识别失败：返回文本为空')
  }
  return data.text.trim()
}

/**
 * VOICEVOX ENGINE 本地 TTS 客户端
 *
 * 调用本机 VOICEVOX ENGINE（默认 http://127.0.0.1:50021）的 HTTP API：
 *   1. POST /audio_query?text=&speaker=  —— 文本 + 声优 → audio_query 发音词典 JSON
 *   2. POST /synthesis?speaker=          —— audio_query JSON → wav 音频 Blob
 * 健康探测：GET /version
 * 声优列表：GET /speakers
 *
 * 网络出口统一走 safeFetch（回环直通；Tauri 下经 Rust 代理），与 cogneeClient / ttsEngine 一致。
 * 引擎未启动 / 不可达时，isEngineAvailable() 静默返回 false；synthesize/getSpeakers 抛出
 * 带 HTTP 状态码的 VoicevoxEngineError，由上层（朗读按钮）决定降级提示。
 */
import { safeFetch } from '@/lib/system/ssrfProtection'

/** 单个声优的语调样式（VOICEVOX 一个声优可有多个 style，对应不同 speaker id） */
export interface SpeakerStyle {
  name: string
  id: number
}

/** VOICEVOX /speakers 返回的声优对象 */
export interface Speaker {
  name: string
  speaker_uuid: string
  styles: SpeakerStyle[]
}

/** audio_query 响应结构（字段很多，这里只保留不透明对象透传给 /synthesis） */
export type AudioQuery = Record<string, unknown>

/** 默认 VOICEVOX ENGINE 地址 */
export const DEFAULT_VOICEVOX_URL = 'http://127.0.0.1:50021'

/** 默认 speaker id（ずんだもん あまあま，VOICEVOX 开箱即用的常用音色） */
export const DEFAULT_SPEAKER_ID = 1

/** VOICEVOX 相关错误，附带 HTTP 状态码便于上层区分「引擎没启动」与「文本非法」 */
export class VoicevoxEngineError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'VoicevoxEngineError'
  }
}

/**
 * VOICEVOX TTS 引擎封装
 *
 * - setEngineUrl 可运行时切换引擎地址（默认 localhost:50021）
 * - synthesize 完成两段式 API 调用并返回 wav Blob
 */
export class TTSEngine {
  private engineUrl: string
  private defaultSpeaker: number

  constructor(engineUrl: string = DEFAULT_VOICEVOX_URL, defaultSpeaker: number = DEFAULT_SPEAKER_ID) {
    this.engineUrl = engineUrl.replace(/\/+$/, '')
    this.defaultSpeaker = defaultSpeaker
  }

  /** 配置引擎地址（自动去掉末尾斜杠） */
  setEngineUrl(url: string): void {
    this.engineUrl = url.replace(/\/+$/, '')
  }

  /** 当前引擎地址 */
  getEngineUrl(): string {
    return this.engineUrl
  }

  /** 探测引擎是否在线（GET /version，超时 1.5s）。任何异常都视为不可用。 */
  async isEngineAvailable(timeoutMs = 1500): Promise<boolean> {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      const r = await safeFetch(`${this.engineUrl}/version`, { signal: ctrl.signal })
      clearTimeout(t)
      return r.ok
    } catch {
      return false
    }
  }

  /** 获取全部可用声优（GET /speakers） */
  async getSpeakers(): Promise<Speaker[]> {
    const r = await safeFetch(`${this.engineUrl}/speakers`)
    if (!r.ok) {
      throw new VoicevoxEngineError(`获取声优列表失败（HTTP ${r.status}）`, r.status)
    }
    return (await r.json()) as Speaker[]
  }

  /** 第一步：文本 → audio_query 发音词典 JSON */
  private async audioQuery(text: string, speaker: number): Promise<AudioQuery> {
    const url = `${this.engineUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`
    const r = await safeFetch(url, { method: 'POST' })
    if (!r.ok) {
      throw new VoicevoxEngineError(
        `audio_query 失败（HTTP ${r.status}）：VOICEVOX 引擎未启动或文本非法`,
        r.status,
      )
    }
    return (await r.json()) as AudioQuery
  }

  /**
   * 文本 → wav Blob
   * @param text 待合成文本（调用方负责清洗标签 / 截断长度）
   * @param speakerId 声优 style id；缺省使用构造时的 defaultSpeaker
   */
  async synthesize(text: string, speakerId?: number): Promise<Blob> {
    const trimmed = text.trim()
    if (!trimmed) {
      throw new VoicevoxEngineError('合成文本为空')
    }
    const speaker = speakerId ?? this.defaultSpeaker
    const query = await this.audioQuery(trimmed, speaker)
    const synthUrl = `${this.engineUrl}/synthesis?speaker=${speaker}`
    const r = await safeFetch(synthUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/wav',
      },
      body: JSON.stringify(query),
    })
    if (!r.ok) {
      throw new VoicevoxEngineError(`语音合成失败（HTTP ${r.status}）`, r.status)
    }
    return await r.blob()
  }
}

/** 进程内共享单例（默认连本机 50021） */
export const voicevoxTTS = new TTSEngine()

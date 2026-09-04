/**
 * @file ttsEngine.ts
 * @description TTS 引擎适配器模块 — 浏览器原生 SpeechSynthesis + 外部 TTS API
 *
 * 支持两种 TTS 引擎：
 * 1. browser — 浏览器原生 SpeechSynthesis API（零依赖，质量取决于系统 TTS）
 * 2. api — 外部 TTS API（如 GPT-SoVITS、Edge-TTS，需配置端点）
 *
 * 设计原则：
 * 1. 接口统一：所有引擎实现相同的 TTSGenerateFn / TTSPlayFn 签名
 * 2. 降级策略：外部引擎失败时自动回退到浏览器原生
 * 3. 零依赖核心：浏览器原生引擎无需任何外部依赖
 * 4. 可扩展：通过配置灵活切换引擎
 * 5. 语音参数统一：rate/pitch/volume/lang 跨引擎一致
 *
 * P3-23: 语音交互（TTS/ASR）
 *
 * 主要模块：
 * - TTSEngineType/TTSEngineConfig: 引擎类型和配置接口
 * - createBrowserTTSGenerate/createBrowserTTSPlay: 浏览器原生引擎工厂
 * - createApiTTSGenerate/createApiTTSPlay: 外部 API 引擎工厂
 * - TTSEngineManager: TTS 引擎管理器类
 * - getTTSEngineManager(): 获取单例实例
 *
 * 依赖关系：
 * - ./ttsTaskManager: TTS 任务管理器（并行生成、有序回放）
 *
 * 核心接口：
 * - TTSEngineManager.enable()/disable(): 启停 TTS
 * - TTSEngineManager.speak(): 朗读文本
 * - TTSEngineManager.cancel(): 取消朗读
 * - TTSEngineManager.updateConfig(): 更新配置
 */

import { type TTSAudioData, type TTSGenerateFn, type TTSPlayFn, getTTSTaskManager, resetTTSTaskManager } from './ttsTaskManager'

// ============ 类型定义 ============

/** TTS 引擎类型 */
export type TTSEngineType = 'browser' | 'api'

/**
 * TTS 引擎配置接口
 */
export interface TTSEngineConfig {
  /** 引擎类型 */
  engine: TTSEngineType
  /** 语音速率（0.1-10，默认 1.0） */
  rate: number
  /** 语音音调（0-2，默认 1.0） */
  pitch: number
  /** 语音音量（0-1，默认 0.8） */
  volume: number
  /** 语音语言（默认 'zh-CN'） */
  lang: string
  /** 外部 API 端点（api 引擎必需） */
  apiEndpoint?: string
  /** API 密钥（可选，用于需要认证的服务） */
  apiKey?: string
  /** 角色/音色 ID（GPT-SoVITS 等引擎的音色参数） */
  speakerId?: string
}

/** 默认配置 */
const DEFAULT_CONFIG: TTSEngineConfig = {
  engine: 'browser',
  rate: 1.0,
  pitch: 1.0,
  volume: 0.8,
  lang: 'zh-CN',
}

// ============ 浏览器原生 TTS 引擎 ============

/**
 * 创建浏览器原生 TTS 生成函数
 *
 * 使用浏览器原生 SpeechSynthesis API 生成语音：
 * - 零外部依赖
 * - 质量取决于操作系统 TTS 引擎
 * - 自动选择中文语音（如可用）
 * - 无法直接获取音频数据，通过文本长度估算时长
 *
 * @param config TTS 引擎配置
 * @returns TTSGenerateFn 生成函数
 * @throws SpeechSynthesis API 不可用时抛出错误
 */
export function createBrowserTTSGenerate(config: TTSEngineConfig): TTSGenerateFn {
  return async (text: string): Promise<TTSAudioData> => {
    return new Promise((resolve, reject) => {
      if (typeof speechSynthesis === 'undefined') {
        reject(new Error('SpeechSynthesis API 不可用'))
        return
      }

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = config.rate
      utterance.pitch = config.pitch
      utterance.volume = config.volume
      utterance.lang = config.lang

      // 优先选择中文语音
      const voices = speechSynthesis.getVoices()
      const zhVoice = voices.find((v) => v.lang.startsWith('zh'))
      if (zhVoice) {
        utterance.voice = zhVoice
      }

      utterance.onend = () => {
        // 浏览器原生 TTS 无法直接获取音频数据
        // 估算时长：中文约 4 字/秒
        const estimatedDurationMs = Math.max(500, (text.length / 4) * 1000)
        resolve({
          url: '', // 浏览器原生直接在 generate 阶段播放，不需要 URL
          durationMs: estimatedDurationMs,
        })
      }

      utterance.onerror = (event) => {
        reject(new Error(`SpeechSynthesis 错误: ${event.error}`))
      }

      speechSynthesis.speak(utterance)
    })
  }
}

/**
 * 创建浏览器原生 TTS 播放函数
 *
 * 浏览器原生 TTS 在 generate 阶段已经调用 speechSynthesis.speak()
 * 此函数仅作为占位，等待估算的播放时长
 *
 * @returns TTSPlayFn 播放函数
 */
export function createBrowserTTSPlay(): TTSPlayFn {
  return async (_audio: TTSAudioData) => {
    // 浏览器原生 TTS 在 generate 阶段已经播放
    // 如果有估算时长，等待该时长以保持播放节奏一致
    if (_audio.durationMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, _audio.durationMs))
    }
  }
}

// ============ 外部 API TTS 引擎 ============

/** 当前正在播放的 API 音频元素（用于中断播放） */
let currentApiAudioEl: HTMLAudioElement | null = null
/** 当前播放 Promise 的 reject 函数（用于中断时 reject） */
let currentApiAudioReject: ((reason?: unknown) => void) | null = null

/**
 * 停止当前正在播放的 API 音频
 *
 * 调用 audioEl.pause() 中断播放，清空 src 释放资源，
 * 并 reject 播放 Promise 让调用栈感知到取消
 */
function stopCurrentApiAudio(): void {
  if (currentApiAudioEl) {
    try {
      currentApiAudioEl.pause()
      currentApiAudioEl.src = ''
      currentApiAudioEl.onended = null
      currentApiAudioEl.onerror = null
    } catch {
      // 忽略清理错误
    }
    currentApiAudioEl = null
  }
  if (currentApiAudioReject) {
    try {
      currentApiAudioReject(new Error('TTS playback cancelled'))
    } catch {
      // 忽略 reject 错误
    }
    currentApiAudioReject = null
  }
}

/**
 * 创建外部 TTS API 生成函数
 *
 * 通过 HTTP POST 请求调用外部 TTS API：
 * - 支持 GPT-SoVITS、Edge-TTS 等兼容 API
 * - 30 秒超时保护
 * - 返回音频 Blob URL 供播放
 * - 支持 Bearer Token 认证
 *
 * @param config TTS 引擎配置（需包含 apiEndpoint）
 * @returns TTSGenerateFn 生成函数
 * @throws 未配置 apiEndpoint 或请求失败时抛出错误
 */
export function createApiTTSGenerate(config: TTSEngineConfig): TTSGenerateFn {
  return async (text: string): Promise<TTSAudioData> => {
    if (!config.apiEndpoint) {
      throw new Error('API TTS 引擎需要配置 apiEndpoint')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000) // 30 秒超时

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`
      }

      const response = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text,
          speaker_id: config.speakerId ?? 'default',
          language: config.lang,
          speed: config.rate,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`TTS API 返回 ${response.status}`)
      }

      // 获取音频 Blob 并创建 Object URL
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)

      // 估算时长（中文约 4 字/秒）
      const estimatedDurationMs = Math.max(500, (text.length / 4) * 1000)

      return {
        url,
        durationMs: estimatedDurationMs,
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

/**
 * 创建 API TTS 播放函数
 *
 * 使用 HTMLAudioElement 播放 Blob URL：
 * - 自动播放被阻止时静默处理（不抛出异常）
 * - 播放结束后 Promise resolve
 *
 * @returns TTSPlayFn 播放函数
 */
export function createApiTTSPlay(): TTSPlayFn {
  return async (audio: TTSAudioData) => {
    if (!audio.url) return

    return new Promise<void>((resolve, reject) => {
      const audioEl = new Audio(audio.url)
      audioEl.volume = 1.0

      // 注册到全局引用，支持外部中断
      currentApiAudioEl = audioEl
      currentApiAudioReject = reject

      const cleanup = () => {
        audioEl.onended = null
        audioEl.onerror = null
        // 清空 src 释放媒体资源和 Blob 引用
        try {
          audioEl.pause()
          audioEl.src = ''
        } catch {
          // 忽略清理错误
        }
        if (currentApiAudioEl === audioEl) {
          currentApiAudioEl = null
          currentApiAudioReject = null
        }
      }

      audioEl.onended = () => {
        cleanup()
        resolve()
      }
      audioEl.onerror = () => {
        cleanup()
        reject(new Error('音频播放失败'))
      }

      audioEl.play().catch(() => {
        // 浏览器自动播放策略被阻止时静默处理
        cleanup()
        resolve()
      })
    })
  }
}

// ============ TTS 引擎管理器类 ============

/**
 * TTS 引擎管理器
 *
 * 统一管理 TTS 引擎的初始化、配置、朗读和取消：
 * - 根据配置选择 browser 或 api 引擎
 * - API 引擎失败时自动降级到浏览器原生
 * - 与 TTSTaskManager 协作实现并行生成、有序回放
 * - 提供静态方法检测浏览器支持和获取语音列表
 */
export class TTSEngineManager {
  /** 当前配置 */
  private config: TTSEngineConfig
  /** TTS 是否启用 */
  private enabled: boolean = false
  /** 是否已初始化 */
  private initialized: boolean = false

  constructor(config?: Partial<TTSEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 更新 TTS 配置
   *
   * 配置变更后重新初始化引擎（切换引擎或参数时生效）
   *
   * @param config 部分配置（合并到现有配置）
   */
  updateConfig(config: Partial<TTSEngineConfig>): void {
    this.config = { ...this.config, ...config }
    // 配置变更后需要重新初始化
    this.initialized = false
    if (this.enabled) {
      this.init()
    }
  }

  /**
   * 获取当前配置（只读副本）
   * @returns 当前配置
   */
  getConfig(): Readonly<TTSEngineConfig> {
    return this.config
  }

  /**
   * 启用 TTS
   *
   * 初始化引擎并准备好接收朗读请求
   */
  enable(): void {
    this.enabled = true
    this.init()
  }

  /**
   * 禁用 TTS
   *
   * 停止当前播放（包括 API 音频和浏览器原生 TTS），重置任务管理器
   */
  disable(): void {
    this.enabled = false
    // 停止正在播放的 API 音频
    stopCurrentApiAudio()
    // 停止浏览器原生 TTS
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel()
    }
    resetTTSTaskManager()
  }

  /**
   * 检查 TTS 是否已启用
   * @returns true 表示已启用
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 初始化 TTS 任务管理器
   *
   * 初始化流程：
   * 1. 根据配置选择引擎（api 或 browser）
   * 2. 创建 generate 和 play 函数
   * 3. 重置并配置 TTSTaskManager
   * 4. 如果初始化失败，降级到浏览器原生
   */
  private init(): void {
    if (this.initialized) return

    let generateFn: TTSGenerateFn
    let playFn: TTSPlayFn

    try {
      if (this.config.engine === 'api' && this.config.apiEndpoint) {
        generateFn = createApiTTSGenerate(this.config)
        playFn = createApiTTSPlay()
      } else {
        generateFn = createBrowserTTSGenerate(this.config)
        playFn = createBrowserTTSPlay()
      }

      resetTTSTaskManager()
      getTTSTaskManager(generateFn, playFn, {
        onTaskPlaying: (_task) => {
          // 可以在这里触发宠物口型动画
        },
        onAllPlayed: () => {
          // 所有语音播放完毕
        },
      })

      this.initialized = true
    } catch (err) {
      console.error('[TTSEngine] 初始化失败:', err)
      // 降级策略：API 引擎失败时回退到浏览器原生
      try {
        const fallbackGenerate = createBrowserTTSGenerate(this.config)
        const fallbackPlay = createBrowserTTSPlay()
        resetTTSTaskManager()
        getTTSTaskManager(fallbackGenerate, fallbackPlay)
        this.initialized = true
      } catch {
        console.error('[TTSEngine] 降级初始化也失败')
      }
    }
  }

  /**
   * 朗读文本
   *
   * 将文本添加到 TTS 任务队列，由 TTSTaskManager 负责并行生成和有序播放
   *
   * @param text 要朗读的文本
   * @returns 任务序号，TTS 未启用或未初始化时返回 null
   */
  speak(text: string): number | null {
    if (!this.enabled || !this.initialized) return null

    try {
      const mgr = getTTSTaskManager()
      return mgr.addTask(text)
    } catch {
      return null
    }
  }

  /**
   * 取消当前朗读和所有待处理任务
   */
  cancel(): void {
    if (!this.initialized) return
    // 立即停止正在播放的 API 音频
    stopCurrentApiAudio()
    try {
      getTTSTaskManager().cancelAll()
    } catch { /* 忽略 */ }
    // 同时取消浏览器原生 TTS
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel()
    }
  }

  /**
   * 彻底释放 TTS 引擎所有资源
   *
   * - 停止所有播放（API 音频和浏览器原生 TTS）
   * - 重置任务管理器
   * - 禁用 TTS
   * - 重置单例引用，下次 getTTSEngineManager() 会创建新实例
   */
  dispose(): void {
    this.enabled = false
    this.initialized = false
    stopCurrentApiAudio()
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel()
    }
    resetTTSTaskManager()
    engineMgr = null
  }

  /**
   * 检查浏览器是否支持 SpeechSynthesis API
   * @returns true 表示支持
   */
  static isSupported(): boolean {
    return typeof speechSynthesis !== 'undefined'
  }

  /**
   * 获取所有可用语音列表
   * @returns SpeechSynthesisVoice 数组
   */
  static getVoices(): SpeechSynthesisVoice[] {
    if (typeof speechSynthesis === 'undefined') return []
    return speechSynthesis.getVoices()
  }

  /**
   * 获取中文语音列表
   * @returns lang 以 'zh' 开头的语音数组
   */
  static getChineseVoices(): SpeechSynthesisVoice[] {
    return TTSEngineManager.getVoices().filter((v) => v.lang.startsWith('zh'))
  }
}

// ============ 单例 ============

/** 全局单例实例 */
let engineMgr: TTSEngineManager | null = null

/**
 * 获取 TTS 引擎管理器单例
 * @param config 可选配置（首次创建时生效）
 * @returns TTSEngineManager 实例
 */
export function getTTSEngineManager(config?: Partial<TTSEngineConfig>): TTSEngineManager {
  if (!engineMgr) {
    engineMgr = new TTSEngineManager(config)
  }
  return engineMgr
}

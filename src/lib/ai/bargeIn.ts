/**
 * @file bargeIn.ts
 * @description 语音打断（barge-in）— 用户一开口/一发消息就停掉正在播放的 TTS，并清理排队任务
 *
 * 参考竞品：ChatdollKit AIAvatar.cs（StopResponseOnBargeIn / InterruptWords + 最短文本阈值）、
 *           Open-LLM-VTuber README（语音打断为标配）
 *
 * 设计：
 * - 播放方通过 registerSpeechStopper() 注册“停止并返回是否正在播放”的回调（可多个）
 * - 交互方（麦克风、发送按钮、STT 中间结果）调用 interruptSpeech(reason)
 * - 灰度开关 spiritpal:barge-in-enabled（默认开），关闭后退化为旧行为
 * - 不做 VAD/AEC：只由明确的用户动作触发，避免 TTS 外放回声自打断
 */

import { ttsPlayer } from '@/lib/ai/ttsPlayer'
import { getTTSEngineManager } from '@/lib/system/ttsEngine'
import { getTTSTaskManagerIfExists } from '@/lib/system/ttsTaskManager'

/** 打断触发来源 */
export type BargeInReason = 'mic' | 'send' | 'voice' | 'manual'
/** 停止回调：返回 true 表示当时确实有音频在播 */
export type SpeechStopper = () => boolean

/** localStorage 灰度开关键 */
const ENABLE_KEY = 'spiritpal:barge-in-enabled'

/** 已注册的停止回调 */
const stoppers = new Set<SpeechStopper>()

/** 是否启用（默认启用；读取失败按启用处理） */
export function isBargeInEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLE_KEY) !== '0'
  } catch {
    return true
  }
}

/** 设置灰度开关（设置页/测试使用） */
export function setBargeInEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLE_KEY, enabled ? '1' : '0')
  } catch {
    /* 存储不可用时忽略：本次进程内仍按默认启用 */
  }
}

/**
 * 注册一个“停止播放”回调
 * @returns 取消注册函数
 */
export function registerSpeechStopper(stopper: SpeechStopper): () => void {
  stoppers.add(stopper)
  return () => stoppers.delete(stopper)
}

/**
 * 打断当前语音播放
 * @param reason 触发来源（用于日志与后续埋点）
 * @returns 是否确实打断了正在播放的音频
 */
export function interruptSpeech(reason: BargeInReason): boolean {
  if (!isBargeInEnabled()) return false

  let interrupted = false

  // 内置：全局 TTS 引擎（SpeechSynthesis / API 音频 / TTSTaskManager 队列）
  try {
    const engine = getTTSEngineManager()
    if (engine.isSpeaking()) {
      interrupted = true
      engine.cancel()
    }
  } catch (err) {
    console.warn(`[BargeIn] 停止 TTS 引擎失败 (${reason}):`, err)
  }

  // 内置：共享 HTMLAudio 播放器（VOICEVOX wav 等）
  try {
    if (ttsPlayer.isPlaying()) {
      interrupted = true
      ttsPlayer.stop()
    }
  } catch (err) {
    console.warn(`[BargeIn] 停止 HTMLAudio 失败 (${reason}):`, err)
  }

  // 内置：TTS 任务队列（不创建实例，只在已存在时取消）
  try {
    const mgr = getTTSTaskManagerIfExists()
    if (mgr?.getIsPlaying()) {
      interrupted = true
      mgr.cancelAll()
    }
  } catch (err) {
    console.warn(`[BargeIn] 取消 TTS 队列失败 (${reason}):`, err)
  }

  // 外部播放器（如 ChatWindow 内的 VOICEVOX TTSPlayer 实例）
  for (const stopper of stoppers) {
    try {
      if (stopper() === true) interrupted = true
    } catch (err) {
      console.warn(`[BargeIn] stopper 执行失败 (${reason}):`, err)
    }
  }
  return interrupted
}

/**
 * 当前是否有语音正在播放
 * 供主动说话等“避免叠音”的场景做门禁
 */
export function isSpeechPlaying(): boolean {
  try {
    if (getTTSEngineManager().isSpeaking()) return true
  } catch {
    /* 引擎不可用时忽略 */
  }
  try {
    if (ttsPlayer.isPlaying()) return true
  } catch {
    /* 播放器不可用时忽略 */
  }
  try {
    if (getTTSTaskManagerIfExists()?.getIsPlaying()) return true
  } catch {
    /* 任务队列不可用时忽略 */
  }
  return false
}

/** 去掉首尾空白与标点后的“有效字数”（CJK 逐字、拉丁按词） */
function countSubstantive(text: string): number {
  const normalized = text
    .trim()
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】[\]…—\-~～]+/g, ' ')
    .trim()
  if (!normalized) return 0

  const cjk = normalized.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  // 英文/数字按词计 2 分：一个 ≥2 字符的单词（ok/hi）即构成有效开口
  const words = normalized.match(/[A-Za-z0-9]{2,}/g)?.length ?? 0
  return cjk + words * 2
}

/**
 * 判断识别文本是否构成“有效开口”
 * 用于过滤环境噪声造成的 1 个字/语气词误触发（如“嗯”“啊”）
 * @param text STT 中间或最终结果
 * @param minSubstantive 最小有效单位（CJK 字或英文词），默认 2
 */
export function isSubstantiveUtterance(text: string, minSubstantive: number = 2): boolean {
  return countSubstantive(text) >= minSubstantive
}

/** 仅测试用：清空所有已注册的 stopper */
export function clearSpeechStoppersForTests(): void {
  stoppers.clear()
}

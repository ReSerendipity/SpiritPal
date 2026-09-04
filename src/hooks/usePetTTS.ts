/**
 * 语音朗读 (TTS) Hook — 将 TTS 引擎接入对话链路
 *
 * 使用 ttsEngine 的浏览器原生 SpeechSynthesis（零依赖）：
 * - 挂载时启用、卸载时禁用
 * - speak 前清洗文本（去掉 markdown/代码块/方括号标签/情绪标签），并截断防止超长
 * - 全程 try/catch 静默降级，不影响主流程
 */
import { useCallback, useEffect } from 'react'
import { getTTSEngineManager } from '@/lib/system/ttsEngine'

export function usePetTTS(): { speak: (text: string) => void } {
  useEffect(() => {
    try {
      getTTSEngineManager().enable()
    } catch {
      // 静默降级
    }
    return () => {
      try {
        getTTSEngineManager().disable()
      } catch {
        // 静默降级
      }
    }
  }, [])

  const speak = useCallback((text: string) => {
    try {
      // 清洗：去掉代码块、方括号/中括号标签（情绪、think、系统备注）、markdown 符号、多余空白
      const clean = (text ?? '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/\[[^\]]*\]|【[^】]*】/g, ' ')
        .replace(/[*#>`_~]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!clean) return
      getTTSEngineManager().speak(clean.slice(0, 500))
    } catch {
      // 静默降级
    }
  }, [])

  return { speak }
}
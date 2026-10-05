/**
 * @file capabilityToggles.ts
 * @description AI 能力开关应用层（审计工单 P2-11）
 *
 * settingsStore 里的四个能力开关（weatherEnabled / proactiveSpeakEnabled /
 * emotionEnabled / contextAwarenessEnabled）本身只是持久化布尔值；
 * 本模块负责把它们真正应用到对应管理器：
 * - WeatherAwarenessManager：start/stop 定时刷新
 * - ProactiveSpeakManager：start/stop 定时检查（start 受能力门拦截）
 * - EmotionManager：tick 短路（桌面端外部定时器仍在跑，不能只 stop 定时器）
 * - ContextAwarenessManager：原生 setEnabled
 *
 * initCapabilitySettingsSync() 在 main.tsx 启动时调用一次：先应用当前值，
 * 再订阅 settingsStore——任何设置变更（任意字段）都会重放应用（start/stop/setEnabled 均幂等）。
 *
 * @module system/capabilityToggles
 */
import { getContextAwarenessManager } from '@/lib/ai/contextAwareness'
import { getEmotionManager } from '@/lib/ai/emotionManager'
import { getProactiveSpeakManager } from '@/lib/ai/proactiveSpeak'
import { getWeatherAwarenessManager } from '@/lib/system/weatherAwareness'
import { useSettingsStore } from '@/stores/settingsStore'

/** 把当前设置里的能力开关应用到各管理器（全部幂等，可安全重放） */
export function applyCapabilitySettings(): void {
  const s = useSettingsStore.getState()

  const weather = getWeatherAwarenessManager()
  weather.setCapabilityEnabled(s.weatherEnabled)
  if (s.weatherEnabled) weather.start()
  else weather.stop()

  const proactive = getProactiveSpeakManager()
  proactive.setCapabilityEnabled(s.proactiveSpeakEnabled)
  if (s.proactiveSpeakEnabled) proactive.start()

  getEmotionManager().setCapabilityEnabled(s.emotionEnabled)
  getContextAwarenessManager().setCapabilityEnabled(s.contextAwarenessEnabled)
  if (s.contextAwarenessEnabled) getContextAwarenessManager().start()
}

/**
 * 应用当前值并订阅后续变更
 * @returns 取消订阅函数
 */
export function initCapabilitySettingsSync(): () => void {
  applyCapabilitySettings()
  return useSettingsStore.subscribe(() => {
    applyCapabilitySettings()
  })
}

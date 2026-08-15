/**
 * @file usePetSensors.ts
 * @description 上下文感知订阅 Hook
 *
 * 功能：
 * - 音乐感知订阅（音乐播放时摇摆）
 * - 网络状态感知（断网/恢复提醒）
 * - 天气感知订阅
 * - 工作状态感知（编码/会议/浏览）
 * - 休息/喝水提醒
 * - 日程提醒
 * - 活动系统订阅
 * - 情绪管理器集成
 * - MCP TTS 事件监听
 * - 闲置检测
 */

import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import {
  getContextAwarenessManager,
  getNotificationManager,
  SOFT_REMINDERS,
  type WorkState,
} from '../../lib/contextAwareness'
import { getMusicAwarenessManager } from '../../lib/musicAwareness'
import { getWeatherAwarenessManager, type WeatherAction } from '../../lib/weatherAwareness'
import { getScheduleManager } from '../../lib/scheduleManager'
import { getBubbleManager, MessagePriority } from '../../lib/bubbleManager'
import { getEventSystemManager } from '../../lib/eventSystem'
import { getEmotionManager } from '../../lib/emotionManager'
import { animationIdToPetState, type AnimationId } from '../../lib/animationConfig'
import type { PetState } from '../../lib/types'

export interface UsePetSensorsOptions {
  /** 显示气泡回调 */
  showBubble: (msg: string) => void
  /** 设置宠物状态 */
  setPetState: React.Dispatch<React.SetStateAction<PetState>>
  /** 设置当前动画 ID */
  setCurrentAnimId: React.Dispatch<React.SetStateAction<AnimationId>>
  /** 当前角色 ID */
  currentCharacterId: string
  /** 安全 setTimeout 包装 */
  safeTimeout: (fn: () => void, ms: number) => number
}

export interface UsePetSensorsReturn {
  /** 是否正在随音乐摇摆 */
  musicSwaying: boolean
  /** 是否网络离线 */
  networkOffline: boolean
  /** 当前天气行为 */
  weatherAction: WeatherAction
  /** 工作状态 ref */
  workStateRef: React.MutableRefObject<WorkState>
  /** 音乐摇摆 ref */
  musicSwayingRef: React.MutableRefObject<boolean>
  /** 网络状态冷却 ref（防抖） */
  networkCooldownRef: React.MutableRefObject<number>
}

export function usePetSensors(options: UsePetSensorsOptions): UsePetSensorsReturn {
  const { showBubble, setPetState, setCurrentAnimId, safeTimeout } = options

  const [musicSwaying, setMusicSwaying] = useState(false)
  const [networkOffline, setNetworkOffline] = useState(false)
  const [weatherAction, setWeatherAction] = useState<WeatherAction>('normal')

  const workStateRef = useRef<WorkState>('unknown')
  const networkCooldownRef = useRef<number>(0)
  const musicSwayingRef = useRef<boolean>(false)

  useEffect(() => {
    // 音乐感知订阅
    const musicMgr = getMusicAwarenessManager()
    const unsubMusic = musicMgr.onMusicChange((status) => {
      const playing = status.state === 'playing'
      setMusicSwaying(playing)
      musicSwayingRef.current = playing
    })

    // 天气感知订阅
    const weatherMgr = getWeatherAwarenessManager()
    weatherMgr.start()
    const unsubWeather = weatherMgr.onWeatherChange((_weather, behavior) => {
      setWeatherAction(behavior.action)
      if (behavior.bubble && behavior.action !== 'normal') {
        showBubble(behavior.bubble)
        setPetState(behavior.petState)
        safeTimeout(() => setPetState('idle'), 5000)
      }
    })

    // 情境感知启动
    const contextMgr = getContextAwarenessManager()
    contextMgr.start()
    const notifMgr = getNotificationManager()

    // 网络状态订阅
    const unsubNetwork = contextMgr.onNetworkChange((event) => {
      setNetworkOffline(!event.online)
      const now = Date.now()
      if (now < networkCooldownRef.current) return
      networkCooldownRef.current = now + 3000
      if (!event.online) {
        showBubble('网络断了...')
        setPetState('sad')
        safeTimeout(() => setPetState('idle'), 3000)
      } else {
        showBubble('网络恢复了！')
        setPetState('happy')
        safeTimeout(() => setPetState('idle'), 3000)
      }
    })

    // 工作状态感知订阅
    const unsubWorkState = contextMgr.onWorkStateChange((state) => {
      workStateRef.current = state
      switch (state) {
        case 'coding':
          setPetState('sit')
          showBubble('主人要专心写代码呢，我安静陪你～')
          break
        case 'meeting':
          setPetState('sit')
          showBubble('开会中，安静哦～🤫')
          break
        case 'browsing':
          setPetState('happy')
          showBubble('摸鱼时间～要不要玩一会儿？')
          break
        case 'idle':
          setPetState('idle')
          break
        case 'unknown':
          break
      }
    })

    // 休息/喝水提醒
    const unsubNotif = notifMgr.onNotification((notif) => {
      if (notif.petMessage) {
        showBubble(notif.petMessage)
      }
      if (notif.type === 'rest_reminder' || notif.type === 'drink_reminder') {
        setPetState('happy')
        safeTimeout(() => setPetState('idle'), 3000)
      }
    })

    const unsubContext = contextMgr.onStateChange((info) => {
      if (info.shouldRemindRest) {
        const msgs = SOFT_REMINDERS.rest_reminder.petMessages
        notifMgr.send({
          type: 'rest_reminder',
          title: '休息提醒',
          body: '已连续工作45分钟',
          petMessage: msgs[Math.floor(Math.random() * msgs.length)],
        })
      }
      if (info.shouldRemindDrink) {
        const msgs = SOFT_REMINDERS.drink_reminder.petMessages
        notifMgr.send({
          type: 'drink_reminder',
          title: '喝水提醒',
          body: '记得喝水',
          petMessage: msgs[Math.floor(Math.random() * msgs.length)],
        })
      }
    })

    // 日程管理
    const schedMgr = getScheduleManager()
    schedMgr.start()
    const unsubSched = schedMgr.onReminder((event) => {
      // R5：提醒气泡走更自然的文案，并通过 BubbleManager 统一发送
      const hour = new Date().getHours()
      const greeting = hour >= 6 && hour < 12 ? '早安' : hour >= 12 && hour < 18 ? '下午好' : hour >= 18 && hour < 22 ? '晚上好' : ''
      const message = `${greeting ? greeting + '～' : ''}到点啦～你之前说${event.title}的`
      getBubbleManager().sendMessage(message, MessagePriority.Proactive)
      setPetState('happy')
      safeTimeout(() => setPetState('idle'), 3000)
    })

    // 活动系统
    const eventMgr = getEventSystemManager()
    eventMgr.start()
    const eventStateMap: Record<string, PetState> = { excited: 'happy', happy: 'happy', cozy: 'sit' }
    const unsubEvents = eventMgr.onActiveEventsChange((events) => {
      if (events.length === 0) return
      const bubble = eventMgr.getRandomActiveBubble()
      if (bubble) {
        showBubble(bubble)
        const override = events.find((e) => e.petStateOverride)?.petStateOverride
        if (override && eventStateMap[override]) {
          setPetState(eventStateMap[override])
          safeTimeout(() => setPetState('idle'), 5000)
        }
      }
    })

    // MCP say 事件（TTS 对齐）
    let unsubMcpSayCleanup: (() => void) | null = null
    void listen<string>('spiritpal-mcp-say', (evt) => {
      if (!evt.payload) return
      const emotionMgr = getEmotionManager()
      const textLen = evt.payload.length
      const estimatedDurationMs = Math.max(1500, (textLen / 5) * 1000)
      emotionMgr.startTTSAlignment(estimatedDurationMs)
      const recentEvts = emotionMgr.getRecentEvents()
      const lastEvt = recentEvts.at(-1)
      if (lastEvt) {
        const renderState = animationIdToPetState(lastEvt.expression.animationId as AnimationId)
        setCurrentAnimId(lastEvt.expression.animationId as AnimationId)
        setPetState(renderState)
      }
    }).then((unsub) => { unsubMcpSayCleanup = unsub })

    // 情绪管理器回调
    const emotionMgr = getEmotionManager({
      onEmotionTriggered: (emotionEvent) => {
        const renderState = animationIdToPetState(emotionEvent.expression.animationId as AnimationId)
        setCurrentAnimId(emotionEvent.expression.animationId as AnimationId)
        setPetState(renderState)
      },
      onExpressionClear: () => {
        setPetState('idle')
      },
    })
    emotionMgr.start()

    // 闲置检测
    let idleCheckTimer = 0
    const checkIdle = async () => {
      try {
        const idleMs = await invoke<number>('get_idle_time')
        const idleMin = idleMs / 60000
        if (idleMin >= 5) {
          setPetState('sleep')
        }
      } catch {}
    }
    idleCheckTimer = window.setInterval(checkIdle, 30000)

    return () => {
      unsubMusic()
      unsubWeather()
      weatherMgr.stop()
      unsubNetwork()
      unsubWorkState()
      unsubNotif()
      unsubContext()
      contextMgr.stop()
      unsubSched()
      schedMgr.stop()
      unsubEvents()
      eventMgr.stop()
      unsubMcpSayCleanup?.()
      getEmotionManager().stop()
      clearInterval(idleCheckTimer)
    }
  }, [showBubble, setPetState, setCurrentAnimId, safeTimeout])

  return {
    musicSwaying,
    networkOffline,
    weatherAction,
    workStateRef,
    musicSwayingRef,
    networkCooldownRef,
  }
}

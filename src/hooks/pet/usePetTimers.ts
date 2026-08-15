/**
 * @file usePetTimers.ts
 * @description 初始化与周期定时器 Hook
 *
 * 功能：
 * - 挂载时初始化（离线衰减、行为调度、对话配置、自动更新）
 * - 周期性定时器（tick、闲置气泡、交互计数、饥饿检查）
 * - 气泡管理器回调设置、聊天阶段监听
 * - 成就登录记录
 * - 角色切换时重置状态（bubble cooldowns、动画状态机）
 */

import { useEffect, useRef } from 'react'
import { usePetStore } from '../../stores/petStore'
import { getDialogueManager } from '../../lib/dialogueManager'
import { WELCOME_DIALOGUE } from '../../lib/dialogueConfig'
import { initAutoUpdateChecker } from '../../lib/updater'
import { getBubbleManager, MessagePriority } from '../../lib/bubbleManager'
import { getChatStageManager } from '../../lib/chatStages'
import { getAchievementManager } from '../../lib/achievementSystem'
import { InteractionCounter } from '../../lib/interactionCounter'
import { getAnimationStateMachine } from '../../lib/animationConfig'
import { getCharacter } from '../../lib/characters'
import { getEmotionManager } from '../../lib/emotionManager'
// P1-2：接线 proactiveSpeak
import { getProactiveSpeakManager } from '../../lib/proactiveSpeak'
// P1-3：接线记忆维护闭环
import { getEnhancedMemoryManager } from '../../lib/enhancedMemory'
// P1-1：接线日记系统定时生成
import { getDiarySystemManager } from '../../lib/diarySystem'
// R1：上下文快照管理器
import { getContextEpisodeManager } from '../../lib/contextEpisodeManager'
// R1：情境感知管理器（用于状态变迁订阅）
import { getContextAwarenessManager } from '../../lib/contextAwareness'
import type { PetState } from '../../lib/types'
import type { AnimationId } from '../../lib/animationConfig'

export interface UsePetTimersOptions {
  /** 当前角色 ID */
  currentCharacterId: string
  /** 调度下一个行为 */
  scheduleNextBehavior: () => void
  /** 显示气泡回调 */
  showBubble: (msg: string) => void
  /** 选择随机气泡 */
  pickBubble: (cat: string) => string
  /** 设置宠物状态 */
  setPetState: React.Dispatch<React.SetStateAction<PetState>>
  /** 设置当前动画 ID */
  setCurrentAnimId: React.Dispatch<React.SetStateAction<AnimationId>>
  /** 安全 setTimeout 包装 */
  safeTimeout: (fn: () => void, ms: number) => number
  /** 宠物状态 ref（用于在 setTimeout 回调中读取最新状态） */
  petStateRef?: React.MutableRefObject<PetState>
}

export interface UsePetTimersReturn {
  /** 交互计数器（供 mousemove 使用） */
  interactionCounterRef: React.MutableRefObject<InteractionCounter>
}

export function usePetTimers(options: UsePetTimersOptions): UsePetTimersReturn {
  const {
    currentCharacterId,
    scheduleNextBehavior,
    showBubble,
    pickBubble,
    setPetState,
    petStateRef,
  } = options

  const applyOfflineDecay = usePetStore((s) => s.applyOfflineDecay)
  const tick = usePetStore((s) => s.tick)
  const bubbleMgr = getBubbleManager(currentCharacterId)
  const interactionCounterRef = useRef(new InteractionCounter())
  const draggingRef = useRef(false)
  const menuRef = useRef<{ x: number; y: number } | null>(null)

  // 挂载时初始化
  useEffect(() => {
    applyOfflineDecay()
    scheduleNextBehavior()

    const dialogueMgr = getDialogueManager()
    dialogueMgr.loadFromConfig(WELCOME_DIALOGUE)

    initAutoUpdateChecker(30000)

    const tickTimerRef = window.setInterval(() => tick(), 60 * 60 * 1000)

    let idleBubbleTimerId = 0
    const scheduleIdleBubble = () => {
      const d = 20000 + Math.random() * 20000
      idleBubbleTimerId = window.setTimeout(() => {
        if (!draggingRef.current && !menuRef.current) {
          const currentState = petStateRef?.current ?? 'idle'
          if (currentState === 'idle') showBubble(pickBubble('idle'))
        }
        scheduleIdleBubble()
      }, d)
    }
    scheduleIdleBubble()

    const interactionTickRef = window.setInterval(() => {
      interactionCounterRef.current.tick(100)
    }, 100)

    const hungerBubbleCheckRef = window.setInterval(() => {
      const cur = usePetStore.getState().getCurrentStats()
      bubbleMgr.checkHungerBubbles(cur)
    }, 60000)

    bubbleMgr.setOnBubble((msg) => showBubble(msg))

    const chatStageMgr = getChatStageManager()
    const unsubChatStage = chatStageMgr.onStageChange((_stage, animation, bubbleText) => {
      if (animation !== 'idle') {
        setPetState(animation)
        if (bubbleText) showBubble(bubbleText)
      } else {
        setPetState('idle')
      }
    })

    getAchievementManager().recordLogin()

    // 情绪 tick（每秒）
    const emotionTickInterval = window.setInterval(() => {
      getEmotionManager().tick()
    }, 1000)

    // P1-2：接线 proactiveSpeak——宠物主动开口
    // 阶段3：统一走 BubbleManager 发送（收编全局纪律）
    const proactiveMgr = getProactiveSpeakManager()
    const unsubProactive = proactiveMgr.onProactiveSpeak((message) => {
      getBubbleManager().sendMessage(message, MessagePriority.Proactive)
    })

    // R1：订阅工作状态变迁，记录上下文快照
    const episodeMgr = getContextEpisodeManager(currentCharacterId)
    const ctxAwareness = getContextAwarenessManager()
    const unsubWorkState = ctxAwareness.onWorkStateChange((newState) => {
      void episodeMgr.recordStateChange(
        newState,
        ctxAwareness.getCachedWeather()?.condition,
        ctxAwareness.getLastIdleMinutes(),
      ).catch(() => {})
    })

    // P1-3 + P3-2：接线记忆维护闭环——LLM 驱动巩固
    // 维护间隔：每 6 小时检查一次（巩固内部有 1 小时间隔控制，遗忘/晋升可更频繁）
    const memoryMaintenanceInterval = window.setInterval(() => {
      const memMgr = getEnhancedMemoryManager(currentCharacterId)
      void memMgr.ensureLoaded().then(async () => {
        try {
          // P3-2：传入 LLM 摘要函数，实现真正的 episodic→semantic 巩固
          const { getLLMClient } = await import('../../lib/llmClient')
          const llmSummarizer = async (memories: Array<{ user: string; assistant: string }>) => {
            try {
              const client = getLLMClient()
              const conversation = memories
                .map(m => `User: ${m.user}\nAI: ${m.assistant}`)
                .join('\n---\n')
              const response = await client.chatOnce([
                { id: 'consolidate-sys', role: 'system', content: '你是一个记忆整理助手。请将以下对话总结为一条简洁的语义知识（50字以内），提炼出最重要的信息。只输出总结内容，不要加多余说明。', timestamp: Date.now() },
                { id: 'consolidate-user', role: 'user', content: conversation, timestamp: Date.now() },
              ])
              return response.trim()
            } catch {
              return ''
            }
          }
          await memMgr.maintainMemories(llmSummarizer)
          // P3-1：维护后重建 RAG 索引
          memMgr.buildRAGIndex?.()
        } catch {
          // 维护失败不影响正常使用
        }
      })
    }, 6 * 60 * 60 * 1000) // 6 小时

    // P1-1：接线日记系统——每天 23:30 自动生成当日日记
    const diaryCheckInterval = window.setInterval(() => {
      const now = new Date()
      // 23:30~23:59 之间触发（如果当天还没生成）
      if (now.getHours() === 23 && now.getMinutes() >= 30) {
        const diaryMgr = getDiarySystemManager(currentCharacterId)
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        // 如果今天还没有日记，且对话轮数达标，则生成
        if (!diaryMgr.getDiary(today) && diaryMgr.getTodayExchangeCount() >= 3) {
          void diaryMgr.generateDiary().catch(() => {})
        }
      }
    }, 60 * 1000) // 每分钟检查一次

    // W5：每晚巩固窗口（睡眠巩固）——2:00~4:00 之间执行一次深度维护
    let lastNightlyConsolidationDate = ''
    const nightlyConsolidationInterval = window.setInterval(() => {
      const now = new Date()
      const hour = now.getHours()
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      // 2:00~4:00 之间且今天还没执行过
      if (hour >= 2 && hour < 4 && lastNightlyConsolidationDate !== today) {
        lastNightlyConsolidationDate = today
        const memMgr = getEnhancedMemoryManager(currentCharacterId)
        void memMgr.ensureLoaded().then(async () => {
          try {
            const { getLLMClient } = await import('../../lib/llmClient')
            // LLM 摘要函数
            const llmSummarizer = async (memories: Array<{ user: string; assistant: string }>) => {
              try {
                const client = getLLMClient()
                const conversation = memories
                  .map(m => `User: ${m.user}\nAI: ${m.assistant}`)
                  .join('\n---\n')
                const response = await client.chatOnce([
                  { id: 'nightly-sys', role: 'system', content: '你是一个记忆整理助手。请将以下对话总结为一条简洁的语义知识（50字以内），提炼出最重要的信息。只输出总结内容，不要加多余说明。', timestamp: Date.now() },
                  { id: 'nightly-user', role: 'user', content: conversation, timestamp: Date.now() },
                ])
                return response.trim()
              } catch {
                return ''
              }
            }
            // LLM 评级函数（W2）
            const llmRater = async (memories: Array<{ id: string; user: string; assistant: string; importance: number }>) => {
              try {
                const client = getLLMClient()
                const items = memories.map((m, i) => `${i + 1}. [id=${m.id}] ${m.user.slice(0, 100)}`).join('\n')
                const response = await client.chatOnce([
                  { id: 'rater-sys', role: 'system', content: '你是记忆重要性评级助手。对以下每条记忆给出0-100的重要性分数。输出JSON数组格式：[{"id":"...","importance":N}]。只输出JSON，不要加说明。', timestamp: Date.now() },
                  { id: 'rater-user', role: 'user', content: items, timestamp: Date.now() },
                ])
                return JSON.parse(response.replace(/```json|```/g, '').trim())
              } catch {
                return []
              }
            }
            await memMgr.runNightlyConsolidation(llmSummarizer, llmRater)

            // R1：LLM 浓缩当日上下文片段为观察记忆
            try {
              const observation = await episodeMgr.condenseToObservation(async (episodesText) => {
                const client = getLLMClient()
                const response = await client.chatOnce([
                  { id: 'obs-sys', role: 'system', content: '你是宠物视角的观察助手。根据以下主人的今日活动片段，用宠物的口吻写1-2句观察记忆（如"主人昨晚在写代码到很晚，中间开了40分钟会"）。只输出观察内容，不要加说明。', timestamp: Date.now() },
                  { id: 'obs-user', role: 'user', content: episodesText, timestamp: Date.now() },
                ])
                return response.trim()
              })
              if (observation) {
                // 将观察记忆写入增强记忆系统
                const obsMem = memMgr.addExchange(observation, '')
                obsMem.sourceKind = 'observation'
              }
            } catch {
              // 观察记忆浓缩失败不影响正常使用
            }
          } catch {
            // 巩固失败不影响正常使用
          }
        })
      }
    }, 10 * 60 * 1000) // 每 10 分钟检查一次

    return () => {
      clearTimeout(idleBubbleTimerId)
      clearInterval(tickTimerRef)
      clearInterval(interactionTickRef)
      clearInterval(hungerBubbleCheckRef)
      clearInterval(emotionTickInterval)
      clearInterval(memoryMaintenanceInterval)
      clearInterval(diaryCheckInterval)
      clearInterval(nightlyConsolidationInterval)
      unsubProactive()
      unsubChatStage()
      unsubWorkState()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 角色切换时更新 bubble manager 和重置动画状态机
  useEffect(() => {
    const char = getCharacter(currentCharacterId)
    if (char) {
      bubbleMgr.setCharacter(char)
    }
    bubbleMgr.resetCooldowns()
    getAnimationStateMachine().resetCooldowns()
  }, [currentCharacterId, bubbleMgr])

  return { interactionCounterRef }
}

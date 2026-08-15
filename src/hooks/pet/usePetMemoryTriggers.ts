/**
 * @file usePetMemoryTriggers.ts
 * @description 记忆触发 Hook — 纪念日/节日/生日主动对话
 *
 * 功能：
 * - 每分钟检查周期触发（生日、纪念日、节日）
 * - 响应窗口管理（5分钟内用户回复则记录为响应）
 * - 监听用户聊天响应事件
 */

import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getEnhancedMemoryManager } from '../../lib/enhancedMemory'
import { getRecallEngine, buildRecallRenderPrompt } from '../../lib/recallEngine'
import { stringSimilarity } from '../../lib/stringSimilarity'
import type { RecallCandidate } from '../../lib/recallEngine'
import type { PetState } from '../../lib/types'
import type { AnimationId } from '../../lib/animationConfig'

export interface UsePetMemoryTriggersOptions {
  /** 当前角色 ID */
  currentCharacterId: string
  /** 显示气泡回调 */
  showBubble: (msg: string) => void
  /** 设置宠物状态 */
  setPetState: React.Dispatch<React.SetStateAction<PetState>>
  /** 设置当前动画 ID */
  setCurrentAnimId: React.Dispatch<React.SetStateAction<AnimationId>>
  /** 安全 setTimeout 包装 */
  safeTimeout: (fn: () => void, ms: number) => number
}

export function usePetMemoryTriggers(options: UsePetMemoryTriggersOptions): void {
  const { currentCharacterId, showBubble, setPetState, safeTimeout } = options

  useEffect(() => {
    const PERIODIC_CHECK_INTERVAL = 60 * 1000
    const RESPONSE_WINDOW_MS = 5 * 60 * 1000

    const pendingTriggerRef = { current: null as { type: string; timestamp: number; message: string } | null }
    let responseTimeoutId = 0

    const periodicTimer = window.setInterval(() => {
      const mgr = getEnhancedMemoryManager(currentCharacterId)
      void mgr.ensureLoaded().then(async () => {
        // 阶段3：使用 RecallEngine 统一管线替代直接 checkTriggers
        const engine = getRecallEngine(currentCharacterId)
        // LLM 渲染函数
        const llmRenderer = async (candidate: RecallCandidate, contextHints: string) => {
          try {
            const { getLLMClient } = await import('../../lib/llmClient')
            const client = getLLMClient()
            const prompt = buildRecallRenderPrompt(candidate, contextHints)
            const response = await client.chatOnce([
              { id: 'recall-sys', role: 'system', content: '你是SpiritPal桌面宠物，正在自然地提起一段回忆。用一两句话表达，保持角色性格。只输出你要说的话，不要加说明。', timestamp: Date.now() },
              { id: 'recall-user', role: 'user', content: prompt, timestamp: Date.now() },
            ])
            return response.trim()
          } catch {
            return ''
          }
        }
        const message = await engine.recall(undefined, llmRenderer)
        if (message) {
          showBubble(message)
          setPetState('happy')
          safeTimeout(() => setPetState('idle'), 3500)
          pendingTriggerRef.current = { type: 'recall', timestamp: Date.now(), message }
          if (responseTimeoutId) clearTimeout(responseTimeoutId)
          responseTimeoutId = safeTimeout(() => {
            if (pendingTriggerRef.current) {
              mgr.recordUserResponse(pendingTriggerRef.current.type, false)
              pendingTriggerRef.current = null
            }
          }, RESPONSE_WINDOW_MS)
        }
      })
    }, PERIODIC_CHECK_INTERVAL)

    // 阶段3：语义化响应判定——用户消息与触发素材的相似度 >0.4 才算有效响应
    const unsubResponsePromise = listen<{ characterId: string; text?: string }>('user-chat-responded', (event) => {
      if (pendingTriggerRef.current) {
        const userText = event.payload?.text ?? ''
        const triggerMsg = pendingTriggerRef.current.message
        // 语义判定：用户消息与触发内容相似度 >0.4 才算有效响应
        let isValidResponse = true
        if (userText && triggerMsg) {
          // 简单字符串相似度判定（避免每条消息都做 embed 的开销）
          const sim = stringSimilarity(userText.toLowerCase(), triggerMsg.toLowerCase().slice(0, 200))
          // T-10: 阈值 0.4 区分"接住话题"与"聊别的"；但用户发较长消息也算有效互动
          isValidResponse = sim > 0.4 || userText.length > 15
        }
        const mgr = getEnhancedMemoryManager(currentCharacterId)
        mgr.recordUserResponse(pendingTriggerRef.current.type, isValidResponse)
        pendingTriggerRef.current = null
        if (responseTimeoutId) {
          clearTimeout(responseTimeoutId)
          responseTimeoutId = 0
        }
      }
    })

    return () => {
      clearInterval(periodicTimer)
      if (responseTimeoutId) clearTimeout(responseTimeoutId)
      void unsubResponsePromise.then((fn) => fn())
    }
  }, [currentCharacterId, showBubble, setPetState, safeTimeout])
}

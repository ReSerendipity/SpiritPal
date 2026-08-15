/**
 * 聊天阶段编排 — 4 阶段状态机管理聊天时的宠物动画和气泡
 *
 * @fileoverview
 * 主要模块：
 * - ChatStage 类型：5 种聊天阶段（idle/input/waiting/reply/error）
 * - STAGE_ANIMATION：阶段→宠物动画映射
 * - STAGE_BUBBLE：阶段→气泡消息映射
 * - ChatStageManager 类：阶段管理器，支持跨窗口通信（localStorage 事件）
 *
 * 4 个阶段：
 * | 阶段 | 绑定动画 | 触发条件 | 下一步 |
 * |---|---|---|---|
 * | input   | sit（坐下来听）  | 用户打开聊天对话框 | 用户输入 + 提交 |
 * | waiting | eat（吃东西等待） | 提交聊天请求 | LLM 回复或错误 |
 * | reply   | happy（开心说话） | LLM 回复成功 | 气泡自动隐藏后恢复 |
 * | error   | sad（难过）      | LLM 回复失败 | 自动恢复 |
 *
 * 关键机制：
 * - chat_restore_action: 阶段开始时快照当前动画，阶段结束后恢复
 * - bubble_auto_hide_ms (默认 8000ms) 后恢复原动画
 * - chat_request_inflight: 防止重叠请求
 *
 * @module chatStages
 * @requires ./types - PetState 类型定义
 */

import type { PetState } from './types'

// ============ 聊天阶段类型 ============
export type ChatStage = 'idle' | 'input' | 'waiting' | 'reply' | 'error'

// ============ 阶段 → 宠物动画映射 ============
export const STAGE_ANIMATION: Record<ChatStage, PetState> = {
  idle: 'idle',
  input: 'sit',      // 用户打开聊天 → 宠物坐下来听
  waiting: 'eat',    // 等待 LLM 回复 → 宠物吃东西
  reply: 'happy',    // LLM 回复成功 → 宠物开心
  error: 'sad',      // LLM 回复失败 → 宠物难过
}

// ============ 阶段气泡消息 ============
export const STAGE_BUBBLE: Record<ChatStage, string> = {
  idle: '',
  input: '在听呢～你说吧！',
  waiting: '让我想想……',
  reply: '嗯嗯！我知道啦～',
  error: '呜……出了点问题',
}

// 气泡自动隐藏时间（毫秒）
const BUBBLE_AUTO_HIDE_MS = 8000

// ============ 跨窗口通信（localStorage 事件） ============
// 由于宠物窗口和聊天窗口是独立的 Tauri 窗口，
// 使用 localStorage + storage 事件实现跨窗口通信
const STORAGE_KEY = 'spiritpal-chat-stage'

interface ChatStageData {
  stage: ChatStage
  timestamp: number
}

// ============ 聊天阶段管理器 ============
export class ChatStageManager {
  private currentStage: ChatStage = 'idle'
  private restoreTimer: number | null = null
  private listeners: Set<(stage: ChatStage, animation: PetState, bubble: string) => void> = new Set()

  constructor() {
    // 监听跨窗口 storage 事件
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const data = JSON.parse(e.newValue) as ChatStageData
          this.handleStageChange(data.stage)
        } catch {
          // 忽略解析错误
        }
      }
    })

    // 也监听同窗口的自定义事件（同窗口 storage 事件不触发）
    window.addEventListener('spiritpal-chat-stage-change', ((e: CustomEvent) => {
      this.handleStageChange(e.detail as ChatStage)
    }) as EventListener)
  }

  // 设置当前阶段（从聊天窗口调用）
  setStage(stage: ChatStage): void {
    this.currentStage = stage
    // 写入 localStorage 触发其他窗口的 storage 事件
    const data: ChatStageData = { stage, timestamp: Date.now() }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // 忽略存储错误
    }
    // 同窗口直接触发
    window.dispatchEvent(new CustomEvent('spiritpal-chat-stage-change', { detail: stage }))
  }

  // 处理阶段变化（在宠物窗口中执行）
  private handleStageChange(stage: ChatStage): void {
    this.currentStage = stage
    const animation = STAGE_ANIMATION[stage]
    const bubble = STAGE_BUBBLE[stage]

    // 取消之前的恢复定时器
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer)
      this.restoreTimer = null
    }

    // 通知监听器
    this.listeners.forEach((fn) => fn(stage, animation, bubble))

    // reply 和 error 阶段在气泡自动隐藏后恢复 idle
    if (stage === 'reply' || stage === 'error') {
      this.restoreTimer = window.setTimeout(() => {
        this.setStage('idle')
      }, BUBBLE_AUTO_HIDE_MS)
    }
  }

  // 获取当前阶段
  getStage(): ChatStage {
    return this.currentStage
  }

  // 添加阶段变化监听器（宠物窗口注册）
  onStageChange(fn: (stage: ChatStage, animation: PetState, bubble: string) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  // 恢复到 idle 阶段
  restore(): void {
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer)
      this.restoreTimer = null
    }
    this.setStage('idle')
  }
}

// ============ 单例 ============
let sharedManager: ChatStageManager | null = null

export function getChatStageManager(): ChatStageManager {
  if (!sharedManager) {
    sharedManager = new ChatStageManager()
  }
  return sharedManager
}

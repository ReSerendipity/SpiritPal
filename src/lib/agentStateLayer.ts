/**
 * 代理状态层 — 检测 AI 代理活跃状态，自动切换编码反应动画
 * 参考 OpenPets 设计
 *
 * @fileoverview
 * 主要模块：
 * - AgentState 类型：4 种代理状态（idle/thinking/executing/waiting_input）
 * - AgentStateContext 接口：状态上下文（进入时间、当前工具等）
 * - ToolResult 类型：工具执行结果（success/error/unknown）
 * - AgentStateLayer 类：代理状态层（继承 EventEmitter，单例模式）
 * - getAgentStateLayer()：获取单例入口
 * - resetAgentStateLayer()：重置单例
 *
 * 功能：
 * - 检测 AI 代理是否正在活跃处理
 * - 代理活跃时自动切换到编码反应动画行（coding_reaction_rows）
 * - 与 animationConfig.ts 集成，实现状态驱动的动画选择
 * - 空闲超时自动回到 idle 状态
 *
 * @module agentStateLayer
 * @requires events - Node.js 事件发射器
 * @requires ./animationConfig - 动画目录定义
 * @requires ./codingReactionRows - 编码反应管理器
 */

import { EventEmitter } from 'events'
import { ANIMATION_CATALOG, type AnimationId } from './animationConfig'
import { getCodingReactionManager, type CodingReaction } from './codingReactionRows'

// ============ 代理状态定义 ============

/** AI 代理工作状态 */
export type AgentState = 'idle' | 'thinking' | 'executing' | 'waiting_input'

/** 代理状态上下文 */
export interface AgentStateContext {
  /** 当前代理状态 */
  state: AgentState
  /** 状态进入时间戳 */
  enteredAt: number
  /** 当前执行的工具名（executing 状态时有值） */
  currentTool?: string
  /** 代理标识（多代理时区分来源） */
  agentId?: string
  /** 附加信息 */
  detail?: string
}

/** 代理状态事件 */
export interface AgentStateEvents {
  /** 代理状态变化 */
  'agent-state-change': (ctx: AgentStateContext) => void
  /** 代理开始处理 */
  'agent-started': (ctx: AgentStateContext) => void
  /** 代理停止处理 */
  'agent-stopped': (ctx: AgentStateContext) => void
  /** 编码反应映射变化 */
  'coding-reaction-mapped': (reaction: CodingReaction) => void
}

// ============ 代理状态 → 编码反应映射 ============

/** 代理状态映射到编码反应 */
const AGENT_STATE_TO_CODING_REACTION: Record<AgentState, CodingReaction | null> = {
  idle: null,           // 空闲时不触发编码反应
  thinking: 'thinking', // 思考中
  executing: 'editing', // 执行中（映射为编辑）
  waiting_input: 'testing', // 等待输入（映射为测试等待）
}

/** 代理状态映射到动画 ID */
const AGENT_STATE_TO_ANIMATION: Record<AgentState, AnimationId> = {
  idle: 'idle',
  thinking: 'thinking',
  executing: 'editing',
  waiting_input: 'testing',
}

/** 工具执行结果 → 编码反应映射 */
export type ToolResult = 'success' | 'error' | 'unknown'

const TOOL_RESULT_TO_CODING_REACTION: Record<ToolResult, CodingReaction> = {
  success: 'success',
  error: 'error',
  unknown: 'editing',
}

// ============ 代理状态层 ============

export class AgentStateLayer extends EventEmitter {
  /** 当前代理状态上下文 */
  private context: AgentStateContext = {
    state: 'idle',
    enteredAt: Date.now(),
  }

  /** 代理空闲超时（毫秒，超过此时间自动回到 idle） */
  private idleTimeoutMs: number

  /** 空闲超时定时器 */
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  /** 是否在代理活跃时覆盖动画选择 */
  private overrideAnimation: boolean

  /** 历史状态记录（用于调试和统计分析） */
  private stateHistory: Array<{ state: AgentState; timestamp: number }> = []

  /** 最大历史记录条数 */
  private maxHistorySize = 100

  constructor(options?: { idleTimeoutMs?: number; overrideAnimation?: boolean }) {
    super()
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 120_000 // 默认 2 分钟无操作回到 idle
    this.overrideAnimation = options?.overrideAnimation ?? true
  }

  // ============ 状态切换 ============

  /**
   * 更新代理状态
   * @param state 新状态
   * @param detail 附加信息
   * @param agentId 代理标识
   */
  setState(state: AgentState, detail?: string, agentId?: string): void {
    const prevState = this.context.state

    // 状态未变化时忽略
    if (prevState === state && !detail) return

    // 更新上下文
    this.context = {
      state,
      enteredAt: Date.now(),
      currentTool: state === 'executing' ? this.context.currentTool : undefined,
      agentId: agentId ?? this.context.agentId,
      detail,
    }

    // 记录历史
    this.stateHistory.push({ state, timestamp: Date.now() })
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift()
    }

    // 清除旧的空闲定时器
    this.clearIdleTimer()

    // 设置新的空闲定时器（非 idle 状态时）
    if (state !== 'idle') {
      this.setIdleTimer()
    }

    // 触发事件
    this.emit('agent-state-change', this.context)

    if (prevState === 'idle' && state !== 'idle') {
      this.emit('agent-started', this.context)
    }
    if (state === 'idle' && prevState !== 'idle') {
      this.emit('agent-stopped', this.context)
    }

    // 映射到编码反应
    this.mapToCodingReaction(state)
  }

  /**
   * 设置代理正在执行的工具
   * @param toolName 工具名称
   */
  setExecutingTool(toolName: string): void {
    if (this.context.state === 'idle') {
      this.setState('executing', `执行工具: ${toolName}`)
    }
    this.context.currentTool = toolName
  }

  /**
   * 通知工具执行完成
   * @param result 执行结果
   */
  notifyToolResult(result: ToolResult): void {
    const reaction = TOOL_RESULT_TO_CODING_REACTION[result]

    // 触发编码反应
    const codingMgr = getCodingReactionManager()
    codingMgr.triggerReaction(reaction, undefined, 3000) // 3 秒后自动清除

    this.emit('coding-reaction-mapped', reaction)

    // 成功/错误后延迟回到 idle
    setTimeout(() => {
      if (this.context.state === 'executing') {
        this.setState('idle', `工具执行完成: ${result}`)
      }
    }, 3500)
  }

  // ============ 动画选择集成 ============

  /**
   * 获取当前代理状态对应的动画 ID
   * 当代理活跃时，覆盖默认的动画选择
   */
  getPreferredAnimation(): AnimationId | null {
    if (!this.overrideAnimation) return null
    if (this.context.state === 'idle') return null

    const animId = AGENT_STATE_TO_ANIMATION[this.context.state]

    // 验证动画 ID 是否在目录中
    const exists = ANIMATION_CATALOG.some((a) => a.id === animId)
    return exists ? animId : null
  }

  /**
   * 判断代理是否正在活跃处理
   */
  isActive(): boolean {
    return this.context.state !== 'idle'
  }

  /**
   * 获取当前状态
   */
  getState(): AgentState {
    return this.context.state
  }

  /**
   * 获取当前上下文
   */
  getContext(): AgentStateContext {
    return { ...this.context }
  }

  /**
   * 获取状态历史
   */
  getHistory(): Array<{ state: AgentState; timestamp: number }> {
    return [...this.stateHistory]
  }

  /**
   * 获取代理活跃时长（毫秒）
   */
  getActiveDuration(): number {
    if (this.context.state === 'idle') return 0
    return Date.now() - this.context.enteredAt
  }

  /**
   * 获取代理状态统计
   */
  getStats(): { totalTransitions: number; currentState: AgentState; activeDuration: number } {
    return {
      totalTransitions: this.stateHistory.length,
      currentState: this.context.state,
      activeDuration: this.getActiveDuration(),
    }
  }

  // ============ 内部方法 ============

  /** 映射代理状态到编码反应 */
  private mapToCodingReaction(state: AgentState): void {
    const reaction = AGENT_STATE_TO_CODING_REACTION[state]
    const codingMgr = getCodingReactionManager()

    if (reaction) {
      codingMgr.triggerReaction(reaction, this.context.detail)
      this.emit('coding-reaction-mapped', reaction)
    } else {
      // idle 状态时清除编码反应
      codingMgr.clearReaction()
    }
  }

  /** 设置空闲超时定时器 */
  private setIdleTimer(): void {
    this.idleTimer = setTimeout(() => {
      if (this.context.state !== 'idle') {
        this.setState('idle', '代理空闲超时，自动回到 idle')
      }
    }, this.idleTimeoutMs)
  }

  /** 清除空闲定时器 */
  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  /** 销毁状态层 */
  destroy(): void {
    this.clearIdleTimer()
    this.stateHistory = []
    this.removeAllListeners()
  }
}

// ============ 单例 ============

let agentStateLayer: AgentStateLayer | null = null

/** 获取代理状态层单例 */
export function getAgentStateLayer(): AgentStateLayer {
  if (!agentStateLayer) {
    agentStateLayer = new AgentStateLayer()
  }
  return agentStateLayer
}

/** 重置代理状态层 */
export function resetAgentStateLayer(): void {
  if (agentStateLayer) {
    agentStateLayer.destroy()
    agentStateLayer = null
  }
}

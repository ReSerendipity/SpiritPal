/**
 * MCP 工具生命周期钩子模块
 *
 * @fileoverview 实现 MCP 工具执行前后的宠物自动反应与状态管理，参考 OpenPets
 *
 * 主要模块：
 * - HookPhase/ToolExecutionContext: Hook 阶段与执行上下文类型
 * - McpHookManager: Hook 管理器主类
 * - 默认反应映射: 工具类型→宠物动画映射表
 *
 * 依赖关系：
 * - events: EventEmitter 事件机制
 * - animationConfig.ts: 动画定义与目录
 * - codingReactionRows.ts: 编程场景反应管理
 * - agentStateLayer.ts: 代理状态层
 *
 * 核心接口：
 * - registerPreHook(): 注册工具执行前钩子
 * - registerPostHook(): 注册工具执行后钩子
 * - executePreHooks(): 执行所有 pre 钩子（可阻止执行）
 * - executePostHooks(): 执行所有 post 钩子
 *
 * 功能特性：
 * - PreToolUse: 工具执行前触发反应，支持参数修改/执行拦截
 * - PostToolUse: 工具执行后触发成功/失败反应
 * - 可配置的反应映射（工具类型→宠物动画）
 * - 执行错误时的特殊反应动画
 */

import { EventEmitter } from 'events'
import { type AnimationId, ANIMATION_CATALOG } from './animationConfig'
import { getCodingReactionManager, type CodingReaction } from './codingReactionRows'
import { getAgentStateLayer, type AgentState } from './agentStateLayer'

// ============ Hook 类型定义 ============

/** Hook 生命周期阶段 */
export type HookPhase = 'pre' | 'post'

/** 工具执行上下文 */
export interface ToolExecutionContext {
  /** 工具名称 */
  toolName: string
  /** 工具输入参数 */
  args: Record<string, unknown>
  /** 来源代理 ID */
  agentId?: string
  /** 时间戳 */
  timestamp: number
}

/** 工具执行结果上下文 */
export interface ToolExecutionResultContext extends ToolExecutionContext {
  /** 是否成功 */
  success: boolean
  /** 执行结果/错误消息 */
  result?: string
  /** 执行耗时（毫秒） */
  duration: number
}

/** Hook 处理结果 */
export interface HookResult {
  /** 是否允许继续执行（pre hook 可阻止执行） */
  proceed: boolean
  /** 替换的参数（pre hook 可修改参数） */
  modifiedArgs?: Record<string, unknown>
  /** 错误消息（proceed=false 时） */
  error?: string
  /** 触发的宠物反应 */
  reaction?: CodingReaction
  /** 触发的动画 ID */
  animationId?: AnimationId
}

/** 反应映射规则 */
export interface ReactionMapping {
  /** 匹配的工具名模式（支持 * 通配符） */
  toolPattern: string
  /** Pre 阶段反应 */
  preReaction?: CodingReaction
  /** Post 阶段反应（成功） */
  postSuccessReaction?: CodingReaction
  /** Post 阶段反应（失败） */
  postErrorReaction?: CodingReaction
  /** Pre 阶段代理状态 */
  preAgentState?: AgentState
  /** Post 阶段代理状态 */
  postAgentState?: AgentState
}

/** Hook 事件 */
export interface McpHookEvents {
  /** Pre hook 触发 */
  'pre-hook': (ctx: ToolExecutionContext, result: HookResult) => void
  /** Post hook 触发 */
  'post-hook': (ctx: ToolExecutionResultContext, result: HookResult) => void
  /** 反应被触发 */
  'reaction-triggered': (reaction: CodingReaction, phase: HookPhase) => void
}

// ============ 默认反应映射 ============

/** 默认的反应映射规则 */
const DEFAULT_REACTION_MAPPINGS: ReactionMapping[] = [
  // 文件操作类
  {
    toolPattern: 'read_file*',
    preReaction: 'thinking',
    postSuccessReaction: 'editing',
    postErrorReaction: 'error',
    preAgentState: 'thinking',
    postAgentState: 'executing',
  },
  {
    toolPattern: 'write_file*',
    preReaction: 'editing',
    postSuccessReaction: 'success',
    postErrorReaction: 'error',
    preAgentState: 'executing',
    postAgentState: 'thinking',
  },
  {
    toolPattern: 'edit_file*',
    preReaction: 'editing',
    postSuccessReaction: 'success',
    postErrorReaction: 'error',
    preAgentState: 'executing',
    postAgentState: 'thinking',
  },
  // 搜索类
  {
    toolPattern: 'search*',
    preReaction: 'thinking',
    postSuccessReaction: 'success',
    postErrorReaction: 'error',
    preAgentState: 'thinking',
    postAgentState: 'idle',
  },
  {
    toolPattern: '*grep*',
    preReaction: 'thinking',
    postSuccessReaction: 'editing',
    postErrorReaction: 'error',
    preAgentState: 'thinking',
    postAgentState: 'executing',
  },
  // 终端/命令类
  {
    toolPattern: 'run_command*',
    preReaction: 'testing',
    postSuccessReaction: 'success',
    postErrorReaction: 'error',
    preAgentState: 'executing',
    postAgentState: 'thinking',
  },
  {
    toolPattern: '*terminal*',
    preReaction: 'testing',
    postSuccessReaction: 'success',
    postErrorReaction: 'error',
    preAgentState: 'executing',
    postAgentState: 'thinking',
  },
  // 测试类
  {
    toolPattern: '*test*',
    preReaction: 'testing',
    postSuccessReaction: 'celebrating',
    postErrorReaction: 'error',
    preAgentState: 'executing',
    postAgentState: 'thinking',
  },
  // SpiritPal 专用工具
  {
    toolPattern: 'spiritpal_*',
    preReaction: 'thinking',
    postSuccessReaction: 'success',
    postErrorReaction: 'error',
    preAgentState: 'thinking',
    postAgentState: 'idle',
  },
  // 通用兜底
  {
    toolPattern: '*',
    preReaction: 'thinking',
    postSuccessReaction: 'editing',
    postErrorReaction: 'error',
    preAgentState: 'thinking',
    postAgentState: 'executing',
  },
]

// ============ Hooks 管理器 ============

export class McpHooksManager extends EventEmitter {
  /** 反应映射规则 */
  private mappings: ReactionMapping[] = [...DEFAULT_REACTION_MAPPINGS]

  /** 是否启用 Hooks */
  private enabled: boolean = true

  /** 是否启用代理状态联动 */
  private linkAgentState: boolean = true

  /** 反应持续时间（毫秒） */
  private reactionDuration: number

  constructor(options?: { enabled?: boolean; linkAgentState?: boolean; reactionDuration?: number }) {
    super()
    this.enabled = options?.enabled ?? true
    this.linkAgentState = options?.linkAgentState ?? true
    this.reactionDuration = options?.reactionDuration ?? 3000
  }

  // ============ Pre Hook ============

  /**
   * 执行 PreToolUse Hook
   * 在工具执行前触发，可阻止执行或修改参数
   *
   * @param ctx 工具执行上下文
   * @returns Hook 处理结果
   */
  firePreHook(ctx: ToolExecutionContext): HookResult {
    if (!this.enabled) {
      return { proceed: true }
    }

    // 查找匹配的映射规则
    const mapping = this.findMapping(ctx.toolName)

    const result: HookResult = { proceed: true }

    if (mapping) {
      // 触发编码反应
      if (mapping.preReaction) {
        const codingMgr = getCodingReactionManager()
        codingMgr.triggerReaction(mapping.preReaction, ctx.toolName, this.reactionDuration)
        result.reaction = mapping.preReaction
        this.emit('reaction-triggered', mapping.preReaction, 'pre')
      }

      // 联动代理状态
      if (this.linkAgentState && mapping.preAgentState) {
        const agentLayer = getAgentStateLayer()
        agentLayer.setState(mapping.preAgentState, `PreHook: ${ctx.toolName}`, ctx.agentId)
      }

      // 查找对应的动画 ID
      if (mapping.preReaction) {
        result.animationId = this.reactionToAnimationId(mapping.preReaction)
      }
    }

    this.emit('pre-hook', ctx, result)
    return result
  }

  // ============ Post Hook ============

  /**
   * 执行 PostToolUse Hook
   * 在工具执行后触发，根据执行结果触发不同的反应
   *
   * @param ctx 工具执行结果上下文
   * @returns Hook 处理结果
   */
  firePostHook(ctx: ToolExecutionResultContext): HookResult {
    if (!this.enabled) {
      return { proceed: true }
    }

    const mapping = this.findMapping(ctx.toolName)
    const result: HookResult = { proceed: true }

    if (mapping) {
      // 根据执行结果选择反应
      const reaction = ctx.success
        ? mapping.postSuccessReaction
        : mapping.postErrorReaction

      if (reaction) {
        const codingMgr = getCodingReactionManager()
        codingMgr.triggerReaction(reaction, ctx.toolName, this.reactionDuration)
        result.reaction = reaction
        this.emit('reaction-triggered', reaction, 'post')
      }

      // 联动代理状态
      if (this.linkAgentState && mapping.postAgentState) {
        const agentLayer = getAgentStateLayer()
        const state = ctx.success ? mapping.postAgentState : 'thinking'
        agentLayer.setState(state, `PostHook: ${ctx.toolName} (${ctx.success ? 'success' : 'error'})`, ctx.agentId)
      }

      // 查找对应的动画 ID
      if (reaction) {
        result.animationId = this.reactionToAnimationId(reaction)
      }
    }

    this.emit('post-hook', ctx, result)
    return result
  }

  // ============ 配置 ============

  /** 设置反应映射规则 */
  setMappings(mappings: ReactionMapping[]): void {
    this.mappings = [...mappings]
  }

  /** 获取当前反应映射规则 */
  getMappings(): ReactionMapping[] {
    return [...this.mappings]
  }

  /** 添加映射规则 */
  addMapping(mapping: ReactionMapping): void {
    // 插入到兜底规则之前
    const lastIdx = this.mappings.length - 1
    if (lastIdx >= 0 && this.mappings[lastIdx].toolPattern === '*') {
      this.mappings.splice(lastIdx, 0, mapping)
    } else {
      this.mappings.push(mapping)
    }
  }

  /** 移除映射规则 */
  removeMapping(toolPattern: string): void {
    this.mappings = this.mappings.filter((m) => m.toolPattern !== toolPattern)
  }

  /** 启用/禁用 Hooks */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /** 是否启用 */
  isEnabled(): boolean {
    return this.enabled
  }

  /** 启用/禁用代理状态联动 */
  setLinkAgentState(link: boolean): void {
    this.linkAgentState = link
  }

  // ============ 内部方法 ============

  /** 查找匹配的映射规则 */
  private findMapping(toolName: string): ReactionMapping | null {
    for (const mapping of this.mappings) {
      if (this.matchPattern(mapping.toolPattern, toolName)) {
        return mapping
      }
    }
    return null
  }

  /** 匹配工具名模式（支持 * 通配符） */
  private matchPattern(pattern: string, toolName: string): boolean {
    if (pattern === '*') return true
    if (pattern === toolName) return true
    // 将通配符模式转为正则
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i')
    return regex.test(toolName)
  }

  /** 编码反应 → 动画 ID */
  private reactionToAnimationId(reaction: CodingReaction): AnimationId | undefined {
    const mapping: Record<CodingReaction, AnimationId> = {
      thinking: 'thinking',
      editing: 'editing',
      testing: 'testing',
      success: 'success',
      error: 'error',
      celebrating: 'celebrating',
    }
    const animId = mapping[reaction]
    const exists = ANIMATION_CATALOG.some((a) => a.id === animId)
    return exists ? animId : undefined
  }

  /** 销毁管理器 */
  destroy(): void {
    this.mappings = []
    this.removeAllListeners()
  }
}

// ============ 单例 ============

let mcpHooksManager: McpHooksManager | null = null

/** 获取 MCP Hooks 管理器单例 */
export function getMcpHooksManager(): McpHooksManager {
  if (!mcpHooksManager) {
    mcpHooksManager = new McpHooksManager()
  }
  return mcpHooksManager
}

/** 重置 MCP Hooks 管理器 */
export function resetMcpHooksManager(): void {
  if (mcpHooksManager) {
    mcpHooksManager.destroy()
    mcpHooksManager = null
  }
}

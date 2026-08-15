/**
 * 对话系统 — 有向图对话树遍历 + 栈式回溯 + 变量插值 + 条件分支
 *
 * @fileoverview
 * 主要模块：
 * - DialogueNode 接口：对话节点（ID/文本/选项/音效/表情/条件）
 * - DialogueOption 接口：对话选项（文本/下一节点/条件/效果）
 * - DialogueCondition 接口：条件表达式（变量/操作符/值）
 * - DialogueEffect 接口：对话效果
 * - DialogueSystem 类：对话系统，支持栈式回溯、变量插值、条件分支、状态持久化
 *
 * 2. 对话状态持久化（可保存/恢复当前对话进度）
 * 3. 变量插值（在对话文本中替换宠物属性值）
 * 4. 条件分支（基于宠物属性/标记决定路径）
 *
 * 导致节点数据被修改（数据污染）。栈式回溯仅维护访问栈，不修改数据。
 *
 * @module dialogueSystem
 * @requires ./types - NurturingStats 类型定义
 */

import type { NurturingStats } from './types'

// ============ 对话节点类型 ============

/** 对话节点 */
export interface DialogueNode {
  /** 节点唯一 ID */
  id: string
  /** 显示文本（支持变量插值 {{varName}}） */
  text: string
  /** 选项列表（叶节点为空数组，表示对话结束） */
  options: DialogueOption[]
  /** 音效路径（可选） */
  sound?: string
  /** 角色表情/动画（可选） */
  emotion?: string
  /** 条件：只有满足时才显示此节点（可选） */
  condition?: DialogueCondition
}

/** 对话选项 */
export interface DialogueOption {
  /** 选项显示文本（支持变量插值） */
  text: string
  /** 选择后跳转到的节点 ID */
  nextNodeId: string
  /** 选项条件：只有满足时才显示此选项（可选） */
  condition?: DialogueCondition
  /** 选择此选项后的效果（可选） */
  effect?: DialogueEffect
}

/** 条件表达式 */
export interface DialogueCondition {
  /** 变量名（hp, mood, health, affection, level, flag:xxx） */
  variable: string
  /** 比较操作符 */
  operator: '>' | '>=' | '<' | '<=' | '==' | '!='
  /** 比较值 */
  value: number | string
}

/** 选项效果 */
export interface DialogueEffect {
  /** 设置标记 */
  setFlag?: string
  /** 清除标记 */
  clearFlag?: string
  /** 亲密度变化 */
  affectionDelta?: number
  /** 心情变化 */
  moodDelta?: number
  /** 饱食度变化 */
  hungerDelta?: number
}

/** 对话树定义 */
export interface DialogueTree {
  /** 对话树 ID */
  id: string
  /** 对话树名称 */
  name: string
  /** 起始节点 ID */
  startNodeId: string
  /** 所有节点 */
  nodes: Record<string, DialogueNode>
  /** 对话树版本 */
  version?: string
}

// ============ 对话状态 ============

/** 对话进行中的状态 */
export interface DialogueState {
  /** 对话树 ID */
  treeId: string
  /** 当前节点 ID */
  currentNodeId: string
  /** 访问栈（用于回溯，不修改节点数据） */
  history: string[]
  /** 对话标记集（条件分支用） */
  flags: Set<string>
  /** 对话是否结束 */
  finished: boolean
  /** 对话开始时间戳 */
  startedAt: number
}

// ============ 变量插值上下文 ============

/** 插值变量提供者 */
export interface InterpolationContext {
  /** 宠物养成数值 */
  stats: NurturingStats
  /** 标记集 */
  flags: Set<string>
  /** 自定义变量 */
  customVars?: Record<string, string | number>
}

// ============ 对话系统 ============

export class DialogueSystem {
  /** 已注册的对话树 */
  private trees: Map<string, DialogueTree> = new Map()
  /** 当前活跃的对话状态（每个角色最多一个） */
  private activeStates: Map<string, DialogueState> = new Map()

  /**
   * 注册对话树
   */
  registerTree(tree: DialogueTree): void {
    this.trees.set(tree.id, tree)
  }

  /**
   * 批量注册对话树
   */
  registerTrees(trees: DialogueTree[]): void {
    for (const tree of trees) {
      this.trees.set(tree.id, tree)
    }
  }

  /**
   * 获取已注册的对话树
   */
  getTree(treeId: string): DialogueTree | undefined {
    return this.trees.get(treeId)
  }

  /**
   * 开始对话
   * @param characterId 角色 ID
   * @param treeId 对话树 ID
   * @param savedState 恢复的对话状态（可选，用于持久化恢复）
   */
  startDialogue(
    characterId: string,
    treeId: string,
    savedState?: Partial<DialogueState>,
  ): DialogueState | null {
    const tree = this.trees.get(treeId)
    if (!tree) return null

    const state: DialogueState = savedState
      ? {
          treeId,
          currentNodeId: savedState.currentNodeId ?? tree.startNodeId,
          history: savedState.history ?? [],
          flags: savedState.flags instanceof Set ? savedState.flags : new Set(savedState.flags as unknown as string[]),
          finished: savedState.finished ?? false,
          startedAt: savedState.startedAt ?? Date.now(),
        }
      : {
          treeId,
          currentNodeId: tree.startNodeId,
          history: [],
          flags: new Set(),
          finished: false,
          startedAt: Date.now(),
        }

    this.activeStates.set(characterId, state)
    return state
  }

  /**
   * 获取当前对话节点
   */
  getCurrentNode(characterId: string, ctx: InterpolationContext): DialogueNode | null {
    const state = this.activeStates.get(characterId)
    if (!state || state.finished) return null

    const tree = this.trees.get(state.treeId)
    if (!tree) return null

    const node = tree.nodes[state.currentNodeId]
    if (!node) return null

    // 检查节点条件
    if (node.condition && !evaluateCondition(node.condition, ctx)) {
      // 条件不满足，跳到下一个节点或结束
      return null
    }

    return node
  }

  /**
   * 获取当前可用的选项（过滤条件不满足的选项）
   */
  getAvailableOptions(characterId: string, ctx: InterpolationContext): DialogueOption[] {
    const node = this.getCurrentNode(characterId, ctx)
    if (!node) return []

    return node.options.filter((opt) => {
      if (!opt.condition) return true
      return evaluateCondition(opt.condition, ctx)
    })
  }

  /**
   * 选择选项
   * 栈式回溯：当前节点入栈，跳转到目标节点
   * @returns 选择后的对话状态，null 表示对话结束
   */
  selectOption(
    characterId: string,
    optionIndex: number,
    ctx: InterpolationContext,
  ): DialogueState | null {
    const state = this.activeStates.get(characterId)
    if (!state || state.finished) return null

    const tree = this.trees.get(state.treeId)
    if (!tree) return null

    const node = tree.nodes[state.currentNodeId]
    if (!node) return null

    const availableOptions = node.options.filter((opt) => {
      if (!opt.condition) return true
      return evaluateCondition(opt.condition, ctx)
    })

    if (optionIndex < 0 || optionIndex >= availableOptions.length) return null

    const selectedOption = availableOptions[optionIndex]

    // 栈式回溯：当前节点入栈（不修改节点数据，避免数据污染）
    state.history.push(state.currentNodeId)

    // 应用效果
    if (selectedOption.effect) {
      applyEffect(selectedOption.effect, state)
    }

    // 跳转到目标节点
    const targetNode = tree.nodes[selectedOption.nextNodeId]
    if (!targetNode) {
      state.finished = true
      return state
    }

    // 检查目标节点条件
    if (targetNode.condition && !evaluateCondition(targetNode.condition, ctx)) {
      state.finished = true
      return state
    }

    state.currentNodeId = selectedOption.nextNodeId
    return state
  }

  /**
   * 回溯到上一个节点（栈式回溯）
   */
  goBack(characterId: string): DialogueState | null {
    const state = this.activeStates.get(characterId)
    if (!state || state.finished) return null
    if (state.history.length === 0) return null

    const previousNodeId = state.history.pop()!
    state.currentNodeId = previousNodeId
    return state
  }

  /**
   * 是否可以回溯
   */
  canGoBack(characterId: string): boolean {
    const state = this.activeStates.get(characterId)
    return !!state && !state.finished && state.history.length > 0
  }

  /**
   * 结束对话
   */
  endDialogue(characterId: string): void {
    const state = this.activeStates.get(characterId)
    if (state) {
      state.finished = true
    }
  }

  /**
   * 序列化对话状态（用于持久化）
   */
  serializeState(characterId: string): object | null {
    const state = this.activeStates.get(characterId)
    if (!state) return null
    return {
      treeId: state.treeId,
      currentNodeId: state.currentNodeId,
      history: state.history,
      flags: Array.from(state.flags),
      finished: state.finished,
      startedAt: state.startedAt,
    }
  }

  /**
   * 恢复对话状态（从持久化数据）
   */
  deserializeState(characterId: string, data: {
    treeId: string
    currentNodeId: string
    history: string[]
    flags: string[]
    finished: boolean
    startedAt: number
  }): DialogueState | null {
    const state: DialogueState = {
      treeId: data.treeId,
      currentNodeId: data.currentNodeId,
      history: data.history,
      flags: new Set(data.flags),
      finished: data.finished,
      startedAt: data.startedAt,
    }
    this.activeStates.set(characterId, state)
    return state
  }

  /**
   * 插值变量：替换文本中的 {{varName}} 占位符
   */
  interpolate(text: string, ctx: InterpolationContext): string {
    return text.replace(/\{\{(\w+(?::\w+)?)\}\}/g, (_match, varName: string) => {
      // 解析变量名
      if (varName.startsWith('flag:')) {
        const flagName = varName.slice(5)
        return ctx.flags.has(flagName) ? 'true' : 'false'
      }

      switch (varName) {
        case 'hp':
        case 'hunger':
          return String(ctx.stats.hunger)
        case 'mood':
          return String(ctx.stats.mood)
        case 'health':
          return String(ctx.stats.health)
        case 'affection':
          return String(ctx.stats.affection)
        case 'level':
          return String(ctx.stats.level)
        case 'exp':
          return String(ctx.stats.exp)
        case 'coins':
          return String(ctx.stats.coins)
        default:
          // 自定义变量
          if (ctx.customVars && varName in ctx.customVars) {
            return String(ctx.customVars[varName])
          }
          return `{{${varName}}}`
      }
    })
  }
}

// ============ 条件求值 ============

/**
 * 求值条件表达式
 */
function evaluateCondition(condition: DialogueCondition, ctx: InterpolationContext): boolean {
  let leftValue: number | string

  if (condition.variable.startsWith('flag:')) {
    const flagName = condition.variable.slice(5)
    leftValue = ctx.flags.has(flagName) ? 1 : 0
  } else {
    switch (condition.variable) {
      case 'hp':
      case 'hunger':
        leftValue = ctx.stats.hunger
        break
      case 'mood':
        leftValue = ctx.stats.mood
        break
      case 'health':
        leftValue = ctx.stats.health
        break
      case 'affection':
        leftValue = ctx.stats.affection
        break
      case 'level':
        leftValue = ctx.stats.level
        break
      default:
        leftValue = 0
    }
  }

  const rightValue = condition.value
  const leftNum = typeof leftValue === 'number' ? leftValue : parseFloat(String(leftValue))
  const rightNum = typeof rightValue === 'number' ? rightValue : parseFloat(String(rightValue))

  switch (condition.operator) {
    case '>':  return leftNum > rightNum
    case '>=': return leftNum >= rightNum
    case '<':  return leftNum < rightNum
    case '<=': return leftNum <= rightNum
    case '==': return leftValue == rightValue
    case '!=': return leftValue != rightValue
    default:   return false
  }
}

/**
 * 应用选项效果
 */
function applyEffect(effect: DialogueEffect, state: DialogueState): void {
  if (effect.setFlag) {
    state.flags.add(effect.setFlag)
  }
  if (effect.clearFlag) {
    state.flags.delete(effect.clearFlag)
  }
  // 注意：affectionDelta/moodDelta/hungerDelta 需要通过 petStore 应用，
  // 此处仅记录效果，由调用方负责实际修改养成数值
}

// ============ 单例 ============

let dialogueSystemInstance: DialogueSystem | null = null

/** 获取对话系统单例 */
export function getDialogueSystem(): DialogueSystem {
  if (!dialogueSystemInstance) {
    dialogueSystemInstance = new DialogueSystem()
  }
  return dialogueSystemInstance
}

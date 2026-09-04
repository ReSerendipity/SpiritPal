/**
 * 对话管理器 — SpiritPal 对话系统，有向图对话+效果系统+条件分支
 *
 * @fileoverview
 * 主要模块：
 * - DialogueEffect 接口：对话效果（add_item/remove_item/add_affection/add_coins/add_buff/set_flag/trigger_event）
 * - DialogueOption 接口：对话选项（文本/下一节点/条件/效果/隐藏）
 * - DialogueNode 接口：对话节点（ID/文本/说话者/选项/奖励/效果/自动跳转/标记）
 * - DialogueGraph 接口：对话图（ID/起始节点/节点列表）
 * - DialogueConfigFile 接口：对话配置文件结构
 * - DialogueManager 类：对话管理器，支持加载配置、栈式回溯、节点遍历、效果触发、条件求值
 *
 *
 * Phase 2 增强功能：
 * - 对话节点支持 effects（效果系统：修改数值、添加物品、触发 buff 等）
 * - 条件表达式增强（支持 has_item, affection_gte, level_gte 等）
 * - 对话项物品联动（dialogue 类型物品解锁对话图）
 *
 * @module dialogueManager
 */

// ============ 对话类型定义 ============

/** 对话效果 — 对话节点触发时对游戏状态的影响 */
export interface DialogueEffect {
  /** 效果类型 */
  type: 'add_item' | 'remove_item' | 'add_affection' | 'add_coins' | 'add_buff' | 'set_flag' | 'trigger_event'
  /** 效果值 */
  value: string | number
  /** 额外参数 */
  params?: Record<string, unknown>
}

/** 对话选项：玩家可选择的方向，可附带条件和效果 */
export interface DialogueOption {
  text: string
  nextNodeId: string
  /** 条件表达式，暂为字符串标识符，由外部求值器判定 */
  condition?: string
  /** 选择该选项时触发的效果 */
  effects?: DialogueEffect[]
  /** 选项是否可见（条件不满足时隐藏而非禁用） */
  hidden?: boolean
}

/** 对话节点：图中的单个节点 */
export interface DialogueNode {
  id: string
  text: string
  speaker?: string
  options?: DialogueOption[]
  /** 奖励：物品 id 列表，到达此节点时发放 */
  reward?: string[]
  /** 效果列表：到达此节点时触发的效果 */
  effects?: DialogueEffect[]
  /** 无选项时自动跳转的下一节点 id */
  next?: string
  /** 自动跳转条件（满足条件时跳转，否则停留） */
  nextCondition?: string
  /** 节点标记（用于 set_flag 效果检查） */
  flags?: string[]
}

/** 对话图：有向图，由起始节点和所有节点组成 */
export interface DialogueGraph {
  id: string
  startNodeId: string
  nodes: Map<string, DialogueNode>
  /** 对话图元数据 */
  meta?: {
    title?: string
    description?: string
    requiredItemId?: string  // 需要的对话物品 ID
    unlockCondition?: string // 解锁条件
  }
}

/** 对话状态机状态 */
export type DialogueState = 'idle' | 'active' | 'completed' | 'cancelled'

// ============ 配置序列化格式 ============

/** JSON 配置中的节点（反序列化前用 Record 而非 Map） */
export interface DialogueNodeConfig {
  id: string
  text: string
  speaker?: string
  options?: DialogueOption[]
  reward?: string[]
  effects?: DialogueEffect[]
  next?: string
  nextCondition?: string
  flags?: string[]
}

/** JSON 配置中的对话图 */
export interface DialogueGraphConfig {
  id: string
  startNodeId: string
  nodes: DialogueNodeConfig[]
  meta?: {
    title?: string
    description?: string
    requiredItemId?: string
    unlockCondition?: string
  }
}

/** 顶层配置文件格式 */
export interface DialogueConfigFile {
  graphs: DialogueGraphConfig[]
}

// ============ 条件求值器类型 ============

export type ConditionEvaluator = (condition: string) => boolean

// ============ 效果处理器类型 ============

export type EffectHandler = (effect: DialogueEffect) => void

// ============ 内置条件求值器 ============

/**
 * 创建内置条件求值器
 * 支持条件格式：
 * - has_item:itemId — 检查背包中是否有指定物品
 * - affection_gte:N — 检查好感度 >= N
 * - level_gte:N — 检查等级 >= N
 * - flag:flagName — 检查对话标记是否设置
 * - coins_gte:N — 检查金币 >= N
 */
export function createBuiltinConditionEvaluator(
  getInventory: () => Array<{ id: string; count: number }>,
  getAffection: () => number,
  getLevel: () => number,
  getCoins: () => number,
  getFlags: () => Set<string>,
): ConditionEvaluator {
  const evaluate: ConditionEvaluator = (condition: string): boolean => {
    const parts = condition.split(':')
    const op = parts[0]
    const arg = parts.slice(1).join(':')

    switch (op) {
      case 'has_item':
        return getInventory().some((item) => item.id === arg && item.count > 0)
      case 'affection_gte':
        return getAffection() >= parseInt(arg, 10)
      case 'level_gte':
        return getLevel() >= parseInt(arg, 10)
      case 'coins_gte':
        return getCoins() >= parseInt(arg, 10)
      case 'flag':
        return getFlags().has(arg)
      case 'not':
        return !evaluate(arg)
      default:
        return true
    }
  }
  return evaluate
}

// ============ DialogueManager ============

export class DialogueManager {
  private graphs: Map<string, DialogueGraph> = new Map()
  private state: DialogueState = 'idle'
  private activeGraphId: string | null = null
  private currentNodeId: string | null = null
  private historyStack: string[] = []
  private conditionEvaluator: ConditionEvaluator
  /** 奖励回调：节点包含 reward 时触发 */
  private rewardCallback: ((itemIds: string[]) => void) | null = null
  /** 效果处理器列表 */
  private effectHandlers: EffectHandler[] = []
  /** 对话标记集合（当前会话中设置的标记） */
  private sessionFlags: Set<string> = new Set()

  constructor(
    conditionEvaluator?: ConditionEvaluator,
    rewardCallback?: (itemIds: string[]) => void
  ) {
    this.conditionEvaluator = conditionEvaluator ?? (() => true)
    this.rewardCallback = rewardCallback ?? null
  }

  // -------- 图注册 --------

  /** 注册一个对话图 */
  registerGraph(graph: DialogueGraph): void {
    this.graphs.set(graph.id, graph)
  }

  /** 从 JSON 配置批量加载对话图 */
  loadFromConfig(config: DialogueConfigFile): void {
    for (const gc of config.graphs) {
      const nodes = new Map<string, DialogueNode>()
      for (const node of gc.nodes) {
        nodes.set(node.id, node)
      }
      this.registerGraph({
        id: gc.id,
        startNodeId: gc.startNodeId,
        nodes,
        meta: gc.meta,
      })
    }
  }

  /** 设置/替换条件求值器 */
  setConditionEvaluator(evaluator: ConditionEvaluator): void {
    this.conditionEvaluator = evaluator
  }

  /** 设置/替换奖励回调 */
  setRewardCallback(callback: (itemIds: string[]) => void): void {
    this.rewardCallback = callback
  }

  /** 添加效果处理器 */
  addEffectHandler(handler: EffectHandler): void {
    this.effectHandlers.push(handler)
  }

  /** 移除效果处理器 */
  removeEffectHandler(handler: EffectHandler): void {
    this.effectHandlers = this.effectHandlers.filter((h) => h !== handler)
  }

  // -------- 对话生命周期 --------

  /** 开始一段对话，返回首节点；若图不存在则返回 null */
  startDialogue(graphId: string): DialogueNode | null {
    const graph = this.graphs.get(graphId)
    if (!graph) return null

    const startNode = graph.nodes.get(graph.startNodeId)
    if (!startNode) return null

    this.activeGraphId = graphId
    this.currentNodeId = graph.startNodeId
    this.historyStack = []
    this.sessionFlags = new Set()
    this.state = 'active'

    this.processNodeEffects(startNode)
    return startNode
  }

  /** 选择一个选项，推进对话；返回下一节点或 null */
  selectOption(optionIndex: number): DialogueNode | null {
    if (this.state !== 'active') return null

    const graph = this.getActiveGraph()
    if (!graph || !this.currentNodeId) return null

    const currentNode = graph.nodes.get(this.currentNodeId)
    if (!currentNode?.options || optionIndex < 0 || optionIndex >= currentNode.options.length) {
      return null
    }

    const option = currentNode.options[optionIndex]

    // 条件校验
    if (option.condition && !this.conditionEvaluator(option.condition)) {
      return null
    }

    // 压栈回溯
    this.historyStack.push(this.currentNodeId)

    // 处理选项效果
    if (option.effects) {
      this.applyEffects(option.effects)
    }

    const nextNode = graph.nodes.get(option.nextNodeId)
    if (!nextNode) return null

    this.currentNodeId = option.nextNodeId
    this.processNodeEffects(nextNode)

    // 无选项且无 next 的节点为叶子节点，自动完成对话
    if (!nextNode.options && !nextNode.next) {
      this.state = 'completed'
    }

    return nextNode
  }

  /** 栈回溯：返回上一个节点；若栈空则返回 null */
  goBack(): DialogueNode | null {
    if (this.state !== 'active') return null
    if (this.historyStack.length === 0) return null

    const prevNodeId = this.historyStack.pop()!
    const graph = this.getActiveGraph()
    if (!graph) return null

    const prevNode = graph.nodes.get(prevNodeId)
    if (!prevNode) return null

    this.currentNodeId = prevNodeId
    return prevNode
  }

  /** 取消当前对话 */
  cancelDialogue(): void {
    if (this.state === 'active') {
      this.state = 'cancelled'
      this.cleanup()
    }
  }

  /** 完成当前对话（外部可调用，如跳过结尾） */
  completeDialogue(): void {
    if (this.state === 'active') {
      this.state = 'completed'
      this.cleanup()
    }
  }

  // -------- 查询 --------

  /** 获取当前节点 */
  getCurrentNode(): DialogueNode | null {
    if (this.state !== 'active') return null
    const graph = this.getActiveGraph()
    if (!graph || !this.currentNodeId) return null
    return graph.nodes.get(this.currentNodeId) ?? null
  }

  /** 获取当前节点的可见选项（过滤条件不满足的隐藏选项） */
  getVisibleOptions(): DialogueOption[] {
    const node = this.getCurrentNode()
    if (!node?.options) return []
    return node.options.filter((option) => {
      if (option.hidden && option.condition && !this.conditionEvaluator(option.condition)) {
        return false
      }
      return true
    })
  }

  /** 获取当前状态 */
  getState(): DialogueState {
    return this.state
  }

  /** 能否回溯 */
  canGoBack(): boolean {
    return this.state === 'active' && this.historyStack.length > 0
  }

  /** 获取当前对话图 id */
  getActiveGraphId(): string | null {
    return this.activeGraphId
  }

  /** 获取指定图（供外部遍历用） */
  getGraph(graphId: string): DialogueGraph | undefined {
    return this.graphs.get(graphId)
  }

  /** 获取所有已注册图 id */
  getRegisteredGraphIds(): string[] {
    return Array.from(this.graphs.keys())
  }

  /** 检查对话图是否可解锁（基于 requiredItemId） */
  isGraphUnlockable(graphId: string, inventory: Array<{ id: string; count: number }>): boolean {
    const graph = this.graphs.get(graphId)
    if (!graph?.meta?.requiredItemId) return true
    return inventory.some((item) => item.id === graph.meta!.requiredItemId && item.count > 0)
  }

  /** 获取会话标记集合 */
  getSessionFlags(): Set<string> {
    return new Set(this.sessionFlags)
  }

  // -------- 内部方法 --------

  private getActiveGraph(): DialogueGraph | null {
    if (!this.activeGraphId) return null
    return this.graphs.get(this.activeGraphId) ?? null
  }

  /** 应用效果列表 */
  private applyEffects(effects: DialogueEffect[]): void {
    for (const effect of effects) {
      // 处理 set_flag 效果
      if (effect.type === 'set_flag' && typeof effect.value === 'string') {
        this.sessionFlags.add(effect.value)
      }
      // 交给外部处理器
      for (const handler of this.effectHandlers) {
        handler(effect)
      }
    }
  }

  /** 处理节点效果：自动跳转 + 奖励发放 + 效果触发 */
  private processNodeEffects(node: DialogueNode): void {
    // 设置标记
    if (node.flags) {
      for (const flag of node.flags) {
        this.sessionFlags.add(flag)
      }
    }

    // 发放奖励
    if (node.reward && node.reward.length > 0 && this.rewardCallback) {
      this.rewardCallback(node.reward)
    }

    // 触发效果
    if (node.effects) {
      this.applyEffects(node.effects)
    }

    // 自动跳转（next 字段，无选项时生效）
    if (node.next && !node.options) {
      // 检查跳转条件
      if (node.nextCondition && !this.conditionEvaluator(node.nextCondition)) {
        return
      }

      const graph = this.getActiveGraph()
      if (!graph) return

      const nextNode = graph.nodes.get(node.next)
      if (nextNode) {
        this.historyStack.push(node.id)
        this.currentNodeId = node.next
        // 递归处理链式跳转（最多 10 层防死循环）
        if (this.historyStack.length < 10) {
          this.processNodeEffects(nextNode)
        }
      }
    }
  }

  /** 清理对话现场 */
  private cleanup(): void {
    this.activeGraphId = null
    this.currentNodeId = null
    this.historyStack = []
    // 注意：不清除 sessionFlags，允许跨对话保留标记
  }

  /**
   * 销毁管理器，清空所有状态
   * 清空图、重置状态、清空历史栈、清空会话标记、清空效果处理器，
   * 重置奖励回调和条件求值器为默认值
   */
  dispose(): void {
    this.graphs.clear()
    this.state = 'idle'
    this.activeGraphId = null
    this.currentNodeId = null
    this.historyStack = []
    this.sessionFlags.clear()
    this.effectHandlers = []
    this.rewardCallback = null
    this.conditionEvaluator = (() => true)
  }
}

// ============ 单例 ============

let instance: DialogueManager | null = null

/** 获取全局 DialogueManager 单例 */
export function getDialogueManager(): DialogueManager {
  if (!instance) {
    instance = new DialogueManager()
  }
  return instance
}

/** 重置单例（测试用） */
export function resetDialogueManager(): void {
  if (instance) {
    instance.dispose()
    instance = null
  }
}

/** dispose 别名，与 resetDialogueManager 功能一致，保持 API 一致性 */
export const disposeDialogueManager = resetDialogueManager

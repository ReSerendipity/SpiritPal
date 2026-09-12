/**
 * 副宠状态机模块
 *
 * @fileoverview 迷你宠物（副宠）运行时生命周期状态机
 *
 * 主要模块：
 * - SubpetState: 副宠四态（summoned / following / idle / recalled）
 * - SubpetEvent: 触发状态转换的事件
 * - canTransition(): 纯函数 — 判断事件在当前状态下是否合法
 * - transitionSubpetState(): 纯函数 reducer — 计算事件后的新状态
 * - SubpetStateMachine: 类封装 — 持有当前状态并派发事件
 *
 * 状态图：
 * ```
 *   recalled ──summon──▶ summoned ──startFollowing──▶ following
 *      ▲                   │                            │
 *      │                   │                            │ stopFollowing
 *      │                 recall                       ▼
 *      │                   │                          idle
 *      │                   │                            │
 *      └───────────────────┴──────── startFollowing ────┘
 *                          （任意活跃态 ──recall──▶ recalled）
 * ```
 *
 * 核心约束：
 * - 召唤→跟随→闲置→收回 是主生命周期；闲置与跟随可互相切换
 * - 任意活跃态（summoned/following/idle）都可直接收回
 * - 收回后可再次召唤
 * - 不合法的事件不会抛出异常，而是保持原状态不变（reducer 风格）
 */

// ============ 状态与事件定义 ============

/** 副宠生命周期状态 */
export type SubpetState = 'summoned' | 'following' | 'idle' | 'recalled'

/** 副宠状态事件 */
export type SubpetEvent = 'summon' | 'startFollowing' | 'stopFollowing' | 'recall'

// ============ 转换表（单一事实来源） ============

/**
 * 合法状态转换表
 *
 * 键：当前状态；值：事件 → 目标状态
 */
const TRANSITIONS: Record<SubpetState, Partial<Record<SubpetEvent, SubpetState>>> = {
  // 已收回 → 召唤
  recalled: {
    summon: 'summoned',
  },
  // 已召唤（刚出现，尚未开始跟随）
  summoned: {
    startFollowing: 'following',
    recall: 'recalled',
  },
  // 跟随中
  following: {
    stopFollowing: 'idle',
    recall: 'recalled',
  },
  // 闲置（停在原地休息，不跟随主宠移动）
  idle: {
    startFollowing: 'following',
    recall: 'recalled',
  },
}

// ============ 纯函数 ============

/**
 * 判断事件在当前状态下是否合法
 *
 * @param state 当前状态
 * @param event 待派发事件
 * @returns 该事件是否会引起状态转换
 */
export function canTransition(state: SubpetState, event: SubpetEvent): boolean {
  return TRANSITIONS[state][event] !== undefined
}

/**
 * 纯函数 reducer — 计算事件应用后的新状态
 *
 * 不合法的事件不会抛出异常，而是原样返回当前状态（幂等）。
 *
 * @param state 当前状态
 * @param event 事件
 * @returns 新状态（事件合法时为目标状态，否则为原状态）
 */
export function transitionSubpetState(state: SubpetState, event: SubpetEvent): SubpetState {
  return TRANSITIONS[state][event] ?? state
}

/**
 * 判断状态是否为「活跃态」（已出现在屏幕上）
 *
 * @param state 状态
 * @returns summoned / following / idle 均视为活跃
 */
export function isSubpetActive(state: SubpetState): boolean {
  return state !== 'recalled'
}

// ============ 状态机类 ============

/**
 * 副宠状态机
 *
 * 封装当前状态，提供类型安全的事件派发。
 * 与 React / zustand 解耦，可在渲染循环、测试中独立使用。
 *
 * @example
 * ```ts
 * const sm = new SubpetStateMachine()
 * sm.dispatch('summon')           // recalled → summoned
 * sm.dispatch('startFollowing')   // summoned → following
 * sm.dispatch('recall')           // following → recalled
 * ```
 */
export class SubpetStateMachine {
  private state: SubpetState

  /**
   * @param initial 初始状态，默认 recalled（未召唤）
   */
  constructor(initial: SubpetState = 'recalled') {
    this.state = initial
  }

  /**
   * 派发事件
   *
   * @param event 状态事件
   * @returns 事件是否引起了状态变化（不合法事件返回 false）
   */
  dispatch(event: SubpetEvent): boolean {
    if (!canTransition(this.state, event)) return false
    this.state = transitionSubpetState(this.state, event)
    return true
  }

  /** 获取当前状态 */
  getState(): SubpetState {
    return this.state
  }

  /** 是否处于活跃态（屏幕上可见） */
  isActive(): boolean {
    return isSubpetActive(this.state)
  }

  /** 是否正在跟随主宠移动 */
  isFollowing(): boolean {
    return this.state === 'following'
  }

  /**
   * 重置到指定状态（默认 recalled）
   * 主要用于测试或角色切换时清理
   */
  reset(state: SubpetState = 'recalled'): void {
    this.state = state
  }
}

/**
 * 编码反应行扩展 — 将 9 行精灵图扩展至 15 行，新增 6 行编码反应动画
 * 参考 OpenPets packages/client/src/protocol.ts:allowedReactions
 *
 * @fileoverview
 * 主要模块：
 * - CodingReaction 类型：6 种编码反应状态（thinking/editing/testing/success/error/celebrating）
 * - CODING_REACTION_ROWS：编码反应→精灵图行号+帧数映射
 * - CODING_REACTION_TO_PETSTATE：编码反应→PetState 映射
 * - EXTENDED_ATLAS：扩展后的 ATLAS 配置（15 行）
 * - EXTENDED_ANIMATION_ROWS：扩展后的动画行配置
 *
 * 原 9 行：idle(0), walk(1), run-left(2), waving(3), jumping(4), failed(5), waiting(6), running(7), review(8)
 * 新增 6 行：thinking(9), editing(10), testing(11), success(12), error(13), celebrating(14)
 *
 * 设计：
 * - 扩展 ATLAS 行数为 15（9 基础 + 6 编码反应）
 * - 每个编码反应映射到动画 ID 和精灵图行号
 * - 保留与 ANIMATION_ROWS 的向后兼容（原 9 行不变）
 * - 新行与 OpenPets 的 reaction 名一一对应
 *
 * @module codingReactionRows
 * @requires ./types - AnimationRow, PetState, ATLAS, ANIMATION_ROWS 类型和常量
 */

import type { AnimationRow, PetState } from './types'

// ============ 编码反应类型 ============
/** 编码反应状态（6 种，对应新增的 6 行精灵图） */
export type CodingReaction =
  | 'thinking'     // 思考中 — 宠物正在处理/推理
  | 'editing'      // 编辑中 — 宠物正在编写代码
  | 'testing'      // 测试中 — 宠物正在运行测试
  | 'success'      // 成功 — 操作成功
  | 'error'        // 错误 — 遇到错误
  | 'celebrating'  // 庆祝 — 庆祝成功

/** 编码反应总数 */
export const CODING_REACTION_COUNT = 6

/** 基础行数（原 9 行） */
export const BASE_ROW_COUNT = 9

/** 扩展后总行数 */
export const EXTENDED_ROW_COUNT = BASE_ROW_COUNT + CODING_REACTION_COUNT // 15

// ============ 编码反应行定义 ============
/**
 * 编码反应 → 精灵图行号 + 帧数映射
 *
 * 行号从 BASE_ROW_COUNT (9) 开始，依次递增
 * 帧数参考原 ANIMATION_ROWS 的典型帧数（6-8 帧）
 */
export const CODING_REACTION_ROWS: Record<CodingReaction, AnimationRow> = {
  thinking:    { row: 9,  frames: 6 },  // 思考中：6 帧（类似 idle）
  editing:     { row: 10, frames: 8 },  // 编辑中：8 帧（类似 walk，有手部动作）
  testing:     { row: 11, frames: 6 },  // 测试中：6 帧（类似 waiting，等待反馈）
  success:     { row: 12, frames: 5 },  // 成功：5 帧（类似 jumping）
  error:       { row: 13, frames: 8 },  // 错误：8 帧（类似 failed，摇晃/叹气）
  celebrating: { row: 14, frames: 6 },  // 庆祝：6 帧（类似 waving + 跳跃混合）
}

// ============ 编码反应 → 动画 ID 映射 ============
/**
 * 编码反应映射到 animationConfig.ts 中的 AnimationId
 * 
 * 映射策略：
 * - thinking → coding_companion（编码陪伴，静坐思考）
 * - editing → coding_companion（编码陪伴，持续编辑）
 * - testing → coding_companion（编码陪伴，等待结果）
 * - success → level_up（升级/成功表现）
 * - error → confused（困惑/出错）
 * - celebrating → excited（兴奋/庆祝）
 */
export const CODING_REACTION_TO_ANIMATION: Record<CodingReaction, string> = {
  thinking:    'coding_companion',
  editing:     'coding_companion',
  testing:     'coding_companion',
  success:     'level_up',
  error:       'confused',
  celebrating: 'excited',
}

// ============ 编码反应 → PetState 映射 ============
/**
 * 编码反应映射到精灵图 PetState
 *
 * 扩展后的 PetState 包含原有状态 + 新增编码反应状态
 * 当精灵图不支持扩展行时，回退到基础 PetState
 */
export const CODING_REACTION_TO_PET_STATE: Record<CodingReaction, PetState> = {
  thinking:    'sit',    // 思考 → 坐下
  editing:     'sit',    // 编辑 → 坐下
  testing:     'idle',   // 测试 → 待机
  success:     'happy',  // 成功 → 开心
  error:       'sad',    // 错误 → 伤心
  celebrating: 'happy',  // 庆祝 → 开心
}

// ============ OpenPets 反应名 → 编码反应映射 ============
/**
 * 将 OpenPets 的 reaction 名映射到本系统的 CodingReaction
 * 与 types.ts 中的 OPENPETS_REACTION_MAP 互补
 */
export const OPENPETS_TO_CODING_REACTION: Record<string, CodingReaction> = {
  thinking:    'thinking',
  editing:     'editing',
  testing:     'testing',
  success:     'success',
  error:       'error',
  celebrating: 'celebrating',
}

// ============ 扩展 ANIMATION_ROWS ============
/**
 * 合并基础 9 行 + 6 行编码反应，生成完整的 15 行动画行表
 *
 * 原有代码使用 ANIMATION_ROWS 时，新增的编码反应行不会影响已有映射
 * 需要编码反应的代码使用 EXTENDED_ANIMATION_ROWS
 */
export function getExtendedAnimationRows(
  baseRows: Record<string, AnimationRow>,
): Record<string, AnimationRow> {
  return {
    ...baseRows,
    ...CODING_REACTION_ROWS,
  }
}

// ============ 编码反应行查找 ============

/**
 * 根据 OpenPets reaction 名获取对应的精灵图行定义
 * @param reactionName OpenPets 反应名（如 'thinking', 'editing'）
 * @returns 对应的 AnimationRow，若非编码反应则返回 null
 */
export function getCodingReactionRow(reactionName: string): AnimationRow | null {
  const codingReaction = OPENPETS_TO_CODING_REACTION[reactionName]
  if (!codingReaction) return null
  return CODING_REACTION_ROWS[codingReaction]
}

/**
 * 判断精灵图是否支持扩展行（编码反应）
 * 通过检测精灵图的总行数判断
 * @param totalRows 精灵图总行数
 * @returns true 表示支持编码反应行
 */
export function supportsCodingReactions(totalRows: number): boolean {
  return totalRows >= EXTENDED_ROW_COUNT
}

/**
 * 获取编码反应的回退行（当精灵图不支持扩展行时）
 * 回退到 OPENPETS_REACTION_MAP 中对应的基础行
 */
export function getCodingReactionFallbackRow(
  reactionName: string,
  baseRows: Record<string, AnimationRow>,
): AnimationRow | null {
  // 导入 types.ts 的 OPENPETS_REACTION_MAP
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 惰性 require 避免 types 循环依赖
  const { OPENPETS_REACTION_MAP } = require('./types')
  const baseAnimName = OPENPETS_REACTION_MAP[reactionName]
  if (!baseAnimName) return null
  return baseRows[baseAnimName] ?? null
}

// ============ 编码反应状态管理 ============

/** 编码反应上下文（IDE/编辑器传来的工作状态） */
export interface CodingContext {
  /** 当前反应类型 */
  reaction: CodingReaction
  /** 反应开始时间戳 */
  startedAt: number
  /** 附加信息（如文件名、错误消息等） */
  detail?: string
  /** 持续时长（毫秒），0 表示持续到下一次反应 */
  duration?: number
}

/**
 * 编码反应管理器
 * 管理编码反应状态的切换、持续时间和回退
 */
export class CodingReactionManager {
  /** 当前激活的编码反应 */
  private currentReaction: CodingContext | null = null
  /** 反应切换回调 */
  private onReactionChange: ((ctx: CodingContext | null) => void) | null = null

  /** 设置反应切换回调 */
  setOnReactionChange(callback: (ctx: CodingContext | null) => void): void {
    this.onReactionChange = callback
  }

  /** 触发编码反应 */
  triggerReaction(reaction: CodingReaction, detail?: string, duration?: number): void {
    const ctx: CodingContext = {
      reaction,
      startedAt: Date.now(),
      detail,
      duration,
    }
    this.currentReaction = ctx
    this.onReactionChange?.(ctx)
  }

  /** 清除当前反应（回到基础状态） */
  clearReaction(): void {
    this.currentReaction = null
    this.onReactionChange?.(null)
  }

  /** 获取当前反应 */
  getCurrentReaction(): CodingContext | null {
    // 检查是否超时
    if (this.currentReaction?.duration) {
      const elapsed = Date.now() - this.currentReaction.startedAt
      if (elapsed >= this.currentReaction.duration) {
        this.clearReaction()
      }
    }
    return this.currentReaction
  }

  /** 获取当前反应对应的精灵图行 */
  getCurrentRow(): AnimationRow | null {
    const ctx = this.getCurrentReaction()
    if (!ctx) return null
    return CODING_REACTION_ROWS[ctx.reaction]
  }

  /** 获取当前反应对应的 PetState（回退用） */
  getCurrentPetState(): PetState | null {
    const ctx = this.getCurrentReaction()
    if (!ctx) return null
    return CODING_REACTION_TO_PET_STATE[ctx.reaction]
  }
}

// ============ 单例 ============
let codingReactionManager: CodingReactionManager | null = null

/** 获取编码反应管理器单例 */
export function getCodingReactionManager(): CodingReactionManager {
  if (!codingReactionManager) {
    codingReactionManager = new CodingReactionManager()
  }
  return codingReactionManager
}

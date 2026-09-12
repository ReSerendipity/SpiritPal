/**
 * modConflictResolver — 字段级 MOD 冲突检测与解析建议
 *
 * @fileoverview
 * 本模块在不改动 modManager 既有 checkModConflicts（依赖校验）的前提下，
 * 提供更细粒度的「两个 Mod 修改同一角色的同一字段」冲突检测：
 *
 * 冲突类型：
 * - pet_conf_field  同一角色的 pet_conf 关键定义被两个 Mod 同时改写
 * - animation_name  actConf 中同名动画被两个 Mod 各自定义
 * - item_id         itemsConf 中同 ID 物品被两个 Mod 各自定义
 * - dialogue_id     dialogueConf 中同类对话/同类气泡被两个 Mod 各自改写
 *
 * 冲突级别：
 * - error   必须解决（角色身份级冲突：两个 Mod 定义了同一个角色 id）
 * - warning 可共存（按加载顺序后覆盖先，提示用户注意）
 *
 * 解析建议：
 * - resolveConflict(conflict, strategy) 给出 keep_a / keep_b / merge / manual 的处置建议
 *
 * 设计原则：
 * - 纯函数、无 Tauri/IO 依赖，便于单测
 * - 仅以 type-only 方式引用 modManager 的数据结构，避免运行时循环依赖
 *
 * @module lib/data/modConflictResolver
 */

import type { CharacterMod } from './modManager'

// ============ 类型定义 ============

/** 冲突类型 */
export type ConflictType = 'pet_conf_field' | 'animation_name' | 'item_id' | 'dialogue_id'

/** 冲突级别 */
export type ConflictSeverity = 'error' | 'warning'

/** 解决策略 */
export type ConflictStrategy = 'keep_a' | 'keep_b' | 'merge' | 'manual'

/** 供冲突检测的 Mod 输入（只需 id + 完整 modData） */
export interface ModConflictInput {
  /** Mod 唯一 ID（petmod.json 的 id） */
  id: string
  /** 完整 Mod 数据 */
  modData: CharacterMod
}

/** 单条冲突记录 */
export interface ModConflict {
  /** 冲突类型 */
  type: ConflictType
  /** 冲突级别 */
  severity: ConflictSeverity
  /** 参与冲突的 Mod A（先加载者） */
  modAId: string
  /** 参与冲突的 Mod B（后加载者） */
  modBId: string
  /** 被冲突的目标角色（petConf.id） */
  targetCharacterId: string
  /** 冲突字段/键名（如 spriteAsset / animation:idle / item:apple / bubble:idle） */
  field: string
  /** 人读冲突描述 */
  detail: string
}

/** resolveConflict 返回的处置建议 */
export interface ConflictResolution {
  /** 建议策略 */
  strategy: ConflictStrategy
  /** 胜出的 Mod id（merge/manual 时为 null） */
  winnerModId: string | null
  /** 人读处置说明 */
  message: string
}

// ============ 内部工具 ============

/** 提取 Mod 涉及的动画 id 集合 */
function animationIds(mod: CharacterMod): string[] {
  return (mod.actConf?.animations ?? []).map((a) => String(a.state))
}

/** 提取 Mod 涉及的物品 id 集合（foods + toys + medicines） */
function itemIds(mod: CharacterMod): string[] {
  const items = mod.itemsConf
    ? [
        ...(mod.itemsConf.foods ?? []),
        ...(mod.itemsConf.toys ?? []),
        ...(mod.itemsConf.medicines ?? []),
      ]
    : []
  return items.map((i) => String(i.id))
}

/** 提取 Mod 改写的气泡对话类别集合 */
function dialogueKeys(mod: CharacterMod): string[] {
  const bm = mod.dialogueConf?.bubbleMessages
  return bm ? Object.keys(bm).filter((k) => (bm as Record<string, unknown[]>)[k]?.length > 0) : []
}

/** 两数组交集 */
function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b)
  return a.filter((x) => setB.has(x))
}

/** pet_conf 中真正决定角色身份的关键字段（冲突即 error 级） */
const PET_CONF_IDENTITY_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'displayName', label: '角色名' },
  { key: 'spriteAsset', label: '立绘资源' },
  { key: 'personality', label: '性格' },
  { key: 'themeColor', label: '主题色' },
]

// ============ 冲突检测 ============

/**
 * 检测两个 Mod 之间的所有字段级冲突
 */
export function detectPairConflicts(a: ModConflictInput, b: ModConflictInput): ModConflict[] {
  const conflicts: ModConflict[] = []
  const targetA = a.modData.petConf.id
  const targetB = b.modData.petConf.id

  // 1) pet_conf 字段冲突：两个 Mod 定义了同一个角色 id
  if (targetA && targetA === targetB) {
    const differingFields = PET_CONF_IDENTITY_FIELDS.filter(({ key }) => {
      const va = (a.modData.petConf as unknown as Record<string, unknown>)[key]
      const vb = (b.modData.petConf as unknown as Record<string, unknown>)[key]
      return JSON.stringify(va) !== JSON.stringify(vb)
    })
    // 只要同角色就报 error（身份级冲突，只能保留一个）
    conflicts.push({
      type: 'pet_conf_field',
      severity: 'error',
      modAId: a.id,
      modBId: b.id,
      targetCharacterId: targetA,
      field: differingFields.length > 0 ? differingFields.map((f) => f.key).join(',') : 'id',
      detail:
        `两个 Mod 定义了同一角色 "${targetA}"` +
        (differingFields.length > 0
          ? `，且在 ${differingFields.map((f) => f.label).join('、')} 上取值不同`
          : '，只能启用其中一个'),
    })

    // 同角色下的对话类别冲突（warning，可按加载顺序覆盖）
    const dialogueClash = intersect(dialogueKeys(a.modData), dialogueKeys(b.modData))
    for (const key of dialogueClash) {
      conflicts.push({
        type: 'dialogue_id',
        severity: 'warning',
        modAId: a.id,
        modBId: b.id,
        targetCharacterId: targetA,
        field: `bubble:${key}`,
        detail: `两个 Mod 都改写了 "${key}" 类气泡对话，后加载者覆盖先加载者`,
      })
    }
  }

  // 2) 动画名冲突（跨角色也报：同名动画 id 会在渲染层串台）
  const animClash = intersect(animationIds(a.modData), animationIds(b.modData))
  for (const id of animClash) {
    conflicts.push({
      type: 'animation_name',
      severity: 'warning',
      modAId: a.id,
      modBId: b.id,
      targetCharacterId: targetA,
      field: `animation:${id}`,
      detail: `动画 "${id}" 在两个 Mod 中均被定义，后加载者的动画配置覆盖先加载者`,
    })
  }

  // 3) 物品 ID 冲突
  const itemClash = intersect(itemIds(a.modData), itemIds(b.modData))
  for (const id of itemClash) {
    conflicts.push({
      type: 'item_id',
      severity: 'warning',
      modAId: a.id,
      modBId: b.id,
      targetCharacterId: targetA,
      field: `item:${id}`,
      detail: `物品 ID "${id}" 在两个 Mod 中均被定义，后加载者覆盖先加载者`,
    })
  }

  return conflicts
}

/**
 * 批量检测一组 Mod 之间的全部冲突（两两配对）
 */
export function detectModConflicts(mods: ModConflictInput[]): ModConflict[] {
  const all: ModConflict[] = []
  for (let i = 0; i < mods.length; i++) {
    for (let j = i + 1; j < mods.length; j++) {
      all.push(...detectPairConflicts(mods[i], mods[j]))
    }
  }
  return all
}

// ============ 解析建议 ============

/**
 * 按策略给出冲突处置建议
 *
 * - keep_a：保留 Mod A，禁用 Mod B
 * - keep_b：保留 Mod B，禁用 Mod A
 * - merge：可合并类冲突（动画/物品/对话）尝试合并；身份级冲突不可合并
 * - manual：交由用户手动决定
 */
export function resolveConflict(
  conflict: ModConflict,
  strategy: ConflictStrategy,
): ConflictResolution {
  const mergeable = conflict.type !== 'pet_conf_field'

  if (strategy === 'keep_a') {
    return {
      strategy,
      winnerModId: conflict.modAId,
      message: `保留 Mod "${conflict.modAId}"，禁用 Mod "${conflict.modBId}"（${conflict.field} 取 A 方定义）`,
    }
  }
  if (strategy === 'keep_b') {
    return {
      strategy,
      winnerModId: conflict.modBId,
      message: `保留 Mod "${conflict.modBId}"，禁用 Mod "${conflict.modAId}"（${conflict.field} 取 B 方定义）`,
    }
  }
  if (strategy === 'merge') {
    if (!mergeable) {
      return {
        strategy: 'manual',
        winnerModId: null,
        message:
          `身份级冲突（${conflict.field}）不可合并：两个 Mod 定义了同一角色，` +
          `必须二选一（建议 keep_a 或 keep_b）`,
      }
    }
    return {
      strategy,
      winnerModId: null,
      message:
        `可合并：将 "${conflict.field}" 按并集合并（A 方优先，B 方补缺），` +
        `双方均保持启用`,
    }
  }
  // manual
  return {
    strategy: 'manual',
    winnerModId: null,
    message: `冲突需手动决策：${conflict.detail}`,
  }
}

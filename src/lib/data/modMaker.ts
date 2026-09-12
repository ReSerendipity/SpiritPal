/**
 * ModMaker 可视化编辑器 — 纯逻辑模块（无 UI 依赖，便于单测）
 *
 * @fileoverview 将「可视化表单状态」与 .petmod 包所需的
 * PetmodManifest / CharacterMod 结构互相转换。
 *
 * 主要模块：
 * - EditorState：编辑器扁平表单状态
 * - createEmptyEditorState()：基于 createModTemplate() 的空白草稿
 * - buildManifest() / buildCharacterMod()：表单状态 → 包结构
 * - validateEditorState()：导出前校验（id / SemVer / 必填项）
 *
 * 设计约束：
 * - 动画行严格对齐 ActConfJSON.animations 的 AnimationDef 字段
 *   （state / baseProb / tier / minAffectionLevel / inPlaylist），
 *   帧数与帧间隔属于精灵图排布，不在本数据模型中。
 */

import {
  createModTemplate,
  isValidSemVer,
  type ActConfJSON,
  type CharacterMod,
  type DialogueConfJSON,
  type ItemsConfJSON,
  type PetConfJSON,
  type PetmodManifest,
} from './modManager'
import type { Personality, PetState } from './types'

// ============ 编辑器表单状态 ============

/** 动画行（对应 AnimationDef） */
export interface AnimationRowState {
  state: PetState
  baseProb: number
  /** 活力档位 0-3 */
  tier: number
  minAffectionLevel: number
  inPlaylist: boolean
}

/** 锚点行（对应 actConf.anchors 的单条记录） */
export interface AnchorRowState {
  key: string
  anchorX: number
  anchorY: number
  loop: boolean
  next: string
}

/** 键值对行（表情→动作映射 motionMap 用） */
export interface PairRowState {
  key: string
  value: string
}

/** 物品类型（与 ItemsConfJSON 条目保持一致） */
type ConfItemType = ItemsConfJSON['foods'][number]['type']

/** 物品行（对应 Omit<InventoryItem, 'count'>） */
export interface ItemRowState {
  id: string
  name: string
  icon: string
  type: ConfItemType
  price: number
}

/** 对话对（few-shot 示例） */
export interface DialogueTurnState {
  user: string
  assistant: string
}

/** 气泡消息的六个触发键 */
export type BubbleKey = keyof DialogueConfJSON['bubbleMessages']

export const BUBBLE_KEYS: readonly BubbleKey[] = [
  'idle',
  'hungry',
  'sad',
  'pet',
  'feed',
  'pomodoroDone',
] as const

/** PetState 可选项（供下拉选择） */
export const PET_STATE_OPTIONS: readonly PetState[] = [
  'idle',
  'walk',
  'sit',
  'happy',
  'sad',
  'sick',
  'sleep',
  'pet',
  'eat',
  'drag',
  'hide',
  'climbing',
  'peeking',
  'hiding_wall',
] as const

/** 精灵图类型可选项 */
export const SPRITE_TYPE_OPTIONS: readonly PetConfJSON['spriteType'][] = [
  'atlas',
  'svg',
  'gif',
  'video',
] as const

/**
 * 编辑器扁平表单状态
 *
 * 设计说明：classicQuotes / favoriteItems / dislikeItems 在 UI 中以
 * 多行文本编辑（每行一条），故此处存储为 text，构建时再 split。
 */
export interface EditorState {
  // ---- petmod.json 清单字段 ----
  id: string
  version: string
  author: string
  description: string
  // ---- pet_conf.json 基础属性 ----
  name: string
  displayName: string
  source: string
  birthBackground: string
  emotionalCore: string
  personality: Personality
  signaturePhrase: string
  classicQuotesText: string
  themeColorPrimary: string
  themeColorSecondary: string
  favoriteItemsText: string
  dislikeItemsText: string
  spriteAsset: string
  spriteType: PetConfJSON['spriteType']
  activeStart: number
  activeEnd: number
  // ---- act_conf.json ----
  animations: AnimationRowState[]
  anchors: AnchorRowState[]
  motionMap: PairRowState[]
  // ---- items_config.json ----
  foods: ItemRowState[]
  toys: ItemRowState[]
  medicines: ItemRowState[]
  // ---- dialogue.json ----
  systemPrompt: string
  fewShotExamples: DialogueTurnState[]
  bubbleMessages: Record<BubbleKey, string[]>
}

// ============ 空白草稿 ============

/** 把多行文本按行切分（去空行） */
function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** 把字符串数组合并为多行文本 */
function joinLines(items: readonly string[]): string {
  return items.join('\n')
}

/**
 * 基于 createModTemplate() 生成空白编辑器状态
 *
 * hpTiers 直接复用模板默认值（编辑器不暴露档位阈值编辑），
 * 保证导出结构与既有 .petmod 加载路径完全兼容。
 */
export function createEmptyEditorState(): EditorState {
  const tpl = createModTemplate()
  const { petConf, actConf, itemsConf, dialogueConf } = tpl

  const anchorRows: AnchorRowState[] = Object.entries(actConf?.anchors ?? {}).map(
    ([key, value]) => ({
      key,
      anchorX: value.anchorX,
      anchorY: value.anchorY,
      loop: value.loop,
      next: value.next ?? '',
    }),
  )

  return {
    // 清单
    id: petConf.id,
    version: '0.1.0',
    author: '',
    description: '',
    // 基础属性
    name: petConf.name,
    displayName: petConf.displayName,
    source: petConf.source,
    birthBackground: petConf.birthBackground,
    emotionalCore: petConf.emotionalCore,
    personality: { ...petConf.personality },
    signaturePhrase: petConf.signaturePhrase,
    classicQuotesText: joinLines(petConf.classicQuotes),
    themeColorPrimary: petConf.themeColor.primary,
    themeColorSecondary: petConf.themeColor.secondary,
    favoriteItemsText: joinLines(petConf.favoriteItems),
    dislikeItemsText: joinLines(petConf.dislikeItems),
    spriteAsset: petConf.spriteAsset,
    spriteType: petConf.spriteType,
    activeStart: petConf.activeHours.start,
    activeEnd: petConf.activeHours.end,
    // 动画
    animations: (actConf?.animations ?? []).map((a) => ({
      state: a.state,
      baseProb: a.baseProb,
      tier: a.tier,
      minAffectionLevel: a.minAffectionLevel,
      inPlaylist: a.inPlaylist,
    })),
    anchors: anchorRows,
    motionMap: Object.entries(actConf?.motionMap ?? {}).map(([k, v]) => ({ key: k, value: v })),
    // 物品
    foods: itemsConf?.foods.map(itemToRow) ?? [],
    toys: itemsConf?.toys.map(itemToRow) ?? [],
    medicines: itemsConf?.medicines.map(itemToRow) ?? [],
    // 对话
    systemPrompt: dialogueConf.systemPrompt,
    fewShotExamples: dialogueConf.fewShotExamples.map((ex) => ({ ...ex })),
    bubbleMessages: { ...dialogueConf.bubbleMessages },
  }
}

/** 物品配置行 → 编辑器行 */
function itemToRow(item: ItemsConfJSON['foods'][number]): ItemRowState {
  return {
    id: item.id,
    name: item.name,
    icon: item.icon,
    type: item.type,
    price: item.price,
  }
}

// ============ 构建包结构 ============

/** 构建 petmod.json 清单 */
export function buildManifest(state: EditorState): PetmodManifest {
  return {
    id: state.id,
    name: state.displayName,
    version: state.version,
    author: state.author,
    description: state.description,
    dependencies: [],
    permissions: [],
    keywords: [],
  }
}

/** 把编辑器物品行转回 ItemsConfJSON 条目（不含 count） */
function rowToItem(row: ItemRowState): ItemsConfJSON['foods'][number] {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    type: row.type,
    price: row.price,
  }
}

/** 构建完整 CharacterMod */
export function buildCharacterMod(state: EditorState): CharacterMod {
  const petConf: PetConfJSON = {
    id: state.id,
    name: state.name,
    displayName: state.displayName,
    source: state.source,
    birthBackground: state.birthBackground,
    emotionalCore: state.emotionalCore,
    personality: { ...state.personality },
    signaturePhrase: state.signaturePhrase,
    classicQuotes: splitLines(state.classicQuotesText),
    themeColor: { primary: state.themeColorPrimary, secondary: state.themeColorSecondary },
    favoriteItems: splitLines(state.favoriteItemsText),
    dislikeItems: splitLines(state.dislikeItemsText),
    spriteAsset: state.spriteAsset,
    spriteType: state.spriteType,
    activeHours: { start: state.activeStart, end: state.activeEnd },
  }

  const templateHpTiers = createModTemplate().actConf?.hpTiers
  const actConf: ActConfJSON = {
    animations: state.animations.map((row) => ({
      state: row.state,
      baseProb: row.baseProb,
      tier: Math.max(0, Math.min(3, Math.round(row.tier))) as ActConfJSON['animations'][number]['tier'],
      minAffectionLevel: Math.max(0, Math.round(row.minAffectionLevel)),
      inPlaylist: row.inPlaylist,
    })),
    hpTiers: templateHpTiers as ActConfJSON['hpTiers'],
    anchors: Object.fromEntries(
      state.anchors
        .filter((row) => row.key.trim().length > 0)
        .map((row) => [
          row.key.trim(),
          {
            anchorX: row.anchorX,
            anchorY: row.anchorY,
            loop: row.loop,
            ...(row.next.trim() ? { next: row.next.trim() } : {}),
          },
        ]),
    ),
    motionMap: Object.fromEntries(
      state.motionMap
        .filter((row) => row.key.trim().length > 0)
        .map((row) => [row.key.trim(), row.value]),
    ),
  }

  const itemsConf: ItemsConfJSON = {
    foods: state.foods.map(rowToItem),
    toys: state.toys.map(rowToItem),
    medicines: state.medicines.map(rowToItem),
  }

  const dialogueConf: DialogueConfJSON = {
    systemPrompt: state.systemPrompt,
    fewShotExamples: state.fewShotExamples
      .filter((turn) => turn.user.trim().length > 0 || turn.assistant.trim().length > 0)
      .map((turn) => ({ user: turn.user, assistant: turn.assistant })),
    bubbleMessages: { ...state.bubbleMessages },
  }

  return { petConf, actConf, itemsConf, dialogueConf }
}

// ============ 导出前校验 ============

/**
 * 校验编辑器状态是否可导出
 * @returns 错误信息列表（空数组表示通过）
 */
export function validateEditorState(state: EditorState): string[] {
  const errors: string[] = []

  if (!state.id || !/^[a-z0-9][a-z0-9-]*$/.test(state.id)) {
    errors.push('Mod ID 必须为 kebab-case（小写字母/数字/连字符，如 my-pet）')
  }
  if (!isValidSemVer(state.version)) {
    errors.push(`版本号 "${state.version}" 不符合 SemVer 格式（如 1.0.0）`)
  }
  if (!state.author.trim()) {
    errors.push('作者不能为空')
  }
  if (!state.displayName.trim()) {
    errors.push('角色名不能为空')
  }
  if (!state.name.trim()) {
    errors.push('内部名称不能为空')
  }

  return errors
}

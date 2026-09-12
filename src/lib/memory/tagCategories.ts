/**
 * 记忆标签维度分类系统
 *
 * 每个标签可归属一个语义维度：人物 / 地点 / 事件 / 物品 / 概念。
 *
 * 存储约定：标签字符串采用 `dimension:value` 前缀（如 `person:妈妈`、`place:公司`）。
 * 不带前缀的历史标签视为「未归类」——仍正常展示，但在启用维度筛选时不命中任何维度。
 *
 * @fileoverview
 * - TagDimension: 维度联合类型
 * - TAG_DIMENSIONS / TAG_DIMENSION_LABEL_MAP: 维度元数据
 * - makeTag / parseTag / getTagDimension / getTagValue: 标签编解码辅助
 * - memoryMatchesDimensions: 维度筛选判定（供 MemorySearchOptions.tagDimensions 使用）
 * - MEMORY_CATEGORIES: 记忆五分类（偏好/习惯/关系/事件/情感）下拉选项
 */

// ============ 维度类型 ============

/** 标签语义维度 */
export type TagDimension = 'person' | 'place' | 'event' | 'item' | 'concept'

/** 维度分隔符：`person:妈妈` */
export const TAG_DIMENSION_SEPARATOR = ':'

/** 维度中文标签 */
export const TAG_DIMENSION_LABEL_MAP: Record<TagDimension, string> = {
  person: '人物',
  place: '地点',
  event: '事件',
  item: '物品',
  concept: '概念',
}

/** 维度元数据列表（供 Checkbox 组 / 下拉渲染） */
export interface TagDimensionMeta {
  value: TagDimension
  label: string
}

export const TAG_DIMENSIONS: TagDimensionMeta[] = (
  Object.keys(TAG_DIMENSION_LABEL_MAP) as TagDimension[]
).map((value) => ({ value, label: TAG_DIMENSION_LABEL_MAP[value] }))

/** 记忆五分类（与 EnhancedMemory.category 语义对应） */
export const MEMORY_CATEGORIES = [
  { value: '偏好', label: '偏好' },
  { value: '习惯', label: '习惯' },
  { value: '关系', label: '关系' },
  { value: '事件', label: '事件' },
  { value: '情感', label: '情感' },
] as const

// ============ 标签编解码 ============

/**
 * 由维度 + 纯文本构造带前缀标签
 * @param dimension 维度
 * @param value 标签纯文本（会 trim；为空串返回空串）
 */
export function makeTag(dimension: TagDimension, value: string): string {
  const v = value.trim()
  return v ? `${dimension}${TAG_DIMENSION_SEPARATOR}${v}` : ''
}

/**
 * 解析标签所属维度
 * - `person:妈妈` → 'person'
 * - `天气` / `time:每天8点`（未知前缀）→ null
 */
export function getTagDimension(tag: string): TagDimension | null {
  const idx = tag.indexOf(TAG_DIMENSION_SEPARATOR)
  if (idx <= 0) return null
  const maybe = tag.slice(0, idx)
  return Object.prototype.hasOwnProperty.call(TAG_DIMENSION_LABEL_MAP, maybe)
    ? (maybe as TagDimension)
    : null
}

/**
 * 提取标签纯文本（去掉维度前缀）
 * - `person:妈妈` → `妈妈`
 * - `天气` → `天气`
 */
export function getTagValue(tag: string): string {
  const dim = getTagDimension(tag)
  return dim ? tag.slice(dim.length + TAG_DIMENSION_SEPARATOR.length) : tag
}

/** 解析标签为 { 维度, 纯文本 } */
export function parseTag(tag: string): { dimension: TagDimension | null; value: string } {
  return { dimension: getTagDimension(tag), value: getTagValue(tag) }
}

// ============ 维度筛选判定 ============

/**
 * 判断一组标签是否至少命中任一选中维度
 *
 * AND/OR 语义（供多维组合筛选）：
 * - selected 为空 → 不启用维度筛选，恒为 true
 * - selected 非空 → 记忆的 tags 中至少有一个标签的维度 ∈ selected（组内 OR）
 *
 * 与分类筛选、时间筛选在 MemoryEditor.searchMemories 中再做跨组 AND。
 */
export function memoryMatchesDimensions(tags: string[], selected: TagDimension[]): boolean {
  if (selected.length === 0) return true
  return tags.some((t) => {
    const dim = getTagDimension(t)
    return dim !== null && selected.includes(dim)
  })
}

/** 切换数组中的布尔成员（多选 checkbox 通用） */
export function toggleInArray<T>(arr: readonly T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
}

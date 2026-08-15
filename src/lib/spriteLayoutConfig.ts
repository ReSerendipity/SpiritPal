/**
 * @file spriteLayoutConfig.ts
 * @description 精灵图布局配置模块 — 标准/扩展布局定义与序列化
 *
 * 核心功能：
 * - 定义标准 9 行精灵图布局（idle/walk/eat/sleep/pet/happy/sad/sick/special）
 * - 定义扩展 15 行布局（标准 9 行 + 6 行编码反应动画）
 * - 提供布局查询辅助函数（按名称/行号查找）
 * - 支持 JSON 序列化/反序列化与版本兼容性校验
 *
 * 标准 9 行映射：0=idle, 1=walk, 2=eat, 3=sleep, 4=pet, 5=happy, 6=sad, 7=sick, 8=special
 * 扩展行 9-14：coding_thinking/editing/testing/success/error/celebrating
 *
 * 主要模块：
 * - SpriteRowConfig: 单行动画配置接口
 * - SpriteLayoutConfig: 完整布局配置接口
 * - STANDARD_SPRITE_LAYOUT: 标准 9 行布局
 * - EXTENDED_SPRITE_LAYOUT: 扩展 15 行布局
 * - ROW_NAME_TO_INDEX: 行名 → 行号映射表
 *
 * 依赖关系：
 * - ./types: ATLAS 常量（默认精灵图尺寸）
 *
 * 核心接口：
 * - getSpriteRowConfig(): 按名称获取行配置
 * - getFrameInterval(): 计算帧时间间隔
 * - getRowDuration(): 计算动画总时长
 * - parseSpriteLayoutConfig(): 从 JSON 解析布局
 * - serializeSpriteLayoutConfig(): 序列化为 JSON
 *
 * 参考：SpiritPal 的 8×9 spritesheet 格式（192×208 / 8 cols × 9 rows）
 */

import { ATLAS } from './types'

// ============ 精灵行配置 ============

/** 单行动画配置 */
export interface SpriteRowConfig {
  /** 行名称（如 idle, walk, eat） */
  name: string
  /** 行号（0-based） */
  row: number
  /** 该行帧数（≤ cols 为实际帧数，其余为空白帧） */
  frameMax: number
  /** 帧率（FPS） */
  fps: number
  /** 是否循环播放 */
  loop: boolean
  /** 下一行动画名称（播放结束后自动跳转，null 表示回到 idle） */
  nextRow?: string | null
}

/** 精灵图完整布局配置 */
export interface SpriteLayoutConfig {
  /** 布局版本号 */
  version: number
  /** 精灵图集参数 */
  atlas: {
    cellW: number
    cellH: number
    cols: number
    rows: number
  }
  /** 各行动画配置（按行号排列） */
  rows: SpriteRowConfig[]
}

// ============ 标准 9 行布局 ============

/**
 * 标准 9 行精灵图布局（SpiritPal 默认）
 * 行号映射：0=idle, 1=walk, 2=eat, 3=sleep, 4=pet, 5=happy, 6=sad, 7=sick, 8=special
 */
export const STANDARD_SPRITE_LAYOUT: SpriteLayoutConfig = {
  version: 1,
  atlas: {
    cellW: ATLAS.cellW,
    cellH: ATLAS.cellH,
    cols: ATLAS.cols,
    rows: ATLAS.rows,
  },
  rows: [
    { name: 'idle',   row: 0, frameMax: 6, fps: 8,  loop: true,  nextRow: null },
    { name: 'walk',   row: 1, frameMax: 8, fps: 10, loop: true,  nextRow: null },
    { name: 'eat',    row: 2, frameMax: 8, fps: 8,  loop: true,  nextRow: 'idle' },
    { name: 'sleep',  row: 3, frameMax: 4, fps: 4,  loop: true,  nextRow: null },
    { name: 'pet',    row: 4, frameMax: 5, fps: 8,  loop: false, nextRow: 'happy' },
    { name: 'happy',  row: 5, frameMax: 8, fps: 10, loop: false, nextRow: 'idle' },
    { name: 'sad',    row: 6, frameMax: 6, fps: 6,  loop: true,  nextRow: null },
    { name: 'sick',   row: 7, frameMax: 6, fps: 6,  loop: true,  nextRow: null },
    { name: 'special', row: 8, frameMax: 6, fps: 8,  loop: false, nextRow: 'idle' },
  ],
}

// ============ 扩展布局（含编码反应行）============

/**
 * 扩展 15 行精灵图布局（标准 9 行 + 6 行编码反应）
 * 行 9-14 用于编程陪伴模式的编码反应动画
 */
export const EXTENDED_SPRITE_LAYOUT: SpriteLayoutConfig = {
  version: 2,
  atlas: {
    cellW: ATLAS.cellW,
    cellH: ATLAS.cellH,
    cols: ATLAS.cols,
    rows: 15,
  },
  rows: [
    // 标准 9 行
    ...STANDARD_SPRITE_LAYOUT.rows,
    // 编码反应 6 行
    { name: 'coding_thinking',   row: 9,  frameMax: 6, fps: 6,  loop: true,  nextRow: null },
    { name: 'coding_editing',    row: 10, frameMax: 8, fps: 10, loop: true,  nextRow: null },
    { name: 'coding_testing',    row: 11, frameMax: 6, fps: 8,  loop: true,  nextRow: null },
    { name: 'coding_success',    row: 12, frameMax: 6, fps: 10, loop: false, nextRow: 'happy' },
    { name: 'coding_error',      row: 13, frameMax: 6, fps: 8,  loop: false, nextRow: 'sad' },
    { name: 'coding_celebrating', row: 14, frameMax: 8, fps: 10, loop: false, nextRow: 'happy' },
  ],
}

// ============ 布局查询辅助 ============

/** 行名称 → 行配置映射缓存 */
function buildRowMap(layout: SpriteLayoutConfig): Map<string, SpriteRowConfig> {
  const map = new Map<string, SpriteRowConfig>()
  for (const row of layout.rows) {
    map.set(row.name, row)
  }
  return map
}

/** 标准布局行映射 */
export const STANDARD_ROW_MAP: Map<string, SpriteRowConfig> = buildRowMap(STANDARD_SPRITE_LAYOUT)

/** 扩展布局行映射 */
export const EXTENDED_ROW_MAP: Map<string, SpriteRowConfig> = buildRowMap(EXTENDED_SPRITE_LAYOUT)

/**
 * 根据行名称获取行配置
 * 优先查找扩展布局，回退到标准布局
 */
export function getSpriteRowConfig(name: string): SpriteRowConfig | undefined {
  return EXTENDED_ROW_MAP.get(name) ?? STANDARD_ROW_MAP.get(name)
}

/**
 * 根据行号获取行配置
 */
export function getSpriteRowByIndex(layout: SpriteLayoutConfig, rowIndex: number): SpriteRowConfig | undefined {
  return layout.rows.find((r) => r.row === rowIndex)
}

/**
 * 计算指定行的帧时间间隔（毫秒）
 */
export function getFrameInterval(rowConfig: SpriteRowConfig): number {
  if (rowConfig.fps <= 0) return 1000 // 安全回退
  return 1000 / rowConfig.fps
}

/**
 * 计算指定行动画总时长（毫秒）
 */
export function getRowDuration(rowConfig: SpriteRowConfig): number {
  return getFrameInterval(rowConfig) * rowConfig.frameMax
}

/**
 * 从 JSON 解析 SpriteLayoutConfig
 * 支持版本兼容性校验
 */
export function parseSpriteLayoutConfig(json: unknown): SpriteLayoutConfig | null {
  try {
    const obj = json as Record<string, unknown>
    if (!obj || typeof obj !== 'object') return null

    const version = obj.version as number
    const atlas = obj.atlas as SpriteLayoutConfig['atlas']
    const rows = obj.rows as SpriteRowConfig[]

    if (!atlas || !Array.isArray(rows)) return null

    // 基础校验
    if (atlas.cellW <= 0 || atlas.cellH <= 0 || atlas.cols <= 0 || atlas.rows <= 0) {
      return null
    }

    // 行配置校验
    for (const row of rows) {
      if (row.row < 0 || row.frameMax <= 0 || row.fps <= 0) {
        return null
      }
      // frameMax 不应超过 cols
      if (row.frameMax > atlas.cols) {
        row.frameMax = atlas.cols
      }
    }

    return { version, atlas, rows }
  } catch {
    return null
  }
}

/**
 * 将 SpriteLayoutConfig 序列化为 JSON
 */
export function serializeSpriteLayoutConfig(config: SpriteLayoutConfig): string {
  return JSON.stringify(config, null, 2)
}

// ============ 行名称 → 行号映射 ============

/** 标准行名称映射（兼容旧 ANIMATION_ROWS） */
export const ROW_NAME_TO_INDEX: Record<string, number> = {
  idle: 0,
  walk: 1,
  eat: 2,
  sleep: 3,
  pet: 4,
  happy: 5,
  sad: 6,
  sick: 7,
  special: 8,
  // 编码反应扩展行
  coding_thinking: 9,
  coding_editing: 10,
  coding_testing: 11,
  coding_success: 12,
  coding_error: 13,
  coding_celebrating: 14,
}

/**
 * @file spriteLayout.ts
 * @description 精灵图布局模块 — 9 行精灵图 JSON 配置格式（支持每行可变帧数）
 *
 * 核心功能：
 * 1. 扩展 spriteLayout 字段，支持每行可变帧数（frameMax）
 * 2. 行级帧数配置（不是所有行都有 8 帧）
 * 3. 每个动画独立 FPS 配置
 * 4. 动画名 → 行映射 + 元数据
 * 5. 布局配置的验证和规范化
 * 6. 导出兼容 WindowPet 格式
 *
 * 主要模块：
 * - SpriteRowLayout: 单行动画布局描述接口
 * - SpriteLayoutConfig: 完整精灵图布局配置接口
 * - DEFAULT_SPRITE_LAYOUT: SpiritPal 标准 9 行布局
 * - validateSpriteLayout(): 布局验证
 * - normalizeSpriteLayout(): 布局规范化
 *
 * 依赖关系：
 * - ./types: ATLAS 常量（默认精灵图尺寸）
 *
 * 核心接口：
 * - validateSpriteLayout(): 验证布局配置
 * - normalizeSpriteLayout(): 规范化布局
 * - findRowByName()/findRowByNumber(): 查询行布局
 * - getSpriteLayout(): 获取角色布局（带缓存）
 *
 */

import { ATLAS } from './types'

// ============ 布局类型定义 ============

/** 单行动画布局描述 */
export interface SpriteRowLayout {
  /** 行号（0-indexed） */
  row: number
  /** 该行实际帧数（≤ cols） */
  frames: number
  /** 该行动画名称（如 idle, walk 等） */
  name: string
  /** 该行动画播放帧率（默认 10） */
  fps?: number
  /** 是否循环播放（默认 true） */
  loop?: boolean
  /** 下一行动画名（用于链式动画，如 jump → idle） */
  next?: string | null
}

/** 完整的精灵图布局配置 */
export interface SpriteLayoutConfig {
  /** 精灵图尺寸 */
  sheetSize: {
    /** 单帧宽度 */
    cellW: number
    /** 单帧高度 */
    cellH: number
    /** 最大列数 */
    cols: number
    /** 最大行数 */
    rows: number
  }
  /** 每行的布局描述 */
  rows: SpriteRowLayout[]
  /** 默认 FPS（行级 fps 为空时使用） */
  defaultFps: number
  /** 布局版本号（用于兼容性检测） */
  version: string
}

// ============ 默认布局（9 行精灵图）============

/** SpiritPal 标准 9 行精灵图布局 */
export const DEFAULT_SPRITE_LAYOUT: SpriteLayoutConfig = {
  sheetSize: {
    cellW: ATLAS.cellW,
    cellH: ATLAS.cellH,
    cols: ATLAS.cols,
    rows: ATLAS.rows,
  },
  defaultFps: 10,
  version: '1.0',
  rows: [
    { row: 0, frames: 6, name: 'idle', fps: 8, loop: true },
    { row: 1, frames: 8, name: 'walk', fps: 12, loop: true },
    { row: 2, frames: 8, name: 'run-left', fps: 14, loop: true },
    { row: 3, frames: 4, name: 'waving', fps: 8, loop: false, next: 'idle' },
    { row: 4, frames: 5, name: 'jumping', fps: 10, loop: false, next: 'idle' },
    { row: 5, frames: 8, name: 'failed', fps: 10, loop: true },
    { row: 6, frames: 6, name: 'waiting', fps: 6, loop: true },
    { row: 7, frames: 6, name: 'running', fps: 14, loop: true },
    { row: 8, frames: 6, name: 'review', fps: 8, loop: true },
  ],
}

// ============ 布局验证与规范化 ============

/** 布局验证结果 */
export interface LayoutValidationResult {
  /** 是否有效 */
  valid: boolean
  /** 错误信息列表 */
  errors: string[]
  /** 警告信息列表 */
  warnings: string[]
}

/**
 * 验证精灵图布局配置
 * 检查行号连续性、帧数范围、FPS 合理性等
 */
export function validateSpriteLayout(config: SpriteLayoutConfig): LayoutValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 检查基本尺寸
  if (config.sheetSize.cellW <= 0 || config.sheetSize.cellH <= 0) {
    errors.push('帧尺寸必须为正数')
  }
  if (config.sheetSize.cols <= 0 || config.sheetSize.rows <= 0) {
    errors.push('列数和行数必须为正数')
  }

  // 检查行数据
  const rowNumbers = new Set<number>()
  const nameMap = new Map<string, number>()

  for (const row of config.rows) {
    // 行号唯一性
    if (rowNumbers.has(row.row)) {
      errors.push(`行号 ${row.row} 重复`)
    }
    rowNumbers.add(row.row)

    // 名称唯一性
    if (nameMap.has(row.name)) {
      warnings.push(`动画名 "${row.name}" 在行 ${nameMap.get(row.name)} 和行 ${row.row} 中重复`)
    }
    nameMap.set(row.name, row.row)

    // 帧数范围检查
    if (row.frames <= 0) {
      errors.push(`行 ${row.row} (${row.name}) 帧数必须 > 0`)
    }
    if (row.frames > config.sheetSize.cols) {
      errors.push(`行 ${row.row} (${row.name}) 帧数 ${row.frames} 超过最大列数 ${config.sheetSize.cols}`)
    }

    // 行号范围检查
    if (row.row < 0 || row.row >= config.sheetSize.rows) {
      errors.push(`行号 ${row.row} 超出范围 [0, ${config.sheetSize.rows - 1}]`)
    }

    // FPS 检查
    const fps = row.fps ?? config.defaultFps
    if (fps <= 0) {
      errors.push(`行 ${row.row} (${row.name}) FPS 必须 > 0`)
    } else if (fps > 60) {
      warnings.push(`行 ${row.row} (${row.name}) FPS=${fps} 过高，可能造成性能问题`)
    }

    // next 引用检查
    if (row.next !== undefined && row.next !== null && row.loop === true) {
      warnings.push(`行 ${row.row} (${row.name}) 设置了 loop=true 但也指定了 next="${row.next}"，next 会被忽略`)
    }
  }

  // 检查 next 引用的有效性
  for (const row of config.rows) {
    if (row.next && !nameMap.has(row.next)) {
      errors.push(`行 ${row.row} (${row.name}) 的 next="${row.next}" 引用了不存在的动画`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * 规范化精灵图布局配置
 * 填充默认值，确保数据完整性
 */
export function normalizeSpriteLayout(config: Partial<SpriteLayoutConfig>): SpriteLayoutConfig {
  const sheetSize = config.sheetSize ?? {
    cellW: ATLAS.cellW,
    cellH: ATLAS.cellH,
    cols: ATLAS.cols,
    rows: ATLAS.rows,
  }

  return {
    sheetSize,
    defaultFps: config.defaultFps ?? 10,
    version: config.version ?? '1.0',
    rows: (config.rows ?? []).map((row, i) => ({
      row: row.row ?? i,
      frames: row.frames ?? sheetSize.cols,
      name: row.name ?? `row_${i}`,
      fps: row.fps,
      loop: row.loop ?? true,
      next: row.next,
    })),
  }
}

// ============ 查询辅助 ============

/**
 * 根据动画名查找行布局
 */
export function findRowByName(config: SpriteLayoutConfig, name: string): SpriteRowLayout | undefined {
  return config.rows.find((r) => r.name === name)
}

/**
 * 根据行号查找行布局
 */
export function findRowByNumber(config: SpriteLayoutConfig, row: number): SpriteRowLayout | undefined {
  return config.rows.find((r) => r.row === row)
}

/**
 * 计算指定行中某帧在精灵图中的 (x, y) 像素偏移
 */
export function getFramePixelOffset(
  config: SpriteLayoutConfig,
  row: number,
  frame: number,
): { x: number; y: number } {
  return {
    x: frame * config.sheetSize.cellW,
    y: row * config.sheetSize.cellH,
  }
}

/**
 * 导出布局为兼容 WindowPet 的 JSON 格式
 */
export function exportToWindowPetFormat(config: SpriteLayoutConfig): object {
  return {
    format: 'windowpet-sprite-layout',
    version: config.version,
    cellWidth: config.sheetSize.cellW,
    cellHeight: config.sheetSize.cellH,
    columns: config.sheetSize.cols,
    maxRows: config.sheetSize.rows,
    defaultFps: config.defaultFps,
    animations: Object.fromEntries(
      config.rows.map((r) => [
        r.name,
        {
          row: r.row,
          frames: r.frames,
          fps: r.fps ?? config.defaultFps,
          loop: r.loop ?? true,
          next: r.next ?? null,
        },
      ]),
    ),
  }
}

// ============ 单例缓存 ============

const layoutCache = new Map<string, SpriteLayoutConfig>()

/**
 * 获取指定角色的精灵图布局
 * 优先使用角色自定义布局，否则使用默认布局
 */
export function getSpriteLayout(characterAtlasLayout?: {
  cellW: number
  cellH: number
  cols: number
  rows: number
}): SpriteLayoutConfig {
  const key = characterAtlasLayout
    ? `${characterAtlasLayout.cellW}x${characterAtlasLayout.cellH}`
    : 'default'

  const cached = layoutCache.get(key)
  if (cached) return cached

  if (characterAtlasLayout) {
    // 为自定义布局生成配置（使用默认行数据但调整尺寸）
    const layout = normalizeSpriteLayout({
      sheetSize: characterAtlasLayout,
      rows: DEFAULT_SPRITE_LAYOUT.rows.map((r) => ({
        ...r,
        frames: Math.min(r.frames, characterAtlasLayout.cols),
      })),
    })
    layoutCache.set(key, layout)
    return layout
  }

  layoutCache.set('default', DEFAULT_SPRITE_LAYOUT)
  return DEFAULT_SPRITE_LAYOUT
}

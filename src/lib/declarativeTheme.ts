/**
 * JSON 声明式主题配置 — 通过 JSON 配置文件定义宠物外观、动画和交互行为
 * 参考 clawd-on-desk 主题设计
 *
 * @fileoverview
 * 主要模块：
 * - ViewBoxConfig 接口：视口配置（宽高、缩放范围）
 * - StateConfig 接口：动画状态配置（帧范围、循环、帧率、动画链）
 * - EyeTrackingConfig 接口：眼球追踪配置（开关、眼球帧、范围、灵敏度）
 * - TimingConfig 接口：时序配置（眨眼间隔、动画间隔）
 * - HitBoxConfig 接口：点击区域配置
 * - ReactionConfig 接口：反应配置
 * - DeclarativeTheme 接口：完整主题配置结构
 * - loadTheme()/validateTheme()/applyTheme()：主题加载/校验/应用
 *
 * 核心功能：
 * 1. viewBox/states/eyeTracking/timings/hitBoxes/reactions 配置
 * 2. 主题 JSON schema 校验
 * 3. 自动应用主题到 SpriteRenderer/Live2DRenderer
 *
 * @module declarativeTheme
 * @requires ./types - PetState 类型定义
 */

import type { PetState } from './types'

// ============ 主题配置类型 ============

/** 视口配置 */
export interface ViewBoxConfig {
  width: number
  height: number
  /** 最小缩放 */
  minScale?: number
  /** 最大缩放 */
  maxScale?: number
}

/** 动画状态配置 */
export interface StateConfig {
  /** 状态名称 */
  name: PetState
  /** 精灵图帧索引范围 */
  frames: number[]
  /** 是否循环 */
  loop: boolean
  /** 帧率 */
  fps?: number
  /** 下一个状态（动画链） */
  next?: PetState
  /** 状态切换时的缩放 */
  scale?: number
  /** 状态切换时的偏移 */
  offset?: { x: number; y: number }
}

/** 眼球追踪配置 */
export interface EyeTrackingConfig {
  /** 是否启用眼球追踪 */
  enabled: boolean
  /** 眼球精灵图帧 */
  eyeFrames: { left: number; right: number }
  /** 追踪范围（像素偏移上限） */
  range: number
  /** 追踪灵敏度 (0-1) */
  sensitivity: number
  /** 延迟响应时间（毫秒） */
  delay: number
}

/** 动画时间配置 */
export interface TimingConfig {
  /** 状态切换淡入时间（毫秒） */
  fadeInMs: number
  /** 状态切换淡出时间（毫秒） */
  fadeOutMs: number
  /** 气泡出现延迟（毫秒） */
  bubbleDelayMs: number
  /** 反应动画持续时间（毫秒） */
  reactionDurationMs: number
  /** 空闲状态自动切换最小间隔（毫秒） */
  idleSwitchMinMs: number
  /** 空闲状态自动切换最大间隔（毫秒） */
  idleSwitchMaxMs: number
}

/** 点击区域配置 */
export interface HitBoxConfig {
  /** 区域名称 */
  name: string
  /** 矩形区域 (x, y, width, height) */
  rect: { x: number; y: number; width: number; height: number }
  /** 点击触发的状态/反应 */
  reaction: string
  /** 光标样式 */
  cursor?: 'pointer' | 'grab' | 'default'
}

/** 交互反应配置 */
export interface ReactionConfig {
  /** 反应名称 */
  name: string
  /** 触发条件 */
  trigger: 'click' | 'hover' | 'drag' | 'doubleClick'
  /** 目标区域（hitBox 名称） */
  target?: string
  /** 触发的动画状态 */
  animation: PetState
  /** 触发的气泡消息（i18n key） */
  bubbleKey?: string
  /** 触发的音效 */
  sound?: string
  /** 冷却时间（毫秒） */
  cooldown?: number
}

/** 主题配色 */
export interface ThemeColors {
  /** 主色 */
  primary: string
  /** 辅色 */
  secondary: string
  /** 背景色 */
  background: string
  /** 文字色 */
  text: string
  /** 强调色 */
  accent: string
  /** 成功色 */
  success: string
  /** 警告色 */
  warning: string
  /** 错误色 */
  error: string
}

/** 完整的声明式主题配置 */
export interface DeclarativeTheme {
  /** 主题 ID */
  id: string
  /** 主题名称 */
  name: string
  /** 主题版本 */
  version: string
  /** 主题描述 */
  description?: string
  /** 作者 */
  author?: string
  /** 视口配置 */
  viewBox: ViewBoxConfig
  /** 动画状态列表 */
  states: StateConfig[]
  /** 眼球追踪配置 */
  eyeTracking?: EyeTrackingConfig
  /** 动画时间配置 */
  timings: TimingConfig
  /** 点击区域列表 */
  hitBoxes: HitBoxConfig[]
  /** 交互反应列表 */
  reactions: ReactionConfig[]
  /** 主题配色 */
  colors: ThemeColors
  /** 自定义 CSS 变量 */
  cssVars?: Record<string, string>
  /** 精灵图资源路径 */
  spriteAsset: string
  /** 精灵图类型 */
  spriteType: 'atlas' | 'svg' | 'gif' | 'live2d'
}

/** 主题校验结果 */
export interface ThemeValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// ============ 默认主题配置 ============

export const DEFAULT_THEME: DeclarativeTheme = {
  id: 'default',
  name: '默认主题',
  version: '1.0.0',
  viewBox: { width: 300, height: 400, minScale: 0.5, maxScale: 2.0 },
  states: [
    { name: 'idle',  frames: [0, 1, 2, 3], loop: true,  fps: 8, next: undefined },
    { name: 'walk',  frames: [4, 5, 6, 7], loop: true,  fps: 10, next: 'idle' },
    { name: 'sit',   frames: [8, 9],       loop: true,  fps: 6,  next: 'idle' },
    { name: 'sleep', frames: [10, 11],     loop: true,  fps: 4 },
    { name: 'happy', frames: [12, 13, 14], loop: false, fps: 12, next: 'idle' },
    { name: 'sad',   frames: [15, 16],     loop: true,  fps: 6,  next: 'idle' },
    { name: 'sick',  frames: [17, 18],     loop: true,  fps: 4 },
    { name: 'eat',   frames: [19, 20, 21], loop: false, fps: 10, next: 'idle' },
    { name: 'pet',   frames: [22, 23],     loop: false, fps: 8,  next: 'happy' },
    { name: 'drag',  frames: [24, 25],     loop: true,  fps: 10 },
  ],
  eyeTracking: {
    enabled: true,
    eyeFrames: { left: 26, right: 27 },
    range: 5,
    sensitivity: 0.8,
    delay: 50,
  },
  timings: {
    fadeInMs: 200,
    fadeOutMs: 200,
    bubbleDelayMs: 500,
    reactionDurationMs: 1500,
    idleSwitchMinMs: 3000,
    idleSwitchMaxMs: 8000,
  },
  hitBoxes: [
    { name: 'head',  rect: { x: 100, y: 50, width: 100, height: 80 },  reaction: 'pet', cursor: 'pointer' },
    { name: 'body',  rect: { x: 80, y: 130, width: 140, height: 150 }, reaction: 'touch', cursor: 'grab' },
  ],
  reactions: [
    { name: 'pet',    trigger: 'click',  target: 'head',  animation: 'pet',   bubbleKey: 'pet.pet', cooldown: 1000 },
    { name: 'touch',  trigger: 'click',  target: 'body',  animation: 'happy', bubbleKey: 'pet.happy', cooldown: 500 },
    { name: 'drag',   trigger: 'drag',   animation: 'drag' },
  ],
  colors: {
    primary: '#FFB6C1',
    secondary: '#A777E3',
    background: 'transparent',
    text: '#333333',
    accent: '#FF6B6B',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
  },
  spriteAsset: '/pets/doro/spritesheet.webp',
  spriteType: 'atlas',
}

// ============ 主题校验 ============

/**
 * 校验声明式主题配置
 */
export function validateDeclarativeTheme(theme: unknown): ThemeValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!theme || typeof theme !== 'object') {
    return { valid: false, errors: ['主题配置不是有效对象'], warnings }
  }

  const t = theme as Record<string, unknown>

  // 必需字段
  if (!t.id || typeof t.id !== 'string') errors.push('id 字段缺失或类型错误')
  if (!t.name || typeof t.name !== 'string') errors.push('name 字段缺失或类型错误')
  if (!t.version || typeof t.version !== 'string') errors.push('version 字段缺失或类型错误')

  // viewBox
  if (!t.viewBox || typeof t.viewBox !== 'object') {
    errors.push('viewBox 配置缺失')
  } else {
    const vb = t.viewBox as Record<string, unknown>
    if (typeof vb.width !== 'number' || vb.width <= 0) errors.push('viewBox.width 必须为正数')
    if (typeof vb.height !== 'number' || vb.height <= 0) errors.push('viewBox.height 必须为正数')
  }

  // states
  if (!Array.isArray(t.states) || t.states.length === 0) {
    errors.push('states 必须为非空数组')
  }

  // timings
  if (!t.timings || typeof t.timings !== 'object') {
    warnings.push('timings 配置缺失，将使用默认值')
  }

  // hitBoxes
  if (!Array.isArray(t.hitBoxes)) {
    warnings.push('hitBoxes 配置缺失')
  }

  // reactions
  if (!Array.isArray(t.reactions)) {
    warnings.push('reactions 配置缺失')
  }

  // colors
  if (!t.colors || typeof t.colors !== 'object') {
    warnings.push('colors 配置缺失，将使用默认配色')
  }

  // spriteAsset
  if (!t.spriteAsset || typeof t.spriteAsset !== 'string') {
    errors.push('spriteAsset 字段缺失或类型错误')
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ============ CSS 变量应用 ============

/**
 * 将主题配色应用为 CSS 变量
 */
export function applyThemeCSSVars(theme: DeclarativeTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  // 应用主题配色
  const colorMap: Record<string, string> = {
    '--color-primary': theme.colors.primary,
    '--color-secondary': theme.colors.secondary,
    '--color-background': theme.colors.background,
    '--color-text': theme.colors.text,
    '--color-accent': theme.colors.accent,
    '--color-success': theme.colors.success,
    '--color-warning': theme.colors.warning,
    '--color-error': theme.colors.error,
  }

  for (const [key, value] of Object.entries(colorMap)) {
    root.style.setProperty(key, value)
  }

  // 应用自定义 CSS 变量
  if (theme.cssVars) {
    for (const [key, value] of Object.entries(theme.cssVars)) {
      root.style.setProperty(key, value)
    }
  }
}

/**
 * 移除主题 CSS 变量
 */
export function removeThemeCSSVars(theme: DeclarativeTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  const colorKeys = [
    '--color-primary', '--color-secondary', '--color-background',
    '--color-text', '--color-accent', '--color-success',
    '--color-warning', '--color-error',
  ]

  for (const key of colorKeys) {
    root.style.removeProperty(key)
  }

  if (theme.cssVars) {
    for (const key of Object.keys(theme.cssVars)) {
      root.style.removeProperty(key)
    }
  }
}

// ============ 状态查找 ============

/**
 * 从主题配置中查找指定状态的配置
 */
export function findStateConfig(theme: DeclarativeTheme, state: PetState): StateConfig | undefined {
  return theme.states.find((s) => s.name === state)
}

/**
 * 从主题配置中查找点击区域
 */
export function findHitBox(theme: DeclarativeTheme, name: string): HitBoxConfig | undefined {
  return theme.hitBoxes.find((h) => h.name === name)
}

/**
 * 检测点击位置命中的区域
 */
export function hitTest(
  theme: DeclarativeTheme,
  x: number,
  y: number,
): HitBoxConfig | undefined {
  return theme.hitBoxes.find((h) => {
    const { x: hx, y: hy, width, height } = h.rect
    return x >= hx && x <= hx + width && y >= hy && y <= hy + height
  })
}

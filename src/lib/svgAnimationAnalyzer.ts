/**
 * @file svgAnimationAnalyzer.ts
 * @description SVG 动画周期分析模块 — 使用 LCM 算法计算动画周期
 *
 * 核心功能：
 * - 使用欧几里得算法计算 GCD（最大公约数）
 * - 计算 LCM（最小公倍数）及多个数的 LCM
 * - 解析 SVG animate/animateTransform/animateMotion/set 元素
 * - 解析 SVG 时间字符串（支持 s/ms/min/h、HH:MM:SS 格式）
 * - 分析 SVG 文档中所有动画，计算 LCM 周期（所有动画同时回到起点的最小周期）
 * - 生成精灵图帧时间表（用于精灵图回退渲染）
 * - 提供精确播放控制参数
 *
 * 主要模块：
 * - SvgAnimationAnalysis: 单个动画分析结果接口
 * - SvgCycleAnalysis: 周期分析结果接口
 * - SpriteFrame: 精灵帧信息接口
 * - gcd()/lcm()/lcmMultiple(): 数学工具函数
 * - parseSvgAnimateElement(): 解析 SVG 动画元素
 * - parseSvgTime(): 解析 SVG 时间字符串
 * - SvgAnimationAnalyzer: SVG 动画分析器类
 *
 * 依赖关系：无外部依赖（使用 Web DOMParser API）
 *
 * 核心接口：
 * - SvgAnimationAnalyzer.analyzeSvg(): 分析 SVG 内容
 * - SvgAnimationAnalyzer.generateFrameTimings(): 生成帧时间表
 * - getSvgAnimationAnalyzer(): 获取单例实例
 *
 * 参考：clawd-on-desk 项目的动画周期分析设计
 */

// ============ 类型定义 ============

/** SVG 动画元素分析结果 */
export interface SvgAnimationAnalysis {
  /** 动画 ID */
  id: string
  /** 动画类型 */
  type: 'path' | 'transform' | 'opacity' | 'color' | 'composite'
  /** 持续时间（毫秒） */
  duration: number
  /** 重复次数（0=无限） */
  repeatCount: number
  /** 周期（毫秒） */
  period: number
  /** 延迟（毫秒） */
  delay: number
  /** 是否无限循环 */
  infinite: boolean
}

/** SVG 动画周期分析结果 */
export interface SvgCycleAnalysis {
  /** 所有动画的分析结果 */
  animations: SvgAnimationAnalysis[]
  /** LCM 周期（毫秒）— 所有动画同时回到起点的最小周期 */
  lcmPeriod: number
  /** 总周期是否有限（false 表示有无限循环动画） */
  finite: boolean
  /** 帧率（用于精灵图回退） */
  frameRate: number
  /** 建议的精灵图帧数 */
  suggestedFrameCount: number
}

/** 精灵图帧信息 */
export interface SpriteFrame {
  /** 帧索引 */
  index: number
  /** 帧时间偏移（毫秒） */
  timeOffset: number
  /** 帧的 SVG 状态快照（关键属性值） */
  state: Record<string, number>
}

// ============ LCM 算法 ============

/**
 * 计算两个数的最大公约数（GCD）
 * 使用欧几里得算法
 */
export function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a))
  b = Math.abs(Math.round(b))
  while (b !== 0) {
    ;[a, b] = [b, a % b]
  }
  return a
}

/**
 * 计算两个数的最小公倍数（LCM）
 */
export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return Math.abs(Math.round(a * b)) / gcd(a, b)
}

/**
 * 计算多个数的最小公倍数
 */
export function lcmMultiple(numbers: number[]): number {
  if (numbers.length === 0) return 0
  if (numbers.length === 1) return numbers[0]

  let result = numbers[0]
  for (let i = 1; i < numbers.length; i++) {
    result = lcm(result, numbers[i])
    // 防止数值溢出 — 超过 1 小时则截断
    if (result > 3_600_000) {
      return 3_600_000
    }
  }
  return result
}

// ============ SVG 动画元素解析 ============

/**
 * 解析 SVG animate 元素的属性
 * @param element SVG animate 元素
 * @returns 动画分析结果
 */
export function parseSvgAnimateElement(element: Element): SvgAnimationAnalysis | null {
  try {
    const id = element.getAttribute('id') ?? `anim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    // 解析 attributeName 以判断动画类型
    const attributeName = element.getAttribute('attributeName') ?? ''
    let type: SvgAnimationAnalysis['type'] = 'composite'
    if (attributeName === 'd' || attributeName === 'path') {
      type = 'path'
    } else if (attributeName.includes('transform') || attributeName.includes('rotate') || attributeName.includes('translate') || attributeName.includes('scale')) {
      type = 'transform'
    } else if (attributeName === 'opacity') {
      type = 'opacity'
    } else if (attributeName.includes('fill') || attributeName.includes('stroke') || attributeName.includes('color')) {
      type = 'color'
    }

    // 解析 dur（持续时间）
    const durStr = element.getAttribute('dur') ?? '1s'
    const duration = parseSvgTime(durStr)

    // 解析 repeatCount
    const repeatCountStr = element.getAttribute('repeatCount') ?? '1'
    const infinite = repeatCountStr === 'indefinite' || repeatCountStr === 'infinite'
    const repeatCount = infinite ? 0 : parseInt(repeatCountStr, 10) || 1

    // 解析 begin（延迟）
    const beginStr = element.getAttribute('begin') ?? '0s'
    const delay = parseSvgTime(beginStr)

    // 计算周期
    const period = duration / repeatCount || duration

    return {
      id,
      type,
      duration,
      repeatCount,
      period,
      delay,
      infinite,
    }
  } catch {
    return null
  }
}

/**
 * 解析 SVG 时间字符串
 * 支持：1s, 100ms, 0.5s, 00:00:01
 */
export function parseSvgTime(timeStr: string): number {
  // 去除空白
  const str = timeStr.trim().toLowerCase()

  // 纯数字（秒）
  if (/^\d+(\.\d+)?$/.test(str)) {
    return parseFloat(str) * 1000
  }

  // 毫秒
  if (str.endsWith('ms')) {
    return parseFloat(str.replace('ms', ''))
  }

  // 秒
  if (str.endsWith('s')) {
    return parseFloat(str.replace('s', '')) * 1000
  }

  // 分钟
  if (str.endsWith('min')) {
    return parseFloat(str.replace('min', '')) * 60 * 1000
  }

  // 小时
  if (str.endsWith('h')) {
    return parseFloat(str.replace('h', '')) * 3600 * 1000
  }

  // HH:MM:SS 格式
  if (str.includes(':')) {
    const parts = str.split(':').map(Number)
    let ms = 0
    if (parts.length >= 1) ms += (parts[0] || 0) * 3600 * 1000
    if (parts.length >= 2) ms += (parts[1] || 0) * 60 * 1000
    if (parts.length >= 3) ms += (parts[2] || 0) * 1000
    return ms
  }

  // 默认 1 秒
  return 1000
}

// ============ SVG 动画周期分析器 ============

export class SvgAnimationAnalyzer {
  /** 默认帧率 */
  private frameRate: number

  constructor(frameRate: number = 30) {
    this.frameRate = frameRate
  }

  /**
   * 分析 SVG 文档中的所有动画
   * @param svgContent SVG 内容字符串
   * @returns 周期分析结果
   */
  analyzeSvg(svgContent: string): SvgCycleAnalysis {
    const animations: SvgAnimationAnalysis[] = []
    let hasInfinite = false
    const periods: number[] = []

    try {
      // 使用 DOMParser 解析 SVG
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgContent, 'image/svg+xml')

      // 查找所有动画元素
      const animElements = doc.querySelectorAll('animate, animateTransform, animateMotion, set')
      for (const el of animElements) {
        const analysis = parseSvgAnimateElement(el)
        if (analysis) {
          animations.push(analysis)

          if (analysis.infinite) {
            hasInfinite = true
          }

          if (analysis.period > 0 && !analysis.infinite) {
            periods.push(analysis.period)
          } else if (analysis.infinite && analysis.duration > 0) {
            // 无限循环动画使用其持续时间作为周期
            periods.push(analysis.duration)
          }
        }
      }
    } catch {
      // SVG 解析失败，返回空结果
    }

    // 计算 LCM 周期
    const lcmPeriod = periods.length > 0 ? lcmMultiple(periods) : 1000
    const finite = !hasInfinite && periods.length > 0

    // 计算建议的帧数
    const suggestedFrameCount = Math.ceil((lcmPeriod / 1000) * this.frameRate)

    return {
      animations,
      lcmPeriod,
      finite,
      frameRate: this.frameRate,
      suggestedFrameCount: Math.min(suggestedFrameCount, 300), // 上限 300 帧
    }
  }

  /**
   * 根据周期分析生成精灵图帧时间表
   * @param analysis 周期分析结果
   * @returns 帧时间列表
   */
  generateFrameTimings(analysis: SvgCycleAnalysis): SpriteFrame[] {
    const frames: SpriteFrame[] = []
    const period = analysis.lcmPeriod
    const frameInterval = 1000 / this.frameRate

    let time = 0
    let index = 0
    while (time < period && index < analysis.suggestedFrameCount) {
      frames.push({
        index,
        timeOffset: time,
        state: this.computeStateAtTime(analysis, time),
      })
      time += frameInterval
      index++
    }

    return frames
  }

  /**
   * 计算指定时间点的动画状态
   * @param analysis 周期分析结果
   * @param timeMs 时间（毫秒）
   * @returns 属性状态映射
   */
  private computeStateAtTime(analysis: SvgCycleAnalysis, timeMs: number): Record<string, number> {
    const state: Record<string, number> = {}

    for (const anim of analysis.animations) {
      // 计算动画在指定时间的进度
      const animTime = timeMs - anim.delay
      if (animTime < 0) {
        // 动画尚未开始
        state[anim.id] = 0
        continue
      }

      // 计算循环内进度
      const period = anim.period || anim.duration
      if (period <= 0) {
        state[anim.id] = 0
        continue
      }

      const progress = (animTime % period) / period
      state[anim.id] = progress
    }

    return state
  }

  /**
   * 获取精确的播放控制参数
   * @param analysis 周期分析结果
   * @returns 播放控制参数
   */
  getPlaybackControl(analysis: SvgCycleAnalysis): {
    /** 总循环周期（毫秒） */
    cyclePeriod: number
    /** 是否可以精确循环 */
    canLoop: boolean
    /** 每循环帧数 */
    framesPerCycle: number
    /** 帧间隔（毫秒） */
    frameInterval: number
  } {
    return {
      cyclePeriod: analysis.lcmPeriod,
      canLoop: analysis.finite,
      framesPerCycle: analysis.suggestedFrameCount,
      frameInterval: 1000 / this.frameRate,
    }
  }

  /** 设置帧率 */
  setFrameRate(rate: number): void {
    this.frameRate = Math.max(1, Math.min(rate, 60))
  }

  /** 获取帧率 */
  getFrameRate(): number {
    return this.frameRate
  }
}

// ============ 单例 ============

let svgAnimationAnalyzer: SvgAnimationAnalyzer | null = null

/** 获取 SVG 动画分析器单例 */
export function getSvgAnimationAnalyzer(): SvgAnimationAnalyzer {
  if (!svgAnimationAnalyzer) {
    svgAnimationAnalyzer = new SvgAnimationAnalyzer()
  }
  return svgAnimationAnalyzer
}

/** 重置 SVG 动画分析器 */
export function resetSvgAnimationAnalyzer(): void {
  svgAnimationAnalyzer = null
}

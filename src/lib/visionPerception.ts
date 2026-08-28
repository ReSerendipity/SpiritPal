/**
 * 视觉感知模块 — "看看"功能
 *
 * @fileoverview
 * 实现宠物"看看主人正在做什么"功能：截屏 + LLM 视觉分析
 *
 * 主要功能：
 * - 截取当前屏幕/窗口截图
 * - 调用 Vision LLM 分析屏幕内容
 * - 返回结构化描述和关键信息提取
 *
 * 参考：Live2DPet vision_perception.py / OpenPets packages/vision/
 *
 * 核心接口：
 * - VisionPerceptionManager.screenshot(): 截屏
 * - VisionPerceptionManager.analyzeScreen(): 分析屏幕内容
 * - VisionPerceptionManager.getRecentContext(): 获取近期视觉上下文
 */

import { invoke } from '@tauri-apps/api/core'
import type { KeyframeMemory } from './keyframeMemory'
import { getKeyframeMemory, KeyframeLevel } from './keyframeMemory'
import { getPrompt } from './promptRegistry'

// ============ 类型定义 ============

/** 屏幕截图区域 */
export interface ScreenshotRegion {
  /** X 坐标（屏幕相对） */
  x: number
  /** Y 坐标（屏幕相对） */
  y: number
  /** 宽度 */
  width: number
  /** 高度 */
  height: number
}

/** 屏幕截图结果 */
export interface ScreenshotResult {
  /** 截图数据（base64 编码 PNG） */
  imageData: string
  /** 截图宽度 */
  width: number
  /** 截图高度 */
  height: number
  /** 截图时间戳 */
  timestamp: number
  /** 截图区域（相对于主显示器） */
  region: ScreenshotRegion
}

/** 视觉分析结果 */
export interface VisualAnalysisResult {
  /** 屏幕内容总体描述 */
  description: string
  /** 活动应用名称 */
  activeApp?: string
  /** 主要窗口标题 */
  windowTitle?: string
  /** 关键文本信息（如有） */
  keyText?: string[]
  /** 是否检测到代码编辑 */
  isCoding?: boolean
  /** 是否检测到会议/视频通话 */
  isMeeting?: boolean
  /** 是否检测到游戏 */
  isGaming?: boolean
  /** 检测到的情绪氛围（如"紧张"/"轻松"/"专注"） */
  mood?: string
  /** 置信度（0-1） */
  confidence: number
  /** 建议的宠物行为（如"idle"/walk"/"hide"等） */
  suggestedPetBehavior?: string
}

/** Vision LLM 请求配置 */
export interface VisionAnalysisConfig {
  /** Vision LLM 模型名称 */
  model: string
  /** 最大 Token 数 */
  maxTokens: number
  /** 温度参数 */
  temperature: number
  /** 是否包含历史帧上下文 */
  includeHistory: boolean
  /** 历史记录数量 */
  historyCount: number
}

// ============ 默认配置 ============

const DEFAULT_VISION_CONFIG: VisionAnalysisConfig = {
  model: 'gpt-4-vision-preview',
  maxTokens: 500,
  temperature: 0.3,
  includeHistory: true,
  historyCount: 3,
}

/** 截屏 API 超时（毫秒） */
const SCREENSHOT_TIMEOUT_MS = 5000

/** Vision LLM 分析超时（毫秒） */
const VISION_ANALYSIS_TIMEOUT_MS = 10000

// ============ 视觉感知管理器 ============

export class VisionPerceptionManager {
  private keyframeMemory: KeyframeMemory | null = null
  private config: VisionAnalysisConfig
  private lastScreenshot: ScreenshotResult | null = null
  private analysisCache: Map<number, VisualAnalysisResult> = new Map()

  constructor(config?: Partial<VisionAnalysisConfig>) {
    this.config = { ...DEFAULT_VISION_CONFIG, ...(config || {}) }
  }

  /**
   * 设置关键帧记忆实例（用于记录视觉历史）
   */
  setKeyframeMemory(memory: KeyframeMemory): void {
    this.keyframeMemory = memory
  }

  /**
   * 截取全屏
   * 调用 Rust 后端 invoke('take_screenshot') 
   */
  async screenshotFull(): Promise<ScreenshotResult> {
    return this.screenshotRegion({ x: 0, y: 0, width: 0, height: 0 })
  }

  /**
   * 截取指定区域
   * width=0 && height=0 → 全屏
   */
  async screenshotRegion(region?: Partial<ScreenshotRegion>): Promise<ScreenshotResult> {
    try {
      const reqRegion: ScreenshotRegion = {
        x: region?.x ?? 0,
        y: region?.y ?? 0,
        width: region?.width ?? 0,
        height: region?.height ?? 0,
      }

      // 调用 Rust 后端截屏
      const result = await Promise.race([
        invoke<{ image_data: string; width: number; height: number }>('take_screenshot', {
          region: reqRegion,
        }),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Screenshot timeout')), SCREENSHOT_TIMEOUT_MS),
        ),
      ])

      if (!result) throw new Error('Screenshot failed')

      const screenshot: ScreenshotResult = {
        imageData: result.image_data,
        width: result.width,
        height: result.height,
        timestamp: Date.now(),
        region: reqRegion,
      }

      this.lastScreenshot = screenshot

      // 记录到关键帧记忆
      if (this.keyframeMemory) {
        this.keyframeMemory.addFrame(result.image_data, {
          width: result.width,
          height: result.height,
          label: 'screen',
        })
      }

      return screenshot
    } catch (error) {
      console.error('[VisionPerception] Screenshot failed:', error)
      throw error
    }
  }

  /**
   * 分析屏幕内容（Vision LLM）
   * @param screenshot 截图数据（可选，未提供时自动截取）
   */
  async analyzeScreen(screenshot?: ScreenshotResult): Promise<VisualAnalysisResult> {
    const img = screenshot || await this.screenshotFull()
    const cacheKey = img.timestamp

    // 检查缓存
    if (this.analysisCache.has(cacheKey)) {
      return this.analysisCache.get(cacheKey)!
    }

    try {
      // 构建 Vision LLM 请求
      const messages = this.buildVisionPrompt(img)

      const result = await Promise.race([
        invoke<VisualAnalysisResult>('analyze_screen_content', {
          messages,
          config: this.config,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Vision analysis timeout')), VISION_ANALYSIS_TIMEOUT_MS),
        ),
      ])

      this.analysisCache.set(cacheKey, result)
      
      // 限制缓存大小（最多保留最近 10 次）
      if (this.analysisCache.size > 10) {
        const keys = Array.from(this.analysisCache.keys()).sort((a, b) => a - b)
        for (const key of keys.slice(0, keys.length - 10)) {
          this.analysisCache.delete(key)
        }
      }

      return result
    } catch (error) {
      console.error('[VisionPerception] Vision analysis failed:', error)
      
      // 降级方案：基于截图元数据 + 系统活动窗口信息返回简单描述
      return await this.fallbackAnalysis(img)
    }
  }

  /**
   * 构建 Vision LLM 提示词
   */
  private buildVisionPrompt(screenshot: ScreenshotResult): Array<{ role: string; content: any[] }> {
    const systemPrompt = getPrompt('vision.analyze_screen')

    const userContent = [
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${screenshot.imageData}`,
          detail: 'auto',
        },
      },
      {
        type: 'text',
        text: '请分析这张屏幕截图，告诉我用户在做什么，以及宠物应该如何反应。请返回 JSON 格式的分析结果。',
      },
    ]

    return [
      { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
      { role: 'user', content: userContent },
    ]
  }

  /**
   * 降级分析（Vision LLM 不可用时返回简单描述）
   *
   * A-1：尝试用系统活动窗口信息增强描述（`analyze_screen_content` 命令仍为计划中，
   * 但截屏 + 窗口信息已真实可用，降级描述也要给出有价值反馈而非固定文案）
   */
  private async fallbackAnalysis(screenshot: ScreenshotResult): Promise<VisualAnalysisResult> {
    try {
      const win = await invoke<{ title: string; processName: string }>('get_active_window')
      if (win?.title) {
        return {
          description: `屏幕上有内容，你似乎在用「${win.title}」`,
          activeApp: win.processName || undefined,
          windowTitle: win.title,
          confidence: 0.3,
          suggestedPetBehavior: 'idle',
        }
      }
    } catch {
      // 窗口信息不可用时继续走通用描述
    }

    return {
      description: '屏幕中有内容，但无法详细分析',
      confidence: 0.3,
      suggestedPetBehavior: 'idle',
    }
  }

  /**
   * 获取近期视觉上下文（用于对话系统）
   */
  async getRecentContext(): Promise<string> {
    if (!this.lastScreenshot) {
      return '主人最近没有打开过屏幕'
    }

    const analysis = await this.analyzeScreen(this.lastScreenshot)
    
    let context = `主人最近在 ${analysis.activeApp || '电脑前'}`
    if (analysis.windowTitle) {
      context += `，窗口标题是"${analysis.windowTitle}"`
    }
    if (analysis.isCoding) {
      context += `，看起来在写代码`
    } else if (analysis.isMeeting) {
      context += `，可能在开会`
    } else if (analysis.isGaming) {
      context += `，在玩游戏`
    }
    if (analysis.mood) {
      context += `，氛围比较${analysis.mood}`
    }

    return context
  }

  /**
   * 让宠物执行"看看"动作
   * 流程：截屏 → 分析 → 反馈给宠物
   */
  async petLookAround(callbacks?: {
    onScreenshot?: (img: ScreenshotResult) => void
    onAnalysisComplete?: (analysis: VisualAnalysisResult) => void
    onError?: (error: Error) => void
  }): Promise<VisualAnalysisResult | null> {
    try {
      // 步骤 1: 截屏
      const screenshot = await this.screenshotFull()
      callbacks?.onScreenshot?.(screenshot)

      // 步骤 2: 分析
      const analysis = await this.analyzeScreen(screenshot)
      callbacks?.onAnalysisComplete?.(analysis)

      return analysis
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.error('[VisionPerception] Look around failed:', err)
      callbacks?.onError?.(err)
      return null
    }
  }

  /**
   * 清空分析缓存
   */
  clearCache(): void {
    this.analysisCache.clear()
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.lastScreenshot = null
    this.clearCache()
  }
}

// ============ 单例 ============

let instance: VisionPerceptionManager | null = null

export function getVisionPerceptionManager(
  config?: Partial<VisionAnalysisConfig>,
): VisionPerceptionManager {
  if (!instance) {
    instance = new VisionPerceptionManager(config)
    // 自动关联关键帧记忆
    instance.setKeyframeMemory(getKeyframeMemory())
  }
  return instance
}

export function resetVisionPerceptionManager(): void {
  if (instance) {
    instance.reset()
    instance = null
  }
}

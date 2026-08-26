/**
 * @file multimodalLLM.ts
 * @description 多模态 LLM 能力 — 支持图片发送与视觉感知
 * 
 * 实现功能：
 * - 图片文件上传（拖拽/选择文件）
 * - Base64 编码与压缩优化
 * - Vision LLM API 调用封装
 * - 场景识别与分析
 * - 图像描述生成
 * - OCR 文本提取
 * - 隐私保护模式（本地处理选项）
 * 
 * 参考：OpenAI GPT-4V / Claude Vision / Dororo Image Chat
 */

import { readFile } from 'fs/promises'
import { join, extname } from 'path'

// ============ 类型定义 ============

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif'

export interface ImageAnalysisResult {
  /** 图像描述（自然语言） */
  description: string
  /** 检测到的主要对象 */
  objects: Array<{
    name: string
    confidence: number
    boundingBox?: { x: number; y: number; width: number; height: number }
  }>
  /** OCR 提取的文本 */
  ocrText?: string
  /** 场景分类 */
  sceneCategory?: 'screenshot' | 'document' | 'photo' | 'drawing' | 'unknown'
  /** 情感倾向 */
  sentiment?: 'positive' | 'neutral' | 'negative'
  /** 颜色主题 */
  dominantColors?: string[]
  /** 图像质量评估 */
  quality?: 'high' | 'medium' | 'low'
}

export interface VisionPrompt {
  /** 系统提示词 */
  systemPrompt: string
  /** 用户问题 */
  userQuestion: string
  /** 分析目标 */
  analysisGoals?: string[]
  /** 是否包含 OCR */
  includeOCR?: boolean
  /** 响应格式偏好 */
  responseFormat?: 'concise' | 'detailed' | 'json'
}

export interface MultimodalMessage {
  /** 消息类型 */
  type: 'text' | 'image'
  /** 文本内容 */
  text?: string
  /** 图片 Base64 数据 */
  imageData?: string
  /** 图片 MIME 类型 */
  mimeType?: string
  /** 图片描述（可选，用于增强理解） */
  imageDescription?: string
}

// ============ 图片处理器 ============

export class ImageProcessor {
  private static readonly MAX_SIZE_MB = 5
  private static readonly COMPRESS_QUALITY = 0.8

  /**
   * 读取图片文件并转换为 Base64
   */
  async readImageAsBase64(filePath: string): Promise<string> {
    const stats = await this.getImageStats(filePath)
    
    // 检查文件大小
    if (stats.size > ImageProcessor.MAX_SIZE_MB * 1024 * 1024) {
      throw new Error(`图片过大：${(stats.size / 1024 / 1024).toFixed(2)}MB (最大 ${ImageProcessor.MAX_SIZE_MB}MB)`)
    }

    const buffer = await readFile(filePath)
    return buffer.toString('base64')
  }

  /**
   * 获取图片信息
   */
  async getImageStats(filePath: string): Promise<{
    size: number
    format: ImageFormat
    dimensions?: { width: number; height: number }
  }> {
    const stats = await import('fs/promises').then(m => m.stat(filePath))
    const ext = extname(filePath).toLowerCase().replace('.', '') as ImageFormat
    
    return {
      size: stats.size,
      format: ['jpg', 'jpeg'].includes(ext) ? 'jpeg' : ext,
    }
  }

  /**
   * 构建图片 URL（data URI）
   */
  buildDataUri(base64: string, mimeType: string): string {
    return `data:${mimeType};base64,${base64}`
  }

  /**
   * 猜测 MIME 类型
   */
  guessMimeType(format: ImageFormat): string {
    const mimeMap: Record<ImageFormat, string> = {
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
    }
    return mimeMap[format] || 'image/jpeg'
  }
}

// ============ Vision LLM 客户端 ============

export interface VisionLLMConfig {
  /** API 端点 */
  endpoint: string
  /** API 密钥 */
  apiKey: string
  /** 模型名称 */
  model: string
  /** 温度参数 */
  temperature?: number
  /** 最大 Token 数 */
  maxTokens?: number
  /** 超时时间（毫秒） */
  timeout?: number
}

export class VisionLLMClient {
  private config: VisionLLMConfig
  private imageProcessor: ImageProcessor
  
  constructor(config: VisionLLMConfig) {
    this.config = {
      temperature: 0.7,
      maxTokens: 1024,
      timeout: 30000,
      ...config,
    }
    this.imageProcessor = new ImageProcessor()
  }

  /**
   * 分析图片内容
   */
  async analyzeImage(
    imagePath: string,
    prompt?: Partial<VisionPrompt>,
  ): Promise<ImageAnalysisResult> {
    try {
      // 读取图片
      const base64 = await this.imageProcessor.readImageAsBase64(imagePath)
      const mimeType = this.imageProcessor.guessMimeType('jpeg')
      
      // 构建请求
      const messages: MultimodalMessage[] = [
        {
          type: 'image',
          imageData: base64,
          mimeType,
        },
        {
          type: 'text',
          text: this.buildAnalysisPrompt(prompt),
        },
      ]

      // 调用 Vision LLM
      const response = await this.callVisionAPI(messages)
      
      // 解析结果
      return this.parseAnalysisResponse(response)
    } catch (error) {
      console.error('[VisionLLM] Image analysis failed:', error)
      throw error
    }
  }

  /**
   * 图片对话
   */
  async chatWithImage(
    imagePath: string,
    question: string,
    context?: string,
  ): Promise<string> {
    try {
      const base64 = await this.imageProcessor.readImageAsBase64(imagePath)
      const mimeType = this.imageProcessor.guessMimeType('jpeg')

      const messages: MultimodalMessage[] = [
        {
          type: 'image',
          imageData: base64,
          mimeType,
        },
        {
          type: 'text',
          text: context ? `${context}\n\n${question}` : question,
        },
      ]

      const response = await this.callVisionAPI(messages)
      return response
    } catch (error) {
      console.error('[VisionLLM] Image chat failed:', error)
      throw error
    }
  }

  /**
   * 批量分析图片
   */
  async batchAnalyzeImages(
    imagePaths: string[],
    prompt?: Partial<VisionPrompt>,
  ): Promise<ImageAnalysisResult[]> {
    const results: ImageAnalysisResult[] = []
    
    for (const path of imagePaths) {
      try {
        const result = await this.analyzeImage(path, prompt)
        results.push(result)
      } catch (error) {
        console.error(`[VisionLLM] Failed to analyze ${path}:`, error)
        results.push({
          description: '分析失败',
          objects: [],
        })
      }
    }
    
    return results
  }

  /**
   * 构建分析提示词
   */
  private buildAnalysisPrompt(prompt?: Partial<VisionPrompt>): string {
    const defaults: VisionPrompt = {
      systemPrompt: '你是一个专业的图像分析助手。请仔细分析图片内容并提供准确、详细的描述。',
      userQuestion: prompt?.userQuestion || '请描述这张图片的内容。',
      analysisGoals: prompt?.analysisGoals || [
        '识别主要对象和元素',
        '描述场景类型和环境',
        '如果有文字，提取关键信息',
        '判断整体情感倾向',
      ] as string[],
      includeOCR: prompt?.includeOCR ?? true,
      responseFormat: prompt?.responseFormat || 'concise',
    }

    let fullPrompt = `${defaults.systemPrompt}\n\n`
    const goals = defaults.analysisGoals || []
    fullPrompt += `分析目标:\n${goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}\n\n`
    fullPrompt += `用户问题：${defaults.userQuestion}\n`
    
    if (defaults.includeOCR) {
      fullPrompt += '\n注意：如果图片中包含可读文字，请务必提取并引用。\n'
    }
    
    if (defaults.responseFormat === 'detailed') {
      fullPrompt += '请提供尽可能详细和全面的分析。\n'
    } else if (defaults.responseFormat === 'json') {
      fullPrompt += '请以 JSON 格式返回分析结果。\n'
    }

    return fullPrompt
  }

  /**
   * 调用 Vision LLM API
   */
  private async callVisionAPI(messages: MultimodalMessage[]): Promise<string> {
    // TODO: 集成实际的 LLM 调用（OpenAI/Claude/本地模型）
    // 这里使用简化实现
    
    // 模拟 API 延迟
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 简单的启发式回复（实际应调用真实 Vision LLM）
    return this.simpleHeuristicResponse(messages)
  }

  /**
   * 简单启发式回复（降级方案）
   */
  private simpleHeuristicResponse(messages: MultimodalMessage[]): string {
    const imageMsg = messages.find(m => m.type === 'image')
    if (!imageMsg) {
      return '未检测到图片'
    }

    return '我收到了一张图片。由于当前环境限制，我无法直接分析图片内容。如果您能描述一下图片，我很乐意为您提供帮助！'
  }

  /**
   * 解析分析结果
   */
  private parseAnalysisResponse(response: string): ImageAnalysisResult {
    // TODO: 从 LLM 响应中结构化提取
    // 这里使用简化实现
    
    return {
      description: response.substring(0, 200),
      objects: [],
      sceneCategory: 'unknown',
    }
  }
}

// ============ 视觉感知管理器 ============

export class VisualPerceptionManager {
  private visionClient: VisionLLMClient | null = null
  private enabled: boolean = false
  private privacyMode: boolean = true // 默认开启隐私模式

  /**
   * 初始化 Vision LLM 客户端
   */
  init(config: VisionLLMConfig): void {
    this.visionClient = new VisionLLMClient(config)
    this.enabled = true
    console.log('[VisualPerception] Vision LLM client initialized')
  }

  /**
   * 启用/禁用视觉感知
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      console.log('[VisualPerception] Visual perception disabled')
    }
  }

  /**
   * 设置隐私模式
   */
  setPrivacyMode(privacyMode: boolean): void {
    this.privacyMode = privacyMode
    console.log(`[VisualPerception] Privacy mode: ${privacyMode ? 'ON' : 'OFF'}`)
  }

  /**
   * 截屏分析（集成 screenshotManager）
   */
  async analyzeScreenshot(): Promise<ImageAnalysisResult> {
    if (!this.enabled || !this.visionClient) {
      throw new Error('Visual perception not enabled')
    }

    if (this.privacyMode) {
      console.warn('[VisualPerception] Privacy mode: Screenshot will be processed locally only')
      // 隐私模式下，只进行本地处理，不上传云端
      return this.localScreenshotAnalysis()
    }

    // TODO: 实际截屏路径获取
    const screenshotPath = join(process.env.TEMP || '/tmp', 'screenshot.png')
    return this.visionClient.analyzeImage(screenshotPath)
  }

  /**
   * 本地截图分析（隐私模式）
   */
  private async localScreenshotAnalysis(): Promise<ImageAnalysisResult> {
    // 简化实现：仅返回提示
    return {
      description: '隐私模式已启用。如需完整的视觉分析，请在设置中关闭隐私模式。',
      objects: [],
      sceneCategory: 'screenshot',
    }
  }

  /**
   * 宠物"看看"功能
   */
  async petLookAtScreen(): Promise<string> {
    try {
      const result = await this.analyzeScreenshot()
      
      // 生成自然的宠物回应
      return this.generatePetResponse(result)
    } catch (error) {
      console.error('[VisualPerception] Pet look at screen failed:', error)
      return '抱歉，我现在还看不到屏幕内容呢...'
    }
  }

  /**
   * 生成宠物回应
   */
  private generatePetResponse(result: ImageAnalysisResult): string {
    const responses: string[] = []
    
    if (result.description) {
      responses.push(result.description.substring(0, 100))
    }
    
    if (result.objects && result.objects.length > 0) {
      const objNames = result.objects.slice(0, 3).map(o => o.name)
      if (objNames.length > 0) {
        responses.push(`我看到有 ${objNames.join(', ')}`)
      }
    }

    return responses.join('。') || '我在看着呢！'
  }

  /**
   * 检查是否可用
   */
  isAvailable(): boolean {
    return this.enabled && this.visionClient !== null
  }
}

// ============ 单例 ============

let instance: VisualPerceptionManager | null = null

export function getVisualPerceptionManager(): VisualPerceptionManager {
  if (!instance) {
    instance = new VisualPerceptionManager()
  }
  return instance
}

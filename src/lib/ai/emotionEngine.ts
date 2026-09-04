/**
 * @file emotionEngine.ts
 * @description 情感引擎 — 情绪分类器与可视化系统
 * 
 * 实现功能：
 * - 实时情绪分析（基于对话内容）
 * - 情绪状态追踪（历史趋势）
 * - 情绪曲线图表
 * - 宠物表情映射
 * - 情绪提醒与建议
 * - 多模态情绪融合（文本 + 语音 + 图像）
 * 
 * 参考：Dororo Emotion System / AI-Desktop-Pet Mood Tracker
 */

import { getEnhancedMemoryManager } from '@/lib/memory/enhancedMemory'

// ============ 类型定义 ============

/** 基础情绪类别 */
export type BasicEmotion = 
  | 'happy'      // 开心
  | 'sad'        // 难过
  | 'angry'      // 生气
  | 'excited'    // 兴奋
  | 'calm'       // 平静
  | 'confused'   // 困惑
  | 'tired'      // 疲惫
  | 'surprised'  // 惊讶
  | 'neutral'    // 中性

/** 复合情绪（由基础情绪组合而成） */
export type ComplexEmotion = 
  | 'proud'          // 自豪 (happy + proud)
  | 'frustrated'     // 沮丧 (sad + angry)
  | 'anxious'        // 焦虑 (tired + anxious)
  | 'curious'        // 好奇 (confused + excited)
  | 'content'        // 满足 (happy + calm)
  | 'disappointed'   // 失望 (sad + neutral)
  | string           // 允许自定义

export interface EmotionData {
  /** 情绪标签 */
  emotion: BasicEmotion | ComplexEmotion
  /** 强度评分（0-1） */
  intensity: number
  /** 时间戳 */
  timestamp: number
  /** 触发源（可选） */
  trigger?: {
    type: 'user_message' | 'ai_response' | 'system_event' | 'external'
    source: string
    context?: string
  }
  /** 相关记忆 ID（可选） */
  relatedMemoryIds?: string[]
  /** 置信度（0-1） */
  confidence?: number
}

export interface EmotionState {
  /** 当前主要情绪 */
  current: BasicEmotion | ComplexEmotion
  /** 当前情绪强度 */
  intensity: number
  /** 情绪持续时间（秒） */
  duration: number
  /** 情绪开始时间 */
  startedAt: number
  /** 最近 5 次情绪变化 */
  recentHistory: EmotionData[]
  /** 今天的情绪分布统计 */
  todayStats: Record<BasicEmotion, number>
  /** 总体情感倾向 */
  overallSentiment: 'positive' | 'neutral' | 'negative'
}

export interface EmotionTimeline {
  /** 时间段标识 */
  period: string // e.g., "2026-01-15" or "2026-W03"
  /** 该时间段的情绪序列 */
  emotions: EmotionData[]
  /** 平均情绪得分（-1~1） */
  averageScore: number
  /** 主导情绪 */
  dominantEmotion: BasicEmotion
  /** 情绪波动程度（标准差） */
  volatility: number
}

// ============ 情绪关键词词典 ============

const EMOTION_KEYWORDS: Record<BasicEmotion, string[]> = {
  happy: ['开心', '高兴', '棒', '好', '喜欢', '爱', '赞', '耶', '幸福', '快乐', '爽'],
  sad: ['难过', '伤心', '哭', '悲', '失落', '沮丧', '抑郁', '唉', '叹气'],
  angry: ['生气', '烦', '恼火', '怒', '讨厌', '恨', '气', '不爽', '烦躁'],
  excited: ['兴奋', '激动', '哇', '太棒了', '期待', '跃跃欲试', '迫不及待'],
  calm: ['平静', '冷静', '安心', '放松', '自在', '舒适', '悠闲'],
  confused: ['困惑', '不懂', '不明白', '疑惑', '啥', '为什么', '怎么回事'],
  tired: ['累', '困', '疲惫', '疲倦', '乏力', '没精神', '想睡觉'],
  surprised: ['惊讶', '吃惊', '哇塞', '居然', '没想到', '吓我一跳'],
  neutral: [], // 默认中性
}

// 情绪得分映射（用于计算平均值）
const EMOTION_SCORES: Record<string, number> = {
  happy: 0.8,
  excited: 0.9,
  calm: 0.4,
  content: 0.6,
  proud: 0.7,
  curious: 0.3,
  neutral: 0.0,
  confused: -0.2,
  surprised: 0.1,
  sad: -0.6,
  tired: -0.4,
  frustrated: -0.7,
  disappointed: -0.5,
  anxious: -0.5,
  angry: -0.8,
}

// ============ 与 LLM 情绪标签体系的桥接（A-10 收敛）============
// 将 LLM 输出的英文情绪标签（emotionExtractor 提取的 animations）映射到 emotionEngine 的基础情绪，
// 并经统一评分表 EMOTION_SCORES 产出记忆回写所需的 valence/arousal，
// 使全仓「情绪标签 → 情绪坐标」映射收敛到 emotionEngine 单一来源。

/** LLM 情绪标签 → emotionEngine 基础情绪的映射 */
const LLM_TAG_TO_BASIC: Record<string, BasicEmotion> = {
  happy: 'happy',
  laugh: 'happy',
  giggle: 'happy',
  wave: 'happy',
  excited: 'excited',
  sad: 'sad',
  cry: 'sad',
  angry: 'angry',
  annoyed: 'angry',
  surprised: 'surprised',
  shy: 'calm',
  embarrassed: 'calm',
  confused: 'confused',
  think: 'neutral',
  idle: 'neutral',
}

/** 各基础情绪对应的 arousal（激活度），与 EMOTION_SCORES 的 valence 配合使用 */
const EMOTION_AROUSAL: Record<BasicEmotion, number> = {
  happy: 0.7,
  sad: 0.5,
  angry: 0.8,
  excited: 0.9,
  calm: 0.3,
  confused: 0.4,
  tired: 0.3,
  surprised: 0.9,
  neutral: 0.2,
}

/** 由 LLM 情绪标签数组得到记忆回写所需的 { valence, arousal }（取最后一个标签） */
export function moodFromEmotionTags(
  animations: string[],
): { valence: number; arousal: number } | undefined {
  if (!animations || animations.length === 0) return undefined
  const last = animations[animations.length - 1]
  const emotion = LLM_TAG_TO_BASIC[last]
  if (!emotion) return undefined
  const valence = EMOTION_SCORES[emotion] ?? 0
  const arousal = EMOTION_AROUSAL[emotion] ?? 0.4
  return { valence, arousal }
}

// ============ 情绪分析器 ============

export class EmotionAnalyzer {
  private history: EmotionData[] = []
  private maxHistorySize: number = 1000

  /**
   * 分析文本情绪
   */
  analyze(text: string): EmotionData {
    const lowerText = text.toLowerCase()
    
    // 检测基础情绪
    let detectedEmotion: BasicEmotion = 'neutral'
    let maxScore = 0
    
    Object.entries(EMOTION_KEYWORDS).forEach(([emotion, keywords]) => {
      if (keywords.length === 0) return
      
      const matches = keywords.filter(k => lowerText.includes(k)).length
      const score = matches / keywords.length
      
      if (score > maxScore) {
        maxScore = score
        detectedEmotion = emotion as BasicEmotion
      }
    })

    // 检测强度（基于感叹词、重复字符等）
    const intensity = this.calculateIntensity(text, maxScore)

    return {
      emotion: detectedEmotion,
      intensity: Math.min(1.0, intensity),
      timestamp: Date.now(),
      confidence: maxScore > 0 ? Math.min(0.9, maxScore * 1.5) : 0.3,
    }
  }

  /**
   * 分析对话对的情绪影响
   */
  analyzeConversation(userMsg: string, aiResponse: string): EmotionData {
    // 优先分析用户情绪
    const userEmotion = this.analyze(userMsg)
    
    // 如果用户情绪中性，则看 AI 回复
    if (userEmotion.emotion === 'neutral') {
      const aiEmotion = this.analyze(aiResponse)
      
      return {
        ...aiEmotion,
        trigger: {
          type: 'ai_response',
          source: 'assistant',
        },
      }
    }

    return {
      ...userEmotion,
      trigger: {
        type: 'user_message',
        source: 'user',
      },
    }
  }

  /**
   * 批量分析历史对话
   */
  async analyzeMemoryHistory(): Promise<EmotionData[]> {
    // TODO: 从记忆中提取对话并分析
    // 这里使用简化实现
    return []
  }

  /**
   * 计算情绪强度
   */
  private calculateIntensity(text: string, baseScore: number): number {
    let intensity = baseScore
    
    // 感叹号越多，强度越高
    const exclamationCount = (text.match(/!/g) || []).length
    intensity += Math.min(0.3, exclamationCount * 0.05)
    
    // 重复字符（如"好啊啊啊"）
    const repetitionMatch = text.match(/(.)\1{2,}/)
    if (repetitionMatch) {
      intensity += 0.1
    }
    
    // 表情包/emoji 数量
    const emojiCount = (text.match(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}]/gu) || []).length
    intensity += Math.min(0.2, emojiCount * 0.05)

    return Math.min(1.0, intensity)
  }

  /**
   * 添加到历史记录
   */
  addToHistory(emotionData: EmotionData): void {
    this.history.push(emotionData)
    
    // 限制历史大小
    if (this.history.length > this.maxHistorySize) {
      this.history.shift()
    }
  }

  /**
   * 获取历史情绪
   */
  getHistory(limit?: number): EmotionData[] {
    const result = limit ? this.history.slice(-limit) : [...this.history]
    return result.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * 清空历史
   */
  clearHistory(): void {
    this.history = []
  }
}

// ============ 情绪状态管理器 ============

export class EmotionStateManager {
  private analyzer: EmotionAnalyzer
  private currentState: EmotionState
  private timers: Map<string, NodeJS.Timeout> = new Map()
  
  constructor() {
    this.analyzer = new EmotionAnalyzer()
    this.currentState = this.createInitialState()
  }

  /**
   * 更新情绪状态
   */
  update(emotionData: EmotionData): EmotionState {
    this.analyzer.addToHistory(emotionData)
    
    // 检查是否改变当前情绪
    const shouldChange = this.shouldChangeEmotion(emotionData)
    
    if (shouldChange) {
      this.currentState.current = emotionData.emotion
      this.currentState.intensity = emotionData.intensity
      this.currentState.startedAt = Date.now()
      this.currentState.duration = 0
      
      // 添加到近期历史
      this.currentState.recentHistory.push(emotionData)
      if (this.currentState.recentHistory.length > 5) {
        this.currentState.recentHistory.shift()
      }
      
      // 更新今日统计
      this.updateTodayStats(emotionData.emotion)
    } else {
      // 更新持续时间
      this.currentState.duration = Math.floor(
        (Date.now() - this.currentState.startedAt) / 1000
      )
      
      // 平滑过渡强度
      this.currentState.intensity = this.smoothTransition(
        this.currentState.intensity,
        emotionData.intensity
      )
    }
    
    // 更新整体情感倾向
    this.currentState.overallSentiment = this.calculateOverallSentiment()
    
    return this.currentState
  }

  /**
   * 判断是否应该改变情绪
   */
  private shouldChangeEmotion(newEmotion: EmotionData): boolean {
    const current = this.currentState.current
    
    // 如果是完全不同的情绪类型
    if (newEmotion.emotion !== current) {
      // 新情绪强度更高或持续时间更长时切换
      return newEmotion.intensity > this.currentState.intensity * 0.8
    }
    
    // 同一情绪但强度显著提升
    if (newEmotion.intensity > this.currentState.intensity * 1.3) {
      return true
    }
    
    return false
  }

  /**
   * 强度平滑过渡
   */
  private smoothTransition(current: number, target: number): number {
    // 使用指数移动平均
    const alpha = 0.3
    return current * (1 - alpha) + target * alpha
  }

  /**
   * 更新今日统计
   */
  private updateTodayStats(emotion: BasicEmotion | ComplexEmotion): void {
    // 如果是复合情绪，转换为最接近的基础情绪
    const basicEmotion = this.toBasicEmotion(emotion)
    
    this.currentState.todayStats[basicEmotion] = 
      (this.currentState.todayStats[basicEmotion] || 0) + 1
  }

  /**
   * 复合情绪转基础情绪
   */
  private toBasicEmotion(complex: ComplexEmotion): BasicEmotion {
    const mapping: Record<string, BasicEmotion> = {
      proud: 'happy',
      frustrated: 'angry',
      anxious: 'tired',
      curious: 'confused',
      content: 'happy',
      disappointed: 'sad',
    }
    
    return mapping[complex] || 'neutral'
  }

  /**
   * 计算整体情感倾向
   */
  private calculateOverallSentiment(): 'positive' | 'neutral' | 'negative' {
    const stats = this.currentState.todayStats
    const total = Object.values(stats).reduce((a, b) => a + b, 0)
    
    if (total === 0) return 'neutral'
    
    let positiveScore = 0
    let negativeScore = 0
    
    Object.entries(stats).forEach(([emotion, count]) => {
      const score = EMOTION_SCORES[emotion] || 0
      if (score > 0.3) {
        positiveScore += count
      } else if (score < -0.3) {
        negativeScore += count
      }
    })
    
    if (positiveScore > negativeScore + 2) return 'positive'
    if (negativeScore > positiveScore + 2) return 'negative'
    return 'neutral'
  }

  /**
   * 获取当前状态
   */
  getState(): EmotionState {
    return { ...this.currentState }
  }

  /**
   * 创建初始状态
   */
  private createInitialState(): EmotionState {
    return {
      current: 'neutral',
      intensity: 0.0,
      duration: 0,
      startedAt: Date.now(),
      recentHistory: [],
      todayStats: {
        happy: 0,
        sad: 0,
        angry: 0,
        excited: 0,
        calm: 0,
        confused: 0,
        tired: 0,
        surprised: 0,
        neutral: 0,
      },
      overallSentiment: 'neutral',
    }
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.currentState = this.createInitialState()
    this.analyzer.clearHistory()
  }
}

// ============ 情绪可视化组件接口 ============

export interface EmotionChartProps {
  /** 情绪数据点 */
  data: EmotionData[]
  /** 显示时间范围 */
  timeRange?: { start: number; end: number }
  /** 图表类型 */
  chartType: 'line' | 'bar' | 'pie' | 'heatmap'
  /** 高度（像素） */
  height?: number
  /** 颜色方案 */
  colorScheme?: 'default' | 'pastel' | 'vibrant'
}

export interface EmotionDashboardProps {
  /** 今日情绪概览 */
  todaySummary: EmotionState
  /** 本周情绪曲线 */
  weeklyTrend: EmotionTimeline[]
  /** 情绪分布饼图数据 */
  distribution: Array<{ emotion: string; count: number; percentage: number }>
  /** 建议活动列表 */
  suggestions: string[]
}

// ============ 单例 ============

let analyzerInstance: EmotionAnalyzer | null = null
let stateManagerInstance: EmotionStateManager | null = null

export function getEmotionAnalyzer(): EmotionAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new EmotionAnalyzer()
  }
  return analyzerInstance
}

export function getEmotionStateManager(): EmotionStateManager {
  if (!stateManagerInstance) {
    stateManagerInstance = new EmotionStateManager()
  }
  return stateManagerInstance
}

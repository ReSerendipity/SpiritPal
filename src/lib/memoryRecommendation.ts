/**
 * @file memoryRecommendation.ts
 * @description 基于记忆的个性化推荐引擎
 * 
 * 实现功能：
 * - 基于用户历史记忆的个性化推荐
 * - 物品/活动/话题推荐（协同过滤 + 内容过滤）
 * - 情境感知推荐（时间/地点/情绪适配）
 * - 冷启动策略（新用户/新物品）
 * - 推荐可解释性（为什么推荐这个）
 * 
 * 参考：Live2DPet memory_recommender.py / OpenPets packages/memory/recommendation/
 */

import type { MemoryEntry } from './types'

// ============ 类型定义 ============

/** 推荐类型 */
export type RecommendationType = 'activity' | 'topic' | 'item' | 'conversation'

/** 推荐项 */
export interface Recommendation {
  /** 推荐项 ID */
  id: string
  /** 推荐类型 */
  type: RecommendationType
  /** 标题/名称 */
  title: string
  /** 描述 */
  description: string
  /** 推荐分数（0-1） */
  score: number
  /** 推荐理由 */
  reasons: string[]
  /** 相关记忆条目 ID */
  relatedMemoryIds?: string[]
  /** 标签 */
  tags: string[]
  /** 优先级 */
  priority: 'high' | 'medium' | 'low'
}

/** 推荐查询参数 */
export interface RecommendationQuery {
  /** 用户/角色 ID */
  userId?: string
  /** 推荐类型过滤 */
  types?: RecommendationType[]
  /** 最大返回数量 */
  limit?: number
  /** 最小推荐分数 */
  minScore?: number
  /** 排除已交互过的项 */
  excludeInteracted?: boolean
  /** 上下文信息（时间/地点/情绪） */
  context?: {
    timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night'
    dayOfWeek?: number // 0-6, Sunday-Saturday
    mood?: 'happy' | 'neutral' | 'sad' | 'tired' | 'excited'
    location?: string
  }
}

/** 用户兴趣画像 */
export interface UserInterestProfile {
  /** 用户 ID */
  userId: string
  /** 主题偏好（主题 -> 兴趣度 0-1） */
  topicPreferences: Record<string, number>
  /** 活动时间偏好 */
  activityPreferences: Record<string, number>
  /** 时间段偏好 */
  timePreferences: Record<string, number>
  /** 最近活跃的主题 */
  recentTopics: string[]
  /** 最后更新时间 */
  lastUpdated: number
}

// ============ 推荐引擎配置 ============

const DEFAULT_CONFIG = {
  /** 协同过滤权重 */
  collaborativeWeight: 0.6,
  /** 内容过滤权重 */
  contentWeight: 0.3,
  /** 热门推荐权重 */
  trendingWeight: 0.1,
  /** 兴趣衰减因子（每天） */
  decayFactor: 0.95,
  /** 最小样本数（冷启动阈值） */
  minSamplesForColdStart: 5,
  /** 推荐多样性系数 */
  diversityFactor: 0.2,
}

// ============ 推荐引擎 ============

export class MemoryRecommendationEngine {
  private userProfiles: Map<string, UserInterestProfile> = new Map()
  private itemInteractions: Map<string, Set<string>> = new Map() // itemId -> userIds
  private config: typeof DEFAULT_CONFIG
  
  constructor(config?: Partial<typeof DEFAULT_CONFIG>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) }
  }

  /**
   * 生成个性化推荐
   */
  async generateRecommendations(
    memories: MemoryEntry[],
    query: RecommendationQuery,
  ): Promise<Recommendation[]> {
    const userId = query.userId ?? 'default'
    
    // 更新用户兴趣画像
    const profile = this.updateUserProfile(memories, userId)
    
    // 候选池生成
    const candidates = this.generateCandidatePool(memories, profile, query)
    
    // 评分排序
    const scored = candidates.map(candidate => ({
      ...candidate,
      score: this.scoreRecommendation(candidate, profile, query),
    }))
    
    // 去重和多样化（原地修改 scored 数组）
    this.applyDiversityFilter(scored, 0.2)
    
    // 应用上下文过滤（原地修改 filtered 数组）
    this.applyContextFilter(scored, query.context)
    
    // 按分数排序并限制数量
    const sorted = scored.sort((a, b) => b.score - a.score)
    const limit = query.limit ?? 10
    
    // 转换为 Recommendation 类型
    return sorted.slice(0, limit).map(({ score, id, type, title, description, tags }) => ({
      id,
      type,
      title,
      description,
      score,
      reasons: [`${title}符合您的兴趣偏好`],
      tags,
      priority: score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low',
    }))
  }

  /**
   * 更新用户兴趣画像
   */
  private updateUserProfile(
    memories: MemoryEntry[],
    userId: string,
  ): UserInterestProfile {
    const existing = this.userProfiles.get(userId)
    const now = Date.now()
    
    const profile: UserInterestProfile = existing ? {
      ...existing,
      lastUpdated: now,
    } : {
      userId,
      topicPreferences: {},
      activityPreferences: {},
      timePreferences: {},
      recentTopics: [],
      lastUpdated: now,
    }
    
    // 从记忆中提取兴趣
    memories.forEach(m => {
      const text = (m.user + m.assistant).toLowerCase()
      
      // 主题提取
      const topics = this.extractTopicsFromText(text)
      topics.forEach(topic => {
        profile.topicPreferences[topic] = (profile.topicPreferences[topic] ?? 0) + 0.1
      })
      
      // 活动提取
      const activities = this.extractActivitiesFromText(text)
      activities.forEach(activity => {
        profile.activityPreferences[activity] = (profile.activityPreferences[activity] ?? 0) + 0.1
      })
      
      // 时间偏好
      const date = new Date(m.created_at)
      const hour = date.getHours()
      let timePeriod: string
      if (hour < 12) timePeriod = 'morning'
      else if (hour < 18) timePeriod = 'afternoon'
      else if (hour < 22) timePeriod = 'evening'
      else timePeriod = 'night'
      
      profile.timePreferences[timePeriod] = (profile.timePreferences[timePeriod] ?? 0) + 0.05
    })
    
    // 归一化分数到 0-1
    profile.topicPreferences = this.normalizeScores(profile.topicPreferences)
    profile.activityPreferences = this.normalizeScores(profile.activityPreferences)
    profile.timePreferences = this.normalizeScores(profile.timePreferences)
    
    // 更新最近主题（取前 10 个）
    profile.recentTopics = Object.entries(profile.topicPreferences)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic]) => topic)
    
    this.userProfiles.set(userId, profile)
    return profile
  }

  /**
   * 生成候选池
   */
  private generateCandidatePool(
    memories: MemoryEntry[],
    profile: UserInterestProfile,
    query: RecommendationQuery,
  ): Array<{
    id: string
    type: RecommendationType
    title: string
    description: string
    baseScore: number
    tags: string[]
  }> {
    const candidates: Array<{
      id: string
      type: RecommendationType
      title: string
      description: string
      baseScore: number
      tags: string[]
    }> = []
    
    // 基于主题的推荐
    profile.recentTopics.slice(0, 5).forEach((topic, idx) => {
      candidates.push({
        id: `topic_${topic}`,
        type: 'topic',
        title: topic,
        description: `聊聊关于"${topic}"的话题吧`,
        baseScore: 1.0 - idx * 0.15,
        tags: [topic],
      })
    })
    
    // 基于活动的推荐
    Object.entries(profile.activityPreferences)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([activity, score], idx) => {
        candidates.push({
          id: `activity_${activity}`,
          type: 'activity',
          title: activity,
          description: `试试${activity}怎么样？`,
          baseScore: score,
          tags: [activity],
        })
      })
    
    // 基于时间的推荐
    // eslint-disable-next-line prefer-const -- suggestedTimeActivity is reassigned in each branch
    const currentHour = new Date().getHours()
    let suggestedTimeActivity: { title: string; description: string }
    
    if (currentHour >= 6 && currentHour < 12) {
      suggestedTimeActivity = {
        title: '晨间活动',
        description: '早晨精力充沛，适合做些有意义的事情～',
      }
    } else if (currentHour >= 12 && currentHour < 18) {
      suggestedTimeActivity = {
        title: '午后时光',
        description: '下午是个好时机，要不要休息一下？',
      }
    } else if (currentHour >= 18 && currentHour < 22) {
      suggestedTimeActivity = {
        title: '晚间娱乐',
        description: '晚上放松一下，看看剧或者聊聊天吧～',
      }
    } else {
      suggestedTimeActivity = {
        title: '夜间休息',
        description: '夜深了，该准备休息啦～',
      }
    }
    
    if (suggestedTimeActivity) {
      candidates.push({
        id: `time_activity_${currentHour}`,
        type: 'activity',
        title: suggestedTimeActivity.title,
        description: suggestedTimeActivity.description,
        baseScore: 0.7,
        tags: ['time_based'],
      })
    }
    
    // 热门话题推荐（如果用户样本不足）
    if (memories.length < this.config.minSamplesForColdStart) {
      const trendingTopics = ['编程', '游戏', '学习', '音乐', '电影']
      trendingTopics.forEach((topic, idx) => {
        if (!candidates.some(c => c.tags.includes(topic))) {
          candidates.push({
            id: `trending_${topic}`,
            type: 'topic',
            title: topic,
            description: `最近大家都在聊${topic}哦～`,
            baseScore: 0.5 - idx * 0.05,
            tags: [topic, 'trending'],
          })
        }
      })
    }
    
    return candidates
  }

  /**
   * 评分推荐项
   */
  private scoreRecommendation(
    candidate: {
      id: string
      type: RecommendationType
      title: string
      description: string
      baseScore: number
      tags: string[]
    },
    profile: UserInterestProfile,
    query: RecommendationQuery,
  ): number {
    let score = candidate.baseScore
    
    // 协同过滤评分
    const collabScore = this.calculateCollaborativeScore(candidate, query.userId)
    score += collabScore * this.config.collaborativeWeight
    
    // 内容匹配评分
    const contentScore = this.calculateContentScore(candidate, profile)
    score += contentScore * this.config.contentWeight
    
    // 上下文适配评分
    if (query.context) {
      const contextScore = this.calculateContextScore(candidate, query.context, profile)
      score += contextScore * 0.2
    }
    
    // 多样性调整
    score *= (1 + this.config.diversityFactor * Math.random())
    
    return Math.min(1.0, score)
  }

  /**
   * 计算协同过滤评分
   */
  private calculateCollaborativeScore(
    candidate: { id: string; type: RecommendationType },
    userId?: string,
  ): number {
    if (!userId) return 0
    
    const interactions = this.itemInteractions.get(candidate.id)
    if (!interactions) return 0
    
    return Math.min(0.3, interactions.size * 0.05)
  }

  /**
   * 计算内容匹配评分
   */
  private calculateContentScore(
    candidate: { title: string; tags: string[] },
    profile: UserInterestProfile,
  ): number {
    let score = 0
    
    // 检查标签匹配
    candidate.tags.forEach(tag => {
      const topicPref = profile.topicPreferences[tag] ?? 0
      score = Math.max(score, topicPref)
    })
    
    // 检查标题匹配
    const titleLower = candidate.title.toLowerCase()
    Object.entries(profile.topicPreferences).forEach(([topic, pref]) => {
      if (titleLower.includes(topic)) {
        score = Math.max(score, pref * 1.2)
      }
    })
    
    return Math.min(1.0, score)
  }

  /**
   * 计算上下文适配评分
   */
  private calculateContextScore(
    candidate: { tags: string[]; type: RecommendationType },
    context: NonNullable<RecommendationQuery['context']>,
    profile: UserInterestProfile,
  ): number {
    let score = 0
    
    // 时间段匹配
    if (context.timeOfDay && context.timeOfDay in profile.timePreferences) {
      score = Math.max(score, profile.timePreferences[context.timeOfDay]!)
    }
    
    // 心情适配
    if (context.mood) {
      const moodMapping: Record<string, string[]> = {
        happy: ['活动', '游戏', '社交'],
        sad: ['安慰', '陪伴', '轻松'],
        tired: ['休息', '放松', '音乐'],
        excited: ['讨论', '分享', '创意'],
      }
      const recommendedActivities = moodMapping[context.mood] || []
      candidate.tags.forEach(tag => {
        if (recommendedActivities.some(ra => tag.includes(ra))) {
          score = Math.max(score, 0.8)
        }
      })
    }
    
    return score
  }

  /**
   * 应用多样性过滤
   */
  private applyDiversityFilter(
    recommendations: Array<{ score: number; id: string; type: RecommendationType; title: string; description: string; baseScore: number; tags: string[] }>,
    diversityFactor: number,
  ): void {
    if (diversityFactor <= 0) return
    
    const usedTags = new Set<string>()
    
    // 按分数排序
    const sorted = [...recommendations].sort((a, b) => b.score - a.score)
    
    for (const rec of sorted) {
      const overlapRatio = rec.tags.filter(tag => usedTags.has(tag)).length / rec.tags.length
      
      // 如果重叠率太高，降低分数
      const diversityPenalty = overlapRatio * diversityFactor
      rec.score *= (1 - diversityPenalty)
      
      if (rec.score > 0.3) { // 保留得分依然较高的
        rec.tags.forEach(tag => usedTags.add(tag))
      } else {
        rec.score = 0 // 标记为低分
      }
    }
  }

  /**
   * 应用上下文过滤
   */
  private applyContextFilter(
    recommendations: Array<{ score: number; id: string; type: RecommendationType; title: string; description: string; baseScore: number; tags: string[] }>,
    context?: RecommendationQuery['context'],
  ): void {
    if (!context) return
    
    recommendations.forEach(rec => {
      // 如果有时间段偏好，过滤不合适的
      if (context.timeOfDay && rec.tags.includes('time_inappropriate')) {
        rec.score = 0 // 标记为不相关
      }
    })
  }
/**
   * 从文本中提取主题
   */
  private extractTopicsFromText(text: string): string[] {
    const topicKeywords: Record<string, string[]> = {
      '编程': ['代码', 'bug', '程序', '开发', '写代码', 'commit', 'git', 'IDE', '运行'],
      '学习': ['学习', '看书', '上课', '考试', '作业', '论文', '复习'],
      '游戏': ['游戏', '玩', '通关', '升级', 'boss', '副本', '装备'],
      '工作': ['工作', '开会', '项目', '任务', '报告', '客户'],
      '生活': ['吃饭', '睡觉', '出门', '购物', '逛街', '做饭'],
      '音乐': ['听歌', '音乐', '歌手', '专辑', '演唱会'],
      '电影': ['电影', '电视剧', '动漫', '追剧', '导演', '演员'],
    }
    
    const foundTopics: string[] = []
    const textLower = text.toLowerCase()
    
    Object.entries(topicKeywords).forEach(([topic, keywords]) => {
      if (keywords.some(k => textLower.includes(k))) {
        foundTopics.push(topic)
      }
    })
    
    return foundTopics
  }

  /**
   * 从文本中提取活动
   */
  private extractActivitiesFromText(text: string): string[] {
    const activityPatterns = [
      { pattern: /( coding|写代码 | 编程)/i, activity: '编程' },
      { pattern: /( 阅读 | 看书 | 学习)/i, activity: '阅读' },
      { pattern: /( 游戏 | 玩游戏 | 打游戏)/i, activity: '游戏' },
      { pattern: /( 运动 | 健身 | 跑步)/i, activity: '运动' },
      { pattern: /( 做饭 | 买菜 | 吃饭)/i, activity: '烹饪' },
    ]
    
    const foundActivities: string[] = []
    const textLower = text.toLowerCase()
    
    activityPatterns.forEach(({ pattern, activity }) => {
      if (pattern.test(textLower)) {
        foundActivities.push(activity)
      }
    })
    
    return foundActivities
  }

  /**
   * 归一化分数到 0-1
   */
  private normalizeScores(scores: Record<string, number>): Record<string, number> {
    const max = Math.max(...Object.values(scores))
    if (max === 0) return scores
    
    const normalized: Record<string, number> = {}
    Object.entries(scores).forEach(([key, value]) => {
      normalized[key] = value / max
    })
    
    return normalized
  }

  /**
   * 记录用户对推荐项的交互
   */
  recordInteraction(itemId: string, userId: string): void {
    if (!this.itemInteractions.has(itemId)) {
      this.itemInteractions.set(itemId, new Set())
    }
    this.itemInteractions.get(itemId)!.add(userId)
  }

  /**
   * 获取用户画像
   */
  getUserProfile(userId: string): UserInterestProfile | undefined {
    return this.userProfiles.get(userId)
  }

  /**
   * 清除用户数据
   */
  clearUserData(userId: string): void {
    this.userProfiles.delete(userId)
  }

  /**
   * 清空所有数据
   */
  clearAll(): void {
    this.userProfiles.clear()
    this.itemInteractions.clear()
  }
}

// ============ 单例 ============

let instance: MemoryRecommendationEngine | null = null

export function getMemoryRecommendationEngine(
  config?: Partial<typeof DEFAULT_CONFIG>,
): MemoryRecommendationEngine {
  if (!instance) {
    instance = new MemoryRecommendationEngine(config)
  }
  return instance
}

export function resetMemoryRecommendationEngine(): void {
  if (instance) {
    instance.clearAll()
    instance = null
  }
}

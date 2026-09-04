/**
 * Mod创作者激励体系模块
 *
 * @fileoverview 实现模组创作者等级系统、排行榜与收益分享框架
 *
 * 主要模块：
 * - CreatorLevel/CreatorProfile: 创作者等级与资料类型
 * - LevelThreshold: 等级阈值配置
 * - LeaderboardEntry: 排行榜条目
 * - CreatorIncentiveManager: 激励管理器主类
 *
 * 依赖关系：
 * - 无外部依赖（纯数据计算与管理）
 *
 * 核心接口：
 * - calculateLevel(): 根据下载量/评分计算创作者等级
 * - getLeaderboard(): 获取排行榜
 * - calculateRevenueShare(): 计算收益分成
 * - recordDownload()/recordRating(): 记录下载/评分事件
 *
 * 创作者等级：
 * - bronze: 青铜（新手创作者）
 * - silver: 白银
 * - gold: 黄金
 * - platinum: 铂金
 * - diamond: 钻石（顶级创作者）
 *
 * 核心功能：
 * 1. 等级系统：基于下载量和平均评分晋升
 * 2. 排行榜：按下载量/评分/收益排名
 * 3. 收益分享：按等级阶梯式分成比例
 */

// ============ 类型定义 ============

/** 创作者等级 */
export type CreatorLevel = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond'

/** 创作者资料 */
export interface CreatorProfile {
  /** 用户 ID */
  userId: string
  /** 用户名 */
  username: string
  /** 头像 URL */
  avatarUrl?: string
  /** 发布的模组数 */
  modCount: number
  /** 总下载量 */
  totalDownloads: number
  /** 平均评分 */
  averageRating: number
  /** 当前等级 */
  level: CreatorLevel
  /** 经验值 */
  experiencePoints: number
  /** 累计收益（分） */
  totalEarnings: number
  /** 注册时间 */
  joinedAt: string
}

/** 等级阈值配置 */
export interface LevelThreshold {
  level: CreatorLevel
  /** 最低下载量 */
  minDownloads: number
  /** 最低平均评分 */
  minRating: number
  /** 经验值倍率 */
  expMultiplier: number
  /** 收益分成比例 (0-1) */
  revenueShareRate: number
}

/** 排行榜条目 */
export interface LeaderboardEntry {
  rank: number
  userId: string
  username: string
  avatarUrl?: string
  score: number
  modCount: number
  level: CreatorLevel
}

/** 排行榜类型 */
export type LeaderboardType = 'downloads' | 'rating' | 'earnings' | 'newest'

// ============ 等级阈值配置 ============

const LEVEL_THRESHOLDS: LevelThreshold[] = [
  { level: 'bronze',   minDownloads: 0,     minRating: 0,   expMultiplier: 1.0, revenueShareRate: 0.3 },
  { level: 'silver',   minDownloads: 100,   minRating: 3.0, expMultiplier: 1.5, revenueShareRate: 0.4 },
  { level: 'gold',     minDownloads: 1000,  minRating: 3.5, expMultiplier: 2.0, revenueShareRate: 0.5 },
  { level: 'platinum', minDownloads: 5000,  minRating: 4.0, expMultiplier: 3.0, revenueShareRate: 0.6 },
  { level: 'diamond',  minDownloads: 20000, minRating: 4.5, expMultiplier: 5.0, revenueShareRate: 0.7 },
]

// ============ 创作者激励管理器 ============

export class ModCreatorIncentiveManager {
  private profiles = new Map<string, CreatorProfile>()

  /**
   * 计算创作者等级
   * 基于下载量和评分的综合判断
   */
  calculateLevel(downloads: number, rating: number): CreatorLevel {
    let level: CreatorLevel = 'bronze'
    for (const threshold of LEVEL_THRESHOLDS) {
      if (downloads >= threshold.minDownloads && rating >= threshold.minRating) {
        level = threshold.level
      }
    }
    return level
  }

  /**
   * 获取等级阈值配置
   */
  getLevelThreshold(level: CreatorLevel): LevelThreshold {
    return LEVEL_THRESHOLDS.find((t) => t.level === level) ?? LEVEL_THRESHOLDS[0]
  }

  /**
   * 计算经验值增量
   * 下载量 + 评分贡献 + 模组数量贡献
   */
  calculateExpGain(event: 'download' | 'rating' | 'publish', value?: number): number {
    const baseExp: Record<string, number> = {
      download: 1,
      rating: 10,
      publish: 50,
    }
    return Math.round((baseExp[event] ?? 1) * (value ?? 1))
  }

  /**
   * 计算收益分成
   * @param grossRevenue 总收益（分）
   * @param level 创作者等级
   * @returns 创作者应得收益（分）
   */
  calculateRevenueShare(grossRevenue: number, level: CreatorLevel): number {
    const threshold = this.getLevelThreshold(level)
    return Math.round(grossRevenue * threshold.revenueShareRate)
  }

  /**
   * 获取或创建创作者资料
   */
  getOrCreateProfile(userId: string, username: string): CreatorProfile {
    let profile = this.profiles.get(userId)
    if (!profile) {
      profile = {
        userId,
        username,
        modCount: 0,
        totalDownloads: 0,
        averageRating: 0,
        level: 'bronze',
        experiencePoints: 0,
        totalEarnings: 0,
        joinedAt: new Date().toISOString(),
      }
      this.profiles.set(userId, profile)
    }
    return profile
  }

  /**
   * 更新创作者统计并重新计算等级
   */
  updateProfile(userId: string, updates: {
    modCount?: number
    totalDownloads?: number
    averageRating?: number
    totalEarnings?: number
  }): CreatorProfile | null {
    const profile = this.profiles.get(userId)
    if (!profile) return null

    if (updates.modCount !== undefined) profile.modCount = updates.modCount
    if (updates.totalDownloads !== undefined) profile.totalDownloads = updates.totalDownloads
    if (updates.averageRating !== undefined) profile.averageRating = updates.averageRating
    if (updates.totalEarnings !== undefined) profile.totalEarnings = updates.totalEarnings

    // 重新计算等级
    profile.level = this.calculateLevel(profile.totalDownloads, profile.averageRating)

    return profile
  }

  /**
   * 生成排行榜
   * @param type 排行榜类型
   * @param limit 条目数量
   */
  generateLeaderboard(type: LeaderboardType, limit = 50): LeaderboardEntry[] {
    const profiles = Array.from(this.profiles.values())

    const sorted = profiles.sort((a, b) => {
      switch (type) {
        case 'downloads':
          return b.totalDownloads - a.totalDownloads
        case 'rating':
          return b.averageRating - a.averageRating
        case 'earnings':
          return b.totalEarnings - a.totalEarnings
        case 'newest':
          return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime()
        default:
          return 0
      }
    })

    return sorted.slice(0, limit).map((p, i) => ({
      rank: i + 1,
      userId: p.userId,
      username: p.username,
      avatarUrl: p.avatarUrl,
      score:
        type === 'downloads' ? p.totalDownloads :
        type === 'rating' ? Math.round(p.averageRating * 100) :
        type === 'earnings' ? p.totalEarnings :
        0,
      modCount: p.modCount,
      level: p.level,
    }))
  }

  /**
   * 获取所有等级阈值
   */
  getAllLevelThresholds(): LevelThreshold[] {
    return [...LEVEL_THRESHOLDS]
  }
}

// ============ 单例 ============

let sharedManager: ModCreatorIncentiveManager | null = null

export function getModCreatorIncentiveManager(): ModCreatorIncentiveManager {
  if (!sharedManager) {
    sharedManager = new ModCreatorIncentiveManager()
  }
  return sharedManager
}

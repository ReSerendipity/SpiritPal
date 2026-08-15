/**
 * 排行榜面板组件
 *
 * 功能概述：
 * - 单机本地排行榜，对比用户拥有的各角色养成数据
 * - 按亲密度降序排列
 * - 展示角色名称、主题色、亲密度、等级、成就数、等级徽章
 * - 前三名特殊高亮显示（金/银/铜配色）
 *
 * 核心Hooks/状态：
 * - useMemo: 计算排序后的角色排名数据
 * - usePetStore: 角色统计数据、徽章获取方法
 *
 * 使用模块：
 * - characters: 获取所有可用角色
 * - achievementSystem: 获取已解锁成就
 */
import { useMemo } from 'react'
import { usePetStore } from '../stores/petStore'
import { getAllCharacters } from '../lib/characters'
import { getAchievementManager } from '../lib/achievementSystem'

const selectStats = (s: ReturnType<typeof usePetStore.getState>) => s.stats
const selectGetBadge = (s: ReturnType<typeof usePetStore.getState>) => s.getBadge

/** 角色排名数据 */
interface CharacterRank {
  /** 角色ID */
  id: string
  /** 显示名称 */
  name: string
  /** 主题色 */
  themeColor: string
  /** 亲密度 */
  affection: number
  /** 等级 */
  level: number
  /** 成就数量 */
  achievementCount: number
  /** 等级徽章 */
  badge: string
}

/**
 * 本地排行榜面板
 *
 * 展示所有已拥有角色的养成进度排名，按亲密度排序。
 */
export function LeaderboardPanel() {
  const stats = usePetStore(selectStats)
  const getBadge = usePetStore(selectGetBadge)

  const rankings = useMemo(() => {
    const characters = getAllCharacters()
    const achievementMgr = getAchievementManager()

    const allAchievements = achievementMgr.getUnlockedAchievements()

    const ranks: CharacterRank[] = characters.map((char) => {
      const charStats = stats[char.id]
      return {
        id: char.id,
        name: char.displayName,
        themeColor: char.themeColor.primary,
        affection: charStats?.affection ?? 0,
        level: charStats?.level ?? 1,
        achievementCount: allAchievements.length,
        badge: getBadge(charStats?.level ?? 1),
      }
    })

    // 按亲密度降序排列
    return ranks.sort((a, b) => b.affection - a.affection)
  }, [stats, getBadge])

  return (
    <div className="w-full rounded-xl bg-surface/95 p-3 text-white shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">🏆 排行榜</span>
        <span className="text-xs text-ink-muted">按亲密度排序</span>
      </div>

      <div className="space-y-2">
        {rankings.map((rank, index) => (
          <div
            key={rank.id}
            className={`flex items-center gap-3 rounded-lg p-2 ${
              index === 0 ? 'bg-amber-500/20 ring-1 ring-amber-500/30' : 'bg-cream-deep/60'
            }`}
          >
            {/* 排名 */}
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
              index === 0 ? 'bg-amber-500 text-gray-900' :
              index === 1 ? 'bg-gray-400 text-gray-900' :
              index === 2 ? 'bg-amber-700 text-white' :
              'bg-ink-faint text-ink'
            }`}>
              {index + 1}
            </div>

            {/* 角色信息 */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span style={{ color: rank.themeColor }}>●</span>
                <span className="truncate text-sm font-medium">{rank.name}</span>
                <span className="text-xs text-ink-muted">{rank.badge}</span>
              </div>
              <div className="mt-0.5 flex gap-3 text-[11px] text-ink-muted">
                <span>亲密度 <span className="text-pink-400">{rank.affection}</span></span>
                <span>等级 <span className="text-amber-400">Lv.{rank.level}</span></span>
                <span>成就 <span className="text-purple-400">{rank.achievementCount}</span></span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {rankings.length === 0 && (
        <div className="py-8 text-center text-sm text-ink-muted">
          暂无角色数据
        </div>
      )}
    </div>
  )
}

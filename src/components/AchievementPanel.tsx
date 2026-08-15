/**
 * 成就/徽章面板组件
 *
 * 功能概述：
 * - 显示已解锁和未解锁的成就列表，按类别分组展示
 * - 展示成就进度条和奖励信息
 * - 显示徽章等级系统（无星→星→月→日→皇冠）
 * - 提供个人数据统计排行榜视图
 * - 实时同步成就管理器状态变化
 *
 * 核心Hooks/状态：
 * - usePetStore: 获取当前角色ID和属性统计数据
 * - useState: 管理当前标签页（成就/排行榜）、强制刷新
 * - useEffect: 监听成就管理器变化、更新最大亲密度等级
 *
 * 使用模块：
 * - achievementSystem: 成就管理器，提供成就定义、解锁检测、进度计算
 */
import { useEffect, useState } from 'react'
import { Trophy, TrendingUp, Award } from 'lucide-react'
import {
  getAchievementManager,
  ACHIEVEMENTS,
  BADGE_NAMES,
  BADGE_COLORS,
} from '../lib/achievementSystem'
import { usePetStore } from '../stores/petStore'

const selectStats = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]

type ViewTab = 'achievements' | 'ranking'

/**
 * 成就面板组件
 *
 * 展示成就系统和个人数据统计，支持成就/排行榜两个标签页切换。
 * 成就按互动、养成、专注、收集、特殊五个类别分组显示，
 * 未解锁成就显示进度条，已解锁成就高亮并显示奖励金币。
 */
export function AchievementPanel() {
  const stats = usePetStore(selectStats)
  const [tab, setTab] = useState<ViewTab>('achievements')
  const [, forceUpdate] = useState({})

  const mgr = getAchievementManager()

  useEffect(() => {
    const unsub = mgr.onChange(() => forceUpdate({}))
    return unsub
  }, [mgr])

  // 更新最大亲密度等级
  useEffect(() => {
    if (stats) {
      mgr.updateMaxAffectionLevel(stats)
    }
  }, [stats, mgr])

  const unlocked = mgr.getUnlockedAchievements()
  const rankingData = mgr.getRankingData()

  // 按类别分组
  const categories: Record<string, { label: string; icon: string }> = {
    interaction: { label: '互动', icon: '👆' },
    nurturing: { label: '养成', icon: '💛' },
    focus: { label: '专注', icon: '🍅' },
    collection: { label: '收集', icon: '🛒' },
    special: { label: '特殊', icon: '🌟' },
  }

  return (
    <div className="space-y-4">
      {/* Tab 切换 */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab('achievements')}
          className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            tab === 'achievements' ? 'bg-amber-400 text-gray-900' : 'bg-surface text-ink hover:bg-cream-deep'
          }`}
        >
          <Trophy size={14} /> 成就
        </button>
        <button
          onClick={() => setTab('ranking')}
          className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            tab === 'ranking' ? 'bg-amber-400 text-gray-900' : 'bg-surface text-ink hover:bg-cream-deep'
          }`}
        >
          <TrendingUp size={14} /> 排行榜
        </button>
      </div>

      {tab === 'achievements' && (
        <>
          {/* 统计概览 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-amber-900/30 p-2 text-center">
              <div className="text-xs text-amber-300">已解锁</div>
              <div className="text-lg font-bold text-amber-200">{unlocked.length}</div>
            </div>
            <div className="rounded-lg bg-cream-deep/40 p-2 text-center">
              <div className="text-xs text-ink-muted">总数</div>
              <div className="text-lg font-bold text-ink">{ACHIEVEMENTS.length}</div>
            </div>
            <div className="rounded-lg bg-green-900/30 p-2 text-center">
              <div className="text-xs text-green-300">完成率</div>
              <div className="text-lg font-bold text-green-200">
                {Math.round((unlocked.length / ACHIEVEMENTS.length) * 100)}%
              </div>
            </div>
          </div>

          {/* 徽章等级 */}
          <div className="rounded-lg bg-surface p-3">
            <div className="mb-2 flex items-center gap-2">
              <Award size={14} className="text-amber-400" />
              <span className="text-xs font-semibold text-amber-300">徽章等级</span>
            </div>
            <div className="flex justify-around">
              {(['none', 'star', 'moon', 'sun', 'crown'] as const).map((tier) => (
                <div key={tier} className="text-center">
                  <div
                    className="mx-auto mb-1 h-6 w-6 rounded-full"
                    style={{ background: BADGE_COLORS[tier] }}
                  />
                  <span className="text-[10px] text-ink-muted">{BADGE_NAMES[tier]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 成就列表（按类别） */}
          {Object.entries(categories).map(([catKey, catInfo]) => {
            const catAchievements = ACHIEVEMENTS.filter((a) => a.category === catKey)
            if (catAchievements.length === 0) return null
            return (
              <div key={catKey}>
                <div className="mb-2 text-xs font-semibold text-ink-muted">
                  {catInfo.icon} {catInfo.label}
                </div>
                <div className="space-y-1.5">
                  {catAchievements.map((ach) => {
                    const isUnlocked = unlocked.some((u) => u.id === ach.id)
                    const progress = mgr.getProgress(ach)
                    return (
                      <div
                        key={ach.id}
                        className={`flex items-center gap-2 rounded-lg p-2 ${
                          isUnlocked ? 'bg-amber-900/20 border border-amber-500/20' : 'bg-surface/60'
                        }`}
                      >
                        <div className={`text-xl ${isUnlocked ? '' : 'opacity-30 grayscale'}`}>
                          {isUnlocked ? ach.icon : '🔒'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className={`text-sm font-medium ${isUnlocked ? 'text-amber-200' : 'text-ink-muted'}`}>
                              {ach.name}
                            </span>
                            {ach.reward && (
                              <span className="text-[10px] text-amber-400">+{ach.reward}🪙</span>
                            )}
                          </div>
                          <div className="text-[11px] text-ink-muted">{ach.description}</div>
                          {!isUnlocked && progress > 0 && (
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-cream-deep">
                              <div
                                className="h-full rounded-full bg-amber-400 transition-all"
                                style={{ width: `${progress * 100}%` }}
                              />
                            </div>
                          )}
                        </div>
                        <div
                          className="h-2 w-2 rounded-full"
                          style={{ background: BADGE_COLORS[ach.tier] }}
                          title={BADGE_NAMES[ach.tier]}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </>
      )}

      {tab === 'ranking' && (
        <div className="space-y-3">
          <div className="rounded-lg bg-surface p-3">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp size={16} className="text-amber-400" />
              <span className="text-sm font-semibold">个人数据统计</span>
            </div>
            <div className="space-y-2">
              {rankingData.map((item, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-cream-deep/50 px-3 py-2">
                  <span className="text-xs text-ink">{item.name}</span>
                  <span className="text-sm font-bold text-amber-300 tabular-nums">
                    {item.value.toLocaleString()} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 角色数据对比 */}
          <div className="rounded-lg bg-surface p-3">
            <div className="mb-2 text-xs font-semibold text-ink-muted">当前角色状态</div>
            {stats && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded bg-cream-deep/50 px-2 py-1 text-center">
                  <div className="text-[10px] text-ink-muted">等级</div>
                  <div className="text-sm font-bold text-amber-300">Lv.{stats.level}</div>
                </div>
                <div className="rounded bg-cream-deep/50 px-2 py-1 text-center">
                  <div className="text-[10px] text-ink-muted">亲密度</div>
                  <div className="text-sm font-bold text-pink-300">{stats.affection}</div>
                </div>
                <div className="rounded bg-cream-deep/50 px-2 py-1 text-center">
                  <div className="text-[10px] text-ink-muted">饱食度</div>
                  <div className="text-sm font-bold text-green-300">{Math.round(stats.hunger)}</div>
                </div>
                <div className="rounded bg-cream-deep/50 px-2 py-1 text-center">
                  <div className="text-[10px] text-ink-muted">心情</div>
                  <div className="text-sm font-bold text-blue-300">{Math.round(stats.mood)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

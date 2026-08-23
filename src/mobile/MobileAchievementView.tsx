/**
 * 移动端成就子视图组件
 * @module mobile/MobileAchievementView
 * @description
 * 移动端成就界面：成就列表（按类别分组 + 进度 + 奖励）与
 * 个人数据排行榜，徽章等级展示。
 *
 * 数据与桌面端同源（achievementSystem / petStore），视觉沿用语义 Token。
 *
 * @see {@link ./MobileNurturingView} 移动端养成视图（宿主）
 * @see {@link ../lib/achievementSystem} 成就管理器
 */
import { useEffect, useState } from 'react'
import { Trophy, TrendingUp, Award, Lock } from 'lucide-react'
import {
  getAchievementManager,
  ACHIEVEMENTS,
  BADGE_NAMES,
  BADGE_COLORS,
  type Achievement,
} from '../lib/achievementSystem'
import { usePetStore } from '../stores/petStore'

/** 成就类别元信息 */
const CATEGORIES: Record<string, { label: string; icon: string }> = {
  interaction: { label: '互动', icon: '👆' },
  nurturing: { label: '养成', icon: '💛' },
  focus: { label: '专注', icon: '🍅' },
  collection: { label: '收集', icon: '🛒' },
  special: { label: '特殊', icon: '🌟' },
}

const selectStats = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]

/**
 * 移动端成就子视图
 * @returns 成就界面组件
 */
export function MobileAchievementView() {
  const stats = usePetStore(selectStats)
  const [tab, setTab] = useState<'achievements' | 'ranking'>('achievements')
  const [, forceUpdate] = useState({})

  const mgr = getAchievementManager()

  // 成就状态变化时刷新
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
  const unlockedIds = new Set(unlocked.map((u) => u.id))
  const rankingData = mgr.getRankingData()

  // 主题样式类（与移动端其他视图一致的语义 Token 配色）
  const cardBgClass = 'bg-surface'
  const cardBorderClass = 'border-ink/10'
  const subTextClass = 'text-ink-muted'
  const subTabActiveClass = 'bg-tangerine text-white'
  const subTabInactiveClass = 'bg-cream-deep text-ink-muted'

  function AchievementRow({ ach }: { ach: Achievement }) {
    const isUnlocked = unlockedIds.has(ach.id)
    const progress = mgr.getProgress(ach)
    return (
      <div
        className={`flex items-center gap-2.5 rounded-xl border p-2.5 ${
          isUnlocked
            ? 'border-tangerine/30 bg-tangerine-soft/60'
            : `${cardBorderClass} ${cardBgClass}`
        }`}
      >
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-cream-deep text-lg ${isUnlocked ? '' : 'opacity-40 grayscale'}`}>
          {isUnlocked ? ach.icon : <Lock size={16} className="text-ink-faint" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className={`truncate text-sm font-medium ${isUnlocked ? 'text-ink' : subTextClass}`}>
              {ach.name}
            </span>
            {ach.reward ? (
              <span className="flex-shrink-0 text-[10px] text-amber-500">+{ach.reward}🪙</span>
            ) : null}
          </div>
          <div className={`truncate text-[11px] ${subTextClass}`}>{ach.description}</div>
          {!isUnlocked && progress > 0 && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-cream-deep">
              <div
                className="h-full rounded-full bg-tangerine transition-all"
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div
          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ background: BADGE_COLORS[ach.tier] }}
          title={BADGE_NAMES[ach.tier]}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 子页切换 */}
      <div className="flex gap-1">
        {([
          { id: 'achievements', label: '成就', icon: Trophy },
          { id: 'ranking', label: '排行榜', icon: TrendingUp },
        ] as const).map((t) => {
          const Icon = t.icon
          const isActive = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors ${
                isActive ? subTabActiveClass : subTabInactiveClass
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'achievements' && (
        <>
          {/* 统计概览 */}
          <div className="grid grid-cols-3 gap-2">
            <div className={`rounded-xl border ${cardBorderClass} ${cardBgClass} p-2 text-center`}>
              <div className={`text-[11px] ${subTextClass}`}>已解锁</div>
              <div className="text-lg font-bold text-tangerine">{unlocked.length}</div>
            </div>
            <div className={`rounded-xl border ${cardBorderClass} ${cardBgClass} p-2 text-center`}>
              <div className={`text-[11px] ${subTextClass}`}>总数</div>
              <div className="text-lg font-bold text-ink">{ACHIEVEMENTS.length}</div>
            </div>
            <div className={`rounded-xl border ${cardBorderClass} ${cardBgClass} p-2 text-center`}>
              <div className={`text-[11px] ${subTextClass}`}>完成率</div>
              <div className="text-lg font-bold text-ink">
                {Math.round((unlocked.length / Math.max(1, ACHIEVEMENTS.length)) * 100)}%
              </div>
            </div>
          </div>

          {/* 徽章等级 */}
          <div className={`rounded-xl border ${cardBorderClass} ${cardBgClass} p-3`}>
            <div className="mb-2 flex items-center gap-2">
              <Award size={14} className="text-tangerine" />
              <span className="text-xs font-semibold text-ink">徽章等级</span>
            </div>
            <div className="flex justify-around">
              {(['none', 'star', 'moon', 'sun', 'crown'] as const).map((tier) => (
                <div key={tier} className="text-center">
                  <div
                    className="mx-auto mb-1 h-6 w-6 rounded-full"
                    style={{ background: BADGE_COLORS[tier] }}
                  />
                  <span className={`text-[10px] ${subTextClass}`}>{BADGE_NAMES[tier]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 成就列表（按类别） */}
          {Object.entries(CATEGORIES).map(([catKey, catInfo]) => {
            const catAchievements = ACHIEVEMENTS.filter((a) => a.category === catKey)
            if (catAchievements.length === 0) return null
            return (
              <div key={catKey}>
                <div className={`mb-1.5 text-xs font-semibold ${subTextClass}`}>
                  {catInfo.icon} {catInfo.label}
                </div>
                <div className="space-y-1.5">
                  {catAchievements.map((ach) => (
                    <AchievementRow key={ach.id} ach={ach} />
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}

      {tab === 'ranking' && (
        <div className="space-y-3">
          {/* 个人数据统计 */}
          <div className={`rounded-xl border ${cardBorderClass} ${cardBgClass} p-3`}>
            <div className="mb-2 flex items-center gap-2">
              <TrendingUp size={14} className="text-tangerine" />
              <span className="text-sm font-semibold text-ink">个人数据统计</span>
            </div>
            <div className="space-y-1.5">
              {rankingData.map((item, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-cream-deep px-3 py-2">
                  <span className="text-xs text-ink">{item.name}</span>
                  <span className="text-sm font-bold text-tangerine tabular-nums">
                    {item.value.toLocaleString()} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 当前角色状态 */}
          <div className={`rounded-xl border ${cardBorderClass} ${cardBgClass} p-3`}>
            <div className={`mb-2 text-xs font-semibold ${subTextClass}`}>当前角色状态</div>
            {stats && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-cream-deep px-2 py-1.5 text-center">
                  <div className={`text-[10px] ${subTextClass}`}>等级</div>
                  <div className="text-sm font-bold text-tangerine">Lv.{stats.level}</div>
                </div>
                <div className="rounded-lg bg-cream-deep px-2 py-1.5 text-center">
                  <div className={`text-[10px] ${subTextClass}`}>亲密度</div>
                  <div className="text-sm font-bold text-blush">{Math.floor(stats.affection)}</div>
                </div>
                <div className="rounded-lg bg-cream-deep px-2 py-1.5 text-center">
                  <div className={`text-[10px] ${subTextClass}`}>饱食度</div>
                  <div className="text-sm font-bold text-success-deep">{Math.round(stats.hunger)}</div>
                </div>
                <div className="rounded-lg bg-cream-deep px-2 py-1.5 text-center">
                  <div className={`text-[10px] ${subTextClass}`}>心情</div>
                  <div className="text-sm font-bold text-tangerine-deep">{Math.round(stats.mood)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

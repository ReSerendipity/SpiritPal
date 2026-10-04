/**
 * 移动端养成视图组件
 * @module mobile/MobileNurturingView
 * @description
 * 移动端养成系统界面，展示四维属性、经验等级、商店、背包。
 *
 * 子页面：
 * - 属性：饱食度、心情、健康进度条，养成信息统计
 * - 商店：展示可购买物品，按角色偏好过滤
 * - 背包：展示已拥有物品，支持使用
 *
 * @see {@link ../stores/petStore} 宠物养成状态 Store
 * @see {@link ../lib/items} 物品配置模块
 */
import { useEffect, useRef, useState } from 'react'
import { Heart, ShoppingBag, Backpack, Trophy, Coins, Sparkles, Timer, Play, Pause, Square, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getCharacter } from '@/lib/data/characters'
import type { BadgeTier } from '@/lib/data/types'
import { getAchievementManager } from '@/lib/nurture/achievementSystem'
import { POMODORO_DURATIONS, getPomodoroManager, type PomodoroSnapshot } from '@/lib/nurture/pomodoroManager'
import { formatRelativeTime } from '@/lib/system/i18n'
import { MobileAchievementView } from '@/mobile/MobileAchievementView'
import { MobileInventoryView } from '@/mobile/MobileInventoryView'
import { MobileShopView } from '@/mobile/MobileShopView'
import { usePetStore, POMODORO_EXP_GAIN } from '@/stores/petStore'

/** 子 Tab 类型 */
type SubTab = 'stats' | 'shop' | 'inventory' | 'achievement' | 'focus'

/** 番茄钟默认时长（分钟） */
const DEFAULT_FOCUS_MINUTES = 25
/** 「已结束专注」提示停留时长（毫秒） */
const STOP_HINT_MS = 2500

/** 属性颜色等级映射 */
const TIER_COLORS: Record<string, string> = {
  green: 'bg-stat-good',
  yellow: 'bg-stat-mid',
  orange: 'bg-warning',
  red: 'bg-error',
}

/** 徽章元信息映射 */
const BADGE_META: Record<BadgeTier, { labelKey: string; emoji: string; color: string }> = {
  none: { labelKey: 'badge.none', emoji: '⚪', color: 'text-badge-none' },
  star: { labelKey: 'badge.star', emoji: '⭐', color: 'text-badge-star' },
  moon: { labelKey: 'badge.moon', emoji: '🌙', color: 'text-badge-moon' },
  sun: { labelKey: 'badge.sun', emoji: '☀️', color: 'text-badge-sun' },
  crown: { labelKey: 'badge.crown', emoji: '👑', color: 'text-badge-crown' },
}

/**
 * 格式化相对时间（委托 i18n 的 Intl.RelativeTimeFormat，随语言本地化）
 * @param ts 时间戳（毫秒）
 * @returns 相对时间字符串（如 "5 分钟前"）
 */
function formatRelative(ts: number): string {
  return formatRelativeTime(new Date(ts))
}

/**
 * 移动端养成视图组件
 * @returns 养成界面组件
 */
export function MobileNurturingView() {
  const { t } = useTranslation()
  const stats = usePetStore((s) => s.getCurrentStats())
  const sharedCoins = usePetStore((s) => s.sharedCoins)
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const getBadge = usePetStore((s) => s.getBadge)
  const getColorTier = usePetStore((s) => s.getColorTier)
  const character = getCharacter(currentCharacterId)

  const [subTab, setSubTab] = useState<SubTab>('stats')

  // ===== 番茄钟（P1-6）：状态机放模块级单例，切 Tab 卸载组件也不丢计时 =====
  const [pomodoro, setPomodoro] = useState<PomodoroSnapshot>(() => getPomodoroManager().getSnapshot())
  const [focusMinutes, setFocusMinutes] = useState<number>(DEFAULT_FOCUS_MINUTES)
  const [stopHint, setStopHint] = useState(false)
  const stopHintTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (stopHintTimerRef.current !== null) clearTimeout(stopHintTimerRef.current)
  }, [])

  useEffect(() => {
    const mgr = getPomodoroManager()
    // 完成结算：发奖励 + 记成就，返回实际发放量供反馈展示
    mgr.setCompletionHandler((minutes) => {
      const coinsBefore = usePetStore.getState().sharedCoins
      usePetStore.getState().completePomodoro(minutes)
      getAchievementManager().recordPomodoro(minutes)
      // 金币增量含任务系统额外奖励；经验增量固定（升级时 exp 会清零，故不取差值）
      const coins = usePetStore.getState().sharedCoins - coinsBefore
      return { exp: POMODORO_EXP_GAIN, coins }
    })
    const unsub = mgr.subscribe((snapshot) => setPomodoro(snapshot))
    setPomodoro(mgr.getSnapshot())
    return unsub
  }, [])

  const badge = getBadge(stats.level)
  const badgeMeta = BADGE_META[badge]
  const expNeed = stats.level * 100
  const expPct = Math.min(100, (stats.exp / expNeed) * 100)

  // 主题样式类（与桌面端 NurturingPanel 一致的语义 Token 配色）
  const bgClass = 'bg-cream'
  const textClass = 'text-ink'
  const cardBgClass = 'bg-surface'
  const cardBorderClass = 'border-ink/10'
  const subTabActiveClass = 'bg-tangerine text-white'
  const subTabInactiveClass = 'bg-cream-deep text-ink-muted'

  // ===== 番茄钟派生值与控制 =====
  const focusRemain = Math.ceil(pomodoro.remainingSec)
  const focusMm = String(Math.floor(focusRemain / 60)).padStart(2, '0')
  const focusSs = String(focusRemain % 60).padStart(2, '0')
  const focusProgress =
    pomodoro.durationSec > 0 ? Math.min(1, pomodoro.elapsedSec / pomodoro.durationSec) : 0

  /** 开始 / 再来一轮 */
  const handleStartFocus = () => {
    setStopHint(false)
    getPomodoroManager().start(focusMinutes)
  }
  /** 暂停 */
  const handlePauseFocus = () => getPomodoroManager().pause()
  /** 继续 */
  const handleResumeFocus = () => getPomodoroManager().resume()
  /** 提前结束（不发放奖励），提示 2.5s 后自动消失 */
  const handleStopFocus = () => {
    getPomodoroManager().stop()
    setStopHint(true)
    if (stopHintTimerRef.current !== null) clearTimeout(stopHintTimerRef.current)
    stopHintTimerRef.current = window.setTimeout(() => setStopHint(false), STOP_HINT_MS)
  }
  /** 关闭完成反馈 */
  const handleDismissFocus = () => getPomodoroManager().reset()

  // 属性条配置
  const statBars = [
    { labelKey: 'stat.hunger', value: stats.hunger, icon: '🍖' },
    { labelKey: 'stat.mood', value: stats.mood, icon: '😊' },
    { labelKey: 'stat.health', value: stats.health, icon: '💚' },
  ]

  return (
    <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
      {/* 顶部：角色 + 等级 + 金币 */}
      <header className={`flex items-center justify-between border-b ${cardBorderClass} px-4 py-3`}>
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">{character?.displayName ?? t('tab.pet')}</span>
          <span className={`text-sm ${badgeMeta.color}`} title={t(badgeMeta.labelKey)}>
            {badgeMeta.emoji} Lv.{stats.level}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm text-tangerine-deep">
          <Coins size={14} />
          <span className="tabular-nums">{sharedCoins}</span>
        </div>
      </header>

      {/* 经验条 */}
      <div className={`px-4 py-2 ${cardBgClass} border-b ${cardBorderClass}`}>
        <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
          <span>{t('stat.exp')}</span>
          <span className="tabular-nums">{Math.floor(stats.exp)} / {expNeed}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream-deep">
          <div
            className="h-full rounded-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${expPct}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-ink-muted">
          {t('stat.affection')} {Math.floor(stats.affection)} · {t('nurture.lastInteraction')} {formatRelative(stats.lastInteractionAt)}
        </div>
      </div>

      {/* 子 Tab 切换 */}
      <div className="flex gap-1 p-2">
        {([
          { id: 'stats', labelKey: 'tab.stats', icon: Heart },
          { id: 'shop', labelKey: 'action.shop', icon: ShoppingBag },
          { id: 'inventory', labelKey: 'tab.inventory', icon: Backpack },
          { id: 'achievement', labelKey: 'tab.achievement', icon: Trophy },
          { id: 'focus', labelKey: 'tab.focus', icon: Timer },
        ] as const).map((tabDef) => {
          const Icon = tabDef.icon
          const isActive = subTab === tabDef.id
          return (
            <button
              key={tabDef.id}
              onClick={() => setSubTab(tabDef.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors ${
                isActive ? subTabActiveClass : subTabInactiveClass
              }`}
            >
              <Icon size={14} />
              {t(tabDef.labelKey)}
            </button>
          )
        })}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {/* 属性卡片 */}
        {subTab === 'stats' && (
          <div className="space-y-3">
            {statBars.map((stat) => {
              const tier = getColorTier(stat.value)
              const pct = Math.max(0, Math.min(100, stat.value))
              return (
                <div key={stat.labelKey} className={`rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg">{stat.icon}</span>
                      <span className="text-sm font-medium">{t(stat.labelKey)}</span>
                    </div>
                    <span className="text-sm tabular-nums text-ink-muted">{Math.round(stat.value)} / 100</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-cream-deep">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${TIER_COLORS[tier]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}

            {/* 互动统计 */}
            <div className={`rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
              <h3 className="mb-2 text-sm font-medium">{t('nurture.info')}</h3>
              <div className="space-y-1 text-xs text-ink-muted">
                <div className="flex justify-between">
                  <span>{t('nurture.currentLevel')}</span>
                  <span>Lv.{stats.level}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('stat.affection')}</span>
                  <span>{Math.floor(stats.affection)} / 9999</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('nurture.badge')}</span>
                  <span className={badgeMeta.color}>{badgeMeta.emoji} {t(badgeMeta.labelKey)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('nurture.lastInteraction')}</span>
                  <span>{formatRelative(stats.lastInteractionAt)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 商店 */}
        {subTab === 'shop' && (
          <div className="space-y-2">
            <div className="mb-1 flex items-center gap-1 text-xs text-ink-muted">
              <Sparkles size={12} />
              <span>{t('nurture.buyHint')}</span>
            </div>
            <MobileShopView />
          </div>
        )}

        {/* 背包 */}
        {subTab === 'inventory' && <MobileInventoryView />}

        {/* 成就 */}
        {subTab === 'achievement' && <MobileAchievementView />}

        {/* 专注 / 番茄钟（P1-6） */}
        {subTab === 'focus' && (
          <div className={`rounded-xl ${cardBgClass} border ${cardBorderClass} p-4`} data-testid="pomodoro-card">
            {/* 完成时：奖励反馈 */}
            {pomodoro.phase === 'done' ? (
              <div className="text-center" data-testid="pomodoro-done">
                <div className="mb-1 text-3xl">🎉</div>
                <div className="mb-1 text-base font-semibold text-tangerine-deep">
                  {t('pomodoro.completed')}
                </div>
                <div className="mb-2 text-xs text-ink-muted">{t('pomodoro.breakSuggestion')}</div>
                {pomodoro.reward && (
                  <div className="mb-3 text-sm tabular-nums" data-testid="pomodoro-reward">
                    {t('pomodoro.reward', { exp: pomodoro.reward.exp, coins: pomodoro.reward.coins })}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleStartFocus}
                    data-testid="pomodoro-again"
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-tangerine py-2 text-sm font-medium text-white"
                  >
                    <RotateCcw size={14} /> {t('pomodoro.again')}
                  </button>
                  <button
                    onClick={handleDismissFocus}
                    className="flex flex-1 items-center justify-center rounded-lg bg-cream-deep py-2 text-sm text-ink-muted"
                  >
                    {t('app.close')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <Timer size={16} className="text-tangerine-deep" />
                  <span className="text-sm font-semibold">{t('pomodoro.title')}</span>
                  {pomodoro.phase === 'paused' && (
                    <span className="rounded bg-cream-deep px-1.5 py-0.5 text-[10px] text-ink-muted">
                      {t('pomodoro.paused')}
                    </span>
                  )}
                </div>

                {/* 时长选择（进行中不可改） */}
                <div className="mb-1 text-xs text-ink-muted">{t('pomodoro.selectDuration')}</div>
                <div className="mb-3 grid grid-cols-4 gap-1">
                  {POMODORO_DURATIONS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setFocusMinutes(d)}
                      disabled={pomodoro.phase !== 'idle'}
                      data-testid={`pomodoro-duration-${d}`}
                      className={`rounded-md py-1.5 text-xs tabular-nums transition-colors disabled:opacity-40 ${
                        focusMinutes === d
                          ? 'bg-tangerine text-white'
                          : 'bg-cream-deep text-ink hover:bg-blush-soft'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                {/* 倒计时 + 进度 */}
                {pomodoro.phase !== 'idle' && (
                  <div className="mb-3">
                    <div className="mb-1 text-center text-2xl font-mono font-bold tabular-nums" data-testid="pomodoro-remaining">
                      {focusMm}:{focusSs}
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream-deep">
                      <div
                        className="h-full rounded-full bg-tangerine transition-all duration-500"
                        style={{ width: `${Math.min(100, focusProgress * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* 控制按钮：开始 / 暂停·继续 / 结束 */}
                <div className="flex gap-2">
                  {pomodoro.phase === 'idle' && (
                    <button
                      onClick={handleStartFocus}
                      data-testid="pomodoro-start"
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-tangerine py-2 text-sm font-medium text-white"
                    >
                      <Play size={14} /> {t('pomodoro.start')}
                    </button>
                  )}
                  {pomodoro.phase === 'running' && (
                    <button
                      onClick={handlePauseFocus}
                      data-testid="pomodoro-pause"
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-cream-deep py-2 text-sm text-ink"
                    >
                      <Pause size={14} /> {t('pomodoro.pause')}
                    </button>
                  )}
                  {pomodoro.phase === 'paused' && (
                    <button
                      onClick={handleResumeFocus}
                      data-testid="pomodoro-resume"
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-tangerine py-2 text-sm font-medium text-white"
                    >
                      <Play size={14} /> {t('pomodoro.resume')}
                    </button>
                  )}
                  {pomodoro.phase !== 'idle' && (
                    <button
                      onClick={handleStopFocus}
                      data-testid="pomodoro-stop"
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-error/90 py-2 text-sm text-white"
                    >
                      <Square size={14} /> {t('pomodoro.stop')}
                    </button>
                  )}
                </div>

                {stopHint && (
                  <div className="mt-2 text-center text-xs text-ink-muted" data-testid="pomodoro-stop-hint">
                    {t('pomodoro.stopped')}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

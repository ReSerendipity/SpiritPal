/**
 * @file MobileCommitmentBar.tsx
 * @description 到期/逾期约定提示条（审计工单 P1-7-fe）
 *
 * 聊天页与记忆页共用：两者都需要「主人有哪些约定该兑现了」的可见提示，
 * 桌面端靠 proactiveSpeak 主动开口，移动端没有常驻宠物窗口，需要显式 UI。
 *
 * 数据源：commitmentTracker.getDueTodayCommitments() / getOverdueCommitments()
 * （走 sp_commitments_due / sp_commitments_overdue，移动端已注册，见 P1-7-be）。
 * 无任何数据时不渲染（不留空条），失败静默降级。
 */
import { useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getCommitmentTracker, type Commitment } from '@/lib/nurture/commitmentTracker'
import { usePetStore } from '@/stores/petStore'

/** 自动刷新间隔（毫秒）：新约定落库后最多 30s 内可见 */
const REFRESH_INTERVAL_MS = 30 * 1000

export interface MobileCommitmentBarProps {
  /** 变化时触发重新加载（如聊天消息数，发完一轮立即刷新） */
  refreshKey?: number
}

/**
 * 到期/逾期约定提示条
 * @param props 组件属性
 * @returns 提示条组件；无数据返回 null
 */
export function MobileCommitmentBar({ refreshKey = 0 }: MobileCommitmentBarProps) {
  const { t } = useTranslation()
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const [due, setDue] = useState<Commitment[]>([])
  const [overdue, setOverdue] = useState<Commitment[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const tracker = getCommitmentTracker(currentCharacterId)
        const [dueList, overdueList] = await Promise.all([
          tracker.getDueTodayCommitments(),
          tracker.getOverdueCommitments(),
        ])
        if (cancelled) return
        // 防御：db 不可用时（如 Web 环境/存储未就绪）查询可能返回 undefined，
        // 直接存进 state 会让渲染期的 due.length 抛错并整棵树崩掉——统一收敛为数组。
        setDue(Array.isArray(dueList) ? dueList : [])
        setOverdue(Array.isArray(overdueList) ? overdueList : [])
        setLoaded(true)
      } catch {
        // 约定读取失败：静默不展示，不打扰对话
        if (!cancelled) setLoaded(true)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [currentCharacterId, refreshKey])

  if (!loaded || (due.length === 0 && overdue.length === 0)) return null

  const first = due[0] ?? overdue[0]

  return (
    <div
      data-testid="commitment-bar"
      className="flex items-center gap-2 rounded-lg border border-tangerine/30 bg-tangerine-soft/40 px-2.5 py-1.5 text-[11px]"
    >
      <CalendarClock size={13} className="shrink-0 text-tangerine-deep" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        {due.length > 0 && (
          <span data-testid="commitment-due" className="font-medium text-tangerine-deep">
            {t('commitment.dueToday', { count: due.length })}
          </span>
        )}
        {overdue.length > 0 && (
          <span data-testid="commitment-overdue" className="font-medium text-error">
            {t('commitment.overdue', { count: overdue.length })}
          </span>
        )}
        {first && <span className="truncate text-ink-muted">{first.content}</span>}
      </div>
    </div>
  )
}

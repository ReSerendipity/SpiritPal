/**
 * 功能未完善占位组件
 *
 * 用于尚未完成的功能页签（社区 / 排行等）。
 * 设计意图：明确告知用户该功能尚未上线，而不是展示 mock 假数据。
 */
import { Construction } from 'lucide-react'

interface FeatureComingSoonProps {
  /** 功能名称（如「社区形象」「排行榜」） */
  title: string
  /** 一句话说明该功能上线后会提供什么 */
  description: string
}

export function FeatureComingSoon({ title, description }: FeatureComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-panel border border-ink/10 bg-surface px-6 py-12 text-center shadow-soft">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink/5">
        <Construction size={22} className="text-ink-faint" aria-hidden="true" />
      </div>
      <div className="text-sm font-semibold text-ink">「{title}」功能尚未完善</div>
      <p className="max-w-[280px] text-xs leading-relaxed text-ink-muted">{description}</p>
      <div className="mt-1 rounded-full bg-cream-deep px-3 py-1 text-[11px] text-ink-faint">
        敬请期待后续版本
      </div>
    </div>
  )
}

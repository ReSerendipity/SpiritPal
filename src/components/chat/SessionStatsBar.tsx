/**
 * 会话级汇总统计条
 *
 * 显示在聊天窗口标题栏右侧，汇总当前会话的累计技术指标。
 * 点击可展开/收起详情。
 */
import { useState } from 'react'
import { Activity, ChevronDown, ChevronUp } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'

export function SessionStatsBar() {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const activeSessionByCharacter = useChatStore((s) => s.activeSessionByCharacter)
  const sessions = useChatStore((s) => s.sessions)
  const [expanded, setExpanded] = useState(false)

  const sessionId = activeSessionByCharacter[currentCharacterId]
  const session = (sessions[currentCharacterId] ?? []).find((s) => s.id === sessionId)

  if (!session || session.requestCount === 0) return null

  const totalTokens = session.totalPromptTokens + session.totalCompletionTokens
  const avgTokensPerReq = Math.round(totalTokens / session.requestCount)

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-ink-faint hover:bg-ink/6 hover:text-ink-muted transition-colors"
        title="会话统计"
      >
        <Activity size={11} />
        <span>{totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens} tok</span>
        <span className="opacity-40">·</span>
        <span>{session.requestCount} 次</span>
        {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
      </button>

      {expanded && (
        <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-ink/10 bg-surface p-2.5 shadow-lg text-[11px]">
          <div className="mb-1.5 font-medium text-ink">会话统计</div>
          <div className="space-y-1">
            <StatRow label="请求次数" value={String(session.requestCount)} />
            <StatRow label="输入 tokens" value={session.totalPromptTokens.toLocaleString()} />
            <StatRow label="输出 tokens" value={session.totalCompletionTokens.toLocaleString()} />
            <StatRow label="总 tokens" value={totalTokens.toLocaleString()} />
            <StatRow label="平均/次" value={avgTokensPerReq.toLocaleString()} />
          </div>
        </div>
      )}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-ink-faint">{label}</span>
      <span className="font-medium text-ink-muted">{value}</span>
    </div>
  )
}

/**
 * 会话列表抽屉组件
 *
 * 左侧滑出面板，展示当前角色的所有历史会话。
 * 支持新建、切换、删除、重命名、置顶操作。
 * 按日期分组（今天 / 昨天 / 更早），置顶会话始终在最前。
 */
import { useState, useCallback, useMemo } from 'react'
import { Plus, MessageSquare, Trash2, Pin, PinOff, MoreHorizontal, X, Check } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import type { ChatSession } from '@/lib/data/types'

interface SessionListProps {
  /** 关闭抽屉的回调 */
  onClose: () => void
}

/** 将时间戳格式化为分组标签 */
function getDateGroup(ts: number): string {
  const now = new Date()
  const date = new Date(ts)
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return '本周'
  if (diffDays < 30) return '本月'
  return '更早'
}

export function SessionList({ onClose }: SessionListProps) {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionByCharacter = useChatStore((s) => s.activeSessionByCharacter)
  const createSession = useChatStore((s) => s.createSession)
  const switchSession = useChatStore((s) => s.switchSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const renameSession = useChatStore((s) => s.renameSession)
  const togglePinSession = useChatStore((s) => s.togglePinSession)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)

  const activeId = activeSessionByCharacter[currentCharacterId] ?? ''

  // 排序后的会话列表（置顶优先，然后按 updatedAt 降序）
  const charSessions = useMemo(() => {
    const list = sessions[currentCharacterId] ?? []
    return [...list].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return b.updatedAt - a.updatedAt
    })
  }, [sessions, currentCharacterId])

  const handleNewSession = useCallback(() => {
    createSession()
    onClose()
  }, [createSession, onClose])

  const handleSwitch = useCallback((id: string) => {
    switchSession(id)
    onClose()
  }, [switchSession, onClose])

  const handleStartRename = useCallback((session: ChatSession) => {
    setRenamingId(session.id)
    setRenameValue(session.title)
    setMenuId(null)
  }, [])

  const handleConfirmRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      renameSession(renamingId, renameValue.trim())
    }
    setRenamingId(null)
  }, [renamingId, renameValue, renameSession])

  const handleDelete = useCallback((id: string) => {
    deleteSession(id)
    setMenuId(null)
  }, [deleteSession])

  const handlePin = useCallback((id: string) => {
    togglePinSession(id)
    setMenuId(null)
  }, [togglePinSession])

  // 按日期分组
  const groups: { label: string; sessions: ChatSession[] }[] = []
  let currentGroup = ''
  for (const session of charSessions) {
    const group = session.pinned ? '置顶' : getDateGroup(session.updatedAt)
    if (group !== currentGroup) {
      currentGroup = group
      groups.push({ label: group, sessions: [] })
    }
    groups[groups.length - 1]!.sessions.push(session)
  }

  return (
    <div className="flex h-full w-64 flex-col border-r border-ink/10 bg-cream-deep">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-medium text-ink">对话历史</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewSession}
            className="spiritpal-focusable rounded-md p-1.5 text-ink-faint hover:bg-tangerine/15 hover:text-tangerine-deep"
            title="新建对话"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={onClose}
            className="spiritpal-focusable rounded-md p-1.5 text-ink-faint hover:bg-ink/8"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-2 pb-2" onClick={() => setMenuId(null)}>
        {charSessions.length === 0 && (
          <div className="mt-8 text-center text-xs text-ink-faint">暂无历史对话</div>
        )}
        {groups.map((group) => (
          <div key={group.label}>
            <div className="sticky top-0 z-10 px-2 py-1 text-[11px] font-medium text-ink-faint bg-cream-deep/95">
              {group.label}
            </div>
            {group.sessions.map((session) => {
              const isActive = session.id === activeId
              const isRenaming = renamingId === session.id
              return (
                <div
                  key={session.id}
                  className={`group relative mb-0.5 flex items-center rounded-lg px-2 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-tangerine/12 text-tangerine-deep'
                      : 'text-ink hover:bg-ink/6'
                  }`}
                >
                  {isRenaming ? (
                    <div className="flex flex-1 items-center gap-1">
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleConfirmRename()
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="flex-1 rounded border border-tangerine/40 bg-surface px-1.5 py-0.5 text-xs focus:outline-none"
                        autoFocus
                      />
                      <button onClick={handleConfirmRename} className="text-tangerine-deep">
                        <Check size={12} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => handleSwitch(session.id)}
                        className="flex flex-1 items-center gap-1.5 truncate text-left"
                      >
                        <MessageSquare size={12} className="shrink-0 opacity-50" />
                        <span className="truncate">{session.title}</span>
                      </button>
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={(e) => { e.stopPropagation(); setMenuId(menuId === session.id ? null : session.id) }}
                          className="rounded p-0.5 text-ink-faint hover:bg-ink/10"
                        >
                          <MoreHorizontal size={12} />
                        </button>
                      </div>
                    </>
                  )}

                  {/* 操作菜单 */}
                  {menuId === session.id && !isRenaming && (
                    <div className="absolute right-2 top-full z-20 mt-1 w-28 rounded-lg border border-ink/10 bg-surface py-1 shadow-lg">
                      <button
                        onClick={() => handlePin(session.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ink hover:bg-ink/6"
                      >
                        {session.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                        {session.pinned ? '取消置顶' : '置顶'}
                      </button>
                      <button
                        onClick={() => handleStartRename(session)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ink hover:bg-ink/6"
                      >
                        <MessageSquare size={11} />
                        重命名
                      </button>
                      <button
                        onClick={() => handleDelete(session.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
                      >
                        <Trash2 size={11} />
                        删除
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

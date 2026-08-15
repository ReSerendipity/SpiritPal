/**
 * 日程管理面板组件
 *
 * 功能概述：
 * - 查看日程列表（按时间排序）
 * - 创建新日程（标题+触发时间）
 * - 删除日程、标记完成
 * - 友好时间格式化（今天/明天/M月D日 HH:MM）
 * - 订阅日程管理器变化自动刷新
 *
 * 核心Hooks/状态：
 * - useState: 日程列表、添加表单显示状态、新日程标题/时间
 * - useEffect: 初始化加载、订阅变化
 * - useCallback: 刷新日程列表
 *
 * 使用模块：
 * - scheduleManager: 日程管理器
 */
import { useEffect, useState } from 'react'
import { Plus, Trash2, Check, Calendar, Clock } from 'lucide-react'
import { getScheduleManager, type EnhancedScheduleEvent } from '../lib/scheduleManager'

/**
 * 日程管理面板
 *
 * 提供日程的增删查改界面，支持创建提醒和标记完成。
 */
export function SchedulePanel() {
  const mgr = getScheduleManager()
  // 初始值来自管理器快照（惰性初始化），避免在 effect 中同步 setState
  const [events, setEvents] = useState<EnhancedScheduleEvent[]>(() => mgr.getEvents())
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newTime, setNewTime] = useState('')

  useEffect(() => {
    // 仅订阅变更，回调由管理器在变更时触发（非同步 setState）
    return mgr.onChange(() => setEvents(mgr.getEvents()))
  }, [mgr])

  function handleAdd() {
    if (!newTitle.trim() || !newTime.trim()) return
    const triggerTime = new Date(newTime).getTime()
    if (isNaN(triggerTime) || triggerTime <= Date.now()) {
      alert('请输入有效的未来时间')
      return
    }
    mgr.addEvent({
      title: newTitle.trim(),
      triggerTime,
      source: 'manual',
      reminderMinutes: [5],
    })
    setNewTitle('')
    setNewTime('')
    setShowAdd(false)
  }

  function handleDelete(id: string) {
    mgr.removeEvent(id)
  }

  function handleComplete(id: string) {
    mgr.completeEvent(id)
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const isTomorrow = d.toDateString() === tomorrow.toDateString()

    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    if (isToday) return `今天 ${timeStr}`
    if (isTomorrow) return `明天 ${timeStr}`
    return `${d.getMonth() + 1}/${d.getDate()} ${timeStr}`
  }

  const pending = events.filter((e) => e.status === 'pending')
  const triggered = events.filter((e) => e.status === 'triggered')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">📅 日程管理</span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 rounded-lg bg-amber-500 px-2 py-1 text-xs text-gray-900 hover:bg-amber-400"
        >
          <Plus size={12} /> 添加
        </button>
      </div>

      {showAdd && (
        <div className="space-y-2 rounded-lg bg-surface p-3">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="日程标题"
            className="w-full rounded-lg bg-cream-deep px-3 py-1.5 text-sm text-white placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <input
            type="datetime-local"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            className="w-full rounded-lg bg-cream-deep px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              className="flex-1 rounded-lg bg-green-600 px-3 py-1.5 text-sm hover:bg-green-500"
            >
              确认
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="rounded-lg bg-cream-deep px-3 py-1.5 text-sm hover:bg-blush-soft"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 待处理日程 */}
      {pending.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] text-ink-muted">待处理（{pending.length}）</div>
          <div className="space-y-1.5">
            {pending.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg bg-surface p-2">
                <Clock size={14} className="flex-shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{e.title}</div>
                  <div className="text-[10px] text-ink-muted">
                    {formatTime(e.triggerTime)}
                    {e.source === 'chat' && <span className="ml-1 text-cyan-400">💬对话创建</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleComplete(e.id)}
                  className="flex-shrink-0 text-green-400 hover:text-green-300"
                  title="完成"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="flex-shrink-0 text-ink-muted hover:text-red-400"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 已触发/完成 */}
      {triggered.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] text-ink-muted">已提醒（{triggered.length}）</div>
          <div className="space-y-1.5">
            {triggered.slice(-5).map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg bg-surface/50 p-2 opacity-60">
                <Calendar size={14} className="flex-shrink-0 text-ink-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink-muted line-through">{e.title}</div>
                  <div className="text-[10px] text-ink-faint">{formatTime(e.triggerTime)}</div>
                </div>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="flex-shrink-0 text-ink-muted hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length === 0 && triggered.length === 0 && (
        <div className="py-8 text-center text-sm text-ink-muted">
          <Calendar size={32} className="mx-auto mb-2 opacity-30" />
          暂无日程
          <div className="mt-1 text-[11px]">也可以在聊天中说"X分钟后提醒我..."</div>
        </div>
      )}
    </div>
  )
}

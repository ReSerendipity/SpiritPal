// P3-1：schedules 表接线测试——迁移 / 镜像 / 空恢复
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSchedules, saveSchedule } from '@/lib/data/db'
import { ScheduleManager } from '@/lib/nurture/scheduleManager'

const deleteScheduleMock = vi.fn((_id: string) => Promise.resolve())
vi.mock('@/lib/data/db', () => ({
  getSchedules: vi.fn(() => Promise.resolve([])),
  saveSchedule: vi.fn(() => Promise.resolve()),
  deleteSchedule: (id: string) => deleteScheduleMock(id),
}))

// 通知插件（构造/checking 依赖）
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  isPermissionGranted: vi.fn(() => Promise.resolve(true)),
  requestPermission: vi.fn(() => Promise.resolve('granted')),
}))

vi.mock('@/lib/system/silentModeManager', () => ({
  getSilentModeManager: () => ({ isSilent: () => false }),
}))

describe('schedules 表接线（P3-1）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(getSchedules).mockResolvedValue([])
    vi.mocked(saveSchedule).mockResolvedValue(undefined)
  })

  it('首次运行：以 localStorage 种子逐条 upsert 到 DB（一次性迁移）', async () => {
    const seed = [
      {
        id: 'sched-1',
        title: '开会',
        triggerTime: Date.now() + 3600_000,
        reminderMinutes: [5],
        status: 'pending',
        source: 'chat',
      },
    ]
    localStorage.setItem('spiritpal-schedules', JSON.stringify(seed))

    const mgr = new ScheduleManager()
    // 等待异步 initDbSync 完成
    await vi.waitFor(() => {
      expect(saveSchedule).toHaveBeenCalled()
    })
    expect(saveSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sched-1', title: '开会', completed: false }),
    )
    expect(localStorage.getItem('spiritpal-schedules-db-migrated')).toBe('1')
    // 内存事件不受影响
    expect(mgr.getEvents()).toHaveLength(1)
  })

  it('已迁移且 localStorage 为空：以 DB 为源恢复日程并回写 localStorage', async () => {
    localStorage.setItem('spiritpal-schedules-db-migrated', '1')
    vi.mocked(getSchedules).mockResolvedValue([
      {
        id: 'sched-db-1',
        title: '从库恢复的日程',
        time: Date.now() + 7200_000,
        repeat: JSON.stringify({ type: 'daily', interval: 1 }),
        completed: false,
      },
    ])

    const mgr = new ScheduleManager()
    await vi.waitFor(() => {
      expect(mgr.getEvents()).toHaveLength(1)
    })
    const restored = mgr.getEvents()[0]
    expect(restored.id).toBe('sched-db-1')
    expect(restored.title).toBe('从库恢复的日程')
    expect(restored.repeatRule).toEqual({ type: 'daily', interval: 1 })
    expect(restored.status).toBe('pending')
    // 恢复后回写 localStorage
    const raw = JSON.parse(localStorage.getItem('spiritpal-schedules') ?? '[]')
    expect(raw).toHaveLength(1)
  })

  it('removeEvent 镜像调用 sp_schedules_delete（P3-1 收尾）', async () => {
    localStorage.setItem('spiritpal-schedules-db-migrated', '1')
    const mgr = new ScheduleManager()
    const id = mgr.addEvent({
      title: '待删除日程',
      triggerTime: Date.now() + 3600_000,
      reminderMinutes: [],
      source: 'manual',
    })
    await vi.waitFor(() => {
      expect(saveSchedule).toHaveBeenCalled()
    })
    vi.mocked(saveSchedule).mockClear()
    mgr.removeEvent(id)
    await vi.waitFor(() => {
      expect(deleteScheduleMock).toHaveBeenCalledWith(id)
    })
    expect(mgr.getEvents()).toHaveLength(0)
  })

  it('非法 DB 行（缺字段）被过滤，不进内存', async () => {
    localStorage.setItem('spiritpal-schedules-db-migrated', '1')
    vi.mocked(getSchedules).mockResolvedValue([
      { id: 'bad-1', title: '缺 time' },
      { title: '缺 id', time: 123 },
    ])
    const mgr = new ScheduleManager()
    await vi.waitFor(() => {
      // getSchedules 已调用且恢复流程走完
      expect(mgr.getEvents()).toHaveLength(0)
    })
  })
})

/**
 * @file pomodoroManager.ts
 * @description 番茄钟状态机（模块级单例）——移动端专注入口（审计工单 P1-6）
 *
 * 为什么是单例而不是组件内 useState：
 * 移动端 `MobileNurturingView` 在切换主 Tab 时会被卸载，而一次专注长达 15~60 分钟，
 * 计时状态不能随组件卸载丢失。桌面端把番茄钟状态放在 `PetWindow` 里（窗口常驻）没有这个问题。
 *
 * 计时基准：`elapsedSec = accumulatedSec + (running ? (now - segmentStartedAt)/1000 : 0)`，
 * 即「已完成段累计 + 当前段实时」，暂停只冻结当前段，恢复时重新起段。
 * 与 P1-5 的 tickDue 同理：不以定时器触发次数计时，而以真实时钟为准，
 * 因此 WebView 被后台节流后回到前台仍能算出正确进度。
 *
 * 奖励发放不在本模块内做（避免 lib 层直接依赖 store），由 UI 通过
 * `setCompletionHandler()` 注入结算回调，回调返回值会被记入 `reward` 供 UI 展示。
 */

/** 番茄钟阶段 */
export type PomodoroPhase = 'idle' | 'running' | 'paused' | 'done'

/** 完成奖励（增量） */
export interface PomodoroReward {
  /** 经验增量 */
  exp: number
  /** 金币增量（含任务系统额外奖励） */
  coins: number
}

/** 番茄钟快照（供 UI 渲染） */
export interface PomodoroSnapshot {
  /** 当前阶段 */
  phase: PomodoroPhase
  /** 计划总时长（秒） */
  durationSec: number
  /** 已累计专注秒数（暂停不计） */
  elapsedSec: number
  /** 剩余秒数 */
  remainingSec: number
  /** 计划总时长（分钟，用于奖励结算） */
  minutes: number
  /** 上一次完成的奖励；仅 phase==='done' 时有值 */
  reward: PomodoroReward | null
}

type Listener = (snapshot: PomodoroSnapshot) => void

/** 可选的专注时长档位（分钟），与桌面端 PomodoroPanel 保持一致 */
export const POMODORO_DURATIONS = [15, 25, 45, 60] as const

/** 默认专注时长（分钟） */
const DEFAULT_MINUTES = 25

/**
 * 番茄钟管理器
 */
class PomodoroManager {
  private phase: PomodoroPhase = 'idle'
  private durationSec = 0
  private minutes = DEFAULT_MINUTES
  /** 已完成段累计秒数（暂停时把当前段结算进来） */
  private accumulatedSec = 0
  /** 当前段开始时间戳（毫秒）；仅 running 阶段有意义 */
  private segmentStartedAt = 0
  private timerId: number | null = null
  private reward: PomodoroReward | null = null
  private listeners = new Set<Listener>()
  private completionHandler: ((minutes: number) => PomodoroReward) | null = null

  /**
   * 注入完成结算回调（发放经验/金币 + 成就记录）
   * @param handler 结算函数，返回实际发放的奖励
   */
  setCompletionHandler(handler: (minutes: number) => PomodoroReward): void {
    this.completionHandler = handler
  }

  /**
   * 订阅状态变化
   * @param listener 监听器
   * @returns 取消订阅函数
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 获取当前快照
   * @returns 快照对象（每次返回新对象，便于 useSyncExternalStore/useState 比较）
   */
  getSnapshot(): PomodoroSnapshot {
    const elapsedSec = Math.min(
      this.durationSec,
      this.accumulatedSec +
        (this.phase === 'running' ? (Date.now() - this.segmentStartedAt) / 1000 : 0),
    )
    return {
      phase: this.phase,
      durationSec: this.durationSec,
      elapsedSec,
      remainingSec: Math.max(0, this.durationSec - elapsedSec),
      minutes: this.minutes,
      reward: this.reward,
    }
  }

  /**
   * 开始一轮专注
   * @param minutes 时长（分钟）
   */
  start(minutes: number): void {
    this.stopTimer()
    this.minutes = minutes
    this.durationSec = minutes * 60
    this.accumulatedSec = 0
    this.segmentStartedAt = Date.now()
    this.reward = null
    this.phase = 'running'
    this.startTimer()
    this.emit()
  }

  /** 暂停（冻结当前段） */
  pause(): void {
    if (this.phase !== 'running') return
    this.accumulatedSec += (Date.now() - this.segmentStartedAt) / 1000
    this.stopTimer()
    this.phase = 'paused'
    this.emit()
  }

  /** 继续（重新起一段） */
  resume(): void {
    if (this.phase !== 'paused') return
    this.segmentStartedAt = Date.now()
    this.phase = 'running'
    this.startTimer()
    this.emit()
  }

  /**
   * 提前结束（不发放奖励）
   */
  stop(): void {
    this.stopTimer()
    this.phase = 'idle'
    this.durationSec = 0
    this.accumulatedSec = 0
    this.segmentStartedAt = 0
    this.reward = null
    this.emit()
  }

  /**
   * 关闭完成反馈、回到空闲（不清除 reward 之外的任何计时状态）
   */
  reset(): void {
    this.stopTimer()
    this.phase = 'idle'
    this.durationSec = 0
    this.accumulatedSec = 0
    this.segmentStartedAt = 0
    this.reward = null
    this.emit()
  }

  private startTimer(): void {
    this.stopTimer()
    this.timerId = window.setInterval(() => {
      this.tick()
    }, 1000)
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId)
      this.timerId = null
    }
  }

  private tick(): void {
    if (this.phase !== 'running') return
    const elapsed =
      this.accumulatedSec + (Date.now() - this.segmentStartedAt) / 1000
    if (elapsed >= this.durationSec) {
      this.finish()
      return
    }
    this.emit()
  }

  private finish(): void {
    this.stopTimer()
    this.accumulatedSec = this.durationSec
    this.phase = 'done'
    this.reward = this.completionHandler?.(this.minutes) ?? null
    this.emit()
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    this.listeners.forEach((l) => l(snapshot))
  }
}

let instance: PomodoroManager | null = null

/**
 * 获取番茄钟管理器单例
 * @returns 管理器实例
 */
export function getPomodoroManager(): PomodoroManager {
  if (!instance) instance = new PomodoroManager()
  return instance
}

/** 仅测试用：重置单例，避免用例间状态串味 */
export function __resetPomodoroManagerForTest(): void {
  instance?.stop()
  instance = null
}

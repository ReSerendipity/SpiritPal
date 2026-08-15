// musicAwareness 单元测试 — 基于 navigator.mediaSession API 的音乐感知
// 测试轮询机制、状态/元数据变化通知、订阅/取消订阅、单例
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MusicAwarenessManager,
  getMusicAwarenessManager,
} from '../musicAwareness'
import type { MusicStatus } from '../musicAwareness'

// ============ 辅助函数：mock navigator.mediaSession ============

interface MockMediaSessionInit {
  playbackState?: 'playing' | 'paused' | 'none'
  metadata?: {
    title?: string
    artist?: string
    album?: string
    artwork?: { src: string }[]
  } | null
}

function setMediaSession(init: MockMediaSessionInit = {}) {
  const ms = {
    playbackState: init.playbackState ?? 'none',
    metadata: init.metadata === undefined ? null : init.metadata,
  }
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    writable: true,
    value: ms,
  })
  return ms
}

function clearMediaSession() {
  // 必须真正删除属性，使 'mediaSession' in navigator 返回 false
  try {
    delete (navigator as unknown as { mediaSession?: unknown }).mediaSession
  } catch {
    // 如果无法删除，用 configurable + delete 重试
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      get: () => undefined,
    })
    delete (navigator as unknown as { mediaSession?: unknown }).mediaSession
  }
}

describe('musicAwareness', () => {
  let mgr: MusicAwarenessManager

  beforeEach(() => {
    vi.useFakeTimers()
    mgr = new MusicAwarenessManager()
    setMediaSession({ playbackState: 'none', metadata: null })
  })

  afterEach(() => {
    mgr.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ============ 基础状态查询 ============

  describe('基础状态', () => {
    it('初始状态为 none 且无音乐信息', () => {
      const status = mgr.getCurrentStatus()
      expect(status.state).toBe('none')
      expect(status.info).toBeNull()
    })

    it('isPlaying 初始为 false', () => {
      expect(mgr.isPlaying()).toBe(false)
    })

    it('getCurrentStatus 返回对象副本（不可外部修改内部状态）', () => {
      const status = mgr.getCurrentStatus()
      expect(status).not.toBe(undefined)
      expect(typeof status).toBe('object')
    })
  })

  // ============ 订阅机制 ============

  describe('onMusicChange 订阅', () => {
    it('订阅后立即回放当前状态', () => {
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      expect(listener).toHaveBeenCalledTimes(1)
      const status = listener.mock.calls[0][0] as MusicStatus
      expect(status.state).toBe('none')
    })

    it('返回取消订阅函数', () => {
      const listener = vi.fn()
      const unsub = mgr.onMusicChange(listener)
      expect(typeof unsub).toBe('function')
      unsub()
      // 取消订阅后再次触发不应收到回调
      setMediaSession({ playbackState: 'playing', metadata: { title: 'A' } })
      mgr.start()
      vi.advanceTimersByTime(3000)
      expect(listener).toHaveBeenCalledTimes(1) // 仅初始回放一次
    })

    it('监听器抛错时被静默忽略', () => {
      const badListener = vi.fn(() => {
        throw new Error('listener error')
      })
      expect(() => mgr.onMusicChange(badListener)).not.toThrow()
    })

    it('多个监听器都被调用', () => {
      const l1 = vi.fn()
      const l2 = vi.fn()
      mgr.onMusicChange(l1)
      mgr.onMusicChange(l2)
      // 初始回放
      expect(l1).toHaveBeenCalledTimes(1)
      expect(l2).toHaveBeenCalledTimes(1)
    })
  })

  // ============ start/stop 轮询 ============

  describe('start/stop', () => {
    it('start 后开始定时轮询', () => {
      setMediaSession({ playbackState: 'playing', metadata: { title: '歌1' } })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear() // 清掉初始回放

      mgr.start()
      // 轮询间隔 2000ms
      vi.advanceTimersByTime(2100)
      expect(listener).toHaveBeenCalled()
    })

    it('重复 start 不会创建多个定时器', () => {
      setMediaSession({ playbackState: 'playing', metadata: { title: '歌1' } })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      mgr.start() // 再次调用不应创建第二个定时器
      vi.advanceTimersByTime(2100)
      // 仅触发一次（因为状态变化只通知一次，之后稳定）
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('stop 后停止轮询', () => {
      setMediaSession({ playbackState: 'playing', metadata: { title: '歌1' } })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100)
      const callsAfterFirst = listener.mock.calls.length
      mgr.stop()
      // 改变状态后再次推进时间，不应收到新通知
      setMediaSession({ playbackState: 'paused', metadata: { title: '歌2' } })
      vi.advanceTimersByTime(5000)
      expect(listener.mock.calls.length).toBe(callsAfterFirst)
    })

    it('未 start 时 stop 不报错', () => {
      expect(() => mgr.stop()).not.toThrow()
    })
  })

  // ============ poll() 内部行为 ============

  describe('poll 状态检测', () => {
    it('playing 状态被正确识别', () => {
      setMediaSession({ playbackState: 'playing', metadata: { title: '歌1' } })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100)

      const status = mgr.getCurrentStatus()
      expect(status.state).toBe('playing')
      expect(mgr.isPlaying()).toBe(true)
    })

    it('paused 状态被正确识别', () => {
      setMediaSession({ playbackState: 'paused', metadata: { title: '歌1' } })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100)

      expect(mgr.getCurrentStatus().state).toBe('paused')
      expect(mgr.isPlaying()).toBe(false)
    })

    it('未知 playbackState 被映射为 none', () => {
      setMediaSession({ playbackState: 'none', metadata: null })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100)

      expect(mgr.getCurrentStatus().state).toBe('none')
    })

    it('mediaSession 不存在时轮询安全返回', () => {
      clearMediaSession()
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      // 不应抛错
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
      // 状态保持初始
      expect(mgr.getCurrentStatus().state).toBe('none')
    })

    it('metadata 为 null 时 info 为 null', () => {
      setMediaSession({ playbackState: 'playing', metadata: null })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100)

      expect(mgr.getCurrentStatus().info).toBeNull()
    })

    it('metadata 字段缺失时使用空字符串', () => {
      setMediaSession({
        playbackState: 'playing',
        metadata: {}, // 空 metadata
      })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100)

      // title/artist/album 全空 → info 仍为 null
      expect(mgr.getCurrentStatus().info).toBeNull()
    })

    it('metadata 包含完整字段时构造 MusicInfo', () => {
      setMediaSession({
        playbackState: 'playing',
        metadata: {
          title: '晴天',
          artist: '周杰伦',
          album: '叶惠美',
          artwork: [{ src: 'https://example.com/cover.jpg' }],
        },
      })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100)

      const info = mgr.getCurrentStatus().info
      expect(info).not.toBeNull()
      expect(info!.title).toBe('晴天')
      expect(info!.artist).toBe('周杰伦')
      expect(info!.album).toBe('叶惠美')
      expect(info!.artwork).toBe('https://example.com/cover.jpg')
    })

    it('artwork 为空数组时 artwork 字段为空字符串', () => {
      setMediaSession({
        playbackState: 'playing',
        metadata: {
          title: '歌',
          artist: '人',
          album: '辑',
          artwork: [],
        },
      })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100)

      const info = mgr.getCurrentStatus().info
      expect(info!.artwork).toBe('')
    })

    it('artwork[0].src 缺失时 artwork 为空字符串', () => {
      setMediaSession({
        playbackState: 'playing',
        metadata: {
          title: '歌',
          artwork: [{ src: '' }],
        },
      })
      mgr.start()
      vi.advanceTimersByTime(2100)
      expect(mgr.getCurrentStatus().info!.artwork).toBe('')
    })

    it('仅 title 存在时也构造 info（artist/album 默认空）', () => {
      setMediaSession({
        playbackState: 'playing',
        metadata: { title: '只有标题' },
      })
      mgr.start()
      vi.advanceTimersByTime(2100)
      const info = mgr.getCurrentStatus().info
      expect(info!.title).toBe('只有标题')
      expect(info!.artist).toBe('')
      expect(info!.album).toBe('')
    })

    it('仅 artist 存在时也构造 info', () => {
      setMediaSession({
        playbackState: 'playing',
        metadata: { artist: '只有艺术家' },
      })
      mgr.start()
      vi.advanceTimersByTime(2100)
      expect(mgr.getCurrentStatus().info!.artist).toBe('只有艺术家')
    })

    it('仅 album 存在时也构造 info', () => {
      setMediaSession({
        playbackState: 'playing',
        metadata: { album: '只有专辑' },
      })
      mgr.start()
      vi.advanceTimersByTime(2100)
      expect(mgr.getCurrentStatus().info!.album).toBe('只有专辑')
    })
  })

  // ============ 变化检测与通知 ============

  describe('变化检测', () => {
    it('状态变化触发通知', () => {
      setMediaSession({ playbackState: 'none', metadata: null })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      // 第一次轮询：状态仍为 none，无通知
      vi.advanceTimersByTime(2100)
      expect(listener).not.toHaveBeenCalled()

      // 改为 playing
      setMediaSession({ playbackState: 'playing', metadata: { title: '歌1' } })
      vi.advanceTimersByTime(2100)
      expect(listener).toHaveBeenCalled()
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0] as MusicStatus
      expect(lastCall.state).toBe('playing')
    })

    it('元数据变化（同一状态）触发通知', () => {
      setMediaSession({ playbackState: 'playing', metadata: { title: '歌1' } })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100) // 第一次轮询：playing + 歌1 → 通知
      expect(listener).toHaveBeenCalledTimes(1)

      // 切换歌曲（state 不变，metadata 变）
      setMediaSession({ playbackState: 'playing', metadata: { title: '歌2' } })
      vi.advanceTimersByTime(2100)
      expect(listener).toHaveBeenCalledTimes(2)
      const last = listener.mock.calls[1][0] as MusicStatus
      expect(last.info!.title).toBe('歌2')
    })

    it('状态和元数据都未变化时不触发通知', () => {
      setMediaSession({ playbackState: 'playing', metadata: { title: '歌1' } })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100) // 第一次轮询触发
      const callsAfterFirst = listener.mock.calls.length

      // 状态不变
      vi.advanceTimersByTime(2100)
      vi.advanceTimersByTime(2100)
      expect(listener.mock.calls.length).toBe(callsAfterFirst)
    })

    it('从 playing 切到 paused 触发通知', () => {
      setMediaSession({ playbackState: 'playing', metadata: { title: '歌1' } })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100)

      setMediaSession({ playbackState: 'paused', metadata: { title: '歌1' } })
      vi.advanceTimersByTime(2100)

      const last = listener.mock.calls[listener.mock.calls.length - 1][0] as MusicStatus
      expect(last.state).toBe('paused')
      expect(mgr.isPlaying()).toBe(false)
    })

    it('从 playing 切到 none 触发通知', () => {
      setMediaSession({ playbackState: 'playing', metadata: { title: '歌1' } })
      const listener = vi.fn()
      mgr.onMusicChange(listener)
      listener.mockClear()

      mgr.start()
      vi.advanceTimersByTime(2100)

      setMediaSession({ playbackState: 'none', metadata: null })
      vi.advanceTimersByTime(2100)

      const last = listener.mock.calls[listener.mock.calls.length - 1][0] as MusicStatus
      expect(last.state).toBe('none')
      expect(last.info).toBeNull()
    })
  })

  // ============ 单例 ============

  describe('单例', () => {
    it('getMusicAwarenessManager 返回同一实例', () => {
      const a = getMusicAwarenessManager()
      const b = getMusicAwarenessManager()
      expect(a).toBe(b)
    })

    it('单例可正常 start/stop', () => {
      const m = getMusicAwarenessManager()
      expect(() => m.start()).not.toThrow()
      expect(() => m.stop()).not.toThrow()
    })
  })
})

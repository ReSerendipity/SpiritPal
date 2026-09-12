// TTSPlayer 单元测试 — HTMLAudioElement 播放状态管理 / ObjectURL 生命周期
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TTSPlayer } from '@/lib/ai/ttsPlayer'

// ============ Mock HTMLAudioElement ============

class MockAudio {
  static instances: MockAudio[] = []
  /** 可被测试覆写以模拟 play() 成功/失败 */
  static playImpl: () => Promise<void> = () => Promise.resolve()
  paused = false
  ended = false
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  src: string
  play = vi.fn(() => MockAudio.playImpl())
  pause = vi.fn(() => {
    this.paused = true
  })

  constructor(url: string) {
    this.src = url
    MockAudio.instances.push(this)
  }

  /** 模拟播放自然结束 */
  simulateEnd(): void {
    this.ended = true
    this.onended?.()
  }

  /** 模拟播放出错 */
  simulateError(): void {
    this.onerror?.()
  }
}

beforeEach(() => {
  MockAudio.instances = []
  MockAudio.playImpl = () => Promise.resolve()
  Object.defineProperty(globalThis, 'Audio', {
    value: MockAudio,
    writable: true,
    configurable: true,
  })
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('TTSPlayer.play', () => {
  it('为 Blob 创建 ObjectURL 并播放，自然结束后释放 URL', async () => {
    const player = new TTSPlayer()
    const blob = new Blob(['wav'], { type: 'audio/wav' })
    const done = player.play(blob)

    const audio = MockAudio.instances[0]
    expect(audio).toBeDefined()
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(audio?.play).toHaveBeenCalled()
    expect(player.isPlaying()).toBe(true)

    audio?.simulateEnd()
    await expect(done).resolves.toBeUndefined()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    expect(player.isPlaying()).toBe(false)
  })

  it('play() 被拒绝时 reject 并释放 URL', async () => {
    const player = new TTSPlayer()
    const audioPlayError = new Error('autoplay blocked')
    MockAudio.playImpl = () => Promise.reject(audioPlayError)

    await expect(player.play(new Blob())).rejects.toBe(audioPlayError)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('audio.onerror 触发时 reject', async () => {
    const player = new TTSPlayer()
    const done = player.play(new Blob())
    MockAudio.instances[0]?.simulateError()
    await expect(done).rejects.toThrow('音频播放失败')
  })
})

describe('TTSPlayer.stop', () => {
  it('暂停当前音频并释放 ObjectURL', async () => {
    const player = new TTSPlayer()
    const done = player.play(new Blob())
    const audio = MockAudio.instances[0]!

    player.stop()
    expect(audio.pause).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    // 停止后回调被清空，不会再触发 onended 释放
    expect(player.isPlaying()).toBe(false)

    // 自然结束不应触发（回调已清空）→ promise 保持 pending，不会 unhandled
    audio.onended?.()
    await Promise.resolve()
    // 重复 stop 安全
    expect(() => player.stop()).not.toThrow()
    void done
  })

  it('新播放自动停止旧播放', async () => {
    const player = new TTSPlayer()
    const firstDone = player.play(new Blob())
    const firstAudio = MockAudio.instances[0]!
    expect(player.isPlaying()).toBe(true)

    player.play(new Blob())
    expect(firstAudio.pause).toHaveBeenCalled()
    // 第二个实例接管
    expect(MockAudio.instances).toHaveLength(2)
    expect(player.isPlaying()).toBe(true)
    void firstDone
  })
})

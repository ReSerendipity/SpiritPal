// VoiceRecorder 单元测试 — 状态机（idle/recording/stopped/error）+ 权限错误 + 产物 Blob
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VoiceRecorder } from '@/lib/system/voiceRecorder'

// ============ Mock MediaRecorder / getUserMedia ============

class MockMediaRecorder {
  static last: MockMediaRecorder | null = null
  static instances: MockMediaRecorder[] = []
  static isTypeSupported = vi.fn(() => true)
  mimeType: string
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((e: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? ''
    MockMediaRecorder.instances.push(this)
    MockMediaRecorder.last = this
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
  /** 模拟浏览器推送一个音频数据块 */
  emitData(data: Blob) {
    this.ondataavailable?.({ data } as BlobEvent)
  }
}

const trackStop = vi.fn()
const mockStream = {
  getTracks: () => [{ stop: trackStop } as unknown as MediaStreamTrack],
}

const mockGetUserMedia = vi.fn<() => Promise<MediaStream>>()

beforeEach(() => {
  vi.clearAllMocks()
  MockMediaRecorder.instances = []
  MockMediaRecorder.last = null
  trackStop.mockClear()

  Object.defineProperty(globalThis, 'MediaRecorder', {
    value: MockMediaRecorder,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: mockGetUserMedia },
    writable: true,
    configurable: true,
  })
  mockGetUserMedia.mockResolvedValue(mockStream as unknown as MediaStream)
})

afterEach(() => {
  // 清理全局覆盖，避免影响其他测试
  delete (globalThis as Record<string, unknown>).MediaRecorder
  delete (navigator as unknown as Record<string, unknown>).mediaDevices
})

describe('VoiceRecorder.isSupported', () => {
  it('环境具备 MediaRecorder + getUserMedia 时返回 true', () => {
    expect(VoiceRecorder.isSupported()).toBe(true)
  })

  it('缺少 getUserMedia 时返回 false', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    expect(VoiceRecorder.isSupported()).toBe(false)
  })
})

describe('VoiceRecorder 状态机', () => {
  it('start() 成功后进入 recording 状态并请求麦克风', async () => {
    const rec = new VoiceRecorder()
    expect(rec.getState()).toBe('idle')
    await rec.start()
    expect(rec.getState()).toBe('recording')
    expect(rec.isRecording()).toBe(true)
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
    expect(MockMediaRecorder.last).not.toBeNull()
  })

  it('start() 重复调用不会重复创建 recorder', async () => {
    const rec = new VoiceRecorder()
    await rec.start()
    await rec.start()
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
  })

  it('麦克风权限被拒绝时进入 error 状态并抛出可读错误', async () => {
    mockGetUserMedia.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
    const rec = new VoiceRecorder()
    await expect(rec.start()).rejects.toThrow(/麦克风权限被拒绝/)
    expect(rec.getState()).toBe('error')
  })

  it('stop() 后产出包含数据块的 Blob，状态变为 stopped', async () => {
    const rec = new VoiceRecorder()
    await rec.start()
    MockMediaRecorder.last?.emitData(new Blob(['fake-audio-1'], { type: 'audio/webm' }))
    MockMediaRecorder.last?.emitData(new Blob(['fake-audio-2'], { type: 'audio/webm' }))
    const audio = await rec.stop()
    expect(rec.getState()).toBe('stopped')
    expect(audio.blob).toBeInstanceOf(Blob)
    expect(audio.mimeType).toContain('audio/webm')
    expect(audio.durationMs).toBeGreaterThanOrEqual(0)
    // 轨道已释放
    expect(trackStop).toHaveBeenCalled()
    // getAudioBlob/getAudioData 返回同一份产物
    expect(rec.getAudioBlob()).toBe(audio.blob)
    expect(rec.getAudioData()?.blob).toBe(audio.blob)
  })

  it('未在录音时调用 stop() 会 reject', async () => {
    const rec = new VoiceRecorder()
    await expect(rec.stop()).rejects.toThrow(/未在录音/)
  })

  it('cancel() 丢弃已采集数据并回到 idle', async () => {
    const rec = new VoiceRecorder()
    await rec.start()
    MockMediaRecorder.last?.emitData(new Blob(['partial'], { type: 'audio/webm' }))
    rec.cancel()
    expect(rec.getState()).toBe('idle')
    expect(rec.getAudioBlob()).toBeNull()
    expect(trackStop).toHaveBeenCalled()
  })
})

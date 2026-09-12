/**
 * VOICEVOX wav 音频播放器
 *
 * 基于原生 HTMLAudioElement + URL.createObjectURL：
 * - play(blob)：创建 ObjectURL → new Audio(url) → play()，onended 后自动释放
 * - stop()：暂停播放并立即释放 ObjectURL
 * - isPlaying()：当前是否正在播放
 *
 * 同一时刻只播放一段（新播放会先 stop 旧的），避免多条消息叠加朗读。
 */

export class TTSPlayer {
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null

  /** 当前是否正在播放 */
  isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused && !this.audio.ended
  }

  /**
   * 播放一段 wav Blob
   * @returns 播放自然结束时 resolve；中途 stop() 会让 promise pending（调用方不关心），
   *          播放出错或 play() 拒绝时 reject。
   */
  play(blob: Blob): Promise<void> {
    // 新播放前先停掉旧的，释放旧 ObjectURL
    this.stop()
    const url = URL.createObjectURL(blob)
    this.objectUrl = url
    const audio = new Audio(url)
    this.audio = audio

    return new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        this.cleanup()
        resolve()
      }
      audio.onerror = () => {
        this.cleanup()
        reject(new Error('音频播放失败'))
      }
      audio.play().catch((err: unknown) => {
        this.cleanup()
        reject(err instanceof Error ? err : new Error('音频播放被拒绝'))
      })
    })
  }

  /** 停止播放并释放资源。重复调用安全。 */
  stop(): void {
    if (this.audio) {
      // 清掉回调，避免 pause 间接触发 onended/onerror
      this.audio.onended = null
      this.audio.onerror = null
      try {
        this.audio.pause()
      } catch {
        /* pause 失败忽略 */
      }
      this.audio = null
    }
    this.revokeUrl()
  }

  private revokeUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }

  private cleanup(): void {
    this.revokeUrl()
    this.audio = null
  }
}

/** 进程内共享单例 */
export const ttsPlayer = new TTSPlayer()

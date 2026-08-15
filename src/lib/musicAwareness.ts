/**
 * 音乐感知引擎模块
 *
 * @fileoverview 基于navigator.mediaSession API检测音乐播放状态并触发宠物反应（PRD §7.6 F5.2）
 *
 * 主要模块：
 * - MusicPlaybackState/MusicInfo/MusicStatus: 音乐状态与信息类型
 * - MusicAwarenessManager: 音乐感知管理器主类
 *
 * 依赖关系：
 * - navigator.mediaSession: 浏览器媒体会话API（无需外部依赖）
 *
 * 核心接口：
 * - start(): 启动音乐状态轮询
 * - stop(): 停止轮询
 * - getStatus(): 获取当前音乐状态
 * - subscribe(): 订阅音乐状态变化
 * - unsubscribe(): 取消订阅
 *
 * 核心功能：
 * 1. 歌曲信息获取：通过mediaSession.metadata获取曲名、艺术家、专辑、封面
 * 2. 播放状态监听：playbackState（playing/paused/none）
 * 3. 节奏跟随：音乐播放时宠物跟随节奏轻微摆动（待集成到动画系统）
 * 4. 事件订阅：onMusicChange回调接口
 * 5. 轮询检测：每2秒轮询一次（mediaSession无metadata变化事件）
 *
 * 注意：mediaSession仅在浏览器/Tauri WebView中由媒体元素触发时才更新。
 * 在桌面端，需要用户在WebView内播放音频/视频才会被捕获。
 */

// ============ 类型定义 ============

export type MusicPlaybackState = 'playing' | 'paused' | 'none'

export interface MusicInfo {
  title: string       // 曲名
  artist: string      // 艺术家
  album: string       // 专辑
  artwork: string     // 封面 URL（若有）
}

export interface MusicStatus {
  state: MusicPlaybackState
  info: MusicInfo | null
}

type MusicListener = (status: MusicStatus) => void

// ============ 音乐感知管理器 ============

export class MusicAwarenessManager {
  private currentStatus: MusicStatus = { state: 'none', info: null }
  private listeners: Set<MusicListener> = new Set()
  private pollTimer: number | null = null
  private prevMetaRef: string = ''

  // 配置
  private readonly POLL_INTERVAL = 2000  // 每 2 秒轮询一次（mediaSession 无 metadata 变化事件）

  start(): void {
    if (this.pollTimer !== null) return
    this.pollTimer = window.setInterval(() => {
      this.poll()
    }, this.POLL_INTERVAL)
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // 轮询读取 mediaSession 状态
  private poll(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession

    // 播放状态
    const rawState = ms.playbackState  // 'playing' | 'paused' | 'none'
    const state: MusicPlaybackState = rawState === 'playing' ? 'playing' : rawState === 'paused' ? 'paused' : 'none'

    // metadata
    let info: MusicInfo | null = null
    const meta = ms.metadata
    if (meta) {
      const title = meta.title ?? ''
      const artist = meta.artist ?? ''
      const album = meta.album ?? ''
      // 取第一张封面图
      let artwork = ''
      if (meta.artwork && meta.artwork.length > 0) {
        artwork = meta.artwork[0].src ?? ''
      }
      if (title || artist || album) {
        info = { title, artist, album, artwork }
      }
    }

    // 计算签名用于检测 metadata 变化
    const metaSig = info ? `${info.title}|${info.artist}|${info.album}` : ''

    // 状态变化或元数据变化时通知
    const stateChanged = state !== this.currentStatus.state
    const metaChanged = metaSig !== this.prevMetaRef

    if (stateChanged || metaChanged) {
      this.prevMetaRef = metaSig
      this.currentStatus = { state, info }
      this.listeners.forEach((fn) => fn(this.currentStatus))
    }
  }

  onMusicChange(listener: MusicListener): () => void {
    this.listeners.add(listener)
    // 立即回放一次当前状态
    try {
      listener(this.currentStatus)
    } catch {
      // 忽略
    }
    return () => this.listeners.delete(listener)
  }

  getCurrentStatus(): MusicStatus {
    return this.currentStatus
  }

  isPlaying(): boolean {
    return this.currentStatus.state === 'playing'
  }
}

// ============ 单例 ============

let musicMgr: MusicAwarenessManager | null = null

export function getMusicAwarenessManager(): MusicAwarenessManager {
  if (!musicMgr) {
    musicMgr = new MusicAwarenessManager()
  }
  return musicMgr
}

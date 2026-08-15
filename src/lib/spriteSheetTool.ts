/**
 * @file spriteSheetTool.ts
 * @description 精灵图转换工具模块 — GIF/视频转精灵图集
 *
 * 主要功能：
 * - 从 GIF/视频文件中提取帧（按指定 FPS 采样）
 * - 从静态图片或已有精灵图切分帧
 * - 按网格排列生成精灵图集（PNG 格式）
 * - 导出 PNG + JSON 元数据文件
 * - 支持自定义行列数、帧尺寸、FPS
 * - 扩展 spriteLayout 字段支持可变 frameMax/行
 *
 * 主要模块：
 * - SpriteSheetConfig: 精灵图生成配置接口
 * - SpriteSheetResult: 生成结果接口
 * - SpriteSheetMetadata: 元数据接口
 * - extractFrames(): 从视频/GIF 提取帧
 * - extractFramesFromImage(): 从图片提取帧
 * - generateSpriteSheet(): 生成精灵图集
 * - downloadSpriteSheet(): 导出下载精灵图
 *
 * 依赖关系：
 * - ./spriteLayoutConfig: SpriteRowConfig 类型及标准布局常量
 *
 * 核心接口：
 * - extractFrames(): 异步提取视频帧
 * - extractFramesFromImage(): 提取/切分图片帧
 * - generateSpriteSheet(): 合成精灵图集
 * - downloadSpriteSheet(): 触发浏览器下载
 *
 * PRD Phase 4: F4.9-2 GIF/视频转精灵图工具
 */

import type { SpriteRowConfig } from './spriteLayoutConfig'
import { STANDARD_SPRITE_LAYOUT } from './spriteLayoutConfig'

export interface SpriteSheetConfig {
  rows: number          // 精灵图行数
  cols: number          // 精灵图列数
  frameWidth: number    // 单帧宽度
  frameHeight: number   // 单帧高度
  fps: number           // 提取帧率
  /** 扩展精灵图布局配置（Phase 2: 支持可变 frameMax/行） */
  spriteLayout?: SpriteRowConfig[]
}

export interface SpriteSheetResult {
  dataUrl: string       // 精灵图 PNG dataURL
  frameCount: number    // 实际帧数
  config: SpriteSheetConfig
  metadata: SpriteSheetMetadata
}

export interface SpriteSheetMetadata {
  frameWidth: number
  frameHeight: number
  cols: number
  rows: number
  totalFrames: number
  animations: { name: string; row: number; frames: number; fps: number }[]
  /** 扩展精灵图布局配置（Phase 2） */
  spriteLayout?: SpriteRowConfig[]
}

export const DEFAULT_CONFIG: SpriteSheetConfig = {
  rows: 9,
  cols: 8,
  frameWidth: 192,
  frameHeight: 208,
  fps: 10,
  spriteLayout: STANDARD_SPRITE_LAYOUT.rows,
}

// ============ 从视频/GIF 提取帧 ============

export async function extractFrames(
  file: File,
  config: SpriteSheetConfig,
  onProgress?: (progress: number) => void,
): Promise<HTMLCanvasElement[]> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true

  // 等待视频加载
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('视频加载失败'))
  })

  const duration = video.duration
  const maxFrames = config.rows * config.cols
  const interval = 1 / config.fps
  const frames: HTMLCanvasElement[] = []

  // 计算实际提取的帧数
  const possibleFrames = Math.floor(duration / interval)
  const frameCount = Math.min(maxFrames, possibleFrames)

  for (let i = 0; i < frameCount; i++) {
    const time = Math.min(i * interval, duration - 0.01)
    video.currentTime = time

    // 等待 seek 完成
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked)
        resolve()
      }
      video.addEventListener('seeked', onSeeked)
    })

    // 绘制到 canvas
    const canvas = document.createElement('canvas')
    canvas.width = config.frameWidth
    canvas.height = config.frameHeight
    const ctx = canvas.getContext('2d')
    if (ctx) {
      // 计算缩放比例（保持宽高比，居中裁剪）
      const vw = video.videoWidth
      const vh = video.videoHeight
      const scale = Math.max(config.frameWidth / vw, config.frameHeight / vh)
      const dw = vw * scale
      const dh = vh * scale
      const dx = (config.frameWidth - dw) / 2
      const dy = (config.frameHeight - dh) / 2
      ctx.drawImage(video, dx, dy, dw, dh)
    }
    frames.push(canvas)

    if (onProgress) {
      onProgress((i + 1) / frameCount)
    }
  }

  URL.revokeObjectURL(url)
  return frames
}

// ============ 从图片序列提取帧（GIF 的第一帧或静态图）============

export async function extractFramesFromImage(
  file: File,
  config: SpriteSheetConfig,
): Promise<HTMLCanvasElement[]> {
  const img = new Image()
  const url = URL.createObjectURL(file)

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })

  // 如果图片本身就是精灵图，按网格切分
  const cols = Math.floor(img.width / config.frameWidth)
  const rows = Math.floor(img.height / config.frameHeight)

  if (cols > 1 || rows > 1) {
    // 已是精灵图，切分
    const frames: HTMLCanvasElement[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const canvas = document.createElement('canvas')
        canvas.width = config.frameWidth
        canvas.height = config.frameHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(
            img,
            c * config.frameWidth, r * config.frameHeight,
            config.frameWidth, config.frameHeight,
            0, 0,
            config.frameWidth, config.frameHeight,
          )
        }
        frames.push(canvas)
      }
    }
    URL.revokeObjectURL(url)
    return frames
  }

  // 单张图片，缩放到帧尺寸
  const canvas = document.createElement('canvas')
  canvas.width = config.frameWidth
  canvas.height = config.frameHeight
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const scale = Math.max(config.frameWidth / img.width, config.frameHeight / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    const dx = (config.frameWidth - dw) / 2
    const dy = (config.frameHeight - dh) / 2
    ctx.drawImage(img, dx, dy, dw, dh)
  }
  URL.revokeObjectURL(url)
  return [canvas]
}

// ============ 生成精灵图集 ============

export function generateSpriteSheet(
  frames: HTMLCanvasElement[],
  config: SpriteSheetConfig,
): SpriteSheetResult {
  const canvas = document.createElement('canvas')
  canvas.width = config.cols * config.frameWidth
  canvas.height = config.rows * config.frameHeight
  const ctx = canvas.getContext('2d')

  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    frames.forEach((frame, i) => {
      const col = i % config.cols
      const row = Math.floor(i / config.cols)
      if (row < config.rows) {
        ctx.drawImage(
          frame,
          col * config.frameWidth,
          row * config.frameHeight,
        )
      }
    })
  }

  const dataUrl = canvas.toDataURL('image/png')
  const frameCount = Math.min(frames.length, config.rows * config.cols)

  // 生成元数据
  const usedRows = Math.ceil(frameCount / config.cols)
  const metadata: SpriteSheetMetadata = {
    frameWidth: config.frameWidth,
    frameHeight: config.frameHeight,
    cols: config.cols,
    rows: usedRows,
    totalFrames: frameCount,
    animations: [
      {
        name: 'idle',
        row: 0,
        frames: Math.min(config.cols, frameCount),
        fps: config.fps,
      },
    ],
    // Phase 2: 包含扩展精灵图布局配置
    spriteLayout: config.spriteLayout,
  }

  return {
    dataUrl,
    frameCount,
    config,
    metadata,
  }
}

// ============ 导出精灵图文件 ============

export function downloadSpriteSheet(result: SpriteSheetResult, name: string): void {
  // 下载 PNG
  const a = document.createElement('a')
  a.href = result.dataUrl
  a.download = `${name}-spritesheet.png`
  a.click()

  // 下载元数据 JSON
  const metadataJson = JSON.stringify(result.metadata, null, 2)
  const blob = new Blob([metadataJson], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const b = document.createElement('a')
  b.href = url
  b.download = `${name}-metadata.json`
  b.click()
  URL.revokeObjectURL(url)
}

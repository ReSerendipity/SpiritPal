/**
 * @file webgl.worker.ts
 * @description WebGL 渲染 Worker 主线程
 *
 * 运行在独立的 Worker 线程中，负责所有 WebGL 相关操作
 */

import { BatchRenderer } from '@/lib/render/batchRenderer'
import { GPUParticleSystem } from '@/lib/render/gpuParticleSystem'
import { SpriteRenderer, type SpriteInstance, type TextureSource } from '@/lib/render/spriteRenderer'
import type { WorkerMessage, WorkerResponse, RenderCommand } from './webglWorker'

// ============ 全局状态 ============

let canvas: OffscreenCanvas | null = null
let gl: WebGLRenderingContext | null = null
let particleSystem: GPUParticleSystem | null = null
let batchRenderer: BatchRenderer | null = null
/** 精灵渲染器（TD-010）：原来 drawSprite 是空分支，精灵从未真的画出来 */
let spriteRenderer: SpriteRenderer | null = null

let lastFrameTime: number = 0
let frameCount: number = 0
let lastFpsSampleAt: number = 0
/** Worker 无 VSync，按 60fps 的目标间隔手动调度 */
const FRAME_INTERVAL_MS = 1000 / 60
let renderTimer: ReturnType<typeof setTimeout> | null = null
const stats = {
  fps: 0,
  particles: 0,
  drawCalls: 0,
}

// ============ 消息处理器 ============

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data

  try {
    switch (message.type) {
      case 'init':
        await handleMessageInit(message)
        break

      case 'render':
        handleRender(message)
        break

      case 'resize':
        handleResize(message)
        break

      case 'update':
        handleUpdate(message)
        break

      case 'destroy':
        destroy()
        break

      case 'stats':
        sendStats(message.id)
        break

      default:
        sendError(message.id, `Unknown message type: ${message.type}`)
    }
  } catch (error) {
    sendError(message.id, (error as Error).message)
  }
}

// ============ 消息处理函数 ============

async function handleMessageInit(message: WorkerMessage): Promise<void> {
  if (message.payload?.canvasTransferable) {
    // OffscreenCanvas 初始化
    console.log('[WebGLWorker] Initializing with OffscreenCanvas')

    canvas = new OffscreenCanvas(1920, 1080)
    gl = canvas.getContext('webgl') as WebGLRenderingContext

    if (!gl) {
      throw new Error('WebGL not available in worker')
    }

    // 初始化粒子系统（OffscreenCanvas）
    const canvasEl = canvas as unknown as HTMLCanvasElement
    particleSystem = new GPUParticleSystem(canvasEl)

    // 初始化批渲染器
    batchRenderer = new BatchRenderer({
      maxBatches: 16,
      maxVerticesPerBatch: 65536,
      enableCulling: true,
      viewport: { x: 0, y: 0, width: 1920, height: 1080 },
    })

    // 初始化精灵渲染器；着色器编译失败时如实报错，而不是让 drawSprite 继续静默空转
    spriteRenderer = new SpriteRenderer()
    if (!spriteRenderer.init(gl)) {
      spriteRenderer = null
      throw new Error('Sprite shader init failed')
    }

    sendSuccess(message.id, { success: true })

    // 开始渲染循环
    startRenderLoop()
  } else {
    // Fallback 模式
    sendError(message.id, 'Canvas transfer required')
  }
}

function handleRender(message: WorkerMessage): void {
  if (!gl || !particleSystem || !batchRenderer) {
    return
  }

  const commands = message.payload?.commands || []

  // 执行命令
  for (const cmd of commands) {
    executeRenderCommand(cmd)
  }

  // 提交帧
  gl.flush()

  // 更新统计
  frameCount++
  const now = performance.now()
  if (now - lastFrameTime >= 1000) {
    stats.fps = frameCount
    frameCount = 0
    lastFrameTime = now
    stats.particles = particleSystem.getParticleCount()
    // 真实的 draw call 数来自精灵渲染器；batchRenderer 只做 CPU 侧打包、不计入这里
    stats.drawCalls = spriteRenderer?.getStats().drawCalls ?? 0
  }
}

function handleResize(message: WorkerMessage): void {
  const { width, height } = message.payload

  if (canvas && gl) {
    canvas.width = width
    canvas.height = height

    gl.viewport(0, 0, width, height)

    if (particleSystem) {
      particleSystem.resize(width, height)
    }

    if (batchRenderer) {
      batchRenderer.setViewport(0, 0, width, height)
    }

    sendSuccess(message.id, { width, height })
  }
}

function handleUpdate(message: WorkerMessage): void {
  const deltaTime = message.payload?.deltaTime || 0.016
  const emitterPos = message.payload?.emitterPos || { x: 0, y: 0 }

  if (particleSystem) {
    particleSystem.update(deltaTime * 1000, emitterPos)
  }
}

function executeRenderCommand(cmd: RenderCommand): void {
  if (!gl) return

  switch (cmd.command) {
    case 'drawSprite': {
      if (!spriteRenderer || !canvas) return
      const textureId = typeof cmd.params.textureId === 'string' ? cmd.params.textureId : ''
      // 同一帧可能顺带上传纹理；只在上传成功后才画，否则该精灵会被 draw 跳过
      if (cmd.params.texture && textureId) {
        spriteRenderer.uploadTexture(gl, textureId, cmd.params.texture as TextureSource)
      }
      const sprite = toSpriteInstance(cmd.params, textureId)
      if (!sprite) return
      // drawCalls 统一由 spriteRenderer.getStats() 汇总，这里不重复累加
      spriteRenderer.draw(gl, [sprite], canvas.width, canvas.height)
      break
    }

    case 'drawParticle':
      if (particleSystem) {
        particleSystem.render()
      }
      break

    case 'clear': {
      const color = cmd.params.color || [0, 0, 0, 0]
      gl.clearColor(color[0], color[1], color[2], color[3])
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      break
    }

    case 'present':
      // OffscreenCanvas 自动呈现
      break
  }
}

/**
 * 把 IPC 载荷转成精灵实例
 *
 * 必须校验 width/height：缺尺寸或负数会让四角顺序反转（画出来是"背面"），
 * 表现为精灵整块消失而不是抛出错误，属最难查的一类。
 */
function toSpriteInstance(
  params: RenderCommand['params'],
  textureId: string,
): SpriteInstance | null {
  if (!textureId) return null
  const x = num(params.x, 0)
  const y = num(params.y, 0)
  const width = num(params.width, 0)
  const height = num(params.height, 0)
  if (!(width > 0) || !(height > 0)) return null

  const instance: SpriteInstance = { textureId, x, y, width, height }
  if (typeof params.rotation === 'number') instance.rotation = params.rotation
  if (typeof params.opacity === 'number') instance.opacity = params.opacity
  if (Array.isArray(params.color) && params.color.length === 4) {
    instance.color = [
      num(params.color[0], 1),
      num(params.color[1], 1),
      num(params.color[2], 1),
      num(params.color[3], 1),
    ]
  }
  if (Array.isArray(params.uv) && params.uv.length === 4) {
    instance.uv = [
      num(params.uv[0], 0),
      num(params.uv[1], 0),
      num(params.uv[2], 1),
      num(params.uv[3], 1),
    ]
  }
  if (typeof params.zIndex === 'number') instance.zIndex = params.zIndex
  return instance
}

/** 取数字，非有限值回落默认 */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// ============ 渲染循环 ============

/**
 * 启动渲染循环。
 *
 * ⚠️ Dedicated Worker 中**不存在** `requestAnimationFrame`（无 VSync、无 window），
 * 因此这里用 setTimeout 以固定间隔驱动。`GPUParticleSystem.update()` 的
 * 入参单位是**秒**（不是毫秒），需先换算再传入。
 */
function startRenderLoop(): void {
  if (renderTimer !== null) return
  lastFrameTime = 0
  frameCount = 0
  lastFpsSampleAt = 0

  const render = () => {
    if (!gl || !particleSystem || !batchRenderer) {
      renderTimer = null
      return
    }

    // 清除画布
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // 真实帧间隔 → 秒
    const now = performance.now()
    const deltaMs = lastFrameTime > 0 ? now - lastFrameTime : FRAME_INTERVAL_MS
    lastFrameTime = now

    particleSystem.update(deltaMs / 1000, { x: 960, y: 540 })
    particleSystem.render()

    // 每秒刷新一次统计
    frameCount++
    if (lastFpsSampleAt === 0) lastFpsSampleAt = now
    if (now - lastFpsSampleAt >= 1000) {
      stats.fps = Math.round((frameCount * 1000) / (now - lastFpsSampleAt))
      stats.particles = particleSystem.getParticleCount()
      frameCount = 0
      lastFpsSampleAt = now
    }

    renderTimer = setTimeout(render, FRAME_INTERVAL_MS)
  }

  renderTimer = setTimeout(render, FRAME_INTERVAL_MS)
}

/** 停止渲染循环 */
function stopRenderLoop(): void {
  if (renderTimer !== null) {
    clearTimeout(renderTimer)
    renderTimer = null
  }
}

// ============ 响应发送函数 ============

function sendSuccess(messageId: string, data?: unknown): void {
  const response: WorkerResponse = {
    messageId,
    type: 'success',
    data,
  }

  self.postMessage(response)
}

function sendError(messageId: string, error: string): void {
  const response: WorkerResponse = {
    messageId,
    type: 'error',
    error,
  }

  self.postMessage(response)
}

function sendStats(messageId: string): void {
  sendSuccess(messageId, {
    fps: stats.fps,
    particles: stats.particles,
    drawCalls: stats.drawCalls,
  })
}

// ============ 资源清理 ============

function destroy(): void {
  stopRenderLoop()

  if (gl && spriteRenderer) {
    spriteRenderer.dispose(gl)
  }

  if (gl) {
    const ext = gl.getExtension('WEBGL_lose_context')
    ext?.loseContext()
  }

  canvas = null
  gl = null
  particleSystem = null
  batchRenderer = null
  spriteRenderer = null

  console.log('[WebGLWorker] Resources cleaned up')
}

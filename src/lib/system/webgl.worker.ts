/**
 * @file webgl.worker.ts
 * @description WebGL 渲染 Worker 主线程
 * 
 * 运行在独立的 Worker 线程中，负责所有 WebGL 相关操作
 */

import { BatchRenderer } from '@/lib/render/batchRenderer'
import { GPUParticleSystem } from '@/lib/render/gpuParticleSystem'
import type { WorkerMessage, WorkerResponse, RenderCommand } from './webglWorker'

// ============ 全局状态 ============

let canvas: OffscreenCanvas | null = null
let gl: WebGLRenderingContext | null = null
let particleSystem: GPUParticleSystem | null = null
let batchRenderer: BatchRenderer | null = null

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
    stats.drawCalls = batchRenderer.getStats().totalDrawCalls
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
    case 'drawSprite':
      // TODO: 实现精灵绘制
      break
      
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

function sendSuccess(messageId: string, data?: any): void {
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

  if (gl) {
    const ext = gl.getExtension('WEBGL_lose_context')
    ext?.loseContext()
  }
  
  canvas = null
  gl = null
  particleSystem = null
  batchRenderer = null
  
  console.log('[WebGLWorker] Resources cleaned up')
}

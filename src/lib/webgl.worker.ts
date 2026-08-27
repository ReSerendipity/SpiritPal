/**
 * @file webgl.worker.ts
 * @description WebGL 渲染 Worker 主线程
 * 
 * 运行在独立的 Worker 线程中，负责所有 WebGL 相关操作
 */

import { GPUParticleSystem } from '../lib/gpuParticleSystem'
import { BatchRenderer } from '../lib/batchRenderer'
import type { WorkerMessage, WorkerResponse, RenderCommand } from './webglWorker'

// ============ 全局状态 ============

let canvas: OffscreenCanvas | null = null
let gl: WebGLRenderingContext | null = null
let particleSystem: GPUParticleSystem | null = null
let batchRenderer: BatchRenderer | null = null

let lastFrameTime: number = 0
let frameCount: number = 0
let stats = {
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
      
    case 'clear':
      const color = cmd.params.color || [0, 0, 0, 0]
      gl.clearColor(color[0], color[1], color[2], color[3])
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      break
      
    case 'present':
      // OffscreenCanvas 自动呈现
      break
  }
}

// ============ 渲染循环 ============

function startRenderLoop(): void {
  const render = () => {
    if (!gl || !particleSystem || !batchRenderer) return
    
    // 清除画布
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    
    // 更新物理
    particleSystem.update(16, { x: 960, y: 540 })
    
    // 渲染粒子
    particleSystem.render()
    
    // 请求下一帧
    requestAnimationFrame(render)
  }
  
  requestAnimationFrame(render)
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

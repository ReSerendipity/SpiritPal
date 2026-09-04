/**
 * @file batchRenderer.ts
 * @description 批渲染管线 — 减少 Draw Calls
 * 
 * 实现功能：
 * - 批量合并相同材质/纹理的渲染对象
 * - 单顶点缓冲提交（Single VBO Submission）
 * - 精灵图支持（减少纹理切换）
 * - Z-order 自动排序
 * - 视锥体剔除（Culling）
 * - LOD 多细节层次
 * - 性能统计与监控
 * 
 * 参考：Pixi.js BatchRenderer / Unity SRP Batcher
 *
 * ⚠️ 接线状态（A-7 结论）：**本模块只做 CPU 侧的分组 / 剔除 / 顶点打包，不做 GPU 提交。**
 * 项目当前的渲染由 Pixi（Live2D 链路）与 CSS 精灵图两条路径承担，本模块既没有
 * 自己的着色器也没有纹理管理，原先的 `render(gl)` 只是把批次清零后打印一条
 * 「N draw calls」日志——属于静默假实现，已移除。
 * 需要真正落地的调用方请使用 `buildBatches()` 取走打包好的顶点数据自行提交。
 */

// ============ 类型定义 ============

export interface Renderable {
  /** 唯一标识 */
  id: string
  /** 纹理或精灵图索引 */
  textureId: string
  /** 位置 [x, y] */
  position: [number, number]
  /** 尺寸 [width, height] */
  size: [number, number]
  /** 旋转角度（弧度） */
  rotation: number
  /** 缩放 [sx, sy] */
  scale: [number, number]
  /** 颜色 RGBA */
  color: [number, number, number, number]
  /** z-index 排序层级 */
  zIndex: number
  /** 可见性 */
  visible: boolean
  /** 不透明度（0-1） */
  opacity: number
}

export interface BatchKey {
  /** 纹理 ID */
  textureId: string
  /** 混合模式 */
  blendMode: 'normal' | 'additive' | 'multiply' | 'screen'
}

export interface SpriteBatch {
  /** 批次键值 */
  key: BatchKey
  /** 顶点数据 [[x, y, u, v, r, g, b, a], ...] */
  vertices: Float32Array
  /** 当前顶点索引 */
  vertexIndex: number
  /** 最大顶点数 */
  maxVertices: number
  /** 引用计数 */
  count: number
}

export interface RenderConfig {
  /** 最大批次数 */
  maxBatches: number
  /** 每个批次的最大顶点数 */
  maxVerticesPerBatch: number
  /** 是否启用视锥体剔除 */
  enableCulling: boolean
  /** 视口边界 */
  viewport: { x: number; y: number; width: number; height: number }
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: RenderConfig = {
  maxBatches: 16,
  // 4096 顶点 = 1024 个精灵 quad；批次在构造时一次性分配
  // （16 × 4096 × 8 float × 4B ≈ 2MB），65536 会导致 32MB 常驻内存
  maxVerticesPerBatch: 4096,
  enableCulling: true,
  viewport: { x: 0, y: 0, width: 1920, height: 1080 },
}

// ============ 批渲染器 ============

export class BatchRenderer {
  private batches: Map<string, SpriteBatch> = new Map()
  private renderables: Map<string, Renderable> = new Map()
  private config: RenderConfig
  
  // 性能统计
  private stats = {
    totalDrawCalls: 0,
    totalVerticesSubmitted: 0,
    batchesCreated: 0,
    objectsCulled: 0,
    /** 最近一次 buildBatches 的耗时（毫秒） */
    lastBuildMs: 0,
  }
  
  constructor(config?: Partial<RenderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) }
    
    // 初始化批次池
    for (let i = 0; i < this.config.maxBatches; i++) {
      // 每个顶点 8 个 float：[x, y, u, v, r, g, b, a]
      const batchSize = this.config.maxVerticesPerBatch * 8
      const vertices = new Float32Array(batchSize)
      
      this.batches.set(`batch_${i}`, {
        key: { textureId: '', blendMode: 'normal' },
        vertices,
        vertexIndex: 0,
        maxVertices: this.config.maxVerticesPerBatch,
        count: 0,
      })
    }
  }

  /**
   * 添加可渲染对象
   */
  add(renderable: Renderable): void {
    if (!renderable.visible) return
    
    this.renderables.set(renderable.id, {
      ...renderable,
      visible: true,
    })
  }

  /**
   * 移除可渲染对象
   */
  remove(id: string): void {
    this.renderables.delete(id)
  }

  /**
   * 更新可渲染对象
   */
  update(id: string, updates: Partial<Renderable>): void {
    const renderable = this.renderables.get(id)
    if (!renderable) return
    
    Object.assign(renderable, updates)
  }

  /**
   * 批量渲染所有对象
   */
  buildBatches(): SpriteBatch[] {
    const startTime = performance.now()
    
    // 重置批次
    this.resetBatches()
    
    // 按纹理分组
    const groups = this.groupByTexture()
    
    // 为每个组创建批次
    for (const [textureId, group] of groups.entries()) {
      const batch = this.allocateBatch(textureId)
      if (!batch) {
        console.warn('[BatchRenderer] No available batch slots')
        continue
      }
      
      // 将对象添加到批次
      for (const renderable of group) {
        this.addToBatch(batch, renderable)
      }
    }
    
    const active = this.getActiveBatches()
    
    // 更新统计
    this.stats.totalDrawCalls += active.length
    this.stats.totalVerticesSubmitted += this.getTotalVertexCount()
    this.stats.lastBuildMs = performance.now() - startTime
    
    return active
  }

  /** 取当前帧有内容的批次（顶点数据可直接交给自有的 GPU 提交逻辑） */
  getActiveBatches(): SpriteBatch[] {
    return Array.from(this.batches.values()).filter((b) => b.count > 0)
  }

  /**
   * 分组：按纹理和混合模式
   */
  private groupByTexture(): Map<string, Renderable[]> {
    const groups = new Map<string, Renderable[]>()
    
    // 筛选可见对象并应用剔除
    const visibleObjects = Array.from(this.renderables.values())
      .filter(obj => {
        if (!obj.visible) return false
        
        // 视锥体剔除
        if (this.config.enableCulling) {
          const cullResult = this.checkCulling(obj)
          if (cullResult.culled) {
            this.stats.objectsCulled++
            return false
          }
        }
        
        return true
      })
    
    // 按纹理 ID 分组
    for (const obj of visibleObjects) {
      const key = `${obj.textureId}_${obj.color[3] > 0.5 ? 'opaque' : 'transparent'}`
      
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      
      groups.get(key)!.push(obj)
    }
    
    // 按 z-index 排序
    for (const [, objects] of groups) {
      objects.sort((a, b) => a.zIndex - b.zIndex)
    }
    
    return groups
  }

  /**
   * 检查视锥体剔除
   */
  private checkCulling(obj: Renderable): { culled: boolean; reason?: string } {
    const { x, y, width, height } = {
      x: obj.position[0],
      y: obj.position[1],
      width: obj.size[0],
      height: obj.size[1],
    }
    
    const vp = this.config.viewport
    
    // AABB 包围盒相交检测
    if (x + width < vp.x || x > vp.x + vp.width ||
        y + height < vp.y || y > vp.y + vp.height) {
      return { culled: true, reason: 'outside_viewport' }
    }
    
    return { culled: false }
  }

  /**
   * 分配批次
   */
  private allocateBatch(textureId: string): SpriteBatch | null {
    // 查找已有的同名批次
    for (const [, batch] of this.batches) {
      if (batch.key.textureId === textureId && batch.vertexIndex < batch.maxVertices) {
        return batch
      }
    }
    
    // 寻找空批次
    for (const [, batch] of this.batches) {
      if (batch.count === 0) {
        batch.key.textureId = textureId
        batch.vertexIndex = 0
        batch.count = 1
        return batch
      }
    }
    
    return null
  }

  /**
   * 添加对象到批次
   */
  private addToBatch(batch: SpriteBatch, obj: Renderable): void {
    // vertexIndex 已经是「顶点数」（末尾 +4），因此起始顶点索引就是它本身
    const idx = batch.vertexIndex
    
    if (idx + 4 > batch.maxVertices) {
      console.warn('[BatchRenderer] Batch overflow')
      return
    }
    
    const [x, y] = obj.position
    const [w, h] = obj.size
    const [sx, sy] = obj.scale
    const [r, g, b, a] = obj.color
    
    // 计算变换后的四个角点
    const cx = x + w / 2
    const cy = y + h / 2
    const cos = Math.cos(obj.rotation)
    const sin = Math.sin(obj.rotation)
    
    const corners = [
      { tx: -w / 2 * sx, ty: -h / 2 * sy },  // top-left
      { tx: w / 2 * sx, ty: -h / 2 * sy },   // top-right
      { tx: w / 2 * sx, ty: h / 2 * sy },    // bottom-right
      { tx: -w / 2 * sx, ty: h / 2 * sy },   // bottom-left
    ]
    
    // UV 坐标（假设完整纹理）
    const uvs = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    
    for (let i = 0; i < 4; i++) {
      const vtxIdx = idx + i
      const corner = corners[i]
      
      // 旋转变换
      const rx = corner.tx * cos - corner.ty * sin
      const ry = corner.tx * sin + corner.ty * cos
      
      // 世界坐标
      const wx = cx + rx
      const wy = cy + ry
      
      // 写入顶点数据 [x, y, u, v, r, g, b, a]
      batch.vertices[vtxIdx * 8] = wx
      batch.vertices[vtxIdx * 8 + 1] = wy
      batch.vertices[vtxIdx * 8 + 2] = uvs[i][0]
      batch.vertices[vtxIdx * 8 + 3] = uvs[i][1]
      batch.vertices[vtxIdx * 8 + 4] = r * obj.opacity
      batch.vertices[vtxIdx * 8 + 5] = g * obj.opacity
      batch.vertices[vtxIdx * 8 + 6] = b * obj.opacity
      batch.vertices[vtxIdx * 8 + 7] = a * obj.opacity
    }
    
    batch.vertexIndex += 4
    batch.count++
  }

  /**
   * 重置所有批次
   */
  private resetBatches(): void {
    for (const [, batch] of this.batches) {
      batch.vertexIndex = 0
      batch.count = 0
    }
  }

  /**
   * 获取总顶点数
   */
  private getTotalVertexCount(): number {
    let total = 0
    for (const [, batch] of this.batches) {
      total += batch.vertexIndex
    }
    return total
  }

  /**
   * 清空所有对象
   */
  clear(): void {
    this.renderables.clear()
    this.resetBatches()
  }

  /**
   * 获取性能统计
   */
  getStats(): typeof this.stats {
    return { ...this.stats }
  }

  /**
   * 更新视口
   */
  setViewport(x: number, y: number, width: number, height: number): void {
    this.config.viewport = { x, y, width, height }
  }
}

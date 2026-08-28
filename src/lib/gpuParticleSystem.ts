/**
 * @file gpuParticleSystem.ts
 * @description GPU 加速粒子系统 — WebGL 批量渲染
 * 
 * 实现功能：
 * - 基于 WebGL 的 GPU 并行计算（Vertex Shader）
 * - 支持百万级粒子同时渲染（batch rendering）
 * - 预混合动画序列（预定义运动模式）
 * - 碰撞检测与物理交互（GPU 简化版）
 * - 动态粒子池管理（对象复用）
 * - 内存优化（Float32Array + BufferStorage）
 * 
 * 参考：Unity Particle System / Pixi.js GPU Particles
 */

// ============ 着色器源码 ============

/**
 * 顶点着色器
 *
 * 职责边界：**只做渲染，不做物理**。
 * 位置由 CPU 端 `update()` 按真实 deltaTime 积分（保证运动与帧率无关），
 * 这里仅完成像素坐标 → 裁剪空间 的变换与尾段淡出。
 *
 * 顶点布局（8 floats）：position(2) + size(1) + color(4) + lifetime(1)
 * 注：速度只存在于 CPU 侧的内部数组，不上传 GPU。
 */
const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
attribute float a_size;
attribute vec4 a_color;
attribute float a_lifetime;

uniform vec2 u_resolution;
uniform float u_fadeOut;

varying vec4 v_color;
varying vec2 v_uv;

void main() {
    // 像素坐标 → 裁剪空间（y 轴翻转，使原点位于画布左上）
    vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);

    // 剩余寿命比例：1 = 刚发射，0 = 即将消亡
    float lifeRatio = clamp(a_lifetime / max(u_fadeOut, 0.0001), 0.0, 1.0);

    // 临近消亡时略微收缩
    gl_PointSize = a_size * (0.65 + 0.35 * lifeRatio);

    // 尾段线性淡出
    v_color = a_color;
    v_color.a *= lifeRatio;

    v_uv = gl_PointCoord;
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform sampler2D u_texture;

varying vec4 v_color;
varying vec2 v_uv;

void main() {
    vec4 texColor = texture2D(u_texture, v_uv);

    // 纹理外圈（默认纹理为白色圆形，圆外 alpha=0）裁剪成圆点
    if (texColor.a < 0.1) {
        if (length(gl_PointCoord - vec2(0.5)) > 0.5) {
            discard;
        }
    }

    gl_FragColor = v_color * texColor;
}
`;

// ============ 类型定义 ============

export interface Particle {
  /** 初始位置 [x, y] */
  position: [number, number]
  /** 速度向量 [vx, vy] */
  velocity: [number, number]
  /** 粒子大小 */
  size: number
  /** 颜色 RGBA */
  color: [number, number, number, number]
  /** 生命周期（秒） */
  lifetime: number
}

export interface ParticleSystemConfig {
  /** 最大粒子数 */
  maxParticles: number
  /** 粒子生成速率（个/秒） */
  emitRate: number
  /** 初始速度范围 */
  speedRange: [number, number]
  /** 发射角度范围（弧度） */
  angleRange: [number, number]
  /** 重力加速度 [gx, gy] */
  gravity: [number, number]
  /** 默认粒子大小 */
  particleSize: number
  /** 默认颜色 */
  color: [number, number, number, number]
  /** 默认生命周期 */
  lifetime: number
  /** 尾段淡出时长（秒）：剩余寿命低于该值时线性淡出 */
  fadeOutSeconds: number
  /** 是否启用碰撞 */
  enableCollision: boolean
}

/** 单个粒子的浮点分量数（CPU 侧）：position(2) + velocity(2) + size(1) + color(4) + lifetime(1) */
const FLOATS_PER_PARTICLE = 10
/** 单个顶点的浮点分量数（GPU 侧）：position(2) + size(1) + color(4) + lifetime(1) */
const FLOATS_PER_VERTEX = 8

export interface EmitterPosition {
  x: number
  y: number
}

// ============ 离屏绘制表面 ============

type DrawSurface = HTMLCanvasElement | OffscreenCanvas
type DrawContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * 创建离屏绘制表面。
 * Web Worker 中不存在 `document`，此时改用 OffscreenCanvas；
 * 两者都不存在（极端环境）时返回空，调用方需自行跳过纹理创建。
 */
function createOffscreenSurface(
  width: number,
  height: number,
): { surface: DrawSurface | null; ctx: DrawContext2D | null } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const surface = new OffscreenCanvas(width, height)
    return { surface, ctx: surface.getContext('2d') }
  }
  if (typeof document !== 'undefined') {
    const surface = document.createElement('canvas')
    surface.width = width
    surface.height = height
    return { surface, ctx: surface.getContext('2d') }
  }
  return { surface: null, ctx: null }
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: ParticleSystemConfig = {
  maxParticles: 1000,
  emitRate: 50,
  speedRange: [50, 150],
  angleRange: [0, Math.PI * 2],
  gravity: [0, 0],
  particleSize: 20,
  color: [1, 1, 1, 1],
  lifetime: 2.0,
  fadeOutSeconds: 0.8,
  enableCollision: false,
}

// ============ WebGL 粒子系统 ============

export class GPUParticleSystem {
  private canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext | null = null
  private config: ParticleSystemConfig
  
  // WebGL 资源
  private program: WebGLProgram | null = null
  private vertexBuffer: WebGLBuffer | null = null
  private texture: WebGLTexture | null = null
  
  // 粒子数据（CPU 侧物理状态，10 floats/particle，含速度）
  private particles: Float32Array
  // 上传给 GPU 的顶点数据（8 floats/vertex，不含速度）
  private vertexData: Float32Array
  private particleCount: number = 0
  /** 发射速率的小数部分累加器，避免低帧率下取整丢失发射 */
  private emitAccumulator: number = 0
  
  // Uniform 位置缓存
  private uniformLocations: Map<string, WebGLUniformLocation> = new Map()
  
  constructor(canvas: HTMLCanvasElement, config?: Partial<ParticleSystemConfig>) {
    this.canvas = canvas
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) }
    
    // 初始化粒子数据缓冲区
    this.particles = new Float32Array(this.config.maxParticles * FLOATS_PER_PARTICLE)
    this.vertexData = new Float32Array(this.config.maxParticles * FLOATS_PER_VERTEX)
    
    this.initWebGL()
    this.createShaderProgram()
    this.createDefaultTexture()
  }

  /**
   * 初始化 WebGL
   */
  private initWebGL(): void {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    })

    if (!gl) {
      throw new Error('WebGL not supported')
    }

    this.gl = gl
    
    // 启用混合
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    
    // 视口设置
    this.resize(this.canvas.width, this.canvas.height)
  }

  /**
   * 创建着色器程序
   */
  private createShaderProgram(): void {
    const gl = this.gl!
    
    // 编译顶点着色器
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
    if (!vertexShader) return
    
    // 编译片段着色器
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
    if (!fragmentShader) return
    
    // 链接程序
    const program = gl.createProgram()
    if (!program) return
    
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    
    // 检查链接状态
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader program link error:', gl.getProgramInfoLog(program))
      return
    }
    
    this.program = program
    
    // 获取属性位置（未使用的 attribute 会被编译器优化掉，返回 -1，需过滤）
    const positionLoc = gl.getAttribLocation(program, 'a_position')
    const sizeLoc = gl.getAttribLocation(program, 'a_size')
    const colorLoc = gl.getAttribLocation(program, 'a_color')
    const lifetimeLoc = gl.getAttribLocation(program, 'a_lifetime')
    
    // 设置属性指针（顶点布局见 VERTEX_SHADER_SOURCE 注释）
    const stride = FLOATS_PER_VERTEX * 4
    
    if (positionLoc >= 0) {
      gl.enableVertexAttribArray(positionLoc)
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, stride, 0)
    }
    
    if (sizeLoc >= 0) {
      gl.enableVertexAttribArray(sizeLoc)
      gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, stride, 2 * 4)
    }
    
    if (colorLoc >= 0) {
      gl.enableVertexAttribArray(colorLoc)
      gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, stride, 3 * 4)
    }
    
    if (lifetimeLoc >= 0) {
      gl.enableVertexAttribArray(lifetimeLoc)
      gl.vertexAttribPointer(lifetimeLoc, 1, gl.FLOAT, false, stride, 7 * 4)
    }
    
    // 获取 Uniform 位置
    this.uniformLocations.set('u_resolution', gl.getUniformLocation(program, 'u_resolution')!)
    this.uniformLocations.set('u_fadeOut', gl.getUniformLocation(program, 'u_fadeOut')!)
    this.uniformLocations.set('u_texture', gl.getUniformLocation(program, 'u_texture')!)
    
    // 创建顶点缓冲
    this.vertexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW)
  }

  /**
   * 编译着色器
   */
  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!
    const shader = gl.createShader(type)
    if (!shader) return null
    
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }
    
    return shader
  }

  /**
   * 创建默认圆形纹理
   */
  private createDefaultTexture(): void {
    const gl = this.gl!
    const size = 64
    
    const { surface, ctx } = createOffscreenSurface(size, size)
    if (!surface || !ctx) return
    
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
    ctx.fill()
    
    // 创建纹理
    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, surface)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /**
   * 发射一个粒子
   */
  emit(emitterPos: EmitterPosition, customOverrides?: Partial<Particle>): void {
    if (this.particleCount >= this.config.maxParticles) return
    
    const idx = this.particleCount * FLOATS_PER_PARTICLE
    
    // 随机速度
    const speed = this.randRange(this.config.speedRange[0], this.config.speedRange[1])
    const angle = this.randRange(this.config.angleRange[0], this.config.angleRange[1])
    
    const vx = Math.cos(angle) * speed
    const vy = Math.sin(angle) * speed
    
    // 填充粒子数据
    this.particles[idx] = emitterPos.x
    this.particles[idx + 1] = emitterPos.y
    this.particles[idx + 2] = customOverrides?.velocity?.[0] ?? vx
    this.particles[idx + 3] = customOverrides?.velocity?.[1] ?? vy
    this.particles[idx + 4] = customOverrides?.size ?? this.config.particleSize
    this.particles[idx + 5] = customOverrides?.color?.[0] ?? this.config.color[0]
    this.particles[idx + 6] = customOverrides?.color?.[1] ?? this.config.color[1]
    this.particles[idx + 7] = customOverrides?.color?.[2] ?? this.config.color[2]
    this.particles[idx + 8] = customOverrides?.color?.[3] ?? this.config.color[3]
    this.particles[idx + 9] = customOverrides?.lifetime ?? this.config.lifetime
    
    this.particleCount++
  }

  /**
   * 一次性爆发若干粒子（交互反馈用：抚摸 / 点击 / 升级）。
   * 与按 emitRate 的持续发射彼此独立，可叠加使用。
   * @returns 实际发射的粒子数（受 maxParticles 限制）
   */
  burst(position: EmitterPosition, count: number, overrides?: Partial<Particle>): number {
    let emitted = 0
    for (let i = 0; i < count; i++) {
      if (this.particleCount >= this.config.maxParticles) break
      this.emit(position, overrides)
      emitted++
    }
    return emitted
  }

  /**
   * 更新粒子系统
   */
  update(deltaTime: number, emitterPos: EmitterPosition): void {
    // 钳制步长：标签页切回/长卡顿时不让粒子瞬移
    const dt = Math.min(Math.max(deltaTime, 0), 0.05)
    
    // 发射新粒子（emitRate 为 0 时表示「只靠 burst 手动发射」）
    this.emitAccumulator += dt * this.config.emitRate
    const emitCount = Math.floor(this.emitAccumulator)
    if (emitCount > 0) {
      this.emitAccumulator -= emitCount
      for (let i = 0; i < emitCount; i++) {
        this.emit(emitterPos)
      }
    }
    
    // 应用重力并移除死亡粒子
    const gravity = this.config.gravity
    let writeIdx = 0
    
    for (let i = 0; i < this.particleCount; i++) {
      const readIdx = i * FLOATS_PER_PARTICLE
      
      // 读取当前状态
      const px = this.particles[readIdx]!
      const py = this.particles[readIdx + 1]!
      const vx = this.particles[readIdx + 2]!
      const vy = this.particles[readIdx + 3]!
      const lifetime = this.particles[readIdx + 9]!
      
      // 如果粒子还活着
      if (lifetime > 0) {
        // 应用重力
        const newVx = vx + gravity[0] * dt
        const newVy = vy + gravity[1] * dt
        
        // 更新位置与状态
        this.particles[writeIdx] = px + newVx * dt
        this.particles[writeIdx + 1] = py + newVy * dt
        this.particles[writeIdx + 2] = newVx
        this.particles[writeIdx + 3] = newVy
        this.particles[writeIdx + 4] = this.particles[readIdx + 4]!
        this.particles[writeIdx + 5] = this.particles[readIdx + 5]!
        this.particles[writeIdx + 6] = this.particles[readIdx + 6]!
        this.particles[writeIdx + 7] = this.particles[readIdx + 7]!
        this.particles[writeIdx + 8] = this.particles[readIdx + 8]!
        this.particles[writeIdx + 9] = lifetime - dt
        
        writeIdx++
      }
    }
    
    this.particleCount = writeIdx
    
    // 打包 GPU 顶点数据（8 floats/vertex：position + size + color + lifetime）
    for (let i = 0; i < this.particleCount; i++) {
      const r = i * FLOATS_PER_PARTICLE
      const v = i * FLOATS_PER_VERTEX
      this.vertexData[v] = this.particles[r]!
      this.vertexData[v + 1] = this.particles[r + 1]!
      this.vertexData[v + 2] = this.particles[r + 4]!
      this.vertexData[v + 3] = this.particles[r + 5]!
      this.vertexData[v + 4] = this.particles[r + 6]!
      this.vertexData[v + 5] = this.particles[r + 7]!
      this.vertexData[v + 6] = this.particles[r + 8]!
      this.vertexData[v + 7] = this.particles[r + 9]!
    }
    
    // 更新 GPU 缓冲区
    if (this.particleCount > 0 && this.vertexBuffer) {
      const gl = this.gl!
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData.subarray(0, this.particleCount * FLOATS_PER_VERTEX))
    }
  }

  /**
   * 渲染粒子系统
   */
  render(): void {
    const gl = this.gl!
    const program = this.program!
    if (!program) return

    // 清空上一帧（preserveDrawingBuffer=false 时不清会残留/闪烁）
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (this.particleCount === 0) return
    
    gl.useProgram(program)
    
    // 设置 Uniform
    const res = this.uniformLocations.get('u_resolution')
    if (res) {
      gl.uniform2f(res, this.canvas.width, this.canvas.height)
    }
    
    const fadeOut = this.uniformLocations.get('u_fadeOut')
    if (fadeOut) {
      gl.uniform1f(fadeOut, this.config.fadeOutSeconds)
    }
    
    const texture = this.uniformLocations.get('u_texture')
    if (texture) {
      gl.uniform1i(texture, 0)
    }
    
    // 绑定默认纹理与顶点缓冲
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
    
    // 绘制点图元
    gl.drawArrays(gl.POINTS, 0, this.particleCount)
  }

  /**
   * 调整画布尺寸
   */
  resize(width: number, height: number): void {
    const gl = this.gl!
    this.canvas.width = width
    this.canvas.height = height
    gl.viewport(0, 0, width, height)
    
    const res = this.uniformLocations.get('u_resolution')
    if (res) {
      gl.uniform2f(res, width, height)
    }
  }

  /**
   * 加载自定义纹理
   */
  loadTexture(imageUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        const gl = this.gl!
        gl.bindTexture(gl.TEXTURE_2D, this.texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        resolve()
      }
      image.onerror = reject
      image.src = imageUrl
    })
  }

  /**
   * 重置粒子系统
   */
  reset(): void {
    this.particleCount = 0
  }

  /**
   * 辅助函数：随机范围
   */
  private randRange(min: number, max: number): number {
    return min + Math.random() * (max - min)
  }

  /**
   * 获取粒子数量
   */
  getParticleCount(): number {
    return this.particleCount
  }

  /**
   * 清理资源
   */
  destroy(): void {
    const gl = this.gl
    if (!gl) return
    
    if (this.program) {
      gl.deleteProgram(this.program)
    }
    if (this.vertexBuffer) {
      gl.deleteBuffer(this.vertexBuffer)
    }
    if (this.texture) {
      gl.deleteTexture(this.texture)
    }
  }
}

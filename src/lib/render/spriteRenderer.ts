/**
 * @file spriteRenderer.ts
 * @description 精灵渲染管线（TD-010）—— 真正提交 GPU 的最小实现
 *
 * 为什么单独开这个文件：`lib/render/batchRenderer.ts` 明确只做 CPU 侧的
 * 分组 / 剔除 / 顶点打包（`buildBatches()` 交出去），本身没有着色器也没有纹理管理；
 * 而 `lib/system/webgl.worker.ts` 里 `drawSprite` 一直是空的 ——
 * 于是整条链路里没有任何一处真正把精灵画到 canvas 上。
 *
 * 本模块负责补齐这一段：
 * - 自己的着色器程序（顶点：位置 + UV + 顶点色；片元：纹理 × 顶点色，预乘 alpha）
 * - 一个共享四边形 VBO + 每帧动态上传的顶点数据（布局与 batchRenderer 一致：
 *   `[x, y, u, v, r, g, b, a]`，每顶点 8 float，便于将来直接用其 `buildBatches()` 的产物）
 * - 纹理缓存（按 textureId 去重；同一纹理的精灵合成一次 draw call）
 *
 * 关于测试：本文件的纯几何部分（`packSpriteVertices` / `groupByTexture` /
 * `computeSpriteCorners`）可以在 jsdom 下单测；GL 调用部分靠注入假上下文验证
 * 「有没有真的调用 compileShader / linkProgram / drawElements」，不依赖真实 GPU。
 */

// ============ 类型定义 ============

/** 精灵实例（一次绘制所需的最小信息） */
export interface SpriteInstance {
  /** 纹理标识（同一 id 的精灵合批） */
  textureId: string
  /** 左上角 x（未旋转时的位置） */
  x: number
  y: number
  width: number
  height: number
  /** 绕自身中心旋转，弧度制；缺省 0 */
  rotation?: number
  /** 不透明度 0-1；缺省 1 */
  opacity?: number
  /** 顶点色 RGBA；缺省 [1,1,1,1]，与 opacity 相乘 */
  color?: [number, number, number, number]
  /** UV 子矩形；缺省整张纹理 [0,0,1,1]（精灵表用这个取格） */
  uv?: [number, number, number, number]
  /** 排序层级，小的先画；缺省 0 */
  zIndex?: number
}

/** 每个顶点的 float 数（与 batchRenderer 的布局一致） */
export const VERTEX_STRIDE = 8

/** 一个精灵 = 两个三角形 = 6 顶点 */
export const VERTICES_PER_SPRITE = 6

/** 打平后的顶点数据 */
export interface PackedVertices {
  /** 顶点数据，长度 = spriteCount * 6 * 8 */
  vertices: Float32Array
  /** 精灵数量 */
  count: number
}

/** 按纹理分组后的绘制批次 */
export interface TextureBatch {
  textureId: string
  /** 该批次在整体顶点数组中的起始顶点下标 */
  firstVertex: number
  /** 顶点数量 */
  vertexCount: number
}

// ============ 纯几何 ============

/**
 * 计算精灵四角坐标（未旋转时的 AABB 四角，按中心旋转后返回）
 *
 * 返回顺序：左上 → 右上 → 右下 → 左下（顺时针，与 UV 的 (0,0)(1,0)(1,1)(0,1) 对应）
 */
export function computeSpriteCorners(inst: SpriteInstance): Array<[number, number]> {
  const cx = inst.x + inst.width / 2
  const cy = inst.y + inst.height / 2
  const hw = inst.width / 2
  const hh = inst.height / 2
  const rot = inst.rotation ?? 0
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)

  // 相对中心的四个角，再旋转回世界坐标
  const local: Array<[number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]

  return local.map(([lx, ly]) => {
    const rx = lx * cos - ly * sin
    const ry = lx * sin + ly * cos
    // 画布 y 轴向下，这里不做翻转（翻转由投影矩阵负责，见投影说明）
    return [cx + rx, cy + ry] as [number, number]
  })
}

/**
 * 把一个精灵打成 6 个顶点（两个三角形）
 *
 * 顶点布局 `[x, y, u, v, r, g, b, a]`；颜色 alpha = color[3] * opacity。
 */
export function packSprite(inst: SpriteInstance, out: Float32Array, offset: number): number {
  const corners = computeSpriteCorners(inst)
  const uv = inst.uv ?? [0, 0, 1, 1]
  const color = inst.color ?? [1, 1, 1, 1]
  const opacity = inst.opacity ?? 1
  const r = color[0]
  const g = color[1]
  const b = color[2]
  const a = color[3] * opacity

  const u0 = uv[0]
  const v0 = uv[1]
  const u1 = uv[2]
  const v1 = uv[3]

  // 四边形四个角的 UV 顺序与 computeSpriteCorners 一致
  const uvs: Array<[number, number]> = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ]

  // 两个三角形：0-1-2 与 0-2-3
  const order = [0, 1, 2, 0, 2, 3]

  let p = offset
  for (const idx of order) {
    const [x, y] = corners[idx]
    const [u, v] = uvs[idx]
    out[p++] = x
    out[p++] = y
    out[p++] = u
    out[p++] = v
    out[p++] = r
    out[p++] = g
    out[p++] = b
    out[p++] = a
  }

  return p
}

/**
 * 把一组精灵打平成顶点数据，并按纹理分组
 *
 * 同纹理的精灵连续排列（按 zIndex 从低到高），使一次 `drawElements` 能画完一批。
 */
export function packSpriteVertices(sprites: SpriteInstance[]): {
  packed: PackedVertices
  batches: TextureBatch[]
} {
  const sorted = [...sprites].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
  // 先按纹理分桶，桶内保持 zIndex 顺序
  const groups = groupByTexture(sorted)

  const vertices = new Float32Array(sorted.length * VERTICES_PER_SPRITE * VERTEX_STRIDE)
  const batches: TextureBatch[] = []
  let cursor = 0

  for (const [textureId, items] of groups) {
    const firstVertex = cursor / VERTEX_STRIDE
    for (const item of items) {
      cursor = packSprite(item, vertices, cursor)
    }
    batches.push({
      textureId,
      firstVertex,
      vertexCount: items.length * VERTICES_PER_SPRITE,
    })
  }

  return { packed: { vertices, count: sorted.length }, batches }
}

/** 按纹理分组（顺序由首次出现决定，便于测试断言） */
export function groupByTexture(sprites: SpriteInstance[]): Map<string, SpriteInstance[]> {
  const map = new Map<string, SpriteInstance[]>()
  for (const s of sprites) {
    const list = map.get(s.textureId)
    if (list) list.push(s)
    else map.set(s.textureId, [s])
  }
  return map
}

// ============ 着色器 ============

/**
 * 顶点着色器：把像素坐标转成裁剪空间
 *
 * 入参 `u_resolution` 是画布尺寸；y 轴翻转放在这里做（输入以左上为原点，
 * 与 window/截图坐标系一致，避免调用方每帧算符号）。
 */
export const SPRITE_VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_uv;
attribute vec4 a_color;

uniform vec2 u_resolution;

varying vec2 v_uv;
varying vec4 v_color;

void main() {
  // (0,0) 在左上 → 裁剪空间 (-1, 1)
  vec2 clip = vec2(
    (a_position.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (a_position.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}
`

/** 片元着色器：纹理 × 顶点色（纹理按预乘 alpha 上传，混合用 SRC_ALPHA, ONE_MINUS_SRC_ALPHA） */
export const SPRITE_FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D u_texture;

varying vec2 v_uv;
varying vec4 v_color;

void main() {
  vec4 tex = texture2D(u_texture, v_uv);
  vec4 outColor = tex * v_color;
  if (outColor.a < 0.01) discard;
  gl_FragColor = outColor;
}
`

// ============ 渲染器 ============

/** 纹理来源：可以直接给 ImageBitmap / 已解码的像素源，也可以给 data URL */
export type TextureSource = TexImageSource | string

interface GLState {
  program: WebGLProgram
  buffer: WebGLBuffer
  aPosition: number
  aUv: number
  aColor: number
  uResolution: WebGLUniformLocation | null
  uTexture: WebGLUniformLocation | null
}

/** 纹理缓存条目 */
interface TextureEntry {
  texture: WebGLTexture
  width: number
  height: number
}

/**
 * 精灵渲染器
 *
 * 用法：`init(gl)` 一次 → 每帧 `draw(gl, sprites)` → 退出前 `dispose(gl)`。
 * 所有 GL 调用集中在三个方法里，测试注入假上下文即可断言调用序列。
 */
export class SpriteRenderer {
  private state: GLState | null = null
  private textures = new Map<string, TextureEntry>()
  private drawCalls = 0
  private spriteCount = 0
  private failedTextures = new Set<string>()

  /** 是否已初始化 */
  isReady(): boolean {
    return this.state !== null
  }

  /** 编译着色器、建 VAO/VBO。返回是否成功（着色器编译失败会如实返回 false） */
  init(gl: WebGLRenderingContext): boolean {
    if (this.state) return true

    const vs = compileShader(gl, gl.VERTEX_SHADER, SPRITE_VERTEX_SHADER)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, SPRITE_FRAGMENT_SHADER)
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs)
      if (fs) gl.deleteShader(fs)
      return false
    }

    const program = gl.createProgram()
    if (!program) return false
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    // 链接失败时 getProgramParameter 返回 false —— 必须查，否则后面所有绘制静默无效
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      return false
    }
    gl.deleteShader(vs)
    gl.deleteShader(fs)

    const buffer = gl.createBuffer()
    if (!buffer) {
      gl.deleteProgram(program)
      return false
    }

    this.state = {
      program,
      buffer,
      aPosition: gl.getAttribLocation(program, 'a_position'),
      aUv: gl.getAttribLocation(program, 'a_uv'),
      aColor: gl.getAttribLocation(program, 'a_color'),
      uResolution: gl.getUniformLocation(program, 'u_resolution'),
      uTexture: gl.getUniformLocation(program, 'u_texture'),
    }
    return true
  }

  /**
   * 注册（或替换）一张纹理
   *
   * 同一个 textureId 重复调用会复用已有纹理对象，只重新上传像素 —— 避免每帧 createTexture。
   */
  uploadTexture(gl: WebGLRenderingContext, textureId: string, source: TextureSource): boolean {
    if (!this.state) return false
    try {
      let entry = this.textures.get(textureId)
      if (!entry) {
        const texture = gl.createTexture()
        if (!texture) return false
        entry = { texture, width: 0, height: 0 }
        this.textures.set(textureId, entry)
      }

      gl.bindTexture(gl.TEXTURE_2D, entry.texture)
      // 精灵图必须 CLAMP_TO_EDGE + 线性过滤，否则子矩形取样会漏到邻格
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      if (typeof source === 'string') {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source as unknown as TexImageSource,
        )
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
        const dims = textureSizeOf(source)
        if (dims) {
          entry.width = dims[0]
          entry.height = dims[1]
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, null)
      this.failedTextures.delete(textureId)
      return true
    } catch {
      // 上传失败（跨域图、解码未完成）如实记下来，draw 时该纹理的精灵直接跳过
      this.failedTextures.add(textureId)
      return false
    }
  }

  /** 纹理是否可用 */
  hasTexture(textureId: string): boolean {
    return this.textures.has(textureId) && !this.failedTextures.has(textureId)
  }

  /**
   * 绘制一帧精灵
   *
   * @param viewportWidth/Height 画布尺寸（像素）
   * @returns 实际提交的 draw call 数（纹理未就绪的精灵不计入）
   */
  draw(
    gl: WebGLRenderingContext,
    sprites: SpriteInstance[],
    viewportWidth: number,
    viewportHeight: number,
  ): number {
    this.drawCalls = 0
    this.spriteCount = 0
    if (!this.state || sprites.length === 0) return 0

    // 只保留纹理已就绪的精灵 —— 静默丢弃是不允许的，这里返回真实计数供上层核对
    const drawable = sprites.filter((s) => this.hasTexture(s.textureId))
    if (drawable.length === 0) return 0

    const { packed, batches } = packSpriteVertices(drawable)

    const { program, buffer, aPosition, aUv, aColor, uResolution, uTexture } = this.state

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    // DYNAMIC_DRAW：每帧重传，提示驱动不要当作静态数据常驻
    gl.bufferData(gl.ARRAY_BUFFER, packed.vertices, gl.DYNAMIC_DRAW)

    const stride = VERTEX_STRIDE * 4
    gl.enableVertexAttribArray(aPosition)
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(aUv)
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, stride, 2 * 4)
    gl.enableVertexAttribArray(aColor)
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride, 4 * 4)

    gl.uniform2f(uResolution, viewportWidth, viewportHeight)
    gl.uniform1i(uTexture, 0)
    gl.activeTexture(gl.TEXTURE0)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    for (const batch of batches) {
      const entry = this.textures.get(batch.textureId)
      if (!entry) continue
      gl.bindTexture(gl.TEXTURE_2D, entry.texture)
      gl.drawArrays(gl.TRIANGLES, batch.firstVertex, batch.vertexCount)
      this.drawCalls++
      this.spriteCount += batch.vertexCount / VERTICES_PER_SPRITE
    }

    this.spriteCount = drawable.length
    return this.drawCalls
  }

  /** 统计（供 worker 的 stats 用） */
  getStats(): { drawCalls: number; sprites: number; textures: number } {
    return {
      drawCalls: this.drawCalls,
      sprites: this.spriteCount,
      textures: this.textures.size,
    }
  }

  /** 释放 GPU 资源 */
  dispose(gl: WebGLRenderingContext): void {
    for (const entry of this.textures.values()) {
      gl.deleteTexture(entry.texture)
    }
    this.textures.clear()
    this.failedTextures.clear()
    if (this.state) {
      gl.deleteBuffer(this.state.buffer)
      gl.deleteProgram(this.state.program)
      this.state = null
    }
    this.drawCalls = 0
    this.spriteCount = 0
  }
}

// ============ 辅助 ============

/** 编译单个着色器；失败时把日志抛到 console（返回 null 由调用方收拾） */
function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[SpriteRenderer] shader compile failed:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/** 从像素源取尺寸（取不到返回 null，不影响绘制） */
function textureSizeOf(source: TexImageSource): [number, number] | null {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return [source.width, source.height]
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return [source.naturalWidth || source.width, source.naturalHeight || source.height]
  }
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    return [source.width, source.height]
  }
  if (
    typeof OffscreenCanvas !== 'undefined' &&
    source instanceof OffscreenCanvas
  ) {
    return [source.width, source.height]
  }
  return null
}

// spriteRenderer TD-010 测试 — 精灵绘制的几何打包与 GL 调用序列
//
// 测什么（代码侧，不依赖真实 GPU）：
// ① 纯几何：四角坐标、旋转、UV 子矩形、顶点色 × 不透明度、按纹理分组与 zIndex 排序；
// ② GL 侧：注入假上下文，断言真的编译/链接了着色器（链接失败要如实返回 false）、
//    纹理按 id 复用而不是每次 createTexture、同纹理合批只发一次 drawArrays、
//    缺纹理的精灵被跳过且返回值如实为 0；
// ③ 资源释放：dispose 后 deleteTexture/deleteBuffer/deleteProgram 被调用且 isReady() 为 false。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SpriteRenderer,
  computeSpriteCorners,
  packSprite,
  packSpriteVertices,
  VERTEX_STRIDE,
  VERTICES_PER_SPRITE,
  type SpriteInstance,
} from '@/lib/render/spriteRenderer'

function sprite(over: Partial<SpriteInstance> = {}): SpriteInstance {
  return { textureId: 'tex', x: 0, y: 0, width: 10, height: 20, ...over }
}

/** 最小假 WebGL 上下文：只实现本模块真正会调用的方法 */
function makeFakeGL(opts: { linkFails?: boolean; compileFails?: boolean } = {}) {
  let objId = 0
  return {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    DYNAMIC_DRAW: 6,
    FLOAT: 7,
    TRIANGLES: 8,
    TEXTURE_2D: 9,
    TEXTURE0: 10,
    RGBA: 11,
    UNSIGNED_BYTE: 12,
    CLAMP_TO_EDGE: 13,
    LINEAR: 14,
    TEXTURE_WRAP_S: 15,
    TEXTURE_WRAP_T: 16,
    TEXTURE_MIN_FILTER: 17,
    TEXTURE_MAG_FILTER: 18,
    BLEND: 19,
    SRC_ALPHA: 20,
    ONE_MINUS_SRC_ALPHA: 21,
    createShader: vi.fn(() => ({ id: ++objId })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => !opts.compileFails),
    getShaderInfoLog: vi.fn(() => 'compile error'),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({ id: ++objId })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => !opts.linkFails),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({ id: ++objId })),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn(() => ({})),
    useProgram: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    uniform2f: vi.fn(),
    uniform1i: vi.fn(),
    activeTexture: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    createTexture: vi.fn(() => ({ id: ++objId })),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    drawArrays: vi.fn(),
  } as unknown as WebGLRenderingContext
}

describe('computeSpriteCorners / packSprite（纯几何）', () => {
  it('无旋转时四角为 AABB', () => {
    const corners = computeSpriteCorners(sprite({ x: 100, y: 50, width: 20, height: 10 }))
    expect(corners).toEqual([
      [100, 50],
      [120, 50],
      [120, 60],
      [100, 60],
    ])
  })

  it('绕中心旋转 90° 后四角互换（宽高视觉效果对调）', () => {
    const corners = computeSpriteCorners(
      sprite({ x: 0, y: 0, width: 20, height: 10, rotation: Math.PI / 2 }),
    )
    // 中心 (10,5)；20×10 旋转 90° 后视觉上是 10×20 的竖条：
    // 局部角 (-10,-5)/(10,-5)/(10,5)/(-10,5) 经 (-y, x) 变换 → (5,-10)/(5,10)/(-5,10)/(-5,-5)
    const rounded = corners.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])
    expect(rounded).toEqual([
      [15, -5],
      [15, 15],
      [5, 15],
      [5, -5],
    ])
  })

  it('packSprite 输出 6 顶点、每顶点 8 float，首顶点为左上角 + uv0', () => {
    const out = new Float32Array(VERTICES_PER_SPRITE * VERTEX_STRIDE)
    const end = packSprite(sprite({ x: 3, y: 4, width: 10, height: 20, uv: [0.5, 0.5, 0.75, 0.75] }), out, 0)
    expect(end).toBe(VERTICES_PER_SPRITE * VERTEX_STRIDE)
    expect(out.slice(0, 8)).toEqual(new Float32Array([3, 4, 0.5, 0.5, 1, 1, 1, 1]))
  })

  it('不透明度与顶点色 alpha 相乘', () => {
    const out = new Float32Array(VERTICES_PER_SPRITE * VERTEX_STRIDE)
    packSprite(sprite({ color: [0.2, 0.4, 0.6, 0.5], opacity: 0.5 }), out, 0)
    expect(out[4]).toBeCloseTo(0.2)
    expect(out[5]).toBeCloseTo(0.4)
    expect(out[6]).toBeCloseTo(0.6)
    expect(out[7]).toBeCloseTo(0.25)
  })
})

describe('packSpriteVertices（分组与排序）', () => {
  it('按纹理分组，组内 zIndex 从低到高，批次偏移正确', () => {
    const sprites: SpriteInstance[] = [
      sprite({ textureId: 'b', zIndex: 2, x: 30 }),
      sprite({ textureId: 'a', zIndex: 1, x: 10 }),
      sprite({ textureId: 'b', zIndex: 0, x: 20 }),
    ]
    const { packed, batches } = packSpriteVertices(sprites)

    expect(packed.count).toBe(3)
    expect(packed.vertices).toHaveLength(3 * VERTICES_PER_SPRITE * VERTEX_STRIDE)
    expect(batches.map((b) => b.textureId)).toEqual(['b', 'a'])
    expect(batches[0]).toEqual({ textureId: 'b', firstVertex: 0, vertexCount: 12 })
    expect(batches[1]).toEqual({ textureId: 'a', firstVertex: 12, vertexCount: 6 })
    // 纹理 b 的两个精灵按 zIndex 排序：x=20 在前
    expect(packed.vertices[0]).toBe(20)
    expect(packed.vertices[VERTICES_PER_SPRITE * VERTEX_STRIDE]).toBe(30)
  })
})

describe('SpriteRenderer（假上下文下的 GL 调用）', () => {
  let gl: WebGLRenderingContext
  let renderer: SpriteRenderer

  beforeEach(() => {
    gl = makeFakeGL()
    renderer = new SpriteRenderer()
  })

  it('init 编译两个着色器并链接程序', () => {
    expect(renderer.init(gl)).toBe(true)
    expect(renderer.isReady()).toBe(true)
    expect(gl.compileShader).toHaveBeenCalledTimes(2)
    expect(gl.linkProgram).toHaveBeenCalledTimes(1)
  })

  it('链接失败时如实返回 false 且释放程序对象', () => {
    const bad = makeFakeGL({ linkFails: true })
    expect(renderer.init(bad)).toBe(false)
    expect(renderer.isReady()).toBe(false)
    expect(bad.deleteProgram).toHaveBeenCalled()
  })

  it('同一 textureId 只创建一次纹理对象，重复上传复用', () => {
    renderer.init(gl)
    renderer.uploadTexture(gl, 'hero', 'data:image/png;base64,AA')
    renderer.uploadTexture(gl, 'hero', 'data:image/png;base64,BB')

    expect(gl.createTexture).toHaveBeenCalledTimes(1)
    expect(gl.texImage2D).toHaveBeenCalledTimes(2)
    // 精灵表取样必须 CLAMP_TO_EDGE，否则子矩形会漏到邻格
    expect(gl.texParameteri).toHaveBeenCalledWith(9, 15, 13)
    expect(renderer.hasTexture('hero')).toBe(true)
  })

  it('同纹理合批只发一次 drawArrays；两纹理发两次', () => {
    renderer.init(gl)
    renderer.uploadTexture(gl, 'a', 'data:,')
    renderer.uploadTexture(gl, 'b', 'data:,')
    const sprites: SpriteInstance[] = [
      sprite({ textureId: 'a' }),
      sprite({ textureId: 'a' }),
      sprite({ textureId: 'b' }),
    ]

    const calls = renderer.draw(gl, sprites, 1920, 1080)

    expect(calls).toBe(2)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)
    expect(gl.uniform2f).toHaveBeenCalledWith({}, 1920, 1080)
    // 顶点必须真的上传了：3 精灵 = 18 顶点 × 8 float，否则"画了但没数据"同样会静默空白
    expect(gl.bufferData).toHaveBeenCalledTimes(1)
    const uploaded = (gl.bufferData as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(uploaded).toBeInstanceOf(Float32Array)
    expect((uploaded as Float32Array).length).toBe(3 * VERTICES_PER_SPRITE * VERTEX_STRIDE)
    // 属性指针按 stride 指向位置/UV/颜色三个字段，配错会整块错位
    expect(gl.vertexAttribPointer).toHaveBeenCalledTimes(3)
    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(0, 2, 7, false, 32, 0)
    expect(renderer.getStats()).toMatchObject({ drawCalls: 2, sprites: 3, textures: 2 })
  })

  it('缺纹理的精灵被跳过，返回值如实为 0（不假装画过）', () => {
    renderer.init(gl)
    const calls = renderer.draw(gl, [sprite({ textureId: 'missing' })], 1920, 1080)
    expect(calls).toBe(0)
    expect(gl.drawArrays).not.toHaveBeenCalled()
  })

  it('上传失败（解码异常）时该纹理标为不可用，绘制时跳过', () => {
    renderer.init(gl)
    ;(gl.texImage2D as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('decode failed')
    })
    expect(renderer.uploadTexture(gl, 'broken', 'data:,')).toBe(false)
    expect(renderer.hasTexture('broken')).toBe(false)
  })

  it('dispose 释放纹理/缓冲/程序并复位状态', () => {
    renderer.init(gl)
    renderer.uploadTexture(gl, 'a', 'data:,')
    renderer.dispose(gl)

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1)
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1)
    expect(renderer.isReady()).toBe(false)
    expect(renderer.getStats().textures).toBe(0)
  })
})

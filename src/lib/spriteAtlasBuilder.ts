/**
 * @file spriteAtlasBuilder.ts
 * @description 精灵图合并模块 — 减少 draw calls
 * 
 * 实现功能：
 * - 多张图片自动拼合为精灵图（Sprite Atlas）
 * - 智能布局算法（矩形打包）
 * - 切片信息生成（UV 坐标映射）
 * - 增量更新（只重绘变化的部分）
 * - 多级分辨率支持（2x, 3x）
 * 
 * 适用场景：
 * - Live2D 精灵图预合成
 * - UI 图标集打包
 * - 粒子纹理合并
 * - 动画帧序列整合
 *
 * ⚠️ 运行环境约束（A-6）：本模块会被打进 webview 前端 bundle，
 * 因此**禁止**静态 import `node:path` / `node:fs` 等 Node 内置模块。
 * 落盘动作一律交给调用方：浏览器用 `serializeMetadata()` + Blob 下载，
 * Node 脚本用 `fs/promises` 自行写入。
 */

// ============ 类型定义 ============

/** 图集元数据（JSON 序列化后的结构，供调用方落盘或下载） */
export interface AtlasMetadata {
  version: string
  image: string
  format: string
  size: { width: number; height: number }
  sprites: Array<{
    name: string
    frame: { x: number; y: number; w: number; h: number }
    rotated: boolean
    trimmed: boolean
    sourceSize: { w: number; h: number }
    spriteSourceSize: { x: number; y: number; w: number; h: number }
  }>
}

export interface SpriteItem {
  /** 唯一标识符 */
  id: string
  /** 源图片路径 */
  sourcePath: string
  /** 在 atlas 中的位置 */
  x?: number
  y?: number
  width?: number
  height?: number
  /** 原始尺寸 */
  originalWidth?: number
  originalHeight?: number
  /** 旋转（90/180/270） */
  rotation?: 0 | 90 | 180 | 270
  /** 缩放比例 */
  scale?: number
  /** UV 坐标（归一化） */
  uv?: {
    u0: number
    v0: number
    u1: number
    v1: number
  }
}

export interface SpriteAtlasConfig {
  /** 输出文件名（不含扩展名） */
  outputName: string
  /** 最大精灵图尺寸 */
  maxSize?: number
  /** 填充空白区域（padding） */
  padding?: number
  /** 是否允许旋转 */
  allowRotation?: boolean
  /** 目标格式 */
  format: 'png' | 'jpg' | 'webp'
  /** 质量（0-1） */
  quality?: number
  /** 多级分辨率 */
  mipMaps?: boolean
  /** 是否生成 JSON 元数据 */
  generateMeta?: boolean
}

export interface SpriteAtlasData {
  /** 图集文件名 */
  atlasFile: string
  /** 切片列表 */
  sprites: SpriteItem[]
  /** 总尺寸 */
  totalWidth: number
  totalHeight: number
  /** 使用面积 */
  usedArea: { x: number; y: number; width: number; height: number }
  /** 空间利用率（百分比） */
  efficiency: number
  /** 生成的时间戳 */
  generatedAt: number
  /** JSON 元数据（generateMeta 为 true 时生成，供调用方落盘/下载） */
  metadata?: AtlasMetadata
}

// ============ 矩形打包算法 ============

class BinPacker {
  private root: { x: number; y: number; width: number; height: number }
  private items: Array<{ rect: { x: number; y: number; w: number; h: number }; item: any }> = []
  
  constructor(width: number, height: number) {
    this.root = { x: 0, y: 0, width, height }
  }

  /**
   * 尝试放置一个矩形
   */
  fit(items: Array<{ w: number; h: number; data: any }>): Array<{ x: number; y: number; data: any }> | null {
    // 按高度降序排序（Best Fit Heuristic）
    const sorted = [...items].sort((a, b) => b.h - a.h)
    const result: Array<{ x: number; y: number; data: any }> = []

    for (const item of sorted) {
      const node = this.findNode(this.root, item.w, item.h)
      if (node) {
        const splitNode = this.splitNode(node, item.w, item.h)
        result.push({ x: node.x, y: node.y, data: item.data })
      } else {
        return null // 放不下
      }
    }

    return result
  }

  private findNode(root: any, width: number, height: number): any {
    if (root.used) {
      return this.findNode(root.right, width, height) || this.findNode(root.down, width, height)
    }
    
    if (width <= root.width && height <= root.height) {
      return root
    }
    
    return null
  }

  private splitNode(node: any, width: number, height: number): any {
    node.used = true
    node.down = { x: node.x, y: node.y + height, width: node.width, height: node.height - height }
    node.right = { x: node.x + width, y: node.y, width: node.width - width, height: height }
    return node
  }
}

// ============ 精灵图集构建器 ============

export class SpriteAtlasBuilder {
  private config: Required<SpriteAtlasConfig>
  private items: SpriteItem[] = []

  constructor(config: SpriteAtlasConfig) {
    this.config = {
      maxSize: 2048,
      padding: 2,
      allowRotation: true,
      quality: 0.9,
      mipMaps: false,
      generateMeta: true,
      ...config,
    }
  }

  /**
   * 添加要打包的图片
   */
  addItem(id: string, sourcePath: string, width: number, height: number): void {
    this.items.push({
      id,
      sourcePath,
      width,
      height,
      originalWidth: width,
      originalHeight: height,
      scale: 1,
    })
  }

  /**
   * 批量添加图片
   */
  addItems(items: Array<{ id: string; sourcePath: string; width: number; height: number }>): void {
    items.forEach(item => this.addItem(item.id, item.sourcePath, item.width, item.height))
  }

  /**
   * 执行打包
   */
  async build(): Promise<SpriteAtlasData> {
    if (this.items.length === 0) {
      throw new Error('没有要打包的图片')
    }

    const pad = this.config.padding

    // 计算所需总大小（padding 计入占位，否则尾部的图会越出图集边界）
    const totalArea = this.items.reduce(
      (sum, item) => sum + ((item.width ?? 0) + pad * 2) * ((item.height ?? 0) + pad * 2),
      0,
    )
    // 单张切片也要放得下，因此下界取「面积平方根」与「最大单边」的较大者
    const maxSide = this.items.reduce(
      (max, item) => Math.max(max, (item.width ?? 0) + pad * 2, (item.height ?? 0) + pad * 2),
      0,
    )
    const minSize = Math.max(Math.ceil(Math.sqrt(totalArea)), maxSide)

    const packedItems = this.items.map(item => ({
      w: (item.width ?? 0) + pad * 2,
      h: (item.height ?? 0) + pad * 2,
      data: item,
    }))

    // 矩形打包存在碎片，sqrt(面积) 只是下界：从下界起按 2 的幂逐步放大直到装下
    let atlasSize = Math.min(this.config.maxSize, Math.pow(2, Math.ceil(Math.log2(minSize))))
    let positions: ReturnType<BinPacker['fit']> = null
    while (atlasSize <= this.config.maxSize) {
      positions = new BinPacker(atlasSize, atlasSize).fit(packedItems)
      if (positions) break
      atlasSize *= 2
    }

    if (!positions) {
      throw new Error(
        `精灵图过大，无法打包到 ${this.config.maxSize}x${this.config.maxSize}（共 ${this.items.length} 个切片）`,
      )
    }

    // 分配位置和 UV 坐标
    let usedAreaX = Infinity
    let usedAreaY = Infinity
    let usedAreaWidth = 0
    let usedAreaHeight = 0

    positions.forEach((pos) => {
      const item = pos.data as SpriteItem
      item.x = pos.x + pad
      item.y = pos.y + pad
      
      // 计算边界
      usedAreaX = Math.min(usedAreaX, pos.x)
      usedAreaY = Math.min(usedAreaY, pos.y)
      usedAreaWidth = Math.max(usedAreaWidth, pos.x + (item.width || 0) + pad * 2)
      usedAreaHeight = Math.max(usedAreaHeight, pos.y + (item.height || 0) + pad * 2)

      // 计算 UV 坐标
      item.uv = {
        u0: item.x / atlasSize,
        v0: item.y / atlasSize,
        u1: (item.x + item.width!) / atlasSize,
        v1: (item.y + item.height!) / atlasSize,
      }
    })

    const efficiency = (totalArea / (atlasSize * atlasSize)) * 100

    const atlasData: SpriteAtlasData = {
      atlasFile: `${this.config.outputName}.${this.config.format}`,
      sprites: this.items,
      totalWidth: atlasSize,
      totalHeight: atlasSize,
      usedArea: {
        x: usedAreaX,
        y: usedAreaY,
        width: usedAreaWidth,
        height: usedAreaHeight,
      },
      efficiency,
      generatedAt: Date.now(),
    }

    // 生成元数据对象（不落盘：webview 无 fs，落盘/下载由调用方决定）
    if (this.config.generateMeta) {
      atlasData.metadata = this.buildMetadata(atlasData)
    }

    return atlasData
  }

  /**
   * 把打包结果绘制到画布。
   * @param target 目标画布（尺寸必须 ≥ 图集尺寸）
   * @param resolveImage 由 sourcePath 解析出可绘制源（Image / canvas / ImageBitmap）；返回 null 则跳过该切片
   * @returns 成功绘制的切片数
   */
  async drawTo(
    target: HTMLCanvasElement,
    resolveImage: (
      sourcePath: string,
    ) => Promise<CanvasImageSource | null> | CanvasImageSource | null,
  ): Promise<number> {
    const ctx = target.getContext('2d')
    if (!ctx) throw new Error('无法获取画布 2D 上下文')

    let drawn = 0
    for (const sprite of this.items) {
      if (sprite.x === undefined || sprite.y === undefined) continue
      const image = await resolveImage(sprite.sourcePath)
      if (!image) continue
      ctx.drawImage(
        image,
        sprite.x,
        sprite.y,
        sprite.width ?? sprite.originalWidth ?? 0,
        sprite.height ?? sprite.originalHeight ?? 0,
      )
      drawn++
    }
    return drawn
  }

  /**
   * 序列化图集元数据为 JSON 字符串（供浏览器下载或 Node 落盘）
   */
  serializeMetadata(atlasData: SpriteAtlasData): string {
    return JSON.stringify(atlasData.metadata ?? this.buildMetadata(atlasData), null, 2)
  }

  /**
   * 构建元数据对象
   */
  private buildMetadata(atlasData: SpriteAtlasData): AtlasMetadata {
    return {
      version: '1.0.0',
      image: atlasData.atlasFile,
      format: this.config.format,
      size: {
        width: atlasData.totalWidth,
        height: atlasData.totalHeight,
      },
      sprites: atlasData.sprites.map(s => ({
        name: s.id,
        frame: {
          x: s.x ?? 0,
          y: s.y ?? 0,
          w: s.width ?? s.originalWidth ?? 0,
          h: s.height ?? s.originalHeight ?? 0,
        },
        rotated: !!s.rotation,
        trimmed: false,
        sourceSize: {
          w: s.originalWidth ?? s.width ?? 0,
          h: s.originalHeight ?? s.height ?? 0,
        },
        spriteSourceSize: {
          x: 0,
          y: 0,
          w: s.width ?? s.originalWidth ?? 0,
          h: s.height ?? s.originalHeight ?? 0,
        },
      })),
    }
  }

  /**
   * 清空当前列表
   */
  clear(): void {
    this.items = []
  }
}

// ============ 运行时精灵图集加载器 ============

export class SpriteAtlasLoader {
  private atlases: Map<string, SpriteAtlasData> = new Map()

  /**
   * 注册一个已构建的图集，供运行时按名称查 UV。
   * 本类不做任何磁盘 IO（webview 无 fs），图集数据由调用方提供。
   */
  load(name: string, atlasData: SpriteAtlasData): SpriteAtlasData {
    this.atlases.set(name, atlasData)
    return atlasData
  }

  /**
   * 从导出的图集元数据（atlas.json）回读并注册，使导出的 PNG + JSON 可被运行时加载。
   */
  loadFromMetadata(name: string, meta: AtlasMetadata): SpriteAtlasData {
    const sizeW = meta.size.width || 1
    const sizeH = meta.size.height || 1

    const sprites: SpriteItem[] = meta.sprites.map((s) => ({
      id: s.name,
      sourcePath: `${name}:${s.name}`,
      x: s.frame.x,
      y: s.frame.y,
      width: s.frame.w,
      height: s.frame.h,
      originalWidth: s.sourceSize.w,
      originalHeight: s.sourceSize.h,
      scale: 1,
      rotation: s.rotated ? 90 : undefined,
      uv: {
        u0: s.frame.x / sizeW,
        v0: s.frame.y / sizeH,
        u1: (s.frame.x + s.frame.w) / sizeW,
        v1: (s.frame.y + s.frame.h) / sizeH,
      },
    }))

    const usedAreaW = sprites.reduce((max, s) => Math.max(max, (s.x ?? 0) + (s.width ?? 0)), 0)
    const usedAreaH = sprites.reduce((max, s) => Math.max(max, (s.y ?? 0) + (s.height ?? 0)), 0)
    const usedArea = sprites.reduce((sum, s) => sum + (s.width ?? 0) * (s.height ?? 0), 0)

    const atlasData: SpriteAtlasData = {
      atlasFile: meta.image,
      sprites,
      totalWidth: meta.size.width,
      totalHeight: meta.size.height,
      usedArea: { x: 0, y: 0, width: usedAreaW, height: usedAreaH },
      efficiency: (usedArea / (sizeW * sizeH)) * 100,
      generatedAt: Date.now(),
    }

    return this.load(name, atlasData)
  }

  /**
   * 获取某个精灵的 UV 坐标
   */
  getSpriteUV(atlasId: string, spriteId: string): SpriteItem['uv'] {
    const atlas = this.atlases.get(atlasId)
    if (!atlas) return undefined

    const sprite = atlas.sprites.find(s => s.id === spriteId)
    return sprite?.uv
  }

  /** 已注册的图集名称列表 */
  list(): string[] {
    return Array.from(this.atlases.keys())
  }

  /**
   * 卸载精灵图集
   */
  unload(atlasId: string): void {
    this.atlases.delete(atlasId)
  }
}

// ============ 便捷函数 ============

export function createSpriteAtlas(config: SpriteAtlasConfig): SpriteAtlasBuilder {
  return new SpriteAtlasBuilder(config)
}

export function getSpriteAtlasLoader(): SpriteAtlasLoader {
  return new SpriteAtlasLoader()
}

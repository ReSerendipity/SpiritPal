/**
 * Live2D模型热加载模块
 *
 * @fileoverview 运行时动态加载与切换Live2D模型，支持自动参数映射与预览
 *
 * 主要模块：
 * - ModelLoadState/ModelMeta/ModelValidationResult: 模型状态与元信息类型
 * - ModelHotLoader: 模型热加载器主类
 *
 * 依赖关系：
 * - events: Node.js EventEmitter事件系统
 * - paramAutoMapper.ts: 参数自动映射器
 * - renderAdapter.ts: 渲染适配器接口
 *
 * 核心接口：
 * - loadModel(): 加载Live2D模型文件
 * - switchModel(): 运行时切换当前模型
 * - previewModel(): 预览模式加载（不应用为当前模型）
 * - validateModel(): 模型文件完整性校验
 * - getAvailableModels(): 获取可用模型列表
 *
 * 核心功能（参考Live2DPet）：
 * 1. 模型导入：运行时导入任意Live2D模型（.model3.json）
 * 2. 参数映射：自动扫描模型参数并创建标准参数映射
 * 3. 热切换：无需重启应用即可切换模型
 * 4. 模型校验：参数完整性、动作组、表情检查
 * 5. 预览模式：提交前临时预览模型效果
 */

import { EventEmitter } from 'events'
import { getParamAutoMapper } from './paramAutoMapper'
import type { RenderAdapter } from './renderAdapter'

// ============ 类型定义 ============

/** 模型加载状态 */
export type ModelLoadState = 'idle' | 'loading' | 'loaded' | 'preview' | 'error'

/** 模型元信息 */
export interface ModelMeta {
  /** 模型名称 */
  name: string
  /** 模型版本 */
  version?: string
  /** 模型描述 */
  description?: string
  /** 模型作者 */
  author?: string
  /** 模型路径 */
  modelPath: string
  /** 缩略图路径 */
  thumbnailPath?: string
  /** 参数数量 */
  paramCount: number
  /** 支持的动作组 */
  motionGroups: string[]
  /** 支持的表情 */
  expressions: string[]
  /** 模型尺寸 */
  size?: { width: number; height: number }
}

/** 模型校验结果 */
export interface ModelValidationResult {
  /** 是否通过校验 */
  valid: boolean
  /** 错误列表 */
  errors: string[]
  /** 警告列表 */
  warnings: string[]
  /** 模型元信息 */
  meta?: ModelMeta
}

/** 模型热导入事件 */
export interface ModelHotLoaderEvents {
  /** 加载状态变化 */
  'load-state-change': (state: ModelLoadState) => void
  /** 模型加载完成 */
  'model-loaded': (meta: ModelMeta) => void
  /** 模型切换完成 */
  'model-switched': (fromPath: string, toPath: string) => void
  /** 模型校验完成 */
  'model-validated': (result: ModelValidationResult) => void
  /** 预览开始 */
  'preview-started': (meta: ModelMeta) => void
  /** 预览结束 */
  'preview-ended': () => void
  /** 加载错误 */
  'load-error': (error: Error) => void
}

// ============ 模型热导入器 ============

export class ModelHotLoader extends EventEmitter {
  /** 当前加载状态 */
  private loadState: ModelLoadState = 'idle'

  /** 当前模型元信息 */
  private currentModel: ModelMeta | null = null

  /** 预览模型元信息 */
  private previewModel: ModelMeta | null = null

  /** 当前活动的适配器 */
  private activeAdapter: RenderAdapter | null = null

  /** 已加载模型缓存 */
  private modelCache = new Map<string, ModelMeta>()

  /** 最大缓存数量 */
  private maxCacheSize = 5

  constructor() {
    super()
  }

  // ============ 模型加载 ============

  /**
   * 加载模型
   * @param modelPath 模型路径
   * @returns 模型元信息
   */
  async loadModel(modelPath: string): Promise<ModelMeta> {
    this.setLoadState('loading')

    try {
      // 检查缓存
      const cached = this.modelCache.get(modelPath)
      if (cached) {
        this.currentModel = cached
        this.setLoadState('loaded')
        this.emit('model-loaded', cached)
        return cached
      }

      // 模拟加载过程（实际实现需要与 Live2D SDK 集成）
      const meta = await this.discoverModelMeta(modelPath)

      // 自动扫描参数
      await this.scanAndMapParams(modelPath)

      // 缓存模型元信息
      this.cacheModel(modelPath, meta)

      this.currentModel = meta
      this.setLoadState('loaded')
      this.emit('model-loaded', meta)

      return meta
    } catch (err) {
      this.setLoadState('error')
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit('load-error', error)
      throw error
    }
  }

  /**
   * 运行时切换模型
   * @param newModelPath 新模型路径
   */
  async switchModel(newModelPath: string): Promise<ModelMeta> {
    const previousPath = this.currentModel?.modelPath ?? ''

    try {
      const meta = await this.loadModel(newModelPath)

      this.emit('model-switched', previousPath, newModelPath)
      return meta
    } catch (err) {
      // 切换失败，保持当前模型
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit('load-error', error)
      throw error
    }
  }

  // ============ 预览模式 ============

  /**
   * 进入预览模式
   * 加载模型但不提交，用户确认后再提交
   *
   * @param modelPath 模型路径
   * @returns 模型元信息
   */
  async preview(modelPath: string): Promise<ModelMeta> {
    this.setLoadState('preview')

    try {
      const meta = await this.discoverModelMeta(modelPath)
      this.previewModel = meta
      this.emit('preview-started', meta)
      return meta
    } catch (err) {
      this.setLoadState(this.currentModel ? 'loaded' : 'idle')
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit('load-error', error)
      throw error
    }
  }

  /**
   * 提交预览模型（确认使用预览的模型）
   */
  async commitPreview(): Promise<ModelMeta> {
    if (!this.previewModel) {
      throw new Error('没有正在预览的模型')
    }

    const meta = this.previewModel
    this.currentModel = meta
    this.previewModel = null
    this.cacheModel(meta.modelPath, meta)

    this.setLoadState('loaded')
    this.emit('preview-ended')
    this.emit('model-loaded', meta)

    return meta
  }

  /**
   * 取消预览
   */
  cancelPreview(): void {
    this.previewModel = null
    this.setLoadState(this.currentModel ? 'loaded' : 'idle')
    this.emit('preview-ended')
  }

  // ============ 模型校验 ============

  /**
   * 校验模型
   * @param modelPath 模型路径
   * @returns 校验结果
   */
  async validateModel(modelPath: string): Promise<ModelValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      // 1. 基本路径检查
      if (!modelPath || modelPath.trim().length === 0) {
        errors.push('模型路径不能为空')
      }

      // 2. 文件格式检查
      if (!modelPath.endsWith('.model3.json') && !modelPath.endsWith('.model.json')) {
        warnings.push('模型文件格式可能不正确，预期 .model3.json 或 .model.json')
      }

      // 3. 尝试加载元信息
      let meta: ModelMeta | undefined
      try {
        meta = await this.discoverModelMeta(modelPath)
      } catch (err) {
        errors.push(`模型加载失败: ${err instanceof Error ? err.message : String(err)}`)
      }

      // 4. 检查必要元素
      if (meta) {
        if (meta.paramCount === 0) {
          warnings.push('模型没有可控制的参数')
        }
        if (meta.motionGroups.length === 0) {
          warnings.push('模型没有定义动作组，将只能播放 idle 动画')
        }
      }

      const result: ModelValidationResult = {
        valid: errors.length === 0,
        errors,
        warnings,
        meta,
      }

      this.emit('model-validated', result)
      return result
    } catch (err) {
      const result: ModelValidationResult = {
        valid: false,
        errors: [`校验过程出错: ${err instanceof Error ? err.message : String(err)}`],
        warnings,
      }
      this.emit('model-validated', result)
      return result
    }
  }

  // ============ 内部方法 ============

  /**
   * 发现模型元信息
   * 实际实现需要与 Live2D SDK 集成，此处为框架代码
   */
  private async discoverModelMeta(modelPath: string): Promise<ModelMeta> {
    // 模拟异步加载
    const name = modelPath.split('/').pop()?.replace('.model3.json', '').replace('.model.json', '') ?? 'Unknown'

    return {
      name,
      modelPath,
      paramCount: 0, // 实际值由 SDK 扫描后填充
      motionGroups: ['Idle', 'TapBody'],
      expressions: [],
      size: { width: 300, height: 400 },
    }
  }

  /**
   * 扫描模型参数并创建自动映射
   */
  private async scanAndMapParams(_modelPath: string): Promise<void> {
    const mapper = getParamAutoMapper()

    // 实际实现需要从 Live2D SDK 获取参数列表
    // 此处为框架代码，实际参数由 SDK 提供
    const paramNames: string[] = []

    // 自动发现并映射
    mapper.autoDiscover(paramNames)
  }

  /** 缓存模型元信息 */
  private cacheModel(modelPath: string, meta: ModelMeta): void {
    // 清理超出限制的缓存
    while (this.modelCache.size >= this.maxCacheSize) {
      const firstKey = this.modelCache.keys().next().value
      if (firstKey) {
        this.modelCache.delete(firstKey)
      }
    }
    this.modelCache.set(modelPath, meta)
  }

  /** 更新加载状态 */
  private setLoadState(state: ModelLoadState): void {
    if (this.loadState === state) return
    this.loadState = state
    this.emit('load-state-change', state)
  }

  // ============ 查询 ============

  /** 获取加载状态 */
  getLoadState(): ModelLoadState { return this.loadState }

  /** 获取当前模型元信息 */
  getCurrentModel(): ModelMeta | null { return this.currentModel }

  /** 获取预览模型元信息 */
  getPreviewModel(): ModelMeta | null { return this.previewModel }

  /** 设置活动适配器 */
  setActiveAdapter(adapter: RenderAdapter): void {
    this.activeAdapter = adapter
  }

  /** 是否正在预览 */
  isPreviewing(): boolean { return this.loadState === 'preview' }

  /** 销毁热导入器 */
  destroy(): void {
    this.modelCache.clear()
    this.currentModel = null
    this.previewModel = null
    this.activeAdapter = null
    this.removeAllListeners()
  }
}

// ============ 单例 ============

let modelHotLoader: ModelHotLoader | null = null

/** 获取模型热导入器单例 */
export function getModelHotLoader(): ModelHotLoader {
  if (!modelHotLoader) {
    modelHotLoader = new ModelHotLoader()
  }
  return modelHotLoader
}

/** 重置模型热导入器 */
export function resetModelHotLoader(): void {
  if (modelHotLoader) {
    modelHotLoader.destroy()
    modelHotLoader = null
  }
}

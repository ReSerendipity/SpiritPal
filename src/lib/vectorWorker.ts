/**
 * @file vectorWorker.ts
 * @description 向量嵌入 Web Worker
 *
 * 在 Web Worker 中运行 @xenova/transformers 本地嵌入模型，避免阻塞 UI 线程
 * 模型：BAAI/bge-small-zh-v1.5（512 维向量，中文优化）
 *
 * 核心特性：
 * - 懒加载：首次收到 embed 请求时才加载模型
 * - 浏览器缓存：模型文件缓存到浏览器，避免重复下载
 * - 单/批量嵌入：支持单文本和批量文本嵌入
 *
 * 消息协议：
 *   主线程 → Worker: { id, type: 'embed'|'embedBatch', text?, texts? }
 *   Worker → 主线程: { id, result?, error? }
 *
 * 依赖关系：
 * - @xenova/transformers: Transformers.js 本地推理库
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers'

// 配置：不从本地加载模型文件（从 HuggingFace CDN 下载），使用浏览器缓存
env.allowLocalModels = false
env.useBrowserCache = true

// ============ 模型懒加载 ============

/** 嵌入模型实例（单例） */
let embedder: FeatureExtractionPipeline | null = null
/** 模型加载 Promise（避免并发重复加载） */
let loadPromise: Promise<FeatureExtractionPipeline> | null = null

/** 使用 BAAI/bge-small-zh-v1.5（中文优化，512 维） */
const MODEL_ID = 'BAAI/bge-small-zh-v1.5'
/** 嵌入向量维度 */
const EMBEDDING_DIM = 512

/**
 * 获取或加载嵌入模型（单例模式）
 * @returns 特征提取管道实例
 */
async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder
  if (!loadPromise) {
    loadPromise = pipeline('feature-extraction', MODEL_ID) as Promise<FeatureExtractionPipeline>
  }
  embedder = await loadPromise
  return embedder
}

// ============ 消息处理 ============

/**
 * 消息处理函数
 * 接收主线程的嵌入请求，调用模型生成向量并返回结果
 */
self.onmessage = async (e: MessageEvent) => {
  const { id, type, text, texts } = e.data as {
    id: number
    type: 'embed' | 'embedBatch'
    text?: string
    texts?: string[]
  }

  try {
    const extractor = await getEmbedder()

    if (type === 'embed') {
      // 单文本嵌入：mean pooling + L2 归一化
      const output = await extractor(text!, { pooling: 'mean', normalize: true })
      const embedding = new Float32Array(output.data as Float32Array)
      ;(self as unknown as Worker).postMessage({ id, result: embedding })
    } else if (type === 'embedBatch') {
      // 批量嵌入：一次性处理多条文本，减少通信开销
      const output = await extractor(texts!, { pooling: 'mean', normalize: true })
      const data = output.data as Float32Array
      const count = texts!.length
      const embeddings: Float32Array[] = []
      for (let i = 0; i < count; i++) {
        embeddings.push(new Float32Array(data.buffer, i * EMBEDDING_DIM * 4, EMBEDDING_DIM))
      }
      // 复制每个子数组，避免共享同一 buffer（postMessage 结构化克隆会拷贝，但复制更安全）
      const copied = embeddings.map((e) => new Float32Array(e))
      ;(self as unknown as Worker).postMessage({ id, result: copied })
    }
  } catch (err) {
    // 错误处理：将错误信息传回主线程
    const message = err instanceof Error ? err.message : String(err)
    ;(self as unknown as Worker).postMessage({ id, error: message })
  }
}

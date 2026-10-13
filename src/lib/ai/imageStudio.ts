/**
 * 端侧图像（Qwen-Image-2.1）前端客户端
 *
 * 经 Tauri 命令调**进程内** MNN 引擎（仅 Android；桌面端不注册这些命令，调用会抛
 * `Command not found`）。生成是**分钟级**任务（Snapdragon 8 Gen 2 上 Turbo 6 步约 220s），
 * 故进度经 `ondevice://image_progress` 事件回灌，UI 必须做异步等待 + 进度展示。
 *
 * 设计约束（详见 src-tauri/src/ondevice/image.rs 头注）：
 * - **不可真正取消**：上游 libQwenImage21 的 ProgressListener 无中止通道，
 *   取消只停止「等待」，后台推理仍会跑完当前任务；
 * - **与端侧 LLM 争内存**：DiT 4.5GB + text encoder 5.4GB 与 LLM 约 3.4GB
 *   在 12GB 设备上不可能共存 → 加载图像模型前应先 `ondevice_unload_model` 释放 LLM。
 *
 * @see src-tauri/src/ondevice/image.rs
 * @see docs/agents/ADR-0006-ondevice-image.md
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** 引擎加载选项（缺省即推荐默认：DiT 走 GPU，text encoder 走 CPU，Turbo + tiny VAE）。 */
export interface ImageModelOptions {
  useGpu?: boolean
  textEncoderOnCpu?: boolean
  vaeOnCpu?: boolean
  /** 6 步 Turbo（推荐；关闭则 base 模型 20+ 步，慢约一倍） */
  turbo?: boolean
  /** TAEQI2.1 蒸馏 VAE（默认开；关则用真实 VAE，慢约 200x 解码） */
  tinyVae?: boolean
  threads?: number
  keepModelsLoaded?: boolean
}

/** 生成请求。宽高由 {@link imageSize} 按分档表算好，避免前后端各写一套尺寸算法。 */
export interface ImageGenRequest {
  prompt: string
  width: number
  height: number
  steps: number
  seed: number
  /** 输出 PNG 的绝对路径 */
  outputPng: string
  /** 单参考图编辑（绝对路径）；null/省略 = 文生图 */
  inputImage?: string | null
  /** 第二参考图（实验特性，见 libQwenImage21 的 docs/MULTI_REF.md） */
  inputImage2?: string | null
}

interface ImageGenProgressPayload {
  sessionId: string
  percent: number
}

interface ImageGenDonePayload {
  sessionId: string
  ok: boolean
  error: string
}

/** 模型目录完整性（供 UI 提示"还差哪些文件"）。 */
export interface MissingFilesInfo {
  missing: string
  complete: boolean
}

/** 加载图像模型（分钟级：约 10GB 权重从磁盘映射）。 */
export async function loadImageModel(modelDir: string, options: ImageModelOptions = {}): Promise<void> {
  await invoke('ondevice_image_load', {
    modelDir,
    optionsJson: JSON.stringify(options),
  })
}

/** 释放图像引擎持有的模型内存（与端侧 LLM 争内存时应主动调用）。 */
export async function releaseImageModel(): Promise<void> {
  await invoke('ondevice_image_release')
}

/** 检查模型目录还缺哪些文件（空串 + complete=true 表示可直接生成）。 */
export async function missingImageFiles(modelDir: string): Promise<MissingFilesInfo> {
  return invoke<MissingFilesInfo>('ondevice_image_missing_files', { modelDir })
}

/**
 * 设备与模型目录探测（能力判定的原始依据）。
 * 字段与 Rust `ondevice::image::ImageDeviceInfo` 一一对应（snake_case 透传）。
 */
export interface ImageDeviceInfo {
  ram_gb: number
  opencl: boolean
  model_dir: string
}

export async function probeImageDevice(): Promise<ImageDeviceInfo> {
  return invoke<ImageDeviceInfo>('ondevice_image_probe')
}

/**
 * 生成 / 编辑图像。**阻塞到生成结束**（分钟级）。
 *
 * @param onProgress 进度回调（0–100）
 * @param sessionId 会话 id（用于事件过滤与取消；缺省自动生成）
 */
export async function generateImage(
  request: ImageGenRequest,
  onProgress?: (percent: number) => void,
  sessionId: string = crypto.randomUUID(),
): Promise<void> {
  const progressUnlisten = await listen<ImageGenProgressPayload>('ondevice://image_progress', (e) => {
    if (e.payload.sessionId !== sessionId) return
    onProgress?.(e.payload.percent)
  })
  const doneUnlisten = await listen<ImageGenDonePayload>('ondevice://image_done', (e) => {
    if (e.payload.sessionId !== sessionId) return
    progressUnlisten()
    doneUnlisten()
  })
  try {
    await invoke('ondevice_image_generate', {
      sessionId,
      requestJson: JSON.stringify(request),
    })
  } finally {
    // 兜底：若未收到 done 事件（异常路径），确保取消监听避免泄漏
    progressUnlisten()
    doneUnlisten()
  }
}

/**
 * 请求取消。
 *
 * ⚠️ 上游无中止通道 → 仅停止「等待」与 UI 更新，后台推理仍会跑完当前任务
 * （见 image.rs 头注「关于取消」）。
 */
export async function cancelImage(sessionId: string): Promise<void> {
  await invoke('ondevice_image_cancel', { sessionId })
}

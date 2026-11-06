import { tauriInvoke } from '@/lib/system/tauriInvoker'
/**
 * 上传文件魔数（Magic Number）校验前端助手
 *
 * @fileoverview
 * 对接 Rust 端 Tauri 命令 validate_upload_magic（src-tauri/src/magic_check.rs），
 * 在前端真实文件读取/导入路径上叠加纵深防御：
 * - TS 端已有检查（如类型/签名）之上再校验文件头魔数与声明扩展名一致
 * - 阻断伪装文件（如 .exe 改名 .png）混入
 *
 * 设计约定：
 * - 仅校验 Rust MAGIC_SIGNATURES 已登记扩展名；未知扩展名（如 .json/.svg）跳过，
 *   避免误伤 Rust 端未覆盖的合法格式
 * - invoke 基础设施异常（非 Tauri 环境/命令不可用）时跳过校验，不阻断正常流程；
 *   Rust 端命令本身 fail-closed（任何异常归为校验失败）
 */

/** 与 src-tauri/src/magic_check.rs MAGIC_SIGNATURES 对齐的支持扩展名（小写，含前导点） */
const SUPPORTED_MAGIC_EXTENSIONS: ReadonlySet<string> = new Set([
  // 图片
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.tif',
  '.tiff',
  // 音频
  '.wav',
  '.mp3',
  '.flac',
  '.ogg',
  '.m4a',
  // 视频
  '.mp4',
  '.mov',
  '.webm',
  '.mkv',
  // 压缩包（.petmod 是 zip 格式）
  '.zip',
  '.petmod',
])

/** Rust 端 HEADER_READ_SIZE：魔数比对仅需文件头 12 字节 */
const HEADER_READ_SIZE = 12

/**
 * 从文件名提取小写扩展名（含前导点），如 "cat.PNG" → ".png"
 */
export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  if (idx <= 0) return ''
  return fileName.slice(idx).toLowerCase()
}

/**
 * 校验上传文件魔数与声明扩展名是否匹配（Tauri invoke → Rust validate_upload_magic）
 *
 * @param file 用户选择的文件
 * @returns 校验失败时返回错误提示文案；通过/无法校验（未知扩展名或非 Tauri 环境）返回 null
 */
export async function validateUploadMagic(file: File): Promise<string | null> {
  const ext = getFileExtension(file.name)
  if (!SUPPORTED_MAGIC_EXTENSIONS.has(ext)) {
    // Rust 端未登记该扩展名，无法校验，跳过（避免误伤 .json/.svg 等合法流程）
    return null
  }
  try {
    const header = new Uint8Array(await file.slice(0, HEADER_READ_SIZE).arrayBuffer())
    const ok = await tauriInvoke<boolean>('validate_upload_magic', {
      contents: Array.from(header),
      fileExt: ext,
    })
    if (ok === false) {
      return `文件 "${file.name}" 的扩展名与实际内容不匹配（魔数校验失败），文件可能已被伪装或损坏`
    }
    return null
  } catch {
    // 非 Tauri 环境或命令不可用：跳过校验，不阻断正常流程（Rust 端命令本身 fail-closed）
    return null
  }
}

/** 识别出的媒体类别（与 Rust `FileKind::as_str()` 的标签逐字对齐） */
export type UploadKind = 'image' | 'audio' | 'video' | 'archive'

const KNOWN_KINDS: ReadonlySet<string> = new Set<UploadKind>(['image', 'audio', 'video', 'archive'])

/**
 * 按文件头字节识别真实媒体类别（Tauri invoke → Rust detect_upload_kind）
 *
 * 与 `validateUploadMagic` 同源（同一张魔数表），区别在于**不看扩展名**：聊天上传要处理
 * 拖拽、剪贴板粘贴、移动端相册等「没有可靠扩展名」的来源，先识别类别再决定走图片/音频/
 * 视频分支；扩展名不可信时也不会被伪装后缀带偏。
 *
 * @param file 用户选择的文件
 * @returns 识别出的类别；未命中已登记格式、或非 Tauri 环境时返回 null（调用方自行兜底）
 */
export async function detectUploadKind(file: File): Promise<UploadKind | null> {
  try {
    const header = new Uint8Array(await file.slice(0, HEADER_READ_SIZE).arrayBuffer())
    const kind = await tauriInvoke<string | null>('detect_upload_kind', {
      contents: Array.from(header),
    })
    if (typeof kind === 'string' && KNOWN_KINDS.has(kind)) return kind as UploadKind
    return null
  } catch {
    // 非 Tauri 环境或命令不可用：交由调用方按扩展名/MIME 兜底
    return null
  }
}

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
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff',
  // 音频
  '.wav', '.mp3', '.flac', '.ogg', '.m4a',
  // 视频
  '.mp4', '.mov', '.webm', '.mkv',
  // 压缩包（.petmod 是 zip 格式）
  '.zip', '.petmod',
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
    const { invoke } = await import('@tauri-apps/api/core')
    const ok = await invoke<boolean>('validate_upload_magic', {
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

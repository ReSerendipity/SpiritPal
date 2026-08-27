/**
 * @file ipcErrorCode.ts
 * @description IPC 结构化错误码体系
 *
 * 评估报告 P1-3：所有 Tauri command 返回 Result<T, String>，错误仅为字符串，
 * 前端无法区分错误类型（参数校验失败 vs 系统错误 vs 权限不足）。
 *
 * 本模块定义：
 * 1. IpcErrorType 枚举 — 错误分类
 * 2. IpcError 接口 — 结构化错误（code + message + details?）
 * 3. parseIpcError() — 从 Rust 端返回的字符串解析为结构化错误
 * 4. Rust 端约定：错误字符串格式为 `[IPC_ERROR:TYPE] message`
 *
 * 前端使用：
 * ```ts
 * try {
 *   await tauriInvoke('cmd_pet_hug', { ... })
 * } catch (e) {
 *   const ipcErr = parseIpcError(e)
 *   if (ipcErr.type === IpcErrorType.VALIDATION) {
 *     showToast('参数错误: ' + ipcErr.message)
 *   } else if (ipcErr.type === IpcErrorType.PERMISSION) {
 *     showToast('权限不足')
 *   }
 * }
 * ```
 *
 * Rust 端约定（渐进迁移）：
 * ```rust
 * Err(format!("[IPC_ERROR:VALIDATION] strength out of range: {}", strength))
 * ```
 *
 * @module ipcErrorCode
 */

// ============ 错误类型枚举 ============

export const IpcErrorType = {
  /** 参数校验失败（如 strength 越界、必填字段缺失） */
  VALIDATION: 'VALIDATION',
  /** 权限不足（capability 拒绝、文件 scope 越界） */
  PERMISSION: 'PERMISSION',
  /** 资源不存在（宠物 ID 未找到、文件不存在） */
  NOT_FOUND: 'NOT_FOUND',
  /** 系统错误（IO 失败、DB 锁、加密失败） */
  SYSTEM: 'SYSTEM',
  /** 未捕获错误（未知异常，应记日志排查） */
  UNKNOWN: 'UNKNOWN',
} as const

export type IpcErrorTypeCode = (typeof IpcErrorType)[keyof typeof IpcErrorType]

// ============ 结构化错误接口 ============

export interface IpcError {
  /** 错误类型 */
  type: IpcErrorTypeCode
  /** 人类可读错误消息（已从 Rust 端解析） */
  message: string
  /** 原始错误字符串（用于日志/调试） */
  raw: string
  /** 可选附加详情（如参数名、期望值等） */
  details?: Record<string, unknown>
}

// ============ 解析器 ============

/** 错误码前缀（与 Rust 端约定一致） */
const IPC_ERROR_PREFIX = '[IPC_ERROR:'

/**
 * 从 Tauri invoke 抛出的错误解析为结构化 IpcError。
 *
 * 支持两种格式：
 * 1. 结构化格式：`[IPC_ERROR:VALIDATION] strength out of range: 15`
 *    → { type: 'VALIDATION', message: 'strength out of range: 15' }
 * 2. 纯字符串（旧代码兼容）：`无法加载宠物档案`
 *    → { type: 'UNKNOWN', message: '无法加载宠物档案' }
 *
 * @param error invoke 抛出的错误（string 或 Error 或未知）
 * @returns 结构化 IpcError
 */
export function parseIpcError(error: unknown): IpcError {
  const raw = extractErrorMessage(error)

  // 尝试解析结构化格式 [IPC_ERROR:TYPE] message
  const match = raw.match(/^\[IPC_ERROR:(\w+)\]\s*(.*)$/s)
  if (match) {
    const typeCode = match[1] as string
    const message = match[2] as string

    // 验证类型码是否合法
    const validTypes = Object.values(IpcErrorType) as string[]
    const type = (validTypes.includes(typeCode) ? typeCode : IpcErrorType.UNKNOWN) as IpcErrorTypeCode

    return {
      type,
      message,
      raw,
    }
  }

  // 纯字符串格式 — 尝试根据常见关键词推断类型
  return {
    type: inferTypeFromMessage(raw),
    message: raw,
    raw,
  }
}

// ============ 辅助函数 ============

/**
 * 从 unknown 类型的错误中提取字符串消息
 */
function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return String(error)
}

/**
 * 根据错误消息中的关键词推断错误类型（向后兼容旧错误）
 */
function inferTypeFromMessage(message: string): IpcErrorTypeCode {
  const lower = message.toLowerCase()

  // 权限相关
  if (lower.includes('permission') || lower.includes('denied') || lower.includes('scope') || lower.includes('capability')) {
    return IpcErrorType.PERMISSION
  }

  // 资源不存在
  if (lower.includes('not found') || lower.includes('不存在') || lower.includes('未找到')) {
    return IpcErrorType.NOT_FOUND
  }

  // 参数校验
  if (lower.includes('invalid') || lower.includes('out of range') || lower.includes('missing') || lower.includes('参数') || lower.includes('validation')) {
    return IpcErrorType.VALIDATION
  }

  // 系统错误
  if (lower.includes('io') || lower.includes('database') || lower.includes('db') || lower.includes('encrypt') || lower.includes('系统')) {
    return IpcErrorType.SYSTEM
  }

  return IpcErrorType.UNKNOWN
}

// ============ 便捷判断函数 ============

export function isValidationError(error: unknown): boolean {
  return parseIpcError(error).type === IpcErrorType.VALIDATION
}

export function isPermissionError(error: unknown): boolean {
  return parseIpcError(error).type === IpcErrorType.PERMISSION
}

export function isNotFoundError(error: unknown): boolean {
  return parseIpcError(error).type === IpcErrorType.NOT_FOUND
}

export function isSystemError(error: unknown): boolean {
  return parseIpcError(error).type === IpcErrorType.SYSTEM
}

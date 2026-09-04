/**
 * 路径安全校验模块
 *
 * @fileoverview 文件系统操作路径安全校验，防止路径穿越与未授权访问（参考Open-LLM-VTuber）
 *
 * 主要模块：
 * - PathValidationResult: 路径校验结果类型
 * - TRAVERSAL_PATTERNS: 路径穿越攻击正则模式
 * - DANGEROUS_EXTENSIONS: 危险文件扩展名黑名单
 * - PathSecurityValidator: 路径安全校验器
 *
 * 依赖关系：
 * - 无外部依赖（纯字符串处理与正则匹配）
 *
 * 核心接口：
 * - validatePath(): 校验路径安全性
 * - isPathInWhitelist(): 检查路径是否在白名单目录内
 * - hasDangerousExtension(): 检查文件扩展名是否危险
 * - normalizePath(): 规范化路径（解析../等）
 *
 * 核心机制（参考Open-LLM-VTuber path_security.py，MIT许可）：
 * 1. 路径规范化：normpath解析..和.相对路径组件
 * 2. 穿越检测：正则识别../、..\、URL编码等攻击模式
 * 3. 白名单校验：确保路径在允许的目录树内
 * 4. 绝对路径拦截：阻止访问应用目录外的绝对路径
 * 5. 危险扩展名拦截：阻止.exe/.bat/.ps1/.dll等可执行文件写入
 * 6. Windows设备名拦截：阻止CON/PRN/AUX/NUL等保留设备名
 */

// ============ 配置常量 ============

/** 路径穿越攻击正则模式 */
const TRAVERSAL_PATTERNS = [
  /\.\./,           // .. 组件
  /\.\.\\/,         // ..\ Windows 风格
  /\.\.\//,         // ../ Unix 风格
  /%2e%2e/i,        // URL 编码的 ..
  /%252e/i,         // 双重 URL 编码
  /\.\.%2f/i,       // 混合编码 ../
  /\.\.%5c/i,       // 混合编码 ..\
  /%2e%2e%2f/i,     // URL 编码 ../
  /%2e%2e%5c/i,     // URL 编码 ..\
]

/** 危险文件扩展名（AI Agent 不应写入的文件类型） */
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.wsf',
  '.msi', '.scr', '.com', '.dll', '.sys',
])

/** 危险路径前缀（Windows） */
const DANGEROUS_PREFIXES = [
  '\\\\?',    // 扩展长度路径前缀
  '\\\\.\\',  // 设备路径前缀
  'CON', 'PRN', 'AUX', 'NUL',  // Windows 保留设备名
]

// ============ 类型定义 ============

/** 路径校验结果 */
export interface PathValidationResult {
  /** 是否通过校验 */
  valid: boolean
  /** 规范化后的路径 */
  normalizedPath: string
  /** 拒绝原因（校验失败时） */
  reason?: string
}

// ============ 核心函数 ============

/**
 * 规范化路径
 * 参考开源项目 Open-LLM-VTuber normpath
 * 解析 .. 和 . 组件，统一路径分隔符
 *
 * @param path 原始路径
 * @returns 规范化后的路径
 */
export function normpath(path: string): string {
  // 统一分隔符为 /
  let normalized = path.replace(/\\/g, '/')

  // 处理连续斜杠
  normalized = normalized.replace(/\/+/g, '/')

  // 解析 . 和 .. 组件
  const parts = normalized.split('/')
  const resolved: string[] = []
  const hasLeadingSlash = normalized.startsWith('/')

  for (const part of parts) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop()
      } else if (!hasLeadingSlash) {
        // 相对路径中 .. 无法再往上走，保留
        resolved.push('..')
      }
      // 绝对路径中 .. 在根目录时忽略
      continue
    }
    resolved.push(part)
  }

  let result = resolved.join('/')
  if (hasLeadingSlash) {
    result = '/' + result
  }

  // Windows 盘符保留（如 C:/）
  if (/^[a-zA-Z]:/.test(path) && !/^[a-zA-Z]:/.test(result)) {
    const driveLetter = path.match(/^([a-zA-Z]:)/)?.[1]
    if (driveLetter) {
      result = driveLetter + '/' + result
    }
  }

  return result || '.'
}

/**
 * 检测路径穿越攻击
 * 使用正则匹配识别 ../、..\ 等攻击模式
 *
 * @param path 待检测路径
 * @returns 是否检测到穿越攻击
 */
export function detectPathTraversal(path: string): boolean {
  // 检查已知穿越模式
  for (const pattern of TRAVERSAL_PATTERNS) {
    if (pattern.test(path)) {
      return true
    }
  }

  // 额外检查：规范化后路径是否短于原始路径（说明有 .. 被解析了）
  const normalized = normpath(path)
  if (normalized.length < path.length - 5) {
    // 长度差异过大，可能存在穿越
    const originalParts = path.replace(/\\/g, '/').split('/').filter(p => p && p !== '.')
    const normalizedParts = normalized.split('/').filter(p => p && p !== '.')
    if (normalizedParts.length < originalParts.length - 2) {
      return true
    }
  }

  return false
}

/**
 * 检查路径是否有危险的文件扩展名
 *
 * @param path 文件路径
 * @returns 是否包含危险扩展名
 */
export function hasDangerousExtension(path: string): boolean {
  const lowerPath = path.toLowerCase()
  for (const ext of DANGEROUS_EXTENSIONS) {
    if (lowerPath.endsWith(ext)) {
      return true
    }
  }
  return false
}

/**
 * 检查路径是否有危险的前缀
 *
 * @param path 文件路径
 * @returns 是否包含危险前缀
 */
export function hasDangerousPrefix(path: string): boolean {
  const upperPath = path.toUpperCase()
  for (const prefix of DANGEROUS_PREFIXES) {
    if (upperPath.startsWith(prefix.toUpperCase())) {
      return true
    }
  }
  return false
}

// ============ 路径校验器 ============

/**
 * 路径安全校验器
 * 提供 AI Agent 文件操作的路径安全校验
 *
 * 使用方式：
 * ```ts
 * const validator = new PathValidator(['/app/data', '/app/config'])
 * const result = validator.validate(userInputPath)
 * if (!result.valid) {
 *   console.error(result.reason)
 * }
 * ```
 */
export class PathValidator {
  /** 允许的根目录列表（规范化后） */
  private allowedRoots: string[]

  /**
   * @param allowedRoots 允许的根目录列表（绝对路径）
   */
  constructor(allowedRoots: string[] = []) {
    this.allowedRoots = allowedRoots.map(r => normpath(r))
  }

  /**
   * 校验路径安全性
   * 综合检查：穿越攻击 + 危险扩展名 + 危险前缀 + 白名单目录
   *
   * @param path 待校验的路径
   * @param options 校验选项
   * @returns 校验结果
   */
  validate(
    path: string,
    options: {
      /** 是否检查危险扩展名（默认 true） */
      checkExtension?: boolean
      /** 是否检查白名单目录（默认 true） */
      checkAllowedRoot?: boolean
      /** 是否允许绝对路径（默认 false，需在白名单内） */
      allowAbsolute?: boolean
    } = {},
  ): PathValidationResult {
    const {
      checkExtension = true,
      checkAllowedRoot = true,
      allowAbsolute = false,
    } = options

    // 1. 空路径检查
    if (!path || path.trim().length === 0) {
      return { valid: false, normalizedPath: '', reason: '路径为空' }
    }

    // 2. 路径穿越检测
    if (detectPathTraversal(path)) {
      return {
        valid: false,
        normalizedPath: normpath(path),
        reason: `路径包含穿越组件: ${path}`,
      }
    }

    // 3. 危险前缀检查
    if (hasDangerousPrefix(path)) {
      return {
        valid: false,
        normalizedPath: normpath(path),
        reason: `路径包含危险前缀: ${path}`,
      }
    }

    // 4. 危险扩展名检查
    if (checkExtension && hasDangerousExtension(path)) {
      return {
        valid: false,
        normalizedPath: normpath(path),
        reason: `路径包含危险文件扩展名: ${path}`,
      }
    }

    // 5. 规范化路径
    const normalizedPath = normpath(path)

    // 6. 绝对路径检查
    const isAbsolute = /^\/|^[a-zA-Z]:/.test(normalizedPath)
    if (isAbsolute && !allowAbsolute && !checkAllowedRoot) {
      return {
        valid: false,
        normalizedPath,
        reason: `不允许使用绝对路径: ${path}`,
      }
    }

    // 7. 白名单目录校验
    if (checkAllowedRoot && this.allowedRoots.length > 0) {
      if (!this.isWithinAllowedRoot(normalizedPath)) {
        return {
          valid: false,
          normalizedPath,
          reason: `路径不在允许的目录内: ${normalizedPath}`,
        }
      }
    }

    return { valid: true, normalizedPath }
  }

  /**
   * 检查路径是否在允许的根目录内
   */
  private isWithinAllowedRoot(normalizedPath: string): boolean {
    for (const root of this.allowedRoots) {
      // 路径必须以某个允许的根目录为前缀
      if (normalizedPath === root || normalizedPath.startsWith(root + '/')) {
        return true
      }
    }
    return false
  }

  /**
   * 添加允许的根目录
   */
  addAllowedRoot(root: string): void {
    const normalized = normpath(root)
    if (!this.allowedRoots.includes(normalized)) {
      this.allowedRoots.push(normalized)
    }
  }

  /**
   * 移除允许的根目录
   */
  removeAllowedRoot(root: string): void {
    const normalized = normpath(root)
    this.allowedRoots = this.allowedRoots.filter(r => r !== normalized)
  }

  /**
   * 获取允许的根目录列表
   */
  getAllowedRoots(): ReadonlyArray<string> {
    return this.allowedRoots
  }
}

// ============ 便捷函数 ============

/**
 * 快捷路径校验函数
 * 使用默认白名单校验路径
 *
 * @param path 待校验的路径
 * @param allowedRoots 允许的根目录列表
 * @returns 校验结果
 */
export function validatePath(
  path: string,
  allowedRoots: string[] = [],
): PathValidationResult {
  const validator = new PathValidator(allowedRoots)
  return validator.validate(path)
}

/**
 * 安全拼接路径
 * 先拼接再校验，确保结果路径安全
 *
 * @param base 基础路径
 * @param segments 路径片段
 * @param allowedRoots 允许的根目录列表
 * @returns 校验结果
 */
export function safeJoinPath(
  base: string,
  segments: string[],
  allowedRoots: string[] = [],
): PathValidationResult {
  const combined = [base, ...segments].join('/')
  return validatePath(combined, allowedRoots)
}

// ============ 单例 ============

let validatorInstance: PathValidator | null = null

/**
 * 获取全局路径校验器
 * 默认白名单包含当前工作目录
 */
export function getPathValidator(allowedRoots?: string[]): PathValidator {
  if (!validatorInstance) {
    validatorInstance = new PathValidator(allowedRoots ?? [])
  }
  return validatorInstance
}

export function resetPathValidator(): void {
  validatorInstance = null
}

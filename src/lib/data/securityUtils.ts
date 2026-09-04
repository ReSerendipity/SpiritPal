/**
 * @file securityUtils.ts
 * @description 路径安全校验模块 — normpath + 正则遍历检测
 *
 * 主要功能：
 * 1. normalizePath: 规范化路径，解析 .. 和 . 组件
 * 2. detectPathTraversal: 正则检测路径遍历尝试
 * 3. validatePath: 校验路径是否在允许的基目录内
 * 4. sanitizePath: 清理路径中的危险字符
 * 5. securePath: 组合校验（完整安全校验流程）
 * 6. validatePetmodPath: .petmod 包路径校验
 *
 * 主要模块：
 * - Result<T>: 简易 Result 类型（类似 Rust）
 * - normalizePath(): 路径规范化函数
 * - detectPathTraversal(): 路径遍历检测
 * - validatePath(): 路径范围校验
 *
 * 依赖关系：无外部依赖（纯字符串处理）
 *
 * 核心接口：
 * - normalizePath(): 规范化路径
 * - detectPathTraversal(): 检测遍历攻击
 * - validatePath(): 校验路径范围
 * - securePath(): 完整安全校验
 * - validatePetmodPath(): .petmod 包专用校验
 *
 * Phase 2.5: 防止路径遍历攻击，确保文件操作安全
 * 参考仓库：Open-LLM-VTuber（MIT 许可）
 */

// ============ 常量 ============

/** 路径遍历检测正则 */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\./,              // .. 父目录引用
  /\.\.[\\/]/,         // ../ 或 ..\ 
  /[\\/]\.\.[\\/]/,   // /../ 或 \..\
  /[\\/]\.\.$/,        // /.. 或 \.. 结尾
  /\0/,                // 空字节注入
  /[<>:"|?*]/,         // Windows 非法字符（非路径组件）
]

/** URL 编码的路径遍历模式 */
const ENCODED_TRAVERSAL_PATTERNS = [
  /%2e%2e/i,           // URL 编码的 ..
  /%252e/i,            // 双重 URL 编码
  /\.\.%2f/i,          // 混合编码 ../
  /%2e%2e%2f/i,        // URL 编码 ../
  /%2e%2e\//i,          // 混合编码
]

// ============ Result 类型 ============

/**
 * 简易 Result 类型
 * 
 * 成功时 { ok: true, value: T }
 * 失败时 { ok: false, error: string }
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

/** 创建成功 Result */
function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

/** 创建失败 Result */
function err<T>(error: string): Result<T> {
  return { ok: false, error }
}

// ============ normalizePath ============

/**
 * 规范化路径
 * 
 * 解析 . 和 .. 组件，统一路径分隔符
 * 类似 Python 的 os.path.normpath
 * 
 * 注意：此函数不访问文件系统，仅做字符串处理
 * 符号链接等需要文件系统支持的场景不在处理范围内
 * 
 * @param inputPath 输入路径
 * @returns 规范化后的路径
 * 
 * @example
 * ```ts
 * normalizePath('a/b/../c')    // => 'a/c'
 * normalizePath('a/./b')       // => 'a/b'
 * normalizePath('a/b/../../c') // => 'c'
 * normalizePath('../a')        // => '../a'（无法再向上解析）
 * ```
 */
export function normalizePath(inputPath: string): string {
  if (!inputPath) return ''

  // 统一分隔符为 /
  const path = inputPath.replace(/\\/g, '/')

  // 检测绝对路径
  const isAbsolute = path.startsWith('/')

  // 检测尾部斜杠
  const hasTrailingSlash = path.endsWith('/') && path.length > 1

  // 分割路径组件
  const parts = path.split('/').filter(p => p !== '')

  // 解析 . 和 ..
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '.') {
      // 当前目录，跳过
      continue
    } else if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        // 回退一级
        resolved.pop()
      } else if (!isAbsolute) {
        // 相对路径中无法回退，保留 ..
        resolved.push('..')
      }
      // 绝对路径中 .. 在根目录无效，直接忽略
    } else {
      resolved.push(part)
    }
  }

  // 重新拼接
  let result = resolved.join('/')
  if (isAbsolute) {
    result = '/' + result
  }
  if (hasTrailingSlash && result.length > 1 && !result.endsWith('/')) {
    result += '/'
  }

  return result || '.'
}

// ============ detectPathTraversal ============

/**
 * 检测路径遍历尝试
 * 
 * 使用正则匹配常见路径遍历模式：
 * - .. 父目录引用
 * - URL 编码的遍历（%2e%2e 等）
 * - 空字节注入
 * - Windows 非法字符
 * 
 * @param inputPath 输入路径
 * @returns true 表示检测到路径遍历尝试
 * 
 * @example
 * ```ts
 * detectPathTraversal('../../../etc/passwd')  // => true
 * detectPathTraversal('data/normal/file.txt') // => false
 * detectPathTraversal('%2e%2e/etc/passwd')    // => true
 * ```
 */
export function detectPathTraversal(inputPath: string): boolean {
  if (!inputPath) return false

  // 检查直接遍历模式
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(inputPath)) return true
  }

  // 检查 URL 编码遍历模式
  for (const pattern of ENCODED_TRAVERSAL_PATTERNS) {
    if (pattern.test(inputPath)) return true
  }

  // 检查规范化后的路径是否仍包含 ..
  // 这可以捕获一些变形绕过（如 ....//）
  const normalized = normalizePath(inputPath)
  if (normalized.includes('..')) return true

  return false
}

// ============ validatePath ============

/**
 * 校验路径是否在允许的基目录内
 * 
 * 将路径规范化后检查是否以 allowedBase 为前缀
 * 防止路径遍历逃逸出允许范围
 * 
 * @param inputPath 输入路径（可以是绝对或相对路径）
 * @param allowedBase 允许的基目录（绝对路径）
 * @returns Result<string> 成功时包含规范化后的绝对路径，失败时包含错误信息
 * 
 * @example
 * ```ts
 * // 允许访问 /app/data 目录
 * validatePath('/app/data/config.json', '/app/data')  // => ok
 * validatePath('/app/data/../etc/passwd', '/app/data') // => err
 * validatePath('../../../etc/passwd', '/app/data')     // => err
 * ```
 */
export function validatePath(inputPath: string, allowedBase: string): Result<string> {
  if (!inputPath) return err('路径不能为空')
  if (!allowedBase) return err('基目录不能为空')

  // 检测路径遍历
  if (detectPathTraversal(inputPath)) {
    return err(`路径包含遍历尝试: ${inputPath}`)
  }

  // 规范化路径
  const normalizedBase = normalizePath(allowedBase)
  let normalizedInput: string

  // 构建绝对路径
  if (inputPath.startsWith('/') || inputPath.match(/^[A-Za-z]:\\/)) {
    // 已经是绝对路径
    normalizedInput = normalizePath(inputPath)
  } else {
    // 相对路径，基于 allowedBase 解析
    normalizedInput = normalizePath(`${normalizedBase}/${inputPath}`)
  }

  // 检查是否在允许范围内
  // 确保规范化后的路径以基目录为前缀
  if (!normalizedInput.startsWith(normalizedBase + '/') && normalizedInput !== normalizedBase) {
    return err(`路径 "${normalizedInput}" 逃逸出允许范围 "${normalizedBase}"`)
  }

  return ok(normalizedInput)
}

// ============ sanitizePath ============

/**
 * 清理路径中的危险字符
 * 
 * 移除或替换可能导致安全问题的字符：
 * - 空字节（\0）
 * - Windows 保留字符
 * - 连续斜杠
 * - 前导/尾随空白
 * 
 * @param inputPath 输入路径
 * @returns 清理后的路径
 */
export function sanitizePath(inputPath: string): string {
  if (!inputPath) return ''

  return inputPath
    // 移除空字节
    .replace(/\0/g, '')
    // 移除 Windows 非法字符（保留路径分隔符和常见字符）
    .replace(/[<>:"|?*]/g, '')
    // 合并连续斜杠
    .replace(/\/+/g, '/')
    .replace(/\\+/g, '\\')
    // 去除首尾空白
    .trim()
}

// ============ 组合校验 ============

/**
 * 完整的路径安全校验
 * 
 * 组合 sanitize → detectTraversal → normalize → validate
 * 
 * @param inputPath 输入路径
 * @param allowedBase 允许的基目录
 * @returns Result<string> 安全的绝对路径或错误信息
 */
export function securePath(inputPath: string, allowedBase: string): Result<string> {
  // 1. 清理
  const sanitized = sanitizePath(inputPath)
  if (!sanitized) {
    return err('清理后路径为空')
  }

  // 2. 遍历检测
  if (detectPathTraversal(sanitized)) {
    return err(`路径包含遍历尝试: ${sanitized}`)
  }

  // 3. 规范化 + 范围校验
  return validatePath(sanitized, allowedBase)
}

// ============ .petmod 包路径校验 ============

/**
 * 校验 .petmod 包内文件路径
 * 
 * .petmod 是 zip 格式的宠物模组包
 * 解压时需确保文件不会逃逸到包目录之外
 * 
 * 特别防护：
 * - Zip Slip 攻击（压缩包内文件名包含 ../）
 * - 符号链接攻击（此处仅做字符串检查）
 * 
 * @param entryPath zip 条目路径（相对于包根目录）
 * @param allowedBase 解压目标基目录
 * @returns Result<string> 安全的绝对路径或错误信息
 */
export function validatePetmodPath(entryPath: string, allowedBase: string): Result<string> {
  // .petmod 条目路径不应以 / 开头（相对路径）
  if (entryPath.startsWith('/') || entryPath.match(/^[A-Za-z]:\\/)) {
    return err(`.petmod 条目路径不能为绝对路径: ${entryPath}`)
  }

  // 检测遍历
  if (detectPathTraversal(entryPath)) {
    return err(`.petmod 条目包含路径遍历: ${entryPath}`)
  }

  // 规范化并校验
  return validatePath(entryPath, allowedBase)
}

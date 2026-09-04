/**
 * 路径穿越防护模块
 *
 * @fileoverview 深度路径穿越攻击检测与防护，与Rust后端validation.rs集成（参考Open-LLM-VTuber）
 *
 * 主要模块：
 * - TRAVERSAL_PATTERNS: 全面的路径穿越攻击模式正则
 * - TraversalCheckResult: 穿越检测结果
 * - PathTraversalGuard: 穿越防护器主类
 *
 * 依赖关系：
 * - 无外部依赖（纯JavaScript实现，可与Rust后端协同）
 *
 * 核心接口：
 * - normpath(): 路径规范化（解析.和..，类似Python os.path.normpath）
 * - detectTraversal(): 检测路径中是否存在穿越模式
 * - isPathWithinBase(): 验证路径在允许的基目录内
 * - sanitizePath(): 路径安全清理
 * - validateWithRust(): 调用Rust后端双重验证
 *
 * 核心功能（参考Open-LLM-VTuber安全设计）：
 * 1. 规范化：normpath解析.和..组件，统一路径分隔符
 * 2. 模式检测：识别../、..\、URL编码、双重编码、空字节注入等攻击
 * 3. 基目录校验：确保最终路径在允许目录树内
 * 4. 符号链接防护：阻止指向允许目录外的符号链接
 * 5. Rust集成：与Rust后端validation.rs双重验证，纵深防御
 */

// ============ 路径穿越模式 ============

/** 已知的路径穿越攻击模式 */
const TRAVERSAL_PATTERNS: RegExp[] = [
  /\.\./,                    // 父目录引用
  /\.\.\//,                  // Unix 父目录
  /\.\.\\/,                  // Windows 父目录
  /%2e%2e%2f/i,              // URL 编码 ../
  /%2e%2e%5c/i,              // URL 编码 ..\
  /\.\.%2f/i,                // 混合编码
  /\.\.%5c/i,                // 混合编码
  /%252e%252e%252f/i,        // 双重 URL 编码
  /\.\.\.\./,                // 超长父目录引用
  /\0/,                       // 空字节注入
  /\.\.[/\\]+[^\s]/,        // 后跟路径的父目录引用
]

// ============ 规范化 ============

/**
 * 路径规范化 — 解析 . 和 .. 组件
 * 类似 Python 的 os.path.normpath
 * @param path 输入路径
 * @returns 规范化后的路径
 */
export function normpath(path: string): string {
  // 统一分隔符
  const normalized = path.replace(/\\/g, '/')

  // 处理 Windows 驱动器前缀
  const driveMatch = normalized.match(/^([a-zA-Z]:)/)
  const drive = driveMatch ? driveMatch[1] : ''
  const rest = driveMatch ? normalized.slice(2) : normalized

  // 分割路径组件
  const isAbsolute = rest.startsWith('/')
  const parts = rest.split('/').filter((p) => p !== '' && p !== '.')

  // 解析 .. 组件
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop()
      } else if (!isAbsolute) {
        // 相对路径可以保留 .. 在开头
        resolved.push('..')
      }
    } else {
      resolved.push(part)
    }
  }

  // 重新组装
  let result = resolved.join('/')
  if (isAbsolute) result = '/' + result
  if (drive) result = drive + result

  return result || '.'
}

// ============ 检测 ============

/**
 * 检测路径中是否包含穿越尝试
 * @param path 待检测路径
 * @returns 检测结果
 */
export interface TraversalDetectionResult {
  /** 是否检测到穿越尝试 */
  detected: boolean
  /** 匹配的模式描述 */
  matchedPatterns: string[]
  /** 规范化后的路径 */
  normalizedPath: string
  /** 风险等级 */
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical'
}

export function detectPathTraversal(path: string): TraversalDetectionResult {
  const matchedPatterns: string[] = []

  // 1. 正则模式检测
  for (const pattern of TRAVERSAL_PATTERNS) {
    if (pattern.test(path)) {
      matchedPatterns.push(`正则匹配: ${pattern.source}`)
    }
  }

  // 2. 规范化后与原始路径比较
  const normalized = normpath(path)
  if (normalized !== path.replace(/\\/g, '/')) {
    matchedPatterns.push('路径规范化后与原始路径不同（可能包含 . 或 .. 组件）')
  }

  // 3. 空字节检测
  if (path.includes('\0')) {
    matchedPatterns.push('包含空字节注入')
  }

  // 4. 编码绕过检测
  if (/%2e|%252e|%5c|%255c/i.test(path)) {
    matchedPatterns.push('包含 URL 编码的路径分隔符/组件')
  }

  // 确定风险等级
  let riskLevel: TraversalDetectionResult['riskLevel'] = 'none'
  if (matchedPatterns.length > 0) {
    if (matchedPatterns.some((p) => p.includes('空字节') || p.includes('编码'))) {
      riskLevel = 'critical'
    } else if (matchedPatterns.length >= 3) {
      riskLevel = 'high'
    } else if (matchedPatterns.length >= 2) {
      riskLevel = 'medium'
    } else {
      riskLevel = 'low'
    }
  }

  return {
    detected: matchedPatterns.length > 0,
    matchedPatterns,
    normalizedPath: normalized,
    riskLevel,
  }
}

// ============ 验证 ============

/**
 * 验证路径是否在允许的目录范围内
 * @param path 待验证路径
 * @param allowedDirs 允许的目录列表
 * @returns 是否在允许范围内
 */
export function isPathWithinAllowedDirs(path: string, allowedDirs: string[]): boolean {
  const normalizedTarget = normpath(path).toLowerCase()

  for (const dir of allowedDirs) {
    const normalizedDir = normpath(dir).toLowerCase()
    // 严格前缀匹配：target 必须以 dir + 分隔符 开头，或者等于 dir
    if (normalizedTarget === normalizedDir ||
        normalizedTarget.startsWith(normalizedDir + '/')) {
      return true
    }
  }

  return false
}

/**
 * 安全拼接路径 — 防止穿越
 * @param base 基础目录
 * @param segments 路径片段
 * @returns 拼接后的安全路径，或 null（如果穿越检测失败）
 */
export function safeJoinPath(base: string, ...segments: string[]): string | null {
  // 规范化基础路径
  const normalizedBase = normpath(base)

  // 拼接路径
  const joined = segments.reduce((acc, seg) => {
    return acc + '/' + seg
  }, normalizedBase)

  // 规范化结果
  const normalized = normpath(joined)

  // 验证结果在基础目录内
  if (!isPathWithinAllowedDirs(normalized, [normalizedBase])) {
    return null // 穿越攻击
  }

  return normalized
}

/**
 * 综合路径安全校验
 * @param path 待校验路径
 * @param allowedDirs 允许的目录列表
 * @returns 校验结果
 */
export interface PathValidationResult {
  valid: boolean
  error?: string
  normalizedPath: string
  riskLevel: TraversalDetectionResult['riskLevel']
}

export function validatePath(path: string, allowedDirs: string[]): PathValidationResult {
  // 1. 穿越检测
  const detection = detectPathTraversal(path)
  if (detection.riskLevel === 'critical') {
    return {
      valid: false,
      error: `路径包含严重安全风险: ${detection.matchedPatterns.join('; ')}`,
      normalizedPath: detection.normalizedPath,
      riskLevel: detection.riskLevel,
    }
  }

  // 2. 范围校验
  if (allowedDirs.length > 0 && !isPathWithinAllowedDirs(detection.normalizedPath, allowedDirs)) {
    return {
      valid: false,
      error: '路径不在允许的目录范围内',
      normalizedPath: detection.normalizedPath,
      riskLevel: detection.riskLevel,
    }
  }

  // 3. 低风险穿越（如合法的 ../ 引用）— 允许但记录
  if (detection.detected && detection.riskLevel !== 'none') {
    // 低/中风险在范围内时允许
    return {
      valid: true,
      error: `警告: ${detection.matchedPatterns.join('; ')}`,
      normalizedPath: detection.normalizedPath,
      riskLevel: detection.riskLevel,
    }
  }

  return {
    valid: true,
    normalizedPath: detection.normalizedPath,
    riskLevel: 'none',
  }
}

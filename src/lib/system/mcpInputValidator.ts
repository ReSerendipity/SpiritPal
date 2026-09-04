/**
 * MCP 输入安全校验模块
 *
 * @fileoverview 5层输入校验防止AI代理通过MCP工具泄露代码/密钥/敏感信息
 *
 * 主要模块：
 * - ValidationResult: 校验结果接口
 * - TextValidationOptions: 校验选项
 * - validateMcpInput: 主校验函数（5层校验）
 * - 工具函数: createBubbleMessageSchema, createValidatedIdSchema 等 Zod Schema 工厂
 *
 * 依赖关系：
 * - zod: Schema 验证库
 *
 * 核心接口：
 * - validateMcpInput(): 执行5层安全校验
 *
 * 5层校验机制：
 * 1. 长度限制: 文本≤2000字符，ID≤100字符
 * 2. 单行检查: 单行字段不含换行符
 * 3. 代码特征检测: 拒绝 function/class/import/require 等关键字
 * 4. URL检测: 拒绝URL防止钓鱼
 * 5. 密钥检测: 拒绝 API key/token/password/sk- 等模式
 *
 * 参考：OpenPets packages/mcp/src/tools.ts
 */

import { z } from 'zod'

// ============ 校验结果 ============

/** 校验结果 */
export interface ValidationResult {
  /** 是否通过校验 */
  valid: boolean
  /** 错误消息（校验失败时） */
  error?: string
  /** 触发失败的层级（1-5） */
  failedLayer?: number
}

// ============ 第 1 层：长度限制 ============

/** 文本字段最大长度 */
export const MAX_TEXT_LENGTH = 2000

/** ID 字段最大长度 */
export const MAX_ID_LENGTH = 100

/**
 * 第 1 层校验：长度限制
 * @param value 待校验值
 * @param maxLength 最大长度
 * @param fieldName 字段名（用于错误消息）
 */
function validateLength(value: string, maxLength: number, fieldName: string): ValidationResult {
  if (value.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} 长度超限：${value.length} > ${maxLength}`,
      failedLayer: 1,
    }
  }
  return { valid: true }
}

// ============ 第 2 层：单行检查 ============

/**
 * 第 2 层校验：单行字段不含换行符
 * @param value 待校验值
 * @param fieldName 字段名
 */
function validateSingleLine(value: string, fieldName: string): ValidationResult {
  if (value.includes('\n') || value.includes('\r')) {
    return {
      valid: false,
      error: `${fieldName} 包含换行符，单行字段不允许换行`,
      failedLayer: 2,
    }
  }
  return { valid: true }
}

// ============ 第 3 层：代码特征检测 ============

/** 代码关键字模式 */
const CODE_KEYWORDS = /\b(function|class|import|export|const |let |var |def |return |from |require\(|module\.|interface |type |enum |async |await |try|catch|throw|new )\b/i

/** 代码结构模式 — 括号配对 + 分号 */
const CODE_STRUCTURE = /[{];[^}]*[}]|[()]\s*;|=>\s*[{]|\\u[0-9a-fA-F]{4}/

/** 代码注释模式 */
const CODE_COMMENT = /\/\/.*$|\/\*[\s\S]*?\*\/|#\s*(include|define|ifdef|ifndef|pragma)\b/

/**
 * 第 3 层校验：代码特征检测
 * 拒绝包含代码片段的输入，防止 AI 代理将代码内容输出到气泡
 * @param value 待校验值
 */
function validateCodeCharacteristics(value: string): ValidationResult {
  if (CODE_KEYWORDS.test(value)) {
    return {
      valid: false,
      error: '输入包含代码关键字，不允许在宠物气泡中显示代码',
      failedLayer: 3,
    }
  }
  if (CODE_STRUCTURE.test(value)) {
    return {
      valid: false,
      error: '输入包含代码结构特征（花括号/分号/箭头函数），不允许在宠物气泡中显示代码',
      failedLayer: 3,
    }
  }
  if (CODE_COMMENT.test(value)) {
    return {
      valid: false,
      error: '输入包含代码注释，不允许在宠物气泡中显示代码',
      failedLayer: 3,
    }
  }
  return { valid: true }
}

// ============ 第 4 层：URL 检测 ============

/** URL 模式 — 匹配 http/https/ftp 协议 URL */
const URL_PATTERN = /https?:\/\/[^\s]+|ftp:\/\/[^\s]+|www\.[^\s]+\.[a-z]{2,}/i

/** 文件路径模式 — 匹配 /path/to/resource 形式的路径 */
const FILE_PATH_PATTERN = /(?:^|[\s(])(?:\/[a-zA-Z0-9_-]+){2,}|(?:^|[\s(])[A-Z]:\\[^\s]+/i

/**
 * 第 4 层校验：URL / 路径检测
 * 拒绝包含 URL 或文件路径的输入，防止钓鱼链接
 * @param value 待校验值
 */
function validateUrlDetection(value: string): ValidationResult {
  if (URL_PATTERN.test(value)) {
    return {
      valid: false,
      error: '输入包含 URL，不允许在宠物气泡中显示链接',
      failedLayer: 4,
    }
  }
  if (FILE_PATH_PATTERN.test(value)) {
    return {
      valid: false,
      error: '输入包含文件路径，不允许在宠物气泡中显示路径',
      failedLayer: 4,
    }
  }
  return { valid: true }
}

// ============ 第 5 层：密钥/令牌检测 ============

/** API Key 模式 — 匹配常见的 key/value 对格式 */
const SECRET_KEY_VALUE = /(?:api[_-]?key|secret|token|password|credential|auth|access[_-]?key|private[_-]?key)["'\s]*[:=]["'\s]*[\w./+-]{8,}/i

/** 独立密钥模式 — 匹配常见格式的密钥字符串 */
const SECRET_STANDALONE = /(?:sk-|pk-|ghp_|gho_|github_pat_|AKIA|AIza|eyJ)[a-zA-Z0-9_.-]{10,}/

/** Bearer Token 模式 */
const BEARER_TOKEN = /Bearer\s+[a-zA-Z0-9_.-]+/i

/**
 * 第 5 层校验：密钥/令牌检测
 * 拒绝包含 API Key/Token/密码等敏感信息的输入
 * @param value 待校验值
 */
function validateSecretDetection(value: string): ValidationResult {
  if (SECRET_KEY_VALUE.test(value)) {
    return {
      valid: false,
      error: '输入可能包含敏感凭证（API Key / 密码），不允许在宠物气泡中显示',
      failedLayer: 5,
    }
  }
  if (SECRET_STANDALONE.test(value)) {
    return {
      valid: false,
      error: '输入可能包含密钥或令牌，不允许在宠物气泡中显示',
      failedLayer: 5,
    }
  }
  if (BEARER_TOKEN.test(value)) {
    return {
      valid: false,
      error: '输入包含 Bearer Token，不允许在宠物气泡中显示',
      failedLayer: 5,
    }
  }
  return { valid: true }
}

// ============ 统一校验入口 ============

/** 文本字段校验选项 */
export interface TextValidationOptions {
  /** 最大长度（默认 2000） */
  maxLength?: number
  /** 是否为单行字段（默认 true） */
  singleLine?: boolean
  /** 是否检测代码特征（默认 true） */
  detectCode?: boolean
  /** 是否检测 URL（默认 true） */
  detectUrl?: boolean
  /** 是否检测密钥（默认 true） */
  detectSecret?: boolean
  /** 字段名（用于错误消息，默认 "文本"） */
  fieldName?: string
}

/**
 * 5 层统一校验入口
 * 按顺序执行所有启用的校验层级，任一层级失败即停止
 *
 * @param value 待校验的文本
 * @param options 校验选项
 * @returns 校验结果
 */
export function validateMcpInput(
  value: string,
  options: TextValidationOptions = {},
): ValidationResult {
  const {
    maxLength = MAX_TEXT_LENGTH,
    singleLine = true,
    detectCode = true,
    detectUrl = true,
    detectSecret = true,
    fieldName = '文本',
  } = options

  // 第 1 层：长度限制
  const layer1 = validateLength(value, maxLength, fieldName)
  if (!layer1.valid) return layer1

  // 第 2 层：单行检查
  if (singleLine) {
    const layer2 = validateSingleLine(value, fieldName)
    if (!layer2.valid) return layer2
  }

  // 第 3 层：代码特征检测
  if (detectCode) {
    const layer3 = validateCodeCharacteristics(value)
    if (!layer3.valid) return layer3
  }

  // 第 4 层：URL 检测
  if (detectUrl) {
    const layer4 = validateUrlDetection(value)
    if (!layer4.valid) return layer4
  }

  // 第 5 层：密钥检测
  if (detectSecret) {
    const layer5 = validateSecretDetection(value)
    if (!layer5.valid) return layer5
  }

  return { valid: true }
}

// ============ Zod Schema 工厂 ============

/**
 * 创建经过 5 层校验的 zod string schema
 * 可直接用于 MCP 工具的输入参数定义
 *
 * @param options 校验选项
 * @returns 带有 5 层 refine 的 zod string schema
 */
export function createValidatedTextSchema(options: TextValidationOptions = {}): z.ZodString {
  const { maxLength = MAX_TEXT_LENGTH, fieldName = '文本' } = options

  return z.string()
    .min(1, `${fieldName}不能为空`)
    .max(maxLength, `${fieldName}长度超限（最大 ${maxLength} 字符）`)
    // 第 2 层：单行检查
    .refine(
      (s) => options.singleLine !== false ? !s.includes('\n') : true,
      `${fieldName}必须为单行`,
    )
    // 第 3 层：代码特征检测
    .refine(
      (s) => options.detectCode !== false ? !CODE_KEYWORDS.test(s) : true,
      `${fieldName}包含代码关键字，不允许显示代码`,
    )
    .refine(
      (s) => options.detectCode !== false ? !CODE_STRUCTURE.test(s) : true,
      `${fieldName}包含代码结构，不允许显示代码`,
    )
    // 第 4 层：URL 检测
    .refine(
      (s) => options.detectUrl !== false ? !URL_PATTERN.test(s) : true,
      `${fieldName}包含 URL，不允许显示链接`,
    )
    // 第 5 层：密钥检测
    .refine(
      (s) => options.detectSecret !== false ? !SECRET_KEY_VALUE.test(s) : true,
      `${fieldName}可能包含敏感凭证`,
    )
    .refine(
      (s) => options.detectSecret !== false ? !SECRET_STANDALONE.test(s) : true,
      `${fieldName}可能包含密钥或令牌`,
    )
}

/**
 * 创建经过校验的 ID schema
 * ID 字段仅需长度限制 + 单行检查，不做代码/URL 检测
 */
export function createValidatedIdSchema(fieldName = 'ID'): z.ZodString {
  return z.string()
    .min(1, `${fieldName}不能为空`)
    .max(MAX_ID_LENGTH, `${fieldName}长度超限（最大 ${MAX_ID_LENGTH} 字符）`)
    .refine((s) => !s.includes('\n'), `${fieldName}必须为单行`)
}

/**
 * 创建气泡消息专用 schema
 * 气泡消息有更严格的限制（max 200 字符 + 全部 5 层校验）
 */
export function createBubbleMessageSchema(maxLength = 200): z.ZodString {
  return createValidatedTextSchema({ maxLength, fieldName: '气泡消息' })
}

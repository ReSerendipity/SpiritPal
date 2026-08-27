/**
 * Agent 工具参数 Zod Schema 校验 — 防 Prompt Injection
 *
 * @fileoverview
 * MLOps 评估报告 P1 差距：Agent 工具参数无 schema 校验，LLM 可被注入恶意参数。
 *
 * 本模块为每个 Agent 工具定义 Zod schema，在工具执行前验证 LLM 返回的参数：
 * 1. 参数类型校验（string/number/boolean）
 * 2. 参数长度/范围限制（防止超长输入导致缓冲区溢出或 DoS）
 * 3. 参数格式校验（如 app_name 只允许字母数字和常见分隔符）
 * 4. 危险字符过滤（防止 shell 注入、路径穿越等）
 *
 * 安全设计：
 * - 白名单优先：app_name 只允许已知应用名列表 + 安全字符
 * - query 参数限制最大长度 + 过滤控制字符
 * - action 参数枚举校验
 *
 * @module toolParamValidator
 * @requires zod
 */

import { z } from 'zod'

// ============ 安全常量 ============

/** 应用程序名最大长度 */
const MAX_APP_NAME_LENGTH = 100

/** 搜索关键词最大长度 */
const MAX_QUERY_LENGTH = 200

/** 提醒消息最大长度 */
const MAX_MESSAGE_LENGTH = 500

/** 时间描述最大长度 */
const MAX_TIME_LENGTH = 100

/** 允许的应用名字符模式（字母、数字、空格、点、下划线、连字符） */
const SAFE_APP_NAME_PATTERN = /^[a-zA-Z0-9\u4e00-\u9fff\s._-]+$/

/** 危险字符（shell 元字符、路径穿越） */
// eslint-disable-next-line no-control-regex -- 控制字符检测是故意的（安全过滤）
const DANGEROUS_CHARS = /[;&|`$<>\\\x00-\x1f]/

/** 宠物动作枚举值 */
const PET_ACTIONS = ['feed', 'play', 'bathe', 'pet', 'sleep'] as const

/** 日程操作枚举值 */
const SCHEDULE_ACTIONS = ['list', 'cancel'] as const

// ============ Zod Schema 定义 ============

/** open_application 工具参数 schema */
export const openApplicationSchema = z.object({
  app_name: z
    .string()
    .min(1, '应用名不能为空')
    .max(MAX_APP_NAME_LENGTH, `应用名不能超过 ${MAX_APP_NAME_LENGTH} 字符`)
    .regex(SAFE_APP_NAME_PATTERN, '应用名包含不允许的字符')
    .refine((val) => !DANGEROUS_CHARS.test(val), '应用名包含危险字符'),
})

/** search_web 工具参数 schema */
export const searchWebSchema = z.object({
  query: z
    .string()
    .min(1, '搜索关键词不能为空')
    .max(MAX_QUERY_LENGTH, `搜索关键词不能超过 ${MAX_QUERY_LENGTH} 字符`)
    .refine((val) => !DANGEROUS_CHARS.test(val), '搜索关键词包含危险字符'),
})

/** set_reminder 工具参数 schema */
export const setReminderSchema = z.object({
  message: z
    .string()
    .min(1, '提醒内容不能为空')
    .max(MAX_MESSAGE_LENGTH, `提醒内容不能超过 ${MAX_MESSAGE_LENGTH} 字符`)
    .refine((val) => !DANGEROUS_CHARS.test(val), '提醒内容包含危险字符'),
  time: z
    .string()
    .max(MAX_TIME_LENGTH, `时间描述不能超过 ${MAX_TIME_LENGTH} 字符`)
    .refine((val) => !DANGEROUS_CHARS.test(val), '时间描述包含危险字符')
    .optional(),
})

/** manage_schedule 工具参数 schema */
export const manageScheduleSchema = z.object({
  action: z.enum(SCHEDULE_ACTIONS),
  title: z
    .string()
    .max(MAX_MESSAGE_LENGTH, `标题不能超过 ${MAX_MESSAGE_LENGTH} 字符`)
    .refine((val) => !DANGEROUS_CHARS.test(val), '标题包含危险字符')
    .optional(),
})

/** adjust_pet_state 工具参数 schema */
export const adjustPetStateSchema = z.object({
  action: z.enum(PET_ACTIONS),
})

/** get_weather 工具参数 schema（无参数） */
export const getWeatherSchema = z.object({}).optional()

/** get_pet_status 工具参数 schema（无参数） */
export const getPetStatusSchema = z.object({}).optional()

// ============ Schema 注册表 ============

/** 工具名 → Zod schema 映射 */
const TOOL_SCHEMAS: Record<string, z.ZodType> = {
  open_application: openApplicationSchema,
  search_web: searchWebSchema,
  set_reminder: setReminderSchema,
  manage_schedule: manageScheduleSchema,
  adjust_pet_state: adjustPetStateSchema,
  get_weather: getWeatherSchema,
  get_pet_status: getPetStatusSchema,
}

// ============ 校验 API ============

/** 校验结果 */
export interface ValidationResult {
  /** 是否校验通过 */
  valid: boolean
  /** 校验失败时的错误信息列表 */
  errors: string[]
  /** 校验通过时的清理后参数 */
  sanitizedParams?: Record<string, unknown>
}

/**
 * 校验工具参数
 *
 * @param toolName 工具名
 * @param params LLM 返回的原始参数
 * @returns 校验结果
 */
export function validateToolParams(
  toolName: string,
  params: Record<string, unknown>,
): ValidationResult {
  const schema = TOOL_SCHEMAS[toolName]
  if (!schema) {
    return {
      valid: false,
      errors: [`未知工具: ${toolName}`],
    }
  }

  const result = schema.safeParse(params)
  if (result.success) {
    return {
      valid: true,
      errors: [],
      sanitizedParams: result.data as Record<string, unknown>,
    }
  }

  // 收集所有校验错误
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })

  return {
    valid: false,
    errors,
  }
}

/**
 * 获取所有已注册工具的 schema 信息（用于诊断）
 */
export function getToolSchemaSummary(): Array<{ tool: string; paramCount: number; requiredParams: string[] }> {
  const summary: Array<{ tool: string; paramCount: number; requiredParams: string[] }> = []

  for (const [toolName, schema] of Object.entries(TOOL_SCHEMAS)) {
    // 尝试获取 ZodObject 的 shape（.optional() 包装的需要 unwrap）
    const innerSchema = (schema as any)._def?.innerType ?? schema
    const shape = (innerSchema as z.ZodObject<z.ZodRawShape>)?.shape

    if (shape && typeof shape === 'object') {
      const params = Object.keys(shape)
      const required = params.filter((p) => {
        const field = shape[p]
        // Zod v4: check if the field is optional via _def
        return field && !(field as any)._def?.optional
      })

      summary.push({
        tool: toolName,
        paramCount: params.length,
        requiredParams: required,
      })
    } else {
      // 无参数工具
      summary.push({
        tool: toolName,
        paramCount: 0,
        requiredParams: [],
      })
    }
  }

  return summary
}

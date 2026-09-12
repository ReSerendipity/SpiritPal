/**
 * AI Agent — 通过对话让宠物执行系统操作，支持 ReAct 推理循环
 * PRD §7.6 F5.5 AI Agent
 *
 * @fileoverview
 * 主要模块：
 * - ToolDefinition/ToolParameter 接口：工具定义结构
 * - AGENT_TOOLS：7 个基础工具注册表
 * - matchIntent()/detectAgentIntent()：关键词意图检测
 * - processAgentRequest()：主入口（LLM 优先 + 规则回退）
 * - ToolMode 类型：4 级工具模式权限
 * - processReActRequest()：P2 ReAct Loop Agent 执行器（Reasoning→Action→Observation 循环）
 *
 * 架构：
 * 1. 工具定义（Tool Definition）：名称、描述、参数 schema、执行函数
 * 2. 任务规划：解析用户意图，选择合适的工具（LLM 优先 + 关键词回退）
 * 3. 执行循环：调用工具 → 检查结果 → 返回
 *
 * P2 增强：ReAct Loop Agent（参考 ai-live2d-go）
 * - Reasoning → Action → Observation 循环（3-10 轮）
 * - 工具执行嵌入推理链
 * - 从工具结果解析观察
 * - 终止条件：最大轮数、目标达成、出错
 *
 * @module aiAgent
 * @requires ./llmClient - LLM 客户端
 * @requires ./aiConfig - AI 配置加载
 * @requires ./jsonUtils - JSON 提取工具
 * @requires ./types - AIConfig, ChatMessage 类型
 * @requires ./agentTools - 工具实现函数
 */

import { extractJSONObject } from '@/lib/data/jsonUtils'
import type { AIConfig, ChatMessage } from '@/lib/data/types'
import {
  toolOpenApplication,
  toolSearchWeb,
  toolSetReminder,
  toolManageSchedule,
  toolAdjustPetState,
  toolGetWeather,
  toolGetPetStatus,
  toolReadFile,
  toolWriteFile,
  toolListDirectory,
  toolSearchFiles,
  toolExecuteCommand,
  extractAppName,
  extractSearchQuery,
  extractPetAction,
  // C-2：工具权限的单一真相源（agentTools 的 TOOL_MODE_PERMISSIONS）。
  // 此前本文件维护了一份 MODE_TOOL_SETS 副本，developer/worker 的工具被注释成 TODO，
  // 导致 agentTools 已实现的 search_files / execute_command 在 isToolAllowed 下不可用。
  getToolsForMode,
  isToolAvailableInMode,
  isToolConfirmationRequired,
  ToolMode as AgentToolMode,
} from './agentTools'
import { loadAIConfig } from './aiConfig'
import { getLLMClient } from './llmClient'
import { getPrompt } from './promptRegistry'
// P0-1：接入 zod 输出参数校验（LLM 输出 → 工具参数的第一道防线）
import { validateToolParams } from '@/lib/system/toolParamValidator'
// P0-1：接入工具级确认闸门（fail-closed，豁免名单外必须确认）
import { requestToolConfirmation } from './agentSandbox'

// ============ 工具定义类型 ============

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean'
  description: string
  required?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
  execute: (params: Record<string, unknown>) => Promise<string>
}

// ============ Agent 意图关键词 ============

interface IntentKeyword {
  tool: string
  keywords: string[]
}

const INTENT_KEYWORDS: IntentKeyword[] = [
  { tool: 'open_application', keywords: ['打开', '启动', '运行', '开启', 'open ', 'launch', 'start '] },
  { tool: 'search_web', keywords: ['搜索', '查一下', '查询', '搜索一下', '帮我查', 'search', 'google'] },
  // P0-4 修复：移除单独的"记得"——它会拦截"你还记得我们上次聊过的 XX 吗"这类记忆召回请求，
  // 导致回忆功能根本走不到。改为更精确的组合词，仅在明确表达"提醒我"意图时才触发提醒工具。
  { tool: 'set_reminder', keywords: ['提醒', '定时', '记得提醒', '别忘了', '记着提醒', '到时候叫我', '到点提醒', 'remind', 'reminder', 'timer'] },
  { tool: 'get_weather', keywords: ['天气', 'weather', '温度多少', '下雨吗'] },
  { tool: 'get_pet_status', keywords: ['宠物状态', '状态如何', '饱食度', '心情如何', '等级多少', 'hp多少', '查看状态'] },
  { tool: 'adjust_pet_state', keywords: ['喂食', '喂一下', '玩耍', '玩一下', '睡觉', '洗澡', '摸头', '摸一下', '撸猫'] },
  { tool: 'manage_schedule', keywords: ['日程', 'schedule', '查看日程', '取消日程', '删除日程', '有什么安排'] },
]

// ============ 工具名称常量 ============
const TOOL_OPEN_APPLICATION = 'open_application'
const TOOL_SEARCH_WEB = 'search_web'
const TOOL_SET_REMINDER = 'set_reminder'
const TOOL_MANAGE_SCHEDULE = 'manage_schedule'
const TOOL_ADJUST_PET_STATE = 'adjust_pet_state'
const TOOL_GET_WEATHER = 'get_weather'
const TOOL_GET_PET_STATUS = 'get_pet_status'

// ============ 工具注册表 ============

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: TOOL_OPEN_APPLICATION,
    description: '打开应用程序（如计算器、记事本、浏览器等）',
    parameters: {
      app_name: { type: 'string', description: '应用程序名称', required: true },
    },
    execute: toolOpenApplication,
  },
  {
    name: TOOL_SEARCH_WEB,
    description: '在浏览器中搜索关键词',
    parameters: {
      query: { type: 'string', description: '搜索关键词', required: true },
    },
    execute: toolSearchWeb,
  },
  {
    name: TOOL_SET_REMINDER,
    description: '设置提醒/日程（支持自然语言时间，如"明天9点"、"30分钟后"）',
    parameters: {
      message: { type: 'string', description: '提醒内容', required: true },
      time: { type: 'string', description: '时间描述（如"明天9点"、"30分钟后"）' },
    },
    // set_reminder 的实际执行在 processAgentRequest 中特殊处理（需要 userMessage 和 characterId）
    execute: async () => {
      console.warn('[SpiritPal] set_reminder 应通过 processAgentRequest 调用，不应直接执行')
      return ''
    },
  },
  {
    name: TOOL_MANAGE_SCHEDULE,
    description: '管理日程（查看/取消）',
    parameters: {
      action: { type: 'string', description: '操作：list（查看）/ cancel（取消）', required: true },
      title: { type: 'string', description: '要取消的日程标题（cancel 时使用）' },
    },
    execute: toolManageSchedule,
  },
  {
    name: TOOL_ADJUST_PET_STATE,
    description: '调整宠物状态（喂食/玩耍/洗澡/摸头/睡觉）',
    parameters: {
      action: { type: 'string', description: '操作：feed/play/bathe/pet/sleep', required: true },
    },
    execute: toolAdjustPetState,
  },
  {
    name: TOOL_GET_WEATHER,
    description: '获取当前天气信息',
    parameters: {},
    execute: toolGetWeather,
  },
  {
    name: TOOL_GET_PET_STATUS,
    description: '获取宠物当前状态（等级/饱食度/心情/健康/亲密度）',
    parameters: {},
    execute: toolGetPetStatus,
  },
  // ============ 高权限工具（P0-1 注册）========================
  // 以下工具仅出现在 Developer / Worker 模式的 TOOL_MODE_PERMISSIONS 中，
  // 低权限模式不会被注入 LLM 工具描述。执行前经 zod 参数校验 + 确认闸门。
  {
    name: 'read_file',
    description: '读取指定文本文件的内容（只读，限安全路径；高风险需人工二次确认）',
    parameters: {
      path: { type: 'string', description: '文件绝对路径', required: true },
    },
    execute: toolReadFile,
  },
  {
    name: 'list_directory',
    description: '列出指定目录下的条目（只读）',
    parameters: {
      path: { type: 'string', description: '目录绝对路径（缺省为当前目录）' },
    },
    execute: toolListDirectory,
  },
  {
    name: 'search_files',
    description: '按通配模式在指定目录内搜索匹配的文件名（只读，深度/结果数受限）',
    parameters: {
      pattern: { type: 'string', description: '通配模式，如 *.ts、*.txt', required: true },
      path: { type: 'string', description: '搜索根目录（缺省为当前目录）' },
    },
    execute: toolSearchFiles,
  },
  {
    name: 'write_file',
    description: '向指定文件写入文本内容（覆盖写入，高风险操作，必须用户确认，禁止写入系统目录）',
    parameters: {
      path: { type: 'string', description: '目标文件绝对路径', required: true },
      content: { type: 'string', description: '写入的文本内容', required: true },
    },
    execute: toolWriteFile,
  },
  {
    name: 'execute_command',
    description: '执行受限只读命令（白名单：tasklist/ipconfig/dir/type/whoami/netstat 等，禁止链式/重定向/任意 shell；高风险操作，必须用户确认）',
    parameters: {
      command: { type: 'string', description: '单条只读命令', required: true },
    },
    execute: toolExecuteCommand,
  },
]

// ============ 意图检测 ============

/**
 * 匹配用户消息的意图，返回对应的工具名
 * 合并了原 detectAgentIntent 和 detectToolByKeyword 的逻辑，消除双重遍历
 * @param message 用户消息
 * @returns 匹配到的工具名，未匹配返回 null
 */
export function matchIntent(message: string): string | null {
  const lower = message.toLowerCase()
  for (const intent of INTENT_KEYWORDS) {
    for (const kw of intent.keywords) {
      if (message.includes(kw) || lower.includes(kw.toLowerCase())) {
        return intent.tool
      }
    }
  }
  return null
}

/**
 * 检测用户消息是否需要 Agent 模式
 * 通过关键词匹配判断
 */
export function detectAgentIntent(message: string): boolean {
  return matchIntent(message) !== null
}

/**
 * 检测用户消息是否包含多步任务意图
 * 多步任务需要 ReAct 循环（推理->行动->观察->再推理），而非单轮工具调用。
 * @param userMessage 用户原始消息
 * @returns 是否为多步任务
 */
export function detectMultiStepIntent(userMessage: string): boolean {
  const text = userMessage.toLowerCase()
  const multiStepPatterns = [
    /先.*再/,
    /先.*然后/,
    /先.*接着/,
    /然后.*再/,
    /接着.*再/,
    /之后.*再/,
    /查.*然后.*设/,
    /查.*再.*设/,
    /搜索.*然后/,
    /搜索.*再/,
    /打开.*然后/,
    /帮我.*再.*帮我/,
  ]
  return multiStepPatterns.some((p) => p.test(text))
}

// ============ LLM 意图解析 ============

// Prompt 从 promptRegistry 加载（版本化管理）
const AGENT_SYSTEM_PROMPT = getPrompt('agent.intent')

/** 从 LLM 响应中提取 JSON */
// [Quality Review] DRY 提取：使用 jsonUtils.ts 中的 extractJSONObject 替代本地实现
function extractJSON(text: string): Record<string, unknown> | null {
  const parsed = extractJSONObject(text)
  if (parsed && 'tool' in parsed) {
    return parsed
  }
  return null
}

// ============ 规则回退 ============

// REFACTOR: [A4] planByRule 用策略 Map 替代 switch-case，符合开闭原则（OCP）
// 新增工具只需在 RULE_PLANNERS 增加一条映射，无需修改 planByRule 函数体
// 同时消除原 switch 中两处「params: {}」的重复字面量
type RulePlanner = (message: string) => Record<string, unknown>

const emptyParams: RulePlanner = () => ({})

const RULE_PLANNERS: Record<string, RulePlanner> = {
  [TOOL_OPEN_APPLICATION]: (msg) => ({ app_name: extractAppName(msg) }),
  [TOOL_SEARCH_WEB]: (msg) => ({ query: extractSearchQuery(msg) }),
  [TOOL_SET_REMINDER]: (msg) => ({ message: msg, time: '' }),
  [TOOL_GET_WEATHER]: emptyParams,
  [TOOL_GET_PET_STATUS]: emptyParams,
  [TOOL_ADJUST_PET_STATE]: (msg) => ({ action: extractPetAction(msg) }),
  [TOOL_MANAGE_SCHEDULE]: (msg) => {
    if (msg.includes('取消') || msg.includes('删除')) {
      return { action: 'cancel', title: msg.replace(/取消|删除|日程|提醒/g, '').trim() }
    }
    return { action: 'list' }
  },
}

/**
 * 规则回退：当 LLM 不可用时，基于关键词和正则提取工具调用
 */
function planByRule(message: string): { tool: string; params: Record<string, unknown> } | null {
  const tool = matchIntent(message)
  if (!tool) return null

  const planner = RULE_PLANNERS[tool]
  if (!planner) return null
  return { tool, params: planner(message) }
}

// ============ 主入口：processAgentRequest ============

/**
 * 处理 Agent 请求
 * 1. 构建工具描述 system prompt
 * 2. 调用 LLM 解析工具调用意图
 * 3. 执行对应工具
 * 4. 返回结果给用户
 *
 * @param userMessage 用户原始消息
 * @param config AI 配置（可选，未提供则从 localStorage 加载）
 * @param characterId 当前角色 ID（用于日程关联）
 * @returns 格式化的执行结果字符串
 */
export async function processAgentRequest(
  userMessage: string,
  config?: AIConfig,
  characterId?: string,
  memoryContext?: string,
): Promise<string> {
  // ===== P2 增强：多步任务检测 -> ReAct Loop =====
  // 当用户消息包含多步操作意图时，路由到 processReActRequest 进行多步推理-行动循环。
  if (detectMultiStepIntent(userMessage)) {
    try {
      const reactResult = await processReActRequest(userMessage, config, characterId, { maxRounds: 5, toolMode: 'agent' })
      return reactResult.answer
    } catch (reactErr) {
      console.warn('[SpiritPal] ReAct 执行失败，回退到单轮 Agent:', reactErr)
    }
  }

  // 1. 尝试用 LLM 解析意图
  let plan: { tool: string; params: Record<string, unknown> } | null = null

  try {
    const aiConfig = config ?? (await loadAIConfig())
    // 仅当配置了 API Key 或使用 Ollama 时才调用 LLM
    if (aiConfig.apiKey || aiConfig.provider === 'ollama') {
      const client = getLLMClient(aiConfig)
      // T-7: 注入记忆上下文到 system prompt
      const systemPrompt = memoryContext
        ? `${AGENT_SYSTEM_PROMPT}\n\n${memoryContext}`
        : AGENT_SYSTEM_PROMPT
      const messages: ChatMessage[] = [
        {
          id: 'agent-sys',
          role: 'system',
          content: systemPrompt,
          timestamp: Date.now(),
        },
        {
          id: 'agent-user',
          role: 'user',
          content: userMessage,
          timestamp: Date.now(),
        },
      ]
      const response = await client.chatOnce(messages)
      const parsed = extractJSON(response)
      if (parsed && typeof parsed.tool === 'string' && parsed.tool !== 'none') {
        // 白名单校验：仅允许 AGENT_TOOLS 中已注册的工具名
        const isValidTool = AGENT_TOOLS.some((t) => t.name === parsed.tool)
        if (isValidTool) {
          plan = {
            tool: parsed.tool,
            params: (parsed.params as Record<string, unknown>) ?? {},
          }
        } else {
          console.warn(`[SpiritPal] LLM 返回未知工具名: ${parsed.tool}`)
        }
      }
    }
  } catch (err) {
    // LLM 调用失败，回退到规则匹配
    console.warn('[SpiritPal] LLM 意图解析失败，回退到规则:', err)
  }

  // 2. LLM 不可用或解析失败时，使用规则回退
  if (!plan) {
    plan = planByRule(userMessage)
  }

  if (!plan) {
    return '🔧 未识别到需要执行的操作'
  }

  // 3. 执行工具（P0-1：接入 zod 参数校验 + 确认闸门）
  const toolDef = AGENT_TOOLS.find((t) => t.name === plan!.tool)
  if (!toolDef) {
    return `🔧 未知工具：${plan.tool}`
  }

  try {
    // 3.1 zod 参数校验（防 Prompt Injection / 危险参数，覆盖全部已注册工具）
    const validation = validateToolParams(plan.tool, plan.params)
    if (!validation.valid) {
      return `🔧 工具「${plan.tool}」参数校验失败：${validation.errors.join('；')}`
    }
    const sanitizedParams = validation.sanitizedParams ?? plan.params

    // 3.2 确认闸门（默认拒绝 + 豁免名单之外必须用户确认，fail-closed）
    if (isToolConfirmationRequired(plan.tool)) {
      const confirmation = await requestToolConfirmation(plan.tool, sanitizedParams, 'worker')
      if (!confirmation.approved) {
        return `🔧 已拒绝执行「${plan.tool}」：${confirmation.reason ?? '用户未确认'}`
      }
    }

    // set_reminder 需要额外的 userMessage 和 characterId
    if (plan.tool === TOOL_SET_REMINDER) {
      return await toolSetReminder(sanitizedParams, userMessage, characterId)
    }
    return await toolDef.execute(sanitizedParams)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `🔧 执行「${plan.tool}」时出错：${msg}`
  }
}

// ============ P2: 4 级工具模式 ============

/**
 * 工具模式层级
 * 
 * Chat < Agent < Developer < Worker
 * - Chat: 仅对话，无工具调用能力
 * - Agent: 基础工具集（打开应用、搜索、提醒、天气、宠物状态）
 * - Developer: Agent + 文件操作、终端命令（需额外工具注册）
 * - Worker: Developer + 系统级操作（需用户确认后执行）
 */
export type ToolMode = 'chat' | 'agent' | 'developer' | 'worker'

/** 工具模式层级排序（越高权限越大） */
const TOOL_MODE_LEVEL: Record<ToolMode, number> = {
  chat: 0,
  agent: 1,
  developer: 2,
  worker: 3,
}

/**
 * 工具模式对应的可用工具集
 * 
 * Chat: 无工具
 * Agent: 基础工具（AGENT_TOOLS 全部）
 * Developer: Agent + 文件/终端工具（TODO: 注册扩展工具）
 * Worker: Developer + 系统级工具（TODO: 注册系统工具）
 */
// C-2：权限表已上收到 agentTools.TOOL_MODE_PERMISSIONS，本文件不再维护副本。
// 能力边界（诚实声明，不夸大）：
// - developer：+ read_file / list_directory / search_files（只读，search_files 已由 Rust
//   system_tools.rs 真实实现）
// - worker：再 + write_file / execute_command（execute_command 为**只读白名单**，
//   非任意 shell；两者均需用户确认）
// - install_package / system_setting / registry_edit 等系统级写操作**从未实现，
//   也不在计划内**（桌面宠物不应具备系统配置写入能力）

/**
 * 检查当前工具模式是否允许使用指定工具
 * 
 * @param mode 当前工具模式
 * @param toolName 工具名称
 * @returns true 表示允许使用
 */
export function isToolAllowed(mode: ToolMode, toolName: string): boolean {
  // C-2：委托 agentTools 的单一权限表（值与 ToolMode 枚举一致，故做一次类型断言）
  return isToolAvailableInMode(toolName, mode as unknown as AgentToolMode)
}

/**
 * 获取当前模式下可用的工具列表
 * 
 * @param mode 工具模式
 * @returns 可用工具定义数组
 */
export function getAvailableTools(mode: ToolMode): ToolDefinition[] {
  const allowedNames = getToolsForMode(mode as unknown as AgentToolMode)
  return AGENT_TOOLS.filter(t => allowedNames.includes(t.name))
}

/**
 * 获取工具模式描述（用于 UI 显示）
 */
export function getToolModeDescription(mode: ToolMode): string {
  switch (mode) {
    case 'chat':
      return '聊天模式 — 仅对话，无工具调用'
    case 'agent':
      return 'Agent 模式 — 可打开应用、搜索、设置提醒等'
    case 'developer':
      return '开发者模式 — Agent + 文件操作、终端命令'
    case 'worker':
      return '工作模式 — 开发者 + 系统级操作（需确认）'
  }
}

/**
 * 比较两个工具模式的层级
 * 
 * @returns 正数表示 a > b，0 表示相等，负数表示 a < b
 */
export function compareToolMode(a: ToolMode, b: ToolMode): number {
  return TOOL_MODE_LEVEL[a] - TOOL_MODE_LEVEL[b]
}

// ============ P2: ReAct Loop Agent ============

/** ReAct 循环配置 */
export interface ReActConfig {
  /** 最大推理轮数（默认 5，范围 3-10） */
  maxRounds?: number
  /** 当前工具模式（默认 'agent'） */
  toolMode?: ToolMode
  /** 每轮推理的超时时间（毫秒，默认 15000） */
  roundTimeoutMs?: number
  /** 是否在每轮后回调进度 */
  onRound?: (round: number, thought: string, action: string, observation: string) => void
}

/** ReAct 循环结果 */
export interface ReActResult {
  /** 最终回复 */
  answer: string
  /** 推理链（每轮的 Thought→Action→Observation） */
  trace: ReActRound[]
  /** 总轮数 */
  rounds: number
  /** 终止原因 */
  terminationReason: 'max_rounds' | 'goal_achieved' | 'error'
}

/** 单轮推理记录 */
export interface ReActRound {
  /** 轮次（从 1 开始） */
  round: number
  /** 推理（Thought） */
  thought: string
  /** 行动（Action） */
  action: string
  /** 行动参数 */
  actionParams: Record<string, unknown>
  /** 观察（Observation，工具执行结果） */
  observation: string
  /** 时间戳 */
  timestamp: number
}

/** ReAct 循环的 LLM 提示词 */
const REACT_SYSTEM_PROMPT = getPrompt('agent.react')

/** 解析 ReAct LLM 响应 */
function parseReActResponse(
  response: string,
): {
  thought: string
  action?: { tool: string; params: Record<string, unknown> }
  answer?: string
} {
  const result: { thought: string; action?: { tool: string; params: Record<string, unknown> }; answer?: string } = {
    thought: '',
  }

  // 提取 Thought
  const thoughtMatch = response.match(/Thought:\s*([\s\S]*?)(?=\n\s*(?:Action:|Answer:)|$)/i)
  if (thoughtMatch) {
    result.thought = thoughtMatch[1]?.trim() ?? ''
  }

  // 提取 Action
  const actionMatch = response.match(/Action:\s*([\s\S]*?)$/i)
  if (actionMatch) {
    // 检查是否是 Answer 在 Action 之后
    const actionText = actionMatch[1]?.replace(/\n\s*Answer:[\s\S]*$/i, '').trim() ?? ''
    const actionJson = extractJSONObject(actionText)
    if (actionJson && typeof actionJson.tool === 'string') {
      result.action = {
        tool: actionJson.tool,
        params: (actionJson.params as Record<string, unknown>) ?? {},
      }
    }
  }

  // 提取 Answer
  const answerMatch = response.match(/Answer:\s*([\s\S]*?)$/i)
  if (answerMatch) {
    result.answer = answerMatch[1]?.trim() ?? ''
  }

  return result
}

/**
 * ReAct Loop Agent 执行器
 * 
 * Reasoning → Action → Observation 循环（3-10 轮）
 * 
 * 工作流程：
 * 1. 将用户消息 + 工具描述发给 LLM
 * 2. LLM 输出 Thought + Action
 * 3. 执行 Action 对应的工具
 * 4. 将 Observation 追加到上下文
 * 5. 重复 1-4，直到 LLM 输出 Answer 或达到最大轮数
 * 
 * @param userMessage 用户消息
 * @param config AI 配置
 * @param characterId 角色 ID
 * @param reactConfig ReAct 配置
 * @returns ReAct 循环结果
 */
export async function processReActRequest(
  userMessage: string,
  config?: AIConfig,
  characterId?: string,
  reactConfig: ReActConfig = {},
): Promise<ReActResult> {
  const maxRounds = Math.min(Math.max(reactConfig.maxRounds ?? 5, 3), 10)
  const toolMode = reactConfig.toolMode ?? 'agent'
  const onRound = reactConfig.onRound

  // 获取当前模式可用工具
  const availableTools = getAvailableTools(toolMode)
  if (availableTools.length === 0) {
    return {
      answer: '当前为聊天模式，无可用工具。请切换到 Agent 模式或更高权限模式。',
      trace: [],
      rounds: 0,
      terminationReason: 'error',
    }
  }

  // 构建工具描述
  const toolDescriptions = availableTools
    .map(t => `- ${t.name}: ${t.description} 参数: ${JSON.stringify(t.parameters)}`)
    .join('\n')

  const systemPrompt = REACT_SYSTEM_PROMPT.replace('{tool_descriptions}', toolDescriptions)

  // 构建 ReAct 对话上下文
  const contextMessages: ChatMessage[] = [
    { id: 'react-sys', role: 'system', content: systemPrompt, timestamp: Date.now() },
    { id: 'react-user', role: 'user', content: userMessage, timestamp: Date.now() },
  ]

  const trace: ReActRound[] = []

  try {
    const aiConfig = config ?? (await loadAIConfig())
    const client = getLLMClient(aiConfig)

    for (let round = 1; round <= maxRounds; round++) {
      // 1. 调用 LLM 获取 Thought + Action
      const response = await client.chatOnce(contextMessages)
      const parsed = parseReActResponse(response)

      // 2. 检查是否有最终答案
      if (parsed.answer) {
        return {
          answer: parsed.answer,
          trace,
          rounds: round,
          terminationReason: 'goal_achieved',
        }
      }

      // 3. 如果有 Action，执行工具
      if (parsed.action) {
        const { tool, params } = parsed.action

        // 白名单校验
        if (!isToolAllowed(toolMode, tool)) {
          const observation = `错误：工具 "${tool}" 在当前模式（${toolMode}）下不可用`

          trace.push({
            round,
            thought: parsed.thought,
            action: tool,
            actionParams: params,
            observation,
            timestamp: Date.now(),
          })

          onRound?.(round, parsed.thought, tool, observation)

          // 将观察追加到上下文
          contextMessages.push({
            id: `react-obs-${round}`,
            role: 'assistant',
            content: `Thought: ${parsed.thought}\nAction: ${JSON.stringify({ tool, params })}\nObservation: ${observation}`,
            timestamp: Date.now(),
          })
          continue
        }

        // 执行工具（P0-1：接入 zod 参数校验 + 确认闸门）
        const toolDef = availableTools.find(t => t.name === tool)
        let observation: string

        if (!toolDef) {
          observation = `错误：未知工具 "${tool}"`
        } else {
          try {
            // 1. zod 参数校验（防 Prompt Injection / 危险参数）
            const validation = validateToolParams(tool, params)
            if (!validation.valid) {
              observation = `错误：工具「${tool}」参数校验失败：${validation.errors.join('；')}`
            } else {
              const sanitizedParams = validation.sanitizedParams ?? params

              // 2. 确认闸门（豁免名单之外必须用户确认，fail-closed）
              if (isToolConfirmationRequired(tool)) {
                const confirmation = await requestToolConfirmation(tool, sanitizedParams, toolMode)
                if (!confirmation.approved) {
                  observation = `已拒绝执行「${tool}」：${confirmation.reason ?? '用户未确认'}`
                } else if (tool === TOOL_SET_REMINDER) {
                  observation = await toolSetReminder(sanitizedParams, userMessage, characterId)
                } else {
                  observation = await toolDef.execute(sanitizedParams)
                }
              } else if (tool === TOOL_SET_REMINDER) {
                observation = await toolSetReminder(sanitizedParams, userMessage, characterId)
              } else {
                observation = await toolDef.execute(sanitizedParams)
              }
            }
          } catch (err) {
            observation = `执行错误：${err instanceof Error ? err.message : String(err)}`
          }
        }

        // 记录本轮
        trace.push({
          round,
          thought: parsed.thought,
          action: tool,
          actionParams: params,
          observation,
          timestamp: Date.now(),
        })

        onRound?.(round, parsed.thought, tool, observation)

        // 将观察追加到上下文
        contextMessages.push({
          id: `react-obs-${round}`,
          role: 'user',
          content: `Observation: ${observation}`,
          timestamp: Date.now(),
        })
      } else {
        // 无 Action 且无 Answer，LLM 可能格式错误
        const observation = '（LLM 未输出有效的 Action 或 Answer，请重新推理）'
        trace.push({
          round,
          thought: parsed.thought || response,
          action: 'none',
          actionParams: {},
          observation,
          timestamp: Date.now(),
        })

        onRound?.(round, parsed.thought || response, 'none', observation)

        contextMessages.push({
          id: `react-retry-${round}`,
          role: 'user',
          content: `上一次推理没有有效输出。请重新思考并输出 Thought + Action 或 Thought + Answer。`,
          timestamp: Date.now(),
        })
      }
    }

    // 达到最大轮数，尝试获取最终答案
    contextMessages.push({
      id: 'react-final',
      role: 'user',
      content: '已达到最大推理轮数，请基于已有观察给出最终答案。格式：Answer: [你的回答]',
      timestamp: Date.now(),
    })

    const finalResponse = await client.chatOnce(contextMessages)
    const finalParsed = parseReActResponse(finalResponse)

    return {
      answer: finalParsed.answer || finalResponse.trim(),
      trace,
      rounds: maxRounds,
      terminationReason: 'max_rounds',
    }
  } catch (err) {
    return {
      answer: `ReAct 执行失败：${err instanceof Error ? err.message : String(err)}`,
      trace,
      rounds: trace.length,
      terminationReason: 'error',
    }
  }
}

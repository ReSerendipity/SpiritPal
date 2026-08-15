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

import { getLLMClient } from './llmClient'
import { loadAIConfig } from './aiConfig'
import { extractJSONObject } from './jsonUtils'
import type { AIConfig, ChatMessage } from './types'
import {
  toolOpenApplication,
  toolSearchWeb,
  toolSetReminder,
  toolManageSchedule,
  toolAdjustPetState,
  toolGetWeather,
  toolGetPetStatus,
  extractAppName,
  extractSearchQuery,
  extractPetAction,
} from './agentTools'

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

// ============ LLM 意图解析 ============

const AGENT_SYSTEM_PROMPT = `你是一个 AI Agent 助手。根据用户的消息，选择合适的工具来执行操作。

可用的工具：
1. open_application - 打开应用程序
   参数: app_name (string, required) - 应用程序名称（如 calc, notepad, explorer）
2. search_web - 在浏览器中搜索
   参数: query (string, required) - 搜索关键词
3. set_reminder - 设置提醒
   参数: message (string, required) - 提醒内容, time (string, optional) - 时间描述
4. manage_schedule - 管理日程
   参数: action (string, required) - "list" 或 "cancel", title (string, optional) - 取消时的标题
5. adjust_pet_state - 调整宠物状态
   参数: action (string, required) - "feed" / "play" / "bathe" / "pet" / "sleep"
6. get_weather - 获取天气（无参数）
7. get_pet_status - 获取宠物状态（无参数）

常见应用名称映射：计算器→calc, 记事本→notepad, 画图→mspaint, 资源管理器→explorer, 任务管理器→taskmgr, 命令提示符→cmd

请分析用户消息，返回 JSON 格式的工具调用：
{"tool": "工具名称", "params": {"参数名": "参数值"}}

如果不需要调用任何工具，返回：
{"tool": "none", "params": {}}

只返回 JSON，不要包含其他文本。`

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

  // 3. 执行工具
  const toolDef = AGENT_TOOLS.find((t) => t.name === plan!.tool)
  if (!toolDef) {
    return `🔧 未知工具：${plan.tool}`
  }

  try {
    // set_reminder 需要额外的 userMessage 和 characterId
    if (plan.tool === TOOL_SET_REMINDER) {
      return await toolSetReminder(plan.params, userMessage, characterId)
    }
    return await toolDef.execute(plan.params)
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
const MODE_TOOL_SETS: Record<ToolMode, string[]> = {
  chat: [],
  agent: AGENT_TOOLS.map(t => t.name),
  developer: [
    ...AGENT_TOOLS.map(t => t.name),
    // TODO(P2): 注册 Developer 级工具
    // 'read_file', 'write_file', 'list_directory', 'run_command',
  ],
  worker: [
    ...AGENT_TOOLS.map(t => t.name),
    // TODO(P2): 注册 Developer + Worker 级工具
    // 'read_file', 'write_file', 'list_directory', 'run_command',
    // 'install_package', 'system_setting', 'registry_edit',
  ],
}

/**
 * 检查当前工具模式是否允许使用指定工具
 * 
 * @param mode 当前工具模式
 * @param toolName 工具名称
 * @returns true 表示允许使用
 */
export function isToolAllowed(mode: ToolMode, toolName: string): boolean {
  return MODE_TOOL_SETS[mode].includes(toolName)
}

/**
 * 获取当前模式下可用的工具列表
 * 
 * @param mode 工具模式
 * @returns 可用工具定义数组
 */
export function getAvailableTools(mode: ToolMode): ToolDefinition[] {
  const allowedNames = MODE_TOOL_SETS[mode]
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
const REACT_SYSTEM_PROMPT = `你是一个使用 ReAct（Reasoning + Acting）模式的 AI Agent。

在每一轮中，你需要：
1. Thought: 思考当前状况，决定下一步行动
2. Action: 选择一个工具执行
3. Observation: 观察工具执行结果

你可以使用以下工具：
{tool_descriptions}

请严格按照以下格式回复：

Thought: [你的推理过程]
Action: {"tool": "工具名", "params": {"参数名": "参数值"}}

如果你已经有了最终答案，请回复：

Thought: [最终推理]
Answer: [你的最终回答]

重要规则：
- 每轮只执行一个工具
- 根据观察结果调整下一步行动
- 如果已经获得足够信息，直接给出最终答案
- 不要重复执行相同的操作`

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

        // 执行工具
        const toolDef = availableTools.find(t => t.name === tool)
        let observation: string

        if (!toolDef) {
          observation = `错误：未知工具 "${tool}"`
        } else {
          try {
            if (tool === TOOL_SET_REMINDER) {
              observation = await toolSetReminder(params, userMessage, characterId)
            } else {
              observation = await toolDef.execute(params)
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

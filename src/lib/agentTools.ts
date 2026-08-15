/**
 * Agent 工具实现 — AI Agent 可调用的系统工具集合
 * 从 aiAgent.ts 拆分而来，包含应用映射、工具执行函数、参数提取
 * P2 增强：4 级工具模式（参考 ai-live2d-go）
 *
 * @fileoverview
 * 主要模块：
 * - APP_NAME_MAP：中文应用名 → 系统命令映射表（30+ 应用）
 * - ToolMode 枚举：4 级工具权限（Chat/Agent/Developer/Worker）
 * - toolXxx() 系列函数：12 个工具执行函数（打开应用、搜索、提醒、日程、宠物状态、天气、文件读写等）
 * - extractXxx() 系列函数：规则回退的参数提取函数
 * - getToolsForMode()/isToolAvailableInMode()：工具权限检查
 * - formatFileSize()：内部工具函数
 *
 * 工具模式分级：
 * - Chat: 无工具，纯对话
 * - Agent: 安全工具（搜索、计算、宠物操作等）
 * - Developer: 代码工具 + 文件访问（只读）
 * - Worker: 完全系统访问（需用户确认）
 *
 * 约束：本文件不从 aiAgent.ts 导入任何内容，避免循环依赖
 *
 * @module agentTools
 * @requires @tauri-apps/api/core - Tauri 后端调用
 * @requires ./scheduleManager - 日程管理
 * @requires ./weatherAwareness - 天气感知
 * @requires ../stores/petStore - 宠物状态存储
 */

import { invoke } from '@tauri-apps/api/core'
import { getScheduleManager } from './scheduleManager'
import type { EnhancedScheduleEvent } from './scheduleManager'
import { getWeatherAwarenessManager } from './weatherAwareness'
import { usePetStore } from '../stores/petStore'

// ============ 应用名称映射（中文 → 系统命令）============

export const APP_NAME_MAP: Record<string, string> = {
  '计算器': 'calc',
  '记事本': 'notepad',
  '画图': 'mspaint',
  '画图工具': 'mspaint',
  '资源管理器': 'explorer',
  '文件管理器': 'explorer',
  '文件资源管理器': 'explorer',
  '任务管理器': 'taskmgr',
  '命令提示符': 'cmd',
  '终端': 'wt',
  '控制面板': 'control',
  '注册表编辑器': 'regedit',
  '截图工具': 'snippingtool',
  '时钟': 'timedate.cpl',
  '设置': 'ms-settings:',
  '写字板': 'write',
  '放大镜': 'magnify',
  '屏幕键盘': 'osk',
  '计算器应用': 'calc',
  '浏览器': 'https://www.bing.com',
  'vscode': 'code',
  'vs code': 'code',
  'visual studio code': 'code',
  'word': 'winword',
  'excel': 'excel',
  'powerpoint': 'powerpnt',
  'ppt': 'powerpnt',
}

// ============ 工具实现 ============

/** 打开应用程序 */
export async function toolOpenApplication(params: Record<string, unknown>): Promise<string> {
  const rawName = String(params.app_name ?? '').trim()
  if (!rawName) {
    return '❌ 未指定要打开的应用程序名称'
  }
  // 映射中文名称到系统命令
  const appName = APP_NAME_MAP[rawName.toLowerCase()] ?? APP_NAME_MAP[rawName] ?? rawName
  // [Tauri Review] 客户端侧输入校验：拒绝 shell 元字符，防御纵深
  // R-10: 补充 $ (变量替换), 空格 (IFS 注入), 制表符, 双引号
  // eslint-disable-next-line no-control-regex -- 安全校验正则，控制字符（空字节/垂直制表符等）正是检测目标
  const SHELL_METACHARS = /[\x00\x09\x0b\x0c&|><^()%!;`\r\n$ "\t]/
  if (SHELL_METACHARS.test(appName)) {
    return `❌ 应用程序名称包含非法字符：${rawName}`
  }
  try {
    await invoke('open_application', { appName })
    return `🔧 已执行：打开「${rawName}」`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `❌ 打开「${rawName}」失败：${msg}`
  }
}

/** 搜索网页 */
export async function toolSearchWeb(params: Record<string, unknown>): Promise<string> {
  const query = String(params.query ?? '').trim()
  if (!query) {
    return '❌ 未指定搜索关键词'
  }
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`
  try {
    await invoke('open_application', { appName: url })
    return `🔧 已执行：搜索「${query}」`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `❌ 搜索「${query}」失败：${msg}`
  }
}

/** 设置提醒 */
export async function toolSetReminder(params: Record<string, unknown>, userMessage: string, characterId?: string): Promise<string> {
  const message = String(params.message ?? params.content ?? '').trim() || userMessage
  const schedMgr = getScheduleManager()
  // scheduleManager.addFromChat 会从自然语言中解析时间
  const event = schedMgr.addFromChat(message, characterId)
  if (event) {
    const d = new Date(event.triggerTime)
    const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    return `🔧 已设置提醒：「${event.title}」将于 ${timeStr} 提醒你`
  }
  // 如果 addFromChat 无法解析时间，使用 params.time
  const timeStr = String(params.time ?? '').trim()
  if (timeStr) {
    return `🔧 收到提醒请求：「${message}」（时间：${timeStr}），但无法自动解析，请使用更明确的时间描述，如「明天9点提醒我开会」`
  }
  return `🔧 收到提醒请求，但无法从消息中解析时间。请使用格式如「明天9点提醒我开会」「30分钟后提醒我喝水」`
}

/** 管理日程 */
export async function toolManageSchedule(params: Record<string, unknown>): Promise<string> {
  const action = String(params.action ?? 'list').trim().toLowerCase()
  const schedMgr = getScheduleManager()

  if (action === 'list' || action === '查询' || action === '查看') {
    const events = schedMgr.getPendingEvents()
    if (events.length === 0) {
      return '🔧 当前没有待处理的日程'
    }
    const lines = events.map((e: EnhancedScheduleEvent, i: number) => {
      const d = new Date(e.triggerTime)
      const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
      return `${i + 1}. ${e.title} — ${timeStr}`
    })
    return `🔧 当前日程（${events.length} 项）：\n${lines.join('\n')}`
  }

  if (action === 'cancel' || action === '删除' || action === '取消') {
    const eventId = String(params.event_id ?? '').trim()
    if (eventId) {
      schedMgr.cancelEvent(eventId)
      return `🔧 已取消日程`
    }
    // 按标题匹配
    const title = String(params.title ?? params.query ?? '').trim()
    if (title) {
      const events = schedMgr.getPendingEvents()
      const match = events.find((e) => e.title.includes(title))
      if (match) {
        schedMgr.cancelEvent(match.id)
        return `🔧 已取消日程：「${match.title}」`
      }
      return `❌ 未找到标题包含「${title}」的日程`
    }
    return '❌ 请指定要取消的日程标题'
  }

  return `🔧 未知的日程操作：${action}`
}

/** 调整宠物状态 */
export async function toolAdjustPetState(params: Record<string, unknown>): Promise<string> {
  const action = String(params.action ?? '').trim().toLowerCase()
  const store = usePetStore.getState()

  switch (action) {
    case 'feed':
    case '喂食':
    case '喂':
    case '喂一下': {
      // 尝试从背包中找到食物
      const food = store.inventory.find((i) => i.type === 'food')
      if (food) {
        store.useItem(food.id)
        return `🔧 已喂食「${food.name}」，宠物饱食度提升了~`
      }
      return '🔧 背包中没有食物了，先去商店买一些吧~'
    }
    case 'play':
    case '玩耍':
    case '玩':
    case '玩一下':
      store.play()
      return '🔧 和宠物玩耍了一会儿，它很开心~'
    case 'bathe':
    case '洗澡':
    case '洗个澡':
      store.bathe()
      return '🔧 给宠物洗了个澡，它变得更健康了~'
    case 'pet':
    case '摸头':
    case '摸一下':
    case '撸猫':
      store.pet()
      return '🔧 摸了摸宠物的头，亲密度增加了~'
    case 'sleep':
    case '睡觉':
    case '休息':
      return '🔧 宠物去休息了，稍后再来找它玩吧~'
    default:
      return `🔧 未知的宠物操作：${action}（支持：喂食/玩耍/洗澡/摸头/睡觉）`
  }
}

/** 获取天气 */
export async function toolGetWeather(): Promise<string> {
  const weatherMgr = getWeatherAwarenessManager()
  let weather = weatherMgr.getCurrentWeather()
  if (!weather) {
    weather = await weatherMgr.getWeather()
  }
  if (!weather) {
    return '🔧 无法获取天气信息（可能需要授予位置权限）'
  }
  return `🔧 当前天气：${weather.description}，温度 ${weather.temperature}°C`
}

/** 获取宠物状态 */
export async function toolGetPetStatus(): Promise<string> {
  const stats = usePetStore.getState().getCurrentStats()
  const moodTier = stats.mood >= 80 ? '开心' : stats.mood >= 50 ? '一般' : stats.mood >= 20 ? '低落' : '难过'
  const hungerTier = stats.hunger >= 80 ? '饱' : stats.hunger >= 50 ? '还行' : stats.hunger >= 20 ? '饿了' : '很饿'
  return `🔧 宠物状态：
  • 等级：Lv.${stats.level}（经验 ${stats.exp}）
  • 饱食度：${Math.round(stats.hunger)}/100（${hungerTier}）
  • 心情：${Math.round(stats.mood)}/100（${moodTier}）
  • 健康：${Math.round(stats.health)}/100
  • 亲密度：${stats.affection}
  • 金币：${usePetStore.getState().sharedCoins}`
}

// ============ 规则回退：从消息中提取参数 ============

/** 从消息中提取应用程序名称 */
export function extractAppName(message: string): string {
  // 移除前缀关键词
  let cleaned = message
    .replace(/帮我|请|一下|快|赶紧/g, '')
    .replace(/打开|启动|运行|开启|open|launch|start/gi, '')
    .trim()
  // 去掉尾部标点
  cleaned = cleaned.replace(/[，。！？\s]+$/g, '')
  return cleaned
}

/** 从消息中提取搜索关键词 */
export function extractSearchQuery(message: string): string {
  let cleaned = message
    .replace(/帮我|请|一下/g, '')
    .replace(/搜索|查一下|查询|搜索一下|帮我查|search|google/gi, '')
    .trim()
  cleaned = cleaned.replace(/[，。！？\s]+$/g, '')
  return cleaned
}

/** 从消息中提取宠物操作 */
export function extractPetAction(message: string): string {
  if (message.includes('喂')) return 'feed'
  if (message.includes('玩')) return 'play'
  if (message.includes('洗澡') || message.includes('洗个澡')) return 'bathe'
  if (message.includes('摸') || message.includes('撸')) return 'pet'
  if (message.includes('睡') || message.includes('休息')) return 'sleep'
  return ''
}

// ============ P2: 4 级工具模式 ============
// 参考 ai-live2d-go 的工具分级设计
// 不同模式提供不同级别的工具访问权限

/** 工具模式级别 */
export enum ToolMode {
  /** Chat 模式：无工具，纯对话 */
  Chat = 'chat',
  /** Agent 模式：安全工具（搜索、计算、宠物操作等） */
  Agent = 'agent',
  /** Developer 模式：代码工具 + 文件访问（只读） */
  Developer = 'developer',
  /** Worker 模式：完全系统访问（需用户确认） */
  Worker = 'worker',
}

/** 各模式允许的工具名称列表 */
const TOOL_MODE_PERMISSIONS: Record<ToolMode, string[]> = {
  [ToolMode.Chat]: [], // 无工具
  [ToolMode.Agent]: [
    'open_application',
    'search_web',
    'set_reminder',
    'manage_schedule',
    'adjust_pet_state',
    'get_weather',
    'get_pet_status',
  ],
  [ToolMode.Developer]: [
    // Agent 模式的所有工具
    'open_application',
    'search_web',
    'set_reminder',
    'manage_schedule',
    'adjust_pet_state',
    'get_weather',
    'get_pet_status',
    // Developer 额外工具
    'read_file',
    'list_directory',
    'search_files',
  ],
  [ToolMode.Worker]: [
    // 所有工具
    'open_application',
    'search_web',
    'set_reminder',
    'manage_schedule',
    'adjust_pet_state',
    'get_weather',
    'get_pet_status',
    'read_file',
    'list_directory',
    'search_files',
    'write_file',
    'execute_command',
  ],
}

/** 需要用户确认的工具（Worker 模式下仍需确认） */
const CONFIRMATION_REQUIRED_TOOLS = new Set([
  'write_file',
  'execute_command',
])

/**
 * 获取指定模式下可用的工具名称列表
 *
 * @param mode 工具模式
 * @returns 允许的工具名称数组
 */
export function getToolsForMode(mode: ToolMode): string[] {
  return TOOL_MODE_PERMISSIONS[mode] ?? []
}

/**
 * 检查工具是否在指定模式下可用
 *
 * @param toolName 工具名称
 * @param mode 工具模式
 * @returns 是否可用
 */
export function isToolAvailableInMode(toolName: string, mode: ToolMode): boolean {
  const allowedTools = TOOL_MODE_PERMISSIONS[mode]
  return allowedTools.includes(toolName)
}

/**
 * 检查工具是否需要用户确认才能执行
 *
 * @param toolName 工具名称
 * @returns 是否需要确认
 */
export function isToolConfirmationRequired(toolName: string): boolean {
  return CONFIRMATION_REQUIRED_TOOLS.has(toolName)
}

/**
 * 获取工具模式描述（用于 UI 展示）
 *
 * @param mode 工具模式
 * @returns 模式描述
 */
export function getToolModeDescription(mode: ToolMode): string {
  switch (mode) {
    case ToolMode.Chat:
      return '纯对话模式：宠物只和你聊天，不执行任何系统操作'
    case ToolMode.Agent:
      return '助手模式：宠物可以搜索、打开应用、设置提醒等安全操作'
    case ToolMode.Developer:
      return '开发者模式：宠物可以读取文件和目录，辅助编程工作'
    case ToolMode.Worker:
      return '高级模式：宠物拥有完全系统访问权限（危险操作需确认）'
    default:
      return '未知模式'
  }
}

// ============ Developer / Worker 模式额外工具 ============

/** 读取文件内容 */
export async function toolReadFile(params: Record<string, unknown>): Promise<string> {
  const filePath = String(params.path ?? '').trim()
  if (!filePath) {
    return '❌ 未指定文件路径'
  }
  try {
    const content = await invoke<string>('read_file', { path: filePath })
    // 截断过长内容
    if (content.length > 10000) {
      return content.substring(0, 10000) + '\n... (内容过长，已截断)'
    }
    return content
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `❌ 读取文件失败：${msg}`
  }
}

/** 列出目录内容 */
export async function toolListDirectory(params: Record<string, unknown>): Promise<string> {
  const dirPath = String(params.path ?? '.').trim()
  try {
    const entries = await invoke<Array<{ name: string; is_dir: boolean; size: number }>>(
      'list_directory', { path: dirPath },
    )
    if (!entries || entries.length === 0) {
      return '🔧 目录为空'
    }
    const lines = entries.map(e => {
      const type = e.is_dir ? '📁' : '📄'
      const size = e.is_dir ? '' : ` (${formatFileSize(e.size)})`
      return `${type} ${e.name}${size}`
    })
    return `🔧 目录内容（${entries.length} 项）：\n${lines.join('\n')}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `❌ 列出目录失败：${msg}`
  }
}

/** 搜索文件 */
export async function toolSearchFiles(params: Record<string, unknown>): Promise<string> {
  const pattern = String(params.pattern ?? '').trim()
  const dirPath = String(params.path ?? '.').trim()
  if (!pattern) {
    return '❌ 未指定搜索模式'
  }
  try {
    const results = await invoke<string[]>('search_files', { path: dirPath, pattern })
    if (!results || results.length === 0) {
      return `🔧 未找到匹配「${pattern}」的文件`
    }
    const lines = results.slice(0, 20).map((r, i) => `${i + 1}. ${r}`)
    const extra = results.length > 20 ? `\n... 共 ${results.length} 项，仅显示前 20 项` : ''
    return `🔧 搜索结果（${results.length} 项）：\n${lines.join('\n')}${extra}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `❌ 搜索文件失败：${msg}`
  }
}

/** 写入文件（需用户确认） */
export async function toolWriteFile(params: Record<string, unknown>): Promise<string> {
  const filePath = String(params.path ?? '').trim()
  const content = String(params.content ?? '').trim()
  if (!filePath) {
    return '❌ 未指定文件路径'
  }
  if (!content) {
    return '❌ 未指定写入内容'
  }
  try {
    await invoke('write_file', { path: filePath, content })
    return `🔧 已写入文件：${filePath}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `❌ 写入文件失败：${msg}`
  }
}

/** 执行命令（需用户确认） */
export async function toolExecuteCommand(params: Record<string, unknown>): Promise<string> {
  const command = String(params.command ?? '').trim()
  if (!command) {
    return '❌ 未指定要执行的命令'
  }
  // 安全检查：拒绝危险命令
  const DANGEROUS_COMMANDS = /rm\s+-rf|del\s+\/[sfq]|format\s+[a-z]:|shutdown|reboot/i
  if (DANGEROUS_COMMANDS.test(command)) {
    return `❌ 拒绝执行危险命令：${command}`
  }
  try {
    const output = await invoke<string>('execute_command', { command })
    if (!output || output.trim().length === 0) {
      return `🔧 命令执行成功（无输出）：${command}`
    }
    // 截断过长输出
    const truncated = output.length > 5000
      ? output.substring(0, 5000) + '\n... (输出过长，已截断)'
      : output
    return `🔧 命令输出：\n${truncated}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `❌ 执行命令失败：${msg}`
  }
}

/** 格式化文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

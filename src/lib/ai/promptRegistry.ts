/**
 * Prompt 版本注册表 — 集中管理所有 System Prompt + 版本化
 *
 * @fileoverview
 * MLOps 评估报告 P1 差距：Prompt 无版本管理，散落在 7+ 文件中。
 *
 * 本模块将所有 System Prompt 集中到一处，每个 Prompt 带版本号 + 变更日志 + 元数据。
 * 修改 Prompt 时只需修改本文件并递增版本号，Git diff 即为完整的 Prompt 变更记录。
 *
 * 使用方式：
 * 1. 原文件中引用 promptRegistry.get('agent.intent') 替代硬编码字符串
 * 2. 修改 Prompt 时修改本文件中的定义 + 递增 version
 * 3. 运行时通过 getActivePromptVersion() 获取当前生效版本
 *
 * @module promptRegistry
 */

// ============ 类型定义 ============

export interface PromptDefinition {
  /** 唯一键名（点分语义，如 'agent.intent'） */
  key: string
  /** Prompt 内容 */
  content: string
  /** 版本号（每次修改递增） */
  version: number
  /** 变更说明 */
  changeLog: string
  /** 最后修改日期 */
  lastModified: string
}

// ============ Prompt 注册表 ============

/**
 * 所有 System Prompt 的集中定义
 *
 * 命名规范：模块名.语义名（如 agent.intent / llm.emotion_select / memory.summarize）
 */
const PROMPT_REGISTRY: Record<string, PromptDefinition> = {
  // ============ Agent 意图解析 ============
  'agent.intent': {
    key: 'agent.intent',
    content: `你是一个 AI Agent 助手。根据用户的消息，选择合适的工具来执行操作。

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

只返回 JSON，不要包含其他文本。`,
    version: 1,
    changeLog: '从 aiAgent.ts 迁移，初始版本',
    lastModified: '2026-08-26',
  },

  // ============ ReAct 循环 ============
  'agent.react': {
    key: 'agent.react',
    content: `你是一个使用 ReAct（Reasoning + Acting）模式的 AI Agent。

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
- 不要重复执行相同的操作`,
    version: 1,
    changeLog: '从 aiAgent.ts 迁移，初始版本',
    lastModified: '2026-08-26',
  },

  // ============ LLM 情绪选择 ============
  'llm.emotion_select': {
    key: 'llm.emotion_select',
    content: `你是一个桌面宠物的情绪选择器。根据当前上下文，从可用表情列表中选择最合适的一个表情。
只返回表情 ID，不要包含其他文本。

可用表情：{available_expressions}`,
    version: 1,
    changeLog: '从 llmClient.ts 迁移，初始版本',
    lastModified: '2026-08-26',
  },

  // ============ LLM 记忆提取 ============
  'llm.memory_extract': {
    key: 'llm.memory_extract',
    content: `你是一个记忆提取器。从给定的对话上下文中，提取值得长期记忆的信息。
包括：用户偏好、重要事件、情感表达、习惯模式、人际关系等。
返回 JSON 数组格式，每个元素是一条值得记忆的信息。
如果没有值得记忆的信息，返回空数组 []。
只返回 JSON，不要包含其他文本。`,
    version: 1,
    changeLog: '从 llmClient.ts 迁移，初始版本',
    lastModified: '2026-08-26',
  },

  // ============ 角色生成 ============
  'llm.character_generate': {
    key: 'llm.character_generate',
    content: `根据用户描述，生成一个宠物角色配置。返回 JSON 格式，包含 name, personality (五维参数), systemPrompt, catchphrase, background 字段。

要求：
1. name: 角色名称（简洁，2-4字）
2. personality: 五维性格参数，每个值为 -1 到 1 之间的小数
   - warmth: 温度（-1=冷漠, 1=温暖）
   - liveliness: 活泼（-1=沉静, 1=活泼）
   - dependence: 依赖（-1=独立, 1=粘人）
   - directness: 直率（-1=含蓄, 1=直率）
   - rationality: 理性（-1=感性, 1=理性）
3. systemPrompt: 角色的 LLM System Prompt，详细描述角色性格、说话方式、背景故事
4. catchphrase: 角色口头禅
5. background: 角色背景故事（1-2句话）

请严格按照 JSON 格式返回，不要包含其他文本。JSON 格式示例：
{
  "name": "小喵",
  "personality": { "warmth": 0.8, "liveliness": 0.6, "dependence": 0.7, "directness": -0.2, "rationality": -0.3 },
  "systemPrompt": "你是小喵...",
  "catchphrase": "喵～",
  "background": "一只来自..."
}`,
    version: 1,
    changeLog: '从 llmClient.ts CHARACTER_GEN_SYSTEM_PROMPT 迁移，初始版本',
    lastModified: '2026-08-26',
  },

  // ============ 记忆总结 ============
  'memory.summarize': {
    key: 'memory.summarize',
    content: `你是一个专业的记忆总结助手。请根据以下对话记录生成简洁、全面的摘要。

要求：
1. 抓住核心主题和关键对话
2. 突出重要事件和情感变化
3. 保持客观中立，不添加个人判断
4. 输出字数控制在{max_tokens} token 以内
5. 使用{style}风格`,
    version: 1,
    changeLog: '从 memorySummarizer.ts 迁移，支持 {max_tokens} 和 {style} 占位符',
    lastModified: '2026-08-26',
  },

  // ============ 主动说话 ============
  'proactive.speak': {
    key: 'proactive.speak',
    content: `你是 SpiritPal 桌面宠物，现在要主动对主人说一句话。
要求：
1. 符合你的角色设定和性格
2. 自然、温暖、不过于刻意
3. 控制在 30 字以内
4. 可以是问候、关心、分享、撒娇等
5. 不要重复之前说过的话
请直接输出要说的内容，不要加引号或其他标记。`,
    version: 1,
    changeLog: '从 proactiveSpeak.ts 迁移，初始版本',
    lastModified: '2026-08-26',
  },

  // ============ 性格分析 ============
  'character.analyze_personality': {
    key: 'character.analyze_personality',
    content: `你是一个性格分析器。根据给定的角色描述，推断角色的五维性格参数。
返回 JSON 格式：{ "warmth": N, "liveliness": N, "dependence": N, "directness": N, "rationality": N }
每个值在 -1 到 1 之间。只返回 JSON，不要包含其他文本。`,
    version: 1,
    changeLog: '从 characterCardImporter.ts 迁移，初始版本',
    lastModified: '2026-08-26',
  },

  // ============ 视觉分析 ============
  'vision.analyze_screen': {
    key: 'vision.analyze_screen',
    content: `你是一位桌面环境视觉分析师。请分析用户当前的屏幕截图，提取以下信息：
1. 用户正在使用的应用程序
2. 窗口标题和内容概述
3. 是否有代码编辑、会议、游戏等活动
4. 关键文本信息（如有重要内容）
5. 整体工作氛围（专注/放松/紧急等）

基于分析结果，给出宠物应该采取的行为建议（如显示idle、walk、hide、happy等）。`,
    version: 1,
    changeLog: '从 visionPerception.ts 迁移，初始版本',
    lastModified: '2026-08-26',
  },
}

// ============ API ============

/**
 * 获取指定 Prompt 的内容
 * @param key Prompt 键名（如 'agent.intent'）
 * @returns Prompt 内容字符串
 */
export function getPrompt(key: string): string {
  const def = PROMPT_REGISTRY[key]
  if (!def) {
    console.warn(`[PromptRegistry] Prompt key not found: ${key}`)
    return ''
  }
  return def.content
}

/**
 * 获取指定 Prompt 的完整定义（含版本号等元数据）
 * @param key Prompt 键名
 * @returns PromptDefinition 或 undefined
 */
export function getPromptDefinition(key: string): PromptDefinition | undefined {
  return PROMPT_REGISTRY[key]
}

/**
 * 获取所有已注册 Prompt 的版本信息
 * @returns 键名 → 版本号 的映射
 */
export function getAllPromptVersions(): Record<string, number> {
  const versions: Record<string, number> = {}
  for (const [key, def] of Object.entries(PROMPT_REGISTRY)) {
    versions[key] = def.version
  }
  return versions
}

/**
 * 获取所有 Prompt 的摘要（用于诊断/调试）
 */
export function getPromptRegistrySummary(): Array<{ key: string; version: number; lastModified: string; changeLog: string }> {
  return Object.values(PROMPT_REGISTRY).map((def) => ({
    key: def.key,
    version: def.version,
    lastModified: def.lastModified,
    changeLog: def.changeLog,
  }))
}

/**
 * 检查所有 Prompt 的完整性
 * @returns 缺失或空的 Prompt 列表
 */
export function validatePromptRegistry(): string[] {
  const issues: string[] = []
  for (const [key, def] of Object.entries(PROMPT_REGISTRY)) {
    if (!def.content || def.content.trim().length === 0) {
      issues.push(`${key}: empty content`)
    }
    if (def.version < 1) {
      issues.push(`${key}: invalid version ${def.version}`)
    }
  }
  return issues
}

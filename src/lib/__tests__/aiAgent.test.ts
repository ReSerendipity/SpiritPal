// aiAgent 单元测试 — 工具定义、意图检测、规则回退、LLM 意图解析、所有工具 execute
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'

// ============ Mock 依赖模块 ============
// 使用 vi.hoisted 确保 mock 对象在 vi.mock 工厂执行前可用
const mocks = vi.hoisted(() => ({
  schedMgr: {
    addFromChat: vi.fn(),
    getPendingEvents: vi.fn(() => [] as any[]),
    cancelEvent: vi.fn(),
  },
  weatherMgr: {
    getCurrentWeather: vi.fn(() => null as any),
    getWeather: vi.fn(() => Promise.resolve(null as any)),
    start: vi.fn(),
    stop: vi.fn(),
    onWeatherChange: vi.fn(() => () => {}),
  },
  petStoreState: {
    inventory: [] as Array<{ id: string; name: string; type: string }>,
    useItem: vi.fn(),
    play: vi.fn(),
    bathe: vi.fn(),
    pet: vi.fn(),
    sharedCoins: 100,
    getCurrentStats: vi.fn(() => ({
      level: 5,
      exp: 1200,
      hunger: 60,
      mood: 70,
      health: 90,
      affection: 50,
    })),
  },
  llmClient: {
    chatOnce: vi.fn(),
  },
  secureStorage: {
    getApiKey: vi.fn(() => Promise.resolve(null)),
  },
}))

vi.mock('../scheduleManager', () => ({
  getScheduleManager: vi.fn(() => mocks.schedMgr),
}))

vi.mock('../weatherAwareness', () => ({
  getWeatherAwarenessManager: vi.fn(() => mocks.weatherMgr),
}))

vi.mock('../../stores/petStore', () => ({
  usePetStore: {
    getState: () => mocks.petStoreState,
  },
}))

vi.mock('../llmClient', () => ({
  getLLMClient: vi.fn(() => mocks.llmClient),
  DEFAULT_AI_CONFIG: {
    provider: 'openai',
    apiKey: '',
    baseUrl: '',
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 1000,
  },
}))

vi.mock('../secureStorage', () => ({
  getApiKey: mocks.secureStorage.getApiKey,
}))

import { AGENT_TOOLS, detectAgentIntent, processAgentRequest, matchIntent } from '../aiAgent'
import { toolOpenApplication } from '../agentTools'

const EXPECTED_TOOL_NAMES = [
  'open_application',
  'search_web',
  'set_reminder',
  'manage_schedule',
  'adjust_pet_state',
  'get_weather',
  'get_pet_status',
]

describe('AGENT_TOOLS', () => {
  it('包含 7 个工具定义', () => {
    expect(AGENT_TOOLS).toHaveLength(7)
  })

  it('工具名唯一且符合预期', () => {
    const names = AGENT_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(names).toContain(name)
    }
  })

  it('每个工具有完整的 name/description/parameters/execute', () => {
    for (const tool of AGENT_TOOLS) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(typeof tool.parameters).toBe('object')
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('open_application 有 app_name 必填参数', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'open_application')!
    expect(tool.parameters.app_name).toBeDefined()
    expect(tool.parameters.app_name.required).toBe(true)
  })

  it('search_web 有 query 必填参数', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'search_web')!
    expect(tool.parameters.query).toBeDefined()
    expect(tool.parameters.query.required).toBe(true)
  })

  it('get_weather / get_pet_status 无参数', () => {
    const weather = AGENT_TOOLS.find((t) => t.name === 'get_weather')!
    const status = AGENT_TOOLS.find((t) => t.name === 'get_pet_status')!
    expect(Object.keys(weather.parameters)).toHaveLength(0)
    expect(Object.keys(status.parameters)).toHaveLength(0)
  })
})

describe('detectAgentIntent', () => {
  it('打开应用类消息识别为 Agent 意图', () => {
    expect(detectAgentIntent('帮我打开计算器')).toBe(true)
    expect(detectAgentIntent('启动记事本')).toBe(true)
    expect(detectAgentIntent('open notepad')).toBe(true)
  })

  it('搜索类消息识别为 Agent 意图', () => {
    expect(detectAgentIntent('帮我搜索天气')).toBe(true)
    expect(detectAgentIntent('查一下附近的餐厅')).toBe(true)
  })

  it('提醒类消息识别为 Agent 意图', () => {
    expect(detectAgentIntent('明天9点提醒我开会')).toBe(true)
    expect(detectAgentIntent('30分钟后提醒我喝水')).toBe(true)
  })

  it('天气类消息识别为 Agent 意图', () => {
    expect(detectAgentIntent('今天天气怎么样')).toBe(true)
    expect(detectAgentIntent('外面下雨吗')).toBe(true)
  })

  it('宠物状态类消息识别为 Agent 意图', () => {
    expect(detectAgentIntent('宠物状态如何')).toBe(true)
    expect(detectAgentIntent('饱食度多少了')).toBe(true)
  })

  it('宠物操作类消息识别为 Agent 意图', () => {
    expect(detectAgentIntent('喂一下宠物')).toBe(true)
    expect(detectAgentIntent('摸摸头')).toBe(true)
  })

  it('日程类消息识别为 Agent 意图', () => {
    expect(detectAgentIntent('查看日程')).toBe(true)
    expect(detectAgentIntent('有什么安排')).toBe(true)
  })

  it('普通对话不识别为 Agent 意图', () => {
    expect(detectAgentIntent('你好呀')).toBe(false)
    expect(detectAgentIntent('今天心情怎么样')).toBe(false)
    expect(detectAgentIntent('给我讲个故事')).toBe(false)
  })
})

// ============ 工具 execute 函数测试 ============

describe('工具 execute 函数', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.clearAllMocks()
  })

  // --- open_application ---

  it('open_application 未指定名称返回错误提示', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'open_application')!
    const result = await tool.execute({})
    expect(result).toContain('未指定')
  })

  it('open_application 调用 invoke 打开应用', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const tool = AGENT_TOOLS.find((t) => t.name === 'open_application')!
    const result = await tool.execute({ app_name: '计算器' })
    expect(result).toContain('打开')
    expect(invoke).toHaveBeenCalled()
  })

  it('open_application invoke 失败返回错误', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('app not found'))
    const tool = AGENT_TOOLS.find((t) => t.name === 'open_application')!
    const result = await tool.execute({ app_name: '不存在应用' })
    expect(result).toContain('失败')
  })

  it('open_application 中文名称映射到系统命令', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const tool = AGENT_TOOLS.find((t) => t.name === 'open_application')!
    await tool.execute({ app_name: '计算器' })
    expect(invoke).toHaveBeenCalledWith('open_application', { appName: 'calc' })
  })

  it('open_application 英文应用名直接使用', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const tool = AGENT_TOOLS.find((t) => t.name === 'open_application')!
    await tool.execute({ app_name: 'notepad' })
    expect(invoke).toHaveBeenCalledWith('open_application', { appName: 'notepad' })
  })

  // --- search_web ---

  it('search_web 未指定关键词返回错误', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'search_web')!
    const result = await tool.execute({})
    expect(result).toContain('未指定')
  })

  it('search_web 调用 invoke 打开搜索', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const tool = AGENT_TOOLS.find((t) => t.name === 'search_web')!
    const result = await tool.execute({ query: '天气' })
    expect(result).toContain('搜索')
    expect(result).toContain('天气')
  })

  it('search_web invoke 失败返回错误', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('network error'))
    const tool = AGENT_TOOLS.find((t) => t.name === 'search_web')!
    const result = await tool.execute({ query: 'test' })
    expect(result).toContain('失败')
  })

  // --- manage_schedule ---

  it('manage_schedule list 空日程返回提示', async () => {
    mocks.schedMgr.getPendingEvents.mockReturnValue([])
    const tool = AGENT_TOOLS.find((t) => t.name === 'manage_schedule')!
    const result = await tool.execute({ action: 'list' })
    expect(result).toContain('没有')
  })

  it('manage_schedule list 返回日程列表', async () => {
    mocks.schedMgr.getPendingEvents.mockReturnValue([
      { id: 'e1', title: '开会', triggerTime: Date.now() + 3600000, status: 'pending' },
      { id: 'e2', title: '吃饭', triggerTime: Date.now() + 7200000, status: 'pending' },
    ])
    const tool = AGENT_TOOLS.find((t) => t.name === 'manage_schedule')!
    const result = await tool.execute({ action: 'list' })
    expect(result).toContain('开会')
    expect(result).toContain('吃饭')
    expect(result).toContain('2')
  })

  it('manage_schedule cancel 按标题匹配成功', async () => {
    mocks.schedMgr.getPendingEvents.mockReturnValue([
      { id: 'e1', title: '开会讨论', triggerTime: Date.now() + 3600000, status: 'pending' },
    ])
    const tool = AGENT_TOOLS.find((t) => t.name === 'manage_schedule')!
    const result = await tool.execute({ action: 'cancel', title: '开会' })
    expect(result).toContain('已取消')
    expect(mocks.schedMgr.cancelEvent).toHaveBeenCalledWith('e1')
  })

  it('manage_schedule cancel 标题无匹配返回错误', async () => {
    mocks.schedMgr.getPendingEvents.mockReturnValue([
      { id: 'e1', title: '开会', triggerTime: Date.now() + 3600000, status: 'pending' },
    ])
    const tool = AGENT_TOOLS.find((t) => t.name === 'manage_schedule')!
    const result = await tool.execute({ action: 'cancel', title: '不存在' })
    expect(result).toContain('未找到')
  })

  it('manage_schedule cancel 未指定标题返回错误', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'manage_schedule')!
    const result = await tool.execute({ action: 'cancel' })
    expect(result).toContain('请指定')
  })

  it('manage_schedule 中文 action 查看', async () => {
    mocks.schedMgr.getPendingEvents.mockReturnValue([])
    const tool = AGENT_TOOLS.find((t) => t.name === 'manage_schedule')!
    const result = await tool.execute({ action: '查看' })
    expect(result).toContain('没有')
  })

  it('manage_schedule 中文 action 删除', async () => {
    mocks.schedMgr.getPendingEvents.mockReturnValue([
      { id: 'e1', title: '测试日程', triggerTime: Date.now() + 3600000, status: 'pending' },
    ])
    const tool = AGENT_TOOLS.find((t) => t.name === 'manage_schedule')!
    const result = await tool.execute({ action: '删除', title: '测试' })
    expect(result).toContain('已取消')
  })

  it('manage_schedule 未知 action 返回提示', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'manage_schedule')!
    const result = await tool.execute({ action: 'unknown' })
    expect(result).toContain('未知')
  })

  // --- adjust_pet_state ---

  it('adjust_pet_state feed 有食物时喂食成功', async () => {
    mocks.petStoreState.inventory = [{ id: 'food1', name: '猫粮', type: 'food' }]
    mocks.petStoreState.useItem = vi.fn()
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: 'feed' })
    expect(result).toContain('喂食')
    expect(result).toContain('猫粮')
    expect(mocks.petStoreState.useItem).toHaveBeenCalledWith('food1')
  })

  it('adjust_pet_state feed 无食物时提示购买', async () => {
    mocks.petStoreState.inventory = []
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: 'feed' })
    expect(result).toContain('没有食物')
  })

  it('adjust_pet_state play 玩耍', async () => {
    mocks.petStoreState.play = vi.fn()
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: 'play' })
    expect(result).toContain('玩耍')
    expect(mocks.petStoreState.play).toHaveBeenCalled()
  })

  it('adjust_pet_state bathe 洗澡', async () => {
    mocks.petStoreState.bathe = vi.fn()
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: 'bathe' })
    expect(result).toContain('洗了个澡')
    expect(mocks.petStoreState.bathe).toHaveBeenCalled()
  })

  it('adjust_pet_state pet 摸头', async () => {
    mocks.petStoreState.pet = vi.fn()
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: 'pet' })
    expect(result).toContain('摸')
    expect(mocks.petStoreState.pet).toHaveBeenCalled()
  })

  it('adjust_pet_state sleep 睡觉', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: 'sleep' })
    expect(result).toContain('休息')
  })

  it('adjust_pet_state 中文 action 喂食', async () => {
    mocks.petStoreState.inventory = [{ id: 'f1', name: '鱼', type: 'food' }]
    mocks.petStoreState.useItem = vi.fn()
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: '喂食' })
    expect(result).toContain('喂食')
  })

  it('adjust_pet_state 中文 action 玩耍', async () => {
    mocks.petStoreState.play = vi.fn()
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: '玩耍' })
    expect(result).toContain('玩耍')
  })

  it('adjust_pet_state 中文 action 洗澡', async () => {
    mocks.petStoreState.bathe = vi.fn()
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: '洗澡' })
    expect(result).toContain('洗了个澡')
  })

  it('adjust_pet_state 中文 action 摸头', async () => {
    mocks.petStoreState.pet = vi.fn()
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: '摸头' })
    expect(result).toContain('摸')
  })

  it('adjust_pet_state 中文 action 睡觉', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: '睡觉' })
    expect(result).toContain('休息')
  })

  it('adjust_pet_state 未知 action 返回提示', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'adjust_pet_state')!
    const result = await tool.execute({ action: 'unknown' })
    expect(result).toContain('未知')
  })

  // --- get_weather ---

  it('get_weather 有缓存天气时返回', async () => {
    mocks.weatherMgr.getCurrentWeather.mockReturnValue({
      description: '晴朗',
      temperature: 25,
    })
    const tool = AGENT_TOOLS.find((t) => t.name === 'get_weather')!
    const result = await tool.execute({})
    expect(result).toContain('晴朗')
    expect(result).toContain('25')
  })

  it('get_weather 无缓存时 fetch 天气', async () => {
    mocks.weatherMgr.getCurrentWeather.mockReturnValue(null)
    mocks.weatherMgr.getWeather.mockResolvedValue({
      description: '多云',
      temperature: 18,
    })
    const tool = AGENT_TOOLS.find((t) => t.name === 'get_weather')!
    const result = await tool.execute({})
    expect(result).toContain('多云')
    expect(result).toContain('18')
  })

  it('get_weather 无法获取时返回提示', async () => {
    mocks.weatherMgr.getCurrentWeather.mockReturnValue(null)
    mocks.weatherMgr.getWeather.mockResolvedValue(null)
    const tool = AGENT_TOOLS.find((t) => t.name === 'get_weather')!
    const result = await tool.execute({})
    expect(result).toContain('无法获取')
  })

  // --- get_pet_status ---

  it('get_pet_status 返回宠物状态', async () => {
    mocks.petStoreState.getCurrentStats = vi.fn(() => ({
      level: 10,
      exp: 5000,
      hunger: 80,
      mood: 90,
      health: 100,
      affection: 200,
    }))
    mocks.petStoreState.sharedCoins = 500
    const tool = AGENT_TOOLS.find((t) => t.name === 'get_pet_status')!
    const result = await tool.execute({})
    expect(result).toContain('Lv.10')
    expect(result).toContain('80')
    expect(result).toContain('90')
    expect(result).toContain('200')
    expect(result).toContain('500')
  })

  it('get_pet_status 低心情返回难过', async () => {
    mocks.petStoreState.getCurrentStats = vi.fn(() => ({
      level: 1,
      exp: 0,
      hunger: 10,
      mood: 10,
      health: 50,
      affection: 0,
    }))
    const tool = AGENT_TOOLS.find((t) => t.name === 'get_pet_status')!
    const result = await tool.execute({})
    expect(result).toContain('难过')
    expect(result).toContain('很饿')
  })
})

// ============ processAgentRequest 测试 ============

describe('processAgentRequest（规则回退）', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.clearAllMocks()
    localStorage.clear()
    mocks.secureStorage.getApiKey.mockResolvedValue(null)
  })

  it('打开应用消息走规则回退', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const result = await processAgentRequest('帮我打开计算器')
    expect(result).toContain('打开')
    expect(invoke).toHaveBeenCalled()
  })

  it('搜索消息走规则回退', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const result = await processAgentRequest('搜索猫咪图片')
    expect(result).toContain('搜索')
  })

  it('无法识别的消息返回未识别提示', async () => {
    const result = await processAgentRequest('给我讲个故事吧')
    expect(result).toContain('未识别')
  })

  it('天气消息走规则回退返回天气', async () => {
    mocks.weatherMgr.getCurrentWeather.mockReturnValue({
      description: '晴',
      temperature: 30,
    })
    const result = await processAgentRequest('今天天气怎么样')
    expect(result).toContain('晴')
  })

  it('宠物状态消息走规则回退', async () => {
    mocks.petStoreState.getCurrentStats = vi.fn(() => ({
      level: 3,
      exp: 200,
      hunger: 50,
      mood: 60,
      health: 80,
      affection: 10,
    }))
    const result = await processAgentRequest('宠物状态如何')
    expect(result).toContain('Lv.3')
  })

  it('喂食消息走规则回退', async () => {
    mocks.petStoreState.inventory = [{ id: 'f1', name: '猫粮', type: 'food' }]
    mocks.petStoreState.useItem = vi.fn()
    const result = await processAgentRequest('喂一下宠物')
    expect(result).toContain('喂食')
  })

  it('查看日程消息走规则回退', async () => {
    mocks.schedMgr.getPendingEvents.mockReturnValue([])
    const result = await processAgentRequest('查看日程')
    expect(result).toContain('没有')
  })

  it('设置提醒消息走规则回退', async () => {
    mocks.schedMgr.addFromChat.mockReturnValue({
      id: 's1',
      title: '喝水',
      triggerTime: Date.now() + 1800000,
      status: 'pending',
    })
    const result = await processAgentRequest('30分钟后提醒我喝水')
    expect(result).toContain('提醒')
  })

  it('设置提醒无法解析时间时返回提示', async () => {
    mocks.schedMgr.addFromChat.mockReturnValue(null)
    const result = await processAgentRequest('提醒我开会')
    expect(result).toContain('无法')
  })
})

describe('processAgentRequest（LLM 意图解析）', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.clearAllMocks()
    localStorage.clear()
    mocks.llmClient.chatOnce.mockReset()
  })

  it('LLM 返回 open_application 工具调用', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    mocks.llmClient.chatOnce.mockResolvedValue(
      JSON.stringify({ tool: 'open_application', params: { app_name: 'calc' } }),
    )
    const config = { provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('打开计算器', config)
    expect(result).toContain('打开')
    expect(invoke).toHaveBeenCalledWith('open_application', { appName: 'calc' })
  })

  it('LLM 返回 search_web 工具调用', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    mocks.llmClient.chatOnce.mockResolvedValue(
      JSON.stringify({ tool: 'search_web', params: { query: 'cats' } }),
    )
    const config = { provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('搜索cats', config)
    expect(result).toContain('搜索')
  })

  it('LLM 返回 none 时不执行工具', async () => {
    mocks.llmClient.chatOnce.mockResolvedValue(
      JSON.stringify({ tool: 'none', params: {} }),
    )
    const config = { provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('你好', config)
    // none 时回退到规则，规则也识别不到 → 未识别
    expect(result).toContain('未识别')
  })

  it('LLM 返回 JSON 代码块时正确解析', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const jsonContent = JSON.stringify({ tool: 'open_application', params: { app_name: 'notepad' } })
    mocks.llmClient.chatOnce.mockResolvedValue(`\`\`\`json\n${jsonContent}\n\`\`\``)
    const config = { provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('打开记事本', config)
    expect(result).toContain('打开')
  })

  it('LLM 返回非 JSON 时回退到规则', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    mocks.llmClient.chatOnce.mockResolvedValue('I cannot help with that.')
    const config = { provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('打开计算器', config)
    // LLM 解析失败 → 回退规则 → 识别到 open_application
    expect(result).toContain('打开')
  })

  it('LLM 调用失败时回退到规则', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    mocks.llmClient.chatOnce.mockRejectedValue(new Error('API error'))
    const config = { provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('打开计算器', config)
    expect(result).toContain('打开')
  })

  it('LLM 返回未知工具时回退到规则匹配', async () => {
    // 白名单校验：未知工具名应记录警告并回退到规则匹配
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.llmClient.chatOnce.mockResolvedValue(
      JSON.stringify({ tool: 'unknown_tool', params: {} }),
    )
    const config = { provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('do something', config)
    // 应记录未知工具警告
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('未知工具名'))
    // 规则匹配也失败时返回未识别提示
    expect(result).toContain('未识别到需要执行的操作')
    warnSpy.mockRestore()
  })

  it('LLM 返回 get_pet_status 工具调用', async () => {
    mocks.petStoreState.getCurrentStats = vi.fn(() => ({
      level: 7,
      exp: 3000,
      hunger: 65,
      mood: 75,
      health: 95,
      affection: 100,
    }))
    mocks.petStoreState.sharedCoins = 250
    mocks.llmClient.chatOnce.mockResolvedValue(
      JSON.stringify({ tool: 'get_pet_status', params: {} }),
    )
    const config = { provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('宠物状态', config)
    expect(result).toContain('Lv.7')
  })

  it('LLM 返回 set_reminder 工具调用', async () => {
    mocks.schedMgr.addFromChat.mockReturnValue({
      id: 's1',
      title: '开会',
      triggerTime: Date.now() + 3600000,
      status: 'pending',
    })
    mocks.llmClient.chatOnce.mockResolvedValue(
      JSON.stringify({ tool: 'set_reminder', params: { message: '明天9点提醒我开会' } }),
    )
    const config = { provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('明天9点提醒我开会', config)
    expect(result).toContain('提醒')
  })

  it('Ollama provider 无 apiKey 时也调用 LLM', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    mocks.llmClient.chatOnce.mockResolvedValue(
      JSON.stringify({ tool: 'open_application', params: { app_name: 'calc' } }),
    )
    const config = { provider: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('打开计算器', config)
    expect(mocks.llmClient.chatOnce).toHaveBeenCalled()
    expect(result).toContain('打开')
  })

  it('工具执行抛错时返回错误提示', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('invoke failed'))
    mocks.llmClient.chatOnce.mockResolvedValue(
      JSON.stringify({ tool: 'open_application', params: { app_name: 'calc' } }),
    )
    const config = { provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4', temperature: 0.7, maxTokens: 1000 }
    const result = await processAgentRequest('打开计算器', config)
    // open_application 工具内部 catch 了错误，返回错误提示字符串
    expect(result).toContain('失败')
  })
})

describe('matchIntent', () => {
  it('中文关键词「打开计算器」匹配 open_application', () => {
    expect(matchIntent('打开计算器')).toBe('open_application')
  })

  it('英文关键词「open calc」匹配 open_application', () => {
    expect(matchIntent('open calc')).toBe('open_application')
  })

  it('搜索意图「搜索天气」匹配 search_web', () => {
    expect(matchIntent('搜索天气')).toBe('search_web')
  })

  it('无匹配「你好」返回 null', () => {
    expect(matchIntent('你好')).toBeNull()
  })

  it('优先级「喂食」匹配 adjust_pet_state（而非 open_application）', () => {
    expect(matchIntent('喂食')).toBe('adjust_pet_state')
  })

  it('天气意图「今天天气怎么样」匹配 get_weather', () => {
    expect(matchIntent('今天天气怎么样')).toBe('get_weather')
  })

  it('日程意图「查看日程」匹配 manage_schedule', () => {
    expect(matchIntent('查看日程')).toBe('manage_schedule')
  })
})

describe('toolOpenApplication - shell 元字符校验', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('拒绝空字节注入', async () => {
    const result = await toolOpenApplication({ app_name: 'calc\x00&del /f' })
    expect(result).toContain('非法字符')
  })

  it('拒绝制表符注入', async () => {
    const result = await toolOpenApplication({ app_name: 'calc\t&whoami' })
    expect(result).toContain('非法字符')
  })

  it('正常 URL 不返回非法字符错误', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const result = await toolOpenApplication({ app_name: 'https://www.bing.com' })
    expect(result).not.toContain('非法字符')
  })

  it('正常应用名不返回非法字符错误', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const result = await toolOpenApplication({ app_name: 'calc' })
    expect(result).not.toContain('非法字符')
  })

  it('空名称返回未指定错误', async () => {
    const result = await toolOpenApplication({ app_name: '' })
    expect(result).toContain('未指定')
  })
})

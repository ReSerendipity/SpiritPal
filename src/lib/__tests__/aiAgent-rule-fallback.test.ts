// aiAgent 测试（拆分自 aiAgent.test.ts，审计 P1-6 God Test 拆分）
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

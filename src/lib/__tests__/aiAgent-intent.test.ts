// aiAgent 测试（拆分自 aiAgent.test.ts，审计 P1-6 God Test 拆分）
import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

vi.mock('@/lib/nurture/scheduleManager', () => ({
  getScheduleManager: vi.fn(() => mocks.schedMgr),
}))

vi.mock('@/lib/system/weatherAwareness', () => ({
  getWeatherAwarenessManager: vi.fn(() => mocks.weatherMgr),
}))

vi.mock('@/stores/petStore', () => ({
  usePetStore: {
    getState: () => mocks.petStoreState,
  },
}))

vi.mock('@/lib/ai/llmClient', () => ({
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

vi.mock('@/lib/data/secureStorage', () => ({
  getApiKey: mocks.secureStorage.getApiKey,
}))

import { toolOpenApplication } from '@/lib/ai/agentTools'
import { AGENT_TOOLS, detectAgentIntent, detectMultiStepIntent, processAgentRequest, matchIntent } from '@/lib/ai/aiAgent'

const EXPECTED_TOOL_NAMES = [
  'open_application',
  'search_web',
  'set_reminder',
  'manage_schedule',
  'adjust_pet_state',
  'get_weather',
  'get_pet_status',
]

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

describe('detectMultiStepIntent（多步任务检测）', () => {
  it('检测「先...再...」多步模式', () => {
    expect(detectMultiStepIntent('先查一下天气再设置提醒')).toBe(true)
  })

  it('检测「先...然后...」多步模式', () => {
    expect(detectMultiStepIntent('先打开计算器然后帮我算一下')).toBe(true)
  })

  it('检测「搜索...然后...」多步模式', () => {
    expect(detectMultiStepIntent('搜索猫咪图片然后设置为壁纸')).toBe(true)
  })

  it('单步请求返回 false', () => {
    expect(detectMultiStepIntent('打开计算器')).toBe(false)
  })

  it('普通聊天返回 false', () => {
    expect(detectMultiStepIntent('你好呀')).toBe(false)
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

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

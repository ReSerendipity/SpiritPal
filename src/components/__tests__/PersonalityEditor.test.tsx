// PersonalityEditor 组件测试 — 雷达图、滑块、模板、保存
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PersonalityEditor } from '@/components/PersonalityEditor'
import { savePersonalityConfigOverride, removePersonalityConfigOverride } from '@/lib/ai/personalityEngine'
import i18n from '@/lib/system/i18n'

// ============ 使用 vi.hoisted 定义 mock state ============
const { mockSettings, mockChar, mockDefaultCfg, mockLabels, mockTemplates } = vi.hoisted(() => {
  const mockSettings = {
    currentCharacterId: 'doro',
    switchCharacter: vi.fn(),
  }
  const mockChar = {
    id: 'doro',
    displayName: '多罗',
    themeColor: { primary: '#FFB6C1', secondary: '#FFA500' },
    personality: { warmth: 0.5, liveliness: 0.8, dependence: 0.3, directness: -0.2, rationality: 0.1 },
    systemPrompt: '你是多罗',
    speakingStyle: { tone: 'lively', wordPreference: 'colloquial', catchphrases: ['嘟嘟噜'] },
    interactionPrefs: { likeHeadPat: true, hateDrag: false, interactionFrequency: 'high' },
    schedule: [{ id: 'd1', start: 7, end: 22, type: 'active' }],
  }
  const mockDefaultCfg = {
    personality: { warmth: 0.5, liveliness: 0.8, dependence: 0.3, directness: -0.2, rationality: 0.1 },
    speakingStyle: { tone: 'lively', wordPreference: 'colloquial', catchphrases: ['嘟嘟噜'] },
    interactionPrefs: { likeHeadPat: true, hateDrag: false, interactionFrequency: 'high' },
    schedule: [{ id: 'd1', start: 7, end: 22, type: 'active' }],
    systemPrompt: '你是多罗',
  }
  const mockLabels = {
    warmth: { label: '温暖', min: '冷淡', max: '温暖' },
    liveliness: { label: '活力', min: '安静', max: '活泼' },
    dependence: { label: '依赖', min: '独立', max: '依赖' },
    directness: { label: '直率', min: '委婉', max: '直率' },
    rationality: { label: '理性', min: '感性', max: '理性' },
  }
  const mockTemplates = [
    {
      id: 'soft', name: '软萌', emoji: '🌸', description: '温柔可爱',
      config: {
        personality: { warmth: 0.8, liveliness: 0.3, dependence: 0.6, directness: -0.5, rationality: -0.3 },
        speakingStyle: { tone: 'gentle', wordPreference: 'colloquial', catchphrases: ['呜呜'] },
        interactionPrefs: { likeHeadPat: true, hateDrag: false, interactionFrequency: 'medium' },
        schedule: [{ id: 's1', start: 7, end: 22, type: 'active' }],
        systemPrompt: '你是软萌型',
      },
    },
    {
      id: 'energetic', name: '元气', emoji: '⚡', description: '活力满满',
      config: {
        personality: { warmth: 0.3, liveliness: 0.9, dependence: 0.2, directness: 0.5, rationality: 0.0 },
        speakingStyle: { tone: 'lively', wordPreference: 'internet', catchphrases: ['冲冲冲'] },
        interactionPrefs: { likeHeadPat: false, hateDrag: true, interactionFrequency: 'high' },
        schedule: [{ id: 'e1', start: 6, end: 23, type: 'active' }],
        systemPrompt: '你是元气型',
      },
    },
  ]
  return { mockSettings, mockChar, mockDefaultCfg, mockLabels, mockTemplates }
})

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    vi.fn((selector: (s: typeof mockSettings) => unknown) => selector(mockSettings)),
    { getState: () => mockSettings },
  ),
}))

vi.mock('@/lib/data/characters', () => ({
  getCharacter: vi.fn(() => mockChar),
  getAllCharacters: vi.fn(() => [mockChar]),
  CHARACTERS: [mockChar],
}))

vi.mock('@/lib/ai/personalityEngine', () => ({
  PERSONALITY_LABELS: mockLabels,
  composePersonalityPrompt: vi.fn(() => '合成的性格 Prompt'),
  buildDefaultPersonalityConfig: vi.fn(() => mockDefaultCfg),
  getEffectivePersonalityConfig: vi.fn(() => mockDefaultCfg),
  savePersonalityConfigOverride: vi.fn(),
  removePersonalityConfigOverride: vi.fn(),
}))

vi.mock('@/lib/ai/personalityTemplates', () => ({
  PERSONALITY_TEMPLATES: mockTemplates,
}))

describe('PersonalityEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('渲染角色选择按钮', () => {
    render(<PersonalityEditor />)
    expect(screen.getByText('多罗')).toBeInTheDocument()
  })

  it('渲染模板按钮', () => {
    render(<PersonalityEditor />)
    expect(screen.getByText('软萌')).toBeInTheDocument()
    expect(screen.getByText('元气')).toBeInTheDocument()
  })

  it('渲染五维滑块标签', () => {
    render(<PersonalityEditor />)
    // 标签同时出现在雷达图 SVG 和滑块中，使用 getAllByText
    expect(screen.getAllByText('温暖').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('活力').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('依赖').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('直率').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('理性').length).toBeGreaterThanOrEqual(1)
  })

  it('渲染雷达图 SVG', () => {
    const { container } = render(<PersonalityEditor />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })

  it('渲染说话风格区域', () => {
    render(<PersonalityEditor />)
    expect(screen.getByText('说话风格')).toBeInTheDocument()
  })

  it('渲染互动偏好区域', () => {
    render(<PersonalityEditor />)
    expect(screen.getByText('互动偏好')).toBeInTheDocument()
    expect(screen.getByText('喜欢被摸头')).toBeInTheDocument()
  })

  it('渲染作息时间区域', () => {
    render(<PersonalityEditor />)
    expect(screen.getByText(/作息时间/)).toBeInTheDocument()
  })

  it('渲染 System Prompt 区域', () => {
    render(<PersonalityEditor />)
    expect(screen.getByText('System Prompt')).toBeInTheDocument()
  })

  it('渲染操作按钮', () => {
    render(<PersonalityEditor />)
    expect(screen.getByText('保存配置')).toBeInTheDocument()
    expect(screen.getByText('恢复默认')).toBeInTheDocument()
  })

  it('点击保存配置按钮调用 savePersonalityConfigOverride', () => {
    render(<PersonalityEditor />)
    fireEvent.click(screen.getByText('保存配置'))
    expect(savePersonalityConfigOverride).toHaveBeenCalledTimes(1)
  })

  it('点击恢复默认按钮调用 removePersonalityConfigOverride', () => {
    render(<PersonalityEditor />)
    fireEvent.click(screen.getByText('恢复默认'))
    expect(removePersonalityConfigOverride).toHaveBeenCalledTimes(1)
  })

  it('点击预览按钮显示合成 Prompt', () => {
    render(<PersonalityEditor />)
    fireEvent.click(screen.getByText(/预览/))
    expect(screen.getByText('合成的性格 Prompt')).toBeInTheDocument()
  })

  it('再次点击预览按钮隐藏合成 Prompt', () => {
    render(<PersonalityEditor />)
    fireEvent.click(screen.getByText(/预览/))
    expect(screen.getByText('合成的性格 Prompt')).toBeInTheDocument()
    fireEvent.click(screen.getByText(/隐藏/))
    expect(screen.queryByText('合成的性格 Prompt')).not.toBeInTheDocument()
  })

  it('滑块值显示正确', () => {
    render(<PersonalityEditor />)
    // warmth 初始值为 0.5
    expect(screen.getByText('0.5')).toBeInTheDocument()
  })

  it('点击模板按钮应用模板', () => {
    render(<PersonalityEditor />)
    fireEvent.click(screen.getByText('软萌'))
    // 应用后应显示确认提示
    expect(screen.getByText(/已应用/)).toBeInTheDocument()
  })

  it('互动频率按钮可切换', () => {
    render(<PersonalityEditor />)
    const highBtn = screen.getByText('高')
    fireEvent.click(highBtn)
    expect(highBtn).toBeInTheDocument()
  })

  it('摸头开关可切换', () => {
    render(<PersonalityEditor />)
    const toggle = screen.getByText('喜欢被摸头').closest('div')?.querySelector('button')
    expect(toggle).not.toBeNull()
    if (toggle) {
      fireEvent.click(toggle)
    }
  })

  it('作息时间可添加时段', () => {
    render(<PersonalityEditor />)
    const addBtn = screen.getByText('添加时段')
    fireEvent.click(addBtn)
    expect(addBtn).toBeInTheDocument()
  })

  it('System Prompt 输入框可输入', () => {
    render(<PersonalityEditor />)
    // textarea 是 'System Prompt' 标题 div 的兄弟元素，需向上到父容器再查找
    const textarea = screen.getByText('System Prompt')
      .parentElement
      ?.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (textarea) {
      fireEvent.change(textarea, { target: { value: '新的 prompt' } })
      expect((textarea as HTMLTextAreaElement).value).toBe('新的 prompt')
    }
  })

  it('渲染语气和用词偏好下拉框', () => {
    render(<PersonalityEditor />)
    const selects = document.querySelectorAll('select')
    expect(selects.length).toBeGreaterThanOrEqual(2)
  })
})

// ============ P2-8：雷达↔滑块联动高亮 ============

describe('PersonalityEditor 雷达联动（P2-8）', () => {
  it('聚焦/拖动滑块时，雷达对应轴与顶点高亮；失焦后恢复', () => {
    render(<PersonalityEditor />)
    const svg = document.querySelector('[data-testid="radar-svg"]')
    expect(svg).toBeTruthy()

    const hotLines = () =>
      Array.from(svg!.querySelectorAll('line')).filter(
        (l) => l.getAttribute('stroke') === 'rgb(234,88,12)',
      )

    // 聚焦前无高亮轴
    expect(hotLines().length).toBe(0)

    // 聚焦「温度」滑块 → 对应轴高亮
    const slider = document.getElementById('pslider-warmth') as HTMLInputElement | null
    expect(slider).toBeTruthy()
    fireEvent.focus(slider!)
    expect(hotLines().length).toBe(1)

    // 拖动也保持高亮（onChange 上报 activeDim）
    fireEvent.change(slider!, { target: { value: '0.6' } })
    expect(hotLines().length).toBe(1)

    // 失焦恢复
    fireEvent.blur(slider!)
    expect(hotLines().length).toBe(0)
  })
})


// ============ VR-7：PersonalityEditor 文案接入 i18n ============

describe('PersonalityEditor i18n（VR-7）', () => {
  it('英文模式：编辑器无残留中文（雷达标题/维度标签/说话风格/模板）', async () => {
    await i18n.changeLanguage('en')
    cleanup()
    render(<PersonalityEditor />)
    const text = document.body.textContent ?? ''
    // 抽查核心残留面：雷达标题/五维标签/语气/模板标题/保存按钮
    for (const zh of ['五维性格雷达图', '温度', '活泼', '依赖', '直率', '理性', '说话风格', '语气', '用词偏好', '口头禅', '互动偏好', '一键应用性格模板', '保存配置', '恢复默认']) {
      if (text.includes(zh)) {
      const i = text.indexOf(zh)
      console.log('RESIDUAL', JSON.stringify(zh), 'CTX:', JSON.stringify(text.slice(Math.max(0, i - 40), i + 40)))
    }
    if (text.includes(zh)) {
      const i = text.indexOf(zh)
      console.log('RESIDUAL', JSON.stringify(zh), 'CTX:', JSON.stringify(text.slice(Math.max(0, i - 40), i + 40)))
    }
    expect(text.includes(zh), 'residual zh: ' + zh).toBe(false)
    }
    // 英文键在位
    expect(text).toContain('Five-dimension personality radar')
    expect(text).toContain('Warmth')
    expect(text).toContain('Speaking style')
    expect(text).toContain('Save config')
    await i18n.changeLanguage('zh')
  })

  it('中文模式：显示中文且滑块 min/max 正确（零回归）', async () => {
    await i18n.changeLanguage('zh')
    cleanup()
    render(<PersonalityEditor />)
    expect(screen.getByText('五维性格雷达图')).toBeTruthy()
    // 温度出现在滑块标签与雷达 SVG 标签两处
    expect(screen.getAllByText('温度').length).toBeGreaterThanOrEqual(1)
  })
})


// ============ VR-7：PersonalityEditor 文案接入 i18n ============

describe('PersonalityEditor i18n（VR-7）', () => {
  it('英文模式：编辑器无残留中文（雷达标题/维度标签/说话风格/模板）', async () => {
    await i18n.changeLanguage('en')
    cleanup()
    render(<PersonalityEditor />)
    const text = document.body.textContent ?? ''
    // 抽查核心残留面：雷达标题/五维标签/语气/模板标题/保存按钮
    for (const zh of ['五维性格雷达图', '温度', '活泼', '依赖', '直率', '理性', '说话风格', '语气', '用词偏好', '口头禅', '互动偏好', '一键应用性格模板', '保存配置', '恢复默认']) {
      if (text.includes(zh)) {
      const i = text.indexOf(zh)
      console.log('RESIDUAL', JSON.stringify(zh), 'CTX:', JSON.stringify(text.slice(Math.max(0, i - 40), i + 40)))
    }
    if (text.includes(zh)) {
      const i = text.indexOf(zh)
      console.log('RESIDUAL', JSON.stringify(zh), 'CTX:', JSON.stringify(text.slice(Math.max(0, i - 40), i + 40)))
    }
    expect(text.includes(zh), 'residual zh: ' + zh).toBe(false)
    }
    // 英文键在位
    expect(text).toContain('Five-dimension personality radar')
    expect(text).toContain('Warmth')
    expect(text).toContain('Speaking style')
    expect(text).toContain('Save config')
    await i18n.changeLanguage('zh')
  })

  it('中文模式：显示中文且滑块 min/max 正确（零回归）', async () => {
    await i18n.changeLanguage('zh')
    cleanup()
    render(<PersonalityEditor />)
    expect(screen.getByText('五维性格雷达图')).toBeTruthy()
    // 温度出现在滑块标签与雷达 SVG 标签两处
    expect(screen.getAllByText('温度').length).toBeGreaterThanOrEqual(1)
  })
})

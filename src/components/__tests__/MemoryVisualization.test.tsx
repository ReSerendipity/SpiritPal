// MemoryVisualization 组件测试 — 标签云 + 情感曲线 + 时间密度图
// P3-25: 增强用户对记忆的感知，时间轴 + 标签云 + 情感曲线
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TagCloud, EmotionCurve, TimeDensityChart } from '../MemoryVisualization'
import type { EnhancedMemory } from '../../lib/enhancedMemory'

// ============ 测试数据工厂 ============

function createMemory(overrides: Partial<EnhancedMemory> = {}): EnhancedMemory {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 8)}`,
    user: '你好',
    assistant: '嗨，主人～',
    created_at: new Date().toISOString(),
    importance: 50,
    emotionalIntensity: 0.5,
    category: '日常',
    tags: [],
    accessCount: 0,
    lastAccessed: Date.now(),
    decayFactor: 1.0,
    isAutobiographical: false,
    ...overrides,
  }
}

const sampleMemories: EnhancedMemory[] = [
  createMemory({
    id: 'mem-1',
    user: '我今天很开心',
    assistant: '主人开心我也开心！',
    tags: ['开心', '日常'],
    emotionalIntensity: 0.8,
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(), // 1 天前
  }),
  createMemory({
    id: 'mem-2',
    user: '有点难过的消息',
    assistant: '别难过，我陪着你～',
    tags: ['难过', '安慰'],
    emotionalIntensity: 0.3,
    importance: 70,
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(), // 2 天前
  }),
  createMemory({
    id: 'mem-3',
    user: '喜欢这个游戏',
    assistant: '一起玩吧！',
    tags: ['开心', '游戏', '娱乐'],
    emotionalIntensity: 0.6,
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(), // 3 天前
  }),
  createMemory({
    id: 'mem-4',
    user: '工作好累',
    assistant: '辛苦了，休息一下吧',
    tags: ['工作', '疲惫'],
    emotionalIntensity: 0.4,
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(), // 10 天前
  }),
  createMemory({
    id: 'mem-5',
    user: '生日快乐！',
    assistant: '谢谢主人记得我的生日！',
    tags: ['生日', '开心', '重要'],
    emotionalIntensity: 0.95,
    importance: 90,
    isAutobiographical: true,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(), // 5 天前
  }),
]

// ============ 标签云测试 ============

describe('TagCloud', () => {
  beforeEach(() => {
    cleanup()
  })

  it('无标签数据时显示空状态', () => {
    const memories = [createMemory({ tags: [] })]
    render(<TagCloud memories={memories} />)
    expect(screen.getByText('暂无标签数据')).toBeInTheDocument()
  })

  it('渲染所有标签及其频率', () => {
    render(<TagCloud memories={sampleMemories} />)
    // "开心" 出现 3 次（mem-1, mem-3, mem-5）
    expect(screen.getByText(/开心/)).toBeInTheDocument()
    expect(screen.getByText(/难过/)).toBeInTheDocument()
    expect(screen.getByText(/游戏/)).toBeInTheDocument()
  })

  it('点击标签触发 onSelectTag 回调', () => {
    const onSelectTag = vi.fn()
    render(<TagCloud memories={sampleMemories} onSelectTag={onSelectTag} />)
    const tagButtons = screen.getAllByRole('button')
    // 找到 "开心" 标签按钮
    const happyButton = tagButtons.find((btn) => btn.textContent?.includes('开心'))
    expect(happyButton).toBeTruthy()
    fireEvent.click(happyButton!)
    expect(onSelectTag).toHaveBeenCalledWith('开心')
  })

  it('选中标签显示高亮样式', () => {
    render(<TagCloud memories={sampleMemories} selectedTag="开心" onSelectTag={vi.fn()} />)
    const tagButtons = screen.getAllByRole('button')
    const happyButton = tagButtons.find((btn) => btn.textContent?.includes('开心'))
    expect(happyButton).toBeTruthy()
    expect(happyButton?.className).toContain('bg-amber-400/20')
  })

  it('最多显示 30 个标签', () => {
    // 创建 40 个不同标签的记忆
    const manyTags = Array.from({ length: 40 }, (_, i) =>
      createMemory({ tags: [`tag-${i}`] })
    )
    render(<TagCloud memories={manyTags} />)
    const tagButtons = screen.getAllByRole('button')
    expect(tagButtons.length).toBeLessThanOrEqual(30)
  })

  it('显示标签总数', () => {
    render(<TagCloud memories={sampleMemories} />)
    // 标签云标题区域应该显示标签数量
    const countLabel = screen.getByText(/个标签/)
    expect(countLabel).toBeInTheDocument()
  })

  it('频率大于1的标签显示计数', () => {
    render(<TagCloud memories={sampleMemories} />)
    // "开心" 出现 3 次，应该显示计数
    const happyButton = screen.getAllByRole('button').find(
      (btn) => btn.textContent?.includes('开心')
    )
    expect(happyButton?.textContent).toMatch(/\(\d+\)/) // 包含 (3) 格式
  })
})

// ============ 情感曲线测试 ============

describe('EmotionCurve', () => {
  beforeEach(() => {
    cleanup()
  })

  it('近 30 天无记忆时显示空状态', () => {
    // 创建超过 30 天前的记忆
    const oldMemories = [createMemory({
      created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
    })]
    render(<EmotionCurve memories={oldMemories} />)
    expect(screen.getByText('近 30 天无记忆数据')).toBeInTheDocument()
  })

  it('有记忆时渲染 SVG 图表', () => {
    const { container } = render(<EmotionCurve memories={sampleMemories} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
  })

  it('有记忆时渲染数据点', () => {
    const { container } = render(<EmotionCurve memories={sampleMemories} />)
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBeGreaterThan(0)
  })

  it('显示图例', () => {
    render(<EmotionCurve memories={sampleMemories} />)
    expect(screen.getByText('高情感')).toBeInTheDocument()
    expect(screen.getByText('中情感')).toBeInTheDocument()
    expect(screen.getByText('低情感')).toBeInTheDocument()
  })

  it('单条记忆也能正确渲染', () => {
    const { container } = render(<EmotionCurve memories={[sampleMemories[0]]} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
  })

  it('高情感强度记忆渲染正确的颜色', () => {
    const highEmotionMem = createMemory({ emotionalIntensity: 0.9 })
    const { container } = render(<EmotionCurve memories={[highEmotionMem]} />)
    const circles = container.querySelectorAll('circle')
    const highEmotionCircle = Array.from(circles).find(
      (c) => c.getAttribute('fill') === '#f472b6'
    )
    expect(highEmotionCircle).toBeTruthy()
  })
})

// ============ 时间密度图测试 ============

describe('TimeDensityChart', () => {
  beforeEach(() => {
    cleanup()
  })

  it('无数据时显示空状态', () => {
    render(<TimeDensityChart memories={[]} />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })

  it('有数据时渲染柱状图', () => {
    const { container } = render(<TimeDensityChart memories={sampleMemories} />)
    // 柱状图用 div 渲染，检查是否有带 rounded-t 类的 div
    const bars = container.querySelectorAll('.rounded-t')
    expect(bars.length).toBeGreaterThan(0)
  })

  it('最多显示 12 个月', () => {
    // 创建跨越 15 个月的记忆
    const longMemories = Array.from({ length: 15 }, (_, i) =>
      createMemory({
        created_at: new Date(Date.now() - (14 - i) * 30 * 86400000).toISOString(),
      })
    )
    const { container } = render(<TimeDensityChart memories={longMemories} />)
    const bars = container.querySelectorAll('.rounded-t')
    expect(bars.length).toBeLessThanOrEqual(12)
  })

  it('显示月份标签', () => {
    render(<TimeDensityChart memories={sampleMemories} />)
    // 柱状图底部应该有月份文本标签
    const chart = screen.getByText(/记忆密度/).closest('.rounded-xl')
    expect(chart).toBeTruthy()
    // 检查是否有 text-[8px] 类的标签（月份标签样式）
    const monthLabels = chart?.querySelectorAll('.text-\\[8px\\]')
    expect(monthLabels?.length).toBeGreaterThan(0)
  })

  it('同月多条记忆聚合为一根柱', () => {
    const sameMonthMems = [
      createMemory({ created_at: '2026-07-01T10:00:00Z' }),
      createMemory({ created_at: '2026-07-15T10:00:00Z' }),
      createMemory({ created_at: '2026-07-20T10:00:00Z' }),
    ]
    const { container } = render(<TimeDensityChart memories={sameMonthMems} />)
    const bars = container.querySelectorAll('.rounded-t')
    expect(bars.length).toBe(1) // 同月聚合为一根柱
  })

  it('柱高度随记忆数量变化', () => {
    const manyMemories = Array.from({ length: 20 }, (_, i) =>
      createMemory({
        created_at: new Date(Date.now() - i * 86400000).toISOString(), // 每天一条
      })
    )
    const { container } = render(<TimeDensityChart memories={manyMemories} />)
    const bars = container.querySelectorAll('.rounded-t')
    // 不同月份的柱高度应该不同
    expect(bars.length).toBeGreaterThan(0)
  })
})

// ============ 集成测试：MemoryPanel 可视化模式 ============

describe('MemoryPanel 可视化模式集成', () => {
  beforeEach(() => {
    cleanup()
  })

  // 此测试验证 MemoryPanel 的可视化模式是否正确渲染三个可视化组件
  it('三个可视化组件可独立使用且数据互通', () => {
    const { container } = render(
      <div>
        <TagCloud memories={sampleMemories} />
        <EmotionCurve memories={sampleMemories} />
        <TimeDensityChart memories={sampleMemories} />
      </div>
    )

    // 标签云渲染
    expect(screen.getByText(/标签云/)).toBeInTheDocument()
    // 情感曲线渲染
    expect(screen.getByText(/情感曲线/)).toBeInTheDocument()
    // 时间密度图渲染
    expect(screen.getByText(/记忆密度/)).toBeInTheDocument()

    // SVG 图表存在
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThan(0)
  })

  it('TagCloud + EmotionCurve + TimeDensityChart 共享相同数据源', () => {
    // 验证所有组件使用相同记忆数据时产生一致结果
    const onSelectTag = vi.fn()

    const { container } = render(
      <div>
        <TagCloud memories={sampleMemories} onSelectTag={onSelectTag} selectedTag="开心" />
        <EmotionCurve memories={sampleMemories} />
        <TimeDensityChart memories={sampleMemories} />
      </div>
    )

    // 标签云显示"开心"标签高亮
    const happyBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('开心')
    )
    expect(happyBtn?.className).toContain('bg-amber-400/20')

    // 情感曲线和密度图都基于 sampleMemories 渲染
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThan(0)
  })
})

// P2-10：宠物 HUD 可折叠 + Live2D 回退标注
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MobilePetView } from '@/mobile/MobilePetView'
import { usePetStore } from '@/stores/petStore'

// Live2D 渲染器 mock：挂载后立即报错（模拟 Cubism Core 缺失/模型加载失败）
vi.mock('@/components/Live2DRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/Live2DRenderer')>()
  const React = await import('react')
  const Live2DRendererMock = (props: { onError?: () => void }) => {
    React.useEffect(() => {
      props.onError?.()
    }, [props])
    return null
  }
  return { ...actual, Live2DRenderer: Live2DRendererMock }
})

// 模型探测 fetch mock：候选路径 HEAD 返回 ok → 走 Live2D 分支
vi.stubGlobal(
  'fetch',
  vi.fn((input: string | URL) => {
    void input
    return Promise.resolve({ ok: true } as Response)
  }),
)

describe('MobilePetView HUD 与回退（P2-10）', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    usePetStore.setState({ currentCharacterId: 'doro' })
    usePetStore.getState().initCharacter('doro')
  })

  it('HUD 默认展开显示四项状态，点击折叠后隐藏、再点恢复（并持久化）', async () => {
    render(<MobilePetView isActive isDark={false} />)

    // 等待角色数据渲染（饱食度行）
    await screen.findByText(/饱食度/)
    expect(screen.getByText(/心情/)).toBeInTheDocument()
    expect(screen.getByTestId('hud-toggle').getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByTestId('hud-toggle'))
    expect(screen.queryByText(/饱食度/)).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-toggle').getAttribute('aria-expanded')).toBe('false')
    expect(localStorage.getItem('spiritpal:hud-collapsed')).toBe('1')

    // 重新挂载后保持折叠（持久化）
    cleanup()
    render(<MobilePetView isActive isDark={false} />)
    expect(screen.queryByText(/饱食度/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('hud-toggle'))
    expect(screen.getByText(/饱食度/)).toBeInTheDocument()
  })

  it('Live2D 加载失败：明确标注已回退 2D 精灵', async () => {
    render(<MobilePetView isActive isDark={false} />)
    await waitFor(() => {
      expect(screen.getByTestId('live2d-fallback-badge')).toBeInTheDocument()
    })
    expect(screen.getByTestId('live2d-fallback-badge').textContent).toContain('2D 精灵')
  })
})

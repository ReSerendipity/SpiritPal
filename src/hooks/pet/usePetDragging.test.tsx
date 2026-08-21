// 最终放置位置: src/hooks/pet/usePetDragging.test.tsx
// 覆盖: usePetDragging —— 返回结构、点击（非拖拽）回调、拖拽触发 onDragStart/onDragEnd、interruptWalk/setInterruptWalk
// Mock: @tauri-apps/api/window（含 PhysicalPosition + getCurrentWindow 返回丰富 mock 对象）；rAF stub 为 no-op
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePetDragging } from './usePetDragging'

const dragging = vi.hoisted(() => {
  const winMock = {
    hide: vi.fn(),
    show: vi.fn(),
    setFocus: vi.fn(),
    outerPosition: vi.fn().mockResolvedValue({ x: 100, y: 100 }),
    outerSize: vi.fn().mockResolvedValue({ width: 300, height: 400 }),
    scaleFactor: vi.fn().mockResolvedValue(1),
    setPosition: vi.fn().mockResolvedValue(undefined),
    currentMonitor: vi.fn().mockResolvedValue({
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
    }),
    listen: vi.fn(() => Promise.resolve(() => {})),
    onMoved: vi.fn(() => Promise.resolve(() => {})),
    emit: vi.fn(),
  }
  return { winMock }
})

vi.mock('@tauri-apps/api/window', () => ({
  PhysicalPosition: class {
    x: number
    y: number
    constructor(x: number, y: number) {
      this.x = x
      this.y = y
    }
  },
  getCurrentWindow: () => dragging.winMock,
  currentMonitor: dragging.winMock.currentMonitor,
  WebviewWindow: vi.fn(),
}))

describe('usePetDragging', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setup() {
    const containerRef = { current: document.createElement('div') }
    const clickScaleRef = { current: 1 }
    const facingRef = { current: 'right' as 'left' | 'right' }
    const posRef = { current: { x: 100, y: 100 } }
    const onDragStart = vi.fn()
    const onDragEnd = vi.fn()
    const onClick = vi.fn()
    const rendered = renderHook(() =>
      usePetDragging({
        containerRef,
        useLive2D: false,
        clickScaleRef,
        facingRef,
        posRef,
        onDragStart,
        onDragEnd,
        onClick,
      }),
    )
    return { ...rendered, onDragStart, onDragEnd, onClick }
  }

  function mouseEvent(props: Partial<React.MouseEvent> = {}): React.MouseEvent {
    return {
      button: 0,
      clientX: 0,
      clientY: 0,
      screenX: 0,
      screenY: 0,
      ...props,
    } as unknown as React.MouseEvent
  }

  it('返回完整结构（初始 dragging=false / dragCount=0）', () => {
    const { result } = setup()
    expect(result.current.dragging).toBe(false)
    expect(result.current.dragCount).toBe(0)
    expect(typeof result.current.handleMouseDown).toBe('function')
    expect(typeof result.current.handleMouseMove).toBe('function')
    expect(typeof result.current.handleMouseUp).toBe('function')
    expect(typeof result.current.handleMouseLeave).toBe('function')
    expect(typeof result.current.interruptWalk).toBe('function')
    expect(typeof result.current.setInterruptWalk).toBe('function')
  })

  it('点击（mousedown + mouseup 无移动）触发 onClick', () => {
    const { result, onClick } = setup()
    act(() => {
      result.current.handleMouseDown(mouseEvent({ clientX: 0, clientY: 0 }))
    })
    act(() => {
      result.current.handleMouseUp()
    })
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(result.current.dragging).toBe(false)
  })

  it('拖拽（移动 >3px）触发 onDragStart，释放触发 onDragEnd + dragCount=1', async () => {
    const { result, onDragStart, onDragEnd } = setup()
    act(() => {
      result.current.handleMouseDown(mouseEvent({ clientX: 0, clientY: 0 }))
    })
    // 移动超过 3px 阈值 → 进入拖拽
    await act(async () => {
      await result.current.handleMouseMove(
        mouseEvent({ clientX: 10, clientY: 0, screenX: 10, screenY: 0 }),
      )
    })
    expect(result.current.dragging).toBe(true)
    expect(onDragStart).toHaveBeenCalledTimes(1)
    // 释放
    act(() => {
      result.current.handleMouseUp()
    })
    expect(result.current.dragging).toBe(false)
    expect(result.current.dragCount).toBe(1)
    expect(onDragEnd).toHaveBeenCalledWith(1)
  })

  it('interruptWalk 调用 setInterruptWalk 设置的回调', () => {
    const { result } = setup()
    const fn = vi.fn()
    act(() => {
      result.current.setInterruptWalk(fn)
    })
    act(() => {
      result.current.interruptWalk()
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('handleMouseLeave 中断拖拽状态', () => {
    const { result } = setup()
    act(() => {
      result.current.handleMouseDown(mouseEvent({ clientX: 0, clientY: 0 }))
    })
    act(() => {
      result.current.handleMouseLeave()
    })
    expect(result.current.dragging).toBe(false)
  })

  it('拖动到屏幕边缘触发实时磁吸（窗口贴边 + dockDir 更新）', async () => {
    // mock 环境：窗口 300×400 @ (100,100)，屏幕 1920×1080 @ (0,0)，sf=1
    const { result } = setup()
    act(() => {
      result.current.handleMouseDown(mouseEvent({ clientX: 0, clientY: 0, screenX: 500, screenY: 500 }))
    })
    // 越过 3px 阈值 → 拖拽开始（异步缓存窗口/屏幕环境）
    await act(async () => {
      await result.current.handleMouseMove(mouseEvent({ clientX: 10, clientY: 0, screenX: 510, screenY: 500 }))
    })
    expect(result.current.dragging).toBe(true)
    // 窗口中心区域拖动 → 不吸附
    await act(async () => {
      await result.current.handleMouseMove(mouseEvent({ clientX: 20, clientY: 0, screenX: 520, screenY: 500 }))
    })
    expect(result.current.dockDir).toBeNull()
    // 拖到屏幕左侧边缘外 → 实时磁吸应把窗口贴到 x=0 且 dockDir='left'
    dragging.winMock.setPosition.mockClear()
    await act(async () => {
      await result.current.handleMouseMove(mouseEvent({ clientX: -400, clientY: 0, screenX: 0, screenY: 500 }))
    })
    expect(result.current.dockDir).toBe('left')
    const lastCall = dragging.winMock.setPosition.mock.calls.at(-1)?.[0]
    expect(lastCall?.x).toBe(0) // 贴屏幕左边缘
    // 释放后 dockDir 保持（snapToEdge 兜底）
    act(() => {
      result.current.handleMouseUp()
    })
    expect(result.current.dockDir).toBe('left')
  })
})
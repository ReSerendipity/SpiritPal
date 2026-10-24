import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ChatViewControls } from '../chat/ChatViewControls'
import { useChatViewStore } from '@/stores/chatViewStore'
import i18n from '@/lib/system/i18n'

beforeEach(() => {
  localStorage.clear()
  useChatViewStore.setState({
    showMetrics: true,
    showThinking: true,
    showMemory: true,
    showTimestamps: true,
    compact: false,
  })
})

describe('ChatViewControls and display preferences', () => {
  it('follows the active language for all newly added labels', async () => {
    await i18n.changeLanguage('en')
    try {
      render(<ChatViewControls />)
      fireEvent.click(screen.getByRole('button', { name: 'Display options' }))
      expect(screen.getByText('Full view')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Timestamps' })).toBeChecked()
    } finally {
      await i18n.changeLanguage('zh')
    }
  })

  it('exposes a labelled inline panel with real checked checkboxes by default', () => {
    render(<ChatViewControls />)
    const trigger = screen.getByRole('button', { name: '显示选项' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(trigger.getAttribute('aria-controls')!)).toBeInTheDocument()
    for (const label of ['性能指标', '思考过程', '记忆引用', '时间戳']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeChecked()
    }
    expect(screen.getByRole('checkbox', { name: '紧凑排版' })).not.toBeChecked()
    fireEvent.keyDown(screen.getByRole('checkbox', { name: '性能指标' }), { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('persists each option independently without message or token data', async () => {
    render(<ChatViewControls />)
    fireEvent.click(screen.getByRole('button', { name: '显示选项' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '思考过程' }))
    expect(screen.getByRole('checkbox', { name: '性能指标' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '记忆引用' })).toBeChecked()
    const saved = localStorage.getItem('spiritpal-chat-view')!
    expect(JSON.parse(saved).state).toEqual({
      showMetrics: true,
      showThinking: false,
      showMemory: true,
      showTimestamps: true,
      compact: false,
    })
    act(() => useChatViewStore.setState({ showThinking: true }))
    localStorage.setItem('spiritpal-chat-view', saved)
    await act(async () => {
      await useChatViewStore.persist.rehydrate()
    })
    expect(screen.getByRole('checkbox', { name: '思考过程' })).not.toBeChecked()
  })

  it('switches full/simple modes without changing compact layout', () => {
    render(<ChatViewControls />)
    fireEvent.click(screen.getByRole('button', { name: '显示选项' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '紧凑排版' }))
    fireEvent.click(screen.getByRole('button', { name: '精简视图' }))
    for (const label of ['性能指标', '思考过程', '记忆引用', '时间戳']) {
      expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked()
    }
    expect(screen.getByRole('checkbox', { name: '紧凑排版' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '完整视图' }))
    expect(screen.getAllByRole('checkbox').every((input) => (input as HTMLInputElement).checked)).toBe(true)
  })

  it('only hydrates valid display booleans from local storage', async () => {
    localStorage.setItem(
      'spiritpal-chat-view',
      JSON.stringify({
        state: { showMetrics: 'false', compact: true, token: 'must-not-enter-store', setMode: 'invalid' },
        version: 0,
      }),
    )
    await useChatViewStore.persist.rehydrate()
    expect(useChatViewStore.getState().showMetrics).toBe(true)
    expect(useChatViewStore.getState().compact).toBe(true)
    expect(useChatViewStore.getState()).not.toHaveProperty('token')
    expect(typeof useChatViewStore.getState().setMode).toBe('function')
  })
})

/**
 * CharacterImportWizard 组件测试
 *
 * @module CharacterImportWizard.test
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CharacterImportWizard } from '@/components/CharacterImportWizard'

// Mock dependencies
vi.mock('@/lib/nurture/characterImportService', () => ({
  importCharacter: vi.fn(),
}))

vi.mock('@/stores/petStore', () => ({
  usePetStore: vi.fn(() => ({ switchCharacter: vi.fn() })),
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({ switchCharacter: vi.fn() })),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

import { importCharacter } from '@/lib/nurture/characterImportService'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CharacterImportWizard', () => {
  it('should render drag-and-drop zone', () => {
    render(<CharacterImportWizard onClose={vi.fn()} />)
    expect(screen.getByText(/拖入 JSON \/ PNG/i)).toBeInTheDocument()
  })

  it('should render directory import button', () => {
    render(<CharacterImportWizard onClose={vi.fn()} />)
    expect(screen.getByText(/从目录导入/i)).toBeInTheDocument()
  })

  it('should call onClose when backdrop clicked', async () => {
    const onClose = vi.fn()
    const { container } = render(<CharacterImportWizard onClose={onClose} />)

    // Click the backdrop (outer div)
    const backdrop = container.firstChild as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('should show success result with preview and use button', async () => {
    vi.mocked(importCharacter).mockResolvedValue({
      ok: true,
      characterId: 'test-cat',
      profile: {
        id: 'test-cat',
        name: 'Test Cat',
        displayName: 'Test Cat',
        source: 'TestAuthor',
        birthBackground: 'A test cat',
        emotionalCore: '',
        personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0, rationality: 0 },
        signaturePhrase: '',
        classicQuotes: [],
        systemPrompt: '',
        fewShotExamples: [],
        spriteAsset: '/test.png',
        spriteType: 'atlas',
        themeColor: { primary: '#ff6b6b', secondary: '#4ecdc4' },
        bubbleMessages: { idle: [''], hungry: [''], sad: [''], pet: [''], feed: [''], pomodoroDone: [''] },
        type: 'community',
      },
      errors: [],
      warnings: [],
    })

    render(<CharacterImportWizard onClose={vi.fn()} />)

    // Create a mock JSON file
    const file = new File([JSON.stringify({ id: 'test-cat', name: 'Test Cat', spritePath: '/test.png', spriteType: 'atlas' })], 'test.json', { type: 'application/json' })

    // Find the hidden input and fire change event
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('导入成功')).toBeInTheDocument()
      expect(screen.getByText('Test Cat')).toBeInTheDocument()
      expect(screen.getByText('立即使用')).toBeInTheDocument()
    })
  })

  it('should show error messages on import failure', async () => {
    vi.mocked(importCharacter).mockResolvedValue({
      ok: false,
      errors: ['JSON 解析失败: invalid', '缺少 id 字段'],
      warnings: [],
    })

    render(<CharacterImportWizard onClose={vi.fn()} />)

    const file = new File(['{invalid}'], 'bad.json', { type: 'application/json' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('导入失败')).toBeInTheDocument()
      expect(screen.getByText('JSON 解析失败: invalid')).toBeInTheDocument()
      expect(screen.getByText('缺少 id 字段')).toBeInTheDocument()
    })
  })

  it('should show warnings on successful import with warnings', async () => {
    vi.mocked(importCharacter).mockResolvedValue({
      ok: true,
      characterId: 'test-cat',
      profile: {
        id: 'test-cat',
        name: 'Test Cat',
        displayName: 'Test Cat',
        source: 'Community',
        birthBackground: '',
        emotionalCore: '',
        personality: { warmth: 0, liveliness: 0, dependence: 0, directness: 0, rationality: 0 },
        signaturePhrase: '',
        classicQuotes: [],
        systemPrompt: '',
        fewShotExamples: [],
        spriteAsset: '/test.png',
        spriteType: 'atlas',
        themeColor: { primary: '#000', secondary: '#000' },
        bubbleMessages: { idle: [''], hungry: [''], sad: [''], pet: [''], feed: [''], pomodoroDone: [''] },
        type: 'community',
      },
      errors: [],
      warnings: ['精灵图路径为空', '缺 walk 动画，将回退 idle'],
    })

    render(<CharacterImportWizard onClose={vi.fn()} />)

    const file = new File([JSON.stringify({ id: 'test-cat', name: 'Test Cat' })], 'test.json', { type: 'application/json' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('精灵图路径为空')).toBeInTheDocument()
      expect(screen.getByText('缺 walk 动画，将回退 idle')).toBeInTheDocument()
    })
  })
})

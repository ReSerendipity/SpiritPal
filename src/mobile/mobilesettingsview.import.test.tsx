// P3-8：移动端角色包导入面板——文件选择 → importCharacter → 反馈/切换
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/lib/system/i18n'
import { MobileSettingsView } from '@/mobile/MobileSettingsView'
import { useSettingsStore } from '@/stores/settingsStore'

// importCharacter mock（File 源平台中立；SAF/文件选择在 jsdom 不可测，测接线）
const importCharacterMock = vi.fn()
vi.mock('@/lib/nurture/characterImportService', () => ({
  importCharacter: (...args: unknown[]) => importCharacterMock(...args),
}))

vi.mock('@/lib/data/characters', () => ({
  getAllCharacters: vi.fn(() => [{ id: 'doro', name: '多萝', spriteAsset: '' }]),
  getCharacter: vi.fn(() => null),
  getDefaultCharacter: vi.fn(() => ({ id: 'doro', name: '多萝', spriteAsset: '' })),
}))

function pickFile(name: string, type: string) {
  const file = new File(['{"format":"spiritpal-character-pack-v1"}'], name, { type })
  const input = screen.getByTestId('import-file-input') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file] })
  fireEvent.change(input)
}

describe('MobileSettingsView 角色导入（P3-8）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    importCharacterMock.mockReset()
  })

  it('主页有导入入口，进入后出现文件选择控件与说明', () => {
    render(<MobileSettingsView />)
    fireEvent.click(screen.getByRole('button', { name: /导入角色/ }))
    expect(screen.getByTestId('import-pick')).toBeInTheDocument()
    expect(screen.getByTestId('import-file-input')).toBeInTheDocument()
    expect(screen.getByText(/SillyTavern PNG/)).toBeInTheDocument()
  })

  it('选择 .json 文件 → 以 json-file 源调用 importCharacter，成功后可一键切换', async () => {
    importCharacterMock.mockResolvedValue({
      ok: true,
      characterId: 'imported-1',
      profile: { id: 'imported-1', displayName: '导入的角色' },
      errors: [],
      warnings: [],
    })
    render(<MobileSettingsView />)
    fireEvent.click(screen.getByRole('button', { name: /导入角色/ }))
    pickFile('pack.json', 'application/json')

    await waitFor(() => {
      expect(screen.getByTestId('import-result-ok')).toBeInTheDocument()
    })
    expect(importCharacterMock).toHaveBeenCalledTimes(1)
    const arg = importCharacterMock.mock.calls[0][0] as { kind: string; file: File }
    expect(arg.kind).toBe('json-file')
    expect(arg.file.name).toBe('pack.json')
    expect(screen.getByText('导入的角色')).toBeInTheDocument()

    // 一键切换：settings.currentCharacterId 跟随导入的 id
    fireEvent.click(screen.getByTestId('import-switch'))
    expect(useSettingsStore.getState().currentCharacterId).toBe('imported-1')
  })

  it('选择 .png 文件 → 以 png-file 源调用（SillyTavern 嵌卡）', async () => {
    importCharacterMock.mockResolvedValue({
      ok: true,
      characterId: 'png-1',
      profile: { id: 'png-1', displayName: 'PNG 角色' },
      errors: [],
      warnings: [],
    })
    render(<MobileSettingsView />)
    fireEvent.click(screen.getByRole('button', { name: /导入角色/ }))
    pickFile('card.png', 'image/png')

    await waitFor(() => {
      expect(screen.getByTestId('import-result-ok')).toBeInTheDocument()
    })
    expect((importCharacterMock.mock.calls[0][0] as { kind: string }).kind).toBe('png-file')
  })

  it('导入失败显示错误列表，不提供切换按钮', async () => {
    importCharacterMock.mockResolvedValue({
      ok: false,
      errors: ['无法识别的 JSON 格式'],
      warnings: [],
    })
    render(<MobileSettingsView />)
    fireEvent.click(screen.getByRole('button', { name: /导入角色/ }))
    pickFile('bad.json', 'application/json')

    await waitFor(() => {
      expect(screen.getByTestId('import-result-fail')).toBeInTheDocument()
    })
    expect(screen.getByText(/无法识别的 JSON 格式/)).toBeInTheDocument()
    expect(screen.queryByTestId('import-switch')).not.toBeInTheDocument()
  })
})

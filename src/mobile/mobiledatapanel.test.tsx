// P1-4: MobileDataPanel 数据管理面板测试（备份/恢复/删除/完整性/重置）
// 交互差异：桌面用 window.confirm（Tauri 移动端不可用），移动端为卡片内确认态
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/lib/system/i18n'
import { MobileDataPanel } from './MobileDataPanel'

const listDbBackupsMock = vi.fn()
const restoreDbBackupMock = vi.fn()
const deleteDbBackupMock = vi.fn()
const checkDbIntegrityMock = vi.fn()
const invokeMock = vi.fn()
const resetAllMock = vi.fn()

vi.mock('@/lib/data/dbBackup', () => ({
  listDbBackups: () => listDbBackupsMock(),
  restoreDbBackup: (name: string) => restoreDbBackupMock(name),
  deleteDbBackup: (name: string) => deleteDbBackupMock(name),
  checkDbIntegrity: () => checkDbIntegrityMock(),
  DB_INTEGRITY_FAILED_EVENT: 'spiritpal:db-integrity-failed',
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@/lib/data/dataManager', () => ({
  getDataManager: () => ({ resetAll: resetAllMock }),
}))

// P2-13：诊断导出走 tauriInvoker（isTauri 判定 + invoke），单测里 mock 掉
const exportDiagnosticsMock = vi.fn()
vi.mock('@/lib/system/diagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/system/diagnostics')>()
  return { ...actual, exportDiagnostics: (...args: unknown[]) => exportDiagnosticsMock(...args) }
})

const SAMPLE_BACKUPS = [
  { name: 'spiritpal-backup-1001.db.enc', sizeBytes: 290816, modifiedAt: 1791100000000 },
  { name: 'spiritpal-backup-1002.db.enc', sizeBytes: 291000, modifiedAt: 1791100500000 },
]

describe('MobileDataPanel（P1-4 数据管理）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listDbBackupsMock.mockResolvedValue(SAMPLE_BACKUPS)
    invokeMock.mockResolvedValue('spiritpal-backup-x.db.enc')
    resetAllMock.mockResolvedValue(undefined)
  })

  function renderPanel() {
    return render(
      <MobileDataPanel
        onBack={vi.fn()}
        bgClass="bg-cream"
        textClass="text-ink"
        cardBgClass="bg-surface"
        cardBorderClass="border-ink/10"
        subtitleClass="text-ink-faint"
      />,
    )
  }

  it('加载并渲染备份列表（名称/大小）', async () => {
    renderPanel()
    await waitFor(() => {
      expect(screen.getByText('spiritpal-backup-1001.db.enc')).toBeTruthy()
    })
    expect(screen.getByText('spiritpal-backup-1002.db.enc')).toBeTruthy()
    // 290816B ≈ 284.0 KB，两个备份均以 KB 展示
    expect(screen.getAllByText(/284\.\d KB/).length).toBe(2)
  })

  it('立即备份调用 backup_db_at_rest 并刷新列表', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '备份' }))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('backup_db_at_rest')
    })
    await waitFor(() => {
      expect(listDbBackupsMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('恢复需卡片内确认，确认后调用 restoreDbBackup', async () => {
    restoreDbBackupMock.mockResolvedValue(undefined)
    renderPanel()
    await waitFor(() => {
      expect(screen.getByLabelText('恢复此备份: spiritpal-backup-1001.db.enc')).toBeTruthy()
    })
    fireEvent.click(screen.getByLabelText('恢复此备份: spiritpal-backup-1001.db.enc'))
    // 确认态出现
    const confirmBtn = screen.getByLabelText('确认')
    fireEvent.click(confirmBtn)
    await waitFor(() => {
      expect(restoreDbBackupMock).toHaveBeenCalledWith('spiritpal-backup-1001.db.enc')
    })
    // 提示重启生效
    await waitFor(() => {
      expect(screen.getByText(/重启应用/)).toBeTruthy()
    })
  })

  it('删除需卡片内确认，取消不调用', async () => {
    deleteDbBackupMock.mockResolvedValue(undefined)
    renderPanel()
    await waitFor(() => {
      expect(screen.getByLabelText('删除此备份: spiritpal-backup-1001.db.enc')).toBeTruthy()
    })
    fireEvent.click(screen.getByLabelText('删除此备份: spiritpal-backup-1001.db.enc'))
    // 先取消
    fireEvent.click(screen.getByLabelText('取消'))
    expect(deleteDbBackupMock).not.toHaveBeenCalled()
    // 再删除并确认
    fireEvent.click(screen.getByLabelText('删除此备份: spiritpal-backup-1001.db.enc'))
    fireEvent.click(screen.getByLabelText('确认'))
    await waitFor(() => {
      expect(deleteDbBackupMock).toHaveBeenCalledWith('spiritpal-backup-1001.db.enc')
    })
  })

  it('完整性检查显示结果', async () => {
    checkDbIntegrityMock.mockResolvedValue(true)
    renderPanel()
    fireEvent.click(screen.getByText(/检查/))
    await waitFor(() => {
      expect(screen.getByText('数据库完好')).toBeTruthy()
    })
  })

  it('P2-13: 诊断导出成功显示文件数与路径', async () => {
    exportDiagnosticsMock.mockResolvedValue({ path: '/data/0/files/diag-1001', files: ['spiritpal.log', 'audit.log'] })
    render(<MobileDataPanel onBack={() => {}} bgClass="" textClass="" cardBgClass="" cardBorderClass="" subtitleClass="" />)
    fireEvent.click(await screen.findByTestId('export-diagnostics'))
    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-result').textContent).toContain('已导出 2 个文件')
    })
    expect(screen.getByTestId('diagnostics-result').textContent).toContain('/data/0/files/diag-1001')
    expect(exportDiagnosticsMock).toHaveBeenCalledTimes(1)
  })

  it('P2-13: 诊断导出失败显示错误横幅', async () => {
    exportDiagnosticsMock.mockRejectedValue(new Error('io error'))
    render(<MobileDataPanel onBack={() => {}} bgClass="" textClass="" cardBgClass="" cardBorderClass="" subtitleClass="" />)
    fireEvent.click(await screen.findByTestId('export-diagnostics'))
    await waitFor(() => {
      expect(screen.getByText(/诊断导出失败/)).toBeInTheDocument()
    })
  })

  it('P2-13: 非 Tauri 环境提示不支持', async () => {
    exportDiagnosticsMock.mockResolvedValue(null)
    render(<MobileDataPanel onBack={() => {}} bgClass="" textClass="" cardBgClass="" cardBorderClass="" subtitleClass="" />)
    fireEvent.click(await screen.findByTestId('export-diagnostics'))
    await waitFor(() => {
      expect(screen.getByText(/当前环境不支持诊断导出/)).toBeInTheDocument()
    })
  })

  it('重置需两步确认，最终调用 resetAll', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('重置所有数据'))
    // 第一步确认文案出现
    expect(screen.getByText(/无法撤销/)).toBeTruthy()
    fireEvent.click(screen.getByText('继续'))
    // 第二步
    expect(screen.getByText(/永久删除/)).toBeTruthy()
    const resetButtons = screen.getAllByText('重置所有数据')
    fireEvent.click(resetButtons[resetButtons.length - 1])
    await waitFor(() => {
      expect(resetAllMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByText(/请重启应用/)).toBeTruthy()
    })
  })
})

import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog'
import { confirmDialog } from '@/lib/system/confirmDialog'

function Harness() {
  const [result, setResult] = useState('pending')

  async function open() {
    const approved = await confirmDialog({
      title: '删除这条记忆？',
      message: '此操作不可恢复。',
      detail: '喜欢爬山',
      confirmLabel: '删除',
      cancelLabel: '取消',
      tone: 'danger',
    })
    setResult(String(approved))
  }

  return (
    <>
      <button onClick={() => void open()}>打开确认框</button>
      <span data-testid="result">{result}</span>
    </>
  )
}

describe('ConfirmDialogProvider', () => {
  it('确认后 resolve(true) 并关闭弹窗', async () => {
    render(
      <ConfirmDialogProvider>
        <Harness />
      </ConfirmDialogProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '打开确认框' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('删除这条记忆？')
    expect(dialog).toHaveTextContent('此操作不可恢复。')
    expect(dialog).toHaveTextContent('喜欢爬山')

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('取消与 Esc 都 resolve(false)', async () => {
    render(
      <ConfirmDialogProvider>
        <Harness />
      </ConfirmDialogProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '打开确认框' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'))

    fireEvent.click(screen.getByRole('button', { name: '打开确认框' }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'))
  })
})

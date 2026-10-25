/** 应用内确认框的统一配置 */
export interface ConfirmDialogOptions {
  title: string
  message?: string
  /** 需要等宽/换行展示的补充信息（文件名、记忆内容、工具参数等） */
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
}

export type ConfirmHandler = (options: ConfirmDialogOptions) => Promise<boolean>

let confirmHandler: ConfirmHandler | null = null

/** 由 ConfirmDialogProvider 注册/注销当前窗口的确认框宿主 */
export function setConfirmHandler(handler: ConfirmHandler | null): void {
  confirmHandler = handler
}

/**
 * 打开应用内确认框，返回用户是否确认。
 * Provider 未挂载时按“取消”处理，避免绕过确认执行破坏性操作。
 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return confirmHandler ? confirmHandler(options) : Promise.resolve(false)
}

/**
 * @file updater.ts
 * @description 自动更新管理器模块 — F6 系统集成
 *
 * 核心功能：
 * - 封装 tauri-plugin-updater 检查更新逻辑
 * - 应用启动后延迟 30 秒自动检查更新
 * - 有新版本时通过系统通知提醒用户
 * - 支持下载进度回调
 * - 下载安装完成后自动重启应用
 * - 通知权限请求和检查
 *
 * 2026-09-10 加固（任务书 P0-1.5 / P2-2，报告1 §四-7 "每步可见"）：
 * - 失败原因透传：check / download / install / relaunch 任一环节失败均返回具体错误，
 *   不再以"返回 false + 吞错误"的方式静默失败
 * - 阶段回调：downloading → verifying → installing → restarting，供 UI 状态机展示
 *
 * 依赖关系：
 * - @tauri-apps/plugin-updater: Tauri 更新插件
 * - @tauri-apps/plugin-notification: Tauri 通知插件
 * - @tauri-apps/plugin-process: Tauri 进程插件（用于重启）
 */

import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'

/**
 * 更新信息接口
 */
export interface UpdateInfo {
  /** 新版本号 */
  version: string
  /** 发布日期 */
  date?: string
  /** 更新说明（Release Notes） */
  body?: string
}

/**
 * 更新检查结果接口
 */
export interface UpdateCheckResult {
  /** 是否有可用更新 */
  available: boolean
  /** 更新信息（有更新时存在） */
  info?: UpdateInfo
  /** 错误信息（检查失败时存在，不再吞错误） */
  error?: string
}

/**
 * 更新链路阶段（报告1 §四-7：每一步必须可见）
 */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'installing' | 'restarting'

/**
 * 下载并安装更新结果接口
 */
export interface UpdateInstallResult {
  /** 是否成功触发安装/重启 */
  success: boolean
  /** 失败原因（success=false 时存在） */
  error?: string
}

/**
 * 检查是否有新版本可用
 *
 * @returns Promise，解析为更新检查结果（失败时 error 携带原因）
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  try {
    const update = await check()
    if (update) {
      return {
        available: true,
        info: {
          version: update.version,
          date: update.date,
          body: update.body,
        },
      }
    }
    return { available: false }
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * 下载并安装更新
 *
 * @param onProgress 下载进度回调（可选）：downloaded 为已下载字节数，total 为总字节数
 * @param onPhase 阶段回调（可选）：downloading → verifying → installing → restarting
 * @returns Promise，解析为安装结果；失败时 error 携带具体原因
 */
export async function downloadAndInstallUpdate(
  onProgress?: (progress: { downloaded: number; total: number }) => void,
  onPhase?: (phase: UpdatePhase) => void,
): Promise<UpdateInstallResult> {
  try {
    const update = await check()
    if (!update) return { success: false, error: '没有可用更新' }

    let total = 0
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? 0
          onPhase?.('downloading')
          break
        case 'Progress':
          if (onProgress) {
            onProgress({ downloaded: event.data.chunkLength, total })
          }
          break
        case 'Finished':
          // 下载完成：插件随即进入签名校验与安装阶段，界面给出可见反馈
          onPhase?.('verifying')
          break
      }
    })

    // 安装阶段（downloadAndInstall 返回即安装已触发）
    onPhase?.('installing')
    try {
      await relaunch()
    } catch (e) {
      return {
        success: false,
        error: `更新已安装，但自动重启失败：${e instanceof Error ? e.message : String(e)}`,
      }
    }
    onPhase?.('restarting')
    return { success: true }
  } catch (e) {
    console.error('[SpiritPal Updater] download/install failed:', e)
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * 发送更新通知（系统通知）
 *
 * @param title 通知标题
 * @param body 通知内容
 */
async function notifyUpdate(title: string, body: string): Promise<void> {
  try {
    // 检查通知权限，未授权时请求权限
    let granted = await isPermissionGranted()
    if (!granted) {
      const perm = await requestPermission()
      granted = perm === 'granted'
    }
    if (granted) {
      await sendNotification({ title, body })
    }
  } catch {
    // 通知失败时静默忽略（不影响主流程；系统通知属锦上添花，弹窗才是主反馈通道）
  }
}

/**
 * 初始化自动更新检查器
 *
 * 应用启动后延迟指定时间自动检查更新，有更新时弹出系统通知。
 * 注：界面弹窗由 UpdateNotification 组件负责（挂载于 App 桌面端根节点）。
 * 此函数保留供无 UI 场景（如后台模式）调用。
 *
 * @param delayMs 延迟毫秒数，默认 30 秒（避免影响启动性能）
 */
export function initAutoUpdateChecker(delayMs: number = 30000): void {
  setTimeout(async () => {
    const result = await checkForUpdates()
    if (result.available && result.info) {
      console.log(`[SpiritPal Updater] 新版本可用: ${result.info.version}`)
      await notifyUpdate('SpiritPal 发现新版本', `新版本 ${result.info.version} 已发布，请前往设置检查更新。`)
    } else if (result.error) {
      console.warn('[SpiritPal Updater] check failed:', result.error)
    }
  }, delayMs)
}

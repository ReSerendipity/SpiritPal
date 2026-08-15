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
 * 主要模块：
 * - UpdateInfo: 更新信息接口
 * - UpdateCheckResult: 更新检查结果接口
 * - checkForUpdates(): 检查更新
 * - downloadAndInstallUpdate(): 下载并安装更新
 * - initAutoUpdateChecker(): 初始化自动检查更新
 *
 * 依赖关系：
 * - @tauri-apps/plugin-updater: Tauri 更新插件
 * - @tauri-apps/plugin-notification: Tauri 通知插件
 * - @tauri-apps/plugin-process: Tauri 进程插件（用于重启）
 *
 * 核心接口：
 * - checkForUpdates(): 异步检查更新
 * - downloadAndInstallUpdate(): 下载并安装（带进度回调）
 * - initAutoUpdateChecker(): 启动时延迟自动检查
 */

import { check } from '@tauri-apps/plugin-updater'
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { relaunch } from '@tauri-apps/plugin-process'

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
  /** 错误信息（检查失败时存在） */
  error?: string
}

/**
 * 检查是否有新版本可用
 *
 * @returns Promise，解析为更新检查结果
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
 * @returns Promise，解析为 true 表示成功触发安装（应用将重启），false 表示失败
 */
export async function downloadAndInstallUpdate(
  onProgress?: (progress: { downloaded: number; total: number }) => void,
): Promise<boolean> {
  try {
    const update = await check()
    if (!update) return false

    let total = 0
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? 0
          break
        case 'Progress':
          if (onProgress) {
            onProgress({ downloaded: event.data.chunkLength, total })
          }
          break
        case 'Finished':
          break
      }
    })

    // 安装完成后重启应用
    await relaunch()
    return true
  } catch (e) {
    console.error('[SpiritPal Updater] download/install failed:', e)
    return false
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
    // 通知失败时静默忽略（不影响主流程）
  }
}

/**
 * 初始化自动更新检查器
 *
 * 应用启动后延迟指定时间自动检查更新，有更新时弹出系统通知
 *
 * @param delayMs 延迟毫秒数，默认 30 秒（避免影响启动性能）
 */
export function initAutoUpdateChecker(delayMs: number = 30000): void {
  setTimeout(async () => {
    const result = await checkForUpdates()
    if (result.available && result.info) {
      console.log(`[SpiritPal Updater] 新版本可用: ${result.info.version}`)
      // 发送系统通知提示用户
      await notifyUpdate(
        'SpiritPal 发现新版本',
        `新版本 ${result.info.version} 已发布，请前往设置检查更新。`,
      )
    } else if (result.error) {
      console.warn('[SpiritPal Updater] check failed:', result.error)
    }
  }, delayMs)
}

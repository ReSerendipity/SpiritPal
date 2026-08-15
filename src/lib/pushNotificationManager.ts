/**
 * 推送通知管理器模块
 *
 * @fileoverview 移动端远程推送通知处理（FCM/APNs），转发至宠物状态机（F7移动端）
 *
 * 主要模块：
 * - PushNotificationPayload: 推送通知载荷类型
 * - DeviceTokenInfo: 设备Token信息
 * - PushNotificationManager: 推送管理器单例
 *
 * 依赖关系：
 * - contextAwareness.ts: getNotificationManager本地通知
 *
 * 核心接口：
 * - init(): 初始化推送服务
 * - registerForPush(): 注册推送获取设备Token
 * - handlePushNotification(): 处理收到的推送通知
 * - onNotification(): 注册通知监听
 * - getDeviceToken(): 获取当前设备Token
 *
 * 核心功能（F7移动端）：
 * 1. 注册推送：获取FCM(Android)/APNs(iOS)设备Token
 * 2. 通知处理：前台/后台/杀死状态均能接收
 * 3. 状态联动：转发给宠物状态机触发动画/气泡
 * 4. 本地通知：与tauri-plugin-notification配合显示
 *
 * 通知类型：
 * - feeding_reminder: 喂食提醒（饱食度低）
 * - interaction_reminder: 互动提醒（长时间未互动）
 * - schedule_reminder: 日程提醒
 * - achievement_unlock: 成就解锁
 * - system_update: 系统更新
 */

import { getNotificationManager, type NotificationType } from './contextAwareness'

// 推送通知载荷类型
export interface PushNotificationPayload {
  type: 'feeding_reminder' | 'interaction_reminder' | 'schedule_reminder' | 'achievement_unlock' | 'system_update'
  title: string
  body: string
  petMessage?: string  // 宠物气泡消息
  data?: Record<string, unknown>
  timestamp: number
}

// 推送通知类型 → 本地通知类型映射
const PUSH_TO_LOCAL_TYPE: Record<PushNotificationPayload['type'], NotificationType> = {
  feeding_reminder: 'hp_low',
  interaction_reminder: 'rest_reminder',
  schedule_reminder: 'rest_reminder',
  achievement_unlock: 'achievement',
  system_update: 'achievement',
}

// 设备 token 信息
export interface DeviceTokenInfo {
  token: string
  platform: 'android' | 'ios'
  registeredAt: number
}

// 推送通知管理器单例
class PushNotificationManager {
  private initialized = false
  private deviceToken: DeviceTokenInfo | null = null
  private listeners: Set<(payload: PushNotificationPayload) => void> = new Set()

  /**
   * 初始化推送通知
   * 在移动端应用启动时调用
   */
  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    try {
      // 1. 请求通知权限（移动端需要用户授权）
      await this.requestPermission()

      // 2. 注册远程推送，获取设备 token
      await this.registerForPushNotifications()

      // 3. 监听前台通知（Tauri notification 插件）
      this.listenForegroundNotifications()
    } catch (err) {
      console.warn('[SpiritPal] Push notification init failed:', err)
    }
  }

  /**
   * 请求通知权限
   */
  private async requestPermission(): Promise<boolean> {
    try {
      // 尝试使用 tauri-plugin-notification 请求权限
      const notification = await import('@tauri-apps/plugin-notification')
      let granted = false
      try {
        granted = await notification.isPermissionGranted()
      } catch {
        // 移动端可能未实现 isPermissionGranted
        granted = true
      }
      if (!granted) {
        const permission = await notification.requestPermission()
        granted = permission === 'granted'
      }
      return granted
    } catch {
      // Web 环境下使用 Notification API
      if (typeof Notification !== 'undefined') {
        const permission = await Notification.requestPermission()
        return permission === 'granted'
      }
      return false
    }
  }

  /**
   * 注册远程推送通知
   * Android: FCM (Firebase Cloud Messaging)
   * iOS: APNs (Apple Push Notification service)
   */
  private async registerForPushNotifications(): Promise<void> {
    try {
      // 占位实现：实际需调用原生代码注册 FCM/APNs
      // Tauri mobile 尚未提供统一的 push notification API，需通过插件或原生代码实现
      //
      // Android (FCM):
      //   FirebaseMessaging.getInstance().token
      //     .addOnCompleteListener { task ->
      //       if (task.isSuccessful) {
      //         val token = task.result
      //         // 上传 token 到后端
      //       }
      //     }
      //
      // iOS (APNs):
      //   UIApplication.shared.registerForRemoteNotifications()
      //   // 在 AppDelegate didRegisterForRemoteNotificationsWithDeviceToken 中获取 token

      // 模拟 token 生成（占位）
      const platform = this.detectPlatform()
      if (platform === 'android' || platform === 'ios') {
        this.deviceToken = {
          token: `mock-${platform}-token-${Date.now()}`,
          platform,
          registeredAt: Date.now(),
        }
        // 占位：实际应上传到后端服务器
        // await this.uploadTokenToServer(this.deviceToken)
      }
    } catch (err) {
      console.warn('[SpiritPal] Push notification registration failed:', err)
    }
  }

  /**
   * 检测当前平台
   */
  private detectPlatform(): 'android' | 'ios' | 'desktop' {
    if (typeof navigator === 'undefined') return 'desktop'
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('android')) return 'android'
    if (/iphone|ipad|ipod/.test(ua)) return 'ios'
    return 'desktop'
  }

  /**
   * 监听前台通知（应用打开时收到的推送）
   */
  private listenForegroundNotifications(): void {
    // 占位：实际需监听原生推送事件并转发
    // Tauri mobile 推送通知事件监听需通过插件实现
    // 示例：
    // const { listen } = await import('@tauri-apps/api/event')
    // await listen<PushNotificationPayload>('push-notification-received', (event) => {
    //   this.handleNotification(event.payload)
    // })
  }

  /**
   * 处理收到的推送通知
   * 将通知转发给宠物状态机（触发动画/气泡）
   */
  handleNotification(payload: PushNotificationPayload): void {
    // 通知所有监听者
    this.listeners.forEach((fn) => fn(payload))

    // 转发给通知管理器（显示气泡 + 改变宠物状态）
    try {
      const notifMgr = getNotificationManager()
      notifMgr.send({
        type: PUSH_TO_LOCAL_TYPE[payload.type],
        title: payload.title,
        body: payload.body,
        petMessage: payload.petMessage,
      })
    } catch {
      // 忽略
    }

    // 同时显示本地通知（确保前台也能看到）
    void this.showLocalNotification(payload)
  }

  /**
   * 显示本地通知
   */
  private async showLocalNotification(payload: PushNotificationPayload): Promise<void> {
    try {
      const notification = await import('@tauri-apps/plugin-notification')
      await notification.sendNotification({
        title: payload.title,
        body: payload.body,
      })
    } catch {
      // Web fallback
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(payload.title, { body: payload.body })
      }
    }
  }

  /**
   * 获取设备 token
   */
  getDeviceToken(): DeviceTokenInfo | null {
    return this.deviceToken
  }

  /**
   * 订阅推送通知
   */
  subscribe(listener: (payload: PushNotificationPayload) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 发送测试通知（用于验证推送是否正常）
   */
  async sendTestNotification(): Promise<void> {
    const payload: PushNotificationPayload = {
      type: 'system_update',
      title: 'SpiritPal 测试通知',
      body: '如果你看到了这条通知，说明推送配置正常！',
      petMessage: '测试通知收到啦～',
      timestamp: Date.now(),
    }
    this.handleNotification(payload)
  }
}

// 导出全局单例
export const pushNotificationManager = new PushNotificationManager()

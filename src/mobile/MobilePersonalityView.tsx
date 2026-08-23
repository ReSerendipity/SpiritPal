/**
 * 移动端性格编辑视图组件
 * @module mobile/MobilePersonalityView
 * @description
 * 移动端性格编辑界面，复用桌面端 PersonalityEditor（五维雷达图 + 说话风格 +
 * 互动偏好 + 作息时间 + 性格模板 + System Prompt 预览）。
 *
 * 数据与桌面端同源（personalityEngine / personalityTemplates），
 * 视觉沿用语义 Token，无平台专属依赖，可直接复用。
 *
 * @see {@link ./MobileSettingsView} 移动端设置视图（入口宿主）
 * @see {@link ../components/PersonalityEditor} 桌面端性格编辑器（复用）
 */
import { PersonalityEditor } from '../components/PersonalityEditor'

/**
 * 移动端性格编辑视图组件
 * @returns 性格编辑界面组件
 */
export function MobilePersonalityView() {
  return (
    <div className="flex h-full w-full flex-col bg-cream text-ink">
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <PersonalityEditor />
      </div>
    </div>
  )
}

/**
 * 宠物界面形态切换（窗口形态 ⇄ 桌面漫游）
 *
 * - 切换到漫游：仅持久化 petForm，漫游行走由 PetWindow 检测 petForm 后
 *   驱动「窗口在桌面移动」（借鉴 Dororo move.gd：窗口跟随宠物，非全屏窗口）
 * - 切换到窗口：仅持久化 petForm，漫游行走停止
 * - 形态持久化在 settingsStore（petForm），供设置页/托盘/右键菜单联动
 */
import { useSettingsStore } from '@/stores/settingsStore'

export type PetForm = 'window' | 'roam'

/** 切换宠物界面形态（同步设置持久化；窗口尺寸/位置不变，漫游 = 窗口在桌面移动） */
export async function switchPetForm(form: PetForm): Promise<void> {
  useSettingsStore.getState().updateSettings({ petForm: form })
}

/** 读取当前形态并翻转（托盘一键切换 / 快捷键） */
export function togglePetForm(): void {
  const current = useSettingsStore.getState().petForm ?? 'window'
  void switchPetForm(current === 'roam' ? 'window' : 'roam')
}

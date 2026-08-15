/**
 * 宠物界面形态切换（窗口形态 ⇄ 桌面漫游）
 *
 * - 切换到漫游：隐藏宠物主窗口，显示底部漫游窗口（宠物在桌面走动）
 * - 切换到窗口：隐藏漫游窗口，显示宠物主窗口
 * - 形态持久化在 settingsStore（petForm），供设置页/托盘/右键菜单联动
 */
import { getAllWindows } from '@tauri-apps/api/window'
import { useSettingsStore } from '../stores/settingsStore'
import { ensureAppWindow } from './appWindows'

export type PetForm = 'window' | 'roam'

/** 切换宠物界面形态（同步设置持久化 + 窗口显隐） */
export async function switchPetForm(form: PetForm): Promise<void> {
  useSettingsStore.getState().updateSettings({ petForm: form })
  try {
    const wins = await getAllWindows()
    const petWin = wins.find((w) => w.label === 'pet-window')
    const roamWin = wins.find((w) => w.label === 'roam-window')

    if (form === 'roam') {
      await petWin?.hide()
      const win = await ensureAppWindow('roam-window')
      await win?.show()
      await win?.setFocus()
    } else {
      await roamWin?.hide()
      await petWin?.show()
      await petWin?.setFocus()
    }
  } catch {
    // 忽略窗口操作错误
  }
}

/** 读取当前形态并翻转（托盘一键切换 / 快捷键） */
export function togglePetForm(): void {
  const current = useSettingsStore.getState().petForm ?? 'window'
  void switchPetForm(current === 'roam' ? 'window' : 'roam')
}

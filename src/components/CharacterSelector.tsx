/**
 * 首次启动角色选择组件
 *
 * 功能概述：
 * - 应用首次启动时显示的角色选择界面
 * - 紧凑纵向布局，适配小窗口显示
 * - 展示所有内置角色卡片，包含主题色头像、口头禅、来源
 * - 悬停时高亮显示角色主题色
 * - 选择后标记首次启动完成并切换到选中角色
 *
 * 核心Hooks/状态：
 * - useState: 管理当前悬停的角色ID
 * - usePetStore/useSettingsStore: 初始化和切换角色
 */
import { useState } from 'react'
import { getAllCharacters } from '../lib/characters'
import { useSettingsStore } from '../stores/settingsStore'
import { usePetStore } from '../stores/petStore'
import { DRAG_SURFACE_CLASS } from './FramelessChrome'

/** 组件Props接口 */
interface CharacterSelectorProps {
  /** 角色选择完成回调 */
  onSelect?: (id: string) => void
}

/**
 * 首次启动角色选择器
 *
 * 展示所有可用角色供用户选择初始伙伴，选择后初始化角色状态
 * 并标记首次启动完成，防止下次启动再次显示。
 */
export function CharacterSelector({ onSelect }: CharacterSelectorProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const switchSettingsChar = useSettingsStore((s) => s.switchCharacter)
  const switchPetChar = usePetStore((s) => s.switchCharacter)
  const initCharacter = usePetStore((s) => s.initCharacter)

  function handleSelect(id: string) {
    initCharacter(id)
    switchPetChar(id)
    switchSettingsChar(id)
    try {
      localStorage.setItem('spiritpal-first-run-done', '1')
    } catch {
      // 忽略存储错误
    }
    onSelect?.(id)
  }

  return (
    <div className="flex h-full w-full flex-col items-center bg-gradient-to-b from-blush-soft via-cream to-cream p-4 text-ink overflow-hidden">
      {/* 标题区（拖拽条：按住可拖动无边框窗口） */}
      <div className={`${DRAG_SURFACE_CLASS} shrink-0 px-2 pt-1 text-center`} data-tauri-drag-region>
        <h1 className="mb-1 text-lg font-bold">欢迎来到 SpiritPal 🐾</h1>
        <p className="mb-3 text-xs text-ink-muted">选择你的第一个伙伴</p>
      </div>

      <div className="w-full max-w-[260px] space-y-2 overflow-y-auto flex-1 min-h-0 pr-1">
        {getAllCharacters().map((c) => {
          const isHovered = hovered === c.id
          return (
            <button
              key={c.id}
              onClick={() => handleSelect(c.id)}
              onMouseEnter={() => setHovered(c.id)}
              onMouseLeave={() => setHovered(null)}
              className="flex w-full items-center gap-3 rounded-xl border-2 p-2 text-left transition-all duration-200"
              style={{
                borderColor: isHovered ? c.themeColor.primary : 'rgba(74,54,38,0.14)',
                background: isHovered
                  ? `linear-gradient(to right, ${c.themeColor.primary}22, rgba(255,253,249,0.75))`
                  : 'rgba(255,253,249,0.75)',
                transform: isHovered ? 'translateX(2px)' : 'none',
              }}
            >
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl font-bold"
                style={{
                  background: `linear-gradient(135deg, ${c.themeColor.primary}, ${c.themeColor.secondary})`,
                }}
              >
                {c.displayName.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-sm font-semibold">{c.displayName}</span>
                  <span className="text-[10px] text-tangerine-deep">「{c.signaturePhrase}」</span>
                </div>
                <div className="truncate text-[10px] text-ink-faint">{c.source}</div>
                <div className="truncate text-[10px] text-ink-muted">{c.emotionalCore}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

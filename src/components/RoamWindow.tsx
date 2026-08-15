/**
 * 桌面漫游形态窗口（QQ 宠物式）
 *
 * 无界面、无边框、透明置顶的漫游窗口：宠物在窗口内来回走动，
 * 非交互区域鼠标穿透（复用 usePixelClickThrough），悬停宠物浮现小气泡，
 * 右键宠物返回宠物主窗口（窗口形态）。
 *
 * 对应高保真主流程 v1.0 · 桌面漫游场景。
 */
import { usePetStore } from '../stores/petStore'
import { getCharacter } from '../lib/characters'
import { switchPetForm } from '../lib/petForm'
import { SpriteRenderer } from './SpriteRenderer'
import { usePixelClickThrough } from '../lib/pixelClickThrough'

export default function RoamWindow() {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const character = getCharacter(currentCharacterId)

  // 像素级点击穿透：透明区域穿透到底层应用，悬停宠物实体区域才可交互
  usePixelClickThrough(true, ['.spiritpal-roam-bubble'], false)

  async function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    // 返回窗口形态：隐藏漫游窗口、显示宠物主窗口，并同步持久化形态
    await switchPetForm('window')
  }

  return (
    <div className="pet-character relative h-screen w-screen overflow-hidden" style={{ background: 'transparent' }}>
      {/* 漫游宠物：左右走动循环动效 */}
      <div className="spiritpal-roam-pet group absolute bottom-6" data-sprite="" onContextMenu={handleContextMenu}>
        <div className="spiritpal-pet-voice spiritpal-roam-bubble pointer-events-none absolute -top-11 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-2xl rounded-br-sm border border-blush bg-surface px-3 py-1 text-[13px] text-ink opacity-0 shadow-soft transition-opacity duration-200 group-hover:opacity-100">
          我去溜达一下～
        </div>
        <SpriteRenderer characterId={currentCharacterId} state="idle" size={0.7} />
      </div>

      {/* 顶部操作提示 */}
      <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full border border-ink/10 bg-surface/85 px-3 py-0.5 text-[10px] text-ink-faint">
        悬停宠物出现气泡 · 右键返回窗口形态
      </div>

      {/* 空角色兜底提示 */}
      {!character && (
        <div className="spiritpal-pet-voice absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-2xl border border-blush bg-surface px-3 py-2 text-sm text-ink shadow-soft">
          还没有伙伴呢，先回主窗口选一个吧～
        </div>
      )}
    </div>
  )
}

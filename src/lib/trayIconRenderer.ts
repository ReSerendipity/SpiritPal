/**
 * 托盘图标渲染器 — 将宠物当前形象帧渲染为 32×32 PNG
 *
 * 参考 ai-bubu 的「宠物帧渲染为托盘图标」能力：
 * - 图集模式：按动画行 + 当前帧裁剪精灵图（与 SpriteRenderer 的 background-position 逻辑一致）
 * - 视频模式：取 [data-sprite] 下当前可见 video 的一帧（双缓冲中 visibility:visible 的那个）
 * - SVG 模式：直接绘制
 * - Live2D 模式（useLive2D）下 DOM 无精灵图，回退为精灵图资源帧
 *
 * 输出 base64（不含 data: 前缀），由 Rust 端 `set_tray_icon_png` 解码后设置到托盘。
 */
import { getCharacter } from './characters'
import { ANIMATION_ROWS, ATLAS, type PetState } from './types'

const TRAY_ICON_SIZE = 32

/** 精灵图资源缓存（避免每次更新都重新下载） */
const imageCache = new Map<string, Promise<HTMLImageElement>>()

/** 与 SpriteRenderer.stateToAnimKey 保持一致：PetState → 精灵图动画行 key */
function petStateToAnimKey(state: PetState): string {
  switch (state) {
    case 'idle': return 'idle'
    case 'walk': return 'walk'
    case 'sleep': return 'waiting'
    case 'sit': return 'waiting'
    case 'eat': return 'waving'
    case 'drag': return 'jumping'
    case 'happy': return 'jumping'
    case 'sad': return 'failed'
    case 'sick': return 'failed'
    case 'pet': return 'waving'
    default: return 'idle'
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  let pending = imageCache.get(src)
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`sprite image load failed: ${src}`))
      img.src = src
    })
    imageCache.set(src, pending)
  }
  return pending
}

/**
 * 渲染宠物当前帧为托盘图标 PNG base64（不含 data: 前缀）
 * @param characterId 角色 ID
 * @param state 当前宠物状态（决定动画行）
 * @param frame 图集当前帧号（由 SpriteRenderer.onFrameChange 提供）
 * @returns base64 PNG 字符串；渲染失败返回 null（调用方静默忽略）
 */
export async function renderPetTrayIcon(
  characterId: string,
  state: PetState,
  frame = 0,
): Promise<string | null> {
  try {
    const character = getCharacter(characterId)
    if (!character) return null
    const canvas = document.createElement('canvas')
    canvas.width = TRAY_ICON_SIZE
    canvas.height = TRAY_ICON_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // 视频模式：抓当前可见缓冲区的帧
    if (character.spriteType === 'video') {
      const vids = document.querySelectorAll<HTMLVideoElement>('[data-sprite] video')
      let target: HTMLVideoElement | null = null
      for (const v of vids) {
        if (getComputedStyle(v).visibility === 'visible' && v.videoWidth > 0) {
          target = v
          break
        }
      }
      if (!target) return null
      ctx.drawImage(target, 0, 0, TRAY_ICON_SIZE, TRAY_ICON_SIZE)
      return canvas.toDataURL('image/png').split(',')[1] ?? null
    }

    const img = await loadImage(character.spriteAsset)

    // SVG 模式：整体缩放绘制
    if (character.spriteType === 'svg') {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(img, 0, 0, TRAY_ICON_SIZE, TRAY_ICON_SIZE)
      return canvas.toDataURL('image/png').split(',')[1] ?? null
    }

    // 图集模式：按动画行 + 当前帧裁剪（与 SpriteRenderer background-position 一致）
    const atlas = character.atlasLayout ?? {
      cellW: ATLAS.cellW,
      cellH: ATLAS.cellH,
      cols: ATLAS.cols,
      rows: ATLAS.rows,
    }
    const row = (ANIMATION_ROWS[petStateToAnimKey(state)] ?? ANIMATION_ROWS.idle).row
    const f = frame % atlas.cols
    const sx = f * atlas.cellW
    const sy = row * atlas.cellH
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, sx, sy, atlas.cellW, atlas.cellH, 0, 0, TRAY_ICON_SIZE, TRAY_ICON_SIZE)
    return canvas.toDataURL('image/png').split(',')[1] ?? null
  } catch {
    // 渲染失败（资源未就绪等）→ 调用方静默忽略，托盘保持上一帧
    return null
  }
}

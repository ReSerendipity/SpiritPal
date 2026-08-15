/**
 * 无边框窗口辅助层（拖拽面 + 缩放手柄）
 *
 * 宠物窗口（pet-window）是 decorations: false + transparent 的无边框窗口：
 * - Windows 下无系统边框可抓取，resizable 只表示"允许缩放"，鼠标仍无法从边缘缩放
 * - 因此这里提供 8 个隐形缩放手柄（四边 + 四角），按下后调用
 *   getCurrentWindow().startResizeDragging(direction) 走系统缩放流程
 * - 拖拽面（spiritpal-drag-surface）配合 data-tauri-drag-region 属性，
 *   让"空白背景"也能拖动整个窗口（QQ 宠物式手感），
 *   同时该 class 需加入 usePixelClickThrough 的交互白名单，
 *   否则像素级点击穿透会把拖拽面判定为透明区域而拦截鼠标
 */
import { useCallback } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 拖拽面标记类（配合 data-tauri-drag-region + 点击穿透交互白名单使用） */
export const DRAG_SURFACE_CLASS = 'spiritpal-drag-surface'

/** 缩放手柄标记类（点击穿透交互白名单使用，悬停时保持窗口可交互） */
export const RESIZE_HANDLE_CLASS = 'spiritpal-resize-handle'

type ResizeDir =
  | 'North'
  | 'South'
  | 'East'
  | 'West'
  | 'NorthWest'
  | 'NorthEast'
  | 'SouthWest'
  | 'SouthEast'

/** 8 个缩放手柄的方位与定位样式（外圈 1.5px 细边 + 四角 10px 兜底） */
const RESIZE_HANDLES: Array<{ dir: ResizeDir; cls: string }> = [
  { dir: 'North', cls: 'top-0 left-3 right-3 h-1 cursor-n-resize' },
  { dir: 'South', cls: 'bottom-0 left-3 right-3 h-1.5 cursor-s-resize' },
  { dir: 'West', cls: 'left-0 top-3 bottom-3 w-1 cursor-w-resize' },
  { dir: 'East', cls: 'right-0 top-3 bottom-3 w-1.5 cursor-e-resize' },
  { dir: 'NorthWest', cls: 'top-0 left-0 h-2.5 w-2.5 cursor-nw-resize' },
  { dir: 'NorthEast', cls: 'top-0 right-0 h-2.5 w-2.5 cursor-ne-resize' },
  { dir: 'SouthWest', cls: 'bottom-0 left-0 h-2.5 w-2.5 cursor-sw-resize' },
  { dir: 'SouthEast', cls: 'bottom-0 right-0 h-2.5 w-2.5 cursor-se-resize' },
]

/**
 * 无边框窗口缩放手柄层
 *
 * 容器 pointer-events-none 不拦截内容交互，仅手柄自身响应鼠标；
 * 手柄按下即调用系统缩放（Windows/Linux 走 SC_SIZE，macOS 走 setFrame）。
 */
export function FramelessResizeHandles() {
  const handleMouseDown = useCallback((e: React.MouseEvent, dir: ResizeDir) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    void getCurrentWindow().startResizeDragging(dir).catch(() => {})
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 z-40" aria-hidden="true">
      {RESIZE_HANDLES.map((h) => (
        <div
          key={h.dir}
          className={`${RESIZE_HANDLE_CLASS} pointer-events-auto absolute ${h.cls}`}
          onMouseDown={(e) => handleMouseDown(e, h.dir)}
        />
      ))}
    </div>
  )
}

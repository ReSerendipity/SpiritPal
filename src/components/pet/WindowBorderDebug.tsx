/**
 * 窗口边框预览（调试用，P0-2 从 PetWindow 拆分）
 *
 * 虚线框标出宠物窗口的实际边界 + 角落显示尺寸/缩放。
 * pointer-events-none 不拦截交互，也不会影响像素穿透判定。
 */
export interface WindowBorderDebugProps {
  visible: boolean
  winW: number
  winH: number
  petSize: number
}

export function WindowBorderDebug({ visible, winW, winH, petSize }: WindowBorderDebugProps) {
  if (!visible) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[60]" aria-hidden="true">
      <div className="absolute inset-0 border-2 border-dashed border-tangerine/70" />
      <div className="absolute left-1 top-1 rounded bg-tangerine/80 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
        {winW}×{winH} · {petSize.toFixed(1)}×
      </div>
    </div>
  )
}

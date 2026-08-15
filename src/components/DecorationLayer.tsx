/**
 * 装饰品渲染层组件
 *
 * 功能概述：
 * - 在宠物精灵上方叠加渲染已穿戴的装饰品
 * - 根据锚点位置（head/body/hand_left/hand_right/back）计算相对偏移
 * - 跟随宠物的scale缩放和facing朝向变化（左右翻转）
 * - back锚点在DOM顺序中先渲染，实现背部层级低于精灵
 * - 其他锚点z-index:2，确保在精灵上方显示
 * - 自动从背包和商店预设查找装饰品emoji图标
 *
 * 核心Hooks/状态：
 * - usePetStore: 背包物品（获取装饰品图标）
 */
import type { CSSProperties } from 'react'
import { usePetStore } from '../stores/petStore'
import { ACCESSORIES } from '../lib/items'
import type { WornDecoration, AnchorPoint } from '../lib/types'

/** 装饰品层组件Props */
interface DecorationLayerProps {
  /** 已穿戴装饰品列表 */
  decorations: WornDecoration[]
  /** 精灵宽度（用于计算装饰品大小） */
  spriteW: number
  /** 精灵高度 */
  spriteH: number
  /** 朝向（left/right），用于水平翻转 */
  facing: 'left' | 'right'
  /** 点击缩放比例 */
  clickScale: number
}

// 各锚点相对于宠物精灵容器的定位
// back 锚点不设 z-index，依赖 DOM 顺序（在精灵前渲染）实现层级低于精灵
// 其他锚点 z-index: 2，确保在精灵上方
const ANCHOR_STYLES: Record<AnchorPoint, CSSProperties> = {
  head: { left: '50%', top: '8%', zIndex: 2 },
  body: { left: '50%', top: '50%', zIndex: 2 },
  hand_left: { left: '-8%', top: '55%', zIndex: 2 },
  hand_right: { left: '108%', top: '55%', zIndex: 2 },
  back: { left: '50%', top: '48%' },
}

/**
 * 装饰品渲染层
 *
 * 根据已穿戴装饰品列表，在对应锚点位置渲染emoji装饰品，
 * 自动适配精灵大小和朝向变化。
 */
export function DecorationLayer({
  decorations,
  spriteW,
  facing,
  clickScale,
}: DecorationLayerProps) {
  const inventory = usePetStore((s) => s.inventory)

  // 查找装饰品的 emoji 图标：先查背包，再查商店预设
  const findIcon = (itemId: string): string | undefined => {
    const invItem = inventory.find((i) => i.id === itemId)
    if (invItem) return invItem.icon
    const accItem = ACCESSORIES.find((i) => i.id === itemId)
    return accItem?.icon
  }

  const emojiSize = Math.round(spriteW * 0.28)

  return (
    <>
      {decorations.map((dec) => {
        const icon = findIcon(dec.itemId)
        if (!icon) return null
        const anchorStyle = ANCHOR_STYLES[dec.anchor]
        const offsetX = dec.offset?.x ?? 0
        const offsetY = dec.offset?.y ?? 0
        return (
          <div
            key={dec.itemId}
            className="pointer-events-none absolute select-none"
            style={{
              ...anchorStyle,
              transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scaleX(${facing === 'left' ? -1 : 1}) scale(${clickScale})`,
              fontSize: `${emojiSize}px`,
              lineHeight: 1,
              transition: 'transform 0.15s ease',
            }}
          >
            {icon}
          </div>
        )
      })}
    </>
  )
}

/**
 * 金币显示组件
 *
 * 功能概述：
 * - 显示游戏内货币数量，支持角色专属货币配置
 * - 不同角色使用不同的货币图标（小鱼干/星光币/羽毛币等）
 * - 金币变化时的数字滚动动画（缓动函数）
 * - 增减状态视觉反馈（放大/缩小、箭头指示）
 * - 支持emoji、图片、SVG三种图标类型
 * - 支持i18n国际化
 *
 * 核心Hooks/状态：
 * - useState: 动画显示值、增减状态
 * - useRef: 前值引用、动画帧ID
 * - useEffect: 金币变化时触发滚动动画
 * - usePetStore: 读取共享金币数和当前角色ID
 * - useTranslation: i18n国际化
 */
import React, { useState, useEffect, useRef } from 'react'
import { usePetStore } from '../stores/petStore'
import { useTranslation } from 'react-i18next'

// ============ 类型定义 ============

/** 金币配置 */
export interface CoinConfig {
  /** 货币名称 */
  name: string
  /** 货币图标（emoji 或图片路径） */
  icon: string
  /** 图标类型 */
  iconType: 'emoji' | 'image' | 'svg'
  /** 货币颜色 */
  color: string
  /** 小数位数（默认 0） */
  decimals?: number
}

/** 默认金币配置 */
const DEFAULT_COIN_CONFIG: CoinConfig = {
  name: '金币',
  icon: '🪙',
  iconType: 'emoji',
  color: '#FFD700',
  decimals: 0,
}

/** 角色金币配置映射 */
const CHARACTER_COIN_CONFIGS: Record<string, CoinConfig> = {
  doro: {
    name: '小鱼干',
    icon: '🐟',
    iconType: 'emoji',
    color: '#4FC3F7',
  },
  feibi: {
    name: '星光币',
    icon: '⭐',
    iconType: 'emoji',
    color: '#FFD700',
  },
  gugugaga: {
    name: '羽毛币',
    icon: '🪶',
    iconType: 'emoji',
    color: '#81C784',
  },
}

// ============ 组件 ============

interface CoinDisplayProps {
  /** 自定义金币配置（覆盖角色默认） */
  coinConfig?: CoinConfig
  /** 是否显示图标 */
  showIcon?: boolean
  /** 是否显示名称 */
  showName?: boolean
  /** 是否启用变化动画 */
  animate?: boolean
  /** 自定义类名 */
  className?: string
}

/**
 * 金币显示组件
 *
 * 展示游戏货币数量，支持角色专属配置和数值变化动画。
 * 优先使用自定义配置，其次根据角色ID查找预设，最后使用默认配置。
 */
export const CoinDisplay: React.FC<CoinDisplayProps> = ({
  coinConfig,
  showIcon = true,
  showName = false,
  animate = true,
  className = '',
}) => {
  const { t } = useTranslation()
  const coins = usePetStore((s) => s.sharedCoins)
  const characterId = usePetStore((s) => s.currentCharacterId)

  // 动画状态
  const [displayValue, setDisplayValue] = useState(coins)
  const [isIncreasing, setIsIncreasing] = useState(false)
  const [isDecreasing, setIsDecreasing] = useState(false)
  const prevCoinsRef = useRef(coins)
  const animationRef = useRef<number | undefined>(undefined)

  // 获取金币配置
  const config = coinConfig ?? CHARACTER_COIN_CONFIGS[characterId] ?? DEFAULT_COIN_CONFIG

  // 金币变化动画
  useEffect(() => {
    const prev = prevCoinsRef.current
    if (prev === coins) return

    if (!animate) {
      // 非动画模式：微任务中同步显示值（effect 主体不直接同步 setState）
      void Promise.resolve().then(() => {
        setDisplayValue(coins)
        prevCoinsRef.current = coins
      })
      return
    }

    const diff = coins - prev
    if (diff > 0) {
      setIsIncreasing(true)
      setIsDecreasing(false)
    } else if (diff < 0) {
      setIsIncreasing(false)
      setIsDecreasing(true)
    }

    // 数字滚动动画
    const startValue = prev
    const endValue = coins
    const duration = 300 // 毫秒
    const startTime = performance.now()

    const animateStep = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)

      // 缓动函数
      const eased = 1 - Math.pow(1 - progress, 3)
      const currentValue = Math.round(startValue + (endValue - startValue) * eased)

      setDisplayValue(currentValue)

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animateStep)
      } else {
        prevCoinsRef.current = coins
        // 延迟清除动画状态
        setTimeout(() => {
          setIsIncreasing(false)
          setIsDecreasing(false)
        }, 200)
      }
    }

    animationRef.current = requestAnimationFrame(animateStep)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [coins, animate])

  // 格式化数字
  const formatNumber = (num: number): string => {
    if (config.decimals && config.decimals > 0) {
      return num.toFixed(config.decimals)
    }
    return num.toLocaleString()
  }

  // 渲染图标
  const renderIcon = () => {
    if (!showIcon) return null

    switch (config.iconType) {
      case 'image':
        return (
          <img
            src={config.icon}
            alt={config.name}
            className="w-4 h-4 inline-block"
          />
        )
      case 'svg':
        return (
          <svg className="w-4 h-4 inline-block" viewBox="0 0 16 16">
            <use href={config.icon} />
          </svg>
        )
      case 'emoji':
      default:
        return <span className="text-sm">{config.icon}</span>
    }
  }

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      title={`${config.name}: ${formatNumber(coins)}`}
    >
      {renderIcon()}
      <span
        className="font-medium tabular-nums transition-transform duration-200"
        style={{
          color: config.color,
          transform: isIncreasing ? 'scale(1.1)' : isDecreasing ? 'scale(0.95)' : 'scale(1)',
        }}
      >
        {formatNumber(displayValue)}
      </span>
      {showName && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t('coins.name', config.name)}
        </span>
      )}
      {/* 变化指示器 */}
      {isIncreasing && (
        <span className="text-xs text-green-500 animate-pulse">+▲</span>
      )}
      {isDecreasing && (
        <span className="text-xs text-red-500 animate-pulse">-▼</span>
      )}
    </div>
  )
}

export default CoinDisplay

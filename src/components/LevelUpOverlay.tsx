/**
 * 升级动画覆盖层组件
 *
 * 功能概述：
 * - 角色升级时显示金色光芒放射效果
 * - 12个彩色粒子向外飞散动画
 * - "LEVEL UP!"文字和新等级显示
 * - 三阶段动画：爆发(0.3s)→文字显示(1.2s)→淡出(0.7s)
 * - 总时长2.2秒后自动调用onComplete
 * - pointer-events-none不阻挡交互
 *
 * 核心Hooks/状态：
 * - useState: 动画阶段（burst/text/fade）
 * - useEffect: 定时器控制动画阶段切换和完成回调
 *
 * 动画关键帧：
 * - spiritpal-levelup-burst: 光芒放射
 * - spiritpal-levelup-particle: 粒子飞散（使用CSS变量--tx/--ty）
 * - spiritpal-levelup-text: 文字弹入
 */
import { useEffect, useState } from 'react'

/** 升级覆盖层Props */
interface LevelUpOverlayProps {
  /** 新等级 */
  level: number
  /** 角色名称 */
  characterName: string
  /** 动画完成回调 */
  onComplete: () => void
}

/**
 * 升级动画覆盖层
 *
 * 在角色升级时显示金色光芒、粒子和升级文字的动画效果。
 */
export function LevelUpOverlay({ level, characterName, onComplete }: LevelUpOverlayProps) {
  const [phase, setPhase] = useState<'burst' | 'text' | 'fade'>('burst')
  // 粒子飞散距离在挂载时一次性生成（惰性初始化），避免每次渲染重新执行 Math.random
  const [particleDists] = useState(() =>
    Array.from({ length: 12 }, () => 60 + Math.random() * 40),
  )

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('text'), 300)
    const t2 = setTimeout(() => setPhase('fade'), 1500)
    const t3 = setTimeout(() => onComplete(), 2200)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [onComplete])

  return (
    <div
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"
      style={{
        opacity: phase === 'fade' ? 0 : 1,
        transition: 'opacity 0.7s ease-out',
      }}
    >
      {/* 光芒放射 */}
      <div
        className="absolute"
        style={{
          width: '200%',
          height: '200%',
          background: 'radial-gradient(circle, rgba(255,215,0,0.3) 0%, rgba(255,215,0,0) 60%)',
          animation: 'spiritpal-levelup-burst 0.6s ease-out forwards',
        }}
      />

      {/* 粒子 */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 30) * (Math.PI / 180)
        const dist = particleDists[i]!
        return (
          <div
            key={i}
            className="absolute h-2 w-2 rounded-full"
            style={{
              background: ['#FFD700', '#FFA500', '#FF6347', '#FF69B4'][i % 4],
              animation: `spiritpal-levelup-particle 1s ease-out forwards`,
              animationDelay: `${i * 0.03}s`,
              '--tx': `${Math.cos(angle) * dist}px`,
              '--ty': `${Math.sin(angle) * dist}px`,
            } as React.CSSProperties}
          />
        )
      })}

      {/* 升级文字 */}
      {phase !== 'burst' && (
        <div
          className="relative text-center"
          style={{
            animation: 'spiritpal-levelup-text 0.5s ease-out forwards',
          }}
        >
          <div className="text-3xl font-bold text-amber-300" style={{ textShadow: '0 0 10px rgba(255,215,0,0.8)' }}>
            LEVEL UP!
          </div>
          <div className="mt-1 text-lg text-white" style={{ textShadow: '0 0 6px rgba(255,255,255,0.5)' }}>
            {characterName} 升到了 Lv.{level}
          </div>
        </div>
      )}
    </div>
  )
}

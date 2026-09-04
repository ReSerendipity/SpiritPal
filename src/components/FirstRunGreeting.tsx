/**
 * 首屏登场组件（方案 B）
 *
 * 首次启动时先由默认宠物登场自我介绍，提供两个软动作：
 * - 「就你了」：零摩擦确认默认伙伴，直接进入日常陪伴
 * - 「再看看别的伙伴」：进入全窗口角色选择页
 *
 * M-1 增强：角色确认后衔接 AI 配置引导提示（不阻断，可跳过）。
 *
 * 对应高保真主流程 v1.0 · 首屏登场场景。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DRAG_SURFACE_CLASS } from './FramelessChrome'
import { SpriteRenderer } from './SpriteRenderer'

interface FirstRunGreetingProps {
  /** 默认角色（可空，空时兜底展示占位名） */
  character?: { id: string; displayName: string }
  /** 确认默认伙伴 */
  onConfirm: () => void
  /** 浏览其他伙伴 */
  onBrowse: () => void
  /** M-1: 确认后跳转 AI 配置 */
  onGotoAIConfig?: () => void
}

export function FirstRunGreeting({ character, onConfirm, onBrowse, onGotoAIConfig }: FirstRunGreetingProps) {
  const { t } = useTranslation()
  const name = character?.displayName ?? '伙伴'
  const charId = character?.id ?? 'doro'
  const [confirmed, setConfirmed] = useState(false)

  function handleConfirm() {
    setConfirmed(true)
    onConfirm()
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-cream">
      {/* 治愈温暖渐变舞台（同时作为窗口拖拽面：按住背景可拖动无边框窗口） */}
      <div
        className={`${DRAG_SURFACE_CLASS} absolute inset-0 bg-gradient-to-b from-blush-soft via-cream to-cream`}
        data-tauri-drag-region
        aria-hidden="true"
      />

      {!confirmed ? (
        <>
          {/* 自我介绍气泡（pointer-events-none 让拖拽事件穿透到背景层） */}
          <div className="pointer-events-none relative z-10 flex flex-col items-start gap-2 px-5 pt-12">
            <div className="spiritpal-pet-voice inline-block max-w-[78%] rounded-2xl rounded-bl-sm border border-blush bg-surface px-3 py-2 text-[15px] text-ink shadow-soft animate-[spiritpal-pop-in_0.6s_ease_0.3s_both]">
              你好呀，我是{name}
            </div>
            <div className="spiritpal-pet-voice inline-block max-w-[78%] rounded-2xl rounded-br-sm border border-tangerine/60 bg-surface px-3 py-2 text-[15px] text-ink shadow-soft animate-[spiritpal-pop-in_0.6s_ease_0.6s_both]">
              以后就让我陪着你吧？
            </div>
          </div>

          {/* 宠物登场（底部居中，限高防止遮挡按钮） */}
          <div
            className="pointer-events-none absolute bottom-20 left-1/2 max-h-[50%] -translate-x-1/2 animate-[spiritpal-pop-in_0.7s_cubic-bezier(0.2,0.9,0.3,1.25)_0.1s_both]"
            aria-hidden="true"
          >
            <SpriteRenderer characterId={charId} state="idle" size={1} />
          </div>

          {/* 双动作（容器穿透让空白区域可拖拽，按钮单独恢复交互） */}
          <div className="pointer-events-none relative z-10 mt-auto w-full px-4 pb-5">
            <button
              onClick={handleConfirm}
              className="pointer-events-auto w-full rounded-full bg-tangerine py-3 text-[15px] font-bold text-white shadow-soft transition hover:bg-tangerine-deep"
            >
              就你了
            </button>
            <button
              onClick={onBrowse}
              className="pointer-events-auto mt-2 w-full text-center text-[13px] text-ink-muted underline decoration-dotted underline-offset-4 transition hover:text-tangerine-deep"
            >
              再看看别的伙伴 →
            </button>
          </div>
        </>
      ) : (
        /* M-1: 角色确认后衔接 AI 配置引导（不阻断，可跳过） */
        <div className="pointer-events-none relative z-10 flex flex-col items-center justify-center gap-4 px-6 pt-16">
          <div className="pointer-events-auto max-w-[80%] rounded-2xl border border-ink/10 bg-surface p-5 text-center shadow-soft animate-[spiritpal-fade-in_0.4s_ease_both]">
            <div className="mb-2 text-base font-bold text-tangerine-deep">{t('firstrun.ai_hint_title')}</div>
            <p className="mb-4 text-sm leading-relaxed text-ink-muted">{t('firstrun.ai_hint_body')}</p>
            <div className="flex justify-center gap-3">
              {onGotoAIConfig && (
                <button
                  onClick={onGotoAIConfig}
                  className="rounded-full bg-tangerine px-5 py-2.5 text-sm font-semibold text-white hover:bg-tangerine-deep"
                >
                  {t('firstrun.ai_hint_goto')}
                </button>
              )}
              <button
                onClick={() => { /* 提示消失，用户直接进入日常陪伴 */ }}
                className="rounded-full bg-cream-deep px-5 py-2.5 text-sm font-medium text-ink-muted hover:bg-ink/5"
              >
                {t('firstrun.ai_hint_skip')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

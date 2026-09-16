/**
 * P1-1 首次使用协议确认门（合规整改 2026-09-15）。
 *
 * 首次启动（或协议版本更新后）展示，必须显式勾选同意后方可进入首屏登场流程。
 * 同意状态按版本号记录于 localStorage（spiritpal:agreement:v1）——协议实质性
 * 更新时递增 AGREEMENT_VERSION 即可让全部用户重新确认。
 *
 * 复用自数据出境确认弹窗的 localStorage 记忆模式（SettingsWindow.tsx）。
 */
import { useState } from 'react'

const AGREEMENT_KEY = 'spiritpal:agreement:v1'
const AGREEMENT_VERSION = '2026-09-15'

/** 是否已接受当前版本的协议（localStorage 不可用时不阻断使用）。 */
export function agreementAccepted(): boolean {
  try {
    return localStorage.getItem(AGREEMENT_KEY) === AGREEMENT_VERSION
  } catch {
    return true
  }
}

export function markAgreementAccepted(): void {
  try {
    localStorage.setItem(AGREEMENT_KEY, AGREEMENT_VERSION)
  } catch {
    // 忽略存储错误（隐私模式等）
  }
}

interface AgreementGateProps {
  /** 同意后回调（进入正常首启流程） */
  onAccept: () => void
}

export function AgreementGate({ onAccept }: AgreementGateProps) {
  const [checked, setChecked] = useState(false)
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-cream px-6">
      <div className="w-full max-w-[420px] rounded-2xl border border-ink/10 bg-surface p-5 shadow-soft">
        <div className="mb-2 text-base font-bold text-ink">使用前须知</div>
        <p className="mb-3 text-[13px] leading-relaxed text-ink-muted">
          继续使用即表示你已阅读并同意
          <a className="text-tangerine-deep underline underline-offset-2" href={"https://github.com/ReSerendipity/SpiritPal/blob/main/USER_AGREEMENT.md"} target="_blank" rel="noopener noreferrer">《用户协议》</a>
          与
          <a className="text-tangerine-deep underline underline-offset-2" href={"https://github.com/ReSerendipity/SpiritPal/blob/main/PRIVACY_POLICY.md"} target="_blank" rel="noopener noreferrer">《隐私政策》</a>：
          不将本工具用于侵权或违法用途（包括未经授权使用他人角色形象、声纹）；选择境外 AI 服务商时对话内容将传输至境外服务器；请勿提交敏感个人信息。
        </p>
        <label className="mb-3 flex items-start gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
          <span>我已阅读并同意《用户协议》《隐私政策》及上述使用要求</span>
        </label>
        <button
          type="button"
          disabled={!checked}
          onClick={() => { markAgreementAccepted(); onAccept() }}
          className={`w-full rounded-full py-2.5 text-sm font-semibold text-white transition ${checked ? 'bg-tangerine hover:bg-tangerine-deep' : 'bg-ink/20'}`}
        >
          同意并开始
        </button>
      </div>
    </div>
  )
}

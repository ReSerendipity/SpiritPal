/**
 * 法律文档展示组件
 *
 * 功能概述：
 * - 模态弹窗展示隐私政策/用户协议等法律文档
 * - 使用react-markdown渲染Markdown格式内容
 * - 走 SpiritPal 语义 Token，浅色/深色主题下均可读
 * - 支持滚动查看长文档
 * - 一键关闭
 *
 * 核心特性：
 * - 自定义Markdown组件样式（标题、段落、列表、链接等）
 * - 语义色令牌排版（bg-surface / text-ink / text-tangerine-deep）
 *
 * 变更记录：
 * - 2026-09-29：由硬编码深色（bg-gray-900 + prose-invert + amber 系）改为语义 Token。
 *   原因：桌面端浅色模式下弹窗是黑底、移动端（默认浅色）接入后同样割裂；
 *   且 amber/gray 系无法响应 html.dark 的令牌覆盖。
 */
import { X } from 'lucide-react'
import Markdown from 'react-markdown'

/** 法律文档组件Props */
interface LegalDocumentProps {
  /** 文档标题 */
  title: string
  /** Markdown格式的文档内容 */
  content: string
  /** 关闭弹窗回调 */
  onClose: () => void
}

/**
 * 法律文档模态弹窗
 *
 * 以Markdown格式渲染隐私政策或用户协议等法律文本。
 */
export function LegalDocument({ title, content, onClose }: LegalDocumentProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative mx-4 max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-ink/10 bg-surface shadow-warm">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-ink/10 px-6 py-4">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-faint hover:bg-ink/10 hover:text-ink"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="overflow-y-auto p-6" style={{ maxHeight: 'calc(80vh - 80px)' }}>
          <div className="max-w-none">
            <Markdown
              components={{
                h1: ({ children }) => <h1 className="mb-4 text-xl font-bold text-ink">{children}</h1>,
                h2: ({ children }) => <h2 className="mb-3 mt-6 text-lg font-semibold text-tangerine-deep">{children}</h2>,
                h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-medium text-ink">{children}</h3>,
                p: ({ children }) => <p className="mb-3 text-sm leading-relaxed text-ink-muted">{children}</p>,
                ul: ({ children }) => <ul className="mb-3 ml-4 list-disc space-y-1 text-sm text-ink-muted">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm text-ink-muted">{children}</ol>,
                li: ({ children }) => <li className="text-sm text-ink-muted">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-tangerine-deep underline hover:opacity-80">
                    {children}
                  </a>
                ),
              }}
            >
              {content}
            </Markdown>
          </div>
        </div>
      </div>
    </div>
  )
}

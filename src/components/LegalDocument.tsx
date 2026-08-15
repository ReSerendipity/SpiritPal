/**
 * 法律文档展示组件
 *
 * 功能概述：
 * - 模态弹窗展示隐私政策/用户协议等法律文档
 * - 使用react-markdown渲染Markdown格式内容
 * - 自定义样式适配深色主题
 * - 支持滚动查看长文档
 * - 一键关闭
 *
 * 核心特性：
 * - 自定义Markdown组件样式（标题、段落、列表、链接等）
 * - Tailwind prose-invert深色排版
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
      <div className="relative mx-4 max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-gray-900 shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="overflow-y-auto p-6" style={{ maxHeight: 'calc(80vh - 80px)' }}>
          <div className="prose prose-invert prose-sm max-w-none">
            <Markdown
              components={{
                h1: ({ children }) => <h1 className="mb-4 text-xl font-bold text-amber-300">{children}</h1>,
                h2: ({ children }) => <h2 className="mb-3 mt-6 text-lg font-semibold text-amber-200">{children}</h2>,
                h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-medium text-amber-100">{children}</h3>,
                p: ({ children }) => <p className="mb-3 text-sm leading-relaxed text-gray-300">{children}</p>,
                ul: ({ children }) => <ul className="mb-3 ml-4 list-disc space-y-1 text-sm text-gray-300">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm text-gray-300">{children}</ol>,
                li: ({ children }) => <li className="text-sm text-gray-300">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-amber-400 underline hover:text-amber-300">
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

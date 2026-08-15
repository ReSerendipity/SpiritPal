/**
 * 对话面板组件
 *
 * 功能概述：
 * - 渲染DialogueManager管理的有向图对话系统
 * - 支持对话节点文本显示、选项按钮选择
 * - 支持栈式回溯（返回上一对话节点）
 * - 对话完成或取消时自动关闭面板
 * - 显示说话者名称（如果有）
 *
 * 核心Hooks/状态：
 * - useState: 当前对话节点、是否可返回
 * - useEffect: 初始化对话图
 * - useCallback: 刷新对话状态函数
 *
 * 使用模块：
 * - dialogueManager: DyberPet风格对话系统管理器
 */
import { useEffect, useState, useCallback } from 'react'
import { getDialogueManager, type DialogueNode } from '../lib/dialogueManager'

/** 对话面板组件Props */
interface DialoguePanelProps {
  /** 对话图ID（如 'welcome'） */
  graphId: string
  /** 角色名称 */
  characterName: string
  /** 关闭面板回调 */
  onClose: () => void
}

/**
 * 有向图对话面板
 *
 * 基于dialogueManager实现的分支对话系统，支持选项选择和回溯返回。
 */
export function DialoguePanel({ graphId, onClose }: DialoguePanelProps) {
  const [currentNode, setCurrentNode] = useState<DialogueNode | null>(null)
  const [canBack, setCanBack] = useState(false)
  const mgr = getDialogueManager()

  const refresh = useCallback(() => {
    setCurrentNode(mgr.getCurrentNode())
    setCanBack(mgr.canGoBack())
  }, [mgr])

  useEffect(() => {
    // startDialogue 同步修改管理器状态；setState 延后到微任务，
    // 使 effect 主体不直接触发同步 setState（语义与渲染循环解耦）
    let cancelled = false
    void Promise.resolve().then(() => {
      const node = mgr.startDialogue(graphId)
      if (cancelled) return
      if (!node) {
        onClose()
        return
      }
      setCurrentNode(node)
      setCanBack(mgr.canGoBack())
    })
    return () => {
      cancelled = true
    }
  }, [graphId, mgr, onClose])

  function handleSelect(index: number) {
    const next = mgr.selectOption(index)
    if (mgr.getState() === 'completed' || mgr.getState() === 'cancelled' || !next) {
      onClose()
      return
    }
    refresh()
  }

  function handleBack() {
    const prev = mgr.goBack()
    if (!prev) {
      refresh()
      return
    }
    refresh()
  }

  if (!currentNode) return null

  return (
    <div className="absolute bottom-20 left-1/2 z-40 w-64 -translate-x-1/2 rounded-xl bg-gray-900/95 p-3 text-white shadow-2xl ring-1 ring-white/10">
      {/* 说话者 */}
      {currentNode.speaker && (
        <div className="mb-1 text-xs font-semibold text-amber-300">{currentNode.speaker}</div>
      )}

      {/* 节点文本 */}
      <p className="mb-3 text-sm leading-relaxed">{currentNode.text}</p>

      {/* 选项 */}
      <div className="flex flex-col gap-1.5">
        {currentNode.options?.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(i)}
            className="rounded-lg bg-gray-700 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-amber-500 hover:text-gray-900"
          >
            {opt.text}
          </button>
        ))}

        {canBack && (
          <button
            onClick={handleBack}
            className="mt-1 rounded-lg border border-gray-600 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:bg-gray-700"
          >
            ← 返回
          </button>
        )}

        {!currentNode.options && (
          <button
            onClick={onClose}
            className="mt-1 rounded-lg bg-gray-700 px-3 py-1.5 text-[13px] text-gray-300 hover:bg-gray-600"
          >
            好的～
          </button>
        )}
      </div>

      {/* 关闭 */}
      <button
        onClick={onClose}
        className="absolute right-2 top-2 text-gray-500 hover:text-gray-300"
        aria-label="关闭对话"
      >
        ✕
      </button>
    </div>
  )
}

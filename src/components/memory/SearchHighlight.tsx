/**
 * SearchHighlight — 记忆搜索关键词高亮
 *
 * 功能概述：
 * - 在一段文本中高亮一个或多个搜索关键词（空格分隔的多关键词）
 * - 大小写不敏感匹配；长词优先，避免短词嵌套遮挡
 * - 纯函数 highlightText 便于单测，组件 SearchHighlight 便于复用
 *
 * 设计说明：
 * - 不修改既有记忆列表组件（EnhancedMemoryList/MemoryFilterBar/MemoryEditModal），
 *   仅提供可被后续接入的高亮原语。
 * - 匹配到的片段渲染为 <mark>，使用项目语义色 tangerine。
 *
 * @module components/memory/SearchHighlight
 */

import React from 'react'

export interface SearchHighlightProps {
  /** 待高亮的原文 */
  text: string
  /** 关键词列表（如 ['昨天', '咖啡']）；空数组时原样返回文本 */
  keywords: string[]
}

/**
 * 将用户输入的搜索串拆分为关键词数组：
 * 按空白拆分、去空格、去空串、去重、按长度降序（长词优先匹配）。
 *
 * @param input 搜索框原始输入（如 "昨天 咖啡 "）
 * @returns 去重并按长度降序排列的关键词数组
 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数工具，与组件同文件导出供单测/复用
export function parseKeywords(input: string): string[] {
  if (!input) return []
  const parts = input
    .split(/\s+/)
    .map((k) => k.trim())
    .filter(Boolean)
  const unique = Array.from(new Set(parts))
  // 长词优先：保证 "apple pie" 先于 "apple" 匹配，避免嵌套高亮
  return unique.sort((a, b) => b.length - a.length)
}

/** 转义正则特殊字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 在文本中高亮关键词，返回可直接渲染的 React 节点数组。
 *
 * - 无关键词或无匹配时返回 [text]（原样）
 * - 大小写不敏感；多关键词同时命中均高亮
 *
 * @param text 原文
 * @param keywords 关键词列表（建议先经 parseKeywords 处理）
 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数工具，与组件同文件导出供单测/复用
export function highlightText(text: string, keywords: string[]): React.ReactNode {
  if (!text) return ''
  const active = (keywords ?? []).map((k) => k).filter(Boolean)
  if (active.length === 0) return text

  const pattern = active.map(escapeRegExp).join('|')
  const regex = new RegExp(`(${pattern})`, 'gi')

  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0
  for (const match of text.matchAll(regex)) {
    const matchText = match[0]
    const matchIndex = match.index ?? 0
    if (matchIndex > lastIndex) {
      nodes.push(text.slice(lastIndex, matchIndex))
    }
    nodes.push(
      <mark key={key++} className="rounded bg-tangerine/30 px-0.5 text-inherit">
        {matchText}
      </mark>,
    )
    lastIndex = matchIndex + matchText.length
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}

/**
 * 搜索高亮组件：在 text 中高亮 keywords。
 */
export function SearchHighlight({ text, keywords }: SearchHighlightProps) {
  return <>{highlightText(text, keywords)}</>
}

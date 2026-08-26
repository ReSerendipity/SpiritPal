/**
 * @file useEnhancedMemory.ts
 * @description Enhanced Memory Hook - 为记忆面板提供查询接口
 */

import { useMemo } from 'react'
import { getKeyframeMemory, type Keyframe } from '../lib/keyframeMemory'
import type { MemoryEntry } from '../lib/types'

export interface SearchResults {
  entries: MemoryEntry[]
  total: number
}

export function useEnhancedMemory(characterId?: string) {
  const keyframeMem = useMemo(() => getKeyframeMemory(), [])

  // 简化实现：直接使用 keyframeMemory 的数据
  const searchMemory = (query: string): MemoryEntry[] => {
    if (!query.trim()) return []
    
    // 从关键帧中查找（模拟记忆搜索）
    const allFrames = keyframeMem.getAllFrames()
    return allFrames.slice(0, 10).map((frame: Keyframe, idx: number) => ({
      created_at: new Date(frame.timestamp).toISOString(),
      user: frame.label || '未知输入',
      assistant: frame.windowInfo || '暂无回复',
    }))
  }

  const getMemoryByTimeRange = (start: number, end: number): SearchResults => {
    const allFrames = keyframeMem.getAllFrames()
    const filtered = allFrames.filter((f: Keyframe) => f.timestamp >= start && f.timestamp <= end)
    
    const entries: MemoryEntry[] = filtered.map((frame: Keyframe) => ({
      created_at: new Date(frame.timestamp).toISOString(),
      user: frame.label || '屏幕活动',
      assistant: frame.windowInfo || '记录',
    }))
    
    return { entries, total: entries.length }
  }

  return {
    searchMemory,
    getMemoryByTimeRange,
  }
}

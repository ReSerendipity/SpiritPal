/**
 * tagCategories.test.ts
 *
 * 标签维度编解码与多维筛选辅助函数单测
 */

import { describe, it, expect } from 'vitest'
import {
  TAG_DIMENSIONS,
  TAG_DIMENSION_LABEL_MAP,
  MEMORY_CATEGORIES,
  makeTag,
  getTagDimension,
  getTagValue,
  parseTag,
  memoryMatchesDimensions,
  toggleInArray,
} from '@/lib/memory/tagCategories'

describe('tagCategories', () => {
  it('TAG_DIMENSIONS 覆盖五个维度且与 label map 一致', () => {
    expect(TAG_DIMENSIONS.map((d) => d.value).sort()).toEqual(
      ['concept', 'event', 'item', 'person', 'place'].sort(),
    )
    for (const d of TAG_DIMENSIONS) {
      expect(TAG_DIMENSION_LABEL_MAP[d.value]).toBe(d.label)
    }
  })

  it('MEMORY_CATEGORIES 为五分类', () => {
    expect(MEMORY_CATEGORIES.map((c) => c.value)).toEqual(['偏好', '习惯', '关系', '事件', '情感'])
  })

  it('makeTag 拼接维度前缀，空文本返回空串', () => {
    expect(makeTag('person', '妈妈')).toBe('person:妈妈')
    expect(makeTag('place', '  公司  ')).toBe('place:公司')
    expect(makeTag('event', '   ')).toBe('')
  })

  it('getTagDimension / getTagValue / parseTag 正确拆分带前缀标签', () => {
    expect(getTagDimension('person:妈妈')).toBe('person')
    expect(getTagValue('person:妈妈')).toBe('妈妈')
    expect(parseTag('place:公司')).toEqual({ dimension: 'place', value: '公司' })
  })

  it('无维度前缀或未知前缀视为未归类', () => {
    expect(getTagDimension('天气')).toBeNull()
    expect(getTagValue('天气')).toBe('天气')
    // 冒号前缀不是已知维度时不识别为维度
    expect(getTagDimension('time:每天8点')).toBeNull()
    expect(getTagValue('time:每天8点')).toBe('time:每天8点')
  })

  it('memoryMatchesDimensions：空选择恒真；非空需命中任一选中维度', () => {
    const tags = ['person:妈妈', 'place:公司', '天气']
    // 未启用维度筛选
    expect(memoryMatchesDimensions(tags, [])).toBe(true)
    // 选中人物 → 命中
    expect(memoryMatchesDimensions(tags, ['person'])).toBe(true)
    // 选中物品 → 无命中
    expect(memoryMatchesDimensions(tags, ['item'])).toBe(false)
    // 多选 OR：人物或物品
    expect(memoryMatchesDimensions(tags, ['person', 'item'])).toBe(true)
    // 未归类标签（天气）在维度筛选启用时不命中
    expect(memoryMatchesDimensions(['天气'], ['person'])).toBe(false)
  })

  it('toggleInArray 切换数组成员', () => {
    expect(toggleInArray(['a'], 'a')).toEqual([])
    expect(toggleInArray(['a'], 'b')).toEqual(['a', 'b'])
  })
})

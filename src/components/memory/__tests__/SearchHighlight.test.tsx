/**
 * @file SearchHighlight.test.tsx
 * @description 记忆搜索高亮工具单测
 *
 * 契约：
 *  1. parseKeywords：空白拆分 / 去空 / 去重 / 长词优先排序
 *  2. highlightText：无关键词原样返回；命中片段包裹 <mark>
 *  3. 大小写不敏感；多关键词同时高亮
 *  4. 正则特殊字符转义；无匹配原样返回
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { parseKeywords, highlightText, SearchHighlight } from '../SearchHighlight'

describe('parseKeywords', () => {
  it('按空白拆分并去空去重', () => {
    expect(parseKeywords('昨天  咖啡 昨天')).toEqual(['昨天', '咖啡'])
  })

  it('空输入返回空数组', () => {
    expect(parseKeywords('')).toEqual([])
    expect(parseKeywords('   ')).toEqual([])
  })

  it('长词优先排序', () => {
    // 'pineapple' 长于 'apple'，排前
    expect(parseKeywords('apple pineapple')).toEqual(['pineapple', 'apple'])
  })
})

describe('highlightText', () => {
  it('空文本返回空串', () => {
    expect(highlightText('', ['x'])).toBe('')
  })

  it('无关键词时原样返回文本', () => {
    expect(highlightText('今天天气不错', [])).toBe('今天天气不错')
  })

  it('命中片段包裹 <mark>', () => {
    const html = renderToStaticMarkup(<>{highlightText('今天喝咖啡了', ['咖啡'])}</>)
    expect(html).toContain('<mark')
    expect(html).toContain('咖啡')
    expect(html.indexOf('今天')).toBeLessThan(html.indexOf('<mark'))
  })

  it('大小写不敏感', () => {
    const html = renderToStaticMarkup(<>{highlightText('Hello World', ['hello'])}</>)
    expect(html).toContain('<mark')
    expect(html).toContain('Hello')
  })

  it('多关键词同时高亮', () => {
    const html = renderToStaticMarkup(
      <>{highlightText('昨天和小张喝咖啡', ['昨天', '咖啡'])}</>,
    )
    expect((html.match(/<mark/g) ?? []).length).toBe(2)
  })

  it('无匹配时原样返回', () => {
    const html = renderToStaticMarkup(<>{highlightText('完全无关的文本', ['火星'])}</>)
    expect(html).not.toContain('<mark')
    expect(html).toContain('完全无关的文本')
  })

  it('正则特殊字符被转义（不抛错、按字面匹配）', () => {
    const html = renderToStaticMarkup(<>{highlightText('a.b 文本', ['a.b'])}</>)
    expect(html).toContain('<mark')
    expect(html).toContain('a.b')
  })
})

describe('SearchHighlight 组件', () => {
  it('渲染命中片段', () => {
    const html = renderToStaticMarkup(<SearchHighlight text="你好世界" keywords={['世界']} />)
    expect(html).toContain('<mark')
    expect(html).toContain('世界')
  })
})

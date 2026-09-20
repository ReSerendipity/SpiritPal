// windowTitleExtractor 测试 — 重点覆盖 extractCodeEntities（经 extractKeyInfo 公开入口）
import { describe, it, expect, beforeEach } from 'vitest'
import { WindowTitleExtractor } from '@/lib/system/windowTitleExtractor'

describe('extractKeyInfo 的代码实体提取', () => {
  let ex: WindowTitleExtractor

  beforeEach(() => {
    ex = new WindowTitleExtractor()
  })

  // processName 命中 /code|-code|idea|webstorm|pycharm/i 才会走 extractCodeEntities
  const entitiesOf = (title: string) => ex.extractKeyInfo(title, 'Code').codeEntities ?? []

  it("单引号 import 取出模块名", () => {
    expect(entitiesOf("app.ts — import x from 'react'")).toContain('react')
  })

  it('双引号 import 不残留引号（回归：旧实现逐次 replace 会漏掉双引号形式）', () => {
    const e = entitiesOf('app.ts — import y from "vue"')
    expect(e).toContain('vue')
    expect(e).not.toContain('"vue"')
  })

  it('多空格分隔的 from 也能解析', () => {
    expect(entitiesOf('x from   "lodash"')).toContain('lodash')
  })

  it('最多取 2 条 import', () => {
    const e = entitiesOf("a from 'one' b from 'two' c from 'three'")
    const picked = ['one', 'two', 'three'].filter((n) => e.includes(n))
    expect(picked.length).toBeLessThanOrEqual(2)
    expect(picked).toEqual(['one', 'two'])
  })

  it('仍会提取函数调用名（去掉尾随括号）', () => {
    expect(entitiesOf('mod.ts — doThing( and more')).toContain('doThing')
  })
})

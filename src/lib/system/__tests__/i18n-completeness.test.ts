/**
 * VR-9：i18n 五语言齐备性守卫
 * - 键集一致性：以 zh 为基准，断言 en/ja/ko/zh-TW 与 zh 键集完全相同（缺键/多键都失败）。
 *   —— 挡住"给某语言加了键、忘了另一语言"这类漏翻。
 * - 插值约定：项目 i18next 配置为单花括号（prefix '{' suffix '}'），
 *   断言任何文案值都不含 '{{' —— 挡住 {{count}} 这类在单括号下会渲染成字面量的写法
 *   （正是 ko msgCount 踩过的坑）。
 */
import { describe, it, expect } from 'vitest'
import i18n from '@/lib/system/i18n'

const LANGS = ['zh', 'en', 'ja', 'ko', 'zh-TW'] as const

function flatten(obj: unknown, prefix = ''): Set<string> {
  const out = new Set<string>()
  if (!obj || typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const p of flatten(v, key)) out.add(p)
    } else {
      out.add(key)
    }
  }
  return out
}

function bundle(lang: string): Record<string, unknown> {
  return (i18n.getResourceBundle(lang, 'translation') ?? {}) as Record<string, unknown>
}

function walkStrings(obj: unknown, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (!obj || typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.push([key, v])
    else if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...walkStrings(v, key))
  }
  return out
}

describe('i18n 五语言齐备性 (VR-9)', () => {
  it('每种语言都注册了非空 translation 资源', () => {
    for (const lang of LANGS) {
      expect(Object.keys(bundle(lang)).length, `${lang} 资源为空/未注册`).toBeGreaterThan(0)
    }
  })

  it('以 zh 为基准，各语言键集一致（除已登记的 char.* 既有翻译债）', () => {
    // 已知债务：角色显示名 char.* 目前仅 zh 落地，其余语言待翻译（非本轮引入，单独排期）。
    // 除此之外任何缺键/多键都视为回归，直接失败。
    // VR-10：char.* 90 键五语言已补齐（2026-10-06），守卫转严格；
    // characters.ts 的 defaultValue 回退保留为未知角色兜底
    const KNOWN_DEBT_PREFIXES: string[] = []
    const isKnownDebt = (k: string) => KNOWN_DEBT_PREFIXES.some((p) => k.startsWith(p))
    const ref = flatten(bundle('zh'))
    for (const lang of LANGS) {
      const s = flatten(bundle(lang))
      const missing = [...ref].filter((k) => !s.has(k) && !isKnownDebt(k)).sort()
      const extra = [...s].filter((k) => !ref.has(k) && !isKnownDebt(k)).sort()
      expect(missing, `${lang} 相对 zh 缺失的键（非 char.*）`).toEqual([])
      expect(extra, `${lang} 相对 zh 多出的键（非 char.*）`).toEqual([])
    }
  })

  it('任何文案值都不含双花括号 {{ }}（项目用单花括号插值）', () => {
    for (const lang of LANGS) {
      for (const [key, val] of walkStrings(bundle(lang))) {
        expect(val, `${lang}.${key} 不应含 {{ }}（单花括号插值下会渲染成字面量）`).not.toMatch(/\{\{/)
      }
    }
  })
})

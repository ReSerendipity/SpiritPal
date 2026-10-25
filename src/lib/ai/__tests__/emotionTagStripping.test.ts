/**
 * @file emotionTagStripping.test.ts
 * @description 情绪协议标签剥离的收窄回归 —— 正向（协议标签剥离）+ 反向（正文方括号文本不误吞）
 *
 * 缺陷修复（2026-10-25）：原 extractEmotion/removeEmotionTags 对任意 [a-zA-Z_]+ 方括号
 * 文本一律清除，会误吞正文（如 Markdown 链接 `[README](https://…)` 被剥成 `(https://…)`）。
 * 收窄后：裸 [word] 仅在命中 EMOTION_MAP 已知关键词时剥离；带 emotion:/motion: 显式前缀的
 * 协议标签无论关键词是否已知都剥离（避免协议残渣漏出）。
 */

import { describe, it, expect } from 'vitest'
import { extractEmotion, extractEmotionFromChunk, removeEmotionTags } from '../emotionExtractor'

describe('情绪标签剥离 · 正向（协议标签必须剥离并驱动动画）', () => {
  it('已知情绪关键词：剥离 + 映射动画 + 好感度标签独立解析', () => {
    const r = extractEmotion('太好了！[happy] 今天天气不错 [affection:+2]')
    expect(r.animations).toContain('happy')
    expect(r.cleanText).not.toContain('[happy]')
    expect(r.cleanText).toContain('今天天气不错')
    expect(r.affectionDeltas).toHaveLength(1)
    expect(r.affectionDeltas[0]?.delta).toBe(2)
  })

  it('显式前缀协议标签即使关键词未知也剥离（避免协议残渣漏出正文）', () => {
    const r = extractEmotion('测试 [emotion:unknown_kw] 结束')
    expect(r.cleanText).not.toContain('emotion:unknown_kw')
    expect(r.animations).toHaveLength(0)
  })

  it('流式 chunk 提取与整段提取同口径', () => {
    expect(extractEmotionFromChunk('好耶 [excited]')).toContain('excited')
    expect(extractEmotionFromChunk('好耶 [excited]')).not.toContain('happy')
  })

  it('removeEmotionTags 剥离已知标签并 trim', () => {
    expect(removeEmotionTags('[happy] 主人好！')).toBe('主人好！')
  })
})

describe('情绪标签剥离 · 反向（正文方括号文本不误吞）', () => {
  it('Markdown 链接的方括号文本保留（原缺陷：[README](url) 被剥成 (url)）', () => {
    const r = extractEmotion('详见 [README](https://example.com) 说明')
    expect(r.cleanText).toContain('[README](https://example.com)')
    expect(r.animations).toHaveLength(0)
  })

  it('普通未知英文方括号词保留', () => {
    expect(removeEmotionTags('参见 [Appendix] 与 [happy]')).toBe('参见 [Appendix] 与')
  })

  it('中文方括号内容本就不匹配协议正则，保持原样', () => {
    expect(removeEmotionTags('这是[重要]说明')).toContain('[重要]')
  })

  it('带空格的方括号短语不匹配协议正则，保持原样（协议标签剥离后保留原有空格）', () => {
    expect(removeEmotionTags('见 [et al] 与 [sad] 章节')).toBe('见 [et al] 与  章节')
  })
})

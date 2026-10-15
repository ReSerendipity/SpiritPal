/**
 * ThinkTagParser 单元测试
 *
 * 重点覆盖 2026-10-15 的两处修正（见 GOTCHAS #180 与 thinkTagParser.ts 头注）：
 *  1. **未出现标签时正文必须立即吐出** —— 旧实现把整段扣在 buffer 里，而调用方只 append
 *     `replyContent`、不 append `flush()` 的返回值，导致无标签的普通回复正文整体丢失。
 *  2. **裸 `</think>`**（开标签被 chat template 预填、不在流里）也要能识别为思考段 ——
 *     这正是端侧 Qwen3 开启 thinking 时的实际输出形态。
 */
import { describe, it, expect } from 'vitest'
import { ThinkTagParser, ThinkTagState } from '@/lib/render/thinkTagParser'

describe('ThinkTagParser', () => {
  it('无标签文本：每个 chunk 立刻进入 replyContent（不扣在 buffer）', () => {
    const p = new ThinkTagParser()
    expect(p.push('你好').replyContent).toBe('你好')
    expect(p.push('呀！').replyContent).toBe('你好呀！')
    expect(p.push('今天也要加油').replyContent).toBe('你好呀！今天也要加油')
    expect(p.flush().replyContent).toBe('你好呀！今天也要加油')
    expect(p.flush().thinkContent).toBe('')
  })

  it('标准 <think>…</think>：思考与回复分离', () => {
    const p = new ThinkTagParser()
    expect(p.push('<think>我在想').thinkContent).toBe('我在想')
    const mid = p.push('要不要吃橘子</think>')
    expect(mid.thinkContent).toBe('我在想要不要吃橘子')
    expect(mid.replyContent).toBe('')
    expect(p.push('好呀！').replyContent).toBe('好呀！')
  })

  it('裸 </think>（开标签被模板预填）：此前已吐出的正文要回溯改判为思考', () => {
    const p = new ThinkTagParser()
    // 前两个 chunk 会被当作正式回复先吐出去
    expect(p.push('让我想想').replyContent).toBe('让我想想')
    // 收到裸结束标签 → 之前那段必须从 reply 挪到 think
    const r = p.push('9.11 和 9.9</think>')
    expect(r.thinkContent).toBe('让我想想9.11 和 9.9')
    expect(r.replyContent).toBe('')
    expect(p.push('9.9 更大！').replyContent).toBe('9.9 更大！')
  })

  it('标签被切在两个 chunk 之间也能识别', () => {
    const p = new ThinkTagParser()
    expect(p.push('正文A<th').replyContent).toBe('正文A')
    const mid = p.push('ink>思考</thi')
    expect(mid.replyContent).toBe('正文A')
    expect(mid.thinkContent).toBe('思考')
    expect(p.push('nk>正文B').replyContent).toBe('正文A正文B')
  })

  it('flush 把仍扣着的标签前缀尾巴按当前状态归类', () => {
    const p = new ThinkTagParser()
    expect(p.push('正文</thi').replyContent).toBe('正文')
    // '</thi' 是 </think> 的前缀，无法判定 → 扣住；flush 时按 Outside 归入正文
    expect(p.flush().replyContent).toBe('正文</thi')

    const p2 = new ThinkTagParser()
    p2.push('<think>半截思考')
    const f = p2.flush()
    expect(f.thinkContent).toBe('半截思考')
    expect(f.replyContent).toBe('')
  })

  it('状态机在流中正确切换，reset 可复用', () => {
    const p = new ThinkTagParser()
    expect(p.push('<think>').state).toBe(ThinkTagState.Inside)
    expect(p.push('</think>').state).toBe(ThinkTagState.Outside)
    p.push('<think>残留')
    p.reset()
    expect(p.flush().thinkContent).toBe('')
    expect(p.push('干净').replyContent).toBe('干净')
  })

  it('多个 think 段与穿插正文都能正确切分', () => {
    const p = new ThinkTagParser()
    const r = p.push('开场<think>第一段</think>中间<think>第二段</think>结尾')
    expect(r.thinkContent).toBe('第一段第二段')
    expect(r.replyContent).toBe('开场中间结尾')
  })
})

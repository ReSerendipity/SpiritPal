// 端侧上下文辅助（助手侧历史去锚定）单元测试
//
// 背景见 GOTCHAS #184：4B 的思维链里明确写出「The conversation history established
// WRONG MATH ... If I repeat it, I look dumb. If I correct it, I break the established
// fiction」—— 模型自己算对了却被自己的历史输出锚死。这里锁定截断语义。
import { describe, expect, it } from 'vitest'
import { ON_DEVICE_ASSISTANT_HISTORY_CHARS, truncateAssistantHistory } from '../onDeviceContext'

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

const long = 'x'.repeat(ON_DEVICE_ASSISTANT_HISTORY_CHARS + 50)

describe('truncateAssistantHistory', () => {
  it('enabled=false 时原样返回（仅浅拷贝，内容不变）', () => {
    const msgs: Msg[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: long },
    ]
    const out = truncateAssistantHistory(msgs, false)
    expect(out).toEqual(msgs)
    expect(out).not.toBe(msgs) // 浅拷贝，调用方不会被原地修改影响
  })

  it('enabled=true 时截断助手侧超长内容，并加省略号', () => {
    const msgs: Msg[] = [{ role: 'assistant', content: long }]
    const out = truncateAssistantHistory(msgs, true)
    expect(out[0]!.content).toBe(long.slice(0, ON_DEVICE_ASSISTANT_HISTORY_CHARS) + '…')
    expect(out[0]!.content.length).toBe(ON_DEVICE_ASSISTANT_HISTORY_CHARS + 1)
  })

  it('助手侧不超长时不动', () => {
    const short = '9.9 更大哦～'
    const out = truncateAssistantHistory([{ role: 'assistant', content: short }], true)
    expect(out[0]!.content).toBe(short)
  })

  it('用户侧与 system 侧永不截断（那是真正的上下文）', () => {
    const msgs: Msg[] = [
      { role: 'system', content: long },
      { role: 'user', content: long },
      { role: 'assistant', content: long },
    ]
    const out = truncateAssistantHistory(msgs, true)
    expect(out[0]!.content).toBe(long)
    expect(out[1]!.content).toBe(long)
    expect(out[2]!.content.length).toBe(ON_DEVICE_ASSISTANT_HISTORY_CHARS + 1)
  })

  it('不原地修改入参', () => {
    const msgs: Msg[] = [{ role: 'assistant', content: long }]
    truncateAssistantHistory(msgs, true)
    expect(msgs[0]!.content).toBe(long)
  })

  it('limit 可覆盖（便于按设备/模型调参）', () => {
    const out = truncateAssistantHistory([{ role: 'assistant', content: 'abcdefghij' }], true, 4)
    expect(out[0]!.content).toBe('abcd…')
  })
})

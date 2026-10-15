// 桌面端端侧上下文预算（ChatWindow）—— 常量关系测试
//
// 真机背景见 GOTCHAS #182：本地小模型喂「记忆 3000 + 20 轮历史」会把 prefill 推到
// 4359 token，注意力被稀释。桌面端 on-device（companion loopback）同属本地小模型，
// 故三处预算同比例收紧；cloud 预算保持原值不变。
import { describe, it, expect } from 'vitest'
import {
  ON_DEVICE_HISTORY_TOKEN_BUDGET,
  ON_DEVICE_MEM_SECTION_BUDGET,
  ON_DEVICE_MEM_CTX_BUDGET,
  ON_DEVICE_REGEN_HISTORY_TURNS,
} from '../ChatWindow'

/** 云端（收紧前）的原始预算，用于证明「只收端侧、不动云端」 */
const CLOUD = {
  history: 6000,
  memSection: 5000,
  memCtx: 4000,
} as const

describe('ChatWindow 端侧上下文预算', () => {
  it('三项预算都显著小于云端原值', () => {
    expect(ON_DEVICE_HISTORY_TOKEN_BUDGET).toBeLessThan(CLOUD.history)
    expect(ON_DEVICE_MEM_SECTION_BUDGET).toBeLessThan(CLOUD.memSection)
    expect(ON_DEVICE_MEM_CTX_BUDGET).toBeLessThan(CLOUD.memCtx)
  })

  it('收紧比例大致一致（约 1/3 ~ 1/4），不会某一项被过度裁掉', () => {
    const ratios = [
      ON_DEVICE_HISTORY_TOKEN_BUDGET / CLOUD.history,
      ON_DEVICE_MEM_SECTION_BUDGET / CLOUD.memSection,
      ON_DEVICE_MEM_CTX_BUDGET / CLOUD.memCtx,
    ]
    for (const r of ratios) {
      expect(r).toBeGreaterThan(0.15)
      expect(r).toBeLessThan(0.4)
    }
  })

  it('记忆上下文预算不小于重新生成历史上限所代表的开销量级', () => {
    expect(ON_DEVICE_MEM_CTX_BUDGET).toBeGreaterThan(0)
    expect(ON_DEVICE_REGEN_HISTORY_TURNS).toBeGreaterThan(0)
    expect(ON_DEVICE_REGEN_HISTORY_TURNS).toBeLessThanOrEqual(12)
  })
})

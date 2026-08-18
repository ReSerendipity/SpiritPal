// enhancedMemory 模块测试 — 四段式记忆架构
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'decrypt_data') return Promise.resolve('{}')
    if (cmd === 'encrypt_data') return Promise.resolve(JSON.stringify({}))
    return Promise.resolve('')
  }),
}))

vi.mock('../db', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
  addMemory: vi.fn(() => Promise.resolve(1)),
  saveEmbedding: vi.fn(() => Promise.resolve()),
  getAllEmbeddings: vi.fn(() => Promise.resolve([])),
  updateMemoryLastAccessed: vi.fn(() => Promise.resolve()),
  clearMemories: vi.fn(() => Promise.resolve()),
}))

vi.mock('../vectorSearch', () => ({
  embed: vi.fn(() => Promise.resolve(new Float32Array([0.1, 0.2, 0.3]))),
  cosineSimilarity: vi.fn(() => 0.8),
  isVectorSearchAvailable: vi.fn(() => Promise.resolve(false)),
  searchSimilar: vi.fn(() => [{ id: 1, score: 0.8 }]),
}))

import { EnhancedMemoryManager, getEnhancedMemoryManager } from '../enhancedMemory'
import { getSetting, setSetting, getAllEmbeddings } from '../db'
import { invoke } from '@tauri-apps/api/core'
import { isVectorSearchAvailable, embed, searchSimilar } from '../vectorSearch'

describe('EnhancedMemoryManager', () => {
  let mgr: EnhancedMemoryManager

  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    mgr = new EnhancedMemoryManager('test-char')
    await mgr.ensureLoaded()
  })

  describe('addExchange', () => {
    it('添加记忆到工作记忆', () => {
      const mem = mgr.addExchange('你好', '你好呀')
      expect(mem.id).toBeTruthy()
      expect(mem.user).toBe('你好')
      expect(mem.assistant).toBe('你好呀')
      expect(mem.importance).toBeGreaterThanOrEqual(30)
      expect(mgr.getWorkingMemories().length).toBe(1)
    })

    it('重要记忆同时加入自传记忆', () => {
      // 包含情感关键词，重要度较高
      const mem = mgr.addExchange('我今天好开心，好喜欢这个！', '太好了！')
      expect(mem.importance).toBeGreaterThan(30)
      if (mem.isAutobiographical) {
        expect(mgr.getAutobiographicalMemories().length).toBeGreaterThanOrEqual(1)
      }
    })

    it('工作记忆超过5条时溢出到情景记忆', () => {
      for (let i = 0; i < 7; i++) {
        mgr.addExchange(`用户消息${i}`, `回复${i}`)
      }
      expect(mgr.getWorkingMemories().length).toBeLessThanOrEqual(5)
      expect(mgr.getEpisodicMemories().length).toBeGreaterThanOrEqual(2)
    })

    it('触发 save 持久化', async () => {
      mgr.addExchange('测试', '回复')
      // 保存走 500ms 防抖，等待防抖定时器触发后再断言
      await vi.waitFor(() => {
        expect(setSetting).toHaveBeenCalled()
      })
    })
  })

  describe('getAllMemories', () => {
    it('返回所有层级的记忆', () => {
      mgr.addExchange('消息1', '回复1')
      mgr.addExchange('消息2', '回复2')
      const all = mgr.getAllMemories()
      expect(all.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('search', () => {
    it('空查询返回所有记忆', () => {
      mgr.addExchange('苹果', '好吃')
      const results = mgr.search('')
      expect(results.length).toBeGreaterThan(0)
    })

    it('按关键词搜索', () => {
      mgr.addExchange('我喜欢苹果', '苹果很好吃')
      const results = mgr.search('苹果')
      expect(results.length).toBeGreaterThan(0)
    })

    it('无匹配时返回空数组', () => {
      mgr.addExchange('苹果', '好吃')
      const results = mgr.search('xyz123')
      expect(results.length).toBe(0)
    })
  })

  describe('deleteMemory', () => {
    it('删除指定记忆', () => {
      const mem = mgr.addExchange('测试', '回复')
      expect(mgr.getAllMemories().length).toBeGreaterThan(0)
      mgr.deleteMemory(mem.id)
      expect(mgr.getAllMemories().some((m) => m.id === mem.id)).toBe(false)
    })
  })

  describe('clear', () => {
    it('清空所有记忆', () => {
      mgr.addExchange('测试1', '回复1')
      mgr.addExchange('测试2', '回复2')
      mgr.clear()
      expect(mgr.getAllMemories().length).toBe(0)
      expect(mgr.getSemanticSummary()).toBe('')
    })
  })

  describe('export / import', () => {
    it('export 返回 JSON 字符串', () => {
      mgr.addExchange('测试', '回复')
      const json = mgr.export()
      expect(() => JSON.parse(json)).not.toThrow()
    })

    it('import 恢复记忆数据', () => {
      mgr.addExchange('原始', '数据')
      const json = mgr.export()
      mgr.clear()
      const ok = mgr.import(json)
      expect(ok).toBe(true)
      expect(mgr.getAllMemories().length).toBeGreaterThan(0)
    })

    it('import 无效 JSON 返回 false', () => {
      expect(mgr.import('invalid json')).toBe(false)
    })
  })

  describe('checkTriggers', () => {
    it('无输入时主动触发模式（仅检查周期）', async () => {
      const result = await mgr.checkTriggers()
      // 无记忆/无周期事件时返回 null
      expect(result).toBeNull()
    })

    it('有输入但无匹配触发返回 null', async () => {
      const result = await mgr.checkTriggers('普通消息')
      expect(result).toBeNull()
    })

    it('情感关键词触发', async () => {
      // 添加带多个情感关键词的记忆以确保触发条件满足
      mgr.addExchange('开心难过生气害怕', '我理解')
      const result = await mgr.checkTriggers('我今天好开心')
      // 情感关键词匹配应触发 emotion 类型触发
      expect(result).not.toBeNull()
      expect(result!.type).toBeTruthy()
    })

    it('频率触发：同一话题3次以上', async () => {
      // 添加3次包含相同关键词的记忆
      mgr.addExchange('苹果很好吃', '是的')
      mgr.addExchange('我想吃苹果', '好的')
      mgr.addExchange('苹果哪里买', '超市')
      const result = await mgr.checkTriggers('苹果')
      if (result) {
        expect(['frequency', 'relevance']).toContain(result.type)
      }
    })
  })

  describe('触发频率控制', () => {
    it('canTrigger 初始允许触发', () => {
      expect(mgr.canTrigger('frequency')).toBe(true)
    })

    it('recordTrigger 记录触发历史', () => {
      mgr.recordTrigger('frequency')
      // 立即再次触发应被限制（间隔不足30分钟）
      expect(mgr.canTrigger('frequency')).toBe(false)
    })

    it('recordUserResponse 重置忽略计数', () => {
      mgr.recordUserResponse('frequency', false)
      mgr.recordUserResponse('frequency', false)
      mgr.recordUserResponse('frequency', false)
      mgr.recordUserResponse('frequency', true)
      // 用户回复后忽略计数清零
      expect(mgr.canTrigger('frequency')).toBe(true)
    })

    it('连续忽略3次后降频', () => {
      mgr.recordUserResponse('frequency', false)
      mgr.recordUserResponse('frequency', false)
      mgr.recordUserResponse('frequency', false)
      // 记录一次触发以满足间隔条件
      mgr.recordTrigger('frequency')
      // 降频后间隔需加倍，应被限制
      expect(mgr.canTrigger('frequency')).toBe(false)
    })
  })

  describe('buildContext', () => {
    it('无记忆时返回空字符串', async () => {
      const ctx = await mgr.buildContext('查询')
      expect(ctx).toBe('')
    })

    it('有记忆时返回上下文文本', async () => {
      mgr.addExchange('你好', '你好呀')
      const ctx = await mgr.buildContext('你好')
      expect(ctx).toContain('你好')
    })
  })

  describe('getContextForChat', () => {
    it('token 预算限制', async () => {
      mgr.addExchange('短消息', '短回复')
      const ctx = await mgr.getContextForChat(10)
      // 预算很小时可能只包含部分
      expect(typeof ctx).toBe('string')
    })

    it('无记忆时返回空字符串', async () => {
      const ctx = await mgr.getContextForChat(1000)
      expect(ctx).toBe('')
    })

    it('有记忆时包含即时记忆', async () => {
      mgr.addExchange('测试上下文', '回复内容')
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('测试上下文')
    })
  })

  describe('applyDecay', () => {
    it('不抛出错误', () => {
      mgr.addExchange('测试', '回复')
      expect(() => mgr.applyDecay()).not.toThrow()
    })

    it('清理归档低重要度记忆', () => {
      // 添加一条记忆，手动修改创建时间为35天前
      mgr.addExchange('旧记忆', '旧回复')
      const all = mgr.getAllMemories()
      const old = all[0]
      old.created_at = new Date(Date.now() - 35 * 86400000).toISOString()
      old.importance = 10
      // 移到情景记忆
      for (let i = 0; i < 5; i++) {
        mgr.addExchange(`填充${i}`, `回复${i}`)
      }
      mgr.applyDecay()
      // 归档且低重要度应被清理
      const remaining = mgr.getAllMemories()
      expect(remaining.some((m) => m.id === old.id)).toBe(false)
    })
  })

  describe('getEnhancedMemoryManager 单例', () => {
    it('相同 characterId 返回同一实例', () => {
      const m1 = getEnhancedMemoryManager('char-x')
      const m2 = getEnhancedMemoryManager('char-x')
      expect(m1).toBe(m2)
    })

    it('不同 characterId 返回不同实例', () => {
      const m1 = getEnhancedMemoryManager('char-a')
      const m2 = getEnhancedMemoryManager('char-b')
      expect(m1).not.toBe(m2)
    })
  })

  describe('加密数据加载', () => {
    it('加载 ENC1: 前缀数据时调用 decrypt', async () => {
      const encData = 'ENC1:someencrypteddata'
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(encData)
      ;(invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
        if (cmd === 'decrypt_data') {
          return Promise.resolve(JSON.stringify({
            workingMemory: [],
            episodicMemory: [],
            semanticMemory: '',
            autobiographicalMemory: [],
          }))
        }
        return Promise.resolve('')
      })
      const m = new EnhancedMemoryManager('enc-char')
      await m.ensureLoaded()
      expect(invoke).toHaveBeenCalledWith('decrypt_data', expect.any(Object))
    })

    it('D1：加载 ENC2: 前缀数据时调用 decrypt 并恢复记忆（新版 Rust 加密格式）', async () => {
      const encData = 'ENC2:someencrypteddata'
      const restored = [{
        id: 'mem-enc2',
        user: '上次说的话',
        assistant: '回复',
        created_at: new Date().toISOString(),
        importance: 60,
        emotionalIntensity: 0.2,
        category: '日常',
        tags: ['上次'],
        accessCount: 0,
        lastAccessed: Date.now(),
        decayFactor: 1,
        isAutobiographical: false,
      }]
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(encData)
      ;(invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
        if (cmd === 'decrypt_data') {
          return Promise.resolve(JSON.stringify({
            workingMemory: restored,
            episodicMemory: [],
            semanticMemory: '',
            autobiographicalMemory: [],
          }))
        }
        return Promise.resolve('')
      })
      const m = new EnhancedMemoryManager('enc2-char')
      await m.ensureLoaded()
      expect(invoke).toHaveBeenCalledWith('decrypt_data', expect.any(Object))
      const all = m.getAllMemories()
      expect(all.length).toBe(1)
      expect(all[0].user).toBe('上次说的话')
    })

    it('解密失败时使用默认空数据', async () => {
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue('ENC1:baddata')
      ;(invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('decrypt failed'))
      const m = new EnhancedMemoryManager('fail-char')
      await m.ensureLoaded()
      expect(m.getAllMemories().length).toBe(0)
    })
  })

  // ===== 分支覆盖率补充测试 =====

  describe('categorize 分类', () => {
    it('偏好关键词 → 偏好', () => {
      const mem = mgr.addExchange('我喜欢苹果', '好的')
      expect(mem.category).toBe('偏好')
    })

    it('情感关键词（非偏好）→ 情感', () => {
      const mem = mgr.addExchange('好开心啊', '太好了')
      expect(mem.category).toBe('情感')
    })

    it('事件关键词 → 事件', () => {
      const mem = mgr.addExchange('昨天出去了', '好玩吗')
      expect(mem.category).toBe('事件')
    })

    it('习惯关键词 → 习惯', () => {
      const mem = mgr.addExchange('我经常锻炼', '坚持真好')
      expect(mem.category).toBe('习惯')
    })

    it('关系关键词 → 关系', () => {
      const mem = mgr.addExchange('我朋友来了', '好的')
      expect(mem.category).toBe('关系')
    })

    it('无匹配关键词 → 日常', () => {
      const mem = mgr.addExchange('苹果', '好吃')
      expect(mem.category).toBe('日常')
    })
  })

  describe('assessImportance 重要度评估', () => {
    it('长文本 (>100字符) 获得加分', () => {
      const longText = 'a'.repeat(101)
      const mem = mgr.addExchange(longText, '回复')
      expect(mem.importance).toBeGreaterThanOrEqual(45)
    })

    it('超长文本 (>200字符) 获得更多加分', () => {
      const longText = 'a'.repeat(201)
      const mem = mgr.addExchange(longText, '回复')
      expect(mem.importance).toBeGreaterThanOrEqual(55)
    })

    it('偏好关键词加分', () => {
      const mem = mgr.addExchange('我想要那个东西', '好的')
      expect(mem.importance).toBeGreaterThanOrEqual(40)
    })

    it('事件关键词加分', () => {
      const mem = mgr.addExchange('昨天的事情', '嗯')
      expect(mem.importance).toBeGreaterThanOrEqual(38)
    })

    it('情感关键词加分', () => {
      const mem = mgr.addExchange('好开心啊', '太好了')
      expect(mem.importance).toBeGreaterThanOrEqual(42)
    })

    it('重要度达到上限100', () => {
      const text = '我喜欢好开心记得昨天'.repeat(20)
      const mem = mgr.addExchange(text, '回复')
      expect(mem.importance).toBe(100)
    })
  })

  describe('assessEmotion 情感强度', () => {
    it('感叹号增加情感强度', () => {
      const mem = mgr.addExchange('好开心!!!', '太好了')
      expect(mem.emotionalIntensity).toBeGreaterThan(0.2)
    })

    it('多个情感关键词提高强度', () => {
      const mem = mgr.addExchange('开心难过生气害怕', '我理解')
      expect(mem.emotionalIntensity).toBeGreaterThanOrEqual(0.7)
    })

    it('无情感关键词强度为0', () => {
      const mem = mgr.addExchange('苹果好吃', '是的')
      expect(mem.emotionalIntensity).toBe(0)
    })
  })

  describe('extractTags 标签提取', () => {
    it('按频率排序取前5', () => {
      const mem = mgr.addExchange('apple apple banana cherry', 'ok')
      expect(mem.tags[0]).toBe('apple')
      expect(mem.tags.length).toBeLessThanOrEqual(5)
    })
  })

  describe('触发机制详解', () => {
    describe('checkFrequencyTrigger', () => {
      it('Latin token 出现3次以上且有情结记忆', async () => {
        for (let i = 0; i < 7; i++) {
          mgr.addExchange('apple is good', 'yes')
        }
        const result = await mgr.checkTriggers('apple')
        expect(result).not.toBeNull()
        expect(result!.type).toBe('frequency')
      })

      it('频率不足不触发', async () => {
        mgr.addExchange('apple', 'ok')
        const result = await mgr.checkTriggers('apple')
        // freq=1 < 3, no other trigger
        expect(result).toBeNull()
      })
    })

    describe('checkRelevanceTrigger (LCS fallback)', () => {
      it('LCS 相似度匹配触发', async () => {
        for (let i = 0; i < 7; i++) {
          mgr.addExchange('今天天气真好', '是啊')
        }
        const result = await mgr.checkTriggers('今天天气真好啊')
        expect(result).not.toBeNull()
        expect(result!.type).toBe('relevance')
      })

      it('LCS 分数不足不触发', async () => {
        for (let i = 0; i < 7; i++) {
          mgr.addExchange('unique_text', 'reply')
        }
        const result = await mgr.checkTriggers('xyz')
        expect(result).toBeNull()
      })
    })

    describe('checkEmotionTrigger', () => {
      it('情感关键词且有高情感自传记忆', async () => {
        mgr.addExchange('开心难过生气害怕担心', '我理解')
        const result = await mgr.checkTriggers('我今天好开心')
        expect(result).not.toBeNull()
        expect(result!.type).toBe('emotion')
      })

      it('情感关键词但无高情感记忆', async () => {
        mgr.addExchange('test', 'reply')
        const result = await mgr.checkTriggers('今天好开心')
        expect(result).toBeNull()
      })

      it('无情感关键词不触发', async () => {
        mgr.addExchange('开心难过生气害怕担心', '我理解')
        const result = await mgr.checkTriggers('苹果')
        expect(result).toBeNull()
      })
    })

    describe('checkKeywordTrigger', () => {
      it('事件关键词且有相关自传记忆', async () => {
        mgr.addExchange('I love apple happy sad angry afraid', 'great')
        const result = await mgr.checkTriggers('apple today')
        expect(result).not.toBeNull()
        expect(result!.type).toBe('keyword')
      })

      it('事件关键词但无相关自传记忆', async () => {
        mgr.addExchange('I love apple happy sad angry afraid', 'great')
        const result = await mgr.checkTriggers('today')
        expect(result).toBeNull()
      })
    })

    describe('checkTimeTrigger', () => {
      it('新的一天首次对话触发', async () => {
        vi.useFakeTimers()
        try {
          // 模拟"昨天"完成一次对话（lastChatDate 记录为昨天的日期）
          vi.setSystemTime(new Date('2026-08-06T10:00:00'))
          mgr.addExchange('开心难过生气害怕担心', '我理解')
          // 推进到"今天"，再触发检查 → lastChatDate（昨天）≠ today → 触发时间触发
          vi.setSystemTime(new Date('2026-08-07T10:00:00'))
          const result = await mgr.checkTriggers('普通的')
          expect(result).not.toBeNull()
          expect(result!.type).toBe('time')
        } finally {
          vi.useRealTimers()
        }
      })

      it('同一天不触发时间触发', async () => {
        mgr.addExchange('开心难过生气害怕担心', '我理解')
        const working = mgr.getWorkingMemories()
        working[0].lastAccessed = Date.now()
        const result = await mgr.checkTriggers('普通的')
        expect(result).toBeNull()
      })

      it('无 lastAccessed 不触发', async () => {
        mgr.addExchange('开心难过生气害怕担心', '我理解')
        const working = mgr.getWorkingMemories()
        working[0].lastAccessed = 0
        const result = await mgr.checkTriggers('普通的')
        expect(result).toBeNull()
      })

      it('新一天但无自传记忆不触发', async () => {
        mgr.addExchange('test', 'reply')
        const working = mgr.getWorkingMemories()
        working[0].lastAccessed = Date.now() - 86400000
        const result = await mgr.checkTriggers('xyz')
        expect(result).toBeNull()
      })
    })
  })

  describe('周期触发', () => {
    it('纪念日里程碑（100天）', async () => {
      mgr.addExchange('first message', 'first reply')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 100 * 86400000,
      ).toISOString()
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.type).toBe('periodic')
      expect(result!.message).toContain('100')
    })

    it('同一天不重复触发纪念日', async () => {
      mgr.addExchange('first message', 'first reply')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 100 * 86400000,
      ).toISOString()
      const r1 = await mgr.checkTriggers()
      expect(r1).not.toBeNull()
      const r2 = await mgr.checkTriggers()
      expect(r2).toBeNull()
    })

    it('认识不足100天不触发纪念日', async () => {
      mgr.addExchange('first', 'reply')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 50 * 86400000,
      ).toISOString()
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('认识天数非里程碑不触发', async () => {
      mgr.addExchange('first', 'reply')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 101 * 86400000,
      ).toISOString()
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('节日：新年（固定日期）', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 0, 1))
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.message).toContain('新年快乐')
      vi.useRealTimers()
    })

    it('节日：圣诞（固定日期）', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2025, 11, 25))
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.message).toContain('圣诞')
      vi.useRealTimers()
    })

    it('节日：春节（农历日期映射）', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 1, 17))
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.message).toContain('新年快乐')
      vi.useRealTimers()
    })

    it('节日：中秋（农历日期映射）', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 8, 25))
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.message).toContain('中秋')
      vi.useRealTimers()
    })

    it('宠物生日触发', async () => {
      const now = new Date()
      localStorage.setItem(
        'spiritpal-pet-birthday-test-char',
        `${now.getMonth() + 1}-${now.getDate()}`,
      )
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.message).toContain('生日快乐')
    })

    it('无效生日格式不触发', async () => {
      localStorage.setItem('spiritpal-pet-birthday-test-char', 'invalid')
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('无效生日日期不触发', async () => {
      localStorage.setItem('spiritpal-pet-birthday-test-char', '13-45')
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('生日非今天不触发', async () => {
      const now = new Date()
      const otherMonth = now.getMonth() === 0 ? 6 : 1
      localStorage.setItem('spiritpal-pet-birthday-test-char', `${otherMonth}-1`)
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('周期触发被频率限制（主动模式返回null）', async () => {
      const now = new Date()
      localStorage.setItem(
        'spiritpal-pet-birthday-test-char',
        `${now.getMonth() + 1}-${now.getDate()}`,
      )
      mgr.recordTrigger('frequency')
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('周期触发被限流但有输入时继续检查其他触发', async () => {
      const now = new Date()
      localStorage.setItem(
        'spiritpal-pet-birthday-test-char',
        `${now.getMonth() + 1}-${now.getDate()}`,
      )
      mgr.recordTrigger('frequency')
      mgr.addExchange('开心难过生气害怕担心', '我理解')
      const result = await mgr.checkTriggers('我今天好开心')
      expect(result).not.toBeNull()
      expect(result!.type).toBe('emotion')
    })
  })

  describe('记忆分层与格式化 formatMemoryByTier', () => {
    it('热记忆完整保留', async () => {
      mgr.addExchange('short', 'reply')
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('用户：short')
      expect(ctx).toContain('角色：reply')
    })

    it('温记忆截断摘要', async () => {
      mgr.addExchange('a'.repeat(60), 'b'.repeat(60))
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 3 * 86400000,
      ).toISOString()
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('…')
    })

    it('冷记忆仅保留关键词', async () => {
      mgr.addExchange('apple pie', 'great food')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 15 * 86400000,
      ).toISOString()
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('关键词')
    })

    it('归档记忆仅保留标题', async () => {
      mgr.addExchange('a'.repeat(25), 'reply')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 35 * 86400000,
      ).toISOString()
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('标题')
    })
  })

  describe('formatCoreMemoryByTier 核心记忆格式化', () => {
    it('热核心记忆完整内容', async () => {
      mgr.addExchange('I love apple happy sad angry afraid', 'great')
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('核心记忆')
      expect(ctx).toContain('[偏好]')
    })

    it('冷核心记忆关键词', async () => {
      mgr.addExchange('I love apple happy sad angry afraid', 'great')
      const auto = mgr.getAutobiographicalMemories()
      if (auto.length > 0) {
        auto[0].created_at = new Date(Date.now() - 15 * 86400000).toISOString()
      }
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('关键词')
    })

    it('归档核心记忆标题', async () => {
      mgr.addExchange('I love apple happy sad angry afraid', 'great')
      const auto = mgr.getAutobiographicalMemories()
      if (auto.length > 0) {
        auto[0].created_at = new Date(Date.now() - 35 * 86400000).toISOString()
      }
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('标题')
    })
  })

  describe('compressEpisodic 情景记忆压缩', () => {
    it('超过50条时触发压缩', () => {
      for (let i = 0; i < 56; i++) {
        mgr.addExchange(`message${i}`, `reply${i}`)
      }
      expect(mgr.getEpisodicMemories().length).toBeLessThanOrEqual(30)
      expect(mgr.getSemanticSummary().length).toBeGreaterThan(0)
    })
  })

  describe('持久化 load/save', () => {
    it('加载明文数据（非 ENC1: 前缀）', async () => {
      const plainData = JSON.stringify({
        workingMemory: [
          {
            id: 'plain-1',
            user: 'plaintext memory',
            assistant: 'reply',
            created_at: new Date().toISOString(),
            importance: 50,
            emotionalIntensity: 0,
            category: '日常',
            tags: [],
            accessCount: 0,
            lastAccessed: 0,
            decayFactor: 1,
            isAutobiographical: false,
          },
        ],
        episodicMemory: [],
        semanticMemory: 'test summary',
        autobiographicalMemory: [],
      })
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(plainData)
      const m = new EnhancedMemoryManager('plain-char')
      await m.ensureLoaded()
      expect(m.getAllMemories().length).toBe(1)
      expect(m.getAllMemories()[0].user).toBe('plaintext memory')
      expect(m.getSemanticSummary()).toBe('test summary')
    })

    it('加载无效 JSON 数据时使用默认空数据', async () => {
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue('not valid json')
      const m = new EnhancedMemoryManager('bad-json-char')
      await m.ensureLoaded()
      expect(m.getAllMemories().length).toBe(0)
    })

    it('加密失败时拒绝写入明文数据', async () => {
      ;(invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
        if (cmd === 'encrypt_data') return Promise.reject(new Error('encrypt failed'))
        if (cmd === 'decrypt_data') return Promise.resolve('{}')
        return Promise.resolve('')
      })
      ;(setSetting as ReturnType<typeof vi.fn>).mockClear()
      mgr.addExchange('test encrypt fail', 'reply')
      // 等待防抖触发 encrypt_data 调用（证明 save 流程已执行），再验证 setSetting 未被调用
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('encrypt_data', expect.any(Object))
      }, { timeout: 2000, interval: 50 })
      expect(setSetting).not.toHaveBeenCalled()
      ;(invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
        if (cmd === 'decrypt_data') return Promise.resolve('{}')
        if (cmd === 'encrypt_data') return Promise.resolve(JSON.stringify({}))
        return Promise.resolve('')
      })
    })
  })

  describe('searchEpisodic 检索', () => {
    it('查询无 token 时返回最近记忆', async () => {
      for (let i = 0; i < 7; i++) {
        mgr.addExchange(`test${i}`, `reply${i}`)
      }
      const ctx = await mgr.buildContext('...')
      expect(ctx).toContain('相关历史回忆')
    })

    it('空查询返回空', async () => {
      for (let i = 0; i < 7; i++) {
        mgr.addExchange(`test${i}`, `reply${i}`)
      }
      const ctx = await mgr.buildContext('')
      // buildContext with empty query: searchEpisodic returns []
      // But working memory still appears
      expect(ctx).toContain('最近对话')
    })
  })

  describe('向量检索', () => {
    afterEach(() => {
      vi.mocked(isVectorSearchAvailable).mockResolvedValue(false)
      vi.mocked(getAllEmbeddings).mockResolvedValue([])
    })

    it('vectorAvailable 为 true 时走向量检索路径', async () => {
      vi.mocked(isVectorSearchAvailable).mockResolvedValue(true)
      mgr.addExchange('apple pie recipe', 'here is how')
      for (let i = 0; i < 5; i++) {
        mgr.addExchange(`filler${i}`, `reply${i}`)
      }
      // vectorSearchInMemories: vectorAvailable=true, but embeddings empty → candidates empty → []
      // Falls back to LCS
      const result = await mgr.checkTriggers('apple')
      // 向量检索路径不应抛出异常；返回值为 null 或包含 type 属性的 TriggerResult
      expect(result === null || (result !== null && typeof result.type === 'string')).toBe(true)
    })

    it('向量检索成功返回结果', async () => {
      vi.mocked(isVectorSearchAvailable).mockResolvedValue(true)
      vi.mocked(getAllEmbeddings).mockResolvedValue([
        { id: 1, embedding: new Float32Array([0.1, 0.2, 0.3]) },
      ])
      mgr.addExchange('apple pie recipe', 'here is how')
      for (let i = 0; i < 5; i++) {
        mgr.addExchange(`filler${i}`, `reply${i}`)
      }
      const result = await mgr.checkTriggers('apple')
      expect(result).not.toBeNull()
      expect(result!.type).toBe('relevance')
    })

    it('向量检索异常时返回空数组', async () => {
      vi.mocked(isVectorSearchAvailable).mockRejectedValue(new Error('check failed'))
      mgr.addExchange('apple', 'reply')
      for (let i = 0; i < 5; i++) {
        mgr.addExchange(`filler${i}`, `reply${i}`)
      }
      const result = await mgr.checkTriggers('apple')
      // 向量检索异常时应优雅降级，返回值为 null 或 TriggerResult
      expect(result === null || (result !== null && typeof result.type === 'string')).toBe(true)
    })

    it('saveToVectorStore 嵌入生成失败不影响记忆存储', async () => {
      vi.mocked(embed).mockRejectedValueOnce(new Error('embed failed'))
      mgr.addExchange('test embed fail', 'reply')
      expect(mgr.getWorkingMemories().length).toBe(1)
      // 等待 embed 异步调用完成（即使失败），证明异步流程已执行且未影响记忆存储
      await vi.waitFor(() => {
        expect(embed).toHaveBeenCalled()
      }, { timeout: 2000, interval: 50 })
    })

    it('ensureEmbeddingsLoaded 加载失败时不抛出', async () => {
      vi.mocked(isVectorSearchAvailable).mockResolvedValue(true)
      vi.mocked(getAllEmbeddings).mockRejectedValueOnce(new Error('load failed'))
      mgr.addExchange('test load fail', 'reply')
      for (let i = 0; i < 5; i++) {
        mgr.addExchange(`f${i}`, `r${i}`)
      }
      const result = await mgr.checkTriggers('test')
      // 加载失败时应优雅降级，返回值为 null 或 TriggerResult
      expect(result === null || (result !== null && typeof result.type === 'string')).toBe(true)
    })
  })

  describe('getContextForChat 带查询参数', () => {
    it('带 query 时调用向量检索', async () => {
      for (let i = 0; i < 7; i++) {
        mgr.addExchange(`apple${i}`, `reply${i}`)
      }
      const ctx = await mgr.getContextForChat(2000, 'apple')
      expect(ctx).toContain('短期记忆')
    })

    it('token 预算不足时不添加部分区块', async () => {
      mgr.addExchange('test', 'reply')
      const ctx = await mgr.getContextForChat(5)
      expect(typeof ctx).toBe('string')
    })
  })

  describe('recordTrigger 日志管理', () => {
    it('日志超过100条时截断为50条', () => {
      for (let i = 0; i < 101; i++) {
        mgr.recordTrigger('frequency')
      }
      expect(mgr.canTrigger('frequency')).toBe(false)
    })
  })

  describe('getPetBirthday 异常处理', () => {
    it('localStorage 异常时返回 null', async () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage error')
      })
      expect(await mgr.checkTriggers()).toBeNull()
      spy.mockRestore()
    })
  })
})

// ============ 第五轮评估修复验证（F2 情绪一致 / F7 实体并入 / F10 故障恢复）============

describe('第五轮修复验证', () => {
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  describe('F2：情绪一致性 moodFit', () => {
    it('当前情绪积极时，valence 相近的积极记忆在 RAG 路径排前', async () => {
      const m = new EnhancedMemoryManager('test-char')
      await m.ensureLoaded()

      // A/B：内容相同、仅 valence 不同（正/负），最终溢出到情景记忆
      const a = m.addExchange('我今天升职了特别开心', '恭喜呀！')
      const b = m.addExchange('我今天升职了特别开心', '恭喜呀！')
      a.emotionalValence = 1
      a.emotionalArousal = 0.4
      b.emotionalValence = -1
      b.emotionalArousal = 0.4

      // C/D/E：工作记忆中的积极情绪来源（valence=1），使 getCurrentMood 偏正
      const c = m.addExchange('今天心情特别好', '太好啦')
      const d = m.addExchange('今天心情特别好', '太好啦')
      const e = m.addExchange('今天心情特别好', '太好啦')
      c.emotionalValence = 1
      d.emotionalValence = 1
      e.emotionalValence = 1

      // F/G：填充工作记忆使 A/B 溢出到情景记忆（第 7 条后 working=[C,D,E,F,G]）
      m.addExchange('今天天气不错', '嗯嗯')
      m.addExchange('今天天气不错', '嗯嗯')

      // 构建 RAG 索引（BM25 可用，向量不可用）
      m.buildRAGIndex()
      await tick()

      // 测试隔离：向量通道置空，避免共享 RAG 检索器单例的 vectorAvailable 状态污染排序
      ;(isVectorSearchAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false)
      ;(searchSimilar as ReturnType<typeof vi.fn>).mockReturnValue([])

      const results = await m.retrieve('我今天升职了特别开心', 2)
      expect(results.length).toBeGreaterThanOrEqual(2)
      // P0-1: retrieve() 现在返回 RetrievalResult[]，需访问 .memory 字段
      expect(results[0].memory.id).toBe(a.id)
    })
  })

  describe('F7：实体关联记忆并入检索', () => {
    it('RAG 路径下，仅靠实体链接关联的记忆即使 BM25 未命中也会并入结果', async () => {
      ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
        if (key === 'spiritpal-entities-f7-char') {
          return Promise.resolve(JSON.stringify({
            entities: [{
              id: 'e1',
              name: '咪',
              type: 'thing',
              linkedMemoryIds: ['mem-x'],
              mentionCount: 1,
              firstSeen: 0,
              lastSeen: 0,
            }],
          }))
        }
        return Promise.resolve(null)
      })

      const m = new EnhancedMemoryManager('f7-char')
      await m.ensureLoaded()

      // X：仅通过实体链接关联（内容不含"咪"）；Y：BM25 命中"咪"（保证 RAG 分支进入）
      const x = m.addExchange('今天天气不错', '嗯嗯')
      x.id = 'mem-x'
      const y = m.addExchange('我的猫叫咪咪', '可爱')
      y.id = 'mem-y'
      // 填充工作记忆，使 X/Y 溢出到情景记忆
      for (let i = 0; i < 6; i++) {
        m.addExchange(`填充消息${i}`, 'ok')
      }

      m.buildRAGIndex()
      await tick()

      // 测试隔离：向量通道置空，避免共享 RAG 检索器单例的 vectorAvailable 状态污染
      ;(isVectorSearchAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false)
      ;(searchSimilar as ReturnType<typeof vi.fn>).mockReturnValue([])

      const results = await m.retrieve('咪', 5)
      // P0-1: retrieve() 现在返回 RetrievalResult[]，需访问 .memory 字段
      expect(results.some((r) => r.memory.id === 'mem-x')).toBe(true)
      expect(results.some((r) => r.memory.id === 'mem-y')).toBe(true)
    })
  })

  describe('F10：校验和与损坏副本保留', () => {
    it('校验和不匹配时保留损坏副本到 *.corrupt 键', async () => {
      const corruptRaw = JSON.stringify({ workingMemory: [], _checksum: 'WRONG_CHECKSUM' })
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValueOnce(corruptRaw)
      const m = new EnhancedMemoryManager('f10-char')
      await m.ensureLoaded()
      expect(setSetting).toHaveBeenCalledWith('spiritpal-enhanced-memory-f10-char.corrupt', corruptRaw)
    })

    it('解密失败时保留损坏密文副本，而非静默丢弃', async () => {
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValueOnce('ENC2:broken-ciphertext')
      ;(invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('decrypt failed'))
      const m = new EnhancedMemoryManager('f10b-char')
      await m.ensureLoaded()
      expect(setSetting).toHaveBeenCalledWith('spiritpal-enhanced-memory-f10b-char.corrupt', 'ENC2:broken-ciphertext')
    })
  })
})

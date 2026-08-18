# God Tests 拆分方案（审计 P1-6）

> 依据 TEST_AUDIT_REPORT.md P1-6：拆分 God Tests（>500 行）为更小、更聚焦的测试组。
> 状态：已执行「纯函数」部分的机械拆分；其余给出精确映射方案，可按本文件逐步执行。

## 1. 已执行拆分

### enhancedMemory.test.ts（1126 行 → 1054 + 107 行）

- 新文件 `src/lib/__tests__/enhancedMemory-pure.test.ts`：`enhancedMemory 纯函数` describe（stringSimilarity / tokenize / estimateTokens，13 个用例）。
- 原文件保留 `EnhancedMemoryManager` 全部用例（102 个），删除纯函数块的 import 项（stringSimilarity、tokenize、estimateTokens）。
- 验证：两文件合计 115 用例全部通过（vitest run）。

## 2. 剩余拆分映射（建议继续执行）

### 2.1 enhancedMemory.test.ts（剩余 1054 行）

| 新文件 | 迁移的 describe 块 | 行范围（拆分前结构） |
|---|---|---|
| `enhancedMemory-manager-basic.test.ts` | addExchange / getAllMemories / search / deleteMemory / clear / export、import / 单例 | 125-230, 351-364 |
| `enhancedMemory-triggers.test.ts` | checkTriggers / 触发频率控制 / 触发机制详解（checkFrequencyTrigger 等 5 个）/ 周期触发 | 230-327, 524-767 |
| `enhancedMemory-context.test.ts` | buildContext / getContextForChat / applyDecay / getContextForChat 带查询参数 | 294-351, 989-1004 |
| `enhancedMemory-classify.test.ts` | categorize / assessImportance / assessEmotion / extractTags | 432-523 |
| `enhancedMemory-persistence.test.ts` | 加密数据加载 / 持久化 load/save / searchEpisodic / 向量检索 / F10 校验和 | 365-431, 843-988, 1116-1125 |
| `enhancedMemory-tiering.test.ts` | 记忆分层与格式化 / formatCoreMemoryByTier / compressEpisodic | 768-842 |
| `enhancedMemory-misc.test.ts` | recordTrigger 日志管理 / getPetBirthday / F2 情绪一致性 / F7 实体关联 | 1005-1115 |

共享 setup 复用：每个新文件头部复制统一模板——

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn((cmd: string) => {
  if (cmd === 'decrypt_data') return Promise.resolve('{}')
  if (cmd === 'encrypt_data') return Promise.resolve(JSON.stringify({}))
  return Promise.resolve('')
}) }))
vi.mock('../db', () => ({ getSetting: vi.fn(() => Promise.resolve(null)), setSetting: vi.fn(() => Promise.resolve()),
  addMemory: vi.fn(() => Promise.resolve(1)), saveEmbedding: vi.fn(() => Promise.resolve()),
  getAllEmbeddings: vi.fn(() => Promise.resolve([])), updateMemoryLastAccessed: vi.fn(() => Promise.resolve()),
  clearMemories: vi.fn(() => Promise.resolve()) }))
vi.mock('../vectorSearch', () => ({ embed: vi.fn(() => Promise.resolve(new Float32Array([0.1, 0.2, 0.3]))),
  cosineSimilarity: vi.fn(() => 0.8), isVectorSearchAvailable: vi.fn(() => Promise.resolve(false)),
  searchSimilar: vi.fn(() => [{ id: 1, score: 0.8 }]) }))
// 每个文件内：
let mgr: EnhancedMemoryManager
beforeEach(async () => { vi.clearAllMocks(); localStorage.clear();
  ;(getSetting as any).mockResolvedValue(null); mgr = new EnhancedMemoryManager('test-char'); await mgr.ensureLoaded() })
```

### 2.2 s2-memory-migration.test.ts（674 行）

| 新文件 | 迁移的 describe 块 |
|---|---|
| `s2-migration-rows.test.ts` | S2: 行级 CRUD / S2: memory_id ↔ embedding 对账 / S2: 行级 load 路径 / S2: 行级 save 路径 |
| `s2-migration-scenarios.test.ts` | S2: 迁移场景 — 4 种存量库场景 / S2: corrupt 保留逻辑 |
| `s2-migration-flags.test.ts` | S2: 迁移标记 / S2: 双模式回退 / S2: export/import 兼容 |
| `s2-migration-lifecycle.test.ts` | S2: 遗忘/巩固/合并行级化验证 |

### 2.3 aiAgent.test.ts（650 行）

| 新文件 | 迁移的 describe 块 |
|---|---|
| `aiAgent-tools.test.ts` | AGENT_TOOLS / detectAgentIntent / 工具 execute 函数 |
| `aiAgent-rule-fallback.test.ts` | processAgentRequest（规则回退） |
| `aiAgent-llm.test.ts` | processAgentRequest（LLM 意图解析） |
| `aiAgent-intent.test.ts` | matchIntent / toolOpenApplication - shell 元字符校验 |

## 3. 风险提示

- 拆分前先跑一次全量 vitest 作为基线；每拆一个文件跑一次确认无回归。
- 隐式顺序依赖：未发现 before/after hooks 跨 describe 共享状态，各 describe 的 beforeEach 自包含，风险低。
- 共享 mock 模板复制会导致 mock 定义重复；若未来 mock 行为变化需同步多处（可后续抽成 `__tests__/helpers/` 共享工厂）。

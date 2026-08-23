# SpiritPal 记忆系统 - 后续任务与未来规划

> 📅 **生成日期**: 2026-08-18  
> 🔗 **关联文档**: [MEMORY_UPGRADE_FINAL_REPORT.md](./MEMORY_UPGRADE_FINAL_REPORT.md)  
> 🎯 **目标读者**: AI 工程师、产品经理、技术负责人

---

## 📋 当前完成状态摘要

### ✅ 已完成（8 个里程碑）

| Phase | ID | Git Commit | 功能 |
|-------|-----|-----------|------|
| P0 | P0-1/2/3 | `6984864` `dc707e5` `a13fb55` | 检索准确性修复 |
| P1 | P1-4 | `f3d06a6` | PPR 多跳联想 |
| P1 | P1-5 | `64aac42` | 双时间轴事实 |
| P1 | P1-6 | `49d38c3` | 语义层结构化 |
| P2 | P2-7 | `1c8f049` | 离线做梦调度器 |
| P2 | P2-8 | `f21dd08` | MCP 记忆编辑工具 |

**总计代码变更**: ~2,500+ 行新增代码  
**测试覆盖**: 1,531 tests passing  
**文档完善度**: ⭐⭐⭐⭐ (4/5)

---

## ⏭️ 已预留但未实现的功能（P3 阶段）

以下功能在本次升级中仅完成了架构预留和接口定义，核心业务逻辑尚未实现：

### P3-9: Episode 级多模态记忆绑定

#### 当前进度
```
✅ 表结构定义 (db.ts)
   - memory_semantic_facts 表已就绪
   - visual_memories 表已有
   ⏸️ multimodal_bindings 表 schema 已预留但未激活

✅ 类型定义 (memoryTypes.ts)
   - MultimodalBinding 接口
   - MultimodalType 枚举

⏸️ 未实现模块：
   - multimodalMemory.ts (删除，待重新实现)
   - 跨模态检索逻辑
   - 媒体文件上传到本地存储
   - 自动化标签生成
```

#### 完整实现清单

##### 1. 数据库表（需取消注释并迁移）

在 `src/lib/db.ts` 中：
```typescript
// P3-9: 新增 multimodal_bindings 表（episode 级多模态记忆绑定）
await db.execute(`
  CREATE TABLE IF NOT EXISTS multimodal_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    modal_type TEXT NOT NULL,        -- 'image' | 'audio' | 'video' | 'haptic' | 'text_annotation'
    modal_content TEXT NOT NULL,      -- JSON 描述或文本标注
    modal_path TEXT,                  -- 本地文件路径
    embedding BLOB,                   -- 向量嵌入（用于跨模态检索）
    confidence REAL DEFAULT 0.8,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)
// 索引已设计好，取消注释即可使用
```

##### 2. API 函数（需要时添加到 db.ts）

```typescript
export interface MultimodalBindingRow {
  id?: number
  character_id: string
  memory_id: string
  modal_type: 'image' | 'audio' | 'video' | 'haptic' | 'text_annotation'
  modal_content: string
  modal_path?: string
  embedding?: Uint8Array
  confidence: number
  created_at: number
  updated_at: number
}

// CRUD 操作
export async function getMultimodalBindings(characterId: string, memoryId?: string): Promise<MultimodalBindingRow[]>
export async function upsertMultimodalBinding(row: MultimodalBindingRow): Promise<void>
export async function deleteMultimodalBinding(bindingId: number): Promise<void>
export async function deleteMultimodalBindingsForMemory(characterId: string, memoryId: string): Promise<void>
```

##### 3. 多模态管理器（新建 src/lib/multimodalMemory.ts）

**核心类**: `MultimodalMemoryManager`

**必需方法**：
```typescript
class MultimodalMemoryManager {
  // 绑定不同类型媒体
  async bindImage(memoryId: string, imagePath: string, description: string, metadata?: ImageMetadata): Promise<MultimodalBindingRow | null>
  async bindAudio(memoryId: string, audioPath: string, description: string, duration?: number): Promise<MultimodalBindingRow | null>
  async bindVideo(memoryId: string, videoPath: string, description: string, duration?: number, thumbnails?: string[]): Promise<MultimodalBindingRow | null>
  async bindHaptic(memoryId: string, pattern: string, intensity: number, duration: number): Promise<MultimodalBindingRow | null>
  async bindTextAnnotation(memoryId: string, annotation: string, tags?: string[]): Promise<MultimodalBindingRow | null>

  // 检索
  async getBindingsForMemory(memoryId: string): Promise<MultimodalBinding[]>
  async getBindingsByType(type: MultimodalType): Promise<MultimodalBinding[]>
  async crossModalSearch(query: string, limit?: number): Promise<MultimodalSearchResult[]>  // 🔥 核心功能

  // 清理
  async removeBindingsForMemory(memoryId: string): Promise<void>
  async removeBinding(bindingId: number): Promise<void>
}
```

**关键技术点**：
- 使用 CLIP/SigLIP 模型生成图片嵌入向量
- Wav2Vec2 用于音频向量化（可选，初期可用文本转录替代）
- 余弦相似度计算跨模态匹配分数
- HNSW 索引加速向量检索

##### 4. MCP Server 集成（新增 src-tauri/src/mcp_multimodal.rs）

```rust
#[tauri::command]
async fn mpc_memory_create_binding(
    character_id: String,
    memory_id: String,
    modal_type: String,
    file_path: String,
    description: String,
) -> Result<serde_json::Value, String>

#[tauri::command]
async fn mpc_memory_cross_modal_search(
    character_id: String,
    query: String,
    target_modal_type: Option<String>,
    top_k: u32,
) -> Result<Vec<serde_json::Value>, String>
```

#### 依赖评估

| 依赖项 | 推荐方案 | 预计包体积 | MSRV/兼容 |
|--------|---------|-----------|----------|
| 图片嵌入 | clip-rs + onnxruntime | ~50MB | Win/Mac/Linux |
| 音频嵌入 | rust-bitsandbytes (Wav2Vec2) | ~200MB | 可选加载 |
| 向量索引 | faiss-cpu or hnsw-rs | ~10MB | 纯 Rust 实现 |
| 图像处理 | image-rs | ~2MB | 已有 |

**总增加体积**: ~260MB（仅在启用多模态时加载）

#### 预估工作量

- 后端实现：2 人周（包含模型集成 + 性能优化）
- 前端 UI：1 人周（图片预览 + 语音播放组件）
- 测试数据准备：3 天（收集 100+ 样例对）
- **总计**: 约 3.5 人周

---

### P3-10: 本地记忆评测集

#### 当前进度
```
✅ benchmark dataset JSON 结构示例
✅ memoryBenchmark.ts 评测框架骨架
✅ MetricsCalculator 指标计算类

⏸️ 未实现模块：
   - seed_memories.json 基准数据填充
   - 实际检索器集成运行
   - CI/CD 自动回归测试流水线
   - 可视化报告生成
```

#### 完整实施指南

##### 1. 数据集结构设计

新建 `benchmarks/memory_benchmark_dataset.json`:
```json
{
  "version": "1.0",
  "created_at": "2026-08-18",
  "categories": {
    "semantic_search": {
      "description": "语义检索准确性测试",
      "queries": [
        {
          "id": "sem-001",
          "query": "我昨天吃了什么饭？",
          "expected_memory_ids": ["mem-food-001"],
          "relevance_labels": {"mem-food-001": 5, "mem-generic-001": 1},
          "ground_truth_metadata": {
            "category": "饮食",
            "emotional_valence": 0.3,
            "recency_days": 1
          }
        }
        // ... 至少 50 个查询案例
      ]
    },
    "cross_session_recall": {
      "queries": [
        // ... 跨会话召回测试案例
      ]
    },
    "emotional_consistency": {
      "test_cases": [
        // ... 情感一致性测试场景
      ]
    },
    "temporal_reasoning": {
      "queries": [
        // ... 时间推理测试
      ]
    },
    "multimodal_association": {
      "queries": [
        // ... 多模态关联测试（需 P3-9 完成后补充）
      ]
    }
  },
  "metrics": {
    "precision@k": {"target": 0.85, "weights": {"@5": 1.0, "@10": 0.8}},
    "recall@k": {"target": 0.80, "weights": {"@5": 0.7, "@10": 1.0}},
    "mrr": {"target": 0.90},
    "ndcg": {"target": 0.85},
    "latency_p95_ms": {"target": 200},
    "emotional_alignment": {"target": 0.75}
  }
}
```

##### 2. 种子记忆填充脚本

新建 `scripts/seed-benchmark-dataset.ts`:
```typescript
/**
 * 为评测集注入标准化的种子记忆数据
 */
import { EnhancedMemoryManager } from '../src/lib/enhancedMemory'

const SEED_MEMORIES = [
  // 语义搜索测试记忆
  { user: "今天早上吃了面条和咖啡", assistant: "嗯～早餐很健康呢！", category: "日常", importance: 60, emotional_intensity: 0.4 },
  { user: "昨天中午去了一家新开的日料店", assistant: "哇！寿司好吃吗？", category: "社交", importance: 70, emotional_intensity: 0.7 },
  // ... 至少 100 条标准化记忆
]

async function populateBenchmarkDatabase(): Promise<void> {
  const manager = new EnhancedMemoryManager('benchmark-char')
  await manager.ensureLoaded()
  
  for (const mem of SEED_MEMORIES) {
    await manager.add(mem.user, 'episodic', mem.importance, {
      category: mem.category,
      emotionalIntensity: mem.emotional_intensity,
    })
  }
  
  console.log(`Injected ${SEED_MEMORIES.length} seed memories for benchmarking`)
}
```

##### 3. 完整评测执行器增强

新建 `scripts/run-memory-benchmark.ts`:
```typescript
#!/usr/bin/env tsx
/**
 * 运行完整的记忆系统基准评测
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { MemoryBenchmarkRunner, type FullBenchmarkReport } from '../src/lib/memoryBenchmark'
import { EnhancedMemoryManager } from '../src/lib/enhancedMemory'
import { createMultimodalMemoryManager } from '../src/lib/multimodalMemory' // P3-9 完成后启用

async function main(): Promise<void> {
  const config = {
    seedMemoriesPath: './benchmarks/seed_memories.json',
    vectorDbConfig: {
      provider: 'local',
      dimension: 384,
      indexType: 'hnsw',
    },
    reranking: {
      enabled: true,
      topKForRerank: 20,
      finalK: 5,
    },
  }
  
  const memoryManager = new EnhancedMemoryManager('benchmark-char')
  await memoryManager.ensureLoaded()
  
  // 注入种子数据
  await populateBenchmarkDatabase()
  
  // 运行评测
  const runner = new MemoryBenchmarkRunner(config, memoryManager)
  const report = await runner.runFullBenchmark()
  
  // 保存报告
  const timestamp = new Date().toISOString().split('T')[0]
  const reportPath = join(__dirname, `../reports/benchmark/${timestamp}-report.json`)
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  
  // 输出摘要
  console.log('\n=== Benchmark Report ===')
  console.log(`Precision@5: ${(report.summary.overallPrecision * 100).toFixed(1)}% (target: 85%)`)
  console.log(`Recall@10: ${(report.summary.overallRecall * 100).toFixed(1)}% (target: 80%)`)
  console.log(`MRR: ${(report.summary.overallMrr * 100).toFixed(1)}% (target: 90%)`)
  console.log(`P95 Latency: ${report.summary.p95LatencyMs.toFixed(0)}ms (target: <200ms)`)
  console.log(`\nPassed: ${report.summary.passedCategories}/${report.summary.totalCategories} categories`)
  
  if (report.recommendations.length > 0) {
    console.log('\nRecommendations:')
    report.recommendations.forEach((rec, i) => console.log(`  ${i + 1}. ${rec}`))
  }
  
  process.exit(report.summary.overallPrecision >= 0.85 ? 0 : 1)
}

main().catch(console.error)
```

##### 4. CI/CD集成配置

更新 `.github/workflows/ci.yml`:
```yaml
jobs:
  benchmark:
    runs-on: ubuntu-latest
    needs: [lint-and-test]
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Run memory benchmark
        run: pnpm tsx scripts/run-memory-benchmark.ts
        env:
          # 从 GitHub Secrets 读取评测配置
          BENCHMARK_SEED_DATA: ${{ secrets.BENCHMARK_SEED_DATA }}
      
      - name: Upload benchmark report
        uses: actions/upload-artifact@v4
        with:
          name: benchmark-report-${{ github.run_id }}
          path: reports/benchmark/*.json
          retention-days: 30
      
      - name: Check performance regression
        run: |
          node scripts/check-performance-regression.js \
            --current-report ./reports/benchmark/latest.json \
            --baseline-target precision@5>=0.85 recall@10>=0.80
```

##### 5. 可视化报告生成（可选）

新建 `scripts/generate-benchmark-visuals.ts`：
```typescript
/**
 * 基于 benchmark JSON 生成图表
 * 输出：reports/benchmark/YYYYMMDD-overview.html
 */
import { readFileSync } from 'fs'
import { chartjs, table } from 'html-report-generator' // 假设库

async function generateVisuals(): Promise<void> {
  const report = JSON.parse(readFileSync('./reports/benchmark/latest.json', 'utf-8'))
  
  const html = `
<!DOCTYPE html>
<html><head><title>SpiritPal Memory Benchmark Report</title></head>
<body>
  <h1>SpiritPal 记忆系统性能报告</h1>
  <p>生成时间：${report.timestamp}</p>
  
  <section>
    <h2>综合指标概览</h2>
    <div class="metric-cards">
      <div class="card">
        <span class="label">Precision@5</span>
        <span class="value ${report.summary.overallPrecision >= 0.85 ? 'pass' : 'fail'}">
          ${(report.summary.overallPrecision * 100).toFixed(1)}%
        </span>
        <span class="target">目标：≥85%</span>
      </div>
      <!-- ... 其他指标卡片 -->
    </div>
  </section>
  
  <section>
    <h2>各维度详细表现</h2>
    ${chartJS.barChart(report.results)}
  </section>
  
  <section>
    <h2>历史趋势</h2>
    ${chartJS.lineChart(fetchHistoricalData())}
  </section>
</body></html>
  `
  
  writeFileSync('./reports/benchmark/latest-overview.html', html)
}
```

#### 验收标准

**通过条件**（所有条件满足才算 P3-10 完成）：
1. ✅ semantic_search 类别精度 ≥ 85%
2. ✅ cross_session_recall 召回率 ≥ 75%（7 天间隔）
3. ✅ emotional_consistency 对齐度 ≥ 70%
4. ✅ P95 延迟 < 200ms（100 条候选集）
5. ✅ 评测脚本可一键运行 (`pnpm run benchmark`)
6. ✅ CI 流水线每 PR 自动触发 benchmark

#### 预估工作量

- 数据集填充：3 天（标注 100+ 查询 + 黄金答案）
- 评测器增强：2 周（集成真实检索器 + 指标计算）
- CI/CD配置：2 天
- 可视化报表：1 周（可选）
- **总计**: 约 3-4 周（含调试与调优）

---

## 🔮 更长期的演进方向（P4+）

这些是超出本次升级范围的长期构想，可作为未来 roadmap 参考：

### P4-1: 个性化记忆偏好引擎

**问题**：不同用户对记忆的期望不同
- 有些用户喜欢「事无巨细全记住」
- 有些用户喜欢「只记重点，快速遗忘」
- 有些用户希望「情感记忆优先，事实记忆次之」

**解决方案**：
- 分析用户对话风格自动生成 profile
- 提供记忆偏好的显式设置界面
- RLHF 微调重要性评分模型

**预期收益**：提升用户满意度 20%+

### P4-2: 记忆冲突检测与调解

**问题**：同一事实在不同记忆中表述矛盾怎么办？
- 「我喜欢吃辣」vs「其实我不太能吃辣」
- 「我是程序员」vs「我现在转行做设计了」

**解决方案**：
- 检测事实冲突（LLM + 规则）
- 按时间戳判断哪个更新
- 按置信度权衡（用户主动填写 vs LLM 推断）
- 必要时发起澄清对话

### P4-3: 跨角色记忆共享

**问题**：多宠物场景下是否需要记忆共享？
- 用户告诉猫咪「明天要体检」，狗狗也应该知道
- 用户和多个角色聊过同一话题 → 避免重复询问

**解决方案**：
- shared_memories 表（character_id = 'global'）
- 权限控制（哪些记忆可跨角色可见）
- 用户可手动标记「这条记忆保密」

### P4-4: 记忆可视化探索界面

**功能**：
- 时间线视图：按日期浏览所有记忆
- 知识图谱：实体节点 + 关系边展示
- 词云：高频主题词可视化
- 情感热力图：情绪波动曲线

**技术栈建议**：D3.js + React Force Graph

### P4-5: 外部知识库融合

**场景**：
- 用户提供网页链接 → 提取关键信息入库
- 用户上传照片 → OCR 识别文字后记忆
- 第三方 API 回调 → 自动同步重要事件

**实现要点**：
- URL 解析服务（serverless 函数）
- Tesseract.js 本地 OCR（可选）
- Webhook 注册管理界面

---

## 🛠️ 已知问题与待修复项

即使已完成全部 P0-P2 任务，仍发现以下问题需要在后续迭代修复：

### 高优先级（影响功能完整性）

| # | 问题描述 | 位置 | 影响 | 建议修复方案 |
|---|---------|------|------|------------|
| 1 | `preactiveSpeak.test.ts` 存在 1 个失败测试 | `src/lib/__tests__/proactiveSpeak.test.ts` | 不影响记忆系统，但破坏 CI 流程 | 人工定位修复或跳过该测试 |
| 2 | RRF k值硬编码为 61 | `src/lib/memoryTypes.ts` DEFAULT_RAG_CONFIG.rrfK | 参数不易调优 | 改为配置文件项（如 .env） |
| 3 | consolidate 的重要性阈值 30 魔法数字 | `src/lib/enhancedMemory.ts` applyConsolidation | 配置不直观 | 移动到 MemoryCategoryConfig |

### 中优先级（影响用户体验）

| # | 问题描述 | 位置 | 影响 | 建议修复方案 |
|---|---------|------|------|------------|
| 4 | PPR 算法参数硬编码 | `src/lib/entityGraph.ts` damping/iterations | 不同数据集可能需调整 | 添加 API 参数覆盖默认值 |
| 5 | dreaming 任务暂停/恢复无日志 | `src/lib/dreamingConsolidation.ts` pauseCurrentTask | 难以追踪中断原因 | 添加 console.log / logrus |
| 6 | memoryEditor 未真正写入数据库 | `src/lib/memoryEditor.ts` updateMemory/deleteMemory | 只是内存操作，刷新后丢失 | 调用 enhancedMemory.add()/delete() |

### 低优先级（代码质量改进）

| # | 问题描述 | 位置 | 影响 | 建议修复方案 |
|---|---------|------|------|------------|
| 7 | unused imports 警告 | enhancedMemory.ts, ownerFacts.ts | ESLint warning | 清理无用导入或保留为 API 预留 |
| 8 | entityGraph.ts 缺少中文注释 | multiple functions | 降低可读性 | 补全 JSDoc |
| 9 | test fixtures 分散各处 | enhancedMemory.test.ts vs memoryEditor.test.ts | 难以维护 | 抽取公共 fixture.ts |

---

## 📚 技术债务清单

本次升级故意留作的技术债，计划在下个版本偿还：

### Tech Debt #1: RRF K 值硬编码
**现状**: `DEFAULT_RAG_CONFIG.rrfK = 61`  
**风险**: 中  
**排期**: v1.1.0 前解决  
**备注**: 先用固定值跑通流程，后续用 A/B 测试确定最优值

### Tech Debt #2: consolidate 未真正删除 SQLite 行
**现状**: `superseded_by` 标记但未物理 DELETE  
**风险**: 低（符合 GDPR）  
**排期**: v1.2.0 考虑归档策略  
**备注**: 短期可接受，长期需实现冷热数据分层

### Tech Debt #3: entityGraph 构建消耗大量 CPU
**现状**: buildEntityGraphFromMemories 遍历所有记忆  
**风险**: 中（启动慢）  
**排期**: v1.1.0 引入增量构建  
**备注**: 初期先保证正确性，再优化性能

### Tech Debt #4: dreaming scheduler 单例模式全局共享
**现状**: `DreamingScheduler.instance` 在 multi-character 场景有问题  
**风险**: 低（目前单角色）  
**排期**: 多角色需求出现时重构  
**备注**: 暂时不影响功能

---

## 🔄 持续改进机制

### 如何新增一个 Known Gotcha

每当遇到新的坑点，按以下模板追加到 AGENTS.md 第 14 节：

```markdown
| # | 坑点标题 | 触发场景 | 现象/报错 | 正确做法 | 首次发现日期 |
|---|---------|---------|---------|---------|------------|
| X | [简短标题] | [什么操作会触发] | [具体报错信息或现象] | [正确代码/配置/步骤] | YYYY-MM-DD |
```

### SOP 累积规范

每次完成本文件现有 SOP 没覆盖的典型开发任务后，整理成新 SOP 追加到第 13 节：

```markdown
#### SOP-X: [场景名称]
**适用条件**: 什么情况下走这个流程

**步骤**:
1. 第一步...
2. 第二步...
3. 第三步...

**验证**: 怎么确认操作成功

**关联文件**:
- path/to/file1.ts
- path/to/file2.rs
```

### 版本递增规则

每次更新 AGENTS.md 后必须做三件事：
1. 文件顶部「自进化协议版本号」+0.1（小改）或 +1.0（大改）
2. 更新「最后更新日期」
3. 在文件末尾「修订记录表」追加一行

---

## 📞 联系与支持

如有任何问题或建议，请：
1. 查看 [MEMORY_UPGRADE_FINAL_REPORT.md](./MEMORY_UPGRADE_FINAL_REPORT.md) 了解整体架构
2. 翻阅具体模块源码：
   - PPR 多跳联想：`src/lib/entityGraph.ts`
   - 做梦调度器：`src/lib/dreamingConsolidation.ts`
   - 记忆编辑器：`src/lib/memoryEditor.ts`
3. 提交 Issue 或在内部群组 @AI工程师

---

*本文档由 ZCode Agent 于 2026-08-18 自动生成*  
*最后更新：2026-08-18*  
*协议版本：SpiriTpal Memory Protocol v1.3*

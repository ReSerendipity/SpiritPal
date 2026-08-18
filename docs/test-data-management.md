# 测试数据管理规范（审计 P2-7）

> 依据 TEST_AUDIT_REPORT.md P2-7：建立测试数据管理规范（fixtures/、mock-data/）。
> 现状：审计发现仓库无 fixtures/ 目录，测试数据硬编码在测试文件内。

## 1. 目录约定

```
tests/
└── data/                     # 测试数据统一存放（新增）
    ├── fixtures/             # 共享固定数据（JSON 快照、卡片样例、日程文本）
    │   ├── characters/       #   character card JSON 样例
    │   ├── schedules/        #   日程解析文本样例
    │   └── mods/             #   petmod 清单样例
    ├── mock-data/            # mock 响应（IPC/LLM/API 返回样例）
    └── generators/           # 数据工厂（faker 风格确定性生成）
```

## 2. 规则

1. **不硬编码**：新测试禁止把多行 JSON/长文本 fixture 内联在测试文件里；从 `tests/data/` 导入。
2. **确定性**：随机数据必须带固定 seed（如 `seededRandom(42)`），保证可复现。
3. **隔离**：store/db 测试沿用现有约定——`beforeEach` 中 `localStorage.clear()` + `vi.clearAllMocks()`；新增 SQLite 集成测试必须使用独立临时库文件（`:memory:` 或 tmp 文件 + afterEach 删除）。
4. **脱敏**：fixture 中的用户数据一律用虚构数据；禁止提交真实 API key、token、个人聊天记录。
5. **小体积**：单文件 fixture ≤ 100KB；大文件（模型、音频）不入库，用脚本生成。

## 3. 落地步骤

- 首批迁移：把 `modManager.test.ts` / `scheduleManager.test.ts` 里内联的 manifest 与日程文本移到 fixtures。
- 新写测试直接按本规范执行；存量测试逐步迁移，不做一次性大重构。

## 4. 与 CI 的关系

- fixtures 目录随 `src/**` 一起被 pnpm test 读取（vitest 直接 import）。
- 数据隔离机制保障 `workers` 并行时不互相污染（未来提升 E2E workers 数的前提）。

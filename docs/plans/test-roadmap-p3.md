# P3 长期规划：移动端测试 / 混沌工程扩展 / 性能回归自动化

> 依据 TEST_AUDIT_REPORT.md P3-10/11/12。当前为规划文档，落地时间按 v0.2.0 排期。

## 1. 移动端测试体系设计（P3-10）

### 现状（审计时点）
- `src/mobile/` 仅 5 个文件（MobileApp.tsx 等），零测试；`vitest.config.ts` exclude `src/mobile/**`。
- `android-sdk/` 仅有工具链（NDK/build-tools），无 app 源码、无 androidTest。
- 移动端处于前期准备阶段。

### 目标架构
| 层 | 工具 | 覆盖对象 |
|---|---|---|
| 单元 | Vitest（解除 exclude，组件用 jsdom） | mobile/ 内纯逻辑与组件 |
| 组件 | @testing-library/react | MobilePetView 等交互 |
| 集成 | Tauri Mobile + Android emulator | Tauri 插件桥接 |
| E2E | Playwright Device Lab（iPhone/Android 视口） | 移动 UI 主旅程 |

### 分阶段路线
- **S1（v0.2.0 前）**：解除 `src/mobile/**` exclude，为 5 个现有文件补 smoke 单测。
- **S2（有 app 源码后）**：androidTest instrumented 测试 + CI 接入 emulator。
- **S3（上线前）**：Device Lab 云真机 + 移动端视觉回归。

## 2. 混沌工程扩展（P3-11）

### 现状
- `e2e/chaos.spec.ts` 5+1 个故障注入（IPC 异常/DB 损坏/加解密失败/IPC 超时/并发冲突/级联）。
- 已补「恢复后数据一致性」断言（本轮 P1-5）。

### 扩展路径
| 阶段 | 内容 | 工具 |
|---|---|---|
| S1 | 补系统级故障：网络分区（fetch 拦截全断）、磁盘满（fs write 拒绝）、权限回收（plugin 抛权限错误） | Playwright route 拦截 + mock 注入 |
| S2 | 数据一致性断言升级：故障后校验 localStorage/SQLite 状态与恢复前一致 | 现有 chaos fixture |
| S3 | 桌面应用级混沌（真实 Tauri）：进程注入、窗口崩溃恢复 | 自研脚本或 LitmusChaos（桌面场景适配成本高，先自研） |

### 验收标准
- 每个故障场景必须包含：不崩溃断言 + 恢复后一致性断言 + 手动恢复路径验证。

## 3. 性能回归自动化（P3-12）

### 现状
- `perf/` 7 个脚本（cold-start/memory/fps/leak/stress/penetration/baseline-trend），`run-all.mjs` 一键执行。
- 仅 `perf/results/package-size.json` 有历史留存，其他指标无历史存储；CI 有 perf-stress job 但无预算阻断。

### 落地方案
| 阶段 | 动作 | 交付物 |
|---|---|---|
| S1 | 统一结果留存：各脚本输出 JSON 到 perf/results/，`baseline-trend.mjs` 消费历史计算趋势 | 脚本改造 |
| S2 | Perf Budget 阻断：PR 中冷启动 >3s、内存 >500MB、FPS 均值 <30 时 CI 标注失败 | ci.yml perf job + budget.json |
| S3 | 趋势看板：Codecov 同源方式或静态 HTML 展示历史曲线 | perf/results/trend.html |

### 预算初始值（建议）
| 指标 | 预算 | 依据 |
|---|---|---|
| 冷启动 | ≤ 3s | 审计建议阈值 |
| 常驻内存 | ≤ 500MB | 桌面宠物类应用合理值（需实测基线后校准） |
| FPS 均值 | ≥ 30 | 动画流畅底线 |
| 包体积 | ≤ 100MB | 现有 package-size 监控延续 |

## 4. 排期总览

| 优先级 | 项目 | 排期 |
|---|---|---|
| P2 短期 | fixtures 迁移、test-impact、flaky-detect（本轮已交付脚本与规范） | 本轮 |
| P3-S1 | 移动端 smoke 测试、混沌系统级故障、perf 结果留存 | v0.2.0 迭代 |
| P3-S2 | Perf Budget 阻断、混沌一致性升级 | v0.2.0 后半 |
| P3-S3 | 看板/云真机/桌面级混沌 | v0.3.0 愿景 |

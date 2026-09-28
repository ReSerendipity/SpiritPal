# SpiritPal 对内项目说明（维护者专用）

> 本文件位于 `DOCS/`，由根目录 `AGENTS.md` 的「对内/对外文档分区」一节引用。
> 根目录 `README.md` 一律对外；维护者备忘、进度状态、内部约定只写在这里。

## 一、仓库沿革与 git 治理（原 README「仓库说明」章）

本仓库为**公开仓库**，以 Apache License 2.0 发布（Copyright 2026 ReSerendipity）。原「main 私有开发 + origin 公开演示」双仓双分支体系已废止：私有仓已改名为本仓库并全量公开（含完整 main 历史），public 演示分支与演示仓已删除。

- `main` 为唯一主分支，push 即发布；push 前需经所有者授权并核对 `git remote -v`，禁止 force push。
- 敏感文件永不入库：`*.jks` / `local.properties` / `.env` 等（.gitignore 已覆盖，全历史已扫描核验）。
- `backup` 为本地历史分支，不对外维护。

## 二、已知阻塞 / 待办（B-4 记忆召回收尾）

B-4 主线（隔离设计 + 检索候选池修复 + 评测套件 + 趋势看板）已闭环并提交，以下两项需环境/架构就位后方可推进，**当前无独立代码可解**：

- **[阻塞] 真实验收填充 `perf/results/perf-history.json`**
  - 现状：`perf/results/recall-history.json`（记忆 P95 / 召回率趋势）已落地，但 PRD 性能验收（冷启动 / 内存 / 帧率 / 包体时序）依赖 `perf/run-all.mjs` 的真实产物，目前为空。
  - 解锁条件：先 `pnpm tauri build` 产出 exe，再 `pnpm perf`（Playwright + 真机/模拟器）跑批；数据仅本地、不入库（已 gitignore）。
- **[阻塞] 评测 case 20（运动 → 跑步）语义鸿沟**
  - 现状：本地召回评测 29/30（96.7%），仅 case 20 未命中——`运动` 与 `跑步` 的语义关联超出 LCS/同义词扩展能力。
  - 解锁条件：启用真实 embedding/RAG 路径（`@xenova/transformers` 本地向量检索 + `ragRetrieval`），当前评测在 mock 下短路了向量检索，故纯本地无法补；待真实 RAG 接通后该 case 应自然命中。

## 三、目录与文档注记（原目录树中被移出的条目）

- `references/`：Vendored reference repos，学习用（gitignored）
- `artifacts/`：构建产物如 APK（gitignored）
- `.trae/`：本地 IDE 工具状态（gitignored）
- `AGENTS.md`：AI 辅助开发指南（本地文档，未随仓库发布）
- `docs/analysis/`：仓库分析报告与优化计划
- `docs/project/AI_DEV_SOPS.md`：内部 SOP（未随仓库发布）；更新器签名密钥与 updates.json 发布链见其 SOP-5

## 四、桌面端能力实现细节（原「桌面端能力」章的实现层备注）

对外版已改为纯功能描述；实现层信息留档：

- 托盘实现：`src-tauri/src/tray.rs`
- 单实例：`tauri-plugin-single-instance`（lib.rs）
- 崩溃自启：panic hook 落盘 `{log_dir}/crash_*.log`，受限重启逻辑在 `src-tauri/src/diagnostics.rs`
- 增量更新：Tauri updater 已启用，发布链见 AI_DEV_SOPS.md SOP-5

## 五、历史工单编号对照

- 原「Windows 安装与 SmartScreen 说明（P1-2）」中的 P1-2 为内部工单号，对外版已去除编号。

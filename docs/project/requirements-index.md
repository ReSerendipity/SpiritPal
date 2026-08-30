# 需求文档结构化索引

> **文档编号**：RIDX-001  
> **创建日期**：2026-08-27

---

## 目的

PRD v0.2 已达 2200+ 行，单一文件维护成本高。本索引将 PRD 章节结构化，支持快速定位需求内容，同时作为模块化拆分的预备目录。

---

## PRD 章节索引

| PRD 章节 | 标题 | 行数范围 | 关联 Spec | 关联代码 |
|---------|------|---------|----------|---------|
| §1 | 产品概述 | ~35 行 | — | — |
| §2 | 问题陈述 | ~35 行 | — | — |
| §3 | 范围定义 (MoSCoW) | ~60 行 | — | — |
| §4 | 目标用户与场景 | ~80 行 | — | — |
| §5 | 竞品分析与差异化 | ~60 行 | — | — |
| §6 | 产品架构总览 | ~60 行 | `docs/project/ARCHITECTURE.md` | — |
| §7.1 | 功能全景图 | ~20 行 | — | — |
| §7.2 | F1 宠物与形象系统 | ~200 行 | `.trae/specs/prd-v02-full-completion/spec.md` | `src/lib/animationConfig.ts`, `Live2DRenderer.tsx`, `SpriteRenderer.tsx` |
| §7.3 | F2 AI 与角色系统 | ~150 行 | 同上 | `src/lib/llmProviders.ts`, `personalityEngine.ts` |
| §7.4 | F3 记忆与交互系统 | ~150 行 | 同上 | `src/lib/enhancedMemory.ts`, `recallEngine.ts` |
| §7.5 | F4 养成与模组系统 | ~150 行 | 同上 | `src/stores/petStore.ts`, `modManager.ts` |
| §7.6 | F5 桌面功能扩展 | ~80 行 | 同上 | `src/lib/contextAwareness.ts` |
| §7.7 | F6 系统集成 | ~60 行 | 同上 | `src-tauri/src/lib.rs` |
| §7.8 | F7 移动端 | ~60 行 | `.trae/specs/add-mobile-app-support/` | `src/mobile/` |
| §8 | 技术架构 | ~100 行 | `docs/project/ARCHITECTURE.md` | — |
| §9 | 平台适配策略 | ~80 行 | — | `src-tauri/tauri.conf.json` |
| §10 | 非功能性需求 | ~30 行 | — | — |
| §11 | 数据模型设计 | ~100 行 | — | `src/lib/types.ts` |
| §12 | UI/UX 设计规范 | ~50 行 | — | `src/index.css`, `tailwind.config` |
| §13 | 验收标准 | ~60 行 | `.trae/specs/*/checklist.md` | `e2e/`, `src/**/__tests__/` |
| §14 | 测试与验证计划 | ~40 行 | — | `vitest.config.ts`, `playwright.config.ts` |
| §15 | 数据埋点与分析 | ~40 行 | — | `src/lib/analytics.ts` |
| §16 | 发布与运营计划 | ~50 行 | — | `.github/workflows/release.yml` |
| §17 | 开发路线图 | ~100 行 | `docs/plans/Iteration_Roadmap.md` | — |
| §18 | 资源来源分析 | ~30 行 | `docs/repo-analysis/`（已归档至 `_devarchive/repo-analysis/`） | — |
| §19 | PRD 完整性评估 | ~20 行 | — | — |
| §20 | 风险与缓解 | ~30 行 | — | — |
| §21 | 依赖与假设 | ~20 行 | — | — |
| §22 | 变更管理 | ~20 行 | `docs/project/change-management.md` | — |
| §23 | 开放问题 | ~20 行 | — | — |
| §24 | 附录 | ~20 行 | — | — |

---

## 模块化拆分建议（后续执行）

当 PRD 需要拆分时，建议按功能域组织：

```
docs/project/
├── PRD_桌面宠物应用_v0.2.md          ← 主文件保留概览+范围+验收
├── requirements/
│   ├── F1-pet-system.md               ← §7.2 宠物系统详细需求
│   ├── F2-ai-character.md             ← §7.3 AI 与角色
│   ├── F3-memory-interaction.md       ← §7.4 记忆与交互
│   ├── F4-nurturing-mod.md            ← §7.5 养成与模组
│   ├── F5-desktop-extension.md        ← §7.6 桌面扩展
│   ├── F6-system-integration.md       ← §7.7 系统集成
│   └── F7-mobile.md                   ← §7.8 移动端
```

当前阶段不执行拆分，仅记录索引。拆分时机：PRD 超过 3000 行或功能域独立迭代时。

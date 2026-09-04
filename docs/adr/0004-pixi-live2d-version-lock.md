**ADR-0004: PixiJS 7 与 pixi-live2d-display 0.4.0 版本锁定（受 Live2D 渲染栈约束）**

- **状态**: Implemented
- **日期**: 2026-09-04
- **决策者**: 项目维护者 + AI 指挥（前端工程体系评估 §2.3 / 治理路线 S4）
- **关联**: `package.json`（pixi.js ^7.4.3 / pixi-live2d-display ^0.4.0）、`src/components/Live2DRenderer.tsx`、`src/lib/render/renderAdapter.ts`、`docs/LIVE2D_LICENSE_REMINDER.md`、`src/components/SpriteRenderer.tsx`

---

# 背景与问题

1. **依赖年龄断层**。本仓运行时栈为 React 19 / Vite 7 / TS 5.6 / Tailwind 4 等最新大版本，但渲染层 `pixi.js` **停在 7.4.x**（PixiJS 8 已发布并完成渲染管线重构：WebGPU 支持 / 插件体系 / `Application` 生命周期均大幅变更），`pixi-live2d-display`（社区插件，负责把 Live2D Cubism 模型挂到 Pixi 场景）**长期停在 0.4.0**。
2. **锁定的真实原因**：`pixi-live2d-display@0.4.0` 的 peer/运行时依赖**只兼容 Pixi 7 的 API 面**（`Application`、`Texture`、`Container` 等），升级 Pixi 8 会直接破坏 Live2D 渲染路径（Cubism 模型无法上屏）。这不是"拖延升级"，而是**被社区插件版本锁死的现实约束**。
3. **商业分发的法律含义**：Live2D Cubism 为专有软件，`docs/LIVE2D_LICENSE_REMINDER.md` 明确：公开分发（哪怕免费）需向 Live2D 申请发行许可（个人/小规模可免费），商用超阈值需付费。本仓四种打包形态（NSIS / DMG / AppImage / deb）只要对外分发即触发申请义务；经核查 `public/live2dcubismcore.js` 为 **0KB 占位文件**（Cubism Core 未随应用分发，缺失时 `Live2DRenderer` 走 `onError` 降级到 `SpriteRenderer`），不额外触发"分发 Core SDK"条款，但项目内置的 Live2D 渲染代码仍属"使用 Live2D SDK"范畴。

# 评估的备选方案

- **方案 A：维持现状（采纳）** —— `pixi.js@7.4.3` + `pixi-live2d-display@0.4.0` 锁定。Live2D 渲染能力稳定可用，`SpriteRenderer`（pixi 独立路径）不依赖 live2d-display，可独立升级 Pixi（拆分升级面）。
- **方案 B：升级 Pixi 8 + 迁移 live2d-display** —— 社区无维护的 1.x 版本，迁移成本高、Live2D 上屏风险不可控；作为**升级触发条件**而非当下动作。
- **方案 C：弃用 live2d-display，自研 Cubism 集成** —— 需深入 Cubism 原生 SDK/Core 绑定，工程量与维护风险远超现值；记为远期选项。

# 决策

- **锁定**：`pixi.js` 保持 `^7.4.3`、`pixi-live2d-display` 保持 `^0.4.0`，以此作为**显式技术债**记录（下一个人不必重复踩"为什么不能升 Pixi 8"）。
- **升级触发条件（任一满足即评估）**：
  1. `pixi-live2d-display` 发布兼容 Pixi 8 的稳定版本（如 1.x），且 Live2D 渲染确认无回归；
  2. 自研 Cubism 集成（方案 C）进入排期并有明确资源；
  3. 产品决策移除 Live2D 宠物形态（届时 Pixi 8 可自由升级）。
- **许可合规**：公开发布前完成 Live2D 发行许可申请（个人/小规模可免费，官方渠道），并在`设置 → 关于`页标注 Live2D 版权信息；`docs/LIVE2D_LICENSE_REMINDER.md` 已登记该 TODO，**此 ADR 与提醒文档互为强制关联**。

# 实施影响

- 依赖版本保持现状，Cargo/package 锁文件无变化；`docs/FILEMAP.md` 将 pixi-live2d-display 标注为"版本锁定技术债（ADR-0004）"。
- 风险登记：依赖安全扫描（CI codeql/依赖审计）需将 `pixi-live2d-display@0.4.0` 的过时 CVE 状态纳入人工复核（已知社区停更，无官方修复渠道）。
- Live2D 许可：将"发行许可申请"写入 `docs/LIVE2D_LICENSE_REMINDER.md` 检查点与发布前 checklist（该文档已含四项打包形态合规结论，本 ADR 固化其为准绳）。

# 可回滚路径与待验证项

- **回滚**：无（本 ADR 记录的是"现状维持"决策）；若未来升级 Pixi 8，回滚路径为 git revert 至本 lockfile 状态。
- **待验证（后续里程碑）**：
  1. 每季度复核 `pixi-live2d-display` 是否出新版本（触发条件 1）；
  2. 确认 `SpriteRenderer` fallback 在 Live2D Core 缺失环境下的表现与用户可感知度（降级体验达标）；
  3. 发布前复核 Live2D 发行许可申请状态（如未申请则阻断发布）。
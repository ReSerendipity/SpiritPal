# SpiritPal — 文档与项目速览

> AI 桌面宠物应用（桌面 + Android）。Tauri + React/TypeScript，Rust 后端。
> 入口：`src/`（前端 App）+ `src-tauri/`（Rust/Tauri）。
> 详细目录放置规则见 `AGENTS.md` 末尾「文件归档与放置规范」。

## 快速了解本项目
- **做什么**：可养成的桌面宠物（喂食/玩耍/对话/记忆/换装/商店），跨平台桌面 + Android。
- **技术栈**：TypeScript + React + Vite · Tauri(Rust) · SQLite · WebGPU/Live2D/精灵图。
- **如何启动**：`pnpm install` → `pnpm tauri dev`（`install.bat`）。

## 目录结构速览
| 目录 | 内容 |
|---|---|
| `src/` | **主程序前端**（components/ hooks/ lib/） |
| `src-tauri/` | Rust 后端（tray/windows/加密/DB） |
| `tests/` | Playwright 主套件（config 指向 `./tests/e2e`） |
| `e2e/` | Tauri-driver + 补充 E2E（config 指向 `./e2e/`） |
| `src/**/__tests__` | 组件/单测（vitest） |
| `public/` | 宠物资源（characters/ pets/） |
| `docs/` | 项目文档（见下方索引） |
| `demo/` | HTML 演示 |
| `artifacts/` | 构建安装包；`dist/` 构建产物 |

> ⚠️ 说明：`docs/repo_research/` 是**克隆的第三方仓库源码**（研究资料），不属于文档；
> `android-sdk/` 是**本地 Android SDK（勿提交**）；`tests/e2e` 与 `e2e/` 是两套激活的 Playwright 套件，勿删。

## docs/ 索引（本目录）
| 子目录/文件 | 存什么 |
|---|---|
| `project/` | PRD(v0.1/v0.2)、架构、技术选型、开源仓库清单 |
| `plans/` | 实施指南、路线图、记忆升级计划、未实现/待办清单、集成指南 |
| `reports/` | 健康度/功能状态、记忆系统各轮评估、安全评估/加固、审计 |
| `repo-analysis/` | 参考仓库学习报告（约40篇） |
| `analysis/` | 综合实施/可复用最佳实践 |
| `gh-research/` `android-check/` | 抓取研究页 / Android 验收截图 |
| `_devarchive/` | 历史/一次性产物（含 trae-documents） |
| `SECURITY` / `RELEASE_NOTES` 等 | 安全/合规/许可（根目录） |

## 想找内容？
- 想改宠物组件 → `src/components/PetWindow.tsx`、`PetBubble.tsx`
- 想改行为/记忆/AI → `src/lib/`（behaviorEngine/ memory/ aiAgent/）
- 想改系统层(Rust) → `src-tauri/src/`
- 想看需求 → `docs/project/PRD_桌面宠物应用_v0.2.md`
- 想了解记忆系统现状 → `docs/reports/SpiritPal-记忆系统第五轮深度评估报告.md`
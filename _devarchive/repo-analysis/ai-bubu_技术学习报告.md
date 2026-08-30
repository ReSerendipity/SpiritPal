# AIbubu (ai-bubu) 开源仓库技术分析报告

> 仓库地址：https://github.com/funAgent/ai-bubu
> 分析日期：2026-08-13
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，为 SpiritPal（Tauri v2 + React 19 + Rust 跨平台 AI 桌面宠物）提供可借鉴特性参考

---

## 1. 项目概览

AIbubu 是一款**为 AI 编码时代打造的桌面宠物应用**，将 AI 编程工具的活跃度量化"步数"，让桌面宠物根据用户的编码活跃度移动（idle / walk / run / sprint 四档）。核心理念是"把无形的 AI 协作变成可视化的陪伴"。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | AIbubu |
| 仓库名 | `funAgent/ai-bubu` |
| 许可证 | MIT（待确认，从 README 标识推测） |
| 技术栈 | Tauri 2 + pnpm 10 + Vue 3 + TypeScript + Rust |
| 跨平台 | macOS 14+ / Windows / Linux（AppImage/deb） |
| 一句话定位 | "A coding step counter for the AI era" — AI 编码活动的桌面宠物量化 |
| 当前活跃度 | 活跃（提供 dmg / msi / AppImage / deb 多端分发） |

### 当前状态

已发布多平台安装包，提供网站、文档、自动更新、内置 8 套皮肤 + 自定义导入、LAN 社交排行榜。

---

## 2. 核心技术栈

| 层级 | 技术 | 职责 |
|------|------|------|
| **桌面框架** | Tauri 2 | 跨平台桌面壳（透明窗口/系统托盘/自启） |
| **前端** | Vue 3 + TypeScript + Vite | UI 与交互 |
| **样式** | 现代 CSS（无 Tailwind，源码自定义） | 样式与动效 |
| **后端** | Rust | 进程监控、文件 IO、系统集成 |
| **数据** | JSONL / SQLite（被动读取） | 活动数据源 |
| **渲染** | Sprite Sheet / Lottie / GIF / APNG | 宠物动画 |
| **网络** | UDP 广播 | LAN 社交 |
| **国际化** | 中英双语 | i18n |
| **工具链** | pnpm 10 + Turborepo + husky + lint-staged | monorepo + 工程化 |
| **CI/CD** | GitHub Actions + commitlint + cliff | 自动发布与变更日志 |

---

## 3. 项目架构与目录结构

```
ai-bubu/
├── packages/
│   ├── app/                # Tauri 主应用（Vue 3 + Vue Router）
│   │   ├── src/            # 渲染层
│   │   │   ├── views/      # 页面（today/leaderboard/skins/settings/about）
│   │   │   ├── components/ # 宠物渲染、设置面板、托盘菜单
│   │   │   └── stores/     # 状态管理（活动分数、宠物状态）
│   │   └── src-tauri/      # Rust 后端
│   │       ├── src/
│   │       │   ├── adapters/   # AI 工具适配器（Cursor/Claude/Codex/Trae）
│   │       │   ├── monitor/    # 活动监控核心
│   │       │   ├── pet/        # 宠物状态机
│   │       │   └── lan/        # UDP 广播与排行榜
│   │       └── public/         # 皮肤/动效资源
│   ├── site/               # 官网（Astro）
│   └── shared/             # 跨包共享类型
├── scripts/                # 工具脚本（皮肤验证、版本管理）
├── .claude/                # AI Agent 协作规范
├── .cursor/                # Cursor 规则
└── .github/                # CI/CD 与社区配置
```

**架构模式**：Tauri 2 + Vue 3 monorepo；Rust 后端通过适配器模式对接 6+ AI 工具；前端负责宠物渲染与 UI。

---

## 4. 核心功能模块详解

### 4.1 AI 工具活动监控（核心创新）
通过**可插拔适配器系统**实时监控 AI 编程工具，**无需安装 hooks、无需修改配置**，被动读取本地数据：

| AI 工具 | 数据源 | 检测方式 |
|---------|--------|----------|
| **Cursor** | `state.vscdb`（本地 SQLite） | 轮询 Composer 状态（`generating`/`streaming`） |
| **Claude Code** | `~/.claude/projects/*.jsonl` | 解析 JSONL session 日志 |
| **Codex CLI** | `rollout-*.jsonl` | 解析 session 日志 |
| **OpenCode** | `~/.local/state/opencode/*.jsonl` | 解析 JSONL |
| **Trae** | 进程 CPU 使用率 | process 级别检测 |
| **其他** | 通用 process fallback | CPU 活动检测 |

**5 种适配器类型**（TOML 配置即可扩展）：
- `sqlite` / `jsonl` / `process` / `file_mtime` / `vscode_ext`

**多工具协同加成**：
- 2 个工具同时使用：×1.8 倍速
- 3+ 工具：×2.5 倍速

### 4.2 宠物移动与情绪系统
**移动速度四档**（与活动分数挂钩）：

| 状态 | 条件 | 分数 |
|:----:|------|:----:|
| Idle | 无活动 | 0 |
| Walk | 活跃 < 60s | 25-49 |
| Run | 活跃 60s+ | 50-74 |
| Sprint | 活跃 180s+ | 75-100 |

**45 秒冷却桥**：在 agent 工具调用间隙，宠物保持移动状态，让编码流不中断。

**情绪特效层**（叠加在移动上）：

| 情绪 | 触发条件 | 视觉特效 |
|------|----------|----------|
| Sleepy 💤 | 静止 10 分钟 | 飘动 zzz + 呼吸 + 变暗 |
| Excited 🔥 | Sprint 或分数 ≥ 90 | 速度烟尘 + 抖动 + 发光 |
| Normal | 默认 | 无特效 |

### 4.3 宠物交互
- **单击** → 拍头反应（❤️ 💕 飘字）
- **双击** → 戳反应（❗ ❓ 飘字）
- **长按拖拽** → 抓取并拖动（150ms 长按阈值）
- **右键** → 打开社交面板
- **悬停提示** → "Hold to drag" / "Click to interact"

### 4.4 步数统计与洞察
- 每日步数 = `⌊score / 10⌋` 每 tick 累加
- 90 天历史，本地午夜滚动
- 洞察仪表盘：
  - 7 天 / 30 天趋势图
  - 24 小时活动热力图
  - 各 AI 工具活跃时长分解
  - 连续活跃天数 streak

### 4.5 皮肤系统（**SpiritPal 重点参考**）
- **8 套内置皮肤**：Vita / Tard / Mort / Doux / Boy / Dinosaur / Glube / Line
- **自定义导入**：支持文件夹或 ZIP 压缩包
- **多格式支持**：Sprite Sheet (PNG) / Lottie / GIF / APNG
- **4 个必需动画状态**：idle / walk / run / sprint
- 可配置：帧率、帧数、起始帧
- 提供可下载模板 + 创建指南

### 4.6 LAN 社交（**SpiritPal 重点参考**）
- **自动发现**：UDP 广播 23456 端口，局域网自动发现队友
- **排行榜**：按每日步数排名
- **5 秒心跳**：实时同步昵称、步数、活动分数、移动状态、皮肤
- **宠物伴游**：在线队友作为迷你宠物与你的宠物同行
- **隐私优先**：仅 LAN、无服务器、无账号

### 4.7 系统集成
- **透明窗口**：无边框、背景透明、始终置顶、隐藏任务栏
- **macOS 全屏覆盖**：可选 NSPanel 保持可见
- **系统托盘**：显示/隐藏、排行榜、退出（托盘图标实时更新为宠物当前帧）
- **开机自启**：macOS / Windows / Linux 全平台
- **自动更新**：检查 GitHub Releases 并应用内安装
- **双语 UI**：中英自动检测
- **主题**：浅色 / 深色 / 跟随系统
- **隐私**：所有数据本地，无上传
- **跨平台**：macOS 14+ / Windows / Linux

---

## 5. 技术实现细节

### 5.1 适配器模式（核心架构）
```rust
trait ActivityAdapter {
    fn name(&self) -> &str;
    fn poll(&self) -> ActivitySnapshot;
    fn is_available(&self) -> bool;
}

struct MonitorEngine {
    adapters: Vec<Box<dyn ActivityAdapter>>,
}

impl MonitorEngine {
    fn tick(&self) -> u8 {
        let mut max_score = 0;
        for adapter in &self.adapters {
            if adapter.is_available() {
                max_score = max_score.max(adapter.poll().score);
            }
        }
        // 多工具加成
        let active_count = self.adapters.iter()
            .filter(|a| a.is_available() && a.poll().is_active())
            .count();
        let multiplier = match active_count {
            0..=1 => 1.0,
            2 => 1.8,
            _ => 2.5,
        };
        (max_score as f32 * multiplier).min(100.0) as u8
    }
}
```

### 5.2 SQLite 被动监控（Cursor 适配器）
```rust
fn poll(&self) -> ActivitySnapshot {
    let conn = Connection::open(cursor_db_path()).unwrap();
    let generating: i64 = conn.query_row(
        "SELECT COUNT(*) FROM composerData WHERE status = 'generating'",
        [],
        |r| r.get(0)
    ).unwrap_or(0);
    if generating > 0 { ActivitySnapshot::high() }
    else { ActivitySnapshot::idle() }
}
```

### 5.3 JSONL 增量读取（Claude Code 适配器）
```rust
fn poll(&self) -> ActivitySnapshot {
    let last_modified = latest_mtime_in(&path)?;
    if now() - last_modified < 60s { ActivitySnapshot::active() }
    else { ActivitySnapshot::idle() }
}
```

### 5.4 UDP 广播（LAN 社交）
- 23456 端口周期性广播自身状态
- 接收方解析 JSON 心跳包（昵称/步数/分数/状态/皮肤）
- 5 秒心跳间隔
- 纯 LAN，无中心服务器

### 5.5 宠物状态机
```
states: [Idle, Walk, Run, Sprint]
events: [ActivityScoreChange, Click, DoubleClick, Hold, Drag, Release, TimeIdle]
transitions: 4×7 = 28 条规则
```

---

## 6. 数据处理流程

### 单宠物模式
```
MonitorEngine.tick() (每 N 秒)
  → 遍历所有 adapter
  → 计算综合活动分数
  → 应用多工具加成
  → 更新 PetStateMachine
  → 触发状态变化
  → Vue 前端切换动画帧
  → 累加步数 (score / 10)
```

### LAN 社交模式
```
自身心跳 (5s) → UDP 广播
接收方心跳 → 解析 → 渲染伴游宠物
排行榜 tick → 计算排名 → 同步更新
```

---

## 7. UI/UX 设计

- **极简透明窗口**：无边框，仅宠物可见
- **可爱风格**：圆润、动画丰富、飘字反馈
- **拖拽直觉**：长按阈值（150ms）区分单击与拖动
- **托盘菜单**：原生平台习惯一致
- **多语言**：自动检测 + 手动切换
- **动画分层**：移动 + 情绪特效叠加
- **响应式**：不同 DPI 屏幕适配

---

## 8. 构建打包

- pnpm 10 + Turborepo monorepo
- Tauri 2 跨平台构建（macOS .dmg / Windows .msi / Linux .deb + .AppImage）
- commitlint + conventional commits
- git-cliff 自动生成 CHANGELOG
- GitHub Actions 自动发布
- Husky + lint-staged 代码质量门禁
- TypeScript + ESLint + Prettier

---

## 9. 版本迭代

活跃开发。从仓库状态推测近期多次发布：
- 多端安装包（dmg/msi/AppImage/deb）
- 皮肤系统（8 套内置 + 自定义）
- LAN 社交
- 自动更新
- 6+ AI 工具适配器扩展

---

## 10. 优缺点分析

### 优点
1. **核心创新**：把 AI 编码活动变成宠物步数（独特定位）
2. **适配器模式**：5 种类型 + TOML 配置即可扩展任意工具
3. **Tauri 2 + Vue 3**：与 SpiritPal 技术栈高度一致
4. **皮肤系统**：8 内置 + 自定义导入（PNG/Lottie/GIF/APNG）
5. **LAN 社交**：无服务器的本地化社交
6. **多端分发**：macOS/Windows/Linux 全覆盖
7. **隐私优先**：所有数据本地

### 缺点
1. 监控 Cursor/Claude 等工具可能涉及合规争议（被动读取本地数据）
2. 适配器需要为每个 AI 工具单独维护
3. LAN 社交仅限同网络
4. 无云端备份
5. 资源占用（持续轮询）

---

## 11. 可借鉴特性

### 11.1 高价值（SpiritPal 直接可用）

| # | 特性 | 评分 | SpiritPal 移植建议 | 目标文件 |
|---|------|------|-------------------|---------|
| 1 | **皮肤系统架构** | ★★★★★ | 复用多格式/多状态皮肤定义 | `src/lib/petSkins.ts` |
| 2 | **活动监控适配器模式** | ★★★★ | 扩展为 IDE 活动检测 | `src/lib/monitors/` |
| 3 | **UDP LAN 社交** | ★★★★ | 宠物间社交 + 排行榜 | `src/lib/lan/` |
| 4 | **宠物状态机** | ★★★★★ | 复用 idle/walk/run/sprint 状态 | `src/lib/petStateMachine.ts` |
| 5 | **45 秒冷却桥** | ★★★★ | 防止状态频繁切换抖动 | 状态机优化 |
| 6 | **150ms 长按拖拽阈值** | ★★★★★ | 复用单击/长按/拖动区分 | `usePetDragging.ts` |
| 7 | **托盘菜单实时帧** | ★★★★ | 系统托盘图标随状态变化 | Rust 端 |
| 8 | **多工具协同加成** | ★★★ | 多 AI 后端智能调度 | `src/lib/llmProviders.ts` |

### 11.2 中等价值（需调整）

| # | 特性 | 评分 | 说明 |
|---|------|------|------|
| 9 | 步数统计与历史 | ★★★ | 改为宠物亲密度/经验值 |
| 10 | 7/30 天趋势图 | ★★★ | 复用 ECharts/Chart.js |
| 11 | 24 小时热力图 | ★★★ | 复用日历组件 |
| 12 | streak 连续天数 | ★★★ | 转化为成就系统 |
| 13 | 心跳同步协议 | ★★★★ | 简化用于宠物伴游 |

### 11.3 通用最佳实践

| # | 实践 | 评分 | 说明 |
|---|------|------|------|
| 14 | pnpm + Turborepo monorepo | ★★★★ | SpiritPal 可升级 |
| 15 | commitlint + cliff | ★★★★ | SpiritPal 已部分使用 |
| 16 | .claude / .cursor Agent 规范 | ★★★★★ | SpiritPal 已有 AGENTS.md |
| 17 | Tauri 2 capabilities 精细控制 | ★★★★ | 权限最小化 |

---

## 12. 潜在改进（社区方向）

1. WebTransport 替代 UDP（NAT 穿透）
2. AI 适配器配置 UI（用户可视化扩展）
3. 宠物社交云端备份
4. 跨平台皮肤商店
5. 与 VSCode/Cursor 插件集成
6. 实时编码活动统计

---

## 13. 许可证合规分析

仓库 LICENSE 文件存在（1086 字节），从 README 标识推测为 **MIT** 或类似宽松许可。**SpiritPal 借鉴需确认具体协议**，但适配器模式、状态机设计、皮肤系统定义均属于通用架构思路，可独立用 TypeScript/Rust 重写。

---

## 14. 总结与技术参考价值

AIbubu 是 SpiritPal 在**桌面宠物 + AI 时代**的**最直接对标项目**。其 Tauri 2 + Vue 3 技术栈与 SpiritPal 的 Tauri v2 + React 19 高度对应，皮肤系统、状态机、托盘菜单、长按拖拽等核心设计可直接复用。

**核心参考价值**：
- **P0**：皮肤系统（4 状态 × 多格式 × 自定义导入）— SpiritPal 当前最缺
- **P0**：状态机设计（idle/walk/run/sprint + 情绪叠加层）— 行为引擎升级模板
- **P0**：长按拖拽阈值（150ms）— usePetDragging 优化
- **P1**：LAN 社交（UDP 广播 + 伴游宠物）— 差异化亮点
- **P1**：适配器模式（5 种类型 + TOML 配置）— 可扩展 IDE 活动检测
- **P1**：托盘菜单实时帧（状态同步）— 提升 UX
- **P2**：步数/streak（可转化为养成系统）
- **P2**：监控数据可视化（趋势图/热力图）— 数据面板

**参考价值评分**：⭐⭐⭐⭐⭐（5/5）
- 技术栈匹配度：**极高**（Tauri 2 + Vue 3 vs Tauri v2 + React 19）
- 核心设计复用度：**高**（皮肤/状态机/交互）
- 业务模式创新：**强**（AI 编码活动量化）
- 跨平台经验：**直接借鉴**（macOS/Windows/Linux 全覆盖）
- 工程规范：**优秀**（commitlint/cliff/AGENTS.md）

**集成路径**：
1. **短期**：复用 4 状态皮肤系统 + 长按拖拽阈值 + 状态机设计
2. **中期**：评估适配器模式用于 IDE 活动检测 + UDP LAN 社交
3. **长期**：跨平台分发经验 + 自动更新策略

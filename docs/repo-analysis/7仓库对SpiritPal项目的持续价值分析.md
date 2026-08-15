# 7 个开源仓库对 SpiritPal 桌面宠物项目的持续价值分析

> **分析日期**：2026-07-12  
> **分析范围**：C:\Users\HONOR\Pet\repos 下的 7 个仓库（Dororo、DyberPet、EchoBot、Feibi_desktop、MurasamePet、ameath_DesktopPet、oc-claw）  
> **目标项目**：SpiritPal（Tauri v2 + React 19 + TypeScript + Rust 跨平台 AI 桌面宠物）  
> **当前版本**：v0.1.0

---

## 一、分析概述

### 1.1 目的

对 SpiritPal 项目已复制的 7 个开源仓库进行源代码级别的深入分析，并结合已有的分析报告，回答一个核心问题：

> **这些仓库对 SpiritPal 项目当前还有哪些具体的、可落地的帮助？**

### 1.2 方法

1. **通读 SpiritPal 全部源码**（~4161 行 TS/TSX + 112 行 Rust），精确识别已实现的功能和代码中的"灵感来源"注释
2. **逐一分析 7 个仓库的源代码**，定位每个仓库的具体文件、函数、公式、配置结构
3. **对比 SpiritPal 的 PRD 路线图**（Phase 1-4），找出尚未实现但可从仓库复用的功能
4. **标注每项复用的难度**（低/中/高）和具体移植路径

### 1.3 SpiritPal 当前技术栈概览

| 层级 | 技术 | 用途 |
|------|------|------|
| 前端框架 | React 19 + TypeScript | UI 组件 |
| 构建工具 | Vite 8 + pnpm | 开发/构建 |
| 状态管理 | Zustand 5 + persist | 本地持久化 |
| UI 样式 | Tailwind CSS 4 | 原子化 CSS |
| 桌面框架 | Tauri v2 (Rust) | 透明窗口/托盘/自启 |
| LLM 通信 | Fetch SSE 流式 | OpenAI 兼容接口 |
| 国际化 | i18next + react-i18next | 中英文 |
| 窗口架构 | 三窗口（宠物/设置/聊天） | Hash 路由 |

### 1.4 SpiritPal 当前已实现功能

| 模块 | 实现状态 | 核心文件 |
|------|---------|---------|
| 透明置顶窗口 | ✅ 已完成 | `tauri.conf.json`, `lib.rs` |
| 精灵图渲染（图集/视频/SVG） | ✅ 已完成 | `SpriteRenderer.tsx` |
| 行为状态机（idle/walk/sleep等） | ✅ 已完成 | `PetWindow.tsx` |
| 养成系统（饱食/心情/健康/亲密度） | ✅ 已完成 | `petStore.ts` |
| 离线衰减 + 冬眠保护 | ✅ 已完成 | `petStore.ts` |
| 金币 + 商店 + 背包 | ✅ 基础完成 | `petStore.ts`, `ShopPanel.tsx` |
| XP/等级系统 | ✅ 已完成 | `petStore.ts` |
| 系统托盘菜单 | ✅ 已完成 | `lib.rs` |
| 开机自启 | ✅ 已完成 | `lib.rs` |
| 流式 LLM 聊天 | ✅ 已完成 | `llmClient.ts` |
| 三层记忆系统 | ✅ 已完成 | `memoryManager.ts` |
| 番茄钟 | ✅ 已完成 | `PomodoroOverlay.tsx` |
| 右键菜单交互 | ✅ 已完成 | `PetContextMenu.tsx` |
| 滚轮缩放 | ✅ 已完成 | `PetWindow.tsx` |
| 屏幕边缘吸附 | ✅ 已完成 | `PetWindow.tsx` |
| 角色切换（3 角色） | ✅ 已完成 | `characters.ts` |
| 摸头检测（头部速度） | ✅ 已完成 | `PetWindow.tsx` |
| 爱心粒子效果 | ✅ 已完成 | `PetWindow.tsx` |
| i18n 国际化 | ✅ 已完成 | `i18n.ts` |

---

## 二、逐仓库深度分析

---

### 2.1 OC-Claw（Tauri v2 + React + TypeScript + Rust）

> **仓库路径**：`repos\oc-claw`  
> **技术栈**：Tauri v2 + React 19 + TypeScript + Rust（单文件 lib.rs ~17,400 行）  
> **关联报告**：`OC-Claw_Repo_Analysis.md`（34KB）

#### 已采纳的资源

SpiritPal 已从 OC-Claw 采纳的资源（代码注释中标注"来自 OC-Claw"）：
- Tauri v2 透明窗口配置（`transparent:true, decorations:false, alwaysOnTop:true, skipTaskbar:true`）
- 系统托盘（菜单：显示/隐藏/设置/退出）
- 开机自启（`tauri-plugin-autostart`）
- 多窗口架构（宠物/设置/聊天）
- 192×208 精灵图集格式（8 列 × 9 行）
- Ollama 本地检测（`LLMClient.detectOllama`）

#### 🔴 尚未采纳但对 SpiritPal 有价值的功能

##### A. 双缓冲视频播放 — 高价值 / 移植难度：低

**位置**：`oc-claw/frontend/src/Mini.tsx:4079-4195`（渲染：4479-4530）

**实现原理**：
- 两个 `<video>` 元素的 ref：`largeVideoRefA` 和 `largeVideoRefB`（L4084-4085）
- `activeBufferRef`（`0|1`）追踪当前可见的"前缓冲区"
- 动画切换时：将新 URL 加载到**后缓冲区**，通过 `loadWithFallback()` 加载（L4145-4175）
- 监听 `'playing'` 事件 → 调用 `finishSwap(backIdx)`（L4186）
- `finishSwap`（L4130-4144）：翻转 `activeBufferRef` + `setActiveBuffer`，然后**只调用 `old.pause()`** —— 绝不清除旧 src
- JSX 中两个 `<video>` 堆叠渲染（L4481-4530），使用 `visibility: isFront ? 'visible' : 'hidden'`

**关键规则（`CLAUDE.md:149-167`）**：
- `vid.load()` 会同步清除帧缓冲区 → 单元素方案一定会闪白屏
- **绝不**在切换时清除旧缓冲区的 src（`removeAttribute('src')+load()` 会在 React 渲染 `visibility:hidden` 之前运行导致闪白屏）
- 使用 `visibility` 而非 `opacity` / 淡入淡出 —— opacity 在清除窗口期间两个元素都半透明
- 后缓冲区使用 `visibility:hidden`（不是 `display:none`）以便浏览器继续解码帧

**Windows 色度键回退**（`Mini.tsx:4307-4359`）：WebView2 在 Windows 上会丢弃 VP9 alpha 通道。OC-Claw 用 canvas 色度键逐帧渲染（`getImageData` + `willReadFrequently: true`），将接近黑色的像素（`maxRgb <= 12`）设为透明。

**为什么需要**：SpiritPal 当前使用单个 `<video>` 元素（`SpriteRenderer.tsx:94-107`），动画切换时必须先 `load()` 新源，必然导致短暂白屏。PRD Phase 1 明确要求解决此问题。

**移植路径**：
1. 在 `SpriteRenderer.tsx` 中增加第二个 `<video>` ref
2. 复制 OC-Claw 的 `loadWithFallback` + `finishSwap` 逻辑（~120 行）
3. 将 CLAUDE.md 的规则文档复制到 SpiritPal 的开发文档中

##### B. 鼠标穿透（Click-Through）— 高价值 / 移植难度：中

**位置**：
- macOS：`lib.rs:5476-5589`（`pet_passthrough_poll`）
- Windows：`lib.rs:5597-5714`（`pet_passthrough_poll_windows`）

**实现原理**：
- 20ms 轮询循环检测光标位置
- 计算宠物命中方框（`hit_w = mascot_w * 2.4/3.0`, `hit_h = mascot_h * 2.8/3.0`）
- 光标在命中方框内 → 窗口可交互；否则 → 穿透到桌面
- 边缘松弛机制：靠近屏幕边缘时扩大可交互区域

**三个控制 IPC 命令**：
- `set_pet_mode_window`（`lib.rs:5156`）— 启用穿透，启动轮询线程
- `set_pet_context_menu`（`lib.rs:5336`）— 设置 `PET_CONTEXT_MENU_OPEN` AtomicBool，右键菜单时整个窗口可交互
- `set_pet_pomodoro_active`（`lib.rs:5324`）— 番茄钟模态时同样禁用穿透

**为什么需要**：SpiritPal 当前的透明窗口会拦截所有鼠标事件，用户无法点击窗口下方的桌面应用。PRD 将此列为 Phase 1 的"无打扰共存"核心需求。

**移植路径**：
1. Rust 侧实现 `pet_passthrough_poll_windows`（Windows 版，~120 行）
2. 复制命中方框计算和 AtomicBool 控制模式
3. SpiritPal 已使用 `tauri-plugin-autostart`，Rust 环境已配好

##### C. 自定义自动更新 — 中价值 / 移植难度：中

**位置**：`lib.rs:11256-11326`（check）+ `lib.rs:11378-11600+`（download+install）

**实现方式**：
- 无需签名密钥，无需 `tauri-plugin-updater`
- 从 `https://www.oc-claw.ai/update/latest.json` 获取最新版本信息
- JSON 结构：`{"platforms": {"windows": {"version": "...", "url": "..."}}}`
- `version_cmp`（L11328-11341）：点分数字比较
- 下载进度通过 Tauri `emit` 事件推送（`update-progress`）
- macOS：下载 DMG + 写 `install-update.sh` 脚本替换 `.app`
- Windows：静默运行 `.msi`/`.exe`

**为什么需要**：PRD Phase 2 要求自动更新机制。OC-Claw 提供了一个不需要签名基础设施的快速方案。

**建议**：SpiritPal 可选择 OC-Claw 的轻量方案（快速启动）或 `tauri-plugin-updater`（签名安全），不建议第三种。

##### D. 宠物状态机增强 Rust 命令 — 低价值但有参考意义

OC-Claw 的 `lib.rs` 包含多个实用命令（`generate_handler!` 在 L17396）：

| 命令 | 行号 | 用途 |
|------|------|------|
| `get_system_idle_time` | 4342 | 系统空闲时间 → 驱动 sleep/rest 动画 |
| `get_keyboard_idle_secs` | 4368 | 键盘空闲 → 检测用户是否在工作 |
| `get_now_playing` | 4393 | 当前播放的音乐 → 驱动音乐相关动画 |
| `play_sound` | 6744 | Rust 侧播放音效（避免 Now Playing 污染） |
| `reassert_floating` | 9404 | 系统降级窗口时重新置顶 |
| `cursor_over_mini_window` | 3838 | 窗口外点击检测 |
| `exit_app` | 1112 | 优雅退出 |

**为什么需要**：`get_system_idle_time` 和 `get_keyboard_idle_secs` 是 PRD Phase 2"工作状态感知"的基础。

##### E. petStore.ts 养成模块 — 可选参考

**位置**：`oc-claw/frontend/src/lib/petStore.ts`（350 行）

这是一个完整、解耦的养成模块，包含：`PetData` 模型、衰减数学（`tickPetData`）、每日礼物（`claimDailyGift`）、摸头限制（`applyHeadpat`）、喂食（`applyFeed`）、亲密度等级（`getAffectionTier`）、番茄钟预设。

所有常量都有注释和文档（如 `HUNGER_DECAY_PER_HOUR=2`, `AFFECTION_HEADPAT_DAILY_LIMIT=5`）。SpiritPal 可以几乎原封不动地移植此模块，但 SpiritPal 已有自己的 petStore.ts 实现，价值有限。

#### 不可复用的部分

- **AI 编码代理监控系统**（Claude Code/Codex/Cursor/Gemini 钩子、`~/.openclaw/*.jsonl` 解析、SSH、`opencode.db`）—— 高度专业化，与桌面宠物无关
- **Cursor VS Code 扩展**（`extensions/cursor/`）—— 不适用
- **GIF 制作器**（`components/GifMakerTab.tsx`）—— 超出范围
- **755KB 单文件 lib.rs 结构** —— 明确标注为缺点，SpiritPal 应保持 Rust 模块化

---

### 2.2 DyberPet（Python + PySide6）

> **仓库路径**：`repos\DyberPet`  
> **技术栈**：Python 3 + PySide6（Qt）  
> **关联报告**：`DyberPet_Repo_Analysis.md`（30KB）

#### 已采纳的资源

- 三层角色配置概念（`pet_conf.json` + `act_conf.json` + `items_config.json`）→ SpiritPal 的 `CharacterProfile` 类型
- 基础养成数值（饱食/心情/健康/亲密度/等级/经验/金币）→ `petStore.ts`
- 离线衰减计算（基于时间差 + 7 天冬眠上限）→ `petStore.ts`
- 基础背包/商店/使用物品 → `petStore.ts`

#### 🔴 尚未采纳但高价值的功能

##### A. HP → 动画概率矩阵 — 高价值 / 移植难度：极低

**位置**：`DyberPet\modules.py:91-129`（`_cal_prob` 方法）

**精确公式**：
```python
new_prob[i] = act_prob[i] * (1/4)**(abs(act_type[i][0] - current_hp_tier)) * int(act_inlist[i])
```

**概率矩阵**（`act_prob` = 基础概率，`a` = 具体数值）：

| 动画定义的 tier \ 当前 HP tier | 3（精力充沛） | 2（正常） | 1（饥饿） | 0（濒死） |
|------|------|------|------|------|
| 3 | a | a/4 | a/16 | 0 |
| 2 | a/4 | a | a/4 | 0 |
| 1 | 0 | 0 | a | 0 |
| 0 | 0 | 0 | 0 | a |

**特殊规则**：
- 如果 `current_hp_tier == 0` 且动画定义的 `act_type[0] != 0`：权重 = 0（濒死时不会播放非濒死动画）
- 如果 `fv_lvl < act_type[1]`（亲密度锁定）：权重 = 0
- 归一化：`new_prob = [i/sum(new_prob) for i in new_prob]`

**摸头动画采样**（`modules.py:478-483`）：
```python
prob = [1 * (0.25**(abs(i - hp_tier))) for i in range(4)]
```

**为什么需要**：SpiritPal 当前的行为状态机（`PetWindow.tsx:122-175`）只基于简单条件选择动画，没有基于养成数值的概率权重。这让宠物的动画选择更"智能"——饥饿时更多饥饿相关动画，精力充沛时更多活跃动画。

**TypeScript 移植**：
```typescript
function actWeight(baseProb: number, actTier: number, currentTier: number): number {
  if (currentTier === 0 && actTier !== 0) return 0;
  if (actTier === 0) return baseProb * (currentTier === 0 ? 1 : 0);
  return baseProb * Math.pow(0.25, Math.abs(actTier - currentTier));
}
```

##### B. Buff 系统 — 高价值 / 移植难度：中

**位置**：`DyberPet\Dashboard\buffModule.py`（279 行）

**数据结构**：
```json
"buff": {
  "effect": "hp",          // hp | fv | coin | HP_stop | FV_stop
  "value": 2,              // 每 tick 变化量
  "interval": 30,          // tick 间隔（秒）
  "expiration": 120,       // 总持续时间（秒）
  "description": "..."     // 描述文本
}
```

**两类 Buff**：
- `BuffAdd`（hp/fv/coin）：持有 `timer = [(interval, expiration), ...]` 列表，每秒递减
- `BuffAlt`（HP_stop/FV_stop）：无值/间隔，仅倒计时，激活期间设置全局 `HP_stop = True`

**叠加规则**：重新施加同一 buff → 在 timer 列表中添加新条目（N 层叠加 = N 个独立倒计时）

**为什么需要**：PRD Phase 2 明确要求 Buff 系统。这是养成深度的关键功能。

##### C. 任务系统 — 中价值 / 移植难度：低

**位置**：`DyberPet\conf.py:1175-1251`（数据）+ `dashboard_widgets.py:3143`（UI）

**数据结构**：
```json
{
  "history": [],           // [[日期字符串, 专注分钟数]]
  "goal": 180,             // 每日专注目标（分钟）
  "goal_completed": false,
  "n_days": 0,             // 连续达标天数
  "tasks_todo": {},
  "tasks_done": {},
  "n_tasks": 0
}
```

**奖励公式**：
- 单任务完成：200 金币
- 每 5 任务：额外 1500 金币
- 每日目标达标：`1000 × n_days`（连续天数 × 1000）—— 连续天数乘数

**为什么需要**：PRD Phase 2 要求任务/成就系统。连续天数乘数是一个有效的留存机制。

##### D. 完整物品/商店配置 Schema — 中价值 / 移植难度：低

**位置**：`DyberPet\conf.py:1330`（`init_item`）+ `docs\art_dev.md:515-556`

```json
{
  "物品名": {
    "image": "apple.png",
    "effect_HP": 3,
    "effect_FV": 3,
    "drop_rate": 1.0,          // 随机掉落权重
    "fv_lock": 0,              // 解锁所需亲密度等级 → 即稀有度
    "description": "...",
    "type": "consumable",      // consumable | collection | dialogue | subpet | autofeed | coin
    "cost": 200,               // 默认 = 50*(fv_lock+1)
    "buff": { ... }            // 关联 Buff
  }
}
```

**物品稀有度 = `fv_lock` 等级**，直接影响价格：`cost = 50 × (fv_lock + 1)`。

**使用物品奖励公式**：
```
reward_factor = 5  // 如果物品是宠物当前请求的
hp_change = effect_HP * reward_factor
fv_change = effect_FV * item_favorite[name] * reward_factor
```

**角色偏好系统**：`pet_conf.json` 中定义 `item_favorite`（倍率 2.0）和 `item_dislike`（倍率 0.5）。

**为什么需要**：SpiritPal 的 `InventoryItem` 类型（`types.ts:87-97`）只有 `food/toy/medicine/accessory` 四种类型，缺少稀有度、偏好倍率、对话触发物品等维度。DyberPet 的 schema 是一个成熟、经过社区验证的方案。

##### E. 9 种气泡系统 + HP tier 映射 — 中价值 / 移植难度：低

**位置**：`DyberPet\bubbleManager.py:10-31, 60-62`

**9 种气泡类型**：`fv_lvlup`, `fv_drop`, `hp_low`, `hp_zero`, `feed_done`, `feed_required`, `pat_focus`, `pat_frequent`, `pat_random_N`

**HP tier → 可用气泡映射**：
- Tier 0（濒死）：`["fv_drop", "hp_zero", "feed_required"]`
- Tier 1（饥饿）：`["hp_low", "feed_required"]`
- Tier 2（正常）：`["hp_low", "feed_required"]`

`trigger_scheduled()`（L122）随机选择一个符合条件的气泡。

**为什么需要**：SpiritPal 当前的气泡消息（`CharacterProfile.bubbleMessages`）是静态配置的。DyberPet 的 HP tier 映射让气泡选择与养成数值联动，更自然。

##### F. 角色偏好（Favorite/Dislike）倍率 — 高价值 / 移植难度：极低

**位置**：`DyberPet\conf.py`（`pet_conf.json` 的 `item_favorite` / `item_dislike` 字段）

这是一个简单的乘数系统：角色对喜欢的物品反应更强（×2.0），对讨厌的物品反应更弱（×0.5）。SpiritPal 可以直接在 `CharacterProfile` 中添加 `favoriteItems` 和 `dislikeItems` 字段。

#### ⚠️ 重要发现

**`咕咕嘎嘎` 角色资源不存在于开源仓库中**。DyberPet 开源仓库（v0.6.7）的 `res/role/` 只包含 `ChrisKitty`、`Kitty` 和 `sys` 三个角色。`咕咕嘎嘎` 是 v0.7.7+ 的闭源发行版角色。SpiritPal 使用的 `咕咕嘎嘎` 资源需要从其他来源获取。

---

### 2.3 Dororo（Godot 4.4 + C# + GDScript）

> **仓库路径**：`repos\Dororo`  
> **技术栈**：Godot 4.4 + C# + GDScript，Live2D Cubism SDK  
> **关联报告**：`Dororo_Repo_Analysis.md`（34KB）+ `Dororo_Technical_Analysis_Report.md`（39KB）

#### 已采纳的资源

- 行为状态机概念（idle/walk/sleep/drag/happy/sad）→ SpiritPal 的 PetState 类型
- 随机行为调度（5-30s 间隔）

#### 🔴 尚未采纳但高价值的功能

##### A. 渐进式情绪反馈机制 — 极高价值 / 移植难度：极低

**位置**：`Dororo\scripts\gd\utils\time_counter.gd`（45 行）+ `window.gd:9,54-55,228-232`

这是 Dororo 最值得 SpiritPal 移植的 UX 机制——一个自重置计数器。

**核心代码**（`time_counter.gd`）：
- `increase()`（L18-23）：计数器 +1，重置持续时间，自动开始计时
- `_process(delta)`（L12-16）：累加持续时间；如果超过重置时间且无新 increment → `reset()`

**具体阈值（停靠弹出情绪阶梯）**：
| 鼠标悬停次数 | 情绪 |
|---|---|
| ≥ 3 次 | Doubt（怀疑） |
| ≥ 6 次 | DockPopAngry（愤怒） |
| 30 秒无新悬停（`dock_pop_expression_reset_time`） | 计数器重置为 0 |

**TypeScript 移植**：
```typescript
class InteractionCounter {
  count = 0;
  duration = 0;
  resetTimeMs = 30000;
  
  bump() { this.count++; this.duration = 0; }
  
  tick(dtMs: number) {
    if (this.count === 0) return;
    this.duration += dtMs;
    if (this.duration > this.resetTimeMs) { this.count = 0; this.duration = 0; }
  }
  
  emotion(): Emotion {
    if (this.count >= 6) return 'annoyed';
    if (this.count >= 3) return 'curious';
    return 'idle';
  }
}
```

**为什么需要**：SpiritPal 当前的行为状态机只基于数值条件和随机选择，缺少"交互累积→情绪变化"机制。这是 PRD Phase 2"渐进式情绪反馈"的直接实现。

##### B. 光标跟随（好奇心凝视）— 高价值 / 移植难度：低

**位置**：`Dororo\scripts\gd\interact\mouse_follow.gd`（33 行）

**归一化**（L18-29）：鼠标位置 → 窗口中心的 [-1,1] 向量：
```gdscript
var x_vec = clampf(x_dis / (window_size.x / 2.), -1, 1)
var y_vec = clampf(y_dis / (window_size.y / 2.), -1, 1)
```

**平滑**（L31-33）：指数移动平均（EMA），`smooth_factor=0.5`：
```gdscript
current_pos = (1 - factor) * current_pos + factor * target_pos
```

**门控**（L11-16）：停靠时禁用；关闭时平滑返回 (0,0)。输出驱动 `anim_controller.target_point()` → `HeadControl/blend_position`。

**为什么需要**：SpiritPal PRD Phase 2 要求"好奇心行为"。虽然不是完整的"窗口跟随鼠标移动"（Dororo 没有这个），但光标凝视是低成本高回报的交互增强。

**移植方式**：在 `PetWindow.tsx` 中添加 `onMouseMove` 处理，计算归一化坐标，通过 CSS `transform` 偏移精灵的"头部"区域。

##### C. 拖拽速度感知 — 中价值 / 移植难度：低

**位置**：`Dororo\scripts\gd\interact\drag_inertia.gd`（71 行）

**常量**（L6-9）：
```
motion_max_speed = 2000      # px/s 速度钳制
acceleration     = 8.0       # 拖拽中趋向目标的 lerp 因子
deceleration     = 12.0      # 释放后趋向零的 lerp 因子
drag_thresh      = 20        # px；低于此值不算拖拽
```

**速度捕获**（L32-43）：从 Godot 的 `event.velocity` 获取鼠标速度，钳制到 ±2000，归一化到 [-1,1]。

**平滑**（L52-58）：帧率相关的 lerp：
```gdscript
if is_dragging:
    current_velocity = current_velocity.lerp(target_velocity, acceleration * delta)
else:
    current_velocity = current_velocity.lerp(Vector2.ZERO, deceleration * delta)
```

**为什么需要**：SpiritPal 当前拖拽时固定旋转 8°（`PetWindow.tsx:534`）。Dororo 的速度感知让旋转角度与拖拽速度成正比，更有物理感。

**移植方式**：在 React 中从 `mousemove` 事件的时间戳差值计算速度，替换固定旋转。

##### D. 区域化触摸反应 — 中价值 / 移植难度：低

**位置**：`Dororo\scripts\gd\interact\touch.gd:15-24` + `hit_area_handler.gd`

右键点击宠物时，根据点击区域（`Face` → `SmileEyeClosed` + 爱心粒子，`Leg_back_L` → `Sullen`）触发不同反应。

**为什么需要**：SpiritPal 的右键菜单是通用的，但"右键点击宠物"本身可以有区域化的反应。PRD Phase 2"个性化互动偏好"的轻量实现。

#### ⚠️ 重要澄清

经过源代码级验证，以下功能在 Dororo 中**不存在**：
- ❌ 窗口追逐鼠标（Cursor Chase）
- ❌ 抛掷/重力/弹跳物理（Throw/Gravity/Bounce）
- ❌ 点击频率检测（Click Frequency Detection）
- ❌ CharacterBody 物理模拟（Dororo 是 Node2D + Live2D，不是 CharacterBody2D）

SpiritPal 如果需要这些功能，必须从头设计。

---

### 2.4 Feibi_desktop（Python + Tkinter）

> **仓库路径**：`repos\Feibi_desktop`  
> **技术栈**：Python + Tkinter + OpenAI API  
> **关联报告**：`Feibi_Repo_Analysis.md`（38KB）

#### 已采纳的资源

- 三层记忆系统（摘要 + 关键词检索历史 + 最近对话窗口）→ `memoryManager.ts`
- LCS 字符串相似度（替代 Python `difflib.SequenceMatcher`）
- CJK 分词（单字 + 拉丁单词）
- 记忆压缩（保留最近 10 条，其余摘要化）
- `MemoryEntry` / `MemoryData` 类型
- 角色"菲比"人设 → `characters.ts`

#### 🔴 尚未采纳但有价值的功能

##### A. 聊天阶段编排 — 高价值 / 移植难度：低-中

**位置**：`feibi_pet\pet.py:595-797` + `config_api.py:8-15`

**4 个阶段**：

| 阶段 | 绑定动画 | 触发条件 | 下一步 |
|---|---|---|---|
| `input` | `push`（拍地板） | 用户打开聊天对话框 | 用户输入 + 提交 |
| `waiting` | `eating` | 提交聊天请求 | LLM 回复或错误 |
| `reply` | `speaking` | LLM 回复成功 | 气泡自动隐藏后恢复 |
| `error` | `idle` | LLM 回复失败 | 自动恢复 |

**关键机制**：
- `chat_restore_action`（L743-747）：阶段开始时快照**当前**动画，阶段结束后恢复。如果阶段动画 == 当前动画，则快照 `default_action`
- `play_chat_stage()`（L739-759）：应用阶段动画 + 播放阶段音效 + 取消返回定时器
- `schedule_chat_restore()` + `restore_action_after_chat()`（L779-797）：`bubble_auto_hide_ms`（默认 8000ms）后恢复，1000ms 过渡
- `chat_request_inflight` 标志（L119）：防止重叠请求和空闲循环干扰

**为什么需要**：SpiritPal 当前聊天时宠物动画没有变化（始终 idle）。这个状态机让宠物在聊天过程中"看起来在做事情"——输入时拍地板、等待时吃东西、回复时说话。

**TypeScript 移植**：4 状态 reducer + setTimeout 替代 root.after + async/await 替代 daemon thread。

##### B. 记忆搜索评分公式微调 — 低价值但值得检查

**位置**：`chat_memory.py:122-144`

**精确公式**：
```python
score = overlap * 2.0 + ratio + recency * 0.15
if score > 0.2:
    scored.append((score, now + index, entry))
```

与 SpiritPal 当前实现对比：
- SpiritPal 的 `memoryManager.ts:174-188` 使用 `keywordScore * 0.6 + simScore * 0.4`
- Feibi 使用 `overlap * 2.0 + ratio + recency * 0.15`，且有 `score > 0.2` 阈值过滤
- Feibi 在 `SequenceMatcher` 中截断文本到前 800 字符（`text_lower[:800]`）以限制计算成本
- Feibi 的排序键使用 `now + index` 作为打破平局的因子（有效=最近优先）

**建议**：SpiritPal 的评分可能过低（0.6×权重），考虑增加关键词权重并添加阈值过滤。

##### C. 摘要失败回退 — 低价值 / 移植难度：极低

**位置**：`chat_memory.py:196-203`

```python
def _fallback_summary(self, old_entries):
    recent = old_entries[-20:]
    lines = [f"- {e['user'][:177]}...: {e['assistant'][:177]}..." for e in recent]
    return "最近的对话摘要：\n" + "\n".join(lines)
```

**为什么需要**：SpiritPal 的 `memoryManager.ts:153-158` 在摘要失败时只是保留旧摘要。Feibi 提供了具体的回退策略（保留最近 20 条，每条截断 180 字符）。

#### ⚠️ 重要澄清

经过源代码级验证，以下功能在 Feibi 中**不存在**：
- ❌ 好感度/经验/等级系统（Feibi 是纯聊天 + 动画宠物）
- ❌ 物品系统（无任何道具/背包/商店代码）
- ❌ 键盘跟随逻辑（无全局键盘钩子）
- ❌ 17 种情绪动画集（Feibi 只有 5 种：idle/push/eating/speaking/sleep）
- ❌ 角色偏好/讨厌物品倍率

SpiritPal 的这些功能必须从头设计，不能依赖 Feibi。

---

### 2.5 EchoBot（Python + FastAPI + JavaScript + Live2D）

> **仓库路径**：`repos\EchoBot`  
> **技术栈**：Python FastAPI + 原生 JavaScript ES Modules + PixiJS + Live2D Cubism  
> **关联报告**：`EchoBot_Repo_Analysis.md`（15KB）

#### 已采纳的资源

SpiritPal 从 EchoBot 采纳的资源有限，但架构理念有影响：
- OpenAI 兼容的 Chat Completions 流式调用
- 角色 systemPrompt + fewShotExamples 模式

#### 🔴 尚未采纳但高价值的功能

##### A. Live2D 动态模型加载 — 极高价值 / 移植难度：低

**位置**：
- 后端发现：`echobot/app/services/web_console/live2d/catalog.py:39-53`
- 后端修补：`echobot/app/services/web_console/live2d/service.py:206-249`
- 前端加载：`echobot/app/web/features/live2d/model.js:93-143`（关键行：L107）

**关键加载代码**：
```javascript
const model = await window.PIXI.live2d.Live2DModel.from(live2dConfig.model_url, {
    autoInteract: false,
});
```

**完整流程**：
1. 后端 `Live2DModelCatalog.discover_model_candidates()` 递归搜索 `*.model3.json` 文件
2. 后端 `Live2DMetadataService.patch_model_data()` 修补 `.model3.json`：注入发现的表情/动作/唇形参数
3. 后端通过 API 端点 `/api/web/live2d/{source}/{relative_path}` 提供修补后的 JSON
4. 前端调用 `PIXI.live2d.Live2DModel.from(url)` 加载模型

**使用的技术栈**：
- `pixi.min.js`（PixiJS WebGL 2D 渲染器）
- `live2dcubismcore.min.js`（Live2D Cubism Core 原生库）
- `cubism4.min.js`（即 `pixi-live2d-display` 的 Cubism 4 变体）

**为什么需要**：PRD Phase 1 明确要求 Live2D 渲染。SpiritPal 当前使用精灵图/atlas 渲染（`SpriteRenderer.tsx`），Live2D 是提升视觉质量的关键升级。EchoBot 提供了一个生产验证的加载方案。

##### B. Live2D 唇形同步（Lip-Sync）— 高价值 / 移植难度：低-中

**位置**：
- 参数解析：`service.py:251-276`
- 唇形钩子：`model.js:415-429, 691-719`
- 音量分析循环：`playback.js:447-484`
- 默认参数 ID：`constants.py:4-13`（`["ParamMouthOpenY", "PARAM_MOUTH_OPEN_Y", "MouthOpenY"]`）

**实现流程**：
1. 后端解析模型的 `FileReferences` 中的 LipSync 组，提取唇形参数 ID
2. 前端在 Live2D 模型上附加 `beforeModelUpdate` 钩子
3. TTS 播放时，`requestAnimationFrame` 循环从 `AnalyserNode` 计算 RMS 音量
4. 钩子调用 `coreModel.setParameterValueById(parameterId, value)` 设置嘴部参数

**为什么需要**：PRD Phase 3 要求语音交互时的嘴型同步。EchoBot 提供了一个完整的、基于音量分析的唇形同步方案，不依赖预录制的唇形动画。

##### C. TTS 多提供商系统 — 高价值 / 移植难度：低

**位置**：
- TTS 服务：`echobot/tts/service.py`
- TTS 工厂：`echobot/tts/factory.py`
- Edge TTS：`echobot/tts/providers/edge.py`（默认，免费在线）
- Kokoro TTS：`echobot/tts/providers/kokoro/provider.py`（本地离线，sherpa-onnx）
- OpenAI TTS：`echobot/tts/providers/openai_compatible.py`

**流式 TTS 架构**：
1. LLM 流式输出 → 文本分句（`text.js:26-74`，句号分割 + 140 字符强制分割）
2. 第一个句子完成后立即触发 TTS 合成
3. 后台合成 + 顺序播放 + 唇形同步

**为什么需要**：PRD Phase 3 要求语音交互。EchoBot 的 TTS 架构提供了多提供商切换 + 流式合成 + 唇形同步的完整方案。

##### D. 三层 LLM 架构 — 中价值 / 移植难度：中

**位置**：
- 决策引擎：`echobot/orchestration/decision.py:103-225`（规则 + LLM 双引擎意图分类）
- 角色扮演引擎：`echobot/orchestration/roleplay.py:105-475`（纯净角色输出，无工具调用）
- Agent 引擎：`echobot/agent.py:41-618`（完整能力，工具/记忆/技能）

**为什么需要**：SpiritPal 的 LLM 调用是扁平的（直接 `chat()`）。EchoBot 的三层架构（快速路由 → 角色纯净输出 → 完整能力）是更好的设计模式，适合 Phase 2 的"角色一致性保障"需求。

##### E. 技能/插件系统 — 中价值 / 移植难度：低

**位置**：
- 技能注册：`echobot/skill_support/registry.py`
- 技能解析：`echobot/skill_support/parsing.py`（YAML frontmatter + `SKILL.md`）
- 技能工具：`echobot/skill_support/tools.py`（`activate_skill`, `list_skill_resources`, `read_skill_resource`）

**SKILL.md 格式**：
```markdown
---
name: skill-name
description: Skill description
---
Body content with instructions...
```

**搜索路径**：`skills/` → `.echobot/skills/` → `.agents/skills/` → `echobot/skills/` → `~/.echobot/skills/` → `~/.agents/skills/`

**为什么需要**：PRD Phase 2 要求"角色模组系统"。EchoBot 的 SKILL.md 模式提供了一个轻量级的插件架构参考。

#### ⚠️ 重要澄清

**EchoBot 没有情绪系统**。经过全面搜索（所有 `.py`、`.js`、`.md` 文件），零匹配 `emotion`、`[happy]`、`<emotion`、`sentiment`、`mood`。EchoBot 的表情系统完全是手动/UI 驱动的，没有从 LLM 输出到表情的自动化管道。SpiritPal 如果需要"LLM 输出情绪标签 → 自动切换 Live2D 表情"，必须从头设计。

---

### 2.6 MurasamePet（Python + PyQt5 + FastAPI）

> **仓库路径**：`repos\MurasamePet`  
> **技术栈**：Python + PyQt5（桌面端）+ FastAPI（API 服务）+ GPT-SoVITS（TTS）  
> **关联报告**：`MurasamePet_Repo_Analysis.md`（18KB）

#### 🔴 尚未采纳但有价值的功能

##### A. GPT-SoVITS 语音合成集成 — 高价值 / 移植难度：中

**位置**：`gpt_sovits\api_v2.py`（529 行）+ `Murasame\chat.py:197-224`

**API 合约**：
- 端点：`POST /tts`（端口 9880）
- 请求字段：`text`, `text_lang`, `ref_audio_path`（参考音频路径）, `prompt_text`, `prompt_lang`, `top_k`, `top_p`, `temperature`, `speed_factor`, `streaming_mode`
- 响应：原始 WAV 音频流

**情绪驱动的参考音频系统**：
1. LLM 分析情绪 → 返回情绪标签（`chat.py:147-160`）
2. 根据情绪标签选择 `./models/Murasame_SoVITS/reference_voices/{emotion}/` 目录下的参考音频
3. 每个情绪目录包含：参考 WAV 文件 + `asr.txt`（参考音频的转录文本）
4. GPT-SoVITS 用参考音频进行零样本语音克隆
5. 输出缓存为 `./voices/{md5_of_japanese_text}.wav`

**为什么需要**：PRD Phase 3 要求情感化语音回复。GPT-SoVITS 是开源 TTS 中语音克隆质量最好的方案之一。

**SpiritPal 移植方式**：GPT-SoVITS 作为 sidecar 服务运行（与 MurasamePet 相同模式），SpiritPal 的 Rust 侧通过 HTTP 调用其 API。

##### B. 多阶段 AI 管道 — 中价值 / 移植难度：中

**位置**：`pet.py:652-725`（`LLMWorker.run()`）

**管道流程**：
1. 时间上下文注入（L666）：`"现在是{period}{hour}点{minute}分"`
2. LLM 生成回复（L672）
3. 日语翻译（L682）—— 为 TTS 准备输入
4. 情绪分析（L688）—— 为语音选择 + 立绘选择
5. TTS 并行线程生成（L695）
6. 立绘层选择（L703）
7. 等待 TTS 文件落盘（L713）
8. 全部结果发射到 UI（L723）

**为什么需要**：这是一个完整的 Galgame 风格交互管道。SpiritPal 可以参考其并行 TTS 生成模式（L695-696）和情绪分析 + 表情选择的串联模式。

##### C. 多提供商路由模式 — 低价值（概念） / 移植难度：低

**位置**：`api.py:359-396`

```python
if "openrouter.ai" in endpoint_url and api_key.strip():
    result = call_openrouter_api(config, api_key, "qwen/qwen3-235b-a22b", history, ...)
else:
    response = requests.post(f"{endpoint_url}/api/chat", json={"model": "qwen3:14b", ...})
```

**局限性**：MurasamePet 只支持两个后端（Ollama 本地 + OpenRouter 云端），模型名硬编码。没有提供商注册表、模型列表 UI 或运行时切换。概念可借鉴但实现需重新设计。

#### ⚠️ 重要澄清

**MurasamePet 没有 ASR/语音输入**。虽然 `pyproject.toml` 列出了 `funasr==1.0.27` 依赖，但项目中**没有任何 Python 文件导入或调用 FunASR**。这是 GPT-SoVITS 上游项目的依赖继承。MurasamePet 的输入完全是文本式的。

---

### 2.7 ameath_DesktopPet（Python + Tkinter）

> **仓库路径**：`repos\ameath_DesktopPet`  
> **技术栈**：Python + Tkinter + pystray + ctypes（Win32 API）  
> **关联报告**：`Ameath_Repo_Analysis.md`（35KB）

#### 已采纳的资源

- LLM 服务商预设概念 → SpiritPal 的 `LLMProvider` 类型

#### 🔴 尚未采纳但高价值的功能

##### A. 完整 LLM 服务商预设列表 — 高价值 / 移植难度：极低

**位置**：`src\constants.py:138-222`

**6 个提供商 + 27 个模型 + 6 个 Base URL**：

| 提供商 | ID | 默认模型 | 模型列表 | Base URL |
|---|---|---|---|---|
| DeepSeek | `deepseek` | `deepseek-chat` | `deepseek-chat`, `deepseek-reasoner` | `https://api.deepseek.com/v1` |
| OpenAI | `openai` | `gpt-3.5-turbo` | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo` | `https://api.openai.com/v1` |
| 千问 Qwen | `qwen` | `qwen-plus` | `qwen-plus`, `qwen-max`, `qwen-turbo`, `qwen-long`, `qwen-coder-plus`, `qwen-coder-turbo` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 智谱 GLM | `glm` | `glm-4-flash` | `glm-4`, `glm-4-flash`, `glm-4-plus`, `glm-4-air`, `glm-4-flashx` | `https://open.bigmodel.cn/api/paas/v4` |
| Kimi | `kimi` | `moonshot/kimi-k2-0711-preview` | `moonshot/kimi-k2-0711-preview`, `moonshot/kimi-k2-turbo-preview`, `moonshot/kimi-k2.5-preview` | `https://api.moonshot.ai/v1` |
| 豆包 | `doubao` | `doubao-1.5-pro-32k` | `doubao-1.5-pro-32k`, `doubao-1.5-pro-256k`, `doubao-1.5-lite-32k`, `doubao-pro-32k` | `https://ark.cn-beijing.volces.com/api/v3` |
| 自定义 | `custom` | （用户输入） | （用户输入） | （用户输入） |

**为什么需要**：SpiritPal 当前 `llmProviders.ts` 只有 1 个预设（DeepSeek）。PRD Phase 2 要求"多模型支持"。Ameath 的 6 个提供商列表可以直接移植。

**TypeScript 移植**：
```typescript
export const LLM_PROVIDERS: LLMProvider[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-3.5-turbo', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  // ... 其余 4 个
];
```

##### B. LLM 配置 UI 模式 — 高价值 / 移植难度：低

**位置**：`src\ai\config_dialog.py:29-714`（714 行）

**UI 模式**：
1. **提供商选择**：单选按钮网格（3 列布局）
2. **API Key**：密码输入 + 显示/隐藏切换
3. **模型**：Combobox 下拉列表（从 `AI_MODELS[provider]` 动态填充）+ "+" 按钮自定义模型
4. **Base URL**：文本输入 + 默认 URL 提示标签
5. **测试连接**：后台线程发送最小 POST 请求，显示加载模态框，处理 200/401/其他状态码

**关键交互**：`_on_provider_change`（L413）—— 切换提供商时自动更新模型列表、默认模型、Base URL 提示。

**为什么需要**：SpiritPal 的 `SettingsWindow.tsx` 需要 LLM 配置 UI。Ameath 的级联更新模式（提供商 → 模型列表 → 默认 Base URL）是最佳实践。

##### C. 系统托盘菜单结构 — 中价值 / 移植难度：低

**位置**：`src\platform\tray.py:24-392`

**菜单树**：
```
托盘菜单：
  - 显示/隐藏
  - 鼠标穿透（复选框）
  - 开机自启（复选框）
  - 快速启动 > [开启/关闭, 程序路径, 使用说明]
  - AI助手 > [开始对话, 快捷提问 > [讲个笑话, 今天星期几, 给我建议, 我累了], 随机话题, 配置AI, 清空对话历史]
  - 翻译助手 > [开启/关闭翻译, 手动翻译, 使用说明]
  - 行为模式 > [安静模式, 活泼模式, 粘人模式]（单选）
  - 番茄钟 > [开始/停止, 重置]
  - 缩放 > [0.3x ... 1.9x]（单选，9 选项）
  - 透明度 > [100% ... 30%]（单选，8 选项）
  - 退出
```

**关键模式**：每次状态变化后重建整个菜单（`icon.menu = self.build_menu()`），确保复选框/单选按钮状态同步。

**为什么需要**：SpiritPal 当前托盘菜单只有 4 项（显示/隐藏/设置/退出）。Ameath 的完整菜单结构是 PRD Phase 2"桌面功能扩展"的直接参考。

##### D. Ctrl 长按检测模式 — 中价值 / 移植难度：中

**位置**：`src\platform\hotkey.py:555-609`

**实现**：`SetWindowsHookEx(WH_KEYBOARD_LL)` 低级键盘钩子 + 50ms 轮询 `GetAsyncKeyState`，500ms 阈值触发翻译。

**为什么需要**：Tauri v2 有内置全局快捷键支持（`tauri-plugin-global-shortcut`），但 Ctrl 长按检测是自定义交互，需要在 Rust 中实现轮询逻辑。

##### E. 动画管理器（按缩放级别缓存）— 低价值 / 移植难度：低

**位置**：`src\animation\animation_manager.py` + `cache.py`

GIF 帧加载 → LANCZOS 缩放 → 按 `scale_index` 缓存 → 状态切换时自动选择对应帧集。左右翻转通过 `Image.Transpose.FLIP_LEFT_RIGHT` 生成。

**为什么需要**：SpiritPal 已有 `SpriteRenderer.tsx` 处理缩放，但 Ameath 的"按缩放级别缓存帧"模式在 SpiritPal 支持多种精灵尺寸时可参考。

---

## 三、综合价值矩阵

### 3.1 按功能缺口定位

| SpiritPal 功能缺口 | 可提供帮助的仓库 | 具体资源 | 优先级 |
|---|---|---|---|
| **双缓冲视频播放** | OC-Claw | `Mini.tsx:4079-4195` | P0 |
| **鼠标穿透** | OC-Claw | `lib.rs:5476-5714` | P0 |
| **HP→动画概率矩阵** | DyberPet | `modules.py:91-129` | P0 |
| **Buff 系统** | DyberPet | `buffModule.py` | P1 |
| **渐进式情绪反馈** | Dororo | `time_counter.gd` + `window.gd:228-232` | P0 |
| **光标跟随（好奇心凝视）** | Dororo | `mouse_follow.gd` | P1 |
| **聊天阶段编排** | Feibi | `pet.py:595-797` | P0 |
| **Live2D 动态加载** | EchoBot | `model.js:93-143` + 后端 catalog/service | P0 |
| **Live2D 唇形同步** | EchoBot | `playback.js:447-484` + `model.js:415-429` | P2 |
| **TTS 多提供商** | EchoBot | `tts/service.py` + providers | P2 |
| **GPT-SoVITS 集成** | MurasamePet | `gpt_sovits/api_v2.py` + `chat.py:197-224` | P3 |
| **LLM 提供商预设** | Ameath | `constants.py:138-222` | P0 |
| **LLM 配置 UI** | Ameath | `config_dialog.py:29-714` | P1 |
| **任务系统** | DyberPet | `conf.py:1175-1251` + `dashboard_widgets.py:3143` | P2 |
| **物品稀有度/偏好倍率** | DyberPet | `conf.py:1330` + `art_dev.md:515-556` | P1 |
| **自动更新** | OC-Claw | `lib.rs:11256-11600+` | P2 |
| **完整托盘菜单** | Ameath | `tray.py:24-392` | P2 |
| **三层 LLM 架构** | EchoBot | `decision.py` + `roleplay.py` + `agent.py` | P2 |
| **技能/插件系统** | EchoBot | `skill_support/` 模块 | P3 |
| **拖拽速度感知** | Dororo | `drag_inertia.gd` | P2 |
| **区域化触摸反应** | Dororo | `touch.gd` + `hit_area_handler.gd` | P3 |
| **记忆搜索优化** | Feibi | `chat_memory.py:122-144` | P1 |
| **系统空闲检测** | OC-Claw | `lib.rs:4342, 4368` | P2 |
| **角色偏好/讨厌物品** | DyberPet | `pet_conf.json` | P1 |
| **9 种气泡 HP tier 映射** | DyberPet | `bubbleManager.py:60-62` | P1 |
| **AI 多阶段管道** | MurasamePet | `pet.py:652-725` | P3 |
| **Ctrl 长按翻译** | Ameath | `hotkey.py:555-609` | P3 |

### 3.2 按仓库价值排名

| 排名 | 仓库 | 对 SpiritPal 的剩余价值 | 最高价值资源 |
|---|---|---|---|
| 🥇 1 | **OC-Claw** | ⭐⭐⭐⭐⭐ | 双缓冲视频、鼠标穿透、自动更新 |
| 🥈 2 | **DyberPet** | ⭐⭐⭐⭐⭐ | HP 概率矩阵、Buff 系统、物品 schema |
| 🥉 3 | **EchoBot** | ⭐⭐⭐⭐ | Live2D 加载、唇形同步、TTS 系统 |
| 4 | **Dororo** | ⭐⭐⭐⭐ | 渐进式情绪、光标跟随、拖拽速度 |
| 5 | **Ameath** | ⭐⭐⭐ | LLM 预设列表、配置 UI、托盘菜单 |
| 6 | **Feibi** | ⭐⭐⭐ | 聊天阶段编排、记忆优化 |
| 7 | **MurasamePet** | ⭐⭐ | GPT-SoVITS 集成、AI 管道模式 |

### 3.3 按移植难度排名

| 难度 | 数量 | 示例 |
|---|---|---|
| **极低**（纯数据/逻辑移植） | 12 项 | LLM 预设列表、HP 概率矩阵、渐进式情绪计数器 |
| **低**（适配 React/Tauri） | 15 项 | 双缓冲视频、聊天阶段、物品 schema |
| **中**（需要 Rust/TS 重写） | 10 项 | 鼠标穿透、Buff 系统、Live2D 加载 |
| **高**（需要全新设计） | 5 项 | 情绪→表情映射、抛掷物理、ASR 语音输入 |

---

## 四、关键发现与建议

### 4.1 代码注释中的灵感溯源

SpiritPal 源代码中明确标注了灵感来源的注释：

| 文件 | 行 | 标注来源 |
|---|---|---|
| `types.ts:4` | `// 精灵图集常量（来自 OC-Claw codexPet 格式）` | OC-Claw |
| `types.ts:39` | `// 角色档案（基于 DyberPet 三层配置）` | DyberPet |
| `types.ts:134` | `// 记忆条目（移植自 Feibi）` | Feibi |
| `types.ts:148` | `// LLM 服务商预设（来自 Ameath）` | Ameath |
| `memoryManager.ts:1` | `// 三层记忆系统 — 移植自 Feibi 的 chat_memory.py` | Feibi |
| `memoryManager.ts:47` | `// 移植自 Feibi 的 _tokens 函数` | Feibi |

### 4.2 被过度高估的资源

以下报告中提到的可复用资源，经源代码验证后发现**不存在或与描述不符**：

| 报告声称 | 实际情况 |
|---|---|
| "咕咕嘎嘎角色资源来自 DyberPet" | DyberPet 开源仓库中**不存在** `咕咕嘎嘎`（闭源角色） |
| "EchoBot 有情绪对话设计" | EchoBot **没有任何**情绪提取/情绪标签系统 |
| "Feibi 有 17 种情绪动画" | Feibi 只有 **5 种**动画集（idle/push/eating/speaking/sleep） |
| "Feibi 有键盘跟随逻辑" | Feibi **没有任何**全局键盘钩子或击键检测 |
| "Feibi 有好感度/经验系统" | Feibi 是纯聊天宠物，**没有**任何养成系统 |
| "MurasamePet 有 ASR 语音输入" | `funasr` 是 GPT-SoVITS 上游的依赖，MurasamePet **未使用** |
| "Dororo 有抛掷/重力物理" | Dororo 的窗口拖拽是纯位置 delta，**无物理模拟** |
| "Dororo 有光标追逐行为" | Dororo 有光标**凝视**（头部跟随），但窗口**不会**移动到鼠标位置 |

### 4.3 SpiritPal 必须从头设计的功能

以下功能在所有 7 个仓库中都**找不到参考**：

1. **LLM 情绪标签 → Live2D 表情自动映射**（需要设计 `[emotion:happy]` 格式 + 解析器 + 表情映射表）
2. **四段式增强记忆架构**（Working/Episodic/Semantic/Autobiographical，PRD Phase 2 核心差异化）
3. **本地向量检索**（SQLite + 嵌入模型，隐私优先）
4. **五维性格参数 + System Prompt 合成引擎**（角色一致性保障）
5. **AI 辅助角色创建**（对话式创建 → 自动生成参数）
6. **情境感知引擎**（时间/窗口/天气 → 行为映射）
7. **弹道物理**（重力、地板反弹、恢复系数）
8. **窗口追逐鼠标**（窗口加速移动到鼠标位置）

### 4.4 推荐移植优先级

#### Phase 1（MVP）立即移植

| 序号 | 资源 | 来源 | 工作量 |
|---|---|---|---|
| 1 | 双缓冲视频播放 | OC-Claw `Mini.tsx:4079-4195` | ~200 行 TS |
| 2 | HP→动画概率矩阵 | DyberPet `modules.py:91-129` | ~30 行 TS |
| 3 | 渐进式情绪计数器 | Dororo `time_counter.gd` | ~40 行 TS |
| 4 | LLM 提供商预设列表 | Ameath `constants.py:138-222` | ~60 行 TS |
| 5 | 聊天阶段编排 | Feibi `pet.py:595-797` | ~150 行 TS |
| 6 | 记忆搜索阈值 + 评分微调 | Feibi `chat_memory.py:122-144` | ~20 行 TS |

#### Phase 2 移植

| 序号 | 资源 | 来源 | 工作量 |
|---|---|---|---|
| 7 | 鼠标穿透 | OC-Claw `lib.rs:5476-5714` | ~200 行 Rust |
| 8 | Buff 系统 | DyberPet `buffModule.py` | ~150 行 TS |
| 9 | 物品配置 schema + 稀有度 | DyberPet `conf.py:1330` | ~80 行 TS |
| 10 | 角色偏好/讨厌倍率 | DyberPet `pet_conf.json` | ~30 行 TS |
| 11 | LLM 配置 UI | Ameath `config_dialog.py` | ~400 行 TSX |
| 12 | 任务系统 | DyberPet `conf.py:1175` | ~200 行 TS |
| 13 | 光标跟随 | Dororo `mouse_follow.gd` | ~40 行 TS |
| 14 | 拖拽速度感知 | Dororo `drag_inertia.gd` | ~60 行 TS |
| 15 | 完整托盘菜单 | Ameath `tray.py:24-392` | ~100 行 Rust |
| 16 | 9 种气泡 HP tier 映射 | DyberPet `bubbleManager.py` | ~60 行 TS |
| 17 | 三层 LLM 架构 | EchoBot `decision.py` + `roleplay.py` | ~300 行 TS |
| 18 | 系统空闲检测 | OC-Claw `lib.rs:4342` | ~80 行 Rust |

#### Phase 3 移植

| 序号 | 资源 | 来源 | 工作量 |
|---|---|---|---|
| 19 | Live2D 动态加载 | EchoBot `model.js` + 后端 | ~400 行 |
| 20 | Live2D 唇形同步 | EchoBot `playback.js` | ~150 行 |
| 21 | TTS 多提供商系统 | EchoBot `tts/` | ~300 行 |
| 22 | GPT-SoVITS 集成 | MurasamePet `api_v2.py` | ~200 行 Rust |
| 23 | 技能/插件系统 | EchoBot `skill_support/` | ~300 行 |
| 24 | AI 多阶段管道 | MurasamePet `pet.py:652-725` | ~200 行 TS |
| 25 | 自动更新 | OC-Claw `lib.rs:11256-11600` | ~200 行 Rust |

---

## 五、各仓库关键文件索引

### OC-Claw
| 文件 | 用途 |
|---|---|
| `oc-claw/frontend/src/Mini.tsx:4079-4195` | 双缓冲视频播放 |
| `oc-claw/frontend/src-tauri/src/lib.rs:5476-5714` | 鼠标穿透（Windows+macOS） |
| `oc-claw/frontend/src-tauri/src/lib.rs:11256-11600+` | 自动更新 |
| `oc-claw/frontend/src/lib/petStore.ts` | 养成模块（参考） |
| `oc-claw/CLAUDE.md:149-167` | 双缓冲关键规则文档 |

### DyberPet
| 文件 | 用途 |
|---|---|
| `DyberPet/DyberPet/modules.py:91-129` | HP→动画概率矩阵 |
| `DyberPet/DyberPet/Dashboard/buffModule.py` | Buff 系统（279 行） |
| `DyberPet/DyberPet/conf.py:1175-1251` | 任务数据结构 |
| `DyberPet/DyberPet/conf.py:1330` | 物品配置 schema |
| `DyberPet/DyberPet/bubbleManager.py` | 气泡系统 |
| `DyberPet/docs/art_dev.md:515-556` | 物品配置文档 |

### Dororo
| 文件 | 用途 |
|---|---|
| `Dororo/scripts/gd/utils/time_counter.gd` | 渐进式情绪计数器 |
| `Dororo/scripts/gd/interact/window.gd:228-232` | 情绪阈值阶梯 |
| `Dororo/scripts/gd/interact/mouse_follow.gd` | 光标跟随 |
| `Dororo/scripts/gd/interact/drag_inertia.gd` | 拖拽速度感知 |
| `Dororo/scripts/gd/interact/touch.gd` | 区域化触摸反应 |

### Feibi
| 文件 | 用途 |
|---|---|
| `Feibi_desktop/feibi_pet/pet.py:595-797` | 聊天阶段编排 |
| `Feibi_desktop/feibi_pet/chat_memory.py:122-144` | 记忆搜索评分 |
| `Feibi_desktop/feibi_pet/chat_memory.py:196-203` | 摘要失败回退 |

### EchoBot
| 文件 | 用途 |
|---|---|
| `EchoBot/echobot/app/web/features/live2d/model.js:93-143` | Live2D 加载 |
| `EchoBot/echobot/app/web/features/tts/playback.js:447-484` | 唇形同步 |
| `EchoBot/echobot/tts/service.py` | TTS 多提供商服务 |
| `EchoBot/echobot/orchestration/decision.py` | 三层 LLM 决策 |
| `EchoBot/echobot/skill_support/registry.py` | 技能系统 |

### MurasamePet
| 文件 | 用途 |
|---|---|
| `MurasamePet/gpt_sovits/api_v2.py` | GPT-SoVITS TTS API |
| `MurasamePet/Murasame/chat.py:197-224` | TTS 生成流程 |
| `MurasamePet/pet.py:652-725` | 多阶段 AI 管道 |

### Ameath
| 文件 | 用途 |
|---|---|
| `ameath_DesktopPet/src/constants.py:138-222` | LLM 提供商预设 |
| `ameath_DesktopPet/src/ai/config_dialog.py` | LLM 配置 UI |
| `ameath_DesktopPet/src/platform/tray.py` | 托盘菜单结构 |
| `ameath_DesktopPet/src/platform/hotkey.py` | 全局快捷键 |

---

## 六、结论

### 6.1 资源复用比例评估

```
功能需求资源来源分布（按需求数量统计）

  已采纳（SpiritPal 代码中已有）   ████████████░░░░░░░░░░░  ~28%
  可立即移植（低难度）          ████████████████░░░░░░░  ~35%
  可后续移植（中难度）          ████████░░░░░░░░░░░░░░░  ~18%
  必须原创设计                  ████░░░░░░░░░░░░░░░░░░░  ~12%
  远期规划（Phase 3-4）        ████░░░░░░░░░░░░░░░░░░░  ~7%
```

### 6.2 一句话总结

这 7 个仓库仍然为 SpiritPal 提供了约 **35%** 的可立即移植的代码资源（主要是数学公式、配置结构、UI 模式和架构模式），以及约 **18%** 的中等难度移植资源。核心的差异化功能（四段式记忆、情绪标签系统、五维性格引擎）仍需原创设计，但仓库提供了坚实的基础架构和成熟的实现模式，可以显著降低开发成本和风险。

---

> **文档版本**：v1.0  
> **生成工具**：ZCode 源代码分析  
> **分析范围**：7 个仓库 + 8 份分析报告 + SpiritPal 全部源码 + PRD v0.2

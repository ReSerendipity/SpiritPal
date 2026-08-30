# DyberPet 开源仓库技术分析报告

> 仓库地址：https://github.com/ChaozhongLiu/DyberPet
> 分析日期：2026-07-11
> 分析分支：main
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，为后续跨平台桌面宠物 PRD 提供参考

---

## 目录

1. [项目概览](#1-项目概览)
2. [核心技术栈](#2-核心技术栈)
3. [项目架构与目录结构](#3-项目架构与目录结构)
4. [核心功能模块详解](#4-核心功能模块详解)
5. [技术实现细节](#5-技术实现细节)
6. [数据处理流程](#6-数据处理流程)
7. [UI/UX设计分析](#7-uiux设计分析)
8. [动画与渲染系统](#8-动画与渲染系统)
9. [AI/聊天集成分析](#9-ai聊天集成分析)
10. [构建与打包流程](#10-构建与打包流程)
11. [版本发布与迭代历史](#11-版本发布与迭代历史)
12. [社区与Issue概况](#12-社区与issue概况)
13. [优缺点分析](#13-优缺点分析)
14. [可借鉴特性](#14-可借鉴特性)
15. [潜在改进点](#15-潜在改进点)
16. [跨平台支持评估](#16-跨平台支持评估)
17. [总结与技术参考价值](#17-总结与技术参考价值)

---

## 1. 项目概览

DyberPet（呆啵宠物）是一款基于 PySide6 的桌面赛博宠物框架，项目标语为「让喜欢的角色住进桌面，模组自由，AI 相伴」。项目以三大核心定位构建：桌宠系统（动画、交互、养成、任务、商店与迷你宠物）、AI 助手（接入大模型，陪伴聊天、管理待办、协助日常）、MOD 生态（角色、道具、音效、迷你宠物均可自由扩展与创作）。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | DyberPet（呆啵宠物） |
| 仓库地址 | https://github.com/ChaozhongLiu/DyberPet |
| 作者 | ChaozhongLiu（B站: https://space.bilibili.com/39307302） |
| 许可证 | GPL-3.0 |
| Stars | 851 |
| Forks | 86 |
| Open Issues | 16（已关闭 45，共 61） |
| 总提交数 | 621 |
| Tags | 14 |
| 创建时间 | 2022-11-09 |
| 最近更新 | 2026-07-10（活跃维护中） |
| 最新版本 | v0.8.5（2026-05-19） |
| 开源代码版本 | v0.6.7（2025-01-26） |
| 主要语言 | Python |
| Topics | desktop-pet |
| 测试 QQ 群 | 557261268 |

### 当前状态

项目最新版本 v0.8.5（2026-05-19），但**开源代码停留在 v0.6.7**，从 v0.7.7 起引入的 LLM/AI 功能以闭源 EXE 形式发布。这是一个采用「开源基础框架 + 闭源高级功能」策略的项目，形成了独特的商业化路径。

---

## 2. 核心技术栈

| 维度 | 技术选型 |
|------|----------|
| **运行时语言** | Python 3.9.18（conda 环境推荐） |
| **GUI 框架** | PySide6 6.5.2（Qt6 的 Python 绑定） |
| **UI 组件库** | PySide6-Fluent-Widgets 1.5.4（Windows 11 风格） |
| **定时任务** | APScheduler（conda-forge 最新版） |
| **鼠标键盘监听** | pynput（Windows: 最新 / macOS: 1.7.6） |
| **单例控制** | tendo |
| **打包工具** | PyInstaller 6.5.0 |
| **国际化** | Qt 翻译系统（`langs.pro`） |

### 依赖安装命令

```bash
conda create --name Dyber_pyside python=3.9.18
conda install -c conda-forge apscheduler
conda install -c conda-forge pynput      # Windows
pip install pynput==1.7.6                 # macOS
pip install PySide6-Fluent-Widgets==1.5.4
pip install pyside6==6.5.2
pip install tendo
```

### 技术栈特征

- **无标准化打包配置**：项目未提供 `requirements.txt` / `setup.py` / `pyproject.toml`，依赖通过 README 文档说明
- **历史迁移**：v0.3.0a（2023-10）从 PyQt5 迁移至 PySide6；v0.3.7 适配 Fluent-Widgets 1.5.4
- **版本断层**：`settings.py` 中 `VERSION = "v0.6.7"`，开源代码版本与最新发布版本存在断层

---

## 3. 项目架构与目录结构

### 顶层结构

```
DyberPet/
├── DyberPet/              # 主源代码目录
├── docs/                  # 文档目录
├── res/                   # 资源目录
├── .gitignore
├── LICENSE                # GPL-3.0
├── README.md              # 中文 README
├── README_EN.md           # 英文 README
├── langs.pro              # Qt 语言翻译工程文件
└── run_DyberPet.py        # 程序入口
```

### 主源代码目录（DyberPet/）

```
DyberPet/
├── __init__.py
├── DyberPet.py            (84 KB)  # 核心桌宠主控件 PetWidget
├── Accessory.py           (80 KB)  # 附件/组件动画系统 DPAccessory
├── Notification.py        (36 KB)  # 通知系统 DPNote
├── conf.py                (56 KB)  # 数据管理（PetData/TaskData/ActData/ItemData）
├── modules.py             (54 KB)  # 通用模块/工具
├── settings.py            (15 KB)  # 全局设置与常量
├── extra_windows.py      (115 KB)  # 额外窗口（待办、专注等）
├── custom_roundmenu.py    (39 KB)  # 自定义右键菜单
├── custom_widgets.py      (19 KB)  # 自定义 widget
├── bubbleManager.py        (7 KB)  # 对话气泡管理
├── utils.py               (11 KB)  # 工具函数
├── Dashboard/                      # 仪表盘（角色面板）
│   ├── DashboardUI.py              # 仪表盘主窗口
│   ├── dashboard_widgets.py (127 KB) # 仪表盘组件集合
│   ├── statusUI.py                 # 状态面板（HP/FV）
│   ├── inventoryUI.py              # 背包面板
│   ├── shopUI.py                   # 商店面板
│   ├── taskUI.py                   # 任务面板
│   ├── animationUI.py              # 动画面板
│   ├── animDesignUI.py (45 KB)     # 动作设计面板
│   └── buffModule.py               # Buff 系统
├── DyberSettings/                  # 系统设置
│   ├── DyberControlPanel.py        # 控制面板主窗口
│   ├── BasicSettingUI.py           # 基本设置
│   ├── CharCardUI.py               # 角色卡片
│   ├── PetCardUI.py                # 迷你宠物卡片
│   ├── ItemCardUI.py               # 物品卡片
│   ├── GameSaveUI.py               # 存档管理
│   ├── custom_base.py              # 自定义基类
│   ├── custom_combobox.py          # 自定义下拉框
│   ├── custom_utils.py (69 KB)     # 自定义工具
│   └── fileOp_utils.py             # 文件操作工具
├── HideDock/                       # 侧边悬挂功能（v0.7.7+）
└── SelfStartup/                    # 开机自启
```

### 资源目录（res/）

```
res/
├── icons/          # 图标资源
├── items/          # 物品模组
│   └── Default/    # 默认物品（含 items_config.json）
├── language/       # 多语言文件
├── pet/            # 迷你宠物模组
├── role/           # 角色模组（每个角色一个文件夹）
└── sounds/         # 音效资源
```

### 架构特征

项目采用**信号槽驱动的模块化架构**，以 `PetWidget` 为核心，通过 Qt 信号槽机制连接通知系统、附件系统、控制面板和仪表盘各模块。代码组织按功能域划分目录，但单文件体量较大（`extra_windows.py` 115KB、`dashboard_widgets.py` 127KB），反映出一定的大型类聚集倾向。

---

## 4. 核心功能模块详解

### 4.1 养成系统

DyberPet 拥有 7 个项目中**最完整的养成系统**，核心常量定义在 `settings.py`。

#### 饱食度（HP）系统

```python
HP_TIERS = [0, 50, 80, 100]                                    # 4 个等级阈值
TIER_NAMES = ['Starving', 'Hungry', 'Normal', 'Energetic']     # 饿昏/饥饿/正常/活力
HP_INTERVAL = 2                                                 # 每 2 分钟下降一次
```

- 4 级饱食度：0（饿昏）、1（饥饿 hp>0）、2（正常 hp>50）、3（活力 hp>80）
- 不同等级影响动画播放概率矩阵
- v0.6.5 新增 `auto_lock`：屏幕锁定时 HP/FV 停止变化

#### 好感度（FV）系统

```python
LVL_BAR_V1 = [20, 120, 300, 600, 1200, 1800, 2400, 3200]  # 旧版 7 级
LVL_BAR = [20] + [120]*200                                  # 新版 200 级（v0.6.4）
# v0.8.5 进一步提升至 256 级（4 皇冠）
```

- v0.6.4 从 7 级上限改为 200 级，每级需 120 好感度
- 好感度徽章体系：星星（1级）、月亮（4级）、太阳（16级）、皇冠（64级）
- 好感度等级影响动作解锁

#### 金币（Coin）系统

```python
PP_COIN = 0.9            # 掉落金币概率
COIN_MU = 10             # 金币数量均值（正态分布）
COIN_SIGMA = 5           # 金币数量标准差
ITEM_DEPRECIATION = 0.75 # 商店卖出贬值 25%
SINGLETASK_REWARD = 200  # 单任务奖励 200 金币
FIVETASK_REWARD = 1500   # 每 5 任务奖励 1500 金币
```

- v0.6.3 金币样式可自定义
- 金币掉落动画最大个数限制为 10（v0.5.8）

#### 物品系统

```python
PP_ITEM = 0.95       # 物品掉落概率
ITEM_BGC = {         # 物品类型背景色
    'consumable': '#EFEBDF',  # 消耗品
    'collection': '#e1eaf4',  # 收藏品
    'Empty': '#f0f0ef',
    'dialogue': '#e1eaf4',    # 对话类
    'subpet': '#f6eae9',      # 迷你宠物
    'autofeed': '#e7f1e4'     # 自动喂食
}
AUTOFEED_THRESHOLD = 60  # 饱食度低于 60 自动喂食
```

- 6 种物品类型：消耗品、收藏品、对话类、迷你宠物、自动喂食、空
- 物品属性包括：`fv_reward`（好感度奖励）、`buff`（Buff 加成）、`item_favorite`/`item_dislike`（喜爱度倍率）
- v0.6.6 背包升级为可自由拖动交换的格子
- v0.6.6 新增自动喂食功能（背包第一格物品在 HP<60 时自动使用）

#### 任务系统

- 番茄钟（Pomodoro）和专注时间（Focus Timer）
- 专注时间与专注动画 `focus` 绑定（v0.5.6）
- 任务完成奖励金币
- 6 种通知类型：`{start/end/cancel}_{tomato/focus}`

#### 商店系统

- v0.3.4 实装购买和出售功能
- 支持按字符搜索、按标签筛选
- 物品默认价格按星级提升
- 卖出贬值 25%（`ITEM_DEPRECIATION = 0.75`）

### 4.2 模组系统（JSON 驱动设计）

#### 角色模组文件结构

```
角色名/
├── act_conf.json          # 动作参数（必需）
├── pet_conf.json          # 桌宠参数（必需）
├── msg_conf.json          # 对话配置（可选）
├── action/                # PNG 动画帧（必需）
├── note/                  # 个性化通知（可选）
│   ├── note.json          # 通知图标/音频配置
│   ├── bubble_conf.json   # 对话气泡配置
│   ├── icon.png
│   └── *.wav
├── info/                  # 作者信息（可选但推荐）
│   ├── info.json
│   ├── pfp.png            # 头像
│   └── author.png
└── items/                 # 角色自带物品（可选）
    ├── items_config.json
    └── *.png
```

#### pet_conf.json 核心配置

```json
{
  "width": 98, "height": 98, "scale": 1.0,
  "default": "breath", "left": "left", "right": "right",
  "drag": "drag", "fall": "fall", "focus": "focus",
  "patpat": {"0":"patpat0", "1":"patpat1", "2":"patpat2", "3":"patpat3"},
  "random_act": [...],
  "accessory_act": [...],
  "item_favorite": {"薯条": 2.0},
  "item_dislike": {"汉堡": 0.5},
  "coin_config": { ... }
}
```

#### 模组自动加载

- 程序启动时读取 `data/role` 中所有文件夹，自动判定并获取角色列表
- 角色若包含 `items/` 文件夹，会自动导入其中的物品（v0.3.7）
- 系统内提供模组自动添加功能，会检查模组文件夹并给出潜在错误提示

### 4.3 通知与对话气泡系统

- **通知栏**：QToaster 类，支持合并（饱食度/好感度/物品增减通知合并）
- **对话气泡**：位于桌宠上方，9 种类型（v0.6.7）
  - 随机索要食物对话，完成后 HP/FV 增加 ×5（`FACTOR_FEED_REQ = 5`）
  - 频繁点击（1s 内 ≥7 次）触发气泡
  - 专注时间内拍拍触发气泡
  - 同种气泡同一时间只出现一个
  - 可在设置中关闭

### 4.4 迷你宠物系统

- v0.5.0 引入迷你宠物
- 迷你宠物跟随主宠物
- 迷你宠物跟随逻辑考虑多屏幕情况（v0.5.4）
- 迷你宠物可作为物品掉落

---

## 5. 技术实现细节

### 5.1 窗口透明与置顶

- 使用 PySide6 的 QWidget 实现透明无边框窗口
- `on_top_hint` 控制是否置顶（v0.1.15 添加设置选项）
- `NoDropShadowWindowHint`（为 macOS 准备）
- `setQuitOnLastWindowClosed(False)` 隐藏主窗口后保持运行

### 5.2 应用架构（信号槽机制）

`run_DyberPet.py` 中的 `DyberPetApp` 类通过 Qt 信号槽连接各模块：

```
PetWidget (主宠物)
    ├─ Notification (通知系统)
    ├─ Accessory (附件系统)
    ├─ ControlMainWindow (系统面板)
    └─ DashboardMainWindow (仪表盘)
        ├─ StatusInterface (状态面板)
        ├─ BackpackInterface (背包)
        ├─ ShopInterface (商店)
        ├─ TaskInterface (任务/专注)
        └─ AnimInterface (动画面板)
```

关键信号连接：
- `hp_updated` → 状态面板更新 HP
- `fv_updated` → 状态面板更新 FV
- `addItem_toInven` → 背包添加物品
- `addCoins` → 背包增加金币
- `autofeed` → 自动喂食
- `single_pomo_done` → 番茄钟完成

### 5.3 单例进程控制

```python
from tendo import singleton
try:
    me = singleton.SingleInstance()
except:
    sys.exit()
```

防止多开导致数据存储混乱；为支持多宠物同屏，使用「召唤同伴」功能。

### 5.4 拖拽与物理系统

- 鼠标拖拽掉落计算逻辑参考了 WolfChen1996/DesktopPet
- 重力加速度（`gravity` 默认 0.1，最小 0.01）
- 屏幕边界反弹（`SPEED_DECAY = 0.5`）
- v0.4.2 添加反弹机制

### 5.5 多屏支持

- v0.1.16 实现多屏之间转移
- 主屏幕插入到 screens 列表首位
- 迷你宠物跟随逻辑考虑多屏幕情况（v0.5.4）

### 5.6 跨午夜定时器

```python
def set_midnight_timer(self):
    now = QDateTime.currentDateTime()
    midnight = QDateTime(QDate.currentDate().addDays(1), QTime(0, 0, 0))
    msecs_until_midnight = now.msecsTo(midnight)
    self.timer = QTimer(self)
    self.timer.setSingleShot(True)
    self.timer.timeout.connect(self.check_date)
    self.timer.start(msecs_until_midnight)
```

在午夜触发日期变更，更新喂养天数等日期相关数据。

---

## 6. 数据处理流程

### 6.1 配置加载流程

1. **启动时**：`settings.init()` 读取 `data/settings.json`
2. **角色列表**：扫描 `res/role/` 目录获取角色文件夹
3. **角色参数**：加载 `res/role/{宠物名}/pet_conf.json` 和 `act_conf.json`
4. **物品数据**：加载 `res/items/Default/items_config.json`
5. **语言**：加载 `res/language/language.json`

### 6.2 数据管理类（conf.py）

| 类名 | 职责 |
|------|------|
| **PetData** | 宠物数值（HP/FV）和物品数据 |
| **TaskData** | 任务数据（`task_data.json`） |
| **ActData** | 动画配置数据（v0.4.0 重构） |
| **ItemData** | 物品数据 |

### 6.3 存档系统

- v0.3.0a 实装存档系统：每个角色独立存档
- 存档管理 UI：导出、导入、快速存档
- `data/settings.json`：全局设置
- `data/task_data.json`：任务数据（导出时备份但不导入）
- v0.2.2 优化：关闭前主动存储一次数据并冻结，避免数据丢失
- v0.5.0 改进存档相关功能，避免崩溃闪退

### 6.4 配置文件路径

| 平台 | 路径 |
|------|------|
| Windows | 程序所在目录 |
| Linux | `~/.config/DyberPet/DyberPet` |
| macOS | 程序所在目录 |

---

## 7. UI/UX设计分析

### 7.1 界面布局

- **右键菜单**：Fluent-Widgets RoundMenu，含子菜单（角色面板升级为子菜单可直接跳转背包/商店）
- **系统面板**（ControlMainWindow）：基本设置、角色管理、存档管理、宠物管理、物品管理
- **仪表盘**（Dashboard）：状态面板、背包、商店、任务、动画
- **通知栏**：QToaster 类，支持合并
- **对话气泡**：位于桌宠上方，9 种类型

### 7.2 Fluent-Widgets 使用

| 使用场景 | 说明 |
|----------|------|
| UI 框架基础 | 构建 Windows 11 风格界面 |
| 翻译系统 | `FluentTranslator` 进行 UI 文本国际化 |
| 主题色自定义 | v0.4.3 添加自定义应用主题色功能（`setThemeColor`） |
| 通知栏 UI | v0.3.7 采用 Fluent-Widgets 优化 |
| 右键菜单 | `RoundMenu` 替代原生菜单（`custom_roundmenu.py` 38KB 自定义扩展） |
| 设置界面 | 基本设置 UI 更贴近 Windows 11 风格 |

### 7.3 国际化

- 中英双语支持
- `langs.pro` Qt 翻译工程文件
- `res/language/` 存放翻译文件
- 用户昵称系统（v0.6.2）：宠物用自定义昵称称呼用户

---

## 8. 动画与渲染系统

### 8.1 动画实现原理

DyberPet 采用 **PNG 序列帧动画**（非骨骼动画），通过时间间隔依次显示 PNG 透明背景图片实现类 GIF 效果。

1. **动画模块**：独立于主界面运行，避免加载动画导致程序未响应；用户交互时暂停等待，优先级最低
2. **交互模块**：即时响应用户交互行为
3. **渲染方式**：按时间间隔依次显示 PNG 透明背景图片
4. **图片命名**：`{前缀}_{数字}.png`（如 `stand_0.png, stand_1.png`），v0.5.9 起支持任意数字起始和编号格式

### 8.2 动作参数（act_conf.json）

```json
{
  "left_walk": {
    "images": "leftwalk",      // PNG 文件前缀
    "act_num": 5,              // 重复次数（减少内存）
    "need_move": true,         // 是否移动
    "direction": "left",       // 移动方向
    "frame_move": 0.5,         // 单位时间移动距离
    "frame_refresh": 0.2,      // 单帧刷新间隔（秒）
    "anchor": [0, 36]          // 锚点偏移
  }
}
```

### 8.3 饱食度分级与动画概率矩阵

| 动作定义状态 \ 当前饱食度 | 3(活力) | 2(正常) | 1(饥饿) | 0(饿昏) |
|:---|:---|:---|:---|:---|
| 3（活跃 hp>80） | a | a/4 | a/16 | 0 |
| 2（正常 hp>50） | a/4 | a | a/4 | 0 |
| 1（饥饿 hp>0） | 0 | 0 | a | 0 |
| 0（饿昏 hp=0） | 0 | 0 | 0 | a |

这是一个精巧的设计：饱食度等级与动作定义状态的交叉点决定动画播放概率，使得宠物在不同饥饿状态下表现出合理的行为模式。

### 8.4 必需与可选动作

- **必需动作**：`default`（静息）、`drag`（拖拽）、`fall`（下落）
- **可选动作**：`left`/`right`（行走）、`prefall`（下落预备）、`patpat`（拍拍）、`focus`（专注）
- **特殊内部动作**：`feed_1/2/3`（喂食反应）、`on_floor`（落地）

### 8.5 Anchor 锚点系统

用于不同动作间播放连贯性，避免切换动作时整体闪现。定义角色「底部中心」相对于图片「底边中点」的偏移。

### 8.6 内存优化

- v0.3.5 将几乎所有 `QImage` 替换为 `QPixmap`，节省内存提升效率
- `act_num` 参数允许一个循环图片重复播放 N 次
- 金币掉落动画最大个数限制为 10（v0.5.8）

---

## 9. AI/聊天集成分析

### 9.1 开源与闭源分界

| 版本 | 发布日期 | 开源状态 | LLM 功能 |
|------|---------|---------|---------|
| v0.6.7 | 2025-01-26 | **开源（GitHub 代码）** | 无 LLM |
| v0.7.7 | 2026-03-01 | **闭源（仅 EXE）** | **首次引入 LLM** |
| v0.8.5 | 2026-05-19 | **闭源（仅 EXE）** | LLM 全面升级 |

### 9.2 v0.7.7 LLM 功能（闭源首次引入）

1. **用户行为反馈**：拖拽、喂食、摸摸等行为与 LLM 模块连接，做出即时反馈
2. **聊天界面**：可用文字和宠物交流
3. **上下文自动总结**：超过设定长度时自动总结聊天历史以节省 token
4. **长期记忆系统**：LLM 自行决定是否存储为长期记忆，可在记忆管理界面删除和整理
5. **环境感知能力**：感知用户聚焦的软件、音乐播放等环境变化
6. 新角色「小呆」+ 侧边悬挂功能

### 9.3 v0.8.5 LLM 功能升级

1. 聊天界面改版，新增「角色设定」按钮
2. 上下文长度 2,500 - 100,000 tokens 可调
3. 上下文压缩更智能：优先清除工具调用记录
4. 每次对话自动保存为文本文件（`data/chat_logs/宠物名称`）
5. **AI 助手管理待办任务**：查看清单、添加、修改、标记完成
6. 支持自然语言交互（如「帮我添加明天下午 3 点的会议」）
7. DeepSeek V4 模型兼容性修复

### 9.4 LLM 集成深度分析

DyberPet 的 LLM 集成不是简单的聊天功能，而是深度融入桌宠生态系统：

- **行为-反馈闭环**：用户行为（拖拽/喂食/摸摸）触发 LLM 生成个性化反馈
- **记忆-情感关联**：长期记忆系统影响好感度变化
- **环境感知**：LLM 能感知用户当前使用的软件和音乐
- **任务管理**：LLM 可直接操作待办任务系统
- **角色定制**：用户可自定义角色设定

---

## 10. 构建与打包流程

### PyInstaller 打包

**Windows**：
```bash
pyinstaller --noconsole --icon="000.ico" \
  --hidden-import="pynput.mouse._win32" \
  --hidden-import="pynput.keyboard._win32" \
  run_DyberPet.py
```

**macOS**：
```bash
pyinstaller --windowed --icon 000.icns \
  --add-data="res:res" \
  --add-data="DyberPet:DyberPet" \
  --hidden-import="pynput.mouse._darwin" \
  --hidden-import="pynput.keyboard._darwin" \
  run_DyberPet.py
```

- 使用 PyInstaller 6.5.0
- v0.3.1b 切换了打包方式
- 发布两种 EXE：标准版和 Terminal 版（用于错误调试）

### 打包特征

- 无 CI/CD 自动化构建配置
- 手动打包发布到 GitHub Releases 和夸克网盘
- 资源文件通过 `--add-data` 打包（macOS）

---

## 11. 版本发布与迭代历史

### 主要版本变更

| 版本 | 日期 | 关键变更 |
|------|------|---------|
| **v0.8.5** | 2026-05-19 | 聊天界面全面升级、AI 管理待办、好感度上限 256、角色设定按钮、上下文 100K tokens |
| **v0.7.7** | 2026-03-01 | **首次引入 LLM**：聊天界面、长期记忆、环境感知、新角色小呆、侧边悬挂 |
| v0.6.7 | 2025-01-26 | 9 种对话气泡、用户昵称、好感度 200 级、自动锁定、背包拖动、自动喂食 |
| v0.5.7 | 2024-09-22 | 迷你宠物系统优化、通知合并、专注动画绑定 |
| v0.5.1 | 2024-08-23 | 独立大小参数、存档改进 |
| v0.4.9 | 2024-07-20 | 专注时间 bug 修复、镜像动作 Anchor 修复 |
| v0.4.7 | 2024-06-15 | 软件更新提醒、语言修复 |
| v0.4.6 | 2024-05-11 | patpat 支持按饱食度分级定义 |
| v0.4.2 | 2024-05-04 | 自定义动作、动作设计功能 |
| v0.3.7b | 2024-04 | Fluent-Widgets 1.5.4 适配 |
| v0.3.0a | 2023-10 | **PySide6 迁移**、物品模组、存档系统 |
| v0.1.2 | 2022-11 | 最初版本上线 |

### 里程碑总结

1. **2022-11 ~ 2023-03**：基础框架搭建（PyQt5 时代）
2. **2023-10**：迁移至 PySide6，引入 Fluent-Widgets
3. **2024-01 ~ 2024-05**：商店、Buff、迷你宠物、动作设计
4. **2024-08 ~ 2025-01**：对话气泡、背包升级、自动喂食（开源最终版 v0.6.7）
5. **2026-03**：LLM 模块引入（闭源 EXE）
6. **2026-05**：LLM 全面升级，AI 助手管理待办

---

## 12. 社区与Issue概况

### 开放 Issue 统计（16 个开放，45 个已关闭）

#### 常见用户反馈/需求

| Issue | 标题 | 类型 | 时间 |
|-------|------|------|------|
| #92 | 睡觉时会要东西吃 | enhancement | 2026-06 |
| #86 | 添加定时提醒功能 | enhancement | 2025-12 |
| #70 | 桌宠虚化 | enhancement | 2025-06 |
| #59 | 是否支持对话交互？ | question | 2025-04（v0.7.7+ 已支持） |
| #56 | 动画帧速率调节支持 | enhancement | 2025-04 |
| #55 | Linux 版本支持 | enhancement | 2025-02 |
| #54 | 开机自启选项 | enhancement | 2025-02 |
| #51 | 边界自动停止、自动喂食 | enhancement | 2024-11 |
| #50 | Mac 边界 bug | bug | 2024-10 |
| #48 | OBS 无法捕获桌宠 | enhancement | 2024-10 |
| #31 | 检查更新 | enhancement | 2024-01（17 评论，最多讨论） |
| #27 | 拖动太敏感 | bug | 2024-07（7 评论） |
| #22 | 宠物置顶 | enhancement | 2024-01（5 评论） |

### 用户反馈趋势

- **跨平台需求强**：Linux 支持、Mac 兼容性
- **交互体验优化**：拖动敏感度、动画帧率
- **功能扩展**：定时提醒、开机自启、OBS 捕获
- **LLM 相关**：对话交互需求（v0.7.7 后满足）

---

## 13. 优缺点分析

### 优点

1. **最完整的养成系统**：7 个项目中唯一拥有 HP/FV/金币/物品/任务/商店/Buff 完整闭环的项目
2. **JSON 驱动模组生态**：无需写代码即可创作新角色/物品/宠物，模组系统设计精良
3. **饱食度-动画概率矩阵**：精巧的设计使宠物行为随状态变化，增强真实感
4. **Fluent-Widgets 集成**：Windows 11 风格 UI，视觉体验现代
5. **LLM 深度集成**：行为反馈、长期记忆、环境感知、任务管理，技术含量高
6. **活跃维护**：2022 年至今持续迭代，621 commits
7. **文档完善**：中英双语 README，详细更新日志

### 缺点

1. **LLM 模块闭源**：核心 AI 功能不开源，社区无法参与改进
2. **无标准化打包配置**：缺少 requirements.txt/setup.py/pyproject.toml
3. **跨平台支持不足**：Linux 未官方支持，macOS 存在兼容性问题
4. **单文件体量过大**：`extra_windows.py` 115KB、`dashboard_widgets.py` 127KB，可维护性受限
5. **无自动化测试**：未发现测试文件
6. **无 CI/CD**：手动打包发布
7. **Python 系限制**：无法支持移动端

---

## 14. 可借鉴特性

### 14.1 养成系统设计

DyberPet 的养成系统是 7 个项目中最值得借鉴的部分：

- **HP 4 级分级**与动画概率矩阵的联动设计
- **FV 256 级 + 徽章体系**（星星/月亮/太阳/皇冠）提供长期养成目标
- **金币正态分布掉落**（`COIN_MU=10, COIN_SIGMA=5`）增加随机性
- **物品 6 分类 + 喜爱度倍率**丰富交互维度
- **任务-金币-物品循环**形成完整游戏闭环

### 14.2 JSON 驱动模组系统

- `pet_conf.json` + `act_conf.json` + `items_config.json` 三层配置
- 模组自动扫描加载 + 错误提示
- 角色可自带物品（`items/` 子目录）

### 14.3 Anchor 锚点系统

解决序列帧动画切换闪现问题的优雅方案，定义角色「底部中心」相对于图片「底边中点」的偏移。

### 14.4 跨午夜定时器

`set_midnight_timer()` 在午夜触发日期变更，更新喂养天数等日期相关数据，是桌面宠物场景下的实用模式。

### 14.5 通知合并机制

QToaster 类支持饱食度/好感度/物品增减通知合并，避免通知轰炸。

### 14.6 LLM 深度集成模式

- 行为-反馈闭环（用户行为触发 LLM 反馈）
- 长期记忆系统（LLM 自主决定存储）
- 环境感知（感知聚焦软件/音乐）
- 任务管理（LLM 操作待办系统）

---

## 15. 潜在改进点

1. **开源 LLM 模块**：将闭源的 LLM 功能开源，吸引社区贡献
2. **标准化打包配置**：添加 `pyproject.toml` 和 `requirements.txt`
3. **拆分大文件**：将 `extra_windows.py` 和 `dashboard_widgets.py` 按功能拆分
4. **添加自动化测试**：至少为核心模块添加单元测试
5. **CI/CD 自动化**：使用 GitHub Actions 自动构建发布
6. **Linux 支持**：代码已有路径处理，可进一步完善
7. **动画系统升级**：考虑支持 Live2D 或 Spine 骨骼动画
8. **移动端适配**：Python + PySide6 无法支持移动端，需技术栈迁移

---

## 16. 跨平台支持评估

| 平台 | 支持度 | 说明 |
|------|--------|------|
| **Windows** | ✅ 完整支持 | 主力平台，Release 提供 EXE 包；开源至 v0.6.7，闭源至 v0.8.5 |
| **macOS** | ⚠️ 部分支持 | 开源至 v0.6.7；v0.7.7/v0.8.5 "Mac 版暂未完成测试"；通过夸克网盘分发；存在屏幕大小获取、地面判断等 bug |
| **Linux** | ❌ 未官方支持 | 代码中有 `platform == 'linux'` 的配置路径处理（`~/.config/DyberPet`），但无官方 Release |
| **移动端** | ❌ 不支持 | Python + PySide6 技术栈无法支持移动端 |

### Mac 兼容性问题

- 附件模块显示问题（v0.3.1b 修复）
- "前往文件夹"无法运行（v0.3.1b 修复）
- 屏幕大小获取问题（持续存在）
- 地面判断 bug（v0.3.7 优化缩放逻辑）
- pynput 版本固定 1.7.6

### 跨平台迁移难度评估

DyberPet 的技术栈（Python + PySide6 + pynput + APScheduler）**完全无法迁移到移动端**。如需跨平台桌面+移动端，必须重新选型技术栈。但其养成系统设计、模组系统架构、LLM 集成模式等**业务逻辑设计**具有高度可借鉴价值。

---

## 17. 总结与技术参考价值

### 项目定位

DyberPet 是 7 个项目中**养成系统最完整、模组生态最成熟**的桌面宠物。它从单纯的动画桌宠起步，逐步演进为集成养成、任务、AI 聊手的综合框架，代表了桌面宠物从「装饰品」到「陪伴型 AI 伙伴」的发展方向。

### 核心技术价值

1. **养成系统设计范本**：HP/FV/金币/物品/任务/商店的完整闭环设计可直接复用
2. **JSON 驱动模组架构**：可扩展的角色/物品/宠物创作生态
3. **饱食度-动画概率矩阵**：状态驱动行为的精巧设计
4. **LLM 深度集成模式**：行为反馈 + 长期记忆 + 环境感知 + 任务管理
5. **开源+闭源分层策略**：基础框架开源，高级 AI 功能闭源的商业化探索

### 对跨平台项目的参考意义

| 参考维度 | 价值 | 说明 |
|----------|------|------|
| 养成系统 | ⭐⭐⭐⭐⭐ | 直接复用设计思路和数值体系 |
| 模组系统 | ⭐⭐⭐⭐⭐ | JSON 驱动架构可跨技术栈复用 |
| 动画系统 | ⭐⭐⭐ | PNG 序列帧方案简单但不够流畅，建议升级 |
| LLM 集成 | ⭐⭐⭐⭐ | 行为反馈和记忆系统设计值得借鉴 |
| UI 框架 | ⭐⭐ | Fluent-Widgets 仅适用 Windows，需跨平台方案 |
| 跨平台支持 | ⭐ | Python 技术栈无法支持移动端 |

### 致谢与参考项目

- **UI 框架**：[PyQt-Fluent-Widgets](https://github.com/zhiyiYo/PyQt-Fluent-Widgets)
- **部分素材**：daywa1kr/Desktop-Cat
- **动画模块逻辑**：yanji255/desktop_pet
- **拖拽掉落计算**：WolfChen1996/DesktopPet

---

> **报告结论**：DyberPet 是桌面宠物领域养成系统的标杆项目，其 JSON 驱动模组生态和 LLM 深度集成模式具有高度参考价值。但 Python + PySide6 技术栈决定了其无法向移动端扩展，跨平台项目需在复用其业务设计的同时选择新技术栈。

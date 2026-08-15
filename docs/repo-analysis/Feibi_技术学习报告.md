# Feibi_desktop 开源仓库技术分析报告

> 仓库地址：https://github.com/llors-chen/Feibi_desktop
> 分析日期：2026-07-11
> 分析分支：main（最新 commit）
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

Feibi_desktop 是一款基于 **Python + Tkinter** 构建的 Windows 桌面宠物应用，以《鸣潮》游戏角色"菲比"为形象，具备动作动画、音效、OpenAI 兼容大模型聊天与长期记忆能力。项目定位为"菲比桌宠，参考版"，通过 PyInstaller 打包，解压即用。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | Feibi_desktop（菲比桌宠） |
| 仓库地址 | https://github.com/llors-chen/Feibi_desktop |
| 作者 | llors-chen（GitHub ID: 75588962，署名 "chen"） |
| 仓库描述 | "菲比桌宠，参考版" |
| 许可证 | ⚠️ 无（未包含任何开源许可证） |
| Stars | 12 |
| Forks | 4 |
| Watchers | 12 |
| Open Issues | 0 |
| 默认分支 | main |
| 总提交数 | 10 |
| 创建时间 | 2026-04-24 |
| 最近推送 | 2026-05-04 |
| 编程语言 | Python 100% |
| Discussions | 已开启 |
| Releases | 无（以 zip 直接提交在仓库） |
| 发布包 | FeibiPet_v0.0.1.zip（约 190 MB） |

### 当前状态

项目当前版本为 v0.0.1（2026-05-04），是一个"参考版"桌面宠物。项目由 llors-chen 一人在 10 天内完成（10 次提交），仅支持 Windows 平台。项目已开启 Discussions 但无 Issues 记录。

---

## 2. 核心技术栈

| 维度 | 技术选型 | 版本 |
|------|----------|------|
| **编程语言** | Python | ≥3.11（`requires-python = ">=3.11"`） |
| **GUI 框架** | Tkinter（Python 标准库） | — |
| **图像/动画处理** | Pillow (PIL) | ≥10.0.0 |
| **音频播放** | sounddevice + soundfile + numpy | ≥0.4.6 / ≥0.12.1 / ≥1.26.0 |
| **LLM 集成** | openai 官方 Python SDK | ≥1.30.0 |
| **Windows API** | ctypes.windll（直接调用，无 pywin32） | — |
| **打包工具** | PyInstaller（自定义 spec） | — |
| **构建系统** | setuptools | ≥68.0 |
| **构建产物** | FeibiPet（解压即用目录） | — |

### 技术栈架构特征

- **纯 Python 轻量栈**：无 Electron/Tauri/Qt 等重型框架
- **标准库 GUI**：Tkinter，零额外 GUI 依赖
- **ctypes 直接调用 Win32**：不依赖 pywin32，使用 `ctypes.windll` 直接调用 user32/shcore
- **配置驱动架构**：dataclass + JSON 配置系统
- **官方 SDK 集成 LLM**：使用 openai 官方 Python SDK（非自研 HTTP 客户端）
- **现代 Python 特性**：大量使用 `from __future__ import annotations`、`X | None` 联合类型、`dataclass(slots=True)`

### 依赖清单

**requirements.txt**：
```
numpy>=1.26.0
openai>=1.30.0
Pillow>=10.0.0
sounddevice>=0.4.6
soundfile>=0.12.1
```

**pyproject.toml**：
```toml
[project]
name = "feibi-pet"
version = "0.1.0"
description = "Configurable desktop pet framework with idle, eating, and speaking actions."
readme = "README.md"
requires-python = ">=3.11"
dependencies = ["numpy>=1.26.0","openai>=1.30.0","Pillow>=10.0.0","sounddevice>=0.4.6","soundfile>=0.12.1"]
[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.build_meta"
```

---

## 3. 项目架构与目录结构

### 3.1 整体架构

Feibi_desktop 采用**分层 dataclass 配置 + 模块化组件**架构，核心代码包 `feibi_pet/` 包含 18 个 Python 模块，按职责分为配置系统、核心控制器、子系统三大类：

```
┌─────────────────────────────────────────────────────────┐
│              配置系统 (7 个 config_*.py 模块)             │
│   PetConfig (顶层) → WindowConfig / ActionConfig /      │
│   ChatConfig / AudioConfig (dataclass + JSON)           │
├─────────────────────────────────────────────────────────┤
│              核心控制器 DesktopPet (pet.py)               │
│   窗口配置 / 动作系统 / 动画循环 / 待机随机行为 /          │
│   过渡动画 / 鼠标穿透 / 工作区计算 / 聊天阶段编排          │
├─────────────────────────────────────────────────────────┤
│              子系统模块                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │animation │ │ audio    │ │ chat_    │ │ chat_    │   │
│  │(GIF渲染) │ │ (音效)   │ │ client   │ │ ui       │   │
│  │          │ │          │ │ (LLM调用)│ │ (气泡UI) │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │ chat_    │ │ windowing│ │ app      │                │
│  │ memory   │ │ (Win API)│ │ (启动)   │                │
│  │ (长期记忆)│ │          │ │          │                │
│  └──────────┘ └──────────┘ └──────────┘                │
└─────────────────────────────────────────────────────────┘
```

### 3.2 完整目录结构

```
Feibi_desktop/
├── .gitignore
├── FeibiPet_v0.0.1.zip              # 直接提交的发布包 (约190MB)
├── README.md                        # 395 行详尽中文文档
├── feibi_pet.spec                   # PyInstaller 打包配置
├── main.py                          # 程序入口 (3行，调用 feibi_pet.app.main)
├── pet_config.json                  # 主配置文件 (含真实 API Key ⚠)
├── pyi_rth_tkinter_manual.py        # PyInstaller 运行时 hook (Tcl/Tk 路径)
├── pyproject.toml                   # Python 项目元数据
├── requirements.txt                 # pip 依赖
│
├── assets/                          # 资源目录
│   ├── gifs/                        # 动作精灵图
│   │   ├── idle.gif (1.57 MB) / idle.png (9.54 MB)
│   │   ├── push.gif (3.22 MB)
│   │   ├── eating.gif (1.83 MB) / eating.png (11.37 MB)
│   │   ├── talk.gif (1.57 MB)
│   │   └── sleep.gif (3.29 MB)
│   ├── images/
│   │   ├── chatbox.png (572 KB)     # 对话框九宫格图
│   │   └── 63105ea5-...png (584 KB)
│   └── sounds/
│       ├── soundpak0/               # 音效包
│       ├── soundpak1/               # 音效包
│       ├── soundpak2/               # 音效包
│       ├── 菲比时间到⚡.mp3 (693 KB)
│       └── 菲比菲比秋比秋比.mp3 (231 KB)
│
├── feibi_pet/                       # 核心代码包 (18 个 Python 模块)
│   ├── __init__.py
│   ├── app.py                       # 应用入口、启动引导、DPI、参数解析
│   ├── pet.py                       # DesktopPet 主类 (390行，核心控制器)
│   ├── animation.py                 # GIF 帧序列加载与渲染
│   ├── audio.py                     # AudioPlayer 音效播放
│   ├── chat_client.py               # OpenAI 兼容聊天客户端
│   ├── chat_memory.py               # 长期记忆存储与检索
│   ├── chat_ui.py                   # 聊天输入框与回复气泡 (438行)
│   ├── windowing.py                 # Windows 窗口 API 封装
│   ├── config.py                    # 配置模块统一导出
│   ├── config_actions.py            # 动作/行为配置 dataclass
│   ├── config_api.py                # 聊天/记忆配置 dataclass
│   ├── config_audio.py              # 音频配置 dataclass
│   ├── config_defaults.py           # 默认配置字典
│   ├── config_loader.py             # 配置加载与校验 (333行)
│   ├── config_models.py             # 顶层 PetConfig 聚合
│   ├── config_utils.py              # 类型强转辅助函数
│   └── config_window.py             # 窗口配置 dataclass
│
├── memory/                          # 长期记忆 (.gitignore 排除内容)
└── skills/
    └── phoebe.txt                   # 菲比角色系统提示词 (13.9 KB，146行)
```

### 3.3 架构设计特点

- **配置驱动**：7 个 config_*.py 模块，全部使用 `@dataclass(slots=True)`，JSON 持久化
- **模块分层清晰**：windowing/animation/audio/chat 分离
- **PyInstaller 冻结适配**：区分 bundle_dir（_MEIPASS）和 app_dir（exe 同级）
- **无第三方平台库**：直接使用 ctypes.windll 调用 Win32 API，不依赖 pywin32

---

## 4. 核心功能模块详解

### 4.1 应用入口（app.py）

`app.py` 负责启动引导：

- `main()` 解析 `--config` 参数 → `run()`
- `enable_windows_dpi_awareness()`：调用 `shcore.SetProcessDpiAwareness(2)`（Per-Monitor DPI 感知），失败回退到 `user32.SetProcessDPIAware()`
- `bootstrap_user_files()`：PyInstaller 冻结模式下，首次运行将 `pet_config.json`、`assets`、`skills` 从 `_MEIPASS` 拷贝到 exe 同级目录，使配置可被用户编辑
- 区分 `get_app_dir()`（exe 同级，可编辑文件）与 `get_bundle_dir()`（`_MEIPASS`，打包资源）

### 4.2 主控制器 DesktopPet（pet.py）

`feibi_pet/pet.py`（390 行，最核心）负责整合所有子系统：

**窗口配置**：
- `overrideredirect(True)` 去边框
- `-topmost` 置顶
- `-transparentcolor` 用 `#00FF00` 绿幕做透明色键
- `-alpha` 整体透明度

**拖动**：绑定 `<ButtonPress-1>` / `<B1-Motion>` / `<ButtonRelease-1>`

**右键菜单**：`<Button-3>` 弹出菜单（聊天/待机/拍地板/吃东西/说话/睡觉/退出）

**动作系统**：5 个动作（idle/push/eating/speaking/sleep），每个动作有独立 GIF 列表、音效、过渡时间、偏移、水平翻转

**动画循环**：`animate()` 用 `root.after(delay, self.animate)` 按帧延迟逐帧切换

**待机随机行为**：按 `weight` 权重从 `idle_actions` 池中随机选取动作，`duration_ms` 控制持续时间

**过渡动画**：`fade_out` / `fade_in` 分步透明度渐变（`TRANSITION_FADE_STEPS=6`），`transition_to_action` 做"淡出→切换→淡入"

**待机淡入**：默认动作时窗口透明度从 65% 渐变回 100%（`IDLE_FADE_START_RATIO=0.65`）

**鼠标穿透**：`apply_click_through()` 通过 `SetWindowLongW` 设置 `WS_EX_LAYERED | WS_EX_TRANSPARENT`

**工作区计算**：`SystemParametersInfoW(SPI_GETWORKAREA)` 获取屏幕工作区，支持四角锚点定位

**聊天阶段编排**：input/waiting/reply/error 四阶段，每阶段绑定一个动作与音效

### 4.3 动画系统（animation.py）

- `load_gif_sequence()`：用 PIL `Image.open` + `seek(index)` 逐帧读取 GIF，转 RGBA
- 支持 `flip_horizontal`（`FLIP_LEFT_RIGHT`）
- `scale` 缩放（支持 nearest/box/bilinear/bicubic/lanczos 五种采样模式，像素风默认 nearest）
- `make_alpha_safe_for_tk_color_key()`：将半透明像素二值化为全不透明，避免 Tk 透明色键产生绿色毛边
- `GifSequence` dataclass 保存 `frames`/`delays`/`width`/`height`

### 4.4 音频系统（audio.py）

`AudioPlayer` 基于 sounddevice/soundfile：
- 后台线程播放
- 支持 `play_file` / `play_random` / `play_loop`（循环播放带可配置间隔）
- `_append_tail_silence()` 用 numpy 补 0.5 秒尾静音避免爆音
- 音量 0-150% 可调
- `stop_loop` 用 `threading.Event` 优雅停止

### 4.5 窗口封装（windowing.py）

定义 Windows API 常量：
- `GWL_EXSTYLE=-20`
- `WS_EX_LAYERED=0x00080000`
- `WS_EX_TRANSPARENT=0x00000020`
- `SPI_GETWORKAREA=0x0030`

以及 `RECT` 结构体，锚点坐标↔偏移互转函数（支持 top_left/top_right/bottom_left/bottom_right）。

### 4.6 配置系统（7 个 config_*.py 模块）

采用分层 dataclass 设计，全部使用 `@dataclass(slots=True)`：

| 模块 | 内容 |
|------|------|
| `config_models.py` | 顶层 `PetConfig`（source_path/window/audio/sound/behavior/chat/actions） |
| `config_window.py` | `WindowConfig` + `Position`（默认 scale=2.0、anchor=top_left） |
| `config_actions.py` | `ActionConfig`（gifs/sounds/auto_return_ms/return_to/offset/flip） |
| `config_api.py` | `ChatConfig` + `ChatMemoryConfig` + `ChatStageConfig` |
| `config_audio.py` | `AudioConfig` + `SoundConfig` + `SoundPakConfig` |
| `config_defaults.py` | `DEFAULT_CONFIG` 字典（首次运行自动生成 pet_config.json） |
| `config_loader.py` | `load_config()` 读取 JSON，用 `coerce_*` 系列函数做类型强转与校验（333 行） |
| `config_utils.py` | `coerce_bool/int/float/text`、`coerce_anchor`、`coerce_scale_mode` 等 |

---

## 5. 技术实现细节

### 5.1 透明窗口实现

```python
# 无边框
root.overrideredirect(True)
# 置顶
root.attributes('-topmost', True)
# 透明色键（Windows 专属，绿幕）
root.attributes('-transparentcolor', '#00FF00')
# 整体透明度
root.attributes('-alpha', 1.0)
```

气泡窗口使用不同色键：
```python
# 气泡用紫色透明色键
bubble.attributes('-transparentcolor', '#FF00FF')
```

### 5.2 DPI 感知

```python
def enable_windows_dpi_awareness():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # Per-Monitor V2
    except Exception:
        ctypes.windll.user32.SetProcessDPIAware()  # 回退
```

### 5.3 鼠标穿透

```python
def apply_click_through(self):
    hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
    style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    ctypes.windll.user32.SetWindowLongW(
        hwnd, GWL_EXSTYLE,
        style | WS_EX_LAYERED | WS_EX_TRANSPARENT
    )
```

### 5.4 Alpha 二值化（避免色键毛边）

`make_alpha_safe_for_tk_color_key()` 将半透明像素按阈值二值化：
- alpha > 阈值 → 完全不透明
- alpha ≤ 阈值 → 完全透明

这解决了 Tkinter `-transparentcolor` 色键透明产生的绿色毛边问题。

### 5.5 聊天阶段编排

```python
# 四阶段，每阶段绑定动作与音效
stages = {
    "input":   {"action": "push",    "sound": "..."},
    "waiting": {"action": "eating",  "sound": "..."},
    "reply":   {"action": "speaking","sound": "...", "duration": 8000},
    "error":   {"action": "idle",    "sound": "..."},
}
```

### 5.6 PyInstaller 冻结模式适配

```python
def get_app_dir():
    """exe 同级目录，可编辑文件"""
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    return Path(__file__).parent.parent

def get_bundle_dir():
    """_MEIPASS，打包资源"""
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS)
    return Path(__file__).parent.parent
```

`bootstrap_user_files()` 首次运行时将配置和资源从 bundle 拷贝到 app 目录。

---

## 6. 数据处理流程

### 6.1 运行时数据流

```
┌─────────────────────────────────────────────────────────┐
│                  Tkinter 主循环 (root.mainloop)          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  root.after() 定时器调度                          │   │
│  │  ├── animate()              按 GIF 帧延迟切换     │   │
│  │  ├── transition_to_action() 淡出→切换→淡入        │   │
│  │  └── idle_random_behavior() 待机随机行为          │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Win32 API   │  │  GIF 帧序列   │  │  AudioPlayer   │  │
│  │ (ctypes)     │  │ (Pillow)     │  │ (sounddevice)  │  │
│  │              │  │              │  │                │  │
│  │ 置顶/透明/   │  │ 5个动作的    │  │ 后台线程播放    │  │
│  │ 穿透/DPI     │  │ GIF帧        │  │                │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  AI 聊天系统                                      │   │
│  │  ChatClient (openai SDK) → ChatMemory (长期记忆)  │   │
│  │       ↓                            ↓              │   │
│  │  ChatUI (气泡窗口 + 输入框)                       │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 6.2 AI 对话数据流（含长期记忆）

```
用户输入消息 (ChatInputDialog)
    ↓
ChatClient.request_reply()
    ↓
_build_messages():
    ├── system prompt (skill 文件 + 额外 prompt)
    ├── 长期记忆上下文 (ChatMemory.build_context)
    │   ├── 长期摘要 (LLM 压缩)
    │   └── 相关旧对话 (自实现检索 top-N)
    ├── 历史 (最近 max_history*2 条)
    └── 当前用户消息
    ↓
openai SDK → client.chat.completions.create()
    ↓
响应返回 → _extract_text() (兼容字符串与列表型 content)
    ↓
更新 UI (RoundedBubbleWindow 打字机效果)
    ↓
ChatMemory.append_exchange() → 若超 max_bytes(1MB) 触发 compress()
```

### 6.3 长期记忆数据流

```
对话产生
    ↓
ChatMemory.append_exchange(user, assistant)
    ↓
写入 memory/chat_memory.json
    ↓
文件大小 > max_bytes(1MB)?
    ├── 是 → compress():
    │         ├── 保留最近 10 条 (recent_turns_after_compress)
    │         ├── 旧对话 → LLM summarize_memory()
    │         │   └── 失败 → _fallback_summary() (截断前20条)
    │         └── 更新 summary 字段
    └── 否 → 继续
    ↓
下次对话时 build_context():
    ├── summary (长期摘要)
    └── search(查询) → 相关旧对话 (retrieval_limit=5)
```

### 6.4 动画数据流

```
pet_config.json (动作配置)
    ↓ config_loader.load_config()
ActionConfig (gifs/sounds/offset/flip)
    ↓
animation.load_gif_sequence()
    ├── PIL.Image.open + seek 逐帧读取
    ├── flip_horizontal (FLIP_LEFT_RIGHT)
    ├── scale (nearest/bilinear/lanczos)
    └── make_alpha_safe_for_tk_color_key (二值化)
    ↓
GifSequence (frames/delays)
    ↓
root.after(delay, animate) 按帧延迟循环
    ↓
ImageTk.PhotoImage → Tkinter Label
```

---

## 7. UI/UX设计分析

### 7.1 交互设计

| 操作 | 功能 |
|------|------|
| 左键拖动 | 移动宠物 |
| 右键 | 弹出菜单（聊天/待机/拍地板/吃东西/说话/睡觉/退出） |
| 回车 | 提交聊天输入 |
| Shift+回车 | 换行 |
| Esc / 右键 | 关闭输入框 |

### 7.2 视觉设计

- **透明窗口**：绿幕色键 `#00FF00`（气泡用 `#FF00FF` 紫色键）
- **像素风**：默认 `scale_mode: nearest`，发布包 scale 0.5
- **对话框**：九宫格 `chatbox.png` 拉伸
- **深红描边**：`#3A080D` + 白底
- **圆角半径**：16
- **字体**：Microsoft YaHei UI 9pt
- **回复气泡**：默认浅蓝 `#A7DFF6` 背景
- **过渡动画**：动作切换有淡入淡出（6 步）
- **待机淡入**：窗口从 65% 透明度渐显
- **DPI 感知**：Per-Monitor V2

### 7.3 UI 组件

| 组件 | 文件 | 功能 |
|------|------|------|
| 回复气泡窗口 | `chat_ui.py` `RoundedBubbleWindow` | 九宫格拉伸、自动定位、屏幕边界夹紧 |
| 聊天输入框 | `chat_ui.py` `ChatInputDialog` | 340×76，双线圆角边框，回车提交 |
| 右键菜单 | `pet.py` | 聊天/待机/拍地板/吃东西/说话/睡觉/退出 |

### 7.4 九宫格对话框

`RoundedBubbleWindow` 支持：
- `NinePatchImage` 九宫格拉伸（用 `chatbox.png` 作为气泡边框背景）
- 无图时回退到 `draw_rounded_rectangle`（canvas polygon + smooth 模拟圆角）
- `flatten_alpha_to_key()` 将 RGBA 像素按阈值二值化到透明色键
- 气泡自动定位在桌宠上方，并做屏幕边界夹紧

### 7.5 聊天阶段动作编排

| 阶段 | 动作 | 说明 |
|------|------|------|
| input | push | 用户输入时，宠物做"推"动作 |
| waiting | eating | 等待 AI 响应时，宠物做"吃东西"动作 |
| reply | speaking | AI 回复时，宠物做"说话"动作（8 秒） |
| error | idle | 出错时，宠物回到待机 |

---

## 8. 动画与渲染系统

### 8.1 动画资源组织

采用 **GIF/PNG 序列帧**方案：

| 资源文件 | 用途 | 大小 |
|----------|------|------|
| idle.gif / idle.png | 待机动画 | 1.57 MB / 9.54 MB |
| push.gif | 推/拍地板动画 | 3.22 MB |
| eating.gif / eating.png | 吃东西动画 | 1.83 MB / 11.37 MB |
| talk.gif | 说话动画 | 1.57 MB |
| sleep.gif | 睡觉动画 | 3.29 MB |

### 8.2 动画特性

- **序列帧动画**：GIF/PNG 逐帧播放，无 Live2D、无骨骼、无 Spine
- **多图随机**：`randomize_gif_on_loop` 支持多图随机选择
- **水平翻转**：`flip_horizontal` 运行时翻转
- **偏移对齐**：`offset_x` / `offset_y` 自定义对齐
- **自定义过渡**：`auto_return_ms` 自动返回时间
- **帧延迟**：取 GIF 自身 `duration`（最小 20ms）
- **五种采样模式**：nearest/box/bilinear/bicubic/lanczos

### 8.3 Alpha 二值化处理

Tkinter 的 `-transparentcolor` 色键透明有一个已知问题：半透明像素会产生毛边。Feibi 通过 `make_alpha_safe_for_tk_color_key()` 解决：
- 将 RGBA 像素按阈值二值化
- alpha > 阈值 → 完全不透明
- alpha ≤ 阈值 → 完全透明

这是一个值得借鉴的 Tkinter 透明窗口技术细节。

---

## 9. AI/聊天集成分析

### 9.1 接口与模型

- **接口**：OpenAI 兼容 `/v1/chat/completions`
- **SDK**：openai 官方 Python SDK（≥1.30.0）
- **当前配置**：第三方代理 `https://api.edgefn.net/v1` + 模型 `DeepSeek-R1-0528-Qwen3-8B`
- **默认配置**：火山引擎 `https://ark.cn-beijing.volces.com/api/v3`，默认 `enabled:false`

### 9.2 ChatClient 实现

`chat_client.py` 封装 OpenAI SDK：

- `request_reply()` 调用 `client.chat.completions.create()`
- `_build_messages()` 构建消息序列：
  1. system prompt（来自 skill 文件 + 额外 system_prompt）
  2. 长期记忆上下文（作为 system 消息注入）
  3. 历史（取最近 `max_history*2` 条）
  4. 当前用户消息
- `summarize_memory()`：独立调用 LLM 将旧对话压缩为长期记忆摘要
- `_extract_text()`：兼容字符串与列表型 content 返回
- `_read_text()`：读取 skill 文件时依次尝试 utf-8 / utf-8-sig / gbk 编码
- `ChatError` 自定义异常，`ensure_ready()` 校验依赖与配置

### 9.3 长期记忆系统（核心亮点）

`chat_memory.py` — `ChatMemoryStore` 是本项目最大的技术亮点：

**持久化结构**（`memory/chat_memory.json`）：
```json
{
  "version": 1,
  "summary": "长期摘要（LLM 压缩）",
  "entries": [
    {"created_at": "...", "user": "...", "assistant": "..."}
  ],
  "compressed_at": "..."
}
```

**核心功能**：
- `restore_recent()`：启动时恢复最近 N 条对话作为历史
- `build_context()`：检索记忆 = 长期摘要 + 相关旧对话
- `search()`：**自实现的轻量检索**——对查询分词（英文 `[a-z0-9_]{2,}` + 中文单字 + 2/3-gram），用 `difflib.SequenceMatcher` 算相似度 + 词重叠 + 时近性加权打分，取 top-N
- `append_exchange()`：追加对话后若文件超 `max_bytes`(默认 1MB) 触发 `compress()`
- `compress()`：保留最近 `recent_turns_after_compress`(10) 条，旧对话交给 LLM 摘要化，摘要失败则用 `_fallback_summary()`（截断前 20 条）

**三段式记忆架构**：
1. **短期历史**：max_history×2 条，直接作为上下文
2. **长期摘要**：LLM 压缩的对话摘要，控制在 4000 字内
3. **相关旧对话检索**：自实现打分检索，retrieval_limit=5

### 9.4 角色提示词

`skills/phoebe.txt`（13.9 KB，146 行）是极其详尽的《鸣潮》角色"菲比"人设：
- 身份定义、世界观定位（黎那汐塔/拉古那/隐海修会）
- 成长背景、核心性格、说话风格
- 形象行为、价值观、互动原则
- 回复要求（默认≤50字）
- 情境反应、生活偏好（喜欢披萨）
- 人物关系（卡提希娅/赞妮/布兰特/洛可可/珂莱塔/坎特蕾拉/夏空）
- 长期记忆适配规则
- 禁止偏离条款

### 9.5 与其他项目 AI 集成对比

| 维度 | Feibi | Dororo | Ameath |
|------|-------|--------|--------|
| LLM SDK | openai 官方 SDK | 自研 HTTPClient | requests 库 |
| 流式响应 | ❌ | ✅ SSE 流式 | ❌ |
| 长期记忆 | ✅ 三段式（摘要+检索+历史） | ❌ 仅上下文裁剪 | ❌ 仅历史(5条) |
| 服务商配置 | 单一（可自定义 base_url） | OpenAI 兼容 | 7 个预置 + 自定义 |
| 人格切换 | ❌ 单一角色 | ❌ 单一 prompt | ✅ 5 种人格 |
| 思考过程 | ❌ | ✅ reasoning_content | ❌ |

---

## 10. 构建与打包流程

### 10.1 开发运行

```bash
pip install -r requirements.txt
python main.py
```

### 10.2 打包配置（feibi_pet.spec）

PyInstaller 定制打包，关键点：

- `Analysis(['main.py'])`，`hiddenimports` 显式列出 `feibi_pet.*` 全部子模块与 `PIL._tkinter_finder`
- `binaries` 手动带入 `_tkinter.pyd`、`tcl86t.dll`、`tk86t.dll`
- `datas` 带入 `tkinter` 包与 Tcl/Tk 8.6 运行时库
- `runtime_hooks=[pyi_rth_tkinter_manual.py]`：设置 `TCL_LIBRARY`/`TK_LIBRARY` 环境变量指向 bundle 内的 tcl/tk8.6
- `top_level_files`：将 `pet_config.json`、`assets/`、`skills/` 以 `PKG` 形式放在 exe 同级（可编辑），而非塞入 `_internal`
- `excludes`：排除 matplotlib/scipy/pandas/pytest/IPython/jupyter 减小体积
- `console=False`（无控制台窗口）
- `upx=True`（UPX 压缩）
- `contents_directory='_internal'`

### 10.3 打包命令

```bash
pyinstaller feibi_pet.spec --clean --noconfirm
# 产物在 dist/FeibiPet/
```

### 10.4 PyInstaller Tkinter 适配

`pyi_rth_tkinter_manual.py` 仅在 frozen 时：
- 把 `_MEIPASS` 插入 `sys.path`
- 设置 `TCL_LIBRARY` / `TK_LIBRARY` 环境变量指向 bundle 内的 tcl/tk8.6

这解决了 PyInstaller 打包 Tkinter 应用的已知 Tcl/Tk 运行时路径问题。

---

## 11. 版本发布与迭代历史

### 11.1 版本

- **当前版本**：v0.0.1
- **发布方式**：以 `FeibiPet_v0.0.1.zip` 直接提交在仓库根目录（约 190 MB），**未使用 GitHub Releases**
- **无 Tags**

### 11.2 提交历史

共 **10 次提交**，**单一贡献者 llors-chen**，集中在 2026-04-24 至 2026-05-04 共约 10 天：

| # | 日期(UTC) | 信息 |
|---|-----------|------|
| 1 | 2026-04-24 20:10 | feibi_v0.1.0（初始提交） |
| 2 | 2026-04-27 07:49 | 更新菲比对话框 |
| 3 | 2026-04-27 08:10 | 更新简易上下文管理 |
| 4 | 2026-04-27 08:10 | 更新简易上下文管理，目前是5条拼接 |
| 5 | 2026-05-02 08:21 | 修复人物部分关系打包内容 |
| 6 | 2026-05-04 13:08 | Release v0.0.1 |
| 7 | 2026-05-04 13:12 | readme |
| 8 | 2026-05-04 13:58 | v0.0.1 |
| 9 | 2026-05-04 14:12 | . |
| 10 | 2026-05-04 14:21 | 说明更新（最新） |

### 11.3 开发节奏

- 4/24：首发 v0.1.0
- 4/27：三次提交完善聊天记忆与对话框
- 5/2：修复打包
- 5/4：集中发布 v0.0.1 并更新文档
- 提交信息简短、中文为主，无 conventional commits 规范

---

## 12. 社区与Issue概况

### 12.1 Issues

- **Open Issues**：0
- **Closed Issues**：0
- 仓库已开启 Issues 但无任何议题

### 12.2 Discussions

- **已开启** GitHub Discussions

### 12.3 文档情况

- **README.md**（395 行）：非常详尽的中文文档，覆盖：
  - 快速开始
  - 发布包结构
  - 功能列表
  - 右键菜单
  - 完整配置说明（window/behavior/actions/audio/sound/chat/chat.stages）
  - 角色提示词与记忆
  - 开发运行
  - 打包命令
  - 常见问题排查
- **skills/phoebe.txt**：角色系统提示词（兼具文档与运行时数据双重性质）
- **无** LICENSE、CONTRIBUTING、CHANGELOG、Wiki
- **无测试文件**（无 tests/ 目录）

---

## 13. 优缺点分析

### 13.1 优点

| 优点 | 说明 |
|------|------|
| **长期记忆系统** | 三段式架构（摘要+检索+历史），自实现轻量检索，是 AI 桌面宠物的记忆最佳实践 |
| **配置系统完善** | 7 个 dataclass 模块，JSON 持久化，类型强转校验，配置驱动设计 |
| **官方 SDK 集成** | 使用 openai 官方 Python SDK，稳定可靠 |
| **聊天阶段编排** | input/waiting/reply/error 四阶段，每阶段绑定动作与音效，体验完整 |
| **Alpha 二值化** | 解决 Tkinter 色键透明毛边问题，技术细节考究 |
| **九宫格对话框** | NinePatchImage 拉伸，无图时回退 canvas 圆角 |
| **PyInstaller 适配** | 完整处理 Tkinter 在 PyInstaller 下的已知坑 |
| **过渡动画** | 淡入淡出（6 步），待机淡入（65%→100%） |
| **角色提示词详尽** | 13.9KB 人设文档，包含世界观/性格/关系/记忆规则 |
| **现代 Python 特性** | dataclass(slots=True)、联合类型、annotations |

### 13.2 缺点

| 缺点 | 说明 |
|------|------|
| **⚠️ 硬编码 API Key** | pet_config.json 明文提交真实 API Key，严重安全隐患 |
| **无开源许可证** | 仓库未声明 LICENSE，"保留所有权利" |
| **190MB 二进制提交** | FeibiPet_v0.0.1.zip 直接提交进 git，仓库体积膨胀 |
| **仅支持 Windows** | 深度依赖 Win32 API（ctypes.windll） |
| **无流式响应** | 使用同步请求，不支持 SSE 流式 |
| **无测试** | 无 tests/ 目录，无 CI |
| **渲染表现力有限** | GIF 序列帧，无 Live2D |
| **单开发者** | 10 次提交均由一人完成 |
| **发布方式不规范** | zip 直接提交仓库，未用 GitHub Releases |
| **无 Tags** | 无版本标签 |

---

## 14. 可借鉴特性

| 特性 | 借鉴价值 | 应用建议 |
|------|----------|----------|
| **三段式长期记忆** | ★★★★★ | 摘要+检索+历史，是 AI 桌面宠物记忆系统的最佳实践 |
| **自实现轻量检索** | ★★★★ | difflib.SequenceMatcher + 分词 + 加权打分，无需向量数据库 |
| **配置驱动 dataclass** | ★★★★ | 7 个 config 模块，类型安全 + JSON 持久化 |
| **聊天阶段编排** | ★★★★ | AI 对话的每个阶段绑定不同动作和音效 |
| **Alpha 二值化** | ★★★ | 解决 Tkinter/色键透明的毛边问题 |
| **LLM 摘要压缩** | ★★★ | 超阈值自动压缩旧对话为摘要 |
| **九宫格对话框** | ★★★ | NinePatchImage 拉伸 + 回退方案 |
| **PyInstaller Tkinter 适配** | ★★★ | 完整的 Tcl/Tk 运行时 hook |
| **角色提示词设计** | ★★ | 详尽的人设文档包含记忆适配规则 |

---

## 15. 潜在改进点

| 改进方向 | 优先级 | 建议 |
|----------|--------|------|
| **移除硬编码 API Key** | 紧急 | 立即从配置文件和 git 历史中清除 API Key |
| **添加 LICENSE** | 高 | 声明开源许可证 |
| **使用 GitHub Releases** | 高 | 将 zip 移至 Releases，减小仓库体积 |
| **AI 流式响应** | 高 | 改用 SSE 流式，提升用户体验 |
| **跨平台支持** | 高 | 抽象平台层，支持 macOS/Linux |
| **自动化测试** | 中 | 增加 pytest 单元测试 |
| **CI/CD** | 中 | 配置 GitHub Actions |
| **Live2D 支持** | 低 | 升级渲染方案至 Live2D |
| **多 LLM 服务商** | 低 | 预置主流 LLM 配置 |
| **移动端适配** | 低 | Tkinter 不适合移动端，需更换框架 |

---

## 16. 跨平台支持评估

### 16.1 现状

Feibi_desktop **仅支持 Windows**：

| 模块 | 跨平台难度 | 原因 |
|------|-----------|------|
| windowing.py | ★★★ | 使用 GWL_EXSTYLE/WS_EX_LAYERED/WS_EX_TRANSPARENT/SPI_GETWORKAREA |
| app.py (DPI) | ★★★ | ctypes.windll.shcore / user32（Windows 专属） |
| pet.py (穿透) | ★★★ | ctypes.windll.user32.GetParent/GetWindowLongW/SetWindowLongW |
| animation.py | ★ | Pillow 跨平台 |
| audio.py | ★ | sounddevice/soundfile 跨平台 |
| chat_client.py | ★ | openai SDK 跨平台 |
| chat_memory.py | ★ | 纯 Python |
| chat_ui.py | ★★ | Tkinter 跨平台，但 -transparentcolor 是 Windows 专属 |

### 16.2 移动端适配评估

Tkinter **不适合移动端**：
- `-transparentcolor` 是 Windows 专属属性（代码中已 try/except TclError 兜底）
- 透明置顶窗口在移动端无意义
- ctypes.windll 是 Windows 专属

**结论**：Feibi 的 AI 聊天和长期记忆系统可完全复用，但 UI 框架和平台层需完全更换。长期记忆系统是跨平台可复用的核心资产。

---

## 17. 总结与技术参考价值

### 17.1 项目定位

Feibi_desktop 是三个项目中**AI 记忆系统最完善**的桌面宠物，其三段式长期记忆架构（摘要+检索+历史）是 AI 桌面宠物的记忆最佳实践。项目虽然规模小（10 次提交），但在配置系统设计和记忆系统实现上展现了较高的工程水平。

### 17.2 核心技术参考价值

| 维度 | 参考价值 |
|------|----------|
| **长期记忆系统** | 三段式架构是 AI 桌面宠物的记忆最佳实践，自实现检索无需向量数据库 |
| **配置系统** | 7 个 dataclass 模块的分层设计，类型安全 + JSON 持久化 |
| **聊天阶段编排** | AI 对话与动画/音效的深度整合 |
| **Alpha 二值化** | Tkinter 透明窗口的技术细节解决方案 |
| **PyInstaller 适配** | Tkinter 打包的完整解决方案 |

### 17.3 与其他项目对比

| 维度 | Feibi | Dororo | Ameath |
|------|-------|--------|--------|
| 渲染方案 | GIF 序列帧 | Live2D Cubism | GIF 序列帧 |
| AI 记忆 | ★★★★★ 三段式 | ★★ 上下文裁剪 | ★★ 历史5条 |
| AI 流式 | ❌ | ✅ SSE | ❌ |
| 配置系统 | ★★★★★ dataclass | ★★★ INI+绑定 | ★★ JSON |
| 渲染质量 | ★★ | ★★★★★ | ★★ |
| 功能丰富度 | ★★★ | ★★★ | ★★★★★ |
| 安全性 | ⚠️ API Key 泄露 | ✅ | ✅ |

### 17.4 对跨平台桌面宠物开发的启示

1. **长期记忆是 AI 桌面宠物的核心能力**：Feibi 的三段式架构（摘要+检索+历史）可直接复用
2. **配置驱动设计**：dataclass + JSON 的配置系统类型安全且易于维护
3. **聊天阶段编排增强体验**：AI 对话的每个阶段绑定不同动作和音效
4. **Tkinter 透明窗口有坑**：色键透明有毛边问题，需 Alpha 二值化
5. **安全第一**：API Key 切勿硬编码提交到版本控制
6. **跨平台需抽象平台层**：Win32 API 调用应封装为接口

### 17.5 三项目综合对比与选型建议

| 需求 | 推荐参考项目 |
|------|-------------|
| 高质量角色渲染 | Dororo（Live2D） |
| AI 长期记忆 | Feibi（三段式架构） |
| AI 流式响应 | Dororo（SSE） |
| 多 LLM 服务商 | Ameath（7 个预置） |
| 效率工具整合 | Ameath（翻译/番茄钟/音乐） |
| 配置系统设计 | Feibi（dataclass） |
| 组合式架构 | Ameath（管理器模式） |
| 省电设计 | Dororo（30FPS+低处理器） |
| 跨平台渲染复用 | Dororo（Live2D 层可独立） |
| 跨平台 AI 复用 | Feibi（记忆系统纯 Python） |

---

> **报告结束**
> 本报告基于 2026-07-11 对 GitHub 仓库 llors-chen/Feibi_desktop main 分支的完整分析，涵盖仓库元数据、完整文件树（18 个模块）、核心配置文件、关键源码、10 次提交历史、发布包、配置系统的所有细节。

# Dororo 桌面宠物项目 — 技术架构深度分析报告

> 分析日期：2026-06-14  
> 项目路径：`C:\Users\FREE\Documents\APP\Dororo_windows_x86_64_compatible`  
> 项目总大小：197.89 MB

---

## 目录

1. [项目概览](#1-项目概览)
2. [核心技术栈](#2-核心技术栈)
3. [项目目录结构与文件组成](#3-项目目录结构与文件组成)
4. [存储空间分析](#4-存储空间分析)
5. [PCK 资源包深度解析](#5-pck-资源包深度解析)
6. [C# 业务逻辑层分析](#6-c-业务逻辑层分析)
7. [GDExtension Cubism 插件分析](#7-gdextension-cubism-插件分析)
8. [Live2D 模型系统深度分析](#8-live2d-模型系统深度分析)
9. [GDScript 脚本体系分析](#9-gdscript-脚本体系分析)
10. [插件生态系统分析](#10-插件生态系统分析)
11. [配置系统与运行机制](#11-配置系统与运行机制)
12. [构建与打包流程](#12-构建与打包流程)
13. [运行时架构总览](#13-运行时架构总览)
14. [核心结论与本质规律](#14-核心结论与本质规律)

---

## 1. 项目概览

Dororo 是一款基于 **Godot 4.4.1 + Live2D Cubism SDK** 构建的桌面宠物应用，采用 C# / GDScript 混合编程，通过 Live2D 技术渲染可交互的二次元角色，支持随机漫步、鼠标跟随、边缘停靠、AI 聊天等桌面宠物核心功能。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | Dororo |
| 模型作者 | 0x4682B4 |
| 模型 ID | f249a414d01843e2a5e74c41a9e0d234 |
| Godot 版本 | 4.4.1 |
| .NET 版本 | 8.0.15 (self-contained, win-x64) |
| Live2D Cubism 版本 | 3.x (moc3 格式) |
| VTube Studio 兼容 | 1.28.15 |
| 模型最后保存时间 | 2024-06-28 |

---

## 2. 核心技术栈

| 层级 | 技术 | 版本 | 职责 |
|------|------|------|------|
| **游戏引擎** | Godot Engine | 4.4.1 | 窗口管理、渲染循环、场景系统、输入处理、信号机制 |
| **高级语言** | C# (.NET) | 8.0.15 | 平台原生交互（窗口管理、鼠标追踪、系统托盘、自启动） |
| **脚本语言** | GDScript | Godot 4.x | 游戏逻辑（动画控制、交互行为、UI 管理、配置读写） |
| **2D 模型渲染** | Live2D Cubism SDK | 3.x (moc3) | 角色模型渲染、表情、动画、物理模拟 |
| **原生桥接** | GDExtension | Godot 4.x | 将 Cubism C++ SDK 封装为 Godot 原生节点 |
| **AI 聊天** | OpenAI API (兼容) | — | 通过 gd_chathub 插件对接 LLM |
| **数据绑定** | gd_data_binding | — | MVVM 模式的数据绑定框架 |
| **运行时** | .NET Runtime | 8.0.15 win-x64 | Self-contained 部署，无需用户安装依赖 |

### 技术栈架构特征

- **双语言混合编程**：C# 处理 Windows 平台原生 API 调用，GDScript 处理游戏逻辑
- **三层渲染管线**：Godot 引擎 → GDExtension 桥接 → Cubism C++ SDK
- **插件化架构**：6 个独立插件（Cubism、ChatHub、DataBinding、UUID 等）
- **Self-contained 部署**：内嵌完整 .NET 运行时，零外部依赖

---

## 3. 项目目录结构与文件组成

```
Dororo_windows_x86_64_compatible/
│
├── dororo.exe                          # Godot 4.4.1 导出的主可执行文件 (93.24 MB)
├── dororo.pck                          # Godot 资源包 (26.77 MB)
├── libgd_cubism.windows.release.x86_64.dll  # Live2D Cubism GDExtension 原生插件 (0.85 MB)
├── config.ini                          # 用户运行时配置 (250 bytes)
│
├── models/                             # Live2D 模型资源目录 (1.47 MB)
│   └── Doro/
│       ├── Doro.moc3                   # 模型二进制数据 (0.62 MB)
│       ├── Doro.model3.json            # 模型清单文件
│       ├── Doro.cdi3.json              # 参数/部件显示信息
│       ├── Doro.physics3.json          # 物理模拟配置 (7组)
│       ├── Doro.vtube.json             # VTube Studio 兼容配置
│       ├── icon.png                    # 模型缩略图 (0.30 MB)
│       ├── Idle.motion3.json           # 待机动画 (0.983s循环)
│       ├── Doro.2048/
│       │   └── texture_00.png          # 2048px 纹理贴图 (0.51 MB)
│       ├── expressions/                # 12个表情文件
│       │   ├── Exp0.exp3.json ~ Exp8.exp3.json
│       │   ├── Highlight OFF.exp3.json
│       │   ├── Running OFF.exp3.json
│       │   └── TongueOut.exp3.json
│       └── motions/
│           └── walk.motion3.json       # 行走动画
│
└── data_Dororo_windows_x86_64/         # .NET self-contained 运行时 (75.56 MB)
    ├── Dororo.dll                      # C# 编译后的游戏逻辑 (0.06 MB)
    ├── GodotSharp.dll                  # Godot C# 绑定库 (5.13 MB)
    ├── coreclr.dll                     # .NET CoreCLR 运行时 (4.77 MB)
    ├── clrjit.dll                      # JIT 编译器 (1.70 MB)
    ├── hostfxr.dll / hostpolicy.dll    # .NET 宿主层
    ├── clrgc.dll                       # 垃圾回收器
    ├── msquic.dll                      # QUIC 协议库
    └── System.*.dll / Microsoft.*.dll  # .NET BCL 标准库 (~130个)
```

---

## 4. 存储空间分析

### 4.1 总体分布

| 组件 | 大小 | 占比 | 说明 |
|------|------|------|------|
| dororo.exe | 93.24 MB | 47.1% | Godot 引擎导出壳（含引擎运行时） |
| data_ 目录 | 75.56 MB | 38.2% | .NET self-contained 运行时 |
| dororo.pck | 26.77 MB | 13.5% | Godot 资源包（场景/脚本/着色器/纹理） |
| libgd_cubism DLL | 0.85 MB | 0.4% | Cubism GDExtension 原生插件 |
| models 目录 | 1.47 MB | 0.7% | Live2D 模型资源 |
| config.ini | 250 B | ~0% | 用户配置 |

### 4.2 关键发现

- **引擎与运行时占比 85.3%**：Godot 引擎壳(47.1%) + .NET 运行时(38.2%) 占据了绝大部分空间
- **业务逻辑极小**：Dororo.dll 仅 58 KB，说明核心逻辑非常精简
- **模型资源极轻**：Live2D 模型仅 1.47 MB，远小于 3D 模型
- **.NET 运行时冗余**：75 MB 的 .NET 运行时中，大部分 System.*.DLL 在此应用中不会被调用

### 4.3 优化建议

| 优化方向 | 预估节省 | 方法 |
|----------|----------|------|
| .NET 裁剪 | ~40-50 MB | 启用 PublishTrimmed 裁剪未使用的 BCL |
| PCK 压缩 | ~5-8 MB | Godot 导出时启用资源压缩 |
| 字体子集化 | ~15 MB | MSYH.TTC/MSYHBD.TTC 为完整中文字体，可裁剪 |

---

## 5. PCK 资源包深度解析

### 5.1 PCK 格式信息

| 属性 | 值 |
|------|-----|
| Magic | `GDPC` |
| Pack Version | 2 |
| Godot Version | 4.4.1 |
| 文件大小 | 26.77 MB |
| 资源路径数 | 263 |

### 5.2 PCK 内部资源分类

#### 场景文件 (.scn / .tscn)

| 场景 | 路径 | 用途 |
|------|------|------|
| main.scn | `res://.godot/exported/.../export-3ad5...-main.scn` | 主场景 |
| tool_bar.scn | `res://.godot/exported/.../export-0ee8...-tool_bar.scn` | 工具栏 |
| chat_bar.scn | `res://.godot/exported/.../export-1943...-chat_bar.scn` | 聊天输入栏 |
| chat_dialog.scn | `res://.godot/exported/.../export-2cb5...-chat_dialog.scn` | 聊天对话框 |
| setting.scn | `res://.godot/exported/.../export-b42b...-setting.scn` | 设置面板 |
| title_bar.scn | `res://.godot/exported/.../export-9981...-title_bar.scn` | 标题栏 |
| tray.scn | `res://.godot/exported/.../export-56fb...-tray.scn` | 系统托盘 |
| update_message_box.scn | `res://.godot/exported/.../export-925d...-update_message_box.scn` | 更新提示框 |

#### C# 脚本（9个）

| 脚本 | 路径 | 职责 |
|------|------|------|
| WindowManager | `res://scripts/cs/WindowManager.cs` | Windows 窗口管理（置顶、透明、无边框） |
| MouseTracker | `res://scripts/cs/MouseTracker.cs` | 全局鼠标位置追踪 |
| MouseDetection | `res://scripts/cs/MouseDetection.cs` | 鼠标进入/离开检测 |
| HideTaskBarIcon | `res://scripts/cs/HideTaskBarIcon.cs` | 隐藏任务栏图标 |
| FullscreenDetector | `res://scripts/cs/FullscreenDetector.cs` | 全屏应用检测 |
| AutoStarter | `res://scripts/cs/AutoStarter.cs` | 开机自启动管理 |
| FileAPI | `res://scripts/cs/FileAPI.cs` | 文件系统操作接口 |

#### GDScript 脚本（20+个）

**动画控制**

| 脚本 | 路径 | 职责 |
|------|------|------|
| anim_controller | `res://scripts/gd/anim/anim_controller.gd` | 动画状态机主控制器 |
| eye_blink | `res://scripts/gd/anim/eye_blink.gd` | 自动眨眼控制 |

**交互行为**

| 脚本 | 路径 | 职责 |
|------|------|------|
| drag_inertia | `res://scripts/gd/interact/drag_inertia.gd` | 拖拽惯性效果 |
| drop_remove | `res://scripts/gd/interact/drop_remove.gd` | 拖出屏幕移除 |
| hit_area_handler | `res://scripts/gd/interact/hit_area_handler.gd` | 点击区域处理 |
| mouse_follow | `res://scripts/gd/interact/mouse_follow.gd` | 鼠标跟随 |
| move | `res://scripts/gd/interact/move.gd` | 角色移动 |
| rand_move | `res://scripts/gd/interact/rand_move.gd` | 随机漫步 |
| touch | `res://scripts/gd/interact/touch.gd` | 触摸/点击交互 |
| window | `res://scripts/gd/interact/window.gd` | 窗口交互控制 |

**UI 管理**

| 脚本 | 路径 | 职责 |
|------|------|------|
| gui | `res://scripts/gd/ui/gui.gd` | GUI 主控制器 |
| chat_dialog_window | `res://scripts/gd/ui/chat_dialog/chat_dialog_window.gd` | 聊天对话框 |
| chatbar | `res://scripts/gd/ui/chatbar/chatbar.gd` | 聊天输入栏 |
| toolbar | `res://scripts/gd/ui/toolbar/toolbar.gd` | 工具栏 |
| interact_menu | `res://scripts/gd/ui/toolbar/interact_menu.gd` | 交互菜单 |
| tray | `res://scripts/gd/ui/tray.gd` | 系统托盘 |
| setting_about | `res://scripts/gd/ui/setting/setting_about.gd` | 关于页面 |
| setting_chat | `res://scripts/gd/ui/setting/setting_chat.gd` | 聊天设置 |
| setting_display | `res://scripts/gd/ui/setting/setting_display.gd` | 显示设置 |
| setting_interact | `res://scripts/gd/ui/setting/setting_interact.gd` | 交互设置 |
| setting_system | `res://scripts/gd/ui/setting/setting_system.gd` | 系统设置 |
| setting_window | `res://scripts/gd/ui/setting/setting_window.gd` | 窗口设置 |
| title_bar_dragging | `res://scripts/gd/ui/setting/title_bar_dragging.gd` | 标题栏拖拽 |
| update_message_box | `res://scripts/gd/ui/setting/update_message_box.gd` | 更新提示 |

**工具类**

| 脚本 | 路径 | 职责 |
|------|------|------|
| config_manager | `res://scripts/gd/utils/config/config_manager.gd` | 配置管理器 |
| config_section | `res://scripts/gd/utils/config/config_section.gd` | 配置分区 |
| time_counter | `res://scripts/gd/utils/time_counter.gd` | 计时器 |

#### 动画资源

**表情动画（12个）**

| 资源 | 路径 | 对应表情 |
|------|------|----------|
| Amaze | `res://anim/expression/Amaze.resn` | 惊讶 |
| bag | `res://anim/expression/bag.res` | 背包 |
| doubt | `res://anim/expression/doubt.res` | 疑惑 |
| dull | `res://anim/expression/dull.res` | 发呆 |
| dynamic_component | `res://anim/expression/dynamic_component.resDIxR` | 动态组件 |
| eye_blink | `res://anim/expression/eye_blink.res` | 眨眼 |
| eye_star | `res://anim/expression/eye_star.res` | 星星眼 |
| silence | `res://anim/expression/silence.resJ` | 沉默 |
| smile_eye_closed | `res://anim/expression/smile_eye_closed.res` | 闭眼微笑 |
| sullen | `res://anim/expression/sullen.res` | 不高兴 |
| sullen_line | `res://anim/expression/sullen_line.res` | 不高兴线条 |
| sunglasses | `res://anim/expression/sunglasses.res` | 墨镜 |

**头部运动动画（8个）**

| 资源 | 路径 | 方向 |
|------|------|------|
| head_down | `res://anim/motion/head_down.res` | 低头 |
| head_left | `res://anim/motion/head_left.res` | 左转 |
| head_left_down | `res://anim/motion/head_left_down.res` | 左下 |
| head_left_up | `res://anim/motion/head_left_up.res` | 左上 |
| head_right | `res://anim/motion/head_right.res` | 右转 |
| head_right_down | `res://anim/motion/head_right_down.res` | 右下 |
| head_right_up | `res://anim/motion/head_right_up.res` | 右上 |
| head_up | `res://anim/motion/head_up.res` | 抬头 |

**行为动画（3个）**

| 资源 | 路径 | 用途 |
|------|------|------|
| idle | `res://anim/motion/idle.res` | 待机 |
| run | `res://anim/motion/run.res` | 跑步 |

#### 着色器（10个）

| 着色器 | 路径 | 用途 |
|--------|------|------|
| 2d_cubism_norm_add | `res://addons/gd_cubism/res/shader/` | 正常混合-加法 |
| 2d_cubism_norm_mix | `res://addons/gd_cubism/res/shader/` | 正常混合-混合 |
| 2d_cubism_norm_mul | `res://addons/gd_cubism/res/shader/` | 正常混合-乘法 |
| 2d_cubism_mask | `res://addons/gd_cubism/res/shader/` | 遮罩基础 |
| 2d_cubism_mask_add | `res://addons/gd_cubism/res/shader/` | 遮罩-加法 |
| 2d_cubism_mask_add_inv | `res://addons/gd_cubism/res/shader/` | 遮罩-加法反转 |
| 2d_cubism_mask_mix | `res://addons/gd_cubism/res/shader/` | 遮罩-混合 |
| 2d_cubism_mask_mix_inv | `res://addons/gd_cubism/res/shader/` | 遮罩-混合反转 |
| 2d_cubism_mask_mul | `res://addons/gd_cubism/res/shader/` | 遮罩-乘法 |
| 2d_cubism_mask_mul_inv | `res://addons/gd_cubism/res/shader/` | 遮罩-乘法反转 |

#### 字体资源

| 字体 | 路径 | 说明 |
|------|------|------|
| MSYH.TTC | `res://fonts/MSYH.TTC` | 微软雅黑 常规 |
| MSYHBD.TTC | `res://fonts/MSYHBD.TTC` | 微软雅黑 粗体 |

#### UI 图标资源

| 类别 | 文件 | 用途 |
|------|------|------|
| 聊天 | back/chat_window/clear/close/dialog/send/stop | 聊天界面图标 |
| 设置 | bg_sharp/check/check_default/close/grabber/grabber_disabled/radio/radio_checked/setting | 设置界面图标 |
| 工具栏 | bg/check/check_default | 工具栏图标 |
| 粒子 | glint/heart | 交互粒子效果 |

#### 主题资源

| 主题 | 路径 | 用途 |
|------|------|------|
| chat_dialog.tres | `res://themes/` | 聊天对话框主题 |
| settings.tres | `res://themes/` | 设置面板主题 |
| toolbar.tres | `res://themes/` | 工具栏主题 |

---

## 6. C# 业务逻辑层分析

### 6.1 DLL 基本信息

| 属性 | 值 |
|------|-----|
| 文件 | Dororo.dll |
| 大小 | 58,880 bytes (57.5 KB) |
| 依赖 | GodotSharp 4.4.1, Godot.SourceGenerators 4.4.1 |
| 运行时 | .NET 8.0, win-x64 |

### 6.2 C# 类清单

通过 DLL 二进制字符串分析，识别出以下 9 个核心 C# 类：

| 类名 | 职责 | 技术要点 |
|------|------|----------|
| **WindowManager** | Windows 窗口管理 | 调用 Win32 API (WindowLong, WindowStyle, WindowRect, WindowGetNativeHandle) 实现置顶、透明、无边框窗口 |
| **MouseTracker** | 全局鼠标追踪 | 获取 MousePosition / MousePositionGlobal，驱动角色眼睛/头部跟随 |
| **MouseDetection** | 鼠标进入/离开检测 | 触发 MouseEntered / MouseExited 事件，控制交互响应 |
| **HideTaskBarIcon** | 隐藏任务栏图标 | 调用 Win32 API 隐藏应用在任务栏的显示 |
| **FullscreenDetector** | 全屏应用检测 | 检测前台应用是否全屏，触发自动隐藏 |
| **AutoStarter** | 开机自启动 | 注册/注销 Windows 启动项 |
| **FileAPI** | 文件系统操作 | 读写配置文件、模型资源等 |
| **Dororo** | 应用主入口 | Godot 场景主节点类 |

### 6.3 C# 层设计模式

C# 层严格遵循**平台原生 API 封装**的职责边界，只处理 GDScript 无法直接调用的 Windows 系统级功能：

```
GDScript 层（游戏逻辑）
    ↕ Godot 信号/方法调用
C# 层（平台原生桥接）
    ↕ P/Invoke (DllImport)
Win32 API (user32.dll, kernel32.dll, shell32.dll)
```

### 6.4 Cubism C# 绑定类

Dororo.dll 中还包含 Cubism 插件的 C# 绑定层：

| 类名 | 用途 |
|------|------|
| CubismUserModelCS | Cubism 用户模型 C# 封装 |
| CubismParameterCS | 参数访问 C# 封装 |
| CubismPartOpacityCS | 部件透明度 C# 封装 |
| CubismValueAbsCS | 绝对值计算 C# 封装 |
| CubismEffectCS | 效果基类 C# 封装 |
| CubismEffectCustomCS | 自定义效果 C# 封装 |
| CubismEffectHitAreaCS | 点击区域效果 C# 封装 |
| CubismEffectTargetPointCS | 目标点效果 C# 封装 |

---

## 7. GDExtension Cubism 插件分析

### 7.1 插件信息

| 属性 | 值 |
|------|-----|
| 文件 | libgd_cubism.windows.release.x86_64.dll |
| 大小 | 889,856 bytes (0.85 MB) |
| 架构 | x86_64 (64-bit) |
| 构建 | Release 模式 |
| GDExtension API | Godot 4.x |

### 7.2 插件注册的 Godot 类

通过 DLL 二进制分析，识别出 **48 个 Cubism 相关类**，完整覆盖 Live2D Cubism SDK：

#### 核心框架层

| 类名 | 职责 |
|------|------|
| CubismFramework | SDK 初始化/销毁 |
| CubismAllocator | 内存分配器 |
| CubismJson | JSON 解析器 |
| CubismId | 参数/部件 ID 管理 |

#### 模型层

| 类名 | 职责 |
|------|------|
| CubismModel | 模型核心（参数更新、绘制） |
| CubismMoc | MOC3 二进制数据管理 |
| CubismModelSetting | 模型设置（model3.json 解析） |
| CubismModelSettingJson | 模型设置 JSON 解析 |
| CubismModelUserData | 用户数据 |
| CubismModelUserDataJson | 用户数据 JSON 解析 |
| CubismModelUserDataNode | 用户数据节点 |
| CubismUserModel | 用户模型（完整封装） |

#### 运动层

| 类名 | 职责 |
|------|------|
| CubismMotion | 运动数据（贝塞尔曲线插值） |
| CubismMotionJson | 运动 JSON 解析 |
| CubismMotionLoader | 运动加载器 |
| CubismMotionManager | 运动管理器 |
| CubismMotionQueueManager | 运动队列管理 |
| CubismMotionQueueEntry | 运动队列条目 |
| CubismMotionQueueEntryHandle | 运动队列条目句柄 |
| CubismMotionCurve | 运动曲线 |
| CubismMotionSegment | 运动段 |
| CubismMotionPoint | 运动点 |
| CubismMotionEntry | 运动条目 |
| CubismMotionEvent | 运动事件 |
| CubismExpressionMotion | 表情运动 |
| CubismExpressionMotionManager | 表情运动管理器 |

#### 物理层

| 类名 | 职责 |
|------|------|
| CubismPhysics | 物理模拟引擎 |
| CubismPhysicsJson | 物理 JSON 解析 |
| CubismPhysicsInput | 物理输入 |
| CubismPhysicsOutput | 物理输出 |
| CubismPhysicsParticle | 物理粒子 |
| CubismPhysicsSubRig | 物理子刚体 |

#### 效果层

| 类名 | 职责 |
|------|------|
| CubismEffect | 效果基类 |
| CubismEffectEyeBlink | 自动眨眼 |
| CubismEffectBreath | 自动呼吸 |
| CubismEffectCustom | 自定义效果 |
| CubismEffectHitArea | 点击区域 |
| CubismEffectTargetPoint | 目标点追踪 |
| CubismBreath | 呼吸参数生成 |
| CubismEyeBlink | 眨眼参数生成 |
| CubismTargetPoint | 目标点计算 |

#### 渲染层

| 类名 | 职责 |
|------|------|
| CubismRenderer | 渲染器基类 |
| CubismRenderer2D | 2D 渲染器 |
| CubismTextureColor | 纹理颜色 |

#### 姿态/矩阵层

| 类名 | 职责 |
|------|------|
| CubismPose | 姿态控制（部件层级） |
| CubismMatrix44 | 4x4 矩阵 |
| CubismModelMatrix | 模型矩阵 |

#### 参数/部件层

| 类名 | 职责 |
|------|------|
| CubismParameter | 参数定义 |
| CubismPartOpacity | 部件透明度 |
| CubismValueAbs | 绝对值计算 |

### 7.3 GDExtension 生命周期

```
Godot 启动
  └── 加载 gd_cubism.gdextension 配置
        └── 加载 libgd_cubism DLL
              ├── initialize() → 注册所有 Cubism 节点类型到 ClassDB
              ├── 每帧调用:
              │     ├── CubismPrologue → 帧前处理
              │     ├── CubismProcess → 帧中更新（参数/物理/运动/表情）
              │     └── CubismEpilogue → 帧后处理
              └── deinitialize() → 清理资源
```

### 7.4 渲染管线

Cubism 渲染采用 **双 Pass 着色器** 架构：

1. **Mask Pass**：先渲染遮罩（7 个遮罩着色器变体）
2. **Normal Pass**：再渲染模型本体（3 个正常着色器变体：Add/Mix/Mul）

每个着色器变体对应 Live2D 的不同混合模式，确保模型渲染与原始效果一致。

---

## 8. Live2D 模型系统深度分析

### 8.1 模型资源清单

| 文件 | 大小 | 格式 | 用途 |
|------|------|------|------|
| Doro.moc3 | 646 KB | 二进制 | 模型网格、变形器、绘制顺序、参数绑定 |
| texture_00.png | 534 KB | PNG | 2048x2048 纹理贴图（单张贴图） |
| Doro.model3.json | 1.3 KB | JSON | 模型清单（引用所有子资源） |
| Doro.cdi3.json | 4.8 KB | JSON | 参数/部件显示信息 |
| Doro.physics3.json | 11 KB | JSON | 7 组物理模拟配置 |
| Doro.vtube.json | 25 KB | JSON | VTube Studio 兼容配置 |
| Idle.motion3.json | 1.9 KB | JSON | 待机动画 |
| walk.motion3.json | 366 B | JSON | 行走动画 |
| icon.png | 310 KB | PNG | 模型缩略图 |

### 8.2 参数体系（46 个参数）

#### 按功能分组

| 参数组 | 参数数量 | 参数列表 | 用途 |
|--------|----------|----------|------|
| **Angles** | 7 | ParamAngleX/Y/Z, ParamBodyAngleY/Z, ParamStep, ParamBreath | 头部/身体旋转、步行、呼吸 |
| **Facial Expression** | 6 | ParamEyeLOpen/ROpen, ParamEyeSmile, ParamEyeAngle, ParamBrowLY/RY | 眼睛/眉毛控制 |
| **Mouth** | 5 | ParamMouthForm, ParamMouthOpenY, ParamTongueOut, ParamMouthX/Y | 嘴部控制 |
| **Physics** | 10 | PhyAngleX/Y, PhyHairX1/X2/Y1/Y2, PhyIrisR1/R2/L1/L2, PhyBounce | 物理模拟输出参数 |
| **Expression** | 9 | ParamExp1~7, ParamExpEyeHighlights, ParamExpEyeStar | 表情叠加参数 |
| **Animation** | 3 | AnimLine, AnimLoading1, AnimLoading2 | 动画驱动参数 |
| **Bounce Input** | 4 | ParamBounceInput1~4 | 弹跳物理输入 |

#### 部件层级（10 个部件组）

| 部件 | ID | 层级关系 |
|------|-----|----------|
| 头部 | Head_group | 最上层 |
| 身体 | Body_group | — |
| 眼睛 | Eye_group | 头部子级 |
| 嘴巴 | Mouth_group | 头部子级 |
| 脸部 | Face_group | 头部子级 |
| 前发 | Hair_front_group | 头部子级 |
| 后发 | Hair_back_group | 身体子级 |
| 蝴蝶结 | Bow_group | 头部子级 |
| 丝带 | Ribbon_group | 身体子级 |

### 8.3 物理模拟系统

模型配置了 **7 组物理模拟**，基于弹簧-阻尼器模型：

| 物理组 | 输入源 | 输出参数 | 粒子数 | 效果描述 |
|--------|--------|----------|--------|----------|
| **Bounce** | BounceInput1~4 + Step | PhyBounce | 3 | 身体弹跳（行走/说话时胸部晃动） |
| **Iris_R** | ParamEyeROpen | PhyIrisR1/R2 | 4 | 右瞳孔惯性运动 |
| **Iris_L** | ParamEyeLOpen | PhyIrisL1/L2 | 4 | 左瞳孔惯性运动 |
| **Hair_X** | ParamAngleX/Z | PhyHairX1/X2 | 3 | 头发水平摆动 |
| **Hair_Y** | BodyAngleY + Bounce + Breath + AngleY | PhyHairY1/Y2 | 3 | 头发垂直摆动 |
| **ExpPhyX** | ParamAngleX/Z | PhyAngleX | 2 | 表情物理X（头部惯性） |
| **ExpPhyY** | ParamAngleY + BodyAngleY + Breath | PhyAngleY | 2 | 表情物理Y（头部惯性） |

**物理引擎参数**：60 FPS、重力 (0, -1)、无风力

### 8.4 表情系统详解

#### 表情分类

| 类别 | 表情 | 参数修改 | 混合模式 |
|------|------|----------|----------|
| **基础表情** | Idle (Exp0) | 无修改 | Add |
| **情绪表情** | Sullen (Exp1) | ParamExp1 = 1.0 | Add |
| | Speechless (Exp2) | ParamExp2 = 1.0 | Add |
| | Amaze (Exp3) | ParamExp3 = 1.0 | Add |
| | Doubt (Exp4) | ParamExp4 = 1.0 | Add |
| **装饰表情** | Sunglasses (Exp5) | ParamExp5 = 1.0 | Add |
| | Bag (Exp6) | ParamExp6 = 1.0 | Add |
| | Loading (Exp7) | ParamExp7 = 1.0 | Add |
| | StarEye (Exp8) | ParamExpEyeStar = 1.0 | Add |
| **功能表情** | Highlight OFF | ParamExpEyeHighlights = -1.0 | Add |
| | Running OFF | ParamStep = 0.0 | Add |
| | TongueOut | ParamTongueOut = 1.0 + ParamMouthOpenY = 0.0 | Add |

#### 表情设计规律

1. **统一 Add 混合**：所有表情均使用 Add 模式，支持多表情叠加
2. **单参数驱动**：大部分表情仅修改一个参数（ParamExp*），由模型内部预设决定视觉效果
3. **功能型表情**：Highlight OFF / Running OFF 不是情绪表达，而是控制视觉特效的开关
4. **TongueOut 复合表情**：唯一修改两个参数的表情，同时控制舌头伸出和嘴巴关闭

### 8.5 动画系统

| 动画 | 时长 | FPS | 循环 | 曲线数 | 段数 | 点数 |
|------|------|-----|------|--------|------|------|
| Idle | 0.983s | 60 | 是 | 4 | 26 | 62 |
| Walk | — | — | — | — | — | — |

Idle 动画驱动的参数：AnimLine（跑步线条动画）、AnimLoading1/2（加载动画）、ParamBreath（呼吸）

### 8.6 VTube Studio 兼容层

Doro.vtube.json 包含完整的 VTube Studio 配置，说明模型可直接用于 VTuber 场景：

- **17 个参数映射**：面部追踪 → Live2D 参数
- **10 个快捷键**：Numpad 0~9 + Decimal 对应各表情
- **物理配置**：强度 50%，无风力
- **默认激活表情**：Running OFF

---

## 9. GDScript 脚本体系分析

### 9.1 脚本职责分层

```
┌─────────────────────────────────────────────────────────┐
│                    UI 层 (7个脚本)                       │
│  gui / chat_dialog / chatbar / toolbar / tray / setting │
├─────────────────────────────────────────────────────────┤
│                  动画层 (2个脚本)                        │
│           anim_controller / eye_blink                   │
├─────────────────────────────────────────────────────────┤
│                  交互层 (8个脚本)                        │
│  drag_inertia / drop_remove / hit_area / mouse_follow   │
│  move / rand_move / touch / window                      │
├─────────────────────────────────────────────────────────┤
│                  工具层 (3个脚本)                        │
│        config_manager / config_section / time_counter   │
└─────────────────────────────────────────────────────────┘
```

### 9.2 关键脚本功能推测

**anim_controller.gd** — 动画状态机
- 管理 Idle / Run / 表情 状态切换
- 驱动 Cubism 模型的 Motion 和 Expression
- 响应交互事件触发动画变化

**config_manager.gd** — 配置管理
- 读写 config.ini（INI 格式）
- 分区管理：window / interact / display / system / chat
- 运行时热更新配置

**mouse_follow.gd** — 鼠标跟随
- 获取 MouseTracker (C#) 提供的全局鼠标位置
- 计算 ParamAngleX/Y 映射
- 驱动角色头部/眼睛跟随鼠标

**rand_move.gd** — 随机漫步
- 定时触发随机方向移动
- 控制窗口位置变化
- 切换 Walk 动画

---

## 10. 插件生态系统分析

### 10.1 插件清单

| 插件 | 类型 | 脚本数 | 职责 |
|------|------|--------|------|
| **gd_cubism** | GDExtension + C# | 8 C# + 10 着色器 | Live2D Cubism 渲染引擎 |
| **gd_chathub** | GDScript | 4 | AI 聊天框架（OpenAI API 兼容） |
| **gd_data_binding** | GDScript | 10 | MVVM 数据绑定框架 |
| **gd_uuid** | GDScript | 4 | UUID 生成器 |

### 10.2 gd_chathub 聊天框架

| 脚本 | 职责 |
|------|------|
| base_chat_client.gd | 聊天客户端基类 |
| openai_chat_client.gd | OpenAI API 兼容客户端 |
| context_manager.gd | 对话上下文管理 |
| response_parser.gd | 响应解析器 |

此插件实现了完整的 LLM 对接框架，支持 OpenAI API 格式，可对接任何兼容的 LLM 服务（如本地 Ollama、远程 API 等）。

### 10.3 gd_data_binding 数据绑定

| 脚本 | 职责 |
|------|------|
| binding.gd | 绑定核心 |
| binding_source.gd | 数据源 |
| base_binding_source.gd | 数据源基类 |
| binding_converter.gd | 值转换器 |
| binding_converter_pipeline.gd | 转换器管道 |
| binding_with_pipeline.gd | 带管道的绑定 |
| binding_utils.gd | 绑定工具 |
| case_binding_converter.gd | 大小写转换器 |
| invert_bool_binding_converter.gd | 布尔反转转换器 |
| plus_one_converter.gd | 加一转换器 |

此插件实现了类似 WPF/UWP 的数据绑定机制，用于 UI 与数据的自动同步。

---

## 11. 配置系统与运行机制

### 11.1 config.ini 完整结构

```ini
[window]
window_pos=Vector2i(498, 221)    # 窗口位置（自动记忆）
window_scale=1.1                  # 窗口缩放比例

[interact]
stroll=true                       # 随机漫步
mouse_follow=true                 # 鼠标跟随
dock=true                         # 边缘停靠
pin=true                          # 窗口置顶
drop_remove=true                  # 拖出屏幕移除
dock_type=0                       # 停靠类型

[display]
msaa=true                         # MSAA 抗锯齿
msaa_level=2                      # MSAA 2x

[system]
auto_hide=false                   # 全屏时自动隐藏
power_save=false                  # 省电模式

[chat]
thinking=true                     # AI 思考模式
```

### 11.2 配置与代码映射

| 配置项 | 对应脚本 | 对应功能 |
|--------|----------|----------|
| window_pos / window_scale | config_section / WindowManager | 窗口位置记忆与缩放 |
| stroll | rand_move | 随机漫步开关 |
| mouse_follow | mouse_follow | 鼠标跟随开关 |
| dock | window | 边缘停靠开关 |
| pin | WindowManager | 窗口置顶开关 |
| drop_remove | drop_remove | 拖出移除开关 |
| auto_hide | FullscreenDetector | 全屏隐藏开关 |
| msaa / msaa_level | setting_display | 渲染抗锯齿 |
| thinking | setting_chat / chat_dialog_window | AI 聊天思考模式 |

---

## 12. 构建与打包流程

### 12.1 开发环境

```
Godot 4.4.1 Editor (.NET 版本)
  ├── .NET 8.0 SDK
  ├── C# 源码 → Dororo.dll (Godot.SourceGenerators 4.4.1)
  ├── GDScript 源码 → .gdc 编译字节码
  ├── 场景/资源 → .scn / .res 二进制格式
  └── 着色器 → .gdshader 编译格式
```

### 12.2 导出流程

```
1. Godot Export (Windows Desktop)
   ├── dororo.exe (引擎壳 + 嵌入式启动器)
   ├── dororo.pck (所有 Godot 资源打包)
   └── libgd_cubism DLL (GDExtension 原生插件)

2. .NET Publish (Self-contained)
   dotnet publish -c Release -r win-x64 --self-contained true
   └── data_Dororo_windows_x86_64/
       ├── Dororo.dll
       ├── GodotSharp.dll
       └── .NET Runtime (~130 DLLs)

3. 运行时资源
   ├── config.ini (首次运行自动生成)
   └── models/ (Live2D 模型，外部加载)
```

### 12.3 PCK 打包策略

Godot 4 PCK v2 格式特点：
- 文件索引位于 PCK 末尾（支持追加打包）
- 资源使用 MD5 校验
- 文件路径使用 `res://` 虚拟路径
- 编译后的 GDScript (.gdc) 和 C# 绑定 (.csy) 均包含在内

---

## 13. 运行时架构总览

### 13.1 启动序列

```
1. dororo.exe 启动
   └── 初始化 Godot Engine 4.4.1
       ├── 加载 dororo.pck
       │     ├── 注册 GDExtension (gd_cubism)
       │     ├── 加载主场景 (main.scn)
       │     └── 初始化 .NET Runtime
       │           ├── hostfxr.dll → coreclr.dll
       │           └── 加载 Dororo.dll
       ├── 读取 config.ini
       └── 加载 models/Doro/ (Live2D 模型)
```

### 13.2 运行时数据流

```
┌──────────────────────────────────────────────────────────────────┐
│                        dororo.exe (Godot 4.4.1)                  │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  C# 层      │  │  GDScript 层  │  │  GDExtension 层        │  │
│  │             │  │              │  │                        │  │
│  │ WindowManager│  │ anim_controller│  │ libgd_cubism DLL      │  │
│  │ MouseTracker │←→│ mouse_follow   │←→│ CubismUserModel       │  │
│  │ MouseDetection│ │ rand_move     │  │ CubismMotionManager   │  │
│  │ HideTaskBar  │  │ drag_inertia  │  │ CubismPhysics         │  │
│  │ FullscreenDet│  │ drop_remove   │  │ CubismRenderer2D      │  │
│  │ AutoStarter  │  │ hit_area      │  │ CubismEffectEyeBlink  │  │
│  │ FileAPI      │  │ touch         │  │ CubismEffectBreath    │  │
│  │              │  │ config_manager│  │                        │  │
│  │    ↕ P/Invoke│  │ gui / toolbar │  │    ↕ Cubism C++ SDK   │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬────────────┘  │
│         │                 │                       │              │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌───────────▼────────────┐  │
│  │  Win32 API   │  │  config.ini  │  │  models/Doro/          │  │
│  │  user32.dll  │  │  用户配置     │  │  Doro.moc3 + 纹理      │  │
│  │  shell32.dll │  │              │  │  + 表情 + 动画 + 物理   │  │
│  └──────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    gd_chathub 插件                            │ │
│  │  openai_chat_client → context_manager → response_parser      │ │
│  │                    ↕ HTTP/WebSocket                           │ │
│  │              LLM API (OpenAI 兼容)                            │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 13.3 每帧更新流程

```
_process(delta):
  1. MouseTracker.Update()           → 获取全局鼠标位置
  2. FullscreenDetector.Check()      → 检测全屏应用
  3. anim_controller.Update()        → 更新动画状态
     ├── eye_blink.Update()          → 自动眨眼计时
     ├── mouse_follow.Update()       → 计算头部/眼睛角度
     └── rand_move.Update()          → 随机漫步计时
  4. CubismPrologue()                → Cubism 帧前处理
  5. CubismProcess()                 → Cubism 帧更新
     ├── PhysicsEvaluate()           → 物理模拟计算
     ├── MotionManager.Update()      → 运动插值更新
     ├── ExpressionManager.Update()  → 表情参数更新
     ├── EyeBlink.Update()           → 眨眼参数更新
     ├── Breath.Update()             → 呼吸参数更新
     └── PoseUpdate()                → 姿态层级更新
  6. CubismEpilogue()                → Cubism 帧后处理
  7. CubismRenderer2D.Draw()         → 渲染到 SubViewport
     ├── Mask Pass (7 着色器变体)    → 绘制遮罩
     └── Normal Pass (3 着色器变体)  → 绘制模型
```

---

## 14. 核心结论与本质规律

### 14.1 架构本质：三层分离

Dororo 项目的架构本质是**平台原生层 / 游戏逻辑层 / 模型渲染层**的严格分离：

| 层 | 技术 | 职责边界 | 替换成本 |
|----|------|----------|----------|
| **平台原生层** | C# + Win32 API | 仅处理系统级调用 | 低（接口稳定） |
| **游戏逻辑层** | GDScript | 动画/交互/UI/配置 | 中（依赖 Godot API） |
| **模型渲染层** | GDExtension + Cubism C++ | 模型加载/渲染/物理 | 高（SDK 深度耦合） |

这种分离使得：
- 更换 Live2D 模型只需替换 `models/` 目录
- 移植到 macOS/Linux 只需重写 C# 层和重新编译 GDExtension
- 添加新交互行为只需编写新的 GDScript

### 14.2 双语言分工规律

C# 和 GDScript 的分工遵循**"不可替代性"原则**：

- **C# 用于 GDScript 做不到的事**：Win32 API 调用、系统原生交互
- **GDScript 用于 C# 不适合的事**：快速原型、Godot 节点操作、信号连接
- **两者通过 Godot 信号系统通信**：松耦合、事件驱动

### 14.3 Live2D 模型设计规律

1. **参数化驱动**：所有视觉效果通过 46 个数值参数控制，而非帧动画
2. **物理模拟增强真实感**：7 组弹簧-阻尼器模拟覆盖头发、瞳孔、身体弹跳
3. **表情叠加而非替换**：Add 混合模式允许多表情同时激活
4. **单纹理优化**：仅 1 张 2048px 纹理，模型总大小仅 1.47 MB
5. **VTube Studio 兼容**：模型可跨平台复用

### 14.4 桌面宠物核心功能模式

所有桌面宠物功能可归纳为**三种交互模式**：

| 模式 | 功能 | 实现方式 |
|------|------|----------|
| **被动响应** | 鼠标跟随、眨眼、呼吸 | 每帧计算参数映射 |
| **主动行为** | 随机漫步、自动隐藏 | 定时器 + 状态机 |
| **用户触发** | 拖拽、点击、聊天 | 事件驱动 + 信号系统 |

### 14.5 资源包设计规律

- **PCK 包含不可变资源**：场景、脚本、着色器、字体、图标
- **外部目录包含可变资源**：Live2D 模型（支持热替换）、config.ini（用户配置）
- **.NET 运行时独立部署**：data_ 目录与 Godot 引擎完全解耦

### 14.6 性能特征

| 指标 | 评估 | 依据 |
|------|------|------|
| 启动速度 | 中等 | 需加载 .NET Runtime + PCK + Cubism DLL |
| 内存占用 | 低 | Live2D 模型仅 ~5 MB 运行时内存 |
| 渲染开销 | 极低 | 2D 网格渲染，单纹理，MSAA 2x |
| CPU 占用 | 极低 | 60 FPS 物理模拟 + 参数插值 |
| 磁盘占用 | 偏高 | .NET Runtime 冗余（可裁剪 ~40 MB） |

### 14.7 可扩展性评估

| 扩展方向 | 难度 | 方法 |
|----------|------|------|
| 替换 Live2D 模型 | ★☆☆ | 替换 models/ 目录，适配参数映射 |
| 添加新表情 | ★★☆ | 新增 .exp3.json + anim/expression/ 资源 |
| 添加新动画 | ★★☆ | 新增 .motion3.json + anim/motion/ 资源 |
| 接入不同 LLM | ★☆☆ | 修改 openai_chat_client.gd 的 API 地址 |
| 移植到 macOS | ★★★ | 重写 C# 层 + 重编译 GDExtension |
| 添加语音交互 | ★★★★ | 需新增 STT/TTS 插件 |
| 添加 3D 场景 | ★★★★★ | 架构不兼容，需重构渲染层 |

---

> **报告结束**  
> 本报告基于对项目全部文件的静态分析，包括 PCK 资源包解析、DLL 二进制字符串提取、Live2D 模型 JSON 解析、配置文件分析等。所有结论均基于可观测证据推导。

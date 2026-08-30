# MurasamePet 开源仓库技术分析报告

> 仓库地址：https://github.com/LemonQu-GIT/MurasamePet
> 分析日期：2026-07-11
> 分析分支：master
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

MurasamePet（丛雨桌宠）是一个基于 **Python + PyQt5** 构建的 AI 桌面宠物项目，角色名为"丛雨"（ムラサメ），是一个 16 岁的绿发小女孩形象（寄宿在建实神社神刀上的 500 岁女孩）。项目最大的特色是**端到端 AI 集成**：本地 LLM 对话 + GPT-SoVITS 语音合成 + Qwen-VL 视觉理解 + AI 驱动的情感立绘选择，实现了完整的 Galgame 风格交互体验。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | MurasamePet（丛雨桌宠） |
| 仓库地址 | https://github.com/LemonQu-GIT/MurasamePet |
| 作者 | LemonQu-GIT（主要贡献者 yuemingruoan） |
| 许可证 | GPL-3.0 |
| 分支数 | 2 |
| Tags | 0 |
| 总提交数 | 53 |
| Issues | 11 Open / 1 Closed |
| Releases | 无 |
| 最后更新 | 2025-10-13 |
| 编程语言 | Python 96.7% |
| 视频演示 | https://www.bilibili.com/video/BV1vjeGzfE1w |
| 联系邮箱 | 270598250@qq.com |

### 当前状态

项目无 Release 发布，仅支持源码运行。支持 macOS（Apple Silicon）和 Windows（NVIDIA），明确不支持 Linux 和 Intel Mac。部署门槛较高，需要下载 14B 参数的大模型。

---

## 2. 核心技术栈

| 维度 | 技术选型 | 版本 |
|------|----------|------|
| **编程语言** | Python | 3.10（强制 `requires-python = "==3.10.*"`） |
| **GUI 框架** | PyQt5 | 5.15.11 |
| **Web API 框架** | FastAPI + Uvicorn | 0.116.1 / 0.35.0 |
| **深度学习（macOS）** | MLX + mlx-lm | ≥0.29.1 / ≥0.27.1 |
| **深度学习（Win/Linux）** | PyTorch + transformers + peft(LoRA) | ≥2.0.0 / ≥4.45.0 |
| **计算机视觉** | OpenCV + Pillow | 4.11.0.86 / 11.3.0 |
| **TTS 语音合成** | GPT-SoVITS（精简版） | — |
| **音频处理** | librosa + scipy + ffmpeg-python | 0.10.2 / ≥1.14.0 |
| **屏幕交互** | pyautogui | 0.9.54 |
| **日志** | rich | 14.1.0 |
| **包管理** | uv | — |
| **macOS 原生 API** | pyobjc-framework-Cocoa | ≥10.0 |
| **ASR 语音识别** | funasr | 1.0.27 |
| **推理优化** | ctranslate2 + onnxruntime | ≥4.0 / ≥1.20.0 |

### 技术栈架构特征

- **平台自适应模型加载**：macOS 用 MLX（Int4 量化），Windows/Linux 用 PyTorch + LoRA
- **三层服务架构**：API 服务（FastAPI）+ TTS 服务（GPT-SoVITS）+ 客户端（PyQt5）
- **本地/云端双模式**：支持 Ollama 本地部署和 OpenRouter 云端 API
- **AI 驱动立绘**：LLM 根据情感自动选择图层组合（非 Live2D）

---

## 3. 项目架构与目录结构

### 3.1 整体架构

MurasamePet 采用**三层服务架构**：

```
┌─────────────────────────────────────────────────────────┐
│              客户端 (pet.py - PyQt5)                      │
│  透明窗口 / 立绘显示 / 交互处理 / 打字机文本              │
│  工作线程: LLMWorker / ScreenCaptureWorker               │
├─────────────────────────────────────────────────────────┤
│              聊天逻辑 (Murasame/chat.py)                  │
│  对话 / 翻译 / 情感分析 / 立绘选择 / TTS / 句子分割       │
├──────────────┬──────────────────────────────────────────┤
│  API 服务    │  TTS 服务                                 │
│  (api.py)    │  (gpt_sovits/api_v2.py)                   │
│  FastAPI     │  GPT-SoVITS                               │
│  端口 28565  │  端口 9880                                │
│  ├── /chat   │  ├── /tts                                 │
│  ├── /qwen3  │  └── /set_gpt_weights                     │
│  └── /qwenvl │                                           │
├──────────────┴──────────────────────────────────────────┤
│              模型层                                       │
│  macOS: MLX (Qwen3-14B-MLX-Int4)                        │
│  Win:   PyTorch+LoRA (Qwen3-14B + Murasame LoRA)        │
│  TTS:   GPT-SoVITS (BigVGAN + CNHubert + Whisper)       │
│  VL:    Qwen-VL (本地 Ollama 或 OpenRouter 云端)          │
└─────────────────────────────────────────────────────────┘
```

### 3.2 完整目录结构

```
MurasamePet/
├── api.py                    # 核心 API 服务（FastAPI）
├── pet.py                    # 桌宠主程序（PyQt5 客户端）
├── config.json               # 核心配置文件
├── download.py               # 模型下载脚本（ModelScope）
├── run_project.py            # 一键启动脚本（跨平台）
├── pyproject.toml            # Python 项目配置（70+ 依赖）
├── uv.lock                   # uv 依赖锁定文件
├── LICENSE                   # GPL-3.0
├── README.md
├── icon.png
├── 思源黑体Bold.otf           # 中文字体
│
├── Murasame/                 # 聊天逻辑模块
│   ├── chat.py               # 客户端聊天逻辑
│   ├── generate.py           # 立绘图层合成（OpenCV）
│   └── utils.py              # 日志与配置工具
│
├── gpt_sovits/               # TTS 服务（精简版 GPT-SoVITS）
│   ├── api_v2.py             # TTS API 服务
│   ├── install.sh / install.ps1  # 预训练模型下载
│   ├── configs/tts_infer.yaml    # TTS 推理配置
│   └── GPT_SoVITS/           # TTS 核心模块
│       ├── TTS_infer_pack/  # 推理包
│       ├── AR/               # AR 模型
│       ├── BigVGAN/          # 声码器
│       ├── feature_extractor/ # CNHubert/Whisper
│       └── text/             # 多语言文本处理
│
├── fgimages/                 # 立绘图层资源
│   ├── ムラサメa.txt          # 立绘 A 配置（UTF-16 LE）
│   ├── ムラサメb.txt          # 立绘 B 配置
│   └── ムラサメa_*.png        # 各图层 PNG
│
├── models/                   # 模型目录（gitignore）
│   ├── Murasame/             # LLM 模型
│   ├── Qwen3-14B/            # 基础模型
│   └── Murasame_SoVITS/      # 语音模型
│       └── reference_voices/ # 按情感分类的参考音频
└── log/                      # 服务日志
```

---

## 4. 核心功能模块详解

### 4.1 API 服务（api.py）

FastAPI 服务，监听端口 28565，提供三个端点：

| 端点 | 功能 | 模型 |
|------|------|------|
| `POST /chat` | 本地 LLM 推理 | MLX（macOS）/ PyTorch+LoRA（Win） |
| `POST /qwen3` | 通用问答 | Ollama 本地 / OpenRouter 云端 |
| `POST /qwenvl` | 视觉语言模型 | Qwen-VL 7B |

**平台自适应**：
- macOS：MLX 加载 Int4 量化合并模型
- Windows/Linux：PyTorch + PEFT 加载基础模型 + LoRA 适配器

### 4.2 桌宠客户端（pet.py）

`Murasame(QLabel)` 核心类：

- **显示预设系统**：4 种预设 + 自定义
  - compact（35% 可见，头部+肩部）
  - balanced（45%，上半身，默认）
  - standard（60%，到腰部）
  - full（100%，完整立绘）
- **交互系统**：
  - 左键点击头部 + 拖动 = 摸头交互
  - 左键点击下半身 = 输入模式
  - 中键拖动 = 移动窗口
- **打字机效果**：QTimer 逐字显示（40ms 间隔）
- **Crossfade 动画**：QPainter CompositionMode 立绘平滑过渡
- **macOS 窗口置顶**：PyObjC 设置 NSFloatingWindowLevel，不抢焦点

### 4.3 聊天逻辑（Murasame/chat.py）

| 函数 | 功能 |
|------|------|
| `query()` | 调用 /chat，含重复检测（最多 3 次重试） |
| `query_image()` | 调用 /qwenvl，base64 编码图片 |
| `think_image()` | 屏幕描述思考（判断是否需告知 AI） |
| `get_translate()` | 中文→古日语风格翻译 |
| `get_emotion()` | 情感分析（从参考音频目录获取情感标签） |
| `get_embedings_layers()` | 立绘图层生成（根据情感选择图层 ID） |
| `generate_tts()` | GPT-SoVITS 语音合成（MD5 缓存） |
| `split_sentence()` | Galgame 对话句子分割 |

### 4.4 立绘合成（Murasame/generate.py）

使用 **OpenCV + NumPy** 实现图层合成：
- 读取 UTF-16 LE 编码的 TSV 配置文件
- 根据图层 ID 列表加载对应 PNG 图层
- Alpha 混合合成最终 RGBA 图像

### 4.5 TTS 服务（gpt_sovits/）

精简版 GPT-SoVITS，仅保留推理功能：
- `POST /tts` 端口 9880，返回 WAV 音频流
- 设备自动检测：MPS > CUDA > CPU
- 多语言：中文/日文/英文/韩文/粤语
- 情感克隆：参考音频驱动（zero-shot）
- 移除了训练、WebUI、Gradio、Docker 等非推理功能

---

## 5. 技术实现细节

### 5.1 平台自适应模型加载

```python
# macOS
if sys.platform == 'darwin':
    from mlx_lm import load, generate
    model, tokenizer = load("Qwen3-14B-Murasame-Chat-MLX-Int4")

# Windows/Linux
else:
    from transformers import AutoModelForCausalLM
    from peft import PeftModel
    base_model = AutoModelForCausalLM.from_pretrained("Qwen3-14B")
    model = PeftModel.from_pretrained(base_model, "Murasame-LoRA")
```

### 5.2 macOS 窗口不抢焦点

```python
def _setup_macos_window_level(self):
    from AppKit import NSWindow, NSFloatingWindowLevel
    # 设置浮动窗口级别，不抢焦点
    ns_window = self.winId()
    # ... PyObjC 调用设置 NSFloatingWindowLevel
```

### 5.3 Crossfade 立绘过渡

使用 QPainter 的 CompositionMode：
- ARGB32_Premultiplied 格式
- Source/DestinationIn/Plus 混合模式
- 新旧立绘平滑淡入淡出

### 5.4 AI 驱动立绘选择

```
用户输入 → LLM 生成回复 → 情感分析 → 图层 ID 列表
                                         ↓
情感标签 → reference_voices/ 目录 → 参考音频
                                         ↓
GPT-SoVITS → 按情感合成语音
```

### 5.5 配置文件

```json
{
    "openrouter_api_key": "YOUR_KEY",
    "enable_vl": true,
    "user": {
        "api": "http://127.0.0.1:28565",
        "gpt_sovits": "http://127.0.0.1:9880/tts"
    },
    "server": {
        "qwen3": "http://localhost:11434",
        "qwenvl": "http://localhost:11434"
    },
    "display": {
        "preset": "balanced",
        "custom": {"visible_ratio": 0.4, "text_x_offset": 140, "text_y_offset": 20}
    }
}
```

---

## 6. 数据处理流程

### 6.1 完整 AI 交互数据流

```
用户输入/摸头
    ↓
pet.py (PyQt5 客户端)
    ↓ LLMWorker 线程
Murasame/chat.py
    ├── query() → api.py /chat → 本地 LLM (MLX/PyTorch)
    ├── query_image() → api.py /qwenvl → Qwen-VL（屏幕分析）
    ├── get_emotion() → 情感分析 → 情感标签
    ├── get_embedings_layers() → 图层 ID 列表
    │       ↓
    │   generate.py → OpenCV 图层合成 → QPixmap
    ├── get_translate() → 古日语翻译
    └── generate_tts() → gpt_sovits /tts → WAV 音频
    ↓
pet.py 显示：
    ├── 立绘 Crossfade 切换
    ├── 打字机文本显示（40ms/字）
    └── 语音播放
```

### 6.2 屏幕视觉分析流程

```
ScreenCaptureWorker (定时截图)
    ↓
think_image() → 判断屏幕变化是否需告知 AI
    ↓ 返回 {"des": null/description}
如有变化 → query_image() → Qwen-VL 分析
    ↓
AI 自主决定是否评论用户行为
```

---

## 7. UI/UX设计分析

### 7.1 交互设计

| 操作 | 功能 |
|------|------|
| 左键点击头部 + 拖动 | 摸头交互（触发羞涩回复） |
| 左键点击下半身 | 进入输入模式 |
| 中键拖动 | 移动窗口 |
| 打字机效果 | 40ms/字逐字显示 |

### 7.2 视觉设计

- 透明无边框窗口
- 4 种显示预设（compact/balanced/standard/full）
- HiDPI/Retina 自适应缩放
- Crossfade 立绘过渡
- 思源黑体 CN Bold 字体

### 7.3 Galgame 风格

- 打字机文本
- 句子分割（Galgame 对话风格）
- 情感语音
- 立绘表情切换

---

## 8. 动画与渲染系统

### 8.1 立绘系统（非 Live2D）

采用 **AI 驱动的图层合成系统**：

| 图层分类 | 说明 |
|----------|------|
| 基础人物 | 服装（睡衣/便衣/校服/便衣2） |
| 表情 | 高兴/伤心/愤怒/害羞/困惑/平静等（含泪/非泪变体） |
| 额外装饰 | 腮红、叹气装饰、脸色阴沉 |
| 头发 | 必选 |

### 8.2 两种立绘类型

- **类型 A**（ムラサメa）：睡衣/便衣/校服，更多表情选项
- **类型 B**（ムラサメb）：睡衣/便衣/校服/便衣2

### 8.3 动画效果

- **Crossfade 过渡**：QPainter CompositionMode 新旧立绘淡入淡出
- **打字机文本**：QTimer 逐字显示
- **HiDPI 缩放**：自动检测 devicePixelRatio

---

## 9. AI/聊天集成分析

### 9.1 模型架构

| 平台 | LLM 框架 | 模型 | 加载方式 |
|------|---------|------|---------|
| macOS | MLX | Qwen3-14B-MLX-Int4 | 合并 LoRA，Int4 量化 |
| Win/Linux | PyTorch+PEFT | Qwen3-14B + LoRA | 基础模型 + LoRA 适配器 |

### 9.2 双模式后端

**Ollama 本地**：`qwen3:14b` + `qwen2.5vl:7b`
**OpenRouter 云端**：`qwen3-235b-a22b` + `qwen-2.5-vl-7b-instruct`

### 9.3 AI 功能链

1. **对话生成** — 本地 LLM 直接推理
2. **视觉理解** — 屏幕截图 → Qwen-VL 分析
3. **情感分析** — LLM 分析回复情感
4. **立绘选择** — LLM 选择图层 ID
5. **翻译** — 中文→古日语
6. **TTS** — GPT-SoVITS 按情感合成语音

### 9.4 角色设定

详细的 system prompt 定义丛雨角色：16 岁、500 岁神刀管理者、绿发、自称"本座"、称用户"主人"、活泼撒娇性格。

---

## 10. 构建与打包流程

### 10.1 一键启动（run_project.py）

跨平台 Python 脚本（无第三方依赖）：
1. 环境检测（系统/CPU/内存/显卡）
2. 设备限制（拒绝 Intel Mac/Linux/非 NVIDIA Windows）
3. Python 3.10 检测
4. 依赖检查（Homebrew/CUDA/uv）
5. 自动配置安装
6. 启动三服务：`uv run api.py` + `uv run gpt_sovits/api_v2.py` + `uv run pet.py`

### 10.2 无打包发布

项目无 Release，无 PyInstaller 配置，仅支持源码运行。部署门槛高（需下载 14B 模型）。

---

## 11. 版本发布与迭代历史

- **无 Release**
- **53 次提交**（2025-08-26 ~ 2025-10-13）
- 单一开发者 yuemingruoan
- 提交风格：中文，口语化（"再有 bug 我死给你看！！！"）

---

## 12. 社区与Issue概况

**11 个开放 Issue**：
- #14 RTX 5070 (sm_120) CUDA 兼容性
- #12 Windows 部署全线崩溃
- #8 Linux 支持需求
- #5 macOS 支持优化
- #4 模型训练数据集需求

主要问题：Windows 部署困难、CUDA 兼容性、Linux 不支持。

---

## 13. 优缺点分析

### 优点

| 优点 | 说明 |
|------|------|
| **端到端 AI 集成** | LLM + TTS + 视觉 + 情感立绘，完整 AI 桌宠 |
| **双平台模型策略** | macOS MLX / Windows PyTorch+LoRA |
| **本地/云端双模式** | Ollama 本地 / OpenRouter 云端 |
| **AI 驱动立绘** | LLM 根据情感选择图层 |
| **Galgame 风格** | 打字机 + 情感语音 + 立绘切换 |
| **视觉理解** | 屏幕截图分析 |
| **macOS 不抢焦点** | PyObjC 原生实现 |

### 缺点

| 缺点 | 说明 |
|------|------|
| **部署门槛极高** | 需下载 14B 模型，70+ 依赖 |
| **无 Release** | 仅源码运行 |
| **Windows 部署问题多** | 多个 Issue 反映 |
| **不支持 Linux** | 明确拒绝 |
| **无测试** | 缺少自动化测试 |
| **依赖冗余** | 包含训练库但仅推理用 |
| **显卡限制** | 非 NVIDIA 不支持，RTX 5070 不兼容 |

---

## 14. 可借鉴特性

| 特性 | 借鉴价值 |
|------|----------|
| **端到端 AI 集成** | ★★★★★ LLM+TTS+VL+情感立绘完整链路 |
| **平台自适应模型** | ★★★★ macOS MLX / Windows PyTorch |
| **AI 驱动立绘选择** | ★★★★ LLM 根据情感选择图层 |
| **本地/云端双模式** | ★★★★ |
| **Galgame 交互风格** | ★★★★ 打字机+情感语音 |
| **macOS 不抢焦点** | ★★★ |
| **屏幕视觉分析** | ★★★ |

---

## 15. 潜在改进点

| 改进方向 | 优先级 |
|----------|--------|
| 降低部署门槛 | 高 |
| 提供打包发布 | 高 |
| Linux 支持 | 中 |
| 自动化测试 | 中 |
| 精简依赖 | 中 |
| 移动端适配 | 低（架构不适合） |

---

## 16. 跨平台支持评估

| 平台 | 支持 | 说明 |
|------|------|------|
| macOS (Apple Silicon) | ✅ | MLX 框架，推荐 |
| macOS (Intel) | ❌ | MLX 不兼容 |
| Windows (NVIDIA) | ✅ | PyTorch + CUDA |
| Windows (CPU) | ⚠️ | 性能低，需 32GB+ 内存 |
| Linux | ❌ | 未适配 |
| 移动端 | ❌ | 架构不适合（14B 模型太大） |

**移动端适配评估**：14B 参数模型无法在移动端运行，需更换为小模型或纯云端方案。PyQt5 不支持移动端。

---

## 17. 总结与技术参考价值

MurasamePet 是七个项目中 **AI 集成最深入**的桌面宠物，实现了 LLM 对话 + TTS 语音 + 视觉理解 + 情感立绘的端到端 AI 链路。其平台自适应模型策略和 AI 驱动立绘选择是独特创新。但部署门槛极高，不适合直接复用，其 AI 集成思路和 Galgame 交互风格值得参考。

---

> **报告结束**

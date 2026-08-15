# Super Agent Party 源码级分析报告

> **注：本报告基于 GitHub 在线源码分析，未本地克隆仓库（网络不稳定导致克隆失败）。**
>
> 分析对象：[heshengtao/super-agent-party](https://github.com/heshengtao/super-agent-party)（main 分支，截至 2026-07-04 最新提交 `65efb27`）
>
> ⚠️ **License：AGPL-3.0** —— 强 copyleft 许可证。**仅作学习参考，商用需授权**。任何基于本项目代码的衍生作品必须同样以 AGPL-3.0 开源，且网络服务（SaaS）场景也需履行开源义务。

---

## 一、项目概览

| 维度 | 信息 |
|---|---|
| 仓库 | `heshengtao/super-agent-party` |
| 许可证 | **AGPL-3.0**（强传染性开源协议，商用需谨慎） |
| Stars | 约 2.4k（TrendShift 收录） |
| 当前版本 | `v0.4.2`（package.json 中标注 `v0.4.2`，发布物含 Win/Mac/Linux 三端） |
| 主语言 | Python（FastAPI 后端）+ JavaScript/Electron（桌面壳与 VRM 渲染前端） |
| 提交数 | 6,078 commits（截至分析时） |
| 一句话定位 | **首个开源的、基于「快慢双脑（Fast & Slow Brain）」架构的 3D 数字生命体**——既能像朋友一样共情（System 1），又能像资深工程师一样自主执行（System 2） |

项目自我定义为「AI desktop companion with endless possibilities」（具备无限可能的 AI 桌面伴侣）。其核心差异点在于：不强迫用户在「能聊天的虚拟形象」和「能干活的命令行 Agent」之间二选一，而是通过双系统架构将两者融合为同一数字生命体。她可以驻留桌面提供即时情绪支持，也可在后台自主完成爬虫、写代码、直播、控制电脑等复杂任务。

**核心特性速览：**
- 桌面伴侣：自定义 VRM 模型、动作、3D 场景，兼容 Live2D 扩展
- Link VTS：控制 VTube Studio 中的 Live2D 模型
- 高自由度聊天界面：自定义背景、表情包、角色人设、THA 二次元头像
- 任务中心：后台执行高级任务，自动控制电脑，支持 MCP 与 Agent Skills
- 电脑控制：桌面视觉 + 鼠标/键盘/终端工具链（演示：AI 玩 Wordle）
- 多窗口模式：手机尺寸/胶囊尺寸停靠桌面
- 多角色群聊：支持 SillyTavern 角色卡 + 长期记忆
- IM 机器人：一键部署到 QQ/微信/飞书/钉钉/Telegram/Discord/Slack
- 直播机器人：一键部署到 B 站/YouTube/Twitch，支持 360° 全景直播
- AI 浏览器：Agent 自带可自动控制的浏览器
- 扩展系统：可安装/创建扩展（Galgame、塔罗、IDE、PPT、Drawio 等）
- 开发者友好：开放 OpenAI 兼容 API 与 MCP 接口

---

## 二、核心技术栈

Super Agent Party 是一个**双语言混合架构**项目，并非纯 JS 实现：

### 2.1 后端（Python / FastAPI）
- **FastAPI** —— 异步 Web 框架，`server.py` 为入口，对外暴露 OpenAI 兼容接口与 MCP 接口
- **LangChain 生态** —— `langchain_community`（FAISS 向量库、BM25Retriever）、`langchain_classic`（EnsembleRetriever）、`langchain_text_splitters`（文档分块），用于 RAG 知识库
- **ONNX Runtime** —— 本地嵌入推理（MiniLM），支持 DirectML（Win）、CoreML（Mac M 芯片）、CUDA（N 卡）、CPU 多级回退
- **Pydantic** —— 数据模型与配置校验（TaskCenter、BehaviorEngine 全部基于 BaseModel）
- **httpx / aiohttp / aiofiles** —— 全异步 I/O，避免阻塞事件循环
- **MCP Python SDK** —— `mcp.ClientSession`，支持 stdio/SSE/websocket/streamable HTTP 四种传输
- **uv** —— Python 依赖管理（`pyproject.toml` + `uv.lock`，官方强制使用 `uv sync`）

### 2.2 前端 / 桌面壳（JavaScript / Electron）
- **Electron 39** + **electron-builder 24** —— 跨平台桌面打包（Win NSIS / Mac dmg / Linux AppImage）
- **Three.js + VRM** —— 浏览器端 3D 虚拟形象渲染（VRM 标准模型）
- **OSC 协议**（`osc` npm 包）—— VMC 双向协议，可将数据流推送至 OBS / VTube Studio
- **acpx** —— 电脑控制能力（npm 依赖 `acpx ^0.6.0`，配合 `py/acpx_tools.py`）
- **electron-updater** —— 自动更新
- **chokidar** —— 文件监听（热重载/资源同步）

### 2.3 部署与生态
- **多平台部署**：桌面安装包、便携集成包（免安装源码版）、Docker、Docker Compose（带网关鉴权）
- **本地化能力**：可接入 Ollama 等本地推理引擎，所有数据存本地（`./super-agent-data`）
- **多模型适配**：`ClaudeAsOpenAI.py`、`GeminiAsOpenAI.py`、`dify_openai.py` 将各家 API 归一为 OpenAI 格式

### 2.4 硬件要求
CPU 2 核+、内存 2GB+，因为模型全部可选（本地或云端），2 核 2G 云服务器可跑 Docker 版。

---

## 三、项目架构与目录结构

### 3.1 顶层目录

```
super-agent-party/
├── server.py            # FastAPI 主入口（后端服务，端口默认 3456）
├── main.js               # Electron 主进程入口
├── start.js              # 启动脚本
├── package.json          # Electron 配置 + 构建配置（AGPL-3.0）
├── pyproject.toml        # Python 依赖（uv 管理）
├── Dockerfile / docker-compose.yml
├── py/                   # ★ Python 后端核心代码（扁平结构！）
├── config/               # 默认配置（日记系统等）
├── vrm/                  # VRM 模型资源
├── tha_models/Lyra/      # THA 二次元头像模型（含 ONNX/CoreML）
├── skills/               # Agent Skills（如 sap-extension-creator）
├── scripts/              # computer_use 辅助脚本
├── static/               # 前端静态资源（preload、icon 等）
├── doc/image/            # 文档图片
├── tiktoken_cache/       # tiktoken 离线缓存
└── README_*.md           # 10 种语言 README
```

### 3.2 `py/` 目录结构（重要发现：扁平结构）

**关键发现**：项目实际采用**扁平的 `py/` 目录**，而非任务描述中推测的 `py/agent/`、`py/mcp/`、`py/tasks/` 子目录分层。所有 Python 模块直接平铺在 `py/` 下，按功能用文件名前缀/后缀区分（如 `*_bot_manager.py` 表示平台机器人、`diary_*.py` 表示日记系统）。这种扁平结构在模块数超过 60 个时已显臃肿，但降低了跨模块导入复杂度。

按功能归类，`py/` 下约 60 个 Python 文件可划分为 9 个功能域：

| 功能域 | 代表文件 | 说明 |
|---|---|---|
| **Agent 核心（双脑）** | `agent.py`、`sub_agent.py`、`agent_tool.py` | System 2 慢脑执行器、项目级工具权限 |
| **行为引擎** | `behavior_engine.py`、`autoBehavior.py` | 自主行为调度（time/noInput/cycle 三触发） |
| **任务中心** | `task_center.py`、`scheduler.py`、`task_tools.py` | 任务 CRUD、定时/周期调度、子任务拆分 |
| **MCP 集成** | `mcp_clients.py` | MCP 客户端（4 种传输、自动重连） |
| **知识库 / RAG** | `know_base.py`、`ebd_api.py`、`ebd_model_manager.py`、`minilm_router.py` | LangChain 混合检索、嵌入服务 |
| **电脑控制** | `computer_use_tool.py`(31KB)、`acpx_tools.py`(23KB)、`cdp_tool.py`(23KB)、`local_app_control.py`(45KB)、`ui_tree_helper.py` | 桌面视觉+键鼠终端、CDP 浏览器控制 |
| **多平台机器人** | `qq_bot_manager.py`、`wechat_bot_manager.py`、`feishu_bot_manager.py`(34KB)、`dingtalk_bot_manager.py`、`discord_bot_manager.py`、`slack_bot_manager.py`、`telegram_bot_manager.py`、`telegram_client.py`、`wecom_bot_manager.py` | 7 大 IM 平台接入 |
| **直播** | `live_router.py`(19KB)、`twitch_service.py`、`blivedm/`(目录)、`ytdm.py` | B 站/YouTube/Twitch 弹幕与直播 |
| **VRM/形象/语音** | `tha_engine.py`(30KB)、`vts_manager.py`、`moss_tts.py`、`sherpa_asr.py`、`dynamic_island.py` | THA 头像、VTS、TTS/ASR |
| **LLM 适配** | `ClaudeAsOpenAI.py`、`GeminiAsOpenAI.py`、`dify_openai.py`、`llm_tool.py` | 多家 API 归一为 OpenAI 格式 |
| **日记系统** | `diary_engine.py`(24KB)、`diary_system.py`、`diary_api.py`、`diary_chat_integration.py`、`diary_query_tool.py` | 日记生成、对话集成、查询 |
| **好感度/情感** | `affection_system.py`、`affection_api.py` | 好感度数值提取与持久化 |
| **文件/工具** | `load_files.py`(28KB)、`web_search.py`(45KB)、`code_interpreter.py`、`comfyui_tool.py`、`pollinations.py`、`image_host.py`、`shortcut_commands.py` | 文档解析、网页搜索、代码沙箱、画图 |
| **基础设施** | `get_setting.py`(25KB)、`guard.py`、`sleep_guard.py`、`ws_manager.py`、`mode_change.py`、`extensions.py`(23KB)、`skills.py`(24KB)、`node_runner.py`、`custom_http.py`、`docker_api.py` | 配置、守卫、WebSocket、扩展、技能 |

### 3.3 前端与桌面壳
- `main.js` —— Electron 主进程，管理窗口（手机尺寸/胶囊尺寸/独立窗口/侧边栏）
- `static/js/preload.js`、`webview-preload.js`、`shotPreload.js` —— 预加载脚本
- `static/skeleton.html`、`shotOverlay.html` —— 骨架屏与截图覆盖层
- VRM 渲染逻辑位于打包后的前端 dist（Three.js + VRM SDK）

---

## 四、核心功能模块详解

### 4.1 Fast & Slow Brain 双脑架构（核心创新）

这是 Super Agent Party 最具辨识度的设计，灵感来自卡尼曼《思考，快与慢》的双系统理论，以及 Google DeepMind 提出的 Talker-Reasoner 架构：

- **System 1（快脑 / 情感陪伴）**：面向日常对话，追求低延迟、高共情。由主聊天端点（`server.py` 的 `/v1/chat/completions` 与 `/simple_chat`）承担，使用常规模型快速响应，支持语音交互、VRM 动作表情、长期记忆检索。它「始终在线」，类似人类 System 1 自动激活。

- **System 2（慢脑 / 自主执行）**：面向复杂任务，追求多步推理与工具调用。由 `py/sub_agent.py` 的 `SubAgentExecutor` 承担，使用 `super-model`（可配置为更强的推理模型）进行迭代式任务执行（默认 `max_iterations=100`），通过调用 `finish_task` 工具结束，过程中可流式输出工具调用过程。

- **语义路由器**：`py/minilm_router.py` 提供本地 MiniLM（`paraphrase-multilingual-MiniLM-L12-v2`）ONNX 嵌入服务，用于意图语义判别，决定是否将请求路由到慢脑。它具备智能多系统多显卡 Provider 排队机制（DirectML/CoreML/CUDA/CPU 自动回退），保证在任何硬件环境下都不报错。

README 自述：「We built the first open-source 3D digital lifeform powered by a System 1 & System 2 (Fast & Slow Brain) architecture. Empathizes like a friend. Executes like a senior dev.」

### 4.2 长期记忆 / 知识库（RAG）

`py/know_base.py` 实现了基于 RAG 的知识库系统（区别于 SpiritPal 的四阶段对话记忆）：

- **混合检索**：`EnsembleRetriever` 融合 `BM25Retriever`（关键词）与 `FAISS` 向量检索，权重可配（`weight` 字段，默认 0.5）
- **文档分块**：`RecursiveCharacterTextSplitter`，分隔符针对中文优化（`。！？`）
- **嵌入服务**：`MyOpenAICompatibleEmbeddings` 调用 OpenAI 兼容 `/embeddings` 接口（可指向本地 minilm 服务或云端）
- **Reranking**：支持 Jina 与 Vllm 两种重排方案（`rerank_knowledge_base`）
- **持久化**：FAISS 索引与 BM25 索引保存到 `KB_DIR/{kb_id}/`
- **容错**：BM25 构建失败时仅告警不中断，查询时若 BM25 缺失则用向量检索器顶替

> 注意：SAP 的「长期记忆」更准确的定位是**文档知识库 RAG**，而非对话级长期记忆。对话上下文与好感度等状态由其他模块（`affection_system.py`、日记系统）承担。

### 4.3 SillyTavern 角色卡

README 明确「Supports tavern character cards and long-term memory, allowing you to chat with multiple characters simultaneously」。角色卡采用 SillyTavern 社区标准格式（含 persona、description、first_mes、mes_example 等字段），支持多角色群聊。角色卡解析与加载主要通过前端配置与 `py/get_setting.py`（25KB，配置中枢）完成。

### 4.4 MCP 集成

`py/mcp_clients.py` 实现完整的 MCP 客户端：

- **四种传输**：`stdio_client`（本地进程）、`sse_client`（SSE）、`websocket_client`（WS）、`streamablehttp_client`（流式 HTTP）
- **工具转 OpenAI 格式**：`get_openai_functions()` 将 MCP 工具列表转为 OpenAI function-calling schema，可直接注入 LLM
- **自动重连**：`_connection_monitor` 协程持续管理 AsyncExitStack，断线后 5 秒重试，30 秒心跳 ping
- **失败回调**：支持 `on_failure_callback` 通知上层
- **SSE 首包校验**：3 秒超时检测 SSE 是否立即关闭，防止配置错误

### 4.5 任务中心

由 `task_center.py` + `scheduler.py` + `sub_agent.py` 三者协同：

- **数据模型**（Pydantic）：`SubTask` 含 `task_type`（once/scheduled/recurring）、`platforms`（多渠道推送目标）、`context`（历史/结果/下次运行时间）、`progress`（0-100）、`status`（pending/running/completed/failed/cancelled）
- **持久化**：文件型，`.agents/tasks/{task_id}.json`，`aiofiles` 异步读写
- **调度器**：`AgentScheduler` 每 30 秒轮询一次，匹配定时（time）与周期（cycle）触发条件，避免同分钟重复触发
- **执行器**：`SubAgentExecutor.execute_subtask` 迭代调用 super-model，流式更新进度，完成后通过 `behavior_engine` 向多平台推送结果
- **子任务**：支持 `parent_task_id` 层级，`agent_type` 区分执行器类型

### 4.6 电脑控制

- `computer_use_tool.py`（31KB）—— 桌面视觉 + 鼠标键盘终端工具链
- `acpx_tools.py`（23KB）—— 基于 acpx 的控制（npm 端 `acpx` 与 Python 端协作）
- `cdp_tool.py`（23KB）—— Chrome DevTools Protocol，控制 AI 自带浏览器
- `local_app_control.py`（45KB，全项目最大单文件）—— 本地应用控制
- `ui_tree_helper.py` —— UI 树解析辅助

README 演示场景：AI 自主玩 Wordle 游戏。

### 4.7 多平台消息路由

`py/behavior_engine.py` 的 `BehaviorEngine`（单例 `global_behavior_engine`）是统一分发中枢：

- 平台通过 `register_handler(platform, handler)` 注册回调
- 三种触发：`time`（定时）、`noInput`（无输入延迟）、`cycle`（周期）
- `platform_targets` 维护各平台 ChatID 列表，`platform_activity` 记录活跃时间用于无输入触发
- 任务完成后，`sub_agent.py:_finalize_task_record` 构造 `BehaviorItem` 并通过 handler 推送到 chat/wechat/feishu 等平台

### 4.8 VRM 3D 模型渲染

- 前端基于 **Three.js + VRM SDK** 渲染 VRM 标准 3D 模型
- `osc` npm 依赖实现 VMC 协议双向流，可推流至 OBS / VTube Studio
- `py/vts_manager.py` 控制 VTube Studio 中的 Live2D 模型
- `py/tha_engine.py`（30KB）—— THA 二次元头像引擎（`tha_models/Lyra/` 含 ONNX 与 CoreML 模型）
- 兼容 Live2D 扩展（独立仓库 `sap-live2d`）

### 4.9 好感度与情感系统

`py/affection_system.py` 从 AI 回复中用正则提取 `<user=xxx love=xxx familiarity=xxx>` 标签，更新到 `affection_data.json`，实现可量化的情感状态跟踪。

### 4.10 日记系统

`diary_*.py` 系列文件实现日记引擎，是 SAP 长期上下文的另一补充机制：

- `diary_engine.py`（24KB）—— 日记生成核心，最近一次大更新（2026-06-23 commit `83d5697`）增加了「浏览器/智能家居主动事件、对话集成、聊天总结」能力
- `diary_system.py`（11KB）—— 日记生命周期管理
- `diary_api.py`（3KB）—— FastAPI 端点
- `diary_chat_integration.py`（4KB）—— 将日记内容注入对话上下文
- `diary_query_tool.py`（3.5KB）—— 作为工具供 Agent 查询历史日记

日记系统与好感度系统、知识库三者协同：日记记录「发生了什么」，好感度记录「情感如何变化」，知识库提供「事实性知识」，共同构成 SAP 的长期状态层。

### 4.11 扩展系统与 Agent Skills

SAP 具备完整的扩展生态，是其「无限可能」定位的支撑：

- **扩展系统**（`py/extensions.py`，23KB）：支持安装/创建扩展，所有扩展可独立窗口或侧边栏打开。官方已收录 16+ 扩展（Galgame、塔罗、IDE、PPT、Drawio、Mermaid、RSS、AI Editor、Live2D、Code Server、CLI、LX-music、Remote、Web Preview、Story Adventure、Lyra 角色包）。
- **Agent Skills**（`py/skills.py`，24KB + 仓库根 `skills/` 目录）：技能框架，其中 `sap-extension-creator` 技能可创建新 SAP 扩展，实现**生态自举**——用 Agent 制造 Agent 的扩展。
- **A2A 协议**（`py/a2a_tool.py`）：Agent-to-Agent 工具，支持多 Agent 协作。
- **Node Runner**（`py/node_runner.py`）：在 Python 后端中执行 Node.js 代码，桥接双语言生态。

### 4.12 语音与多模态

- **TTS**：`py/moss_tts.py`（10KB）—— Moss TTS 语音合成，`py/moss_model_manager.py` 管理模型
- **ASR**：`py/sherpa_asr.py`（4KB）+ `py/sherpa_model_manager.py`（10KB）—— Sherpa 语音识别
- **图像生成**：`py/comfyui_tool.py`（8KB，ComfyUI 集成）、`py/pollinations.py`（11KB，Pollinations API）
- **图像托管**：`py/image_host.py`（3.5KB）
- **代码沙箱**：`py/code_interpreter.py`（3KB）

---

## 五、技术实现细节

本节以 `文件:函数/类` 形式给出关键实现引用，便于源码定位。

### 5.1 Fast & Slow Brain 双脑实现

- **System 2 慢脑迭代循环**：`py/sub_agent.py:SubAgentExecutor.execute_subtask`
  - 通过 `self.chat_endpoint = f"{base_url}/v1/chat/completions"` 调用 super-model
  - `max_iterations` 默认 100（来自 `settings.CLISettings`）
  - 每轮追加「请审视任务是否完成？如果已完成，请调用 finish_task 工具」的 user 消息
  - 流式解析 `data:` 行，区分 `content`、`tool_calls`、`tool_content`（含 `tool_result_stream`/`tool_result`/`error` 子类型）

- **System 2 系统提示构造**：`py/sub_agent.py:SubAgentExecutor._build_system_prompt`
  - 强制要求「必须调用 finish_task 工具并提供最终产出结果来结束任务」
  - 支持注入 `consensus_content`（共识规范）

- **语义路由嵌入服务**：`py/minilm_router.py:MiniLMOnnxPredictor`
  - 模型 `paraphrase-multilingual-MiniLM-L12-v2`，ONNX 格式
  - `_lazy_load_deps()` 延迟加载 onnxruntime/transformers/numpy
  - Provider 优先级：DirectML（Win）→ CoreML（Mac）→ CUDA → CPU
  - `MiniLMPool` 线程安全池管理，`/minilm/embeddings` FastAPI 端点

- **项目级工具权限**：`py/agent.py`
  - `is_tool_allowed_by_project_config` 检查 `.party/config.json` 的 `allowed_tools`
  - `add_tool_to_project_config` 写入允许列表（Windows 上隐藏 `.party` 文件夹）

### 5.2 长期记忆 / 知识库持久化

- **混合检索**：`py/know_base.py:query_vector_store`
  - `EnsembleRetriever(retrievers=[bm25, vector], weights=[1-weight, weight])`
  - `asyncio.to_thread(ensemble_retriever.invoke, query)` 避免阻塞

- **嵌入异步化**：`py/know_base.py:MyOpenAICompatibleEmbeddings`
  - `_aembed` 用 `httpx.AsyncClient` 非阻塞请求
  - 暴露 `aembed_query`/`aembed_documents` 给 LangChain 异步链路

- **双索引构建**：`py/know_base.py:build_vector_store`
  - BM25 索引存 `bm25_index.json`（容错，失败仅告警）
  - FAISS 向量库分批（batch_size=20）构建，存 `index` 目录

- **Reranking**：`py/know_base.py:rerank_knowledge_base`，支持 `jina` 与 `Vllm` 两种 vendor

### 5.3 角色卡加载

- 角色卡为 SillyTavern 标准 JSON 格式（含 persona/description/first_mes 等）
- 通过前端 UI 配置，由 `py/get_setting.py:load_settings` 统一加载（该文件 25KB，是配置中枢）
- 多角色群聊时各角色卡独立维护上下文与长期记忆

### 5.4 MCP 工具调用

- **连接管理**：`py/mcp_clients.py:ConnectionManager.connect`
  - `AsyncExitStack` 统一管理传输层与会话生命周期
  - stdio 走 `StdioServerParameters`，其余按 `type` 字段选择 client
  - SSE 首包校验：`anyio.move_on_after(3)` 非阻塞读 1 条消息

- **OpenAI 格式转换**：`py/mcp_clients.py:McpClient.get_openai_functions`
  - 将 MCP `inputSchema` 直接作为 OpenAI function 的 `parameters`
  - 支持 `disable_tools` 黑名单

- **自动重连**：`py/mcp_clients.py:McpClient._connection_monitor`
  - 30 秒 `send_ping` 心跳，断线后 `await asyncio.sleep(5)` 重试
  - 失败时调用 `_on_failure_callback`

### 5.5 任务调度

- **轮询调度**：`py/scheduler.py:AgentScheduler.start_loop` —— 每 30 秒扫描
- **定时匹配**：`py/scheduler.py:AgentScheduler._scan_and_trigger`
  - `time` 类型：`HH:mm` 匹配 + 星期匹配（前端 Sunday=0）
  - `cycle` 类型：比较 `next_run_at` 与当前时间
- **周期任务下次时间**：`py/sub_agent.py:SubAgentExecutor._finalize_task_record`
  - 根据 `cycleValue`（`HH:mm:ss`）计算 `timedelta`
  - `isInfiniteLoop` 或 `ran_count < repeatNumber` 时回到 PENDING

### 5.6 VRM 渲染与多平台消息路由

- **VRM 渲染**：前端 Three.js + VRM SDK（dist 打包产物），`osc` npm 包实现 VMC 协议双向流
- **VTS 控制**：`py/vts_manager.py`（10KB）控制 VTube Studio Live2D
- **THA 头像**：`py/tha_engine.py`（30KB），模型位于 `tha_models/Lyra/`
- **行为分发**：`py/behavior_engine.py:BehaviorEngine._tick`
  - 每秒检查一次，`register_handler` 注册各平台回调
  - 无输入触发用 `timers` 防抖，定时触发用 65 秒去重窗口
  - `platforms` 字段支持多选，`"all"` 表示全平台

### 5.7 多平台机器人

各平台独立 `*_bot_manager.py`，均通过 `behavior_engine.register_handler` 注册：
- `feishu_bot_manager.py`（34KB，最复杂）、`qq_bot_manager.py`（28KB）、`wechat_bot_manager.py`（21KB）
- `discord_bot_manager.py`（20KB）、`wecom_bot_manager.py`（19KB）、`dingtalk_bot_manager.py`（17KB）
- `slack_bot_manager.py`（16KB）、`telegram_bot_manager.py`（5KB）+ `telegram_client.py`（18KB）
- 直播弹幕：`blivedm/`（B 站）、`ytdm.py`（YouTube）、`twitch_service.py`

### 5.8 LLM 多供应商适配

- `ClaudeAsOpenAI.py`、`GeminiAsOpenAI.py`、`dify_openai.py` 将各家 API 包装为 OpenAI 兼容格式
- `llm_tool.py`（8KB）统一工具调用入口
- `server.py` 暴露 OpenAI 兼容端点，实时流式输出，开发者可外部接入

---

## 六、可借鉴特性

| 特性 | 借鉴价值 | 备注 |
|---|---|---|
| **Fast & Slow Brain 双脑架构** | ⭐⭐⭐⭐⭐ | 核心创新。将「陪伴」与「执行」解耦，用语义路由分流，兼顾低延迟与强推理 |
| **MCP 标准集成** | ⭐⭐⭐⭐⭐ | 四传输 + 自动重连 + OpenAI 格式转换，是工具生态的最佳实践 |
| **SillyTavern 角色卡格式** | ⭐⭐⭐⭐ | 社区标准，生态丰富，多角色群聊基础 |
| **RAG 混合检索（BM25+向量）** | ⭐⭐⭐⭐ | 比纯向量检索更稳，中文场景效果显著 |
| **任务中心（定时/周期/多平台推送）** | ⭐⭐⭐⭐ | 文件型持久化轻量，多渠道结果分发设计优雅 |
| **多平台机器人统一抽象** | ⭐⭐⭐⭐ | `register_handler` + `platform_targets` 抽象可复用 |
| **本地 ONNX 嵌入 + 多 GPU 回退** | ⭐⭐⭐⭐ | 隐私优先，硬件兼容性极佳 |
| **好感度数值化** | ⭐⭐⭐ | 从回复中正则提取情感状态，简单有效 |
| **日记系统** | ⭐⭐⭐ | 主动事件 + 对话集成，是长期上下文的补充 |
| **电脑控制工具链** | ⭐⭐⭐ | 视觉+键鼠+CDP，强大但安全风险高 |
| **VRM + OSC/VMC 推流** | ⭐⭐⭐ | VTuber 场景有价值，SpiritPal 桌面宠物可参考 |
| **扩展系统 + Agent Skills 自举** | ⭐⭐⭐ | 用 skill 创建扩展，实现生态自举 |

---

## 七、与 SpiritPal 的异同及移植建议

SpiritPal（Tauri v2 + React 19 + TypeScript + Rust）与 SAP（Electron + Python + Three.js）技术栈差异显著，但产品形态（桌面 AI 宠物）高度重叠。以下逐项给出移植评估。

### 7.1 架构层对比

| 维度 | Super Agent Party | SpiritPal |
|---|---|---|
| 桌面框架 | Electron 39（JS） | Tauri v2（Rust 后端 + React 前端） |
| 后端语言 | Python（FastAPI） | TypeScript（前端）+ Rust（Tauri 命令） |
| 形象渲染 | Three.js + VRM（3D）+ THA（2D） | Live2D / 图片（2D，更轻量） |
| 记忆系统 | RAG 文档知识库 + 日记 + 好感度 | 四阶段记忆（Working/Episodic/Semantic/Autobiographical）+ 6 触发机制 |
| 性格系统 | SillyTavern 角色卡（外部格式） | 五维性格引擎（warmth/liveliness/dependence/directness/rationality） |
| Agent 工具 | MCP + 自定义工具 + 电脑控制 | 7 个内置工具（open_application/search_web/reminder/schedule/weather/pet_state） |
| 双脑 | 显式 System1/System2 + 语义路由 | 隐式（LLM 优先 + 关键词回退） |
| 多平台 | 7 IM + 3 直播平台 | 无（纯桌面） |
| 部署 | 桌面 + Docker + Web | 桌面（Tauri 跨平台） |

### 7.2 逐项移植建议

| 特性 | 优先级 | 对应 SpiritPal 现状文件 | 移植难度 | 建议 Phase |
|---|---|---|---|---|
| **Fast & Slow Brain 双脑** | P0 | `src/lib/aiAgent.ts`（当前单脑） | 中 | Phase 2：引入语义路由，简单对话走快脑（小模型/规则），复杂任务走慢脑（强模型+迭代） |
| **MCP 客户端集成** | P0 | `src/lib/aiAgent.ts`（自定义工具） | 低 | Phase 1：用 `@modelcontextprotocol/sdk` 实现前端 MCP 客户端，复用现有 ToolDefinition 抽象 |
| **SillyTavern 角色卡导入** | P1 | `src/lib/personalityEngine.ts`（五维性格） | 低 | Phase 1：新增角色卡 JSON 解析器，与五维性格参数映射（角色卡 → Personality 配置） |
| **RAG 混合检索** | P1 | `src/lib/enhancedMemory.ts`（已有 vectorSearch + cosineSimilarity） | 中 | Phase 2：在向量检索基础上叠加 BM25（可用 `wink-bm25` 或 Rust 侧实现），权重可配 |
| **任务中心（定时/周期）** | P1 | `src/lib/scheduleManager.ts`（已有日程） | 中 | Phase 2：扩展 scheduleManager，增加 once/scheduled/recurring 类型 + 异步执行 + 进度跟踪 |
| **长期记忆持久化** | P1 | `src/lib/enhancedMemory.ts`（四阶段已具备） | 低 | Phase 1：SpiritPal 记忆架构更先进，仅需补全跨会话持久化（已用 Tauri db） |
| **多平台机器人** | P2 | 无 | 高 | Phase 3：抽象 `PlatformHandler` 接口，按需接入 QQ/Discord/Telegram（Rust 侧实现更高效） |
| **好感度数值化** | P2 | SpiritPal 有 petStore 状态系统 | 极低 | Phase 1：从 LLM 回复提取情感标签，写入 petStore（已有饱食度/心情等状态） |
| **电脑控制** | P2 | `src/lib/agentTools.ts:toolOpenApplication`（已有 shell 元字符校验） | 高 | Phase 3：扩展 Tauri 命令（Rust 侧），增加屏幕截图 + 鼠标键盘控制，需严格权限隔离 |
| **VRM 3D 渲染** | P2 | SpiritPal 为 2D | 高 | Phase 4：若需 3D 化，引入 `@pixiv/three-vrm`，但 Tauri 下 WebGL 性能需验证 |
| **日记系统** | P2 | 无 | 中 | Phase 3：每日自动总结对话，写入自传记忆层（与 enhancedMemory 的 Autobiographical 层对接） |
| **本地嵌入 + 多 GPU 回退** | P1 | `src/lib/vectorSearch.ts`（已有 embed） | 中 | Phase 2：Rust 侧用 `ort`（ONNX Runtime Rust）实现本地嵌入，支持 DirectML/CoreML |
| **扩展系统** | P2 | 无 | 高 | Phase 4：定义扩展 manifest，支持侧边栏/独立窗口加载 |

### 7.3 关键差异点深度对比

**1. 记忆系统**：SpiritPal 的四阶段记忆（`enhancedMemory.ts`）实际上**比 SAP 更先进**——SAP 的「长期记忆」本质是文档 RAG，而 SpiritPal 已实现对话级 Episodic/Semantic/Autobiographical 分层 + 6 种触发机制（频率/时间/相关性/情感/关键词/事件）+ 热温冷归档生命周期。**移植建议：保持 SpiritPal 记忆架构，仅借鉴 SAP 的 BM25 混合检索增强召回。**

**2. 性格系统**：SAP 用外部角色卡定义性格，SpiritPal 用五维参数（`personalityEngine.ts`）合成 System Prompt。**移植建议：保留五维引擎，新增角色卡导入作为五维参数的一种预设来源。**

**3. Agent 工具**：SAP 走 MCP 标准（生态开放），SpiritPal 走自定义 7 工具（`agentTools.ts`，含 shell 元字符校验，安全意识好）。**移植建议：引入 MCP 客户端，将现有工具包装为 MCP server，同时支持外部 MCP 工具调用。**

**4. 双脑**：SAP 显式分流，SpiritPal 当前是单脑（`aiAgent.ts` 的 LLM 优先 + 关键词回退）。**移植建议：Phase 2 引入 `minilm_router` 思路——用本地嵌入做意图分类，简单意图走快路径（规则/小模型），复杂意图走慢路径（强模型 + 工具迭代）。**

**5. 安全模型**：SAP 的 `load_files.py` 实现了完善的 SSRF 防护（`is_private_ip` 检测内网、`check_robots_txt` 合规、`sanitize_url` 清洗、代理 Fake-IP 放行）。SpiritPal 的 `agentTools.ts` 有 shell 元字符校验（`SHELL_METACHARS` 正则）。两者安全意识都到位，但侧重点不同——SAP 防网络层攻击，SpiritPal 防命令注入。**移植建议：引入电脑控制能力时，需同时补齐 SSRF 与命令注入两类防护。**

**6. 部署形态**：SAP 支持 Docker/Web/桌面三态，SpiritPal 仅桌面。SAP 的 Docker 版「桌面宠物只能通过浏览器查看」，且提供了 SAP-lite 轻量客户端将 Docker 变桌面应用。**移植建议：SpiritPal 的 Tauri 架构天然是桌面优先，若未来需服务化，可参考 SAP 的 Docker + lite client 分离模式。**

### 7.4 移植路线图（按 Phase 排列）

```
Phase 1（短期，低难度，夯实基础）
├── [P0] MCP 客户端集成（复用 ToolDefinition 抽象，引入 @modelcontextprotocol/sdk）
├── [P1] SillyTavern 角色卡导入（解析 JSON → 映射五维性格参数）
├── [P1] 长期记忆跨会话持久化（enhancedMemory 已具备，补全 Tauri db 持久层）
└── [P1] 好感度数值化（从 LLM 回复提取情感标签 → petStore 状态）

Phase 2（中期，中等难度，架构升级）
├── [P0] Fast & Slow Brain 双脑（语义路由 + 快慢路径分流）
├── [P1] RAG 混合检索（vectorSearch + BM25，权重可配）
├── [P1] 任务中心扩展（scheduleManager 增加 once/scheduled/recurring + 进度跟踪）
└── [P1] 本地嵌入 ONNX（Rust 侧 ort 库，DirectML/CoreML 回退）

Phase 3（长期，高难度，能力扩展）
├── [P2] 多平台机器人（抽象 PlatformHandler，按需接入 QQ/Discord/Telegram）
├── [P2] 电脑控制（Tauri 命令 + 屏幕截图 + 键鼠控制，严格权限隔离）
└── [P2] 日记系统（每日总结 → Autobiographical 记忆层）

Phase 4（远期，探索性）
├── [P2] VRM 3D 渲染（@pixiv/three-vrm，Tauri WebGL 性能验证）
└── [P2] 扩展系统（manifest 定义 + 侧边栏/独立窗口加载）
```

### 7.5 技术栈适配要点

将 SAP 的 Python 实现移植到 SpiritPal 的 TypeScript + Rust 技术栈时，需注意以下映射：

| SAP（Python） | SpiritPal（TS/Rust） | 适配要点 |
|---|---|---|
| `asyncio` 异步 | `async/await`（TS）/ `tokio`（Rust） | TS 原生支持，Rust 侧用 Tauri 命令桥接 |
| `httpx.AsyncClient` | `fetch`（TS）/ `reqwest`（Rust） | TS 直接用 fetch，注意 SSE 需 `EventSource` 或流式读取 |
| `langchain` FAISS/BM25 | 自实现或 `wink-bm25`（JS） | LangChain.js 生态较弱，BM25 需自找库或 Rust 实现 |
| `onnxruntime` Python | `ort`（ONNX Runtime Rust） | Rust 绑定成熟，Tauri 命令暴露给前端 |
| `aiofiles` 文件 IO | Tauri `fs` API / Rust `std::fs` | 用 Tauri 的 plugin-fs 或自定义命令 |
| `pydantic` 数据校验 | `zod`（TS）/ Rust 类型系统 | TS 用 zod，Rust 用 serde + 类型 |
| `mcp` Python SDK | `@modelcontextprotocol/sdk`（TS） | 官方 TS SDK 可直接用 |
| `FastAPI` 端点 | Tauri 命令 + React 前端 | 无需独立 HTTP 服务，用 IPC |

---

## 八、总结与技术参考价值

### 8.1 项目综合评价

Super Agent Party 是一个**工程完成度极高、生态野心极大**的开源 AI 桌面伴侣项目。其核心价值在于：

1. **双脑架构的工程化落地**：将卡尼曼双系统理论与 DeepMind Talker-Reasoner 架构落地为可运行代码，`sub_agent.py` 的迭代执行循环 + `minilm_router.py` 的语义路由是值得反复研读的参考实现。

2. **MCP 集成的工业级实践**：`mcp_clients.py` 对四种传输、自动重连、首包校验、OpenAI 格式转换的处理，是当前 MCP 客户端实现的最佳参考之一。

3. **多平台统一抽象**：`behavior_engine.py` 的 `register_handler` + 三触发模型，将 7 大 IM + 3 大直播平台统一为同一调度抽象，设计优雅。

4. **本地化与硬件兼容**：`minilm_router.py` 的 DirectML/CoreML/CUDA/CPU 四级回退，体现了对跨平台桌面场景的深度打磨。

5. **生态自举**：用 `sap-extension-creator` skill 创建新扩展，实现「Agent 制造 Agent」的生态闭环。

### 8.2 对 SpiritPal 的核心启示

- **双脑是方向**：SpiritPal 当前单脑架构在复杂任务场景会力不从心，建议 Phase 2 引入语义路由 + 双脑分流。
- **MCP 是标准**：尽早引入 MCP，可复用 SAP 的客户端设计，大幅扩展工具生态。
- **记忆系统已领先**：SpiritPal 的四阶段记忆无需照搬 SAP，反而是 SAP 可借鉴 SpiritPal 之处。
- **安全意识要保持**：SpiritPal `agentTools.ts` 的 shell 元字符校验是亮点，引入电脑控制时需保持同等安全标准。

### 8.3 许可证风险提示（重要）

⚠️ **Super Agent Party 采用 AGPL-3.0 许可证**，这是强 copyleft 协议：

- **学习参考**：✅ 允许。阅读源码、理解架构、借鉴设计思路均不受限制。
- **代码移植**：⚠️ 需谨慎。若直接复制 SAP 代码片段到 SpiritPal，SpiritPal 也将受 AGPL-3.0 约束，必须开源。
- **商用**：❌ 需授权。AGPL-3.0 的「网络服务条款」意味着即使只提供 SaaS 也需开源。
- **建议**：本报告仅作架构与设计层面的学习参考，**不建议直接复制 SAP 代码**。移植时应独立实现，仅借鉴设计思想与数据结构。SpiritPal 若要保持闭源或自有许可，必须确保「洁净室」实现。

### 8.4 参考价值评分

| 维度 | 评分 | 说明 |
|---|---|---|
| 架构创新性 | 9/10 | 双脑架构是开源界首个工程化落地 |
| 代码质量 | 7/10 | 扁平目录略显臃肿，但单文件内注释充分、容错完善 |
| 文档完整性 | 8/10 | 10 语言 README + CLI Agent 指南，但缺架构图 |
| 可借鉴性 | 8/10 | MCP 客户端、双脑、混合检索可直接参考设计 |
| 商用友好度 | 3/10 | AGPL-3.0 限制严格，需独立实现 |
| **综合** | **7/10** | 学习参考价值极高，商用需谨慎 |

---

> **报告声明**：本报告基于 GitHub main 分支在线源码分析，共读取 12 个源文件（package.json、README.md、agent.py、sub_agent.py、mcp_clients.py、task_center.py、know_base.py、scheduler.py、affection_system.py、behavior_engine.py、minilm_router.py、load_files.py）及 SpiritPal 4 个对比文件（enhancedMemory.ts、personalityEngine.ts、agentTools.ts、aiAgent.ts）。因网络原因未本地克隆仓库，部分细节（如 server.py 主聊天端点、get_setting.py 配置中枢、前端 VRM 渲染实现）基于 README 与模块导入关系推断，如有出入以官方仓库为准。
>
> **License：AGPL-3.0 — 仅作学习参考，商用需授权。**

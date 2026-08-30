# Agentic-Desktop-Pet 开源仓库技术分析报告

> 仓库地址：https://github.com/Moeru-ai/Agentic-Desktop-Pet
> 分析日期：2026-08-13
> 分析分支：main
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，为 SpiritPal（Tauri v2 + React 19 + TypeScript + Rust 跨平台 AI 桌宠）提供可借鉴特性参考

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

Agentic-Desktop-Pet 是一款**"下一代 Agentic 桌宠"**，融合了 LLM + 记忆 + 情感 + RPG + Claude Code 能力，是 SpiritPal 在功能广度上最接近的对标项目。使用 Python FastAPI 后端 + Godot 4.x 前端架构，提供知识图谱记忆、动态情感系统、RPG 属性系统。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | Agentic-Desktop-Pet |
| 仓库地址 | https://github.com/Moeru-ai/Agentic-Desktop-Pet |
| 许可证 | 开源（具体协议待确认） |
| 开发状态 | ⚠️ 早期开发中（README 标注"there are many bugs"） |
| 一句话定位 | 下一代 Agentic 桌宠 = LLM + 记忆 + 情感 + RPG + Claude Code |

### 当前状态

项目处于早期开发阶段，核心功能已实现：记忆系统（Cognee）、个人助手能力（类 Claude Code）、Mod 系统、动态情感系统、RPG 属性系统。**关键技术亮点**是 Cognee 知识图谱记忆和 Claude Code 风格的工具调用。

---

## 2. 核心技术栈

| 维度 | 技术选型 | 用途 |
|------|----------|------|
| **后端框架** | Python FastAPI | API 服务、Agent 核心逻辑 |
| **前端引擎** | Godot 4.x | 桌宠渲染、场景管理 |
| **记忆系统** | **Cognee** | 知识图谱记忆、长期存储、语义搜索 |
| **LLM 接口** | OpenAI 兼容 | 大模型调用 |
| **Agent 核心** | **learn-agent** | 个人助手能力（文件/代码/任务） |
| **前端脚本** | GDScript | Godot 4.x 脚本 |
| **情感引擎** | 自研 | 动态情感状态机 |

### 关键依赖

```python
# backend/pyproject.toml 推测
fastapi
uvicorn
cognee          # 知识图谱记忆
openai          # LLM
pydantic        # 数据校验
```

---

## 3. 项目架构与目录结构

```
Agentic-Desktop-Pet/
├── backend/                       # Python FastAPI 后端
│   ├── learn_agent/               # Agent 核心模块
│   │   ├── agent/                 # Agent 实现
│   │   │   ├── agent.py           #   主 Agent 类
│   │   │   └── memory.py          #   记忆管理
│   │   ├── memory/                # 记忆系统（Cognee）
│   │   │   └── cognee_manager.py  #   Cognee 封装
│   │   ├── emotion/               # 情感系统
│   │   │   └── emotion_engine.py  #   情感状态机
│   │   ├── rpg/                   # RPG 属性系统
│   │   │   └── character.py       #   角色属性
│   │   ├── llm/                   # LLM 接口
│   │   └── tool/                  # 工具集
│   │       ├── file_tool.py       #   文件操作
│   │       ├── code_tool.py       #   代码执行
│   │       └── todo_tool.py       #   任务管理
│   ├── main.py                    # FastAPI 服务入口
│   └── pyproject.toml
│
├── godot/                         # Godot 4.x 前端
│   ├── scenes/                    # 场景文件
│   ├── scripts/                   # GDScript 脚本
│   ├── themes/                    # 桌宠主题（Mod 加载）
│   └── project.godot
│
├── docs/                          # 文档
└── CLAUDE.md                      # Claude Code 指导
```

**架构模式**：后端按"agent / memory / emotion / rpg / llm / tool"分模块，前端用 Godot 4.x 的场景系统。CLAUDE.md 表明开发过程使用 Claude Code 辅助。

---

## 4. 核心功能模块详解

### 4.1 记忆系统（Cognee）🧠
- **Cognee 框架**：基于知识图谱的长期记忆
- **知识图谱记忆**：将对话组织成语义图谱
- **长期记忆**：跨会话持久存储
- **语义搜索**：向量 + 图谱搜索的混合检索
- **记忆丰富化**：自动提取实体和关系
- **自我学习**：从对话中持续学习

### 4.2 个人助手能力（类 Claude Code）🛠️
参考 [learn-agent](https://github.com/jihe520/learn-agent) 项目实现：
- **文件操作**：读取、创建、编辑本地文件
- **代码执行**：运行代码和脚本
- **任务管理**：创建和管理待办事项
- **系统集成**：执行系统命令和自动化任务

### 4.3 动态情感系统 💕
- **情感状态**：开心、悲伤、兴奋、无聊等基础情感
- **时间衰减**：情感随时间自然衰减
- **互动增强**：与用户交互增强情感连接
- **行为影响**：情感状态影响 Agent 的回复风格和行为

### 4.4 RPG 属性系统 ⚔️
- **基础属性**：智力、魅力、敏捷、体力
- **经验等级**：通过对话和任务获得经验升级
- **技能系统**：解锁和升级各种能力
- **好感度**：与用户的情感纽带等级

### 4.5 Mod 系统
- 轻松添加和切换不同桌宠主题
- Godot 场景文件即 Mod

---

## 5. 技术实现细节

### Cognee 记忆集成
```python
# 伪代码
import cognee

# 添加记忆
await cognee.add("用户说：今天加班到很晚")

# 构建知识图谱
await cognee.cognify()

# 语义搜索
results = await cognee.search("用户的加班情况")
```

### 情感状态机
```python
class EmotionEngine:
    def __init__(self):
        self.emotions = {
            "happy": 50,    # 0-100
            "sad": 0,
            "excited": 0,
            "bored": 50
        }
    
    def on_interaction(self, positive: bool):
        # 互动增强
        if positive:
            self.emotions["happy"] = min(100, self.emotions["happy"] + 10)
        else:
            self.emotions["sad"] = min(100, self.emotions["sad"] + 5)
    
    def tick_decay(self):
        # 时间衰减
        for emotion in self.emotions:
            self.emotions[emotion] = max(0, self.emotions[emotion] - 1)
```

### RPG 属性
```python
class Character:
    def __init__(self):
        self.attributes = {
            "intelligence": 10,
            "charisma": 10,
            "agility": 10,
            "stamina": 10
        }
        self.level = 1
        self.exp = 0
        self.affection = 0  # 好感度
    
    def gain_exp(self, amount):
        self.exp += amount
        if self.exp >= self.level * 100:
            self.level_up()
    
    def level_up(self):
        self.level += 1
        for attr in self.attributes:
            self.attributes[attr] += 2
```

### Claude Code 风格工具
```python
# learn-agent 风格的工具调用
TOOLS = {
    "read_file": read_file,
    "write_file": write_file,
    "run_command": run_command,
    "create_todo": create_todo
}

# LLM Function Calling
response = llm.chat(
    messages=[...],
    tools=[{"name": t, "description": ..., "parameters": ...} for t in TOOLS]
)
# 解析 tool_calls 并执行
```

---

## 6. 数据处理流程

```
用户输入
  → Godot 前端
  → WebSocket 发送到 FastAPI
  → learn_agent.agent 接收
  → cognee_manager 检索相关记忆
  → emotion_engine 更新情感状态
  → LLM 生成响应（可选工具调用）
  → 执行工具（文件/代码/任务）
  → 更新 RPG 属性（经验/好感度）
  → 存储记忆到 Cognee
  → 返回响应
  → Godot 前端展示
```

---

## 7. UI/UX 设计

- **Godot 4.x 渲染**：游戏引擎级别表现力
- **场景系统**：每个桌宠主题是独立 Godot 场景
- **Mod 系统**：通过 Godot 场景文件实现
- **3D / 2D 混合**：支持 3D 模型和 2D 精灵

---

## 8. 动画与渲染系统

- **Godot Animation Player**：内置动画系统
- **状态机动画**：每个情感状态对应一个动画
- **粒子系统**：情感特效（爱心、星星等）
- **骨骼动画**：3D 模型支持

---

## 9. AI/聊天集成分析

### LLM 选型
- OpenAI 兼容接口
- 支持 Function Calling（工具调用）
- 可选 Claude / GPT / 本地模型

### Prompt 构造
```
System: 你是 [角色名]，[情感状态]，[性格]
Personality: [基于 RPG 属性的性格描述]
Memories: [Cognee 检索的记忆]
Tools: [可用的工具列表]
User: [用户输入]
```

### 工具调用循环
```
LLM Response → 检测 tool_calls → 执行工具 → 结果回传 LLM → 继续
（直到 LLM 不再调用工具，生成最终响应）
```

---

## 10. 构建与打包流程

### 后端
```bash
cd backend
pip install -r requirements.txt
python main.py
```

### Godot 前端
- 用 Godot Editor 打开 `godot/project.godot`
- F5 运行
- 导出：Project → Export → 选择平台

---

## 11. 版本发布与迭代历史

项目处于早期阶段，版本信息有限：
- 0.1.x：核心模块搭好（Cognee 集成、情感、RPG）
- 0.2.x：Mod 系统、Claude Code 风格工具
- 当前：早期开发中，存在已知 bug

---

## 12. 社区与Issue概况

- **开发状态**：作者声明"开发中，存在很多 bug"
- **CLAUDE.md**：使用 Claude Code 辅助开发
- **社区**：早期阶段，issue 和 PR 较少

---

## 13. 优缺点分析

### 优点
1. **Cognee 知识图谱记忆**：比纯向量检索更智能
2. **Claude Code 风格工具调用**：强大的 Agent 能力
3. **动态情感系统**：情感影响行为
4. **RPG 属性系统**：完整的养成框架
5. **Mod 系统**：用户可扩展
6. **Godot 4.x**：游戏级渲染能力
7. **CLAUDE.md 实践**：AI 辅助开发示范

### 缺点
1. ⚠️ **早期阶段**：作者声明有 bug
2. **Godot 4.x 学习成本**：前端非主流
3. **Python 后端**：需独立启动
4. **Cognee 依赖重**：知识图谱需要较多资源
5. **无 Tauri 模式**：体积较大
6. **文档不足**：API 文档和架构文档较少

---

## 14. 可借鉴特性

| # | 特性 | 评分 | SpiritPal 移植建议 | 目标文件 |
|---|------|------|-------------------|---------|
| 1 | **Cognee 知识图谱记忆** | ★★★★★ | 评估替换/增强 vectorSearch | `src/lib/vectorSearch.ts` |
| 2 | **Claude Code 风格工具** | ★★★★ | aiAgent 的 tool 体系 | `src/lib/agentTools.ts` |
| 3 | **动态情感系统** | ★★★★★ | 情感状态机 + 影响行为 | `src/lib/behaviorEngine.ts` |
| 4 | **RPG 属性系统** | ★★★★ | 已有养成系统可对照 | `src/stores/petStore.ts` |
| 5 | **Mod 系统** | ★★★★ | 评估 Godot 场景风格 Mod | `src/lib/modLoader.ts` |
| 6 | **Function Calling** | ★★★★ | 已部分实现 | `src/lib/aiAgent.ts` |
| 7 | **情感时间衰减** | ★★★★ | 已部分实现 | `src/lib/emotionManager.ts` |
| 8 | **经验等级系统** | ★★★ | 已有 XP/Level | `src/stores/petStore.ts` |
| 9 | **好感度系统** | ★★★ | 已实现 | `src/stores/petStore.ts` |
| 10 | **CLAUDE.md 实践** | ★★★★ | SpiritPal 已有 AGENTS.md | `AGENTS.md` |

---

## 15. 潜在改进点

1. **修复 bug**：作者已声明存在 bug，需优先修复稳定性
2. **完善文档**：API 文档、架构图、贡献指南
3. **Tauri 替代 Godot**：降低学习成本
4. **嵌入式 Cognee**：减少依赖
5. **Mod 商店**：建立 Mod 生态
6. **多模态输入**：支持图片/语音

---

## 16. 跨平台支持评估

| 平台 | 支持情况 | 说明 |
|------|---------|------|
| **Windows** | ✅ Godot 支持 | 后端 Python 需独立启动 |
| **macOS** | ✅ Godot 支持 | 同上 |
| **Linux** | ✅ Godot 支持 | 同上 |
| **移动端** | ❌ Godot 桌面版 | 需单独移动版 |

---

## 17. 总结与技术参考价值

Agentic-Desktop-Pet 是 SpiritPal **功能重合度最高的对标项目**——同样定位 AI 桌宠、同样强调多模态能力、同样重视情感与养成。但**技术栈差异较大**（Python + Godot vs Tauri + React），代码复用度低，**核心价值在设计模式而非代码**。

**核心参考价值**：
- **P0**：Cognee 知识图谱记忆（SpiritPal 可考虑引入作为 vectorSearch 增强）
- **P0**：动态情感系统设计模式（SpiritPal `behaviorEngine` 可参考）
- **P0**：Claude Code 风格工具调用（SpiritPal `agentTools`）
- **P1**：RPG 属性系统完整框架（与 SpiritPal 养成系统对照）
- **P1**：Mod 系统（SpiritPal `modLoader`）
- **P2**：情感时间衰减算法（SpiritPal `emotionManager`）

**参考价值评分**：⭐⭐⭐⭐（4/5）
- 功能重合度：**高**（核心功能几乎一一对应）
- 技术栈匹配度：低（Python + Godot vs Tauri + React）
- 设计模式可借鉴：**高**（情感/RPG/记忆都是核心）
- 代码复用度：低（需重写）
- 早期风险：中（作者声明有 bug）

**集成路径**：
1. 短期：参考 Cognee 设计增强 SpiritPal 的 `keyframeMemory`（时间线 + 关系）
2. 中期：评估 Cognee 是否可作为 vectorSearch 的补充（实体关系图谱）
3. 长期：参考 Claude Code 工具调用模式扩展 SpiritPal `agentTools`

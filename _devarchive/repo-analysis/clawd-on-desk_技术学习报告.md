# clawd-on-desk 开源仓库技术分析报告

> 仓库地址：https://github.com/rullerzhou-afk/clawd-on-desk
> 分析日期：2026-08-13
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，为 SpiritPal（Tauri v2 + React 19 + Rust）提供可借鉴特性参考

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

Clawd on Desk 是一款**像素风桌面宠物**，实时响应 AI 编码 Agent（Claude Code、Codex、Cursor 等 20+）的工作状态。**与 ai-bubu 高度相似**（同类型项目），但支持更多 AI 工具和更丰富的权限交互。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | Clawd on Desk |
| 仓库地址 | https://github.com/rullerzhou-afk/clawd-on-desk |
| 许可证 | AGPL-3.0（部分组件） |
| 一句话定位 | Pixel desktop pet that reacts to your AI coding agent in real time |
| 平台 | Windows / macOS / Linux |

### 当前状态

活跃维护，支持 20+ AI 编码工具，3 个内置主题（Clawd / Calico / Cloudling），已收录于 awesome-claude-code。

---

## 2. 核心技术栈

| 维度 | 技术选型 | 用途 |
|------|----------|------|
| **桌面框架** | Electron | 跨平台桌面壳 |
| **前端** | 原生 JavaScript | 简单高效 |
| **角色渲染** | Canvas 2D | 像素风 |
| **状态检测** | 适配器模式 + Hook 文件 | 多 AI 工具 |
| **PWA** | 渐进式 Web App | 浏览器访问 |
| **国际化** | 4 种语言 | 多语言 |

### 支持的 AI 工具（20+）
- Claude Code / Codex CLI / Copilot CLI
- Gemini CLI / Antigravity CLI / Cursor Agent
- CodeBuddy / WorkBuddy / Kiro CLI
- Kimi Code CLI / Qwen Code / CodeWhale
- opencode / MiMo Code / Pi / OpenClaw
- Hermes Agent / Qoder / QoderWork / Reasonix CLI

---

## 3. 项目架构与目录结构

```
clawd-on-desk/
├── src/                          # 前端源码
│   ├── main.js                   # 主入口
│   ├── state.js                  # 状态管理
│   ├── tick.js                   # 心跳 tick
│   ├── menu.js                   # 菜单
│   ├── prefs.js                  # 偏好
│   ├── roam.js                   # 自由移动
│   ├── mini.js                   # 迷你模式
│   ├── focus.js                  # 焦点检测
│   ├── i18n.js                   # 国际化
│   └── hit.html                  # 命中测试
├── pwa/                          # PWA
│   ├── app.js
│   ├── sw.js                     # Service Worker
│   ├── icons.js
│   └── manifest.json
├── agents/                       # AI Agent 集成
│   └── pi.js                     # Pi Agent 适配器
├── assets/                       # 资源
│   ├── tray-icon.png
│   ├── hero.gif
│   └── themes/                   # 主题（Clawd / Calico / Cloudling）
├── launch.js                     # Electron 启动
├── package.json
├── AGENTS.md                     # AI Agent 协作
├── CLAUDE.md
└── README.md
```

**架构模式**：轻量级 Electron + 适配器模式（每个 AI 工具一个适配器）。

---

## 4. 核心功能模块详解

### 4.1 多 AI Agent 集成（核心亮点）
**20+ 工具的 hooks 集成**：
- **command hooks** + **HTTP permission hooks** 两种方式
- 各 Agent 独立配置路径（`~/.claude/`、`~/.codex/` 等）
- 5 种适配器类型：SQLite / JSONL / process / file_mtime / vscode_ext

### 4.2 12 种动画状态
- **idle / thinking / typing / building**（工作态）
- **subagent groove / multi-subagent juggling**（多 Agent）
- **error / happy / notification**（反馈）
- **sweeping / carrying**（搬运）
- **sleeping**（休息）

### 4.3 Codex Pet 主题导入
- 导入 Codex Pet zip 包
- 自动适配 atlas 动画

### 4.4 眼动追踪 + 睡眠序列
- **Idle 时眼动追踪**：跟随鼠标，身体倾斜 + 阴影拉伸
- **睡眠序列**：60 秒无活动 → 打哈欠 → 打瞌睡 → 倒塌 → 睡觉
- **鼠标移动惊醒**：触发 startled wake-up 动画

### 4.5 点击交互
- **双击**：戳反应
- **4 次连击**：flail（挣扎）
- **拖拽**：Pointer Capture 防误操作

### 4.6 权限气泡（Permission Bubble）
- Claude Code / Codex CLI 等需要权限时弹出气泡卡片
- **Allow / Deny / Always** 三选项
- 全局快捷键 `Ctrl+Shift+Y` / `Ctrl+Shift+N`
- 多个请求堆叠显示
- 用户在终端回复时自动消失

### 4.7 迷你模式
- 拖到屏幕边缘自动隐藏
- peek-on-hover
- 迷你提醒
- 抛物线跳跃过渡

### 4.8 Session HUD
- 显示当前活动 session
- 工具活动
- 通知

---

## 5. 技术实现细节

### AI Agent 适配器
```javascript
class ClaudeCodeAdapter {
  install() {
    // 写入 Claude Code 命令 hooks
    fs.writeFileSync(
      '~/.claude/settings.json',
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'clawd state' }] }]
        }
      })
    );
  }
  
  getState() {
    // 解析 ~/.claude/projects/*.jsonl
    const lastActivity = getLatestMtime('~/.claude/projects/');
    return lastActivity > Date.now() - 60000 ? 'active' : 'idle';
  }
}
```

### 状态定义
```javascript
const STATES = {
  idle: { animation: 'idle.gif', color: '#888' },
  thinking: { animation: 'thinking.gif', color: '#9b59b6' },
  typing: { animation: 'typing.gif', color: '#3498db' },
  building: { animation: 'building.gif', color: '#e67e22' },
  error: { animation: 'error.gif', color: '#e74c3c' },
  happy: { animation: 'happy.gif', color: '#f1c40f' },
  sleeping: { animation: 'sleeping.gif', color: '#34495e' }
  // ...
};
```

### 权限气泡
```javascript
class PermissionBubble {
  show(request) {
    const bubble = createBubble({
      title: request.tool,
      message: request.description,
      buttons: [
        { label: 'Allow', hotkey: 'Ctrl+Shift+Y' },
        { label: 'Deny', hotkey: 'Ctrl+Shift+N' },
        { label: 'Always' }
      ]
    });
    this.stack.push(bubble);
    this.positionStack();
  }
}
```

### 眼动追踪
```javascript
function updateGaze(mouseX, mouseY, petX, petY) {
  const dx = mouseX - petX;
  const dy = mouseY - petY;
  const angle = Math.atan2(dy, dx);
  const distance = Math.min(Math.sqrt(dx*dx + dy*dy) / 200, 1);
  pet.eyeX = Math.cos(angle) * distance;
  pet.eyeY = Math.sin(angle) * distance;
  pet.bodyLean = angle * 0.1;
}
```

### Pointer Capture 拖拽
```javascript
element.setPointerCapture(event.pointerId);
element.addEventListener('pointermove', (e) => {
  if (isDragging) {
    pet.x = e.clientX - dragOffset.x;
    pet.y = e.clientY - dragOffset.y;
  }
});
element.addEventListener('pointerup', () => {
  element.releasePointerCapture(event.pointerId);
  isDragging = false;
});
```

---

## 6. 数据处理流程

```
AI Agent 工具调用
  → Command Hooks / HTTP Hooks
  → Clawd 接收事件
  → 更新状态
  → 切换动画
  → 播放音效
权限请求
  → 弹出 Permission Bubble
  → 用户选择
  → 发送回 Agent
```

---

## 7. UI/UX 设计

- **像素风**：8-bit 美学
- **3 个内置主题**：Clawd（螃蟹）/ Calico（三花猫）/ Cloudling（云宝）
- **迷你模式**：屏幕边缘隐藏
- **会话 HUD**：实时显示活动
- **权限气泡**：优雅打断
- **4 种语言**：EN / 中简 / 中繁 / 韩 / 日

---

## 8. 动画与渲染系统

- **Canvas 2D 像素渲染**
- **12 状态 × 多帧动画**
- **GIF / WebP / 雪碧图** 多格式
- **眼动追踪**：身体倾斜 + 阴影
- **睡眠序列**：6 阶段
- **抛物线跳跃**：迷你模式过渡

---

## 9. AI/聊天集成分析

**不涉及对话**（仅状态可视化），但有**权限交互**：
- 监听 AI 工具权限请求
- 显示气泡
- 用户决策回传

---

## 10. 构建与打包流程

### 开发
```bash
npm install
node launch.js
```

### 测试
```bash
./test-demo.sh
./test-mini.sh
```

### 打包
```bash
# 通过 electron-builder
npm run build
```

---

## 11. 版本发布与迭代历史

通过 GitHub Releases 推测：
- 0.1.x：基础 Claude Code 集成
- 0.5.x：多 AI 工具支持
- 0.8.x：权限气泡
- 当前：1.0.x 稳定

---

## 12. 社区与Issue概况

- **awesome-claude-code**：被收录
- **多语言社区**：EN/中/韩/日
- **活跃 Issue**：用户报告新 AI 工具适配
- **Discord**：推测有社区

---

## 13. 优缺点分析

### 优点
1. **20+ AI 工具支持**：最广
2. **5 种适配器类型**：可扩展任何工具
3. **12 状态动画**：表达丰富
4. **权限气泡**：独特创新
5. **睡眠序列**：6 阶段真实感
6. **Pointer Capture**：专业拖拽
7. **多语言**
8. **AGPL**：强 copyleft（保护贡献）

### 缺点
1. **AGPL-3.0**：传染性极强（SpiritPal 需谨慎借鉴代码）
2. **仅可视化**：无对话能力
3. **依赖 hooks**：需用户配置
4. **电子 Electron**：资源占用大
5. **多 Agent 共存**：性能压力

---

## 14. 可借鉴特性

| # | 特性 | 评分 | SpiritPal 移植建议 | 目标文件 |
|---|------|------|-------------------|---------|
| 1 | **20+ AI 适配器** | ★★★★★ | 复用模式接入 IDE 监控 | `src/lib/hooks/pet/` |
| 2 | **5 种适配器类型** | ★★★★★ | 复用 SpiritPal 活动检测 | `src/lib/hooks/pet/` |
| 3 | **12 状态动画** | ★★★★★ | 丰富 SpiritPal 状态机 | `src/lib/behaviorEngine.ts` |
| 4 | **权限气泡** | ★★★ | SpiritPal 不需要（无权限场景） | - |
| 5 | **睡眠序列** | ★★★★★ | 复用 SpiritPal 睡眠状态 | `src/lib/behaviorEngine.ts` |
| 6 | **Pointer Capture** | ★★★★★ | 复用 usePetDragging | `src/hooks/pet/usePetDragging.ts` |
| 7 | **Codex Pet 导入** | ★★★★ | 复用角色导入 | `src/lib/characterResourceImporter.ts` |
| 8 | **眼动追踪** | ★★★★ | SpiritPal usePetGaze | `src/hooks/usePetGaze.ts` |
| 9 | **多 Agent 共存** | ★★★ | 评估 SpiritPal 扩展 | - |
| 10 | **迷你模式** | ★★★★ | SpiritPal miniMode | `src/lib/miniMode.ts` |

---

## 15. 潜在改进点

1. **AGPL 转 MIT/Apache**：降低传染性
2. **AI 对话能力**：不仅是状态
3. **Tauri 替代 Electron**
4. **更少 hooks 依赖**：被动监控
5. **多用户协作**

---

## 16. 跨平台支持评估

| 平台 | 支持情况 | 说明 |
|------|---------|------|
| **Windows** | ✅ 完整 | Windows 11 |
| **macOS** | ✅ 完整 | 通用 |
| **Linux** | ✅ 完整 | Ubuntu |
| **PWA** | ✅ 浏览器 | 渐进式 Web App |

---

## 17. 总结与技术参考价值

Clawd on Desk 是 **AI Agent 编码可视化的旗舰项目**，**与 ai-bubu 高度相似**（同领域）。其 20+ AI 工具支持、5 种适配器类型、12 状态动画、权限气泡、Pointer Capture 都是 SpiritPal 可参考的设计。

**核心参考价值**：
- **P0**：20+ AI 适配器模式（SpiritPal 监控 IDE 活动可参考）
- **P0**：5 种适配器类型（SQLite / JSONL / process / file_mtime / vscode_ext）
- **P0**：12 状态动画设计（丰富 SpiritPal 状态机）
- **P0**：睡眠序列 6 阶段（SpiritPal 睡眠状态）
- **P0**：Pointer Capture 拖拽（SpiritPal `usePetDragging`）
- **P1**：Codex Pet 主题导入（SpiritPal 角色导入）
- **P1**：眼动追踪（SpiritPal `usePetGaze`）
- **P1**：迷你模式（SpiritPal `miniMode`）

**参考价值评分**：⭐⭐⭐⭐⭐（5/5）
- AI Agent 集成最广
- 与 SpiritPal 重叠度：**极高**
- 设计模式可借鉴：**极高**
- ⚠️ 代码不可直接复制（AGPL-3.0）
- 设计模式可学习：仅模式，**实现需独立编写**

**集成路径**：
1. **立即**：参考适配器模式接入 AI 活动检测
2. **短期**：参考 12 状态 + 睡眠序列扩展 SpiritPal `behaviorEngine`
3. **中期**：参考 Pointer Capture 改进 `usePetDragging`
4. **注意**：**不能复制代码**（AGPL），仅学习设计模式

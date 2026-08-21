# MCP 命令桥使用说明

> SpiritPal 应用内置的本地 MCP Server，让外部 Agent（如 Claude Code / codex）以 stdio 方式驱动你的桌面宠物，进行实时状态查询、动作交互、记忆检索与物品操作。

## 一、快速概述

- **用途**：在运行的 SpiritPal 实例中，通过外部命令行 Agent 调用 6 个工具（`spiritpal_status/react/say/memory/feed/pet`），实现真实状态读写和 UI 反馈。
- **模式**：外部 Agent 启动 `spiritpal-mcp` 二进制作为 stdio transport → 转发到本机 Bridge（默认 `127.0.0.1:3124`，带 Bearer Token 鉴权）。
- **依赖**：SpiritPal 应用必须**正在运行**；外部 Agent 需读取/提供 Token。

---

## 二、启动方式

### 1) 正常启动 SpiritPal 应用

```powershell
cd C:\Users\Doro\SpiritPal
pnpm tauri dev   # 或 pnpm tauri build && .\target\release\desktop_pet.exe
```

启动时会在控制台打印：
```text
[MCP] command bridge listening on 127.0.0.1:3124 (token: <SHA256>)
```

- Token 是 SHA-256 摘要，每次启动随机生成。
- 如需持久化 Token（便于配置给 agent），设置环境变量 `SPIRITPAL_MCP_TOKEN_FILE`，例如：
  ```powershell
  $env:SPIRITPAL_MCP_TOKEN_FILE="C:\Users\Doro\SpiritPal\.mcp-token"
  ```
  应用启动后会把 token 写入该文件。

### 2) 准备 `spiritpal-mcp` 可执行文件

- 已随应用打包为 `externalBin`（Tauri bundling 完成后可直接分发）。
- 开发期手动使用：构建后将 `src-tauri/binaries/spiritpal-mcp.exe` 放到 PATH，或直接指定路径。

### 3) 配置外部 Agent（Claude Code / codex 等）

以 **Claude Code** 为例，创建一个 `mcpservers.json`（或你使用的 CLI 的 MCP server 定义），示例：

```jsonc
{
  "mcpServers": {
    "spiritpal": {
      "command": "C:\\Users\\Doro\\SpiritPal\\src-tauri\\binaries\\spiritpal-mcp.exe",
      "args": [],
      "env": {
        // 方式 A: 直接从环境变量设 Token
        "SPIRITPAL_MCP_BRIDGE_ADDR": "127.0.0.1:3124",
        "SPIRITPAL_MCP_BRIDGE_TOKEN": "<从控制台复制>/从文件复制"
        // 方式 B: 若用 Token 文件，改用
        // "SPIRITPAL_MCP_TOKEN_FILE": "C:\\Users\\Doro\\SpiritPal\\.mcp-token"
      }
    }
  }
}
```

> 说明：Bridge 监听 127.0.0.1，仅允许本机访问；Token 采用 `Authorization: Bearer` 校验，缺失或错误将返回 401。

---

## 三、可用工具（6 个）

| 工具名 | 功能 | 参数 | 返回值 |
|---|---|---|---|
| `spiritpal_status` | 当前宠物状态（等级/饥饿/心情/健康/亲密度/金币/位置/动画） | `{}` | `{ level, hunger, hungerLabel, mood, moodLabel, health, affection, coins, characterId, animation, position }` |
| `spiritpal_react` | 触发反应动作（基于 `OPENPETS_REACTION_MAP` 映射） | `{ reaction: string }` | `"Pet reacted with: <animName>"` |
| `spiritpal_say` | 显示气泡消息（≤200 字，自动清洗 markdown/标签） | `{ message: string }` | `"Pet says: <message>"` |
| `spiritpal_memory` | 记忆检索/统计（`action: search|list`） | `{ action: 'search'|'list', query?: string }` | JSON 列表或 `{ total, working, episodic, autobiographical }` |
| `spiritpal_feed` | 喂食（需背包有对应食物） | `{ foodName: string }` | `"Fed pet with <name>. Hunger: ..., Coins: ..."` |
| `spiritpal_pet` | 抚摸宠物 | `{}` | `"Pet the pet successfully. Affection: ..., Mood: ..."` |

所有工具返回标准 MCP `tools/call` 格式：
```json
{
  "result": {
    "content": [{ "type": "text", "text": "..." }]
  }
}
```
失败时在 `isError` 标记错误原因（含诚实错误：`SPIRITPAL_BRIDGE_UNAVAILABLE` 表示应用未运行/不可达）。

---

## 四、安全与网络边界

- **绑定地址**：127.0.0.1（仅限本机）；环境变量 `SPIRITPAL_MCP_BRIDGE_ADDR` 可改端口。
- **认证方式**：`Authorization: Bearer <token>`（应用侧强制校验）。
- **Token 来源**：优先 env `SPIRITPAL_MCP_BRIDGE_TOKEN`；次选文件 `SPIRITPAL_MCP_TOKEN_FILE`。
- **发布场景**：建议关闭 HTTP Bridge，仅保留 stdio；生产包默认不开端口（除非显式启用了 HTTP）。

---

## 五、常见排错

| 现象 | 可能原因 | 解决 |
|---|---|---|
| `SPIRITPAL_BRIDGE_UNAVAILABLE: 连接 bridge 失败` | 应用未启动，或端口被占 | 启动 SpiritPal；确认 `127.0.0.1:3124` 无冲突；检查控制台是否出现 `[MCP] command bridge listening on ...` |
| `unauthorized: 缺少或错误的 Bridge Token` | Agent 未传/传错 Token | 核对控制台打印的 token；或用文件回退方式确保 `SPIRITPAL_MCP_TOKEN_FILE` 指向正确路径且可读 |
| 应用日志 `emit to webview failed` | Webview 未加载/桥事件被拒 | 刷新/重启应用；确认 `mcpAppBridge.ts` 已挂载（main.tsx 中 try/catch 不应报错） |
| `webview response timeout` | 前端处理超时/未回调 | 检查 `executeMcpTool` 是否阻塞；确认无长时间等待逻辑；延长 timeout（修改 `mcp_bridge.rs`）后重试 |

---

## 六、开发者接口（可选深入）

- **HTTP Bridge 协议**：POST `/mcp/call`，body 为 `{ tool: name, arguments: obj }`；响应为 `{ ok: true, tool: name }`。
- **内部模块**：
  - Rust side: `src-tauri/mcp-server/src/lib.rs`（bridge 引擎）、`src-tauri/src/mcp_bridge.rs`（应用端 hosting + 命令回调）。
  - TS side: `src/lib/mcpBridge.ts`（真实执行逻辑）、`src/lib/mcpAppBridge.ts`（监听 `mcp://request` + `invoke mcp_respond`）。
- **扩展新工具**：在 `mcpBridge.ts` 增加 case + schema 校验；同时更新 `src-tauri/mcp-server/src/main.rs` 的工具描述（`to_tools_response()`），无需改动 bridge 层。

---

## 七、示例脚本（PowerShell）

```powershell
# 启动 SpiritPal 并将 token 落盘
$env:SPIRITPAL_MCP_TOKEN_FILE = "$PWD\.mcp-token"
.\dist\desktop_pet.exe

# 等待几秒让应用初始化
Start-Sleep -Seconds 3

# 使用 spiritpal-mcp 测试
& .\src-tauri\binaries\spiritpal-mcp.exe <<EOF
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"spiritpal_status","arguments":{}}}
EOF
```

---

## 附录：完整链路流程图

```mermaid
flowchart TD
  A[外部 Agent\n(claude/code)] -->|stdio| B(spiritpal-mcp.exe)
  B -->|tools/call| C[HTTP POST 127.0.0.1:3124/mcp/call\n+ Authorization: Bearer <token>]
  C -->|Rust mcp_bridge.rs| D{验证 Token?}
  D -- 失败 --> E[401 unauthorized]
  D -- 成功 --> F[发 mcp://request 事件]
  F --> G[mcpAppBridge.ts\nreceive event]
  G --> H[executeMcpTool\n(真实 petStore/记忆)]
  H --> I[UI 驱动\n气泡/动作]
  I --> J[invoke mcp_respond(id,result)]
  J --> K[Rust 回填挂起 HTTP]
  K --> L[返回文本至 Agent]
```

---

## 版本与变更

- v0.1.0 (2026-08-21): 初始版，含 6 工具、Bearer Token 鉴权、stdio/文件双源 Token、externalBin 集成。
- 待办：支持 SSE 模式（需加本地鉴权）、添加更多工具（任务/日程联动）。

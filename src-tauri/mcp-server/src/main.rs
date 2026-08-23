//! SpiritPal MCP stdio server（MCP 专项·Rust 承载第一步）
//!
//! MCP（Model Context Protocol）stdio 服务核心：
//! - 通过 stdin/stdout 以"换行分隔的 JSON-RPC 2.0"通信（MCP 官方用 Content-Length 帧，
//!   本实现先用换行分隔便于独立验证；后续可换为 LSP 帧）。
//! - `initialize` / `tools/list` 真实可用并返回 6 个 `spiritpal_*` 工具。
//! - `tools/call` 为"命令桥"接缝：工具需要有运行中的 SpiritPal 实例状态，
//!   本核心不凭空伪造数据，统一返回 `SPIRITPAL_BRIDGE_UNAVAILABLE`，
//!   由后续"桥接层"（→ 运行中的应用实例 → webview TS 工具逻辑）启用。

use std::io::{self, BufRead, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;
use serde_json::{json, Value};

/// MCP 协议版本（取自 @modelcontextprotocol/sdk）
const MCP_PROTOCOL_VERSION: &str = "2025-03-26";
const SERVER_NAME: &str = "spiritpal-mcp";
const SERVER_VERSION: &str = "1.1.0";

/// 工具定义（name / description / inputSchema）
struct ToolDef {
    name: &'static str,
    description: &'static str,
    input_schema: Value,
}

/// 6 个 `spiritpal_*` 工具注册表
fn tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "spiritpal_status",
            description: "获取宠物当前状态（等级/饥饿/心情/健康/好感/金币/角色）",
            input_schema: json!({"type": "object", "properties": {}, "additionalProperties": false}),
        },
        ToolDef {
            name: "spiritpal_react",
            description: "让宠物执行指定反应/动画",
            input_schema: json!({
                "type": "object",
                "properties": { "reaction": { "type": "string", "description": "反应名" } },
                "required": ["reaction"]
            }),
        },
        ToolDef {
            name: "spiritpal_say",
            description: "让宠物在气泡中说话（最长 200 字符，禁止代码/路径/密钥）",
            input_schema: json!({
                "type": "object",
                "properties": { "message": { "type": "string", "maxLength": 200 } },
                "required": ["message"]
            }),
        },
        ToolDef {
            name: "spiritpal_memory",
            description: "查询宠物记忆系统（search 或 list）",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["search", "list"] },
                    "query": { "type": "string", "description": "search 时需要" }
                },
                "required": ["action"]
            }),
        },
        ToolDef {
            name: "spiritpal_feed",
            description: "喂食宠物指定食物",
            input_schema: json!({
                "type": "object",
                "properties": { "foodName": { "type": "string" } },
                "required": ["foodName"]
            }),
        },
        ToolDef {
            name: "spiritpal_pet",
            description: "抚摸宠物，增加好感度",
            input_schema: json!({"type": "object", "properties": {}, "additionalProperties": false}),
        },
    ]
}

/// 本机命令桥端点（环境变量可覆盖，默认 127.0.0.1:3124）
fn bridge_addr() -> String {
    std::env::var("SPIRITPAL_MCP_BRIDGE_ADDR").unwrap_or_else(|_| "127.0.0.1:3124".to_string())
}

/// 解析 Bridge Token：优先环境变量 `SPIRITPAL_MCP_BRIDGE_TOKEN`，
/// 否则读取 `SPIRITPAL_MCP_TOKEN_FILE` 指向的文件（便于应用把 token 写盘交给 agent）。
fn read_bridge_token() -> Option<String> {
    if let Ok(t) = std::env::var("SPIRITPAL_MCP_BRIDGE_TOKEN") {
        if !t.trim().is_empty() {
            return Some(t);
        }
    }
    if let Ok(path) = std::env::var("SPIRITPAL_MCP_TOKEN_FILE") {
        if let Ok(content) = std::fs::read_to_string(path) {
            let t = content.trim().to_string();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    None
}

/// 用 std TCP 发送一个最小 HTTP/1.1 POST 到本机 bridge，返回响应 body（假定非 chunked）。
fn http_post(
    addr: &str,
    path: &str,
    body: &str,
    timeout_ms: u64,
    token: Option<&str>,
) -> Result<String, String> {
    let sock_addrs = addr
        .to_socket_addrs()
        .map_err(|e| format!("解析 bridge 地址失败: {e}"))?;
    let mut stream = TcpStream::connect_timeout(
        &sock_addrs.as_slice()[0],
        Duration::from_millis(timeout_ms),
    )
    .map_err(|e| format!("连接 bridge 失败: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(timeout_ms)))
        .ok();

    let auth_line = token
        .map(|t| format!("Authorization: Bearer {t}\r\n"))
        .unwrap_or_default();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\n{auth_line}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("写入 bridge 请求失败: {e}"))?;
    stream.flush().ok();

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|e| format!("读取 bridge 响应失败: {e}"))?;

    // 取 header 之外的 body
    if let Some(split) = response.find("\r\n\r\n") {
        Ok(response[split + 4..].to_string())
    } else {
        // 兼容仅 body 或无换行分隔的简单响应
        Ok(response)
    }
}

/// 构建 bridge 转发请求体（工具名 + 参数）——独立函数便于单测
fn build_forward_body(name: &str, arguments: Value) -> String {
    json!({ "tool": name, "arguments": arguments }).to_string()
}

fn rpc_response(id: &Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn rpc_error(id: &Value, code: i64, message: &str, data: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message, "data": data}})
}

/// 处理单个 JSON-RPC 请求
fn handle_message(msg: Value) -> Value {
    let method = match msg.get("method").and_then(Value::as_str) {
        Some(m) => m,
        None => {
            return rpc_error(&msg["id"], -32600, "Invalid Request", json!({}))
        }
    };
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let params = msg.get("params").cloned().unwrap_or(json!({}));

    match method {
        "initialize" => rpc_response(&id, json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION }
        })),
        "notifications/initialized" => rpc_response(&id, json!(null)),
        "tools/list" => {
            let tool_json: Vec<Value> = tools()
                .into_iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "inputSchema": t.input_schema
                    })
                })
                .collect();
            rpc_response(&id, json!({ "tools": tool_json }))
        }
        "tools/call" => {
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
            let tool_exists = tools().iter().any(|t| t.name == name);
            if !tool_exists {
                return rpc_error(&id, -32602, "Tool not found", json!({ "tool": name }));
            }
            // 命令桥：转发到运行中的应用实例→webview TS 工具逻辑。
            // 若本机 bridge 不可达（应用未运行/未监听），返回诚实错误而非伪造数据。
            let body = build_forward_body(&name, arguments);
            let token = read_bridge_token();
            match http_post(&bridge_addr(), "/mcp/call", &body, 1500, token.as_deref()) {
                Ok(reply) => rpc_response(&id, json!({
                    "content": [{ "type": "text", "text": reply }]
                })),
                Err(e) => rpc_response(&id, json!({
                    "content": [{
                        "type": "text",
                        "text": format!("SPIRITPAL_BRIDGE_UNAVAILABLE: {e}（请确认 SpiritPal 已运行并开启 MCP 命令桥）")
                    }],
                    "isError": true
                })),
            }
        }
        "ping" => rpc_response(&id, json!({})),
        _ => rpc_error(&id, -32601, "Method not found", json!({ "method": method })),
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                let _ = writeln!(
                    stdout,
                    "{}",
                    json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error","data":{}}})
                );
                let _ = stdout.flush();
                continue;
            }
        };
        // 处理 JSON-RPC 通知（无 id）返回空响应
        if !msg.get("id").is_some() {
            let _ = stdout.flush();
            continue;
        }
        let resp = handle_message(msg);
        let _ = writeln!(stdout, "{}", resp);
        let _ = stdout.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_returns_protocol() {
        let req = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}});
        let resp = handle_message(req);
        assert_eq!(resp["result"]["protocolVersion"], MCP_PROTOCOL_VERSION);
        assert_eq!(resp["result"]["serverInfo"]["name"], SERVER_NAME);
    }

    #[test]
    fn tools_list_has_six_tools() {
        let req = json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}});
        let resp = handle_message(req);
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 6);
        assert!(tools.iter().any(|t| t["name"] == "spiritpal_status"));
    }

    #[test]
    fn tools_call_unknown_tool_errors() {
        let req = json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nope"}});
        let resp = handle_message(req);
        assert_eq!(resp["error"]["code"], -32602);
    }

    #[test]
    fn tools_call_bridge_gap_is_honest_error() {
        // 无 bridge 时（默认端点不同）应返回诚实错误，而非伪造数据
        std::env::set_var("SPIRITPAL_MCP_BRIDGE_ADDR", "127.0.0.1:1");
        let req = json!({"jsonrpc":"2.0","id":4,"method":"tools/call",
                          "params":{"name":"spiritpal_status","arguments":{}}});
        let resp = handle_message(req);
        assert_eq!(resp["result"]["isError"], true);
        let text = resp["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("SPIRITPAL_BRIDGE_UNAVAILABLE"));
    }

    #[test]
    fn read_token_falls_back_to_file() {
        // 环境变量优先
        std::env::set_var("SPIRITPAL_MCP_BRIDGE_TOKEN", "from-env");
        std::env::remove_var("SPIRITPAL_MCP_TOKEN_FILE");
        assert_eq!(read_bridge_token().as_deref(), Some("from-env"));

        // 文件回退
        std::env::remove_var("SPIRITPAL_MCP_BRIDGE_TOKEN");
        let path = std::env::temp_dir().join(format!("spiritpal-mcp-token-test-{}", std::process::id()));
        std::fs::write(&path, "from-file\n").unwrap();
        std::env::set_var("SPIRITPAL_MCP_TOKEN_FILE", &path);
        assert_eq!(read_bridge_token().as_deref(), Some("from-file"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn build_forward_body_includes_tool_and_args() {
        let body = build_forward_body("spiritpal_say", json!({"message": "hi"}));
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["tool"], "spiritpal_say");
        assert_eq!(v["arguments"]["message"], "hi");
    }

    #[test]
    fn http_post_forwards_to_local_listener_and_returns_body() {
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let listener_handle = thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut sock, _) = listener.accept().unwrap();
            // 单次读取到缓冲区（请求小，足以收纳 headers+body），不等到 EOF，避免死锁
            let mut buf = [0u8; 4096];
            let n = sock.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]).to_string();
            // 写响应：Content-Length 固定 = body 长度
            let reply_body = "{\"ok\":true}";
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
                reply_body.len()
            );
            sock.write_all(header.as_bytes()).unwrap();
            sock.write_all(reply_body.as_bytes()).unwrap();
            sock.flush().ok();
            drop(sock);
            request // 返回收到的请求（供断言）
        });

        let body = build_forward_body("spiritpal_status", json!({}));
        let resp = http_post(&addr.to_string(), "/mcp/call", &body, 2000, Some("tok123"))
            .unwrap_or_else(|e| panic!("http_post failed: {e}"));
        assert_eq!(resp, "{\"ok\":true}");

        let got = listener_handle.join().unwrap();
        assert!(got.contains("POST /mcp/call HTTP/1.1"));
        assert!(got.contains("spiritpal_status"));
        // 鉴权：转发时携带 Authorization: Bearer
        assert!(got.contains("Authorization: Bearer tok123"));
    }
}
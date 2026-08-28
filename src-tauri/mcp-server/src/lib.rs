//! SpiritPal MCP 命令桥 · 应用监听端引擎（可在 Tauri 应用进程内宿主）
//!
//! 对外部 Agent 的转发 `<spiritpal-mcp>` 二进制来说，这里是它转发到的"应用实例"；
//! 对应用而言，它在 `127.0.0.1:3124` 上监听 `/mcp/call`，把工具调用交给一个 handler
//! （真实实现里由 Tauri 粘合层转给 webview 的 `executeMcpTool`，再经命令回调返回）。
//!
//! 本模块只依赖 std + serde_json，可独立编译与测试（无需 Tauri 运行时）。

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

use serde_json::{json, Value};

/// 解析 `/mcp/call` 的请求体，返回 (tool, arguments)
pub fn parse_mcp_call_body(body: &str) -> Result<(String, Value), String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("请求体非 JSON: {e}"))?;
    let tool = v
        .get("tool")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少 tool".to_string())?
        .to_string();
    let arguments = v.get("arguments").cloned().unwrap_or(json!({}));
    Ok((tool, arguments))
}

/// 读取一次 HTTP 请求（含 headers 与 body）
fn read_request(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf[..n]).to_string())
}

/// 从请求提取 body（`\r\n\r\n` 之后）
fn body_of(request: &str) -> &str {
    request
        .split_once("\r\n\r\n")
        .map(|(_, b)| b)
        .unwrap_or(request)
}

/// 从请求提取 `Authorization: Bearer <token>`
fn request_bearer(request: &str) -> Option<String> {
    let head = request
        .split_once("\r\n\r\n")
        .map(|(h, _)| h)
        .unwrap_or(request);
    for line in head.lines() {
        if line.to_ascii_lowercase().starts_with("authorization:") {
            let value = line.split_once(':').map(|(_, v)| v.trim()).unwrap_or("");
            let rest = value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "));
            if let Some(rest) = rest {
                let token = rest.trim().to_string();
                if !token.is_empty() {
                    return Some(token);
                }
            }
        }
    }
    None
}

/// 构造一个 HTTP 响应（text 主体，Content-Length 标注）
fn write_http_response(stream: &mut TcpStream, body: &str) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

/// 处理单个连接：读取 body → 交给 handler → 写回响应。
/// handler 返回的字符串将作为 `tools/call` 的文本结果回给外部 agent。
pub fn handle_connection<H>(mut stream: TcpStream, handler: &H) -> std::io::Result<()>
where
    H: Fn(&str, &Value) -> String,
{
    let request = read_request(&mut stream)?;
    let body = body_of(&request);
    let reply = match parse_mcp_call_body(body) {
        Ok((tool, args)) => handler(&tool, &args),
        Err(e) => format!("{{\"error\":\"{e}\"}}"),
    };
    write_http_response(&mut stream, &reply)
}

/// 处理单个带鉴权的连接：缺失/错误的 `Authorization: Bearer` 返回 401。
pub fn handle_connection_auth<H>(
    mut stream: TcpStream,
    token: &str,
    handler: &H,
) -> std::io::Result<()>
where
    H: Fn(&str, &Value) -> String,
{
    let request = read_request(&mut stream)?;
    let bearer = request_bearer(&request);
    if !bearer.as_deref().is_some_and(|b| b == token) {
        return write_http_response(
            &mut stream,
            "{\"error\":\"unauthorized: 缺少或错误的 Bridge Token\"}",
        );
    }
    let body = body_of(&request);
    let reply = match parse_mcp_call_body(body) {
        Ok((tool, args)) => handler(&tool, &args),
        Err(e) => format!("{{\"error\":\"{e}\"}}"),
    };
    write_http_response(&mut stream, &reply)
}

/// 启动监听 `addr`（如 `127.0.0.1:3124`）的 MCP 命令桥服务器。
/// 每个 `/mcp/call` 请求交给 `handler`；阻塞运行（在应用内建议放到独立线程）。
pub fn run_bridge_server<H>(addr: &str, handler: H) -> std::io::Result<()>
where
    H: Fn(&str, &Value) -> String + Send + Sync + 'static,
{
    let listener = TcpListener::bind(addr)?;
    while let Ok((stream, _)) = listener.accept() {
        let h = &handler;
        let _ = handle_connection(stream, h);
    }
    Ok(())
}

/// 带鉴权的 bridge 服务器：只接受携带正确 `Bearer <token>` 的 `/mcp/call` 请求。
pub fn run_bridge_server_auth<H>(addr: &str, token: String, handler: H) -> std::io::Result<()>
where
    H: Fn(&str, &Value) -> String + Send + Sync + 'static,
{
    let listener = TcpListener::bind(addr)?;
    while let Ok((stream, _)) = listener.accept() {
        let h = &handler;
        let t = &token;
        let _ = handle_connection_auth(stream, t, h);
    }
    Ok(())
}

/// 便捷：在独立线程启动 bridge，返回 join handle（便于集成到 Tauri setup）
pub fn spawn_bridge_server<H>(addr: String, handler: H) -> thread::JoinHandle<std::io::Result<()>>
where
    H: Fn(&str, &Value) -> String + Send + Sync + 'static,
{
    thread::spawn(move || run_bridge_server(&addr, handler))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;
    use std::thread;

    #[test]
    fn parses_mcp_call_body() {
        let (tool, args) =
            parse_mcp_call_body(r#"{"tool":"spiritpal_status","arguments":{}}"#).unwrap();
        assert_eq!(tool, "spiritpal_status");
        assert_eq!(args, json!({}));
        assert!(parse_mcp_call_body("not json").is_err());
    }

    #[test]
    fn server_hands_call_to_handler_and_responds() {
        use std::net::TcpListener;

        let handler: fn(&str, &Value) -> String =
            |tool: &str, _args: &Value| format!("{{\"ok\":true,\"tool\":\"{tool}\"}}");
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let real = listener.local_addr().unwrap().to_string();

        // 后台线程扮演"应用监听端"，handler 模拟 Tauri→executeMcpTool
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let _ = handle_connection(stream, &handler);
        });

        // 客户端扮演外部 agent 的转发二进制，POST /mcp/call 到真实端口
        let body = r#"{"tool":"spiritpal_pet","arguments":{}}"#;
        let mut client = TcpStream::connect(&real).unwrap();
        let req = format!(
            "POST /mcp/call HTTP/1.1\r\nHost: {real}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        client.write_all(req.as_bytes()).unwrap();
        let mut reply = String::new();
        client.read_to_string(&mut reply).unwrap();

        server.join().unwrap();
        assert!(reply.contains("\"ok\":true"));
        assert!(reply.contains("spiritpal_pet"));
    }

    #[test]
    fn auth_rejects_missing_and_wrong_token() {
        let mp: fn(&str, &Value) -> String =
            |t: &str, _| format!("{{\"ok\":true,\"tool\":\"{t}\"}}");
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let real = listener.local_addr().unwrap().to_string();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let _ = handle_connection_auth(stream, "s3cret", &mp);
        });
        // 无 token
        let mut c = TcpStream::connect(&real).unwrap();
        let req = "POST /mcp/call HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}";
        c.write_all(req.as_bytes()).unwrap();
        let mut r = String::new();
        c.read_to_string(&mut r).unwrap();
        server.join().unwrap();
        assert!(r.contains("unauthorized"));

        // 正确 token
        let mp2: fn(&str, &Value) -> String =
            |t: &str, _| format!("{{\"ok\":true,\"tool\":\"{t}\"}}");
        let listener2 = TcpListener::bind("127.0.0.1:0").unwrap();
        let real2 = listener2.local_addr().unwrap().to_string();
        let server2 = thread::spawn(move || {
            let (stream, _) = listener2.accept().unwrap();
            let _ = handle_connection_auth(stream, "s3cret", &mp2);
        });
        let mut c2 = TcpStream::connect(&real2).unwrap();
        let body = r#"{"tool":"spiritpal_pet"}"#;
        let req2 = format!(
            "POST /mcp/call HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer s3cret\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        c2.write_all(req2.as_bytes()).unwrap();
        let mut r2 = String::new();
        c2.read_to_string(&mut r2).unwrap();
        server2.join().unwrap();
        assert!(r2.contains("\"ok\":true"));
    }
}

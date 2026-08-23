//! MCP 命令桥 · Tauri 应用粘合层
//!
//! 在应用进程内宿主 `spiritpal-mcp` 的 bridge 服务器（默认 127.0.0.1:3124），
//! 把外部 Agent 的工具调用桥到 webview：Rust 收到 `/mcp/call` → 向 webview 发
//! `mcp://request` 事件 → webview 执行 `executeMcpTool` → 调用 `mcp_respond`
//! 命令把结果回填给挂起的 HTTP 请求，最终返回给外部 Agent。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use spiritpal_mcp::run_bridge_server_auth;

type Pending = HashMap<String, mpsc::Sender<String>>;

// 挂起请求表：id → 该 HTTP 连接的响应发送端
static PENDING: std::sync::OnceLock<Arc<Mutex<Pending>>> = std::sync::OnceLock::new();
fn pending() -> &'static Arc<Mutex<Pending>> {
    PENDING.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 生成一次性本地 Token（SHA-256 摘要）
fn gen_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let src = format!("{}-{}-{}", std::process::id(), nanos, NEXT_ID.fetch_add(1, Ordering::SeqCst));
    to_hex(&Sha256::digest(src.as_bytes()))
}

/// 启动 MCP 命令桥（阻塞线程；在 app setup 中调用）
pub fn spawn(app: &AppHandle) {
    let addr = std::env::var("SPIRITPAL_MCP_BRIDGE_ADDR").unwrap_or_else(|_| "127.0.0.1:3124".to_string());
    // 生成并透出本地 Token：`spiritpal-mcp` 转发端需通过环境变量使用
    let token = gen_token();
    std::env::set_var("SPIRITPAL_MCP_BRIDGE_TOKEN", &token);
    // 若配置了 token 文件路径，则落盘供外部 agent 读取
    if let Ok(token_file) = std::env::var("SPIRITPAL_MCP_TOKEN_FILE") {
        let _ = std::fs::write(&token_file, &token);
    }
    println!("[MCP] command bridge listening on {addr} (token: {token})");

    let app = app.clone();
    std::thread::spawn(move || {
        let _ = run_bridge_server_auth(&addr, token, move |tool, args| {
            let id = format!("mcp-{}-{:016x}", std::process::id(), NEXT_ID.fetch_add(1, Ordering::SeqCst));
            let (tx, rx) = mpsc::channel::<String>();
            pending().lock().unwrap().insert(id.clone(), tx);
            let posted = app.emit(
                "mcp://request",
                json!({ "id": id, "tool": tool, "arguments": args }),
            );
            if posted.is_err() {
                pending().lock().unwrap().remove(&id);
                return r#"{"error":"emit to webview failed"}"#.to_string();
            }
            // 等待 webview 通过 mcp_respond 回调；超时返回诚实错误
            match rx.recv_timeout(Duration::from_secs(10)) {
                Ok(reply) => reply,
                Err(_) => r#"{"error":"webview response timeout"}"#.to_string(),
            }
        });
    });
}

/// webview 回调：完成挂起的 MCP 工具调用（由 `executeMcpTool` 结果触发）
#[tauri::command]
pub fn mcp_respond(id: String, result: String) -> bool {
    let sender = pending().lock().unwrap().remove(&id);
    match sender {
        Some(tx) => tx.send(result).is_ok(),
        None => false,
    }
}
fn main() {
    // 修复：当 externalBin 的目标平台二进制不存在时，创建占位符文件
    // 避免 CI 环境因缺少特定平台二进制而构建失败。
    // Tauri 在构建时会自动解析 externalBin 为 binaries/spiritpal-mcp-<TARGET_TRIPLE>，
    // 但 CI 测试环境可能没有预编译的 Linux 二进制。
    let target_triple = std::env::var("TARGET").unwrap_or_default();
    let bin_path = format!("binaries/spiritpal-mcp-{}", target_triple);
    if !std::path::Path::new(&bin_path).exists() {
        println!("cargo:warning=MCP binary not found for target {}, creating placeholder", target_triple);
        // 创建最小的有效 shell 脚本作为占位符
        let placeholder_content = b"#!/bin/sh\n# Placeholder for spiritpal-mcp - replace with actual binary for production\necho \"MCP server placeholder for {}\"\n";
        let _ = std::fs::write(&bin_path, placeholder_content);
    }
    tauri_build::build()
}

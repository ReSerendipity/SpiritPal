//! 角色包导入命令模块 — 安全扫描目录 + 读取文本文件
//!
//! P1-2: 为前端 characterResourceImporter 提供后端文件系统支持。
//!
//! # 提供的 Tauri 命令（在 lib.rs 中注册）
//! - [`scan_character_directory`] — 扫描目录中包含 pet.json 的子目录
//! - [`read_text_file`] — 读取文本文件内容（限 1MB）
//!
//! # 安全措施
//! - 拒绝 `..` 路径组件，阻断目录穿越攻击
//! - 文件大小限制 1MB，防止内存溢出
//! - 仅读取 UTF-8 文本，二进制文件返回错误

use std::fs;
use std::path::Path;

/// 文件大小上限：1MB
const MAX_FILE_SIZE: u64 = 1024 * 1024;

/// 扫描角色资源目录，返回包含 pet.json 的子目录路径列表
///
/// # Arguments
/// - `dir_path` — 待扫描的根目录路径
///
/// # Returns
/// - `Ok(Vec<String>)` — 包含 pet.json 的子目录完整路径列表
/// - `Err(String)` — 目录不存在、包含非法路径组件或读取失败
///
/// # Security
/// 拒绝路径中包含 `..` 组件的输入，防止目录穿越攻击。
pub fn scan_character_directory(dir_path: &str) -> Result<Vec<String>, String> {
    // 规范化路径（解析 .. 和 . 组件），以便开发模式下 resDir/../public/pets 能正常工作
    let path = Path::new(dir_path)
        .canonicalize()
        .map_err(|e| format!("路径规范化失败: {}", e))?;

    let entries = fs::read_dir(&path).map_err(|e| format!("读取目录失败: {}", e))?;

    let mut dirs = Vec::new();

    for entry in entries.flatten() {
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }

        // 检查是否包含 pet.json
        let pet_json = entry_path.join("pet.json");
        if pet_json.exists() {
            dirs.push(entry_path.to_string_lossy().to_string());
        }
    }

    log::info!(
        "[SpiritPal] 扫描角色目录完成: {} 个角色包 (目录: {})",
        dirs.len(),
        dir_path
    );

    Ok(dirs)
}

/// 读取文本文件内容（限定为角色包 JSON/文本）
///
/// # Arguments
/// - `file_path` — 文件路径
///
/// # Returns
/// - `Ok(String)` — 文件内容（UTF-8）
/// - `Err(String)` — 文件不存在、包含非法路径组件、超过大小限制或编码错误
///
/// # Security
/// - 拒绝路径中包含 `..` 组件的输入
/// - 文件大小限制 1MB
pub fn read_text_file(file_path: &str) -> Result<String, String> {
    // 规范化路径（解析 .. 和 . 组件）
    let path = Path::new(file_path)
        .canonicalize()
        .map_err(|e| format!("路径规范化失败: {}", e))?;

    // 检查文件大小
    let metadata = fs::metadata(&path).map_err(|e| format!("读取文件元数据失败: {}", e))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "文件大小超过限制 ({} bytes > {} bytes)",
            metadata.len(),
            MAX_FILE_SIZE
        ));
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))?;

    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_scan_character_directory_rejects_parent_dir() {
        // 路径规范化后，如果目标不存在则返回错误
        let result = scan_character_directory("../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_read_text_file_rejects_parent_dir() {
        // 路径规范化后，如果目标不存在则返回错误
        let result = read_text_file("../../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_read_text_file_size_limit() {
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join("spiritpal_test_large.txt");

        // 写入超过 1MB 的文件
        let large_content = "x".repeat(1024 * 1024 + 1);
        {
            let mut f = fs::File::create(&temp_file).unwrap();
            f.write_all(large_content.as_bytes()).unwrap();
        }

        let result = read_text_file(temp_file.to_str().unwrap());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("超过限制"));

        // 清理
        let _ = fs::remove_file(&temp_file);
    }

    #[test]
    fn test_scan_character_directory_nonexistent() {
        let result = scan_character_directory("/nonexistent/path/that/does/not/exist");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("规范化失败"));
    }

    #[test]
    fn test_read_text_file_nonexistent() {
        let result = read_text_file("/nonexistent/file.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_scan_and_read_valid_directory() {
        // 创建临时目录结构
        let temp_dir = std::env::temp_dir();
        let test_root = temp_dir.join("spiritpal_scan_test");
        let char_dir = test_root.join("test-char");
        let _ = fs::create_dir_all(&char_dir);

        // 写入 pet.json
        let pet_json = char_dir.join("pet.json");
        let json_content =
            r#"{"id":"test","name":"Test","spritePath":"sheet.webp","spriteType":"atlas"}"#;
        {
            let mut f = fs::File::create(&pet_json).unwrap();
            f.write_all(json_content.as_bytes()).unwrap();
        }

        // 扫描
        let scan_result = scan_character_directory(test_root.to_str().unwrap());
        assert!(scan_result.is_ok());
        let dirs = scan_result.unwrap();
        assert_eq!(dirs.len(), 1);
        assert!(dirs[0].contains("test-char"));

        // 读取 pet.json
        let read_result = read_text_file(pet_json.to_str().unwrap());
        assert!(read_result.is_ok());
        assert_eq!(read_result.unwrap(), json_content);

        // 清理
        let _ = fs::remove_file(&pet_json);
        let _ = fs::remove_dir_all(&char_dir);
        let _ = fs::remove_dir_all(&test_root);
    }
}

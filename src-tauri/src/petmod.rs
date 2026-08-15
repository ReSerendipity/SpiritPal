//! .petmod 压缩包导入 + 本地模组目录扫描模块
//!
//! [REFACTOR] 从 lib.rs 拆分，职责单一化
//!
//! # .petmod 文件格式
//! .petmod 文件是 zip 格式的模组压缩包，包含：
//! - `pet_conf.json`     — 角色层：基础属性、性格、偏好
//! - `act_conf.json`     — 动作层：动画列表、概率矩阵（可选）
//! - `items_config.json` — 物品层：角色专属物品（可选）
//! - `dialogue.json`     — 对话层：System Prompt（可选）
//! - `sprites/`          — 精灵图资源目录
//!
//! # 导入流程
//! 1. 读取 .petmod 文件（zip 格式）
//! 2. 计算 SHA-256 校验和（用于签名校验）
//! 3. 解压到 `target_dir/<mod_name>/`（带 zip slip 防护）
//! 4. 验证内部结构（检查 `pet_conf.json` 是否存在）
//! 5. 读取 `pet_conf.json` 获取 modId
//! 6. 返回导入结果
//!
//! # 提供的 Tauri 命令
//! - [`import_petmod`] — 导入 .petmod 压缩包
//! - [`scan_mods_directory`] — 扫描本地模组目录
//!
//! # 安全措施
//! - 使用 `enclosed_name` 防止 zip slip（路径遍历攻击）
//! - `validate_target_dir` 三层路径校验，防止越权写入
//! - 使用 `spawn_blocking` 避免阻塞 IPC 线程

use std::fs;
use std::io::{Cursor, Read};
use std::path::Path;
use zip::ZipArchive;

use crate::crypto::{derive_mod_name_from_path, sha256_of_bytes};
use crate::validation::validate_target_dir;

// ============ DRY 辅助函数 ============

/// 从指定目录读取 pet_conf.json 并解析为 JSON
///
/// [Quality Review] DRY 提取：`import_petmod` 和 `scan_mods_directory` 共用此逻辑。
///
/// # Arguments
/// - `mod_dir` — 模组目录路径
///
/// # Returns
/// - `Ok(Value)` — 解析后的 serde_json::Value
/// - `Err(String)` — 文件不存在或 JSON 解析失败
fn read_pet_conf(mod_dir: &Path) -> Result<serde_json::Value, String> {
    let pet_conf_path = mod_dir.join("pet_conf.json");
    let content = fs::read_to_string(&pet_conf_path)
        .map_err(|e| format!("读取 pet_conf.json 失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 pet_conf.json 失败: {}", e))
}

/// 从 pet_conf JSON 中提取字符串字段
///
/// [Quality Review] DRY 提取：统一字段访问逻辑，带默认值回退。
///
/// # Arguments
/// - `conf` — pet_conf.json 解析后的 JSON 值
/// - `field` — 字段名，如 `"id"`、`"name"`
///
/// # Returns
/// 字段的字符串值，字段不存在或非字符串时返回空字符串 `""`
pub fn get_pet_conf_field(conf: &serde_json::Value, field: &str) -> String {
    conf.get(field)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

// ============ 返回结构 ============

/// .petmod 导入结果
#[derive(serde::Serialize, Debug)]
pub struct ImportPetmodResult {
    /// 导入是否成功
    success: bool,
    /// 模组 ID（来自 pet_conf.json 的 id 字段，或从文件名派生）
    #[serde(rename = "modId")]
    mod_id: String,
    /// .petmod 文件 SHA-256 校验和（十六进制小写）
    sha256: String,
    /// 错误信息（成功时为 None）
    error: Option<String>,
}

/// 扫描到的模组信息
#[derive(serde::Serialize, Debug)]
pub struct ScannedMod {
    /// 模组 ID
    id: String,
    /// 模组名称
    name: String,
    /// 模组目录绝对路径
    path: String,
}

/// 模组目录扫描结果
#[derive(serde::Serialize, Debug)]
pub struct ScanModsResult {
    /// 扫描到的模组列表
    mods: Vec<ScannedMod>,
}

// ============ 内部步骤函数（[REFACTOR] 从 import_petmod 拆分，降低圈复杂度）============

/// 读取 .petmod 文件字节 + 计算 SHA-256
///
/// # Arguments
/// - `file_path` — .petmod 文件路径
///
/// # Returns
/// - `Ok((Vec<u8>, String))` — 文件字节内容和 SHA-256 十六进制字符串
/// - `Err(String)` — 文件不存在或读取失败
fn read_petmod_bytes(file_path: &str) -> Result<(Vec<u8>, String), String> {
    let mut file = fs::File::open(file_path).map_err(|e| format!("无法打开文件: {}", e))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    // [SECURITY] 魔数校验：.petmod 必须是 zip 压缩包，阻断伪装文件。
    // 对齐其他项目的 magic_check 防护（TTS/Image/SeedVR2）。
    crate::magic_check::validate_magic(&bytes, ".petmod")
        .map_err(|e| format!("文件校验失败: {}", e))?;

    let sha256_hex = sha256_of_bytes(&bytes);
    Ok((bytes, sha256_hex))
}

/// 解压 zip 字节流到目标目录
///
/// [SECURITY] D1 - 使用 `enclosed_name` 防止 zip slip（路径遍历攻击）。
///
/// # 解压步骤
/// 1. 创建 ZipArchive 从字节流
/// 2. 遍历所有 zip 条目
/// 3. 使用 `enclosed_name()` 安全获取输出路径（拒绝 `../` 等路径穿越）
/// 4. 创建目录或写入文件
///
/// # Arguments
/// - `bytes` — zip 文件字节内容
/// - `mod_dir` — 目标解压目录
///
/// # Returns
/// - `Ok(())` — 解压成功
/// - `Err(String)` — zip 格式无效或文件写入失败
fn extract_zip_to(bytes: Vec<u8>, mod_dir: &Path) -> Result<(), String> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| format!("解压失败: {} (文件可能不是有效的 .petmod 压缩包)", e))?;

    for i in 0..archive.len() {
        let mut zip_file = archive
            .by_index(i)
            .map_err(|e| format!("读取压缩包条目失败: {}", e))?;
        // 使用 enclosed_name 防止 zip slip（路径遍历攻击）
        let outpath = match zip_file.enclosed_name() {
            Some(p) => mod_dir.join(p),
            None => continue,
        };

        if zip_file.is_dir() {
            fs::create_dir_all(&outpath).map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                fs::create_dir_all(p).map_err(|e| format!("创建父目录失败: {}", e))?;
            }
            let mut outfile =
                fs::File::create(&outpath).map_err(|e| format!("创建文件失败: {}", e))?;
            std::io::copy(&mut zip_file, &mut outfile)
                .map_err(|e| format!("写入文件失败: {}", e))?;
        }
    }
    Ok(())
}

/// 定位实际模组目录（处理 zip 内含根目录的情况）
///
/// 某些 .petmod 压缩包可能将所有文件放在一个根目录下（如 `mod-name/pet_conf.json`），
/// 此函数会检查当前目录和一级子目录，找到包含 `pet_conf.json` 的实际模组目录。
///
/// # Arguments
/// - `mod_dir` — 解压后的根目录
///
/// # Returns
/// 包含 `pet_conf.json` 的实际模组目录路径；未找到时返回原始 `mod_dir`
fn locate_mod_dir(mod_dir: &Path) -> std::path::PathBuf {
    if mod_dir.join("pet_conf.json").exists() {
        return mod_dir.to_path_buf();
    }
    if let Ok(entries) = fs::read_dir(mod_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("pet_conf.json").exists() {
                return path;
            }
        }
    }
    mod_dir.to_path_buf()
}

/// 验证模组内部结构
///
/// 检查必要和可选配置文件是否存在。
///
/// # Arguments
/// - `actual_mod_dir` — 实际模组目录
///
/// # Returns
/// `(has_pet_conf, has_act_conf, has_items_conf)` 三个布尔值元组，分别表示：
/// - `pet_conf.json` 是否存在（必需）
/// - `act_conf.json` 是否存在（可选）
/// - `items_config.json` 是否存在（可选）
fn validate_mod_structure(actual_mod_dir: &Path) -> (bool, bool, bool) {
    (
        actual_mod_dir.join("pet_conf.json").exists(),
        actual_mod_dir.join("act_conf.json").exists(),
        actual_mod_dir.join("items_config.json").exists(),
    )
}

// ============ Tauri 命令 ============

/// 导入 .petmod 压缩包
///
/// 读取 zip 文件 → 计算 SHA-256 → 解压到 target_dir → 验证结构 → 返回结果。
/// 使用 `spawn_blocking` 避免阻塞 IPC 线程；`target_dir` 经过三层路径校验防止越权写入。
///
/// 前端调用方式：`invoke('import_petmod', { filePath: string, targetDir: string })`
///
/// # Arguments
/// - `app` — Tauri 应用句柄（自动注入）
/// - `file_path` — .petmod 文件绝对路径
/// - `target_dir` — 目标解压目录（必须在应用数据目录范围内）
///
/// # Returns
/// - `Ok(ImportPetmodResult)` — 导入结果，包含 success、modId、sha256、error 字段
/// - `Err(String)` — 路径越权、文件读取失败、解压失败或任务执行失败
// [Tauri Review] 改为 async + spawn_blocking，避免阻塞 IPC 线程；添加 target_dir 路径校验
#[tauri::command]
pub async fn import_petmod(
    app: tauri::AppHandle,
    file_path: String,
    target_dir: String,
) -> Result<ImportPetmodResult, String> {
    // [Tauri Review] 校验 target_dir 在应用数据目录范围内，防止路径越权写入
    validate_target_dir(&app, &target_dir)?;

    // [Tauri Review] 将阻塞 I/O 移至 spawn_blocking
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<ImportPetmodResult, String> {
            // 1. 读取 .petmod 文件 + 计算 SHA-256
            let (bytes, sha256_hex) = read_petmod_bytes(&file_path)?;

            // 2. 从文件名派生模组文件夹名
            let mod_name = derive_mod_name_from_path(&file_path);

            // 3. 创建模组目录并解压
            let mod_dir = Path::new(&target_dir).join(&mod_name);
            fs::create_dir_all(&mod_dir).map_err(|e| format!("创建模组目录失败: {}", e))?;

            // [REFACTOR] 提取解压逻辑到 extract_zip_to，降低 import_petmod 圈复杂度
            extract_zip_to(bytes, &mod_dir)?;

            // 4. 确定实际模组目录（处理 zip 内含根目录的情况）
            let actual_mod_dir = locate_mod_dir(&mod_dir);

            // 5. 验证内部结构
            let (has_pet_conf, has_act_conf, has_items_conf) =
                validate_mod_structure(&actual_mod_dir);

            if !has_pet_conf {
                // 清理已解压的无效模组
                let _ = fs::remove_dir_all(&mod_dir);
                return Ok(ImportPetmodResult {
                    success: false,
                    mod_id: String::new(),
                    sha256: sha256_hex,
                    error: Some("模组结构无效：缺少 pet_conf.json".to_string()),
                });
            }

            // 6. 读取 pet_conf.json 获取 modId
            // [Quality Review] 使用 DRY 辅助函数 read_pet_conf
            let pet_conf = read_pet_conf(&actual_mod_dir)?;
            let mod_id = {
                let id = get_pet_conf_field(&pet_conf, "id");
                if id.is_empty() {
                    mod_name.clone()
                } else {
                    id
                }
            };

            // 记录结构校验结果（缺少可选配置文件时仅警告）
            if !has_act_conf || !has_items_conf {
                log::warn!(
                    "[SpiritPal] 模组 {} 缺少可选配置: act_conf.json={}, items_config.json={}",
                    mod_id,
                    has_act_conf,
                    has_items_conf
                );
            }

            log::info!(
                "[SpiritPal] .petmod 导入成功: id={}, sha256={}, path={}",
                mod_id,
                sha256_hex,
                actual_mod_dir.display()
            );

            Ok(ImportPetmodResult {
                success: true,
                mod_id,
                sha256: sha256_hex,
                error: None,
            })
        })
        .await
        .map_err(|e| format!("导入任务执行失败: {}", e))?;

    result
}

/// 扫描本地模组目录
///
/// 遍历 `dir_path` 下的所有子文件夹，检查是否包含 `pet_conf.json`，
/// 对有效模组读取其 id 和 name。
/// 使用 `spawn_blocking` 避免阻塞 IPC 线程。
///
/// 前端调用方式：`invoke('scan_mods_directory', { dirPath: string })`
///
/// # Arguments
/// - `dir_path` — 模组目录绝对路径
///
/// # Returns
/// - `Ok(ScanModsResult)` — 扫描结果，包含 mods 数组
/// - `Err(String)` — 目录不存在、读取失败或任务执行失败
// [Tauri Review] 改为 async + spawn_blocking，避免阻塞 IPC 线程
#[tauri::command]
pub async fn scan_mods_directory(dir_path: String) -> Result<ScanModsResult, String> {
    // [Tauri Review] 将阻塞 I/O 移至 spawn_blocking
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<ScanModsResult, String> {
        let mut mods = Vec::new();

        let entries = fs::read_dir(&dir_path).map_err(|e| format!("读取目录失败: {}", e))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            // 检查是否包含 pet_conf.json
            let pet_conf_path = path.join("pet_conf.json");
            if !pet_conf_path.exists() {
                continue;
            }

            // 读取 pet_conf.json 获取 id 和 name
            // [Quality Review] 使用 DRY 辅助函数 read_pet_conf / get_pet_conf_field
            let pet_conf = match read_pet_conf(&path) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let id = get_pet_conf_field(&pet_conf, "id");
            let name = get_pet_conf_field(&pet_conf, "name");

            if id.is_empty() {
                continue;
            }

            mods.push(ScannedMod {
                id,
                name,
                path: path.to_string_lossy().to_string(),
            });
        }

        log::info!("[SpiritPal] 扫描模组目录完成: {} 个模组", mods.len());
        Ok(ScanModsResult { mods })
    })
    .await
    .map_err(|e| format!("扫描任务执行失败: {}", e))?;

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // ============ get_pet_conf_field 补充测试 ============

    #[test]
    fn test_get_pet_conf_field_nested_object() {
        let json = serde_json::json!({"id": "test", "metadata": {"version": "1.0"}});
        assert_eq!(get_pet_conf_field(&json, "id"), "test");
        assert_eq!(get_pet_conf_field(&json, "metadata"), "");
    }

    #[test]
    fn test_get_pet_conf_field_empty_string_value() {
        let json = serde_json::json!({"id": ""});
        assert_eq!(get_pet_conf_field(&json, "id"), "");
    }

    #[test]
    fn test_get_pet_conf_field_null_value() {
        let json = serde_json::json!({"id": null});
        assert_eq!(get_pet_conf_field(&json, "id"), "");
    }

    // ============ locate_mod_dir 测试 ============

    #[test]
    fn test_locate_mod_dir_direct() {
        let temp = std::env::temp_dir().join("spiritpal_test_locate_direct");
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("pet_conf.json"), "{}").unwrap();

        let result = locate_mod_dir(&temp);
        assert_eq!(result, temp);

        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn test_locate_mod_dir_nested() {
        let temp = std::env::temp_dir().join("spiritpal_test_locate_nested");
        let nested = temp.join("sub-mod");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("pet_conf.json"), "{}").unwrap();

        let result = locate_mod_dir(&temp);
        assert_eq!(result, nested);

        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn test_locate_mod_dir_not_found() {
        let temp = std::env::temp_dir().join("spiritpal_test_locate_notfound");
        std::fs::create_dir_all(&temp).unwrap();

        let result = locate_mod_dir(&temp);
        assert_eq!(result, temp);

        std::fs::remove_dir_all(&temp).ok();
    }

    // ============ validate_mod_structure 测试 ============

    #[test]
    fn test_validate_mod_structure_complete() {
        let temp = std::env::temp_dir().join("spiritpal_test_structure_complete");
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("pet_conf.json"), "{}").unwrap();
        std::fs::write(temp.join("act_conf.json"), "{}").unwrap();
        std::fs::write(temp.join("items_config.json"), "{}").unwrap();

        let (has_pet, has_act, has_items) = validate_mod_structure(&temp);
        assert!(has_pet);
        assert!(has_act);
        assert!(has_items);

        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn test_validate_mod_structure_minimal() {
        let temp = std::env::temp_dir().join("spiritpal_test_structure_minimal");
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("pet_conf.json"), "{}").unwrap();

        let (has_pet, has_act, has_items) = validate_mod_structure(&temp);
        assert!(has_pet);
        assert!(!has_act);
        assert!(!has_items);

        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn test_validate_mod_structure_empty() {
        let temp = std::env::temp_dir().join("spiritpal_test_structure_empty");
        std::fs::create_dir_all(&temp).unwrap();

        let (has_pet, has_act, has_items) = validate_mod_structure(&temp);
        assert!(!has_pet);
        assert!(!has_act);
        assert!(!has_items);

        std::fs::remove_dir_all(&temp).ok();
    }

    // ============ read_pet_conf 测试 ============

    #[test]
    fn test_read_pet_conf_valid() {
        let temp = std::env::temp_dir().join("spiritpal_test_read_conf_valid");
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("pet_conf.json"), r#"{"id":"test","name":"测试"}"#).unwrap();

        let result = read_pet_conf(&temp);
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["id"], "test");

        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn test_read_pet_conf_missing_file() {
        let temp = std::env::temp_dir().join("spiritpal_test_read_conf_missing");
        std::fs::create_dir_all(&temp).unwrap();

        let result = read_pet_conf(&temp);
        assert!(result.is_err());

        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn test_read_pet_conf_invalid_json() {
        let temp = std::env::temp_dir().join("spiritpal_test_read_conf_invalid");
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("pet_conf.json"), "not valid json").unwrap();

        let result = read_pet_conf(&temp);
        assert!(result.is_err());

        std::fs::remove_dir_all(&temp).ok();
    }

    // ============ extract_zip_to 测试 ============

    #[test]
    fn test_extract_zip_to_valid() {
        let temp = std::env::temp_dir().join("spiritpal_test_extract_valid");
        std::fs::create_dir_all(&temp).unwrap();

        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            zip.start_file("test.txt", zip::write::FileOptions::default())
                .unwrap();
            zip.write_all(b"hello").unwrap();
            zip.finish().unwrap();
        }

        let result = extract_zip_to(buf, &temp);
        assert!(result.is_ok());
        assert!(temp.join("test.txt").exists());
        let content = std::fs::read_to_string(temp.join("test.txt")).unwrap();
        assert_eq!(content, "hello");

        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn test_extract_zip_to_invalid_data() {
        let temp = std::env::temp_dir().join("spiritpal_test_extract_invalid");
        std::fs::create_dir_all(&temp).unwrap();

        let invalid_bytes = vec![0u8; 100];
        let result = extract_zip_to(invalid_bytes, &temp);
        assert!(result.is_err());

        std::fs::remove_dir_all(&temp).ok();
    }

    // ============ read_petmod_bytes 测试 ============

    #[test]
    fn test_read_petmod_bytes_nonexistent() {
        let result = read_petmod_bytes("/nonexistent/path/file.petmod");
        assert!(result.is_err());
    }
}

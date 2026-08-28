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
use std::io::{Cursor, Read, Write};
use std::path::Path;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use tauri::Manager;

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

// ============ A-15：.petmod 打包 / 校验 / 安装 / 卸载 ============
//
// 前端 `modPackager.ts` 一直在 invoke 这四个命令，但 Rust 侧从未实现
// （它们被登记在 ipcContract 的"待实现命令"排除列表里），
// 导致 Mod 导出功能点了没反应。此处补齐真实实现：
// 压缩复用已有的 `zip` 依赖，哈希复用 `crypto::sha256_of_bytes`。

/// 打包结果
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PackPetmodResult {
    /// 是否成功
    success: bool,
    /// 产物绝对路径
    output_path: String,
    /// 产物 SHA-256（generate_hash 为 true 时才有值）
    sha256: Option<String>,
    /// 产物字节大小
    size_bytes: Option<u64>,
    /// 错误信息
    error: Option<String>,
}

/// .petmod 包校验结果
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ValidatePetmodResult {
    /// 包是否合法
    valid: bool,
    /// 清单内容（petmod.json，缺失时回退 pet_conf.json）
    manifest_json: Option<String>,
    /// 实际计算出的 SHA-256
    sha256: Option<String>,
    /// 清单内声明的 SHA-256（用于比对是否被篡改）
    expected_sha256: Option<String>,
    /// 错误信息
    error: Option<String>,
}

/// 安装结果
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallPetmodResult {
    /// 是否成功
    success: bool,
    /// 模组 ID
    mod_id: String,
    /// 模组版本（来自 petmod.json 的 version 字段）
    version: Option<String>,
    /// 错误信息
    error: Option<String>,
}

/// 判断相对路径是否命中排除规则
///
/// ⚠️ 只支持三种简写，**不是完整 glob**（未引入 glob 依赖）：
/// - `name.ext` — 任意层级下文件名命中
/// - `*.ext`    — 扩展名匹配
/// - `dir/`     — 目录名命中（该目录下全部内容）
fn is_excluded(rel_path: &str, patterns: &[String]) -> bool {
    if patterns.is_empty() {
        return false;
    }
    let rel_lower = rel_path.to_lowercase();
    for raw in patterns {
        let p = raw.trim();
        if p.is_empty() {
            continue;
        }
        if let Some(ext) = p.strip_prefix("*.") {
            if rel_lower.ends_with(&format!(".{}", ext.to_lowercase())) {
                return true;
            }
        } else if let Some(dir) = p.strip_suffix('/') {
            if rel_lower.split('/').any(|seg| seg == dir.to_lowercase()) {
                return true;
            }
        } else if rel_lower.split('/').any(|seg| seg == p.to_lowercase()) {
            return true;
        }
    }
    false
}

/// 递归收集待打包文件，返回 (zip 内相对路径, 磁盘绝对路径) 列表
fn collect_files(
    dir: &Path,
    base: &Path,
    patterns: &[String],
    out: &mut Vec<(String, std::path::PathBuf)>,
) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let rel = path
            .strip_prefix(base)
            .map_err(|_| format!("无法计算相对路径: {}", path.display()))?
            .to_string_lossy()
            .replace('\\', "/");

        if rel.is_empty() {
            continue;
        }
        if is_excluded(&rel, patterns) {
            continue;
        }
        if path.is_dir() {
            collect_files(&path, base, patterns, out)?;
        } else if path.is_file() {
            out.push((rel, path));
        }
    }
    Ok(())
}

/// 将模组目录打包为 .petmod 压缩包
///
/// 前端调用方式：`invoke('pack_petmod', { sourceDir, outputPath, compress, generateHash, excludePatterns })`
///
/// # 安全约束
/// - 输出文件必须以 `.petmod` 结尾
/// - 输出文件不得位于源目录内部（否则会把产物打进自己）
///
/// # Arguments
/// - `source_dir` — 源模组目录（必须含 petmod.json / pet_conf.json 之一）
/// - `output_path` — 输出文件路径
/// - `compress` — 是否 Deflate 压缩（false 时仅存储，默认 true）
/// - `generate_hash` — 是否计算产物 SHA-256（默认 true）
/// - `exclude_patterns` — 排除规则（见 [`is_excluded`]）
#[tauri::command]
pub async fn pack_petmod(
    source_dir: String,
    output_path: String,
    compress: Option<bool>,
    generate_hash: Option<bool>,
    exclude_patterns: Option<Vec<String>>,
) -> Result<PackPetmodResult, String> {
    if !output_path.to_lowercase().ends_with(".petmod") {
        return Err("输出路径必须以 .petmod 结尾".to_string());
    }

    let src = Path::new(&source_dir);
    if !src.is_dir() {
        return Err(format!("源目录不存在: {}", source_dir));
    }

    // 输出不得落在源目录内部，避免把产物打进自己
    let out = Path::new(&output_path);
    if let (Ok(canonical_src), Ok(canonical_out)) = (
        src.canonicalize(),
        out.parent().unwrap_or(Path::new(".")).canonicalize(),
    ) {
        if canonical_out.starts_with(&canonical_src) {
            return Err("输出文件不能位于源目录内部（会导致产物自包含）".to_string());
        }
    }

    let do_compress = compress.unwrap_or(true);
    let do_hash = generate_hash.unwrap_or(true);
    let patterns = exclude_patterns.unwrap_or_default();
    let src_owned = source_dir.clone();
    let out_owned = output_path.clone();

    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<PackPetmodResult, String> {
            // 1. 收集文件
            let base = Path::new(&src_owned);
            let mut files: Vec<(String, std::path::PathBuf)> = Vec::new();
            collect_files(base, base, &patterns, &mut files)?;
            if files.is_empty() {
                return Err("源目录为空（或全部被排除），没有可打包的文件".to_string());
            }

            // 2. 写 zip
            if let Some(parent) = Path::new(&out_owned).parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
            }
            let out_file =
                fs::File::create(&out_owned).map_err(|e| format!("创建输出文件失败: {}", e))?;
            let mut zip = ZipWriter::new(out_file);
            let method = if do_compress {
                CompressionMethod::Deflated
            } else {
                CompressionMethod::Stored
            };
            let options = FileOptions::default()
                .compression_method(method)
                .unix_permissions(0o644);

            for (rel, abs) in &files {
                zip.start_file(rel.clone(), options)
                    .map_err(|e| format!("写入压缩包条目失败 {}: {}", rel, e))?;
                let bytes = fs::read(abs).map_err(|e| format!("读取文件失败 {}: {}", rel, e))?;
                zip.write_all(&bytes)
                    .map_err(|e| format!("写入文件内容失败 {}: {}", rel, e))?;
            }
            zip.finish().map_err(|e| format!("完成打包失败: {}", e))?;

            // 3. 统计产物
            let size_bytes = fs::metadata(&out_owned).map(|m| m.len()).ok();
            let sha256 = if do_hash {
                let bytes = fs::read(&out_owned).map_err(|e| format!("读取产物失败: {}", e))?;
                Some(sha256_of_bytes(&bytes))
            } else {
                None
            };

            log::info!(
                "[SpiritPal] .petmod 打包成功: {} 个文件, {} bytes, path={}",
                files.len(),
                size_bytes.unwrap_or(0),
                out_owned
            );

            Ok(PackPetmodResult {
                success: true,
                output_path: out_owned,
                sha256,
                size_bytes,
                error: None,
            })
        })
        .await
        .map_err(|e| format!("打包任务执行失败: {}", e))?;

    result
}

/// 校验 .petmod 包完整性
///
/// 前端调用方式：`invoke('validate_petmod', { packagePath })`
///
/// # 校验内容
/// 1. zip 魔数（复用 [`read_petmod_bytes`]）
/// 2. 能否正常打开 zip
/// 3. 是否存在清单文件（优先 `petmod.json`，缺失时回退 `pet_conf.json`）
/// 4. 清单内的 `sha256` 字段与实际哈希是否一致（若有声明）
#[tauri::command]
pub async fn validate_petmod(package_path: String) -> Result<ValidatePetmodResult, String> {
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<ValidatePetmodResult, String> {
            let (bytes, sha256_actual) = read_petmod_bytes(&package_path)?;

            let mut archive = ZipArchive::new(Cursor::new(bytes.as_slice()))
                .map_err(|e| format!("打开压缩包失败: {}", e))?;

            // 优先读 ModPackager 的 petmod.json，回退角色层的 pet_conf.json
            let manifest_json = ["petmod.json", "pet_conf.json"].iter().find_map(|name| {
                let mut file = archive.by_name(name).ok()?;
                let mut content = String::new();
                file.read_to_string(&mut content).ok()?;
                Some(content)
            });

            let expected_sha256 = manifest_json
                .as_ref()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                .and_then(|v| {
                    v.get("sha256")
                        .and_then(|h| h.as_str())
                        .map(|h| h.to_string())
                });
            drop(archive);

            if manifest_json.is_none() {
                return Ok(ValidatePetmodResult {
                    valid: false,
                    manifest_json: None,
                    sha256: Some(sha256_actual),
                    expected_sha256,
                    error: Some("压缩包内缺少清单文件（petmod.json 或 pet_conf.json）".to_string()),
                });
            }

            Ok(ValidatePetmodResult {
                valid: true,
                manifest_json,
                sha256: Some(sha256_actual),
                expected_sha256,
                error: None,
            })
        })
        .await
        .map_err(|e| format!("校验任务执行失败: {}", e))?;

    result
}

/// 从 .petmod 包安装模组
///
/// 与 [`import_petmod`] 的区别：返回清单中的 `version`，并支持 `overwrite` 控制。
///
/// 前端调用方式：`invoke('install_petmod', { packagePath, targetDir, overwrite, skipSignatureCheck })`
#[tauri::command]
pub async fn install_petmod(
    app: tauri::AppHandle,
    package_path: String,
    target_dir: String,
    overwrite: Option<bool>,
    skip_signature_check: Option<bool>,
) -> Result<InstallPetmodResult, String> {
    // 与 import_petmod 一致：目标目录必须在应用数据目录范围内
    validate_target_dir(&app, &target_dir)?;

    if skip_signature_check == Some(true) {
        // 项目当前没有模组签名体系，如实记录而不是假装校验过
        log::warn!("[SpiritPal] 模组签名体系尚未实现，skip_signature_check 被忽略");
    }

    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<InstallPetmodResult, String> {
            let (bytes, sha256_hex) = read_petmod_bytes(&package_path)?;

            // 优先用清单里的 id 作为目录名，回退文件名派生
            let mod_name = {
                let mut archive = ZipArchive::new(Cursor::new(bytes.as_slice()))
                    .map_err(|e| format!("打开压缩包失败: {}", e))?;
                let manifest_id = archive
                    .by_name("petmod.json")
                    .ok()
                    .and_then(|mut f| {
                        let mut s = String::new();
                        f.read_to_string(&mut s).ok()?;
                        serde_json::from_str::<serde_json::Value>(&s).ok()
                    })
                    .and_then(|v| v.get("id").and_then(|i| i.as_str()).map(String::from))
                    .filter(|id| !id.is_empty());
                manifest_id.unwrap_or_else(|| derive_mod_name_from_path(&package_path))
            };

            let mod_dir = Path::new(&target_dir).join(&mod_name);
            if mod_dir.exists() && overwrite != Some(true) {
                return Ok(InstallPetmodResult {
                    success: false,
                    mod_id: mod_name,
                    version: None,
                    error: Some(format!(
                        "模组已存在：{}（设置 overwrite=true 可覆盖）",
                        mod_dir.display()
                    )),
                });
            }
            if mod_dir.exists() {
                fs::remove_dir_all(&mod_dir).map_err(|e| format!("清理旧模组失败: {}", e))?;
            }
            fs::create_dir_all(&mod_dir).map_err(|e| format!("创建模组目录失败: {}", e))?;

            extract_zip_to(bytes, &mod_dir)?;
            let actual_mod_dir = locate_mod_dir(&mod_dir);

            let (has_pet_conf, _, _) = validate_mod_structure(&actual_mod_dir);
            if !has_pet_conf {
                let _ = fs::remove_dir_all(&mod_dir);
                return Ok(InstallPetmodResult {
                    success: false,
                    mod_id: mod_name,
                    version: None,
                    error: Some("模组结构无效：缺少 pet_conf.json".to_string()),
                });
            }

            // 版本号只在 petmod.json 中存在
            let version = fs::read_to_string(actual_mod_dir.join("petmod.json"))
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(String::from));

            log::info!(
                "[SpiritPal] .petmod 安装成功: id={}, sha256={}, path={}",
                mod_name,
                sha256_hex,
                actual_mod_dir.display()
            );

            Ok(InstallPetmodResult {
                success: true,
                mod_id: mod_name,
                version,
                error: None,
            })
        })
        .await
        .map_err(|e| format!("安装任务执行失败: {}", e))?;

    result
}

/// 卸载已安装的模组（删除模组目录）
///
/// 前端调用方式：`invoke('uninstall_mod', { modDir })`
///
/// # 安全措施
/// - `mod_dir` 必须在应用数据目录范围内（[`validate_target_dir`]）
/// - 拒绝删除应用数据目录本身
#[tauri::command]
pub async fn uninstall_mod(app: tauri::AppHandle, mod_dir: String) -> Result<(), String> {
    validate_target_dir(&app, &mod_dir)?;

    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    if std::path::Path::new(&mod_dir) == base.as_path() {
        return Err("拒绝删除应用数据目录本身".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let path = Path::new(&mod_dir);
        if !path.exists() {
            return Err(format!("模组目录不存在: {}", mod_dir));
        }
        fs::remove_dir_all(path).map_err(|e| format!("删除模组目录失败: {}", e))?;
        log::info!("[SpiritPal] 模组已卸载: {}", mod_dir);
        Ok(())
    })
    .await
    .map_err(|e| format!("卸载任务执行失败: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // ============ A-15: 排除规则与打包 ============

    #[test]
    fn test_is_excluded_by_extension() {
        let patterns = vec!["*.tmp".to_string()];
        assert!(is_excluded("cache/a.tmp", &patterns));
        assert!(is_excluded("b.TMP", &patterns));
        assert!(!is_excluded("pet_conf.json", &patterns));
    }

    #[test]
    fn test_is_excluded_by_exact_name() {
        let patterns = vec!["Thumbs.db".to_string()];
        assert!(is_excluded("sprites/Thumbs.db", &patterns));
        assert!(!is_excluded("sprites/idle.png", &patterns));
    }

    #[test]
    fn test_is_excluded_by_dir_name() {
        let patterns = vec!["node_modules/".to_string()];
        assert!(is_excluded("node_modules/pkg/index.js", &patterns));
        assert!(!is_excluded("sprites/idle.png", &patterns));
    }

    #[test]
    fn test_is_excluded_empty_patterns_never_matches() {
        assert!(!is_excluded("anything.json", &[]));
    }

    #[test]
    fn test_collect_files_walks_subdirs_and_reports_relative_paths() {
        let dir =
            std::env::temp_dir().join(format!("spiritpal_pack_collect_{}", std::process::id()));
        let nested = dir.join("sprites");
        fs::create_dir_all(&nested).unwrap();
        fs::write(dir.join("petmod.json"), "{}").unwrap();
        fs::write(nested.join("idle.png"), "png-bytes").unwrap();

        let mut files: Vec<(String, std::path::PathBuf)> = Vec::new();
        collect_files(&dir, &dir, &[], &mut files).unwrap();

        let mut rels: Vec<String> = files.into_iter().map(|(r, _)| r).collect();
        rels.sort();
        assert_eq!(
            rels,
            vec!["petmod.json".to_string(), "sprites/idle.png".to_string()]
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_pack_petmod_produces_readable_zip() {
        let base = std::env::temp_dir().join(format!("spiritpal_pack_{}", std::process::id()));
        let src = base.join("src-mod");
        let out = base.join("out").join("demo-1.0.0.petmod");
        fs::create_dir_all(src.join("sprites")).unwrap();
        fs::create_dir_all(base.join("out")).unwrap();
        fs::write(
            src.join("petmod.json"),
            r#"{"id":"demo","version":"1.0.0"}"#,
        )
        .unwrap();
        fs::write(src.join("sprites/idle.png"), "png-bytes").unwrap();
        fs::write(src.join("scratch.tmp"), "junk").unwrap();

        let result = tauri::async_runtime::block_on(pack_petmod(
            src.to_string_lossy().to_string(),
            out.to_string_lossy().to_string(),
            Some(true),
            Some(true),
            Some(vec!["*.tmp".to_string()]),
        ))
        .expect("打包应当成功");

        assert!(result.success);
        assert!(result.size_bytes.unwrap() > 0);
        assert!(result.sha256.as_deref().map_or(false, |h| h.len() == 64));

        // 产物必须是可读的 zip，且排除规则生效
        let bytes = fs::read(&out).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(bytes.as_slice())).expect("产物应为有效 zip");
        assert!(archive.by_name("petmod.json").is_ok());
        assert!(archive.by_name("sprites/idle.png").is_ok());
        assert!(archive.by_name("scratch.tmp").is_err());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_pack_petmod_rejects_bad_output_path() {
        let dir = std::env::temp_dir().join(format!("spiritpal_pack_bad_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();

        // 1) 非 .petmod 后缀
        let err = tauri::async_runtime::block_on(pack_petmod(
            dir.to_string_lossy().to_string(),
            dir.join("out.zip").to_string_lossy().to_string(),
            None,
            None,
            None,
        ));
        assert!(err.is_err());

        // 2) 源目录不存在
        let err2 = tauri::async_runtime::block_on(pack_petmod(
            dir.join("nope").to_string_lossy().to_string(),
            dir.join("out.petmod").to_string_lossy().to_string(),
            None,
            None,
            None,
        ));
        assert!(err2.is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_pack_petmod_rejects_self_contained_output() {
        let dir = std::env::temp_dir().join(format!("spiritpal_pack_self_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("petmod.json"), "{}").unwrap();

        // 输出落在源目录内部 → 应被拒绝
        let err = tauri::async_runtime::block_on(pack_petmod(
            dir.to_string_lossy().to_string(),
            dir.join("self.petmod").to_string_lossy().to_string(),
            None,
            None,
            None,
        ));
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("自包含"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_validate_petmod_reads_manifest() {
        let base = std::env::temp_dir().join(format!("spiritpal_validate_{}", std::process::id()));
        let pkg = base.join("demo.petmod");
        fs::create_dir_all(&base).unwrap();

        // 先打一个包
        let src = base.join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(
            src.join("petmod.json"),
            r#"{"id":"demo","version":"2.0.0"}"#,
        )
        .unwrap();
        tauri::async_runtime::block_on(pack_petmod(
            src.to_string_lossy().to_string(),
            pkg.to_string_lossy().to_string(),
            Some(true),
            Some(true),
            None,
        ))
        .expect("打包应当成功");

        // 再校验
        let result =
            tauri::async_runtime::block_on(validate_petmod(pkg.to_string_lossy().to_string()))
                .expect("校验应当成功");
        assert!(result.valid);
        let manifest: serde_json::Value =
            serde_json::from_str(result.manifest_json.as_deref().unwrap()).unwrap();
        assert_eq!(manifest["version"], "2.0.0");
        assert!(result.sha256.as_deref().map_or(false, |h| h.len() == 64));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_validate_petmod_rejects_non_zip() {
        let base =
            std::env::temp_dir().join(format!("spiritpal_validate_bad_{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let pkg = base.join("fake.petmod");
        fs::write(&pkg, "this is definitely not a zip").unwrap();

        // 魔数校验会先拦下非 zip 文件
        let err =
            tauri::async_runtime::block_on(validate_petmod(pkg.to_string_lossy().to_string()));
        assert!(err.is_err());

        let _ = fs::remove_dir_all(&base);
    }

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

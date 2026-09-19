//! R-11: 前端资源运行时完整性校验（release 构建）
//!
//! 构建期由 `scripts/obfuscate-and-sri.mjs` 生成 `generated::sri_hashes::SRI_HASHES`
//! （dist/assets/*.js 的 SHA-256 清单，随 Rust 源码编译进二进制）。本模块在启动时
//! 通过 Tauri `AssetResolver` 读取**实际内嵌进二进制的资源字节**，重算哈希并与清单
//! 逐条比对——清单与内嵌资源不同源（生成步骤被跳过、旧清单被编入新产物、内容被篡改）
//! 即返回 false，由调用方记 error 并通知前端（不阻断启动，D-7）。
//!
//! # 可读性依据（对锁定版本 tauri 2.11.5 源码核验 + 单元测试实证）
//! - `custom-protocol` 特性恒开（src-tauri/Cargo.toml）→ 编译期 `dev=false` →
//!   `generate_context!` 把 `frontendDist` 内嵌进二进制（codegen brotli 压缩）；
//! - `AppHandle::asset_resolver().get(path)` 读取内嵌资源并透明解压，返回与构建期
//!   被哈希的 dist 文件相同的原始字节；
//! - 单元测试 `embedded_assets_match_sri_manifest` 在本地有 dist 时逐条比对内嵌字节
//!   与清单，作为「内嵌 → 清单」链路的回归检查（CI 占位 dist 下自动跳过）。
//!
//! # 与构建期门禁的分工
//! - 构建期（CI 阻断）：`node scripts/obfuscate-and-sri.mjs --verify` 校验 dist 与清单一致；
//! - 运行时（本模块）：校验**二进制里实际内嵌的字节**与清单一致（构建期覆盖不到的最后一环）。

use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::generated::sri_hashes::SRI_HASHES;

/// 校验内嵌前端资源与构建期 SRI 清单是否一致。
///
/// - release：逐条读取内嵌资源、重算 SHA-256 并比对，全部一致才返回 true；
/// - debug：跳过并返回 true——开发构建不执行混淆与清单再生成（TAURI_ENV_DEBUG），
///   清单对 debug 产物不具权威性，校验只会误报。
pub fn verify_integrity(app: &AppHandle) -> bool {
    if cfg!(debug_assertions) {
        log::info!("[SRI] debug 构建：跳过运行时完整性校验（清单仅由 release 流水线生成）");
        return true;
    }

    let resolver = app.asset_resolver();
    let total = SRI_HASHES.len();
    let mut failures: Vec<String> = Vec::new();

    for (name, expected) in SRI_HASHES.iter() {
        // 内嵌资源键 = "/assets/<文件名>"（manager 会把此处路径规范化为带前导斜杠的 AssetKey）
        match resolver.get(format!("assets/{name}")) {
            Some(asset) => {
                let actual = hex::encode(Sha256::digest(asset.bytes()));
                if !actual.eq_ignore_ascii_case(expected) {
                    // get_asset 对未命中路径会回退到 index.html，故「缺失」也表现为哈希不匹配
                    failures.push(format!(
                        "{name}: 哈希不匹配（实际 MIME={}，可能是缺失回退或内容被篡改）",
                        asset.mime_type()
                    ));
                }
            }
            None => failures.push(format!("{name}: 内嵌资源不可读")),
        }
    }

    if failures.is_empty() {
        log::info!("[SRI] 运行时完整性校验通过（{total} 个内嵌资源与清单一致）");
        true
    } else {
        for failure in &failures {
            log::error!("[SRI] {failure}");
        }
        log::error!(
            "[SRI] 运行时完整性校验失败：{}/{} 个内嵌资源与清单不一致",
            failures.len(),
            total
        );
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::utils::assets::AssetKey;

    /// 实证：dist 产物确实以可读形态内嵌进 `Context`，且字节与 SRI 清单逐条对齐。
    ///
    /// 测试环境无法构造真实 App 事件循环，故直接走 `Context::assets()`（`AssetResolver::get`
    /// 对内嵌资源也只是「路径规范化 + 转发到同一个 `Assets::get`」，键格式同为 `/assets/*`）。
    ///
    /// CI 的 rust-test/rust-clippy job 只造占位 dist（无 assets/ 目录）→ 自动跳过；
    /// 本地/构建机有真实 dist 时，该测试即「dist ↔ 清单 ↔ 内嵌二进制」三方一致的回归检查。
    #[test]
    fn embedded_assets_match_sri_manifest() {
        let dist_assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/assets");
        if !dist_assets.is_dir() {
            eprintln!("[test] dist/assets 不存在（CI 占位 dist）——跳过内嵌资源比对");
            return;
        }

        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        let assets = context.assets();
        let mut checked = 0usize;

        for (name, expected) in SRI_HASHES.iter() {
            let key = AssetKey::from(format!("/assets/{name}").as_str());
            let bytes = assets
                .get(&key)
                .unwrap_or_else(|| panic!("内嵌资源缺失: {name}"));
            let actual = hex::encode(Sha256::digest(&*bytes));
            assert_eq!(actual, *expected, "内嵌资源哈希与 SRI 清单不一致: {name}");
            checked += 1;
        }

        assert!(checked > 0, "SRI 清单为空——构建期生成步骤可能被跳过");
    }
}

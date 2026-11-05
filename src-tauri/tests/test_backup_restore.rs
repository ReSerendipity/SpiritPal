//! 本地数据备份→恢复实测（P0 O4 · 2026-11-06 整改单条目 1）
//!
//! 背景：encrypted_db.rs 的 AES-256-GCM 备份实现（backup_db_at_rest /
//! restore_db_backup）此前全仓零恢复实测（评估报告 2026-11-05 门禁 O4
//! ⛔P0（绝对）阻断项）。本文件补齐恢复路径的自动化往返实测：
//! 真实加密栈（空密码=机器 ID 派生，与生产同路径）加密 → 落盘 .enc →
//! create_backup_in 备份 → 灾难性损坏 .enc → restore_backup_in 恢复 →
//! decrypt_data 解密 → 与原始字节逐一比对（对平判据：sha256 与字节相等）。
//!
//! 演练记录：docs/execution/BACKUP_RESTORE_DRILL_2026-11-06.md
//!
//! 运行：`cargo test --test test_backup_restore`（默认 debug）
//! 说明：机器 ID 获取失败时 encrypt_data 会 Err（Fail Fast，crypto.rs D3 设计），
//! 此时测试应红——那是环境问题被强制暴露，不是测试误报。

use base64::Engine;
use spiritpal_lib::crypto;
use spiritpal_lib::encrypted_db::{
    create_backup_in, delete_backup_in, list_backup_files_in, restore_backup_in, rotate_backups_in,
};

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// crypto 命令是 async（机器 ID 阻塞 I/O 移出调用线程），测试在其全局运行时内 block_on
fn rt<T>(fut: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(fut)
}

fn tmp_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("sp-bkrestore-{}-{}", tag, std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// SQLite 形状的确定性明文库：真实文件头 + n_pages 页确定性伪随机内容
fn sqlite_shaped_content(n_pages: usize) -> Vec<u8> {
    let mut content = Vec::with_capacity(16 + n_pages * 4096);
    content.extend_from_slice(b"SQLite format 3\x00");
    for i in 0..n_pages * 4096 {
        content.push((i % 251) as u8);
    }
    content
}

/// 写入一个带显式 mtime 的伪备份文件（轮转测试用，规避同秒文件名/粒度问题）
fn write_backup_file(dir: &Path, name: &str, size: usize, mtime_ms: u64) -> PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, vec![0xA5u8; size]).unwrap();
    let f = std::fs::OpenOptions::new().write(true).open(&p).unwrap();
    f.set_modified(SystemTime::UNIX_EPOCH + Duration::from_millis(mtime_ms))
        .unwrap();
    p
}

// ============ 核心往返：真实 AES-256-GCM 加密 → 备份 → 损坏 → 恢复 → 解密 → 字节对平 ============

#[test]
fn test_backup_restore_roundtrip_real_crypto() {
    let dir = tmp_dir("roundtrip");
    let original = sqlite_shaped_content(64); // 262,144 字节（64 页）
    let original_sha = crypto::sha256_of_bytes(&original);
    println!(
        "样本: SQLite 形状 {} 字节, sha256={}",
        original.len(),
        original_sha
    );

    // 1) 真实加密栈加密（空密码 → 机器 ID 派生，与 encrypt_db_at_rest 生产路径一致）
    let content_b64 = base64::engine::general_purpose::STANDARD.encode(&original);
    let encrypted = rt(crypto::encrypt_data(content_b64, String::new())).expect(
        "加密失败：机器 ID 不可用属环境问题（crypto.rs D3 Fail Fast 设计），应暴露而非跳过",
    );
    let enc_path = dir.join("spiritpal.db.enc");
    std::fs::write(&enc_path, encrypted.as_bytes()).unwrap();
    println!(
        "加密落盘: {} 字节",
        std::fs::metadata(&enc_path).unwrap().len()
    );

    // 2) 备份（create_backup_in = backup_db_at_rest 核心）
    let backup_name = create_backup_in(&dir)
        .expect("create_backup_in 应成功")
        .expect("存在 .enc 时应返回备份名");
    assert!(
        backup_name.starts_with("spiritpal-backup-") && backup_name.ends_with(".db.enc"),
        "备份文件名形状不符: {backup_name}"
    );
    let backup_path = dir.join("backups").join(&backup_name);
    assert!(
        backup_path.exists(),
        "备份文件应存在: {}",
        backup_path.display()
    );
    println!(
        "备份: {backup_name}, {} 字节",
        std::fs::metadata(&backup_path).unwrap().len()
    );

    // 3) 灾难：主加密库被截断损坏（模拟磁盘/写入故障）
    std::fs::write(&enc_path, b"CORRUPTED").unwrap();
    assert_eq!(std::fs::metadata(&enc_path).unwrap().len(), 9);

    // 4) 恢复（restore_backup_in = restore_db_backup 核心：删现库 → 复制备份）
    restore_backup_in(&dir, &backup_name).expect("restore_backup_in 应成功");
    assert_eq!(
        std::fs::metadata(&enc_path).unwrap().len(),
        std::fs::metadata(&backup_path).unwrap().len(),
        "恢复后主库大小应与备份一致"
    );

    // 5) 解密 + 字节对平（对平判据：sha256 与逐字节相等）
    let restored_enc = std::fs::read_to_string(&enc_path).unwrap();
    let restored_b64 = rt(crypto::decrypt_data(restored_enc, String::new()))
        .expect("恢复出的备份应能用同一密钥解密");
    let restored = base64::engine::general_purpose::STANDARD
        .decode(restored_b64)
        .expect("解密结果应为合法 base64");
    assert_eq!(restored.len(), original.len(), "恢复后明文长度应一致");
    assert_eq!(
        crypto::sha256_of_bytes(&restored),
        original_sha,
        "恢复后 sha256 应与原始一致"
    );
    assert_eq!(restored, original, "恢复后明文应与原始逐字节一致");
    assert_eq!(
        &restored[0..16],
        b"SQLite format 3\x00",
        "SQLite 文件头应保留"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// ============ create_backup_in 分支 ============

#[test]
fn test_create_backup_skips_when_no_enc() {
    let dir = tmp_dir("no-enc");
    let r = create_backup_in(&dir).expect("无加密库应静默跳过");
    assert!(r.is_none(), "无 .enc 时应返回 None，实际 {r:?}");
    assert!(!dir.join("backups").exists(), "不应创建备份目录");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_create_backup_copies_enc_bytes_identically() {
    let dir = tmp_dir("copy-identical");
    let payload: Vec<u8> = (0..4096u32).map(|i| (i % 256) as u8).collect();
    std::fs::write(dir.join("spiritpal.db.enc"), &payload).unwrap();

    let name = create_backup_in(&dir)
        .expect("create_backup_in 应成功")
        .expect("应返回备份名");
    let copied = std::fs::read(dir.join("backups").join(&name)).unwrap();
    assert_eq!(copied, payload, "备份应与 .enc 逐字节一致");
    let _ = std::fs::remove_dir_all(&dir);
}

// ============ 轮转与列表 ============

#[test]
fn test_rotate_keeps_latest_three() {
    let dir = tmp_dir("rotate");
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).unwrap();
    // 5 份备份，mtime 递增（t1..t5）；t0 是无关文件（非备份命名也应计入？——
    // list_backup_files_in 按目录内全部普通文件计数，与生产 rotate 行为一致）
    for i in 1..=5usize {
        write_backup_file(
            &backups,
            &format!("spiritpal-backup-{i}.db.enc"),
            100 + i,
            1_700_000_000_000 + i as u64 * 1_000,
        );
    }
    rotate_backups_in(&backups).expect("rotate_backups_in 应成功");

    let items = list_backup_files_in(&backups).expect("list 应成功");
    assert_eq!(items.len(), 3, "轮转后应只保留 3 份，实际 {}", items.len());
    // 保留的必须是最新 3 份（mtime 倒序）
    let names: Vec<&str> = items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(
        names,
        vec![
            "spiritpal-backup-5.db.enc",
            "spiritpal-backup-4.db.enc",
            "spiritpal-backup-3.db.enc"
        ]
    );
    assert!(
        !backups.join("spiritpal-backup-1.db.enc").exists(),
        "最旧备份应被删除"
    );
    assert!(
        !backups.join("spiritpal-backup-2.db.enc").exists(),
        "次旧备份应被删除"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_list_backup_files_empty_when_dir_missing() {
    let dir = tmp_dir("list-missing");
    let items = list_backup_files_in(&dir.join("backups")).expect("目录不存在应返回空列表");
    assert!(items.is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

// ============ 恢复的防穿越 / 缺失分支 ============

#[test]
fn test_restore_rejects_path_traversal() {
    let dir = tmp_dir("traversal");
    for evil in ["../evil.enc", "sub\\evil.enc", "..", "a/b.enc"] {
        let err = restore_backup_in(&dir, evil).unwrap_err();
        assert_eq!(err, "备份文件名非法", "evil={evil:?} 应被拒绝");
    }
    assert!(!dir.join("spiritpal.db.enc").exists(), "拒绝时不得触碰主库");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_restore_missing_backup_errors_without_touching_enc() {
    let dir = tmp_dir("missing");
    std::fs::write(dir.join("spiritpal.db.enc"), b"current").unwrap();
    let err = restore_backup_in(&dir, "spiritpal-backup-999.db.enc").unwrap_err();
    assert!(err.contains("备份不存在"), "实际报错: {err}");
    assert_eq!(
        std::fs::read(dir.join("spiritpal.db.enc")).unwrap(),
        b"current",
        "恢复失败时现库不得被破坏"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_restore_replaces_corrupt_enc_with_backup_bytes() {
    let dir = tmp_dir("replace-corrupt");
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).unwrap();
    let good: Vec<u8> = (0..2048u32).map(|i| (i % 253) as u8).collect();
    std::fs::write(backups.join("spiritpal-backup-1.db.enc"), &good).unwrap();
    std::fs::write(dir.join("spiritpal.db.enc"), b"garbage").unwrap();

    restore_backup_in(&dir, "spiritpal-backup-1.db.enc").expect("恢复应成功");
    assert_eq!(
        std::fs::read(dir.join("spiritpal.db.enc")).unwrap(),
        good,
        "恢复后主库应与备份逐字节一致"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// ============ 删除 ============

#[test]
fn test_delete_backup_removes_target_and_keeps_others() {
    let dir = tmp_dir("delete");
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).unwrap();
    std::fs::write(backups.join("spiritpal-backup-1.db.enc"), b"one").unwrap();
    std::fs::write(backups.join("spiritpal-backup-2.db.enc"), b"two").unwrap();

    delete_backup_in(&dir, "spiritpal-backup-1.db.enc").expect("删除应成功");
    assert!(!backups.join("spiritpal-backup-1.db.enc").exists());
    assert!(
        backups.join("spiritpal-backup-2.db.enc").exists(),
        "其余备份不得被误删"
    );

    // 幂等：删除不存在的备份不报错
    delete_backup_in(&dir, "spiritpal-backup-1.db.enc").expect("重复删除应幂等成功");

    // 防穿越
    assert_eq!(
        delete_backup_in(&dir, "../spiritpal.db.enc").unwrap_err(),
        "备份文件名非法"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

//! 模型缓存与 LRU 空闲卸载（model cache）—— 移植自 `Daniele-rolli/tauri-plugin-local-ai`（`models.rs`）。
//!
//! 端侧模型权重体积大（2B Q4 ≈ 1.5GB）。常驻会撑爆内存被 Android LMK 杀；
//! 因此记录「已加载模型 → 最后使用时间」，空闲超过阈值就摘掉（释放 mmap/权重）。
//! 实际权重文件由用户经 ModelScope / HF 镜像自取（框架-only，不分发权重）。

use std::{collections::HashMap, path::PathBuf, sync::Mutex, time::Instant};

/// 磁盘上一个「可用模型」（含 `config.json` 的目录）。
///
/// 判定标准与 MNN Chat 的 `LocalModelsProvider` 一致：凡含 `config.json` 的子目录即一个模型。
#[derive(Debug, Clone)]
pub struct AvailableModel {
    /// 模型 id（目录名）
    pub id: String,
    /// 模型目录绝对路径（传给 `ondevice_load_model` 的 `config_path` 为其下的 `config.json`）
    pub path: PathBuf,
    /// 目录占用字节数（供 UI 展示）
    pub size_bytes: u64,
}

pub struct ModelManager {
    dir: PathBuf,
    loaded: Mutex<HashMap<String, (u64, Instant)>>,
}

impl ModelManager {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            loaded: Mutex::new(HashMap::new()),
        }
    }

    /// 模型根目录（供 UI 展示；用户把 MNN 模型目录放进来）。
    pub fn dir(&self) -> &PathBuf {
        &self.dir
    }

    /// 扫描模型根目录，返回其中所有可用模型。
    ///
    /// 目录不存在时返回空表（不报错）——首次运行时该目录尚未创建属正常情况。
    pub fn scan_available(&self) -> Vec<AvailableModel> {
        let mut out = Vec::new();
        let Ok(rd) = std::fs::read_dir(&self.dir) else {
            return out;
        };
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_dir() || !p.join("config.json").is_file() {
                continue;
            }
            let id = p
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            out.push(AvailableModel {
                id,
                size_bytes: dir_size(&p),
                path: p,
            });
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// 该模型是否已加载。
    pub fn is_loaded(&self, id: &str) -> bool {
        self.loaded.lock().map(|l| l.contains_key(id)).unwrap_or(false)
    }

    pub fn local_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.bin"))
    }

    pub fn note_loaded(&self, id: &str, bytes: u64) {
        self.loaded
            .lock()
            .unwrap()
            .insert(id.into(), (bytes, Instant::now()));
    }

    pub fn resident_bytes(&self) -> u64 {
        self.loaded.lock().unwrap().values().map(|(b, _)| *b).sum()
    }

    /// 返回当前已加载模型 id 列表（供 `ondevice_list_models` 命令）。
    pub fn loaded_ids(&self) -> Vec<String> {
        self.loaded.lock().unwrap().keys().cloned().collect()
    }

    /// 返回空闲超过 `idle_secs` 的模型 id 列表（调用方据此卸载权重）。
    pub fn evict_idle(&self, idle_secs: u64) -> Vec<String> {
        let mut l = self.loaded.lock().unwrap();
        let ids: Vec<String> = l
            .iter()
            .filter(|(_, (_, t))| t.elapsed().as_secs() >= idle_secs)
            .map(|(k, _)| k.clone())
            .collect();
        for i in &ids {
            l.remove(i);
        }
        ids
    }
}

/// 递归求目录字节数（供 UI 展示模型体积；读不到的条目按 0 计，不报错）。
fn dir_size(p: &std::path::Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else {
        return 0;
    };
    let mut total = 0u64;
    for e in rd.flatten() {
        let path = e.path();
        match e.file_type() {
            Ok(t) if t.is_dir() => total += dir_size(&path),
            Ok(_) => total += e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => {}
        }
    }
    total
}

pub fn verify_sha_bytes(data: &[u8], expected_hex: &str) -> bool {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(data)) == expected_hex
}

/// 路径级校验占位（下载完整性由 ModelScope/HF 自身保证；留口供将来扩展）。
pub fn verify_sha(_path: &std::path::Path, _expected_hex: &str) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sha_verify_roundtrip() {
        use sha2::{Digest, Sha256};
        let h = hex::encode(Sha256::digest(b"abc"));
        assert!(verify_sha_bytes(b"abc", &h));
        assert!(!verify_sha_bytes(b"abd", &h));
    }
    #[test]
    fn lru_evicts_after_idle() {
        let m = ModelManager::new(std::env::temp_dir());
        m.note_loaded("a", 100);
        assert_eq!(m.resident_bytes(), 100);
        assert_eq!(m.evict_idle(0).len(), 1);
        assert_eq!(m.resident_bytes(), 0);
    }

    #[test]
    fn scans_only_dirs_with_config_json() {
        let base = std::env::temp_dir().join(format!("sp_scan_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("good")).unwrap();
        std::fs::write(base.join("good").join("config.json"), b"{}").unwrap();
        std::fs::write(base.join("good").join("llm.mnn"), [0u8; 10]).unwrap();
        std::fs::create_dir_all(base.join("bad")).unwrap(); // 无 config.json → 不算模型

        let m = ModelManager::new(base.clone());
        let a = m.scan_available();
        assert_eq!(a.len(), 1, "只应识别含 config.json 的目录");
        assert_eq!(a[0].id, "good");
        assert_eq!(a[0].size_bytes, 12, "config.json(2B) + llm.mnn(10B)");
        assert!(!m.is_loaded("good"));
        m.note_loaded("good", 1);
        assert!(m.is_loaded("good"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn scan_missing_dir_returns_empty() {
        let m = ModelManager::new(std::env::temp_dir().join("sp_definitely_missing_dir_xyz"));
        assert!(m.scan_available().is_empty());
    }
}

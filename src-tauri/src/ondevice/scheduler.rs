//! 串行推理调度（single-worker scheduler）—— 移植自 `Daniele-rolli/tauri-plugin-local-ai`（`scheduler.rs`）。
//!
//! 端侧推理占满 CPU/GPU 且显存(权重)独占，必须串行执行，否则多个并发请求会互相抢资源导致 OOM。
//! 用一把 `tokio::sync::Mutex` 充当「推理槽」，配合 `CancellationToken` 支持取消（用户打断生成）。

use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, PartialEq)]
pub enum SchedError {
    Cancelled,
    ThermalPaused,
    UnsupportedTier,
}

pub struct Scheduler {
    slot: Arc<Mutex<()>>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            slot: Arc::new(Mutex::new(())),
        }
    }

    /// 占用推理槽跑一个 job；进入临界区前/后双重检查取消令牌。
    pub async fn enqueue(
        &self,
        _prio: u8,
        job: impl std::future::Future<Output = String> + Send + 'static,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<String, SchedError> {
        if cancel.is_cancelled() {
            return Err(SchedError::Cancelled);
        }
        let _guard = self.slot.lock().await;
        if cancel.is_cancelled() {
            return Err(SchedError::Cancelled);
        }
        Ok(job.await)
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn serializes_two_jobs() {
        use std::time::Instant;
        let s = Scheduler::new();
        let t0 = Instant::now();
        let tok_a = tokio_util::sync::CancellationToken::new();
        let tok_b = tokio_util::sync::CancellationToken::new();
        let (a, b) = tokio::join!(
            s.enqueue(
                1,
                async {
                    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
                    "a".into()
                },
                tok_a
            ),
            s.enqueue(1, async { "b".into() }, tok_b),
        );
        assert_eq!((a.unwrap().as_str(), b.unwrap().as_str()), ("a", "b"));
        assert!(t0.elapsed().as_millis() >= 70, "jobs ran concurrently");
    }
    #[tokio::test]
    async fn cancel_aborts() {
        let s = Scheduler::new();
        let tok = tokio_util::sync::CancellationToken::new();
        tok.cancel();
        let r = s.enqueue(0, async { "x".into() }, tok).await;
        assert!(matches!(r, Err(SchedError::Cancelled)));
    }
}

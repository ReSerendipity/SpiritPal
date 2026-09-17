#![cfg(mobile)]

//! 移动端（Android）内嵌 MNN 引擎桥（进程内推理）。
//!
//! 仅 `#[cfg(mobile)]` 编译；桌面端不编此文件，`ondevice` 走 companion loopback（前端 `llmClient.ts`）。
//! 设计 / 文件级改动见 [`docs/agents/ondevice-embed-plan.md`](../../docs/agents/ondevice-embed-plan.md) §3.3–§3.6。
//!
//! 桥接契约（Kotlin 侧 `com.alibaba.mnnllm.android.SpiritPalOnDevice`，由 Doro 编写，见 plan §3.3）：
//! - Rust → Kotlin（`call_static_method`）：
//!   - `loadModel(modelId: String, configPath: String, enableThinking: String)`
//!   - `generate(sessionId: String, prompt: String, paramsJson: String)`  // Kotlin 内部起后台线程流式
//!   - `release()`
//! - Kotlin → Rust（native，按 JNI 命名自动链接）：
//!   - `nativeOnToken(sessionId: String, text: String)`
//!   - `nativeOnDone(sessionId: String)`
//!   - `nativeIsCancelled(sessionId: String): Boolean`
//!
//! 数据流：`invoke("ondevice_generate")`
//!   → `Scheduler` 串行槽（防并发抢资源 OOM）
//!   → JNI `SpiritPalOnDevice.generate`
//!   → Kotlin 每 token 调 `nativeOnToken` → `app.emit("ondevice://token")` → 前端拼接
//!   → Kotlin 结束调 `nativeOnDone` → `app.emit("ondevice://done")` → Rust 唤醒 `generate` 返回。
//!
//! ⚠️ 验证状态（2026-09-16）：本文件此前**从未被编译过**，实测有 24 个编译错误，已修
//!   （清单见 `docs/execution/ondevice-theory-validation-20260916.md` §13）。关键修正：
//!   Tauri v2 **没有** `tauri::android::context`，改用官方 `Runtime::run_on_android_context`
//!   —— 回调在 Android 主线程、带 activity 上下文执行，`find_class` 的 class loader 才正确。
//!   **仍需真机回归**（`ondevice-embed-plan.md` §7）：JNI 运行时行为、流式/取消时序，
//!   以及 `loadModel` 同步阻塞的 ANR 风险（见报告 §13.4）。

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use jni::objects::{GlobalRef, JClass, JString, JValue};
use jni::{JavaVM, JNIEnv};

use crate::ondevice::models::ModelManager;
use crate::ondevice::scheduler::{SchedError, Scheduler};

/// Kotlin 桥的 JNI 类名（与 `SpiritPalOnDevice.kt` 的包名严格对应）。
const SPIRITPAL_ON_DEVICE: &str = "com/alibaba/mnnllm/android/SpiritPalOnDevice";

/// `JNI_OnLoad` 缓存的 JavaVM（供任意线程 attach）。
static JVM: OnceLock<JavaVM> = OnceLock::new();
/// `JNI_OnLoad` 缓存的 `SpiritPalOnDevice` 类全局引用。
///
/// ⚠️ 为什么必须缓存：在 attach 出来的 native 线程上 `env.find_class()` 走的是
/// **system class loader**，找不到应用自己的类。而 `JNI_OnLoad` 由 `System.loadLibrary`
/// 的调用线程执行，其 `find_class` 用的是**应用 class loader**（正确）。
static ON_DEVICE_CLASS: OnceLock<GlobalRef> = OnceLock::new();

// ---- 全局单例 ----
static SCHEDULER: OnceLock<Scheduler> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
static MODELS: OnceLock<Mutex<ModelManager>> = OnceLock::new();
// 取消令牌 / 完成信号按 session 存，供 Kotlin 经 native 回调查询或唤醒。
// ⚠️ `HashMap::new()` 不是 const fn，不能在 `static` 初始化里直接调用（E0015）→ 用 LazyLock。
static CANCELS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static DONE: LazyLock<Mutex<HashMap<String, Arc<Notify>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize)]
pub struct ModelInfo {
    /// 模型 id（目录名）
    pub id: String,
    /// 磁盘上是否存在（含 `config.json`）
    pub available: bool,
    /// 是否已加载进内存
    pub loaded: bool,
    /// 模型目录绝对路径
    pub path: String,
    /// 传给 `ondevice_load_model` 的 `config_path`（`<dir>/config.json`）
    pub config_path: String,
    /// 目录占用字节数
    pub size_bytes: u64,
    /// 当前已加载模型占用的常驻内存合计（进程级，非单模型）
    pub resident_bytes: u64,
}

/// 模型根目录信息（供 UI 提示用户把模型放哪）。
#[derive(Serialize)]
pub struct ModelsDirInfo {
    pub dir: String,
}

fn scheduler() -> &'static Scheduler {
    SCHEDULER.get_or_init(Scheduler::new)
}

/// 模型根目录。
///
/// **Android**：用**应用外部文件目录** `/storage/emulated/0/Android/data/<identifier>/files/models`。
/// 原因：应用私有目录（`/data/user/0/<identifier>/files`）在**非 debug 包**下无法被 `adb push`
/// 写入（`run-as` 不可用），而外部文件目录无需任何权限即可被本应用读写、且 **`adb push` 可写**，
/// 契合「框架-only、用户自取模型权重」的分发策略。目录创建失败时回退私有目录。
///
/// **桌面**：`app_data_dir()/models`。
fn model_dir(app: &AppHandle) -> std::path::PathBuf {
    #[cfg(target_os = "android")]
    {
        // ⚠️ 必须做 `-` → `_` 转换：`tauri.conf.json` 的 identifier 是 `com.spiritpal.desktop-pet`，
        // 而 Tauri 生成 Android 工程时会把 `-` 换成 `_`（applicationId = `com.spiritpal.desktop_pet`）。
        // 直接用 identifier 会拼出不存在的包名目录，FUSE 按包名拦截 → create_dir_all 必然失败
        // （实测踩过：一直静默回退到私有目录）。
        let pkg = app.config().identifier.replace('-', "_");
        let ext = std::path::PathBuf::from("/storage/emulated/0/Android/data")
            .join(&pkg)
            .join("files")
            .join("models");
        match std::fs::create_dir_all(&ext) {
            Ok(()) => {
                // 放宽权限到 0777（含父级 files/）：
                // 目录由**应用**创建时属主是应用 uid、模式 0770 → `adb push`（以 shell 身份运行）
                // 反而**写不进去**（实测 Permission denied）。放宽后用户才能经 adb 放入模型，
                // 应用自身仍可正常读写。仅作用于本应用的外部私有目录。
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Some(parent) = ext.parent() {
                        let _ = std::fs::set_permissions(
                            parent,
                            std::fs::Permissions::from_mode(0o771),
                        );
                    }
                    let _ =
                        std::fs::set_permissions(&ext, std::fs::Permissions::from_mode(0o777));
                }
                return ext;
            }
            Err(e) => log::warn!(
                "[ondevice] 外部模型目录不可用（{e}），回退应用私有目录：{}",
                ext.display()
            ),
        }
    }
    app.path()
        .app_data_dir()
        .map(|p| p.join("models"))
        .unwrap_or_else(|_| std::path::PathBuf::from("models"))
}

fn models(app: &AppHandle) -> &'static Mutex<ModelManager> {
    MODELS.get_or_init(|| Mutex::new(ModelManager::new(model_dir(app))))
}

fn stash_app(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// `JNI_OnLoad`：`System.loadLibrary("spiritpal_lib")` 时由 JVM 调用。
///
/// 在此缓存 JavaVM 与 `SpiritPalOnDevice` 的**全局类引用** —— 这是 Android 上从 Rust 反向调用
/// Java 静态方法的标准做法：既拿到 JavaVM，又规避了「native 线程 `find_class` 走 system
/// class loader 找不到应用类」的问题（此处的 `find_class` 用的是**应用 class loader**）。
///
/// ⚠️ Tauri v2 **没有**给应用侧留公开的 Android JNI 入口：`RuntimeOrDispatch` / `ManagerBase`
/// 都在 `pub(crate) mod sealed` 内（tauri-2.11.5/src/lib.rs:1045），`tauri::android` 模块不存在，
/// `PluginHandle` 也无 `run_on_android_context`。已确认 tauri 自身**未定义** `JNI_OnLoad`，故不冲突。
#[no_mangle]
pub extern "system" fn JNI_OnLoad(
    vm: *mut jni::sys::JavaVM,
    _reserved: *mut std::ffi::c_void,
) -> jni::sys::jint {
    // SAFETY: vm 由 JVM 传入，在整个进程生命周期内有效。
    let vm = match unsafe { JavaVM::from_raw(vm) } {
        Ok(v) => v,
        Err(_) => return jni::sys::JNI_ERR,
    };
    if let Ok(mut env) = vm.attach_current_thread() {
        if let Ok(cls) = env.find_class(SPIRITPAL_ON_DEVICE) {
            if let Ok(g) = env.new_global_ref(cls) {
                let _ = ON_DEVICE_CLASS.set(g);
            }
        }
    }
    let _ = JVM.set(vm);
    jni::sys::JNI_VERSION_1_6
}

/// 取当前线程的 JNIEnv（attach 到 `JNI_OnLoad` 缓存的 JavaVM）。
fn with_android_env<F>(f: F) -> Result<(), String>
where
    F: FnOnce(&mut JNIEnv<'_>) -> Result<(), String>,
{
    let vm = JVM
        .get()
        .ok_or_else(|| "ondevice: JVM 未初始化（JNI_OnLoad 未执行）".to_string())?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("attach_current_thread: {e}"))?;
    f(&mut env)
}

/// 调用 `SpiritPalOnDevice` 上的静态方法。
fn call_kotlin_static(method: &str, sig: &str, args: Vec<String>) -> Result<(), String> {
    with_android_env(|env| {
        let cached = ON_DEVICE_CLASS
            .get()
            .ok_or_else(|| "ondevice: SpiritPalOnDevice 类未缓存".to_string())?;
        // GlobalRef → 局部 JClass（call_static_method 需要 JClass 而非 JObject）
        let cls = JClass::from(
            env.new_local_ref(cached.as_obj())
                .map_err(|e| format!("new_local_ref: {e}"))?,
        );
        let jargs: Vec<JString<'_>> = args
            .iter()
            .map(|a| env.new_string(a.as_str()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("new_string: {e}"))?;
        let jvalues: Vec<JValue<'_, '_>> = jargs.iter().map(|s| JValue::Object(&**s)).collect();
        env.call_static_method(&cls, method, sig, &jvalues)
            .map_err(|e| format!("call {method}: {e}"))?;
        Ok(())
    })
}

fn kotlin_load_model(model_id: &str, config_path: &str, enable_thinking: &str) -> Result<(), String> {
    call_kotlin_static(
        "loadModel",
        "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
        vec![
            model_id.to_string(),
            config_path.to_string(),
            enable_thinking.to_string(),
        ],
    )
}

fn kotlin_generate(session_id: &str, prompt: &str, params_json: &str) -> Result<(), String> {
    call_kotlin_static(
        "generate",
        "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
        vec![
            session_id.to_string(),
            prompt.to_string(),
            params_json.to_string(),
        ],
    )
}

fn kotlin_release() -> Result<(), String> {
    call_kotlin_static("release", "()V", vec![])
}

// ---- Kotlin → Rust native 回调（按 JNI 命名自动链接）----

#[no_mangle]
pub extern "system" fn Java_com_alibaba_mnnllm_android_SpiritPalOnDevice_nativeOnToken(
    mut env: JNIEnv,
    _class: JClass,
    session_id: JString,
    text: JString,
) {
    let sid = env
        .get_string(&session_id)
        .ok()
        .and_then(|s| s.to_str().ok().map(str::to_owned))
        .unwrap_or_default();
    let txt = env
        .get_string(&text)
        .ok()
        .and_then(|s| s.to_str().ok().map(str::to_owned))
        .unwrap_or_default();
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "ondevice://token",
            serde_json::json!({"sessionId": sid, "text": txt}),
        );
    }
}

#[no_mangle]
pub extern "system" fn Java_com_alibaba_mnnllm_android_SpiritPalOnDevice_nativeOnDone(
    mut env: JNIEnv,
    _class: JClass,
    session_id: JString,
) {
    let sid = env
        .get_string(&session_id)
        .ok()
        .and_then(|s| s.to_str().ok().map(str::to_owned))
        .unwrap_or_default();
    if let Some(app) = APP.get() {
        let _ = app.emit("ondevice://done", serde_json::json!({"sessionId": sid}));
    }
    if let Some(n) = DONE.lock().ok().and_then(|m| m.get(&sid).cloned()) {
        n.notify_one();
    }
    CANCELS.lock().ok().map(|mut m| m.remove(&sid));
}

#[no_mangle]
pub extern "system" fn Java_com_alibaba_mnnllm_android_SpiritPalOnDevice_nativeIsCancelled(
    mut env: JNIEnv,
    _class: JClass,
    session_id: JString,
) -> jni::sys::jboolean {
    let sid = env
        .get_string(&session_id)
        .ok()
        .and_then(|s| s.to_str().ok().map(str::to_owned))
        .unwrap_or_default();
    let cancelled = CANCELS
        .lock()
        .ok()
        .and_then(|m| m.get(&sid).map(|c| c.is_cancelled()))
        .unwrap_or(false);
    cancelled as jni::sys::jboolean
}

// ---- Tauri 命令（仅移动端，命令名前缀 ondevice_ 与前端 invoke 对齐）----

// ⚠️ 函数名即命令名：Tauri 的 `#[tauri::command]` **不支持 `name = "..."` 属性**
// （tauri-macros 只解析 rename_all / rename / root，其余 Meta 被**静默忽略**）。
// 故必须让函数名等于前端 invoke 的名字，否则运行时报 `Command xxx not found`。
#[tauri::command]
pub async fn ondevice_generate(
    app: AppHandle,
    model_id: String,
    session_id: String,
    prompt: String,
    params_json: Option<String>,
) -> Result<(), String> {
    stash_app(&app);
    let cancel = CancellationToken::new();
    CANCELS
        .lock()
        .ok()
        .map(|mut m| m.insert(session_id.clone(), cancel.clone()));
    let done = Arc::new(Notify::new());
    DONE.lock()
        .ok()
        .map(|mut m| m.insert(session_id.clone(), done.clone()));

    let sid = session_id.clone();
    let p = prompt.clone();
    let pj = params_json.unwrap_or_else(|| "{}".to_string());
    let done_wait = done.clone();

    let job = async move {
        // Kotlin generate 若同步执行会在本调用内流式并触发 nativeOnDone（已 notify）；
        // 若异步（内部起后台线程）则稍后 notify。done_wait.notified() 两种都正确收口。
        let r = kotlin_generate(&sid, &p, &pj);
        done_wait.notified().await;
        match r {
            Ok(()) => "ok".to_string(),
            Err(e) => format!("ERR:{e}"),
        }
    };

    let res = scheduler().enqueue(1, job, cancel).await;
    DONE.lock().ok().map(|mut m| m.remove(&session_id));
    CANCELS.lock().ok().map(|mut m| m.remove(&session_id));
    match res {
        Ok(s) if s == "ok" => {
            models(&app)
                .lock()
                .ok()
                .map(|m| m.note_loaded(&model_id, 0));
            Ok(())
        }
        Ok(s) => Err(s),
        Err(SchedError::Cancelled) => Err("cancelled".into()),
        Err(e) => Err(format!("{e:?}")),
    }
}

#[tauri::command]
pub async fn ondevice_load_model(
    app: AppHandle,
    model_id: String,
    config_path: String,
    enable_thinking: Option<bool>,
) -> Result<(), String> {
    stash_app(&app);
    // ⚠️ ANR 防护：`SpiritPalOnDevice.loadModel` → `LlmSession.load()` 是**同步**的（2B 模型可能数十秒）。
    // Tauri 的**同步**命令在主线程内联执行（见 tauri-macros `body_blocking`）→ 直接调会 ANR。
    // 故改为 async（脱离主线程）+ spawn_blocking（不长期占用 tokio worker）。
    // 因类引用已由 `JNI_OnLoad` 缓存，本调用**不再依赖 Android 主线程**，可安全在后台线程执行。
    // enable_thinking 经 Kotlin 覆写 config.json 后 load（MNN 仅在 load 时读取该字段）。
    let et = if enable_thinking.unwrap_or(false) { "1" } else { "0" };
    let (mid, cfg, e) = (model_id.clone(), config_path.clone(), et.to_string());
    tauri::async_runtime::spawn_blocking(move || kotlin_load_model(&mid, &cfg, &e))
        .await
        .map_err(|e| format!("load_model join error: {e}"))??;
    models(&app)
        .lock()
        .ok()
        .map(|m| m.note_loaded(&model_id, 0));
    Ok(())
}

#[tauri::command]
pub fn ondevice_unload_model(app: AppHandle, model_id: String) -> Result<(), String> {
    stash_app(&app);
    kotlin_release()?;
    // 简化：release 整个 session；精确按 id 卸载待 Kotlin 侧支持多 session
    models(&app).lock().ok().map(|m| m.evict_idle(0));
    let _ = &model_id;
    Ok(())
}

/// 模型根目录（供 UI 提示用户把 MNN 模型目录放进来）。
#[tauri::command]
pub fn ondevice_models_dir(app: AppHandle) -> Result<ModelsDirInfo, String> {
    stash_app(&app);
    let dir = models(&app)
        .lock()
        .map(|m| m.dir().to_string_lossy().into_owned())
        .map_err(|_| "ondevice: model manager lock poisoned".to_string())?;
    Ok(ModelsDirInfo { dir })
}

/// 列出磁盘上**可用**的模型（含 `config.json` 的目录），并附已加载状态。
#[tauri::command]
pub fn ondevice_list_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    stash_app(&app);
    let guard = models(&app)
        .lock()
        .map_err(|_| "ondevice: model manager lock poisoned".to_string())?;
    let resident = guard.resident_bytes();
    Ok(guard
        .scan_available()
        .into_iter()
        .map(|a| ModelInfo {
            config_path: a.path.join("config.json").to_string_lossy().into_owned(),
            path: a.path.to_string_lossy().into_owned(),
            available: true,
            loaded: guard.is_loaded(&a.id),
            id: a.id,
            size_bytes: a.size_bytes,
            resident_bytes: resident,
        })
        .collect())
}

#[tauri::command]
pub fn ondevice_cancel(_app: AppHandle, session_id: String) -> Result<(), String> {
    CANCELS
        .lock()
        .ok()
        .and_then(|mut m| m.get(&session_id).map(|c| c.cancel()));
    Ok(())
}

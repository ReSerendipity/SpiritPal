#![cfg(mobile)]

//! 移动端（Android）端侧图像桥 —— Qwen-Image-2.1（MNN + OpenCL，进程内推理）。
//!
//! 仅 `#[cfg(mobile)]` 编译；桌面端不编此文件（桌面无端侧图像能力，前端按设备分档不暴露入口）。
//! 设计 / 文件级改动见 `docs/agents/ADR-0006-ondevice-image.md`。
//!
//! 桥接契约（Kotlin 侧 `com.spiritpal.desktop_pet.QwenImageBridge`，其内部包装
//! libQwenImage21 的 `com.scsonic.qwenimage21.QwenImage21` Java API）：
//! - Rust → Kotlin（`call_static_method`）：
//!   - `loadModel(modelDir: String, optionsJson: String)`
//!   - `generate(sessionId: String, requestJson: String)`
//!   - `release()`
//!   - `missingFiles(modelDir: String): String`
//! - Kotlin → Rust（native，按 JNI 命名自动链接）：
//!   - `nativeOnProgress(sessionId: String, percent: Int)`
//!   - `nativeOnDone(sessionId: String, ok: Boolean, error: String)`
//!   - `nativeIsCancelled(sessionId: String): Boolean`
//!
//! 数据流：`invoke("ondevice_image_generate")`
//!   → `Scheduler` 串行槽（**与 LLM 共享**，防两者并发抢内存 OOM）
//!   → JNI `QwenImageBridge.generate`
//!   → Kotlin 后台线程跑 MNN 扩散（分钟级）→ 每步调 `nativeOnProgress`
//!   → `app.emit("ondevice://image_progress")` → 前端进度条
//!   → 结束调 `nativeOnDone` → `app.emit("ondevice://image_done")` → Rust 唤醒命令返回
//!
//! ⚠️ 与 LLM 桥的两点差异：
//!   1. 单次生成是**分钟级**任务（Snapdragon 8 Gen 2 上 Turbo 6 步约 220s），
//!      故进度回调是产品刚需（不能只靠流式 token）；
//!   2. 取消同为协作式（Kotlin 每步查 `nativeIsCancelled`），但**粒度只能到「步」**。
//!
//! ⚠️ 验证状态（2026-10-13）：本文件按 engine.rs 已验证的结构编写，但**尚未经 Android
//!   交叉编译与真机验证**（Windows 上 `#[cfg(mobile)]` 不参与编译）。首次 Android 构建后须核对：
//!   ① JNI 符号名与 Kotlin `@JvmStatic external fun` 严格对应；
//!   ② `QwenImageBridge` 被 proguard keep（已登记于 scripts/verify_android_jni_keeps.py）。

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, OnceLock};

use jni::objects::{GlobalRef, JClass, JString, JValue, JValueOwned};
use jni::JNIEnv;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use super::engine::{scheduler, stash_app, APP, JVM};
use super::scheduler::SchedError;

/// Kotlin 桥的 JNI 类名（与 `QwenImageBridge.kt` 的包名严格对应）。
const BRIDGE: &str = "com/spiritpal/desktop_pet/QwenImageBridge";

/// `JNI_OnLoad` 缓存的 `QwenImageBridge` 类全局引用。
///
/// 由 [`cache_bridge_class`] 在 `engine::JNI_OnLoad` 中填充（应用 class loader 上下文）。
static BRIDGE_CLASS: OnceLock<GlobalRef> = OnceLock::new();

/// 取消令牌 / 完成信号按 session 存（与 engine.rs 同构）。
/// ⚠️ `HashMap::new()` 不是 const fn → 用 LazyLock（同 engine.rs）。
static CANCELS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static DONE: LazyLock<Mutex<HashMap<String, Arc<Notify>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 模型目录完整性信息（供 UI 提示"还差哪些文件"）。
#[derive(Serialize)]
pub struct MissingFilesInfo {
    /// Kotlin 侧返回的缺失文件描述（空串 = 完整）
    pub missing: String,
    /// 是否完整（可直接开始生成）
    pub complete: bool,
}

/// 由 `engine::JNI_OnLoad` 调用：缓存 `QwenImageBridge` 的全局类引用。
///
/// ⚠️ 必须在 `JNI_OnLoad`（**应用 class loader** 上下文）里做 —— 原因见 engine.rs 同名注释：
/// attach 出来的 native 线程上 `find_class` 走 system class loader，找不到应用自己的类。
pub(crate) fn cache_bridge_class(env: &mut JNIEnv<'_>) {
    if BRIDGE_CLASS.get().is_some() {
        return;
    }
    if let Ok(cls) = env.find_class(BRIDGE) {
        if let Ok(g) = env.new_global_ref(cls) {
            let _ = BRIDGE_CLASS.set(g);
        }
    }
}

/// 取当前线程的 JNIEnv（attach 到 engine 缓存的 JavaVM —— 与 LLM 桥同一个 JVM）。
///
/// 与 engine.rs 的 `with_env` 唯一差别：返回类型泛型化，以便读取 `missingFiles` 的字符串返回值。
fn with_env<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce(&mut JNIEnv<'_>) -> Result<T, String>,
{
    let vm = JVM
        .get()
        .ok_or_else(|| "image: JVM 未初始化（JNI_OnLoad 未执行）".to_string())?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("attach_current_thread: {e}"))?;
    f(&mut env)
}

/// 调用 `QwenImageBridge` 上的静态方法。
///
/// 入参一律为 String；返回值若为 String 则读出（`missingFiles` 用），否则 `None`。
fn call_bridge(method: &str, sig: &str, args: Vec<String>) -> Result<Option<String>, String> {
    with_env(|env| {
        let cached = BRIDGE_CLASS
            .get()
            .ok_or_else(|| "image: QwenImageBridge 类未缓存".to_string())?;
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
        let ret = env
            .call_static_method(&cls, method, sig, &jvalues)
            .map_err(|e| format!("call {method}: {e}"))?;
        // 模式匹配而非 `JValueOwned::l()`：跨 jni 0.21 的小版本更稳。
        if let JValueOwned::Object(obj) = ret {
            if !obj.is_null() {
                let js = JString::from(obj);
                let s = env
                    .get_string(&js)
                    .map_err(|e| format!("get_string: {e}"))?;
                return Ok(Some(s.to_string_lossy().into_owned()));
            }
        }
        Ok(None)
    })
}

fn kotlin_load_model(model_dir: &str, options_json: &str) -> Result<(), String> {
    call_bridge(
        "loadModel",
        "(Ljava/lang/String;Ljava/lang/String;)V",
        vec![model_dir.to_string(), options_json.to_string()],
    )
    .map(|_| ())
}

fn kotlin_generate(session_id: &str, request_json: &str) -> Result<(), String> {
    call_bridge(
        "generate",
        "(Ljava/lang/String;Ljava/lang/String;)V",
        vec![session_id.to_string(), request_json.to_string()],
    )
    .map(|_| ())
}

fn kotlin_release() -> Result<(), String> {
    call_bridge("release", "()V", vec![]).map(|_| ())
}

fn kotlin_missing_files(model_dir: &str) -> Result<String, String> {
    call_bridge(
        "missingFiles",
        "(Ljava/lang/String;)Ljava/lang/String;",
        vec![model_dir.to_string()],
    )
    .map(|s| s.unwrap_or_default())
}

// ---- Kotlin → Rust native 回调（按 JNI 命名自动链接）----

/// 从 JString 取 owned String（失败则空串）。
fn take_string(env: &mut JNIEnv<'_>, s: &JString<'_>) -> String {
    env.get_string(s)
        .ok()
        .and_then(|v| v.to_str().ok().map(str::to_owned))
        .unwrap_or_default()
}

#[no_mangle]
pub extern "system" fn Java_com_spiritpal_desktop_pet_QwenImageBridge_nativeOnProgress(
    mut env: JNIEnv,
    _class: JClass,
    session_id: JString,
    percent: jni::sys::jint,
) {
    let sid = take_string(&mut env, &session_id);
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "ondevice://image_progress",
            serde_json::json!({"sessionId": sid, "percent": percent}),
        );
    }
}

#[no_mangle]
pub extern "system" fn Java_com_spiritpal_desktop_pet_QwenImageBridge_nativeOnDone(
    mut env: JNIEnv,
    _class: JClass,
    session_id: JString,
    ok: jni::sys::jboolean,
    error: JString,
) {
    let sid = take_string(&mut env, &session_id);
    let err = take_string(&mut env, &error);
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "ondevice://image_done",
            serde_json::json!({"sessionId": sid, "ok": ok != 0, "error": err}),
        );
    }
    if let Some(n) = DONE.lock().ok().and_then(|m| m.get(&sid).cloned()) {
        n.notify_one();
    }
    CANCELS.lock().ok().map(|mut m| m.remove(&sid));
}

#[no_mangle]
pub extern "system" fn Java_com_spiritpal_desktop_pet_QwenImageBridge_nativeIsCancelled(
    mut env: JNIEnv,
    _class: JClass,
    session_id: JString,
) -> jni::sys::jboolean {
    let sid = take_string(&mut env, &session_id);
    let cancelled = CANCELS
        .lock()
        .ok()
        .and_then(|m| m.get(&sid).map(|c| c.is_cancelled()))
        .unwrap_or(false);
    cancelled as jni::sys::jboolean
}

// ---- Tauri 命令（仅移动端；命令名 = 函数名，见 engine.rs 注释）----

/// 加载图像模型（分钟级：DiT 4.5GB + text encoder 5.4GB 从磁盘映射）。
///
/// ⚠️ ANR 防护：与 `ondevice_load_model` 同理 —— 同步实现在主线程会 ANR，
/// 故 async + `spawn_blocking`（类引用已由 `JNI_OnLoad` 缓存，不依赖 Android 主线程）。
#[tauri::command]
pub async fn ondevice_image_load(
    app: AppHandle,
    model_dir: String,
    options_json: Option<String>,
) -> Result<(), String> {
    stash_app(&app);
    let dir = model_dir.clone();
    let opts = options_json.unwrap_or_else(|| "{}".to_string());
    tauri::async_runtime::spawn_blocking(move || kotlin_load_model(&dir, &opts))
        .await
        .map_err(|e| format!("image_load join error: {e}"))??;
    Ok(())
}

/// 生成 / 编辑图像（分钟级异步任务，进度经 `ondevice://image_progress` 事件回灌）。
///
/// `request_json` 由前端构造（字段与 Kotlin 桥约定）：
/// `{ "prompt": str, "sizeRatio": str, "sizeTier": str, "steps": int, "seed": int,
///    "outputPng": str, "inputImage": str|null, "inputImage2": str|null }`
#[tauri::command]
pub async fn ondevice_image_generate(
    app: AppHandle,
    session_id: String,
    request_json: String,
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
    let req = request_json.clone();
    let done_wait = done.clone();

    let job = async move {
        // Kotlin 侧在后台线程跑（分钟级），结束时调 nativeOnDone → notify。
        // 若 Kotlin 同步执行（不会，见 QwenImageBridge.kt），nativeOnDone 亦已先 notify，
        // 故 `done_wait.notified().await` 两种情形都正确收口。
        let r = kotlin_generate(&sid, &req);
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
        Ok(s) if s == "ok" => Ok(()),
        Ok(s) => Err(s),
        Err(SchedError::Cancelled) => Err("cancelled".into()),
        Err(e) => Err(format!("{e:?}")),
    }
}

#[tauri::command]
pub fn ondevice_image_cancel(_app: AppHandle, session_id: String) -> Result<(), String> {
    CANCELS
        .lock()
        .ok()
        .and_then(|mut m| m.get(&session_id).map(|c| c.cancel()));
    Ok(())
}

/// 释放图像引擎持有的模型内存（与端侧 LLM 争内存时应主动调用）。
#[tauri::command]
pub fn ondevice_image_release(app: AppHandle) -> Result<(), String> {
    stash_app(&app);
    kotlin_release()
}

/// 设备与模型目录探测（供设置页「端侧图像」面板展示能力判定的**原始依据**）。
///
/// 能力判定本身在前端（`onDeviceTiers.imageCapability()`），这里只给事实：
/// - `ram_gb`：物理内存（与端侧 LLM 同源，读 `/proc/meminfo`）
/// - `opencl`：是否存在 OpenCL 运行时（查厂商/系统常见路径）
/// - `model_dir`：模型根目录（与端侧 LLM **共用**同一目录）
///
/// ⚠️ 不做空闲存储检测：Rust std 无 statvfs 封装，为一个提示引入 libc 依赖不划算。
///    存储门槛（约 11GB）由 UI 以文案形式提示用户自查。
#[derive(Serialize)]
pub struct ImageDeviceInfo {
    pub ram_gb: f64,
    pub opencl: bool,
    pub model_dir: String,
}

/// OpenCL 运行时探测：查厂商/系统常见路径。
///
/// Android 11+ 即使文件存在，也需 manifest 的 `uses-native-library` 才可 dlopen ——
/// 本仓已在 AndroidManifest.xml 声明（见该文件注释），故此处只做"运行时是否存在"的粗判。
fn detect_opencl() -> bool {
    const PATHS: [&str; 4] = [
        "/vendor/lib64/libOpenCL.so",
        "/system/lib64/libOpenCL.so",
        "/vendor/lib/libOpenCL.so",
        "/system/lib/libOpenCL.so",
    ];
    PATHS.iter().any(|p| std::path::Path::new(p).exists())
}

#[tauri::command]
pub fn ondevice_image_probe(app: AppHandle) -> Result<ImageDeviceInfo, String> {
    stash_app(&app);
    Ok(ImageDeviceInfo {
        ram_gb: super::mobile_total_ram_gb().unwrap_or(8.0),
        opencl: detect_opencl(),
        model_dir: super::engine::model_dir(&app)
            .to_string_lossy()
            .into_owned(),
    })
}

/// 检查模型目录里缺失哪些文件（供 UI 提示"还差哪些"，避免用户盲下 15GB）。
#[tauri::command]
pub async fn ondevice_image_missing_files(
    _app: AppHandle,
    model_dir: String,
) -> Result<MissingFilesInfo, String> {
    let dir = model_dir.clone();
    let missing = tauri::async_runtime::spawn_blocking(move || kotlin_missing_files(&dir))
        .await
        .map_err(|e| format!("missing_files join error: {e}"))??;
    Ok(MissingFilesInfo {
        complete: missing.trim().is_empty(),
        missing,
    })
}

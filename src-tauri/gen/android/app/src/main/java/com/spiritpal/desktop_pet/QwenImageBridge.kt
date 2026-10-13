package com.spiritpal.desktop_pet

import android.graphics.Bitmap
import android.util.Log
import com.scsonic.qwenimage21.QwenImage21
import org.json.JSONObject
import java.io.File

/** 性能日志 tag（真机验证时用 `adb logcat -s QwenImageBridge` 抓） */
private const val TAG = "QwenImageBridge"

/**
 * SpiritPal 端侧图像桥 —— Qwen-Image-2.1（MNN + OpenCL，进程内推理）。
 *
 * 本类**薄包装** libQwenImage21 的 `com.scsonic.qwenimage21.QwenImage21` Java API
 * （由 `scripts/fetch_qwen_image_engine.py` 从 AAR 解包为 `app/libs/qwenimage21.jar`），
 * 对外只暴露 SpiritPal 自己的 JNI 契约，隔离上游类名/方法变动。
 *
 * Rust 侧 [src-tauri/src/ondevice/image.rs] 经 JNI 调本 object 的静态方法，
 * 进度与完成经以下 native 方法回灌（image.rs → app.emit("ondevice://image_progress"/"image_done")）：
 *  - nativeOnProgress(sessionId: String, percent: Int)
 *  - nativeOnDone(sessionId: String, ok: Boolean, error: String)
 *  - nativeIsCancelled(sessionId: String): Boolean
 *
 * ⚠️ 关于「取消」：libQwenImage21 的 `ProgressListener.onProgress(int)` **返回 void**，
 *    没有 LLM 那种「返回 true 即中止」的协作式取消通道；上游也没有 cancel API。
 *    因此图像生成**无法真正中断** —— `nativeIsCancelled` 目前仅作状态查询，
 *    上层取消的语义是「放弃等待、丢弃结果」，推理仍会在后台跑完当前任务。
 *    待上游支持后再接入真正的中止。
 *
 * ⚠️ 关于「内存」：DiT（4.5GB）+ text encoder（5.4GB）常驻，与端侧 LLM（约 3.4GB）
 *    在 12GB 设备上**不可能共存**。本类不做自动卸载；由上层（前端 UI / Rust 命令）
 *    在加载图像模型前决定是否先 `ondevice_unload_model` 释放 LLM。
 *
 * ⚠️ proguard / release：`QwenImageBridge` 与 `com.scsonic.qwenimage21.**` 均需 keep，
 *    见 `src-tauri/gen/android/app/proguard-rules.pro` 与 `scripts/verify_android_jni_keeps.py`。
 */
object QwenImageBridge {
    /** 当前已加载的引擎实例（单实例设计，与端侧 LLM 的 LlmSession 同构）。 */
    private var engine: QwenImage21? = null

    // ---- Kotlin → Rust（native，按 JNI 命名自动链接）----

    @JvmStatic
    external fun nativeOnProgress(sessionId: String, percent: Int)

    @JvmStatic
    external fun nativeOnDone(sessionId: String, ok: Boolean, error: String)

    @JvmStatic
    external fun nativeIsCancelled(sessionId: String): Boolean

    // ---- Rust → Kotlin ----

    /**
     * 加载图像模型。
     *
     * @param modelDir 模型目录（含 `dit.mnn` / `text_encoder/` / `vae_*_tiny.mnn` 等）
     * @param optionsJson 选项，缺省即用推荐默认：
     *   `{"useGpu":true,"textEncoderOnCpu":true,"vaeOnCpu":false,"turbo":true,
     *     "tinyVae":true,"threads":4,"keepModelsLoaded":true}`
     *
     * ⚠️ 与官方 demo 一致：DiT 走 OpenCL GPU，text encoder 与（真实）VAE 走 CPU。
     *    tiny VAE（默认）体积小，可留在 GPU。
     */
    @JvmStatic
    fun loadModel(modelDir: String, optionsJson: String) {
        release()
        val jo = if (optionsJson.isBlank()) JSONObject() else JSONObject(optionsJson)
        val dir = File(modelDir)
        val opts = QwenImage21.Options().apply {
            useGpu = jo.optBoolean("useGpu", true)
            textEncoderOnCpu = jo.optBoolean("textEncoderOnCpu", true)
            vaeOnCpu = jo.optBoolean("vaeOnCpu", false)
            turbo = jo.optBoolean("turbo", true)
            tinyVae = jo.optBoolean("tinyVae", true)
            threads = jo.optInt("threads", 4)
            keepModelsLoaded = jo.optBoolean("keepModelsLoaded", true)
            // 低内存杀手（LMK）把进程杀掉时留痕，下次启动可读回「哪一阶段挂的」。
            // 放在模型目录下，随模型一起被管理。
            crashMarkerFile = File(dir, ".qwen_image_crash.marker")
        }
        engine = QwenImage21(dir, opts)
        Log.i(TAG, "loaded model dir=$modelDir turbo=${opts.turbo} tinyVae=${opts.tinyVae}")
    }

    /**
     * 生成 / 编辑图像。在后台线程执行（分钟级），结束经 `nativeOnDone` 收口。
     *
     * @param requestJson `{"prompt":str, "width":int, "height":int, "steps":int, "seed":int,
     *   "outputPng":str, "inputImage":str?, "inputImage2":str?}`
     *   宽高由**前端**按分档表算好（见 `src/lib/ai/onDeviceTiers.ts`），避免在此重复一套尺寸算法。
     */
    @JvmStatic
    fun generate(sessionId: String, requestJson: String) {
        val e = engine
        if (e == null) {
            nativeOnDone(sessionId, false, "engine not loaded")
            return
        }
        Thread {
            var ok = false
            var err = ""
            try {
                val jo = JSONObject(requestJson)
                val prompt = jo.optString("prompt", "")
                val width = jo.optInt("width", 512)
                val height = jo.optInt("height", 512)
                val steps = jo.optInt("steps", 6)
                val seed = jo.optInt("seed", 42)
                val out = File(jo.getString("outputPng"))
                out.parentFile?.mkdirs()
                val img1 = jo.optString("inputImage", "").ifBlank { null }
                val img2 = jo.optString("inputImage2", "").ifBlank { null }

                val listener = QwenImage21.ProgressListener { percent ->
                    // 仅上报进度。上游 onProgress 返回 void，无中止通道 —— 见类头注「关于取消」。
                    nativeOnProgress(sessionId, percent)
                }

                val bmp: Bitmap? = when {
                    // 双参考图编辑（上游实验特性，见 docs/MULTI_REF.md）
                    img2 != null && img1 != null ->
                        e.edit(prompt, File(img1), File(img2), QwenImage21.Size.Tier.STANDARD,
                            steps, seed, out, listener)
                    // 单参考图编辑
                    img1 != null -> e.edit(prompt, File(img1), width, height, steps, seed, out, listener)
                    // 文生图
                    else -> e.generate(prompt, width, height, steps, seed, out, listener)
                }
                ok = bmp != null
                if (!ok) err = "generation returned null"
                Log.i(TAG, "done session=$sessionId ok=$ok size=${width}x$height steps=$steps")
            } catch (t: Throwable) {
                err = t.message ?: t.javaClass.simpleName
                Log.w(TAG, "generate failed session=$sessionId", t)
            } finally {
                nativeOnDone(sessionId, ok, err)
            }
        }.start()
    }

    /** 释放引擎（单实例设计；释放后 `generate` 会以 "engine not loaded" 收口）。 */
    @JvmStatic
    fun release() {
        try {
            engine?.close()
        } catch (t: Throwable) {
            Log.w(TAG, "release failed", t)
        }
        engine = null
    }

    /**
     * 返回模型目录里缺失的文件描述（空串 = 完整）。供 UI 提示"还差哪些"，
     * 避免用户盲下 15GB。
     */
    @JvmStatic
    fun missingFiles(modelDir: String): String = try {
        QwenImage21.missingFiles(File(modelDir)) ?: ""
    } catch (t: Throwable) {
        Log.w(TAG, "missingFiles failed", t)
        "missingFiles failed: ${t.message}"
    }
}

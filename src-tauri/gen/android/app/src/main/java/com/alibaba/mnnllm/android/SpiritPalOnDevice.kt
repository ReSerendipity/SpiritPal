package com.alibaba.mnnllm.android

import android.util.Log
import com.alibaba.mnnllm.android.llm.GenerateProgressListener
import com.alibaba.mnnllm.android.llm.LlmSession
import org.json.JSONObject
import java.util.HashMap

/** 性能日志 tag（真机验证时用 `adb logcat -s SpiritPalOnDevice` 抓） */
private const val TAG_PERF = "SpiritPalOnDevice"

/**
 * SpiritPal 内嵌 MNN 引擎桥（进程内推理，单进程持模型）。
 *
 * Rust 侧 [src-tauri/src/ondevice/engine.rs] 经 JNI 调本 object 的静态方法，
 * 流式 token 经以下 native 方法回灌前端（engine.rs → app.emit("ondevice://token"/"ondevice://done")）：
 *  - nativeOnToken(sessionId: String, text: String)
 *  - nativeOnDone(sessionId: String)
 *  - nativeIsCancelled(sessionId: String): Boolean
 *
 * 依赖（由 Doro 从 alibaba/MNN @ v3.6.1 复制到同包，见 ondevice-embed-plan.md §3.2）：
 *  - com.alibaba.mnnllm.android.llm.LlmSession
 *  - com.alibaba.mnnllm.android.llm.GenerateProgressListener
 *  - LlmSession 的其余依赖类（ModelConfig / Jinja / MmapUtils 等，整包复制）
 *
 * ⚠️ proguard / release：在 app 的 proguard 规则追加
 *      -keep class com.alibaba.mnnllm.android.SpiritPalOnDevice { *; }
 *   否则 release 构建混淆会重命名本类，破坏 JNI native 链接。
 *
 * ⚠️ NDK 验证：本文件无法在本环境编译（无 Android NDK / 真机），仅 MNN llm 包就位后由
 *   `tauri android build` 编译；JNI 符号名与 engine.rs 的 extern "system" fn 严格对应。
 */
object SpiritPalOnDevice {
    private var session: LlmSession? = null

    @JvmStatic
    external fun nativeOnToken(sessionId: String, text: String)

    @JvmStatic
    external fun nativeOnDone(sessionId: String)

    @JvmStatic
    external fun nativeIsCancelled(sessionId: String): Boolean

    /**
     * 加载一个端侧模型（configPath 指向 MNN 模型的 config.json）。
     * @param enableThinking "1" 开启思维链 / 其他值关闭。MNN **仅在 load 时**从 config.json 读
     *   `enable_thinking`，而 generate() 的 params 被忽略（见 llm/LlmSession.kt），故必须在此改写
     *   config.json。聊天宠物默认关（长上下文 TTFT 从 >2min 降到 ~4s）；复杂推理可在设置里开。
     */
    @JvmStatic
    fun loadModel(modelId: String, configPath: String, enableThinking: String) {
        // 按用户偏好覆写 config.json 的 enable_thinking（同目录，MNN 按父目录解析权重文件 llm.mnn 等）。
        // 每次加载都重新覆写，保证开关状态对 app 重启/重新加载确定生效。
        try {
            val cfgFile = java.io.File(configPath)
            if (cfgFile.isFile) {
                val jo = JSONObject(cfgFile.readText())
                jo.put("enable_thinking", enableThinking == "1")
                cfgFile.writeText(jo.toString())
            }
        } catch (e: Throwable) {
            Log.w(TAG_PERF, "enable_thinking 覆写失败，沿用模型自带 config.json：${e.message}")
        }
        session = LlmSession(
            modelId,
            System.currentTimeMillis().toString(),
            configPath,
            null, // savedHistory
            null, // backendType
            true, // useCustomConfig
        )
        session?.load()
    }

    /**
     * 生成（流式）。在后台线程跑 MNN 推理，每 token 经 nativeOnToken 回灌，
     * 结束（或异常）经 nativeOnDone 收口，保证前端不会无限等待。
     * paramsJson: 前端透传的生成参数（如 temperature / max_new_tokens），解析为 Map 交给 MNN。
     */
    @JvmStatic
    fun generate(sessionId: String, prompt: String, paramsJson: String) {
        val s = session ?: run {
            nativeOnDone(sessionId)
            return
        }
        Thread {
            try {
                val params = HashMap<String, Any>()
                if (paramsJson.isNotBlank() && paramsJson != "{}") {
                    val jo = JSONObject(paramsJson)
                    val keys = jo.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        params[k] = jo.get(k)
                    }
                }
                s.generate(
                    prompt,
                    params,
                    object : GenerateProgressListener {
                        override fun onProgress(progress: String?): Boolean {
                            progress?.let { nativeOnToken(sessionId, it) }
                            // 返回 true = 取消（Rust 侧 CancellationToken 经 nativeIsCancelled 查询）
                            return nativeIsCancelled(sessionId)
                        }
                    },
                ).also { r ->
                    // MNN 原生层在返回 map 中给出权威计时（键名见官方 LlmSession 的 mock 实现）：
                    //   decode_len   — 生成 token 数
                    //   prefill_time — prefill 耗时（微秒）
                    //   decode_time  — decode 总耗时（微秒）
                    // 由此可算 TTFT 与持续生成速率（tok/s）——调研「第一步」要的正是这两个数。
                    val len = (r["decode_len"] as? Number)?.toLong() ?: 0L
                    val pre = (r["prefill_time"] as? Number)?.toLong() ?: 0L
                    val dec = (r["decode_time"] as? Number)?.toLong() ?: 0L
                    val tps = if (dec > 0) len * 1_000_000.0 / dec else 0.0
                    Log.i(
                        TAG_PERF,
                        "PERF tokens=$len prefill=${pre / 1000}ms " +
                            "decode=${dec / 1000}ms decode_rate=${"%.2f".format(tps)} tok/s",
                    )
                }
            } catch (e: Throwable) {
                e.printStackTrace()
            } finally {
                nativeOnDone(sessionId)
            }
        }.start()
    }

    /** 释放当前会话（单 session 设计；精确按 id 卸载待 MNN 支持多 session）。 */
    @JvmStatic
    fun release() {
        session?.release()
        session = null
    }
}

// SpiritPal 端侧 MNN 引擎桥 —— 最小同名 LlmSession（替代「整包 vendor」方案）
//
// 为什么自写而非 vendor MNN 的 LlmSession.kt：
//   MNN 原版 LlmSession.kt 依赖 App 级基础设施（ModelConfig → com.alibaba.mls.api.* 即
//   model_downloader 框架模块；ChatDataItem → chat/chatlist UI 组件；ModelTypeUtils →
//   modelist 模型市场）。朴素传递闭包达 80 个文件 + Ktor/Material/Markwon/Firebase/OkHttp。
//   详见 docs/execution/ondevice-theory-validation-20260916.md。
//
// 本文件只复刻 libmnnllmapp.so 原生层**真正需要**的 JNI 契约（符号名取自
// `llvm-nm -D libmnnllmapp.so | grep ^Java_`；参数表取自 MNN @3.6.1 的 LlmSession.kt）：
//   Java_com_alibaba_mnnllm_android_llm_LlmSession_{initNative,submitNative,resetNative,releaseNative}
// ⚠️ 类名/包名/方法名/参数类型必须与原生层严格一致，否则 JNI 链接失败（UnsatisfiedLinkError）。
//
// 与 MNN 原版的语义差异（已知、有意）：
//   1. 不解析/合并 ModelConfig：直接把模型自带 config.json 的原文作为 mergedConfigStr 传入
//      （原生 Llm::createLLM 本身就读该 config.json，故等价）。
//   2. configMapJson 固定 3 字段（is_r1 / mmap_dir / keep_history），无下载框架依赖。
//   3. generate() 的 params 不透传 —— 与原版**行为一致**：MNN 原版 generate() 同样完全不使用
//      params，只调 submitNative(ptr, prompt, keepHistory, listener)；采样/长度/系统提示等由 UI
//      经 updateMaxNewTokensNative / updateSystemPromptNative / updateConfigNative 单独设置
//      （这三个符号在 .so 中均存在，需要时可在此类上补 setter）。
package com.alibaba.mnnllm.android.llm

import android.util.Log
import java.io.File

/**
 * 最小 LlmSession：单 session 持有一个原生句柄。
 *
 * 构造参数与 MNN 原版保持同形，以便 [com.alibaba.mnnllm.android.SpiritPalOnDevice] 无需改动。
 */
class LlmSession(
    private val modelId: String,
    private val sessionId: String,
    private val configPath: String,
    private val savedHistory: List<String>? = null,
    private val backendType: String? = null,
    @Suppress("UNUSED_PARAMETER") private val useCustomConfig: Boolean = true,
) {
    @Volatile
    private var nativePtr: Long = 0L

    /** 加载模型。configPath 指向 MNN 模型的 config.json。失败抛异常（由上层收口）。 */
    fun load() {
        check(nativePtr == 0L) { "LlmSession already loaded" }
        val cfg = File(configPath)
        if (!cfg.isFile) {
            throw IllegalStateException("MNN model config.json not found: $configPath")
        }
        val mergedConfigStr = cfg.readText()
        // 与原版 load() 的 configMap 等价（去掉下载框架依赖）
        val configMapJson = """{"is_r1":false,"mmap_dir":"","keep_history":false}"""
        val ptr = initNative(configPath, savedHistory, mergedConfigStr, configMapJson)
        if (ptr == 0L) {
            throw IllegalStateException("MNN initNative returned 0 for $configPath")
        }
        nativePtr = ptr
        Log.d(TAG, "LlmSession loaded modelId=$modelId backend=$backendType")
    }

    /**
     * 流式生成。每 token 经 [listener].onProgress 回调（返回 true 即取消）。
     * @return 原生层返回的结果 map（含 decode 耗时等统计，字段以原生实现为准）。
     */
    fun generate(
        prompt: String,
        @Suppress("UNUSED_PARAMETER") params: Map<String, Any>,
        listener: GenerateProgressListener,
    ): HashMap<String, Any> {
        val ptr = nativePtr
        if (ptr == 0L) {
            Log.e(TAG, "generate() called before load(); session=$sessionId")
            return HashMap()
        }
        return submitNative(ptr, prompt, false, listener)
    }

    /** 清空对话历史（保留已加载模型）。 */
    fun reset() {
        val ptr = nativePtr
        if (ptr != 0L) resetNative(ptr)
    }

    /** 释放原生句柄。幂等。 */
    fun release() {
        val ptr = nativePtr
        if (ptr != 0L) {
            releaseNative(ptr)
            nativePtr = 0L
        }
    }

    // ===== 与 libmnnllmapp.so 的 JNI 契约（签名不可改）=====

    private external fun initNative(
        configPath: String?,
        history: List<String>?,
        mergedConfigStr: String?,
        configJsonStr: String?,
    ): Long

    private external fun submitNative(
        instanceId: Long,
        input: String,
        keepHistory: Boolean,
        listener: GenerateProgressListener,
    ): HashMap<String, Any>

    private external fun resetNative(instanceId: Long)

    private external fun releaseNative(instanceId: Long)

    companion object {
        private const val TAG = "LlmSession"

        init {
            System.loadLibrary("mnnllmapp")
        }
    }
}

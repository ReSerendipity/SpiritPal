// 来源：alibaba/MNN @ tag 3.6.1（Apache-2.0）
// apps/Android/MnnLlmChat/app/src/main/java/com/alibaba/mnnllm/android/llm/GenerateProgressListener.kt
// 逐字 vendored —— 该接口是 libmnnllmapp.so 原生层经 JNI 回调的契约，签名不可改。
package com.alibaba.mnnllm.android.llm

interface GenerateProgressListener {
    /** 返回 true = 取消生成。 */
    fun onProgress(progress: String?): Boolean
}

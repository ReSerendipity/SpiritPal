# 端侧推理框架调研（SpiritPal 移动端）

> 调研日期：2026-09-15
> 目标：为 SpiritPal 移动端（Tauri v2 + React + Rust）接入 Qwen3.5 小模型，**优先复用现有开源方案，不重复造轮子**
> 目标设备：骁龙8至尊版 / 12GB / Android 16（需向下兼容不同 SOC 与内存档位）

---

## 一、候选方案总览

| 方案 | 形态 | 引擎 | Qwen3.5 支持 | Android | iOS | 许可证 | 适配度 |
|---|---|---|---|---|---|---|---|
| **alibaba/MNN** + MnnLlmChat | C++ 引擎 + 完整 App | MNN-LLM | ✅ 原生（v0.8.0） | ✅ | ✅ | Apache-2.0 | ★★★★★ |
| **Daniele-rolli/tauri-plugin-local-ai** | Tauri 插件 | llama.cpp + ONNX + whisper | 未验证（内置 qwen2.5 GGUF） | ❌ 未打通 | ✅ 模拟器 | 需核实 | ★★★★☆ |
| **ggml-org/llama.cpp** + `llama-cpp-2` | C++ 引擎 + Rust 绑定 | llama.cpp | ✅ | ✅（需 NDK 自编译） | ✅ | MIT | ★★★☆☆ |
| **google-ai-edge/gallery** + MediaPipe | 官方示例 App + API | MediaPipe LLM Inference | ❌ 仅 `.task`/Gemma 系 | ✅ | ✅ | Apache-2.0 | ★★☆☆☆ |

---

## 二、候选 A：alibaba/MNN + MnnLlmChat（Android 主力推荐）

仓库：`https://github.com/alibaba/MNN` → `apps/Android/MnnLlmChat`

### 为什么对口

1. **已原生支持 Qwen3.5**。版本记录明确：v0.8.0「Support Qwen3.5」、v0.8.1「Support switching thinking mode for Qwen3.5」、
   v0.8.2.2「Refresh the bundled MNN runtime with the latest CPU **LinearAttention** and Arm82 fp16 optimization path」
   —— LinearAttention 正是 Qwen3.5 混合注意力（Gated DeltaNet）的核心，说明 MNN 已针对该架构做过 CPU 侧优化。
2. **全模态**：文生文、图生文、音频、扩散生图。视觉能力与我们「看看屏幕」的视觉感知功能直接对应。
3. **性能宣称**：官方基准（qwen-7b，Android CPU）prefill 比 llama.cpp 快 8.6x、decode 快 2.3x。
   ⚠️ 这是厂商自测数据，需自行验证；且 MNN 自评在 GPU 路径上略逊于 MLC-LLM。
4. **mmap 权重加载**（v0.2.2），降低峰值 RSS。
5. **模型下载策略与我们既有偏好一致**：支持 ModelScope + HuggingFace，且「系统语言为中文时首次安装优先走 ModelScope」。
6. **内置 ApiService**（v0.7.3.1 优化，v0.8.1.1 提到兼容 Anthropic 协议）——
   若可暴露 OpenAI 兼容端点，SpiritPal 现有 `LLMClient.chatOpenAI` 分支可**零改动接入**（只改 baseUrl）。
7. **许可证 Apache-2.0**，与 SpiritPal 一致，无合规冲突。
8. **NDK 27.2.12479018**；SpiritPal 现有 `local.properties` 为 27.0.12077973，版本接近，迁移成本低。

### 风险与限制

- 官方声明「仅在 OnePlus 13 与 Xiaomi 14 Ultra 上测试过」，低配机型可能推理慢/不稳定/跑不起来。
- 需要自己写 FFI 才能嵌入（见下）。
- `mnn` Rust crate（`aftershootco/mnn-rs`，Apache-2.0）封装的是**通用 MNN interpreter**，
  **不包含 LLM 便捷层**（`MNN::Transformer::Llm`）。LLM 那一层需自行写 FFI 绑定，这是主要工作量。

---

## 三、候选 B：tauri-plugin-local-ai（架构参考首选）

仓库：`https://github.com/Daniele-rolli/tauri-plugin-local-ai`

### 为什么值得看

技术栈与 SpiritPal **完全一致**（Tauri v2 + Rust + React），且它的三个核心模块正好覆盖我们缺的能力：

| 模块 | 能力 | 对 SpiritPal 的价值 |
|---|---|---|
| `src/tier` | T0/T1/T2 设备分级门控 | 正是「不同 SOC / 内存档位」的现成设计 |
| `src/scheduler` | 串行推理槽 + cancel | 正是单 Worker 串行防 OOM 的需求 |
| `src/models` | 下载缓存 + LRU 驱逐 | 权重分发与内存回收 |

另有 `embed_onnx`（通过 `ort` 跑 ONNX 嵌入，对应我们的 `bge-small-zh-v1.5`）、
`guest-js`（JS 绑定）、`docs/PERF-SAFE-LOCAL-AI.md`（性能安全使用指南）、`scripts/thermal-smoke.sh`（热节流冒烟测试）。

### 状态与坑

- **状态：working v0**，仅在 macOS desktop + iOS simulator 验证过；**Android 未打通**。
- **ggml 静态库链接冲突**：`whisper-rs-sys` 与 `llama-cpp-sys-2` 各自打包一份 ggml 静态库，
  在 Xcode 链接时冲突，导致 whisper 被 `cfg(not(target_os = "ios"))` 门控。
  ⚠️ SpiritPal 若同时内嵌 LLM + STT（我们已有 `stt.ts`）**会踩同一个坑**，需提前设计（单一 ggml 来源）。
- 内置模型仅 `qwen2.5-0.5b/1.5b-q4`、`llama-3.2-1b-q4`，未验证 Qwen3.5。
- `verify_sha` 是 stub（恒返回 true），demo 用 host 白名单 + 体积上限代替校验。
- 许可证未在 README 中声明，**采用前必须核实**。

### 建议定位

**作为架构参考与代码借鉴，不作为直接依赖**。tier-gated / scheduler / LRU 三件套的逻辑与引擎选型无关，可直接照搬设计。

---

## 四、候选 C：llama.cpp + llama-cpp-2（兜底，可控性最高）

- 官方 `docs/android.md` + `examples/llama.android` 提供 NDK/CMake 交叉编译路径。
- Rust 侧用 `llama-cpp-2`（`utilityai/llama-cpp-rs`，即 tauri-plugin-local-ai 所用）。
- 优点：生态最成熟、Qwen3.5 GGUF 直接可用（unsloth 已放出全量化档）、控制力最强、许可证 MIT。
- 缺点：Android 性能不如 MNN（尤其 prefill），需自行处理 NDK 交叉编译与 FFI。
- **定位**：若 MNN 的 FFI 工作量不可接受，退此方案。

---

## 五、候选 D：google-ai-edge/gallery + MediaPipe（不适合）

- 官方 Android/iOS 端侧 GenAI 示例，MediaPipe LLM Inference API（`LlmInference`）。
- **但模型格式为 `.task` / `.litertlm`，主要面向 Gemma 系**，不直接吃 GGUF，也不支持 Qwen3.5。
- 除非愿意做模型转换，否则不适配。**排除**。

---

## 六、推荐路线（三步，先验证后投入）

### 第一步：零成本验证（不写任何代码）
直接安装官方 MNN Chat APK，在骁龙8至尊版上实测：
- Qwen3.5-2B 在 128K 上下文 + 视觉常驻下的**真实峰值内存**（对照本仓 `ondevice-model-budget-20260915.html` 的测算值）
- **prefill / decode 速度**（首 token 延迟、持续生成速率）
- 连续多轮后的**热节流**表现
- 低配机型（8GB）上的降级行为

这一步能直接回答「到底行不行」，且成本为零。**在这一步拿到数据前，不要动工程代码。**

### 第二步：若数据可接受，内嵌 MNN 作为推理引擎
- 走 MNN 的 LLM C++ API（`MNN::Transformer::Llm`）做 FFI，链接进 `spiritpal_lib`
  （`Cargo.toml` 已有 `staticlib`/`cdylib`/`rlib`，条件满足）。
- ⚠️ `mnn` Rust crate 不含 LLM 便捷层，需自行绑定。
- ⚠️ **不要用 sidecar 进程方案**——Android 上不可靠，必须进程内。

### 第三步：架构模式借鉴 tauri-plugin-local-ai
tier-gated 分级、串行推理槽、模型 LRU 三件套照搬设计，与引擎选型解耦。

### 降级链
`ondevice` 加载失败或内存不足 → 复用现有 `ProviderHealthManager`（连续失败计数 + 冷却）
自动切云端；`dualBrain` 的 fastBrain（端侧）/ slowBrain（云端）自动升级机制天然适配。

---

## 七、待核实项

- [ ] `tauri-plugin-local-ai` 的许可证
- [ ] MNN Chat 的 ApiService 是否提供 **OpenAI 兼容**端点（若提供，接入成本骤降）
- [ ] MNN 的 LLM C++ API 在 Android 上的 FFI 绑定工作量评估
- [ ] MNN Chat 在 8GB 机型上的实际降级表现
- [ ] Qwen3.5-2B 在 MNN 下的**视觉（mmproj）加载方式**是否与 llama.cpp 的 `mmproj-F16.gguf` 兼容

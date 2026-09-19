# 移动端接入 GGUF — 工作量评估(路线 A/B)

> 项目:SpiritPal(移动端进程内推理现为内嵌 MNN)
> 评估日期:2026-09-18
> 结论先行:**接入 GGUF = 加/换「引擎后端」,不是从零搭端侧**;Rust 命令层与 JNI 回灌已引擎无关且真机验证过,净新增集中在 Android 原生工具链。估 **3–6 周(单人)**,最大风险在 NDK 交叉编译与真机性能(可能倒退)。
> **最终决定(2026-09-18,同机实测):移动端不接 GGUF、维持内嵌 MNN;llama.cpp 仅保留于桌面 companion。详见 §6。**
> 关联:`docs/repo-analysis/_GGUF端侧_索引.md`、`ondevice-{inference-framework-survey,custom-model-pipeline,theory-validation}-*.md`、`ondevice-mnn-conversion-checklist.md`

---

## 0. 关键前提订正(源码核实,2026-09-18)

`src/lib/ai/llmClient.ts:246` 的 `chat()` 对 provider `ondevice` 按 `isMobileRuntime()` 分流:

- **移动端** → `onDeviceGenerate`(进程内 MNN,`invoke('ondevice_generate')` + 监听 `ondevice://token/done`);
- **桌面端** → companion loopback(`baseUrl = http://127.0.0.1:8080/v1`,复用 `chatOpenAI`)。

且 `src/mobile/MobileSettingsView.tsx` 的 `ondevice` 段只含「选模型/加载/卸载/思维链开关」,**没有可编辑的 baseUrl / companion provider 入口**。

**推论**:所谓「GGUFServer 近零代码接 GGUF」**只在桌面成立**;移动端要接 companion 服务必须改路由+设置,还引入第二 App/明文/生命周期耦合(与内嵌 MNN 原决策相悖)。**故移动端真正的接入形态是「进程内 llama.cpp」(本文路线 A/B),companion 仅用作桌面侧快速拿性能数据。**

---

## 1. 可直接复用(几乎零改动)

这些是 MNN 集成趟出来的资产,与模型格式无关:

- **`engine.rs` 五命令**(`ondevice_load_model/generate/cancel/list_models/models_dir`)+ **JNI 回灌**(`nativeOnToken/nativeOnDone/nativeIsCancelled` → `app.emit("ondevice://token")`)——换 Kotlin 桥类即可,Rust 这段基本不动。
- **`Scheduler` 串行槽**(防并发 OOM)、**Tier 分档**(`detect_device_tier` / `onDeviceTiers.ts`)、**模型根目录**(`…/files/models` + `adb push` 权限 0771/0777 放宽)。
- **前端 provider/UI 骨架**:`llmProviders.ts` 的 `ondevice`、`OnDeviceModelPanel.tsx`、`llmClient` 移动端分流(需加引擎枚举)、`fetch-mnn-model.mjs` 的下载+SHA/体积校验管线。
- **构建工具链**:cargo-ndk 交叉编译、`.so` 带重试拷进 `jniLibs`、proguard `-keep`、Groovy DSL 等(GOTCHAS #100+)。

## 2. 增量工作分解(以「双引擎并存」计)

| 项 | 内容 | 人日(估) | 风险 |
|---|---|---|---|
| 原生构建 | llama.cpp 经 NDK/CMake 交叉编 `libllama.so`(arm64-v8a),并入 `tauri android build` | 2–4 | 中 |
| 引擎绑定 | **路线 A**:仿 `SpiritPalOnDevice.kt` 写 `SpiritPalLlamaCpp.kt`(llama.cpp JNI,可套 `llama-kotlin-android`)。**路线 B**:Rust 经 `llama-cpp-2` FFI 直调(不碰 Kotlin) | A:3–5 / B:4–6 | B 偏高 |
| 发现/元数据 | 现 `models.rs::scan_available` 只认「含 `config.json` 目录」;需加 `.gguf`(+`mmproj`)扁平发现 + 读 GGUF metadata | 2–3 | 低 |
| 路由与选择 | `engine.rs` 加**引擎枚举**(MNN/llama.cpp);provider 或设置里选后端;`llmClient`/面板按格式渲染 | 2–4 | 低 |
| 特性对齐 | 思维链(llama.cpp 无 `enable_thinking`,按采样/chat template 处理)、视觉(`mtmd`+`mmproj`,接现「看屏幕」)、长上下文 KV 量化 | 2–5 | 中高 |
| 资源与体积 | CPU/GPU(thread/precision)调优 + 长上下文回归;APK 单 ABI 约 +5–15MB | 2–4 | 中 |
| 真机测试 | realme/骁龙8 实测速度、热节流、OOM 与卸载 | 3–5 | 中 |

**合计约 16–31 人日 ≈ 3–6 周(单人)**,与当初 MNN 内嵌量级相当(交叉编译 + 24 编译错误 + 真机 6 处修复)。

## 3. 性能风险(决定值不值的命门)

- MNN 实测基线:Qwen3.5-2B-MNN @ CPU 4 线程 prefill≈74、decode 18–29 tok/s;**长上下文 prefill +2k 历史即飙到 ~151s**。桌宠是长 prefill 场景。
- **同机实测已回 §3 的问题**(2026-09-18,realme RMX5010 / 骁龙8 Elite / llama-bench CPU 4 线程 / `-fa off`,模型 `qwen35 2B Q4_K_M`):llama.cpp prefill pp512=**27.0**、pp2048=**22.3**、pp4096=**16.4** tok/s → 仅为 MNN(≈74,同条件)的 **0.22–0.36×**,且随上下文单调恶化,pp4096 单轮 prefill **≈249 s**。另证:CPU 上 **flash-attn 反拖慢**(fa-on pp512 仅 17.7 < 27.0)——flash 只利 GPU。
- MNN 胜因(经论文 `arXiv:2506.10443` 一手核实,勘误先前口径):不是「LinearAttention」,而是 **int8 W4A8/W8A8 计算 + 权重按指令集(i8mm/i8sdot/NEON)分块重排**(硬件驱动数据重排)+ DRAM-Flash 混合存储;论文小米14 CPU 4 线程 prefill **8.6×** 对 llama.cpp。llama.cpp 官方 `docs/android.md` 仅声明 Arm SME2/x86 AMX CPU 加速,其设计重心在桌面 GPU/多后端,移动端非首要。

## 4. 路线取舍

- **路线 A(Kotlin 桥,推荐)**:与现架构 1:1,复用 `engine.rs` JNI 契约,`llama-kotlin-android` 提供了 `loadModel/generateStream(Flow)/close` 蓝本。风险:该库很新(star≈7)、纯文本无视觉,需 fork 锁版本 + 自建取消。
- **路线 B(Rust FFI)**:`spiritpal_lib` 直链 llama.cpp,工程更统一、无 Kotlin 维护。风险:aarch64-linux-android 上 `llama-cpp-2` 的 CMake/NDK 链接与 bindgen 未趟过,且要防与 `rusqlite(bundled)`/`zstd-sys` 既有原生依赖工具链冲突。

## 5. 建议门控顺序

1. **[需手机/桌面]** 先用**桌面 `ondevice` companion 分支**接 GGUFServer(零改码)或装 PocketPal,量 llama.cpp 的 prefill/decode/长上下文;对照 §3 MNN 基线。
2. 数据不输 → 投**路线 A** 做移动端进程内第二引擎;**数据更差 → 维持 MNN、暂缓 GGUF**(省 3–6 周)。
3. 决定后再细化:引擎枚举、`.gguf` 发现、视觉 `mtmd` 打通、真机回归清单。

> 一句话:能接、复用度高,净新增 3–6 周全在 Android 工具链与真机性能;但**先用现成 companion/独立 App 拿数据再决定,别为省一个转换脚本贸然背双引擎维护**。

## 6. 最终决定(2026-09-18 · 同机实测 + MNN-LLM 论文一手核实)

**决定:移动端不接入 GGUF/llama.cpp,维持内嵌 MNN;llama.cpp 仅保留在桌面 companion(桌面有独显,情况完全不同)。**

**实测依据(realme RMX5010 / 骁龙8 Elite SM8750 / 15.1GB / llama-bench CPU):**

| 上下文 | llama.cpp(4线程/fa-off) | MNN(同条件基线) | 比值 |
|---|---|---|---|
| pp512 | 27.0 tok/s | ≈74 | 0.36× |
| pp2048 | 22.3 | — | ~0.30× |
| pp4096 | 16.4(单轮 prefill ≈249 s) | — | 0.22× |

- llama.cpp prefill **只有 MNN 的 0.22–0.36×、随长上下文单调恶化**,直击桌宠最痛的「带历史首 token 卡死」;
- 上限档亦无法翻盘:CPU 上 **flash-attn 反成负担**(17.7 < 27),唯一杠杆是加线程,量级仍够不到 MNN;
- MNN 的胜因是**为移动 CPU 而生**(int8 W4A8 + 权重按指令集分块重排,见 `arXiv:2506.10443`),非桌面优先的 llama.cpp 可比。

**因此路线 A/B(进程内 llama.cpp)与 §2 的 3–6 周投入全部作废(不立项)。** 若将来出现「用户必须直吃任意 GGUF」的硬需求,再评估——但须以「GPU 后端 llama.cpp 不输 CPU MNN」的新证据为前提。

> 勘误留痕:本文早期版本把 MNN 优势误记为「Qwen3.5 LinearAttention 优化」、把权重加载误称「mmap」;已据论文更正为「int8 量化 matmul + 硬件驱动数据重排」与「DRAM-Flash 混合存储」。

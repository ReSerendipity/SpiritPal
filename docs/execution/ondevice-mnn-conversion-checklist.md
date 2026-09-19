# MNN 端侧模型 · 背景 / 转换注意事项 / 选型 Checklist

> 项目:SpiritPal(移动端进程内 MNN 端侧推理)
> 归档日期:2026-09-17
> 用途:① 说明为什么移动端进程内选 MNN、其性能/内存基线与限制;② 在把任意 HF 模型(官方 / 社区蒸馏 / 融合 / 微调)转成 MNN 格式、放进手机前,逐项对照本清单。
> 关联:`ondevice-inference-framework-survey-20260915.md`、`ondevice-custom-model-pipeline.md`(转换流程权威版)、`ondevice-model-budget-20260915.html`、`ondevice-theory-validation-20260916.md`、`src/lib/ai/onDeviceTiers.ts`、`src-tauri/src/ondevice/{models,engine}.rs`、`gen/android/.../SpiritPalOnDevice.kt`、`docs/repo-analysis/_GGUF端侧_索引.md`

---

## A. MNN 在 SpiritPal 的定位与选型理由

**结论:移动端进程内推理只走内嵌 MNN;它不是「随便选的引擎」,而是为桌宠场景(长上下文 + 视觉 + 手机 CPU)选的。**

- 架构三件套(设备分档 tier / 串行调度 scheduler / 模型 LRU)移植自 `Daniele-rolli/tauri-plugin-local-ai`(纯 Rust、与引擎解耦);**实际推理走内嵌 MNN 引擎**(`libmnnllmapp.so`,经 Kotlin/JNI 桥 `SpiritPalOnDevice.kt` 包 MNN `LlmSession`)。MNN 不是桌面依赖——桌面本地推理由 Ollama 承担。
- **为什么是 MNN 而不是 llama.cpp(当时定为候选 C 兜底)**:
  1. **原生支持 Qwen 系**(v0.8.0 起支持到 Qwen3.5);注:MNN 快的**主因不是「线性注意力」**——`arXiv:2506.10443` 通篇是标准 decoder-only 注意力,其 prefill 优势来自**int8 W4A8 计算 + 权重按指令集(i8mm/i8sdot/NEON)分块重排**(见 B 段勘误),「Qwen3.5 LinearAttention CPU 路径」是更晚的 changelog 说法、未经一手核实,勿当性能主因;
  2. **prefill 更快**——桌宠每轮带历史,**首 token(prefill)是命门**;MNN-LLM 论文在**小米14 / CPU / 4 线程**实测对 llama.cpp prefill **8.6×**(decode 2.3×),与我们 2026-09-18 同机(RMX5010)自测方向一致(llama.cpp 仅 MNN 的 0.22–0.36×);
  3. **全模态**:文本 + 图生文(视觉 `visual.mnn`),直接对应「看屏幕」;
  4. **移动端成熟度**:自带生产级安卓栈(DRAM-Flash 混合权重存储、ModelScope/HF 模型市场、Qwen 预设);llama.cpp 的安卓 JNI 官方定性为「参考实现,非成品库」,其设计重心在桌面 GPU/多后端。
- **其余 provider 在手机上的可用性**:Ollama 依赖 `localhost:11434` 服务(手机没有)、不可用;「端侧 MNN Chat 本地」(`127.0.0.1:8080`)是靠**另一个 App** 加载模型、非本进程;所以**本 App 手机端进程内实际可用的只有内嵌 MNN**。

## B. 性能 / 内存基线与限制(真机实测)

- 设备:realme RMX5010 / 骁龙8 Elite(SM8750)/ arm64-v8a / Android 16 / **MemTotal ≈15.1GB**。**Qwen3.5-2B-MNN @ CPU 4 thread / precision=low → prefill ≈74 tok/s、decode 18–29 tok/s**(随上下文增长衰减;2026-09-16)。
- **MNN 为何移动端 prefill 快(据论文 `arXiv:2506.10443`,一手)**:prefill 属**计算受限**;MNN 把量化矩阵乘(`Linear`/`Attention`)按目标指令集**硬件驱动数据重排**(加载时把 int4/int8 权重排成 tiled 布局,降内存访问、吃满寄存器复用),并走 **int8 计算(W4A8/W8A8,`i8mm smmla` 吞吐≈`sdot` 2×)** + fp16 NEON;再配 **DRAM-Flash 混合存储**(embedding 落 Flash、层权重进 DRAM)与 **KV 量化**(K 走 int8、V 走 fp8 + Flash 溢出预取)。这套是为移动 CPU 深度定制,而 llama.cpp 桌面优先、prefill 内核未同等调优 → 实测同机仅 MNN 的 0.22–0.36×。
- **长上下文 prefill 是最大痛点**:多带 ~2k 历史 KV 时,**prefill 飙到 ~151s**。→ 直接推高对「量化档 + 上下文长度」的转换前决策要求(见 §3)。
- 内存:Native Heap ≈1.7GB / PSS ≈1.9GB(单进程持 2B Q4)。
- **ABI 仅 `arm64-v8a`**:官方 MNN Chat 不含 x86_64;要 v7a/x86_64 得自编引擎。
- 引擎 `.so` 体积:`libmnnllmapp.so` 1.39MB + 单体 `libMNN.so` 7.5MB ≈ 8.9MB,静态 libc++。
- 降级链:`ondevice` 加载失败/内存不足 → 复用 `ProviderHealthManager` 自动切云端。

## C. MNN 目录格式 & 三条取模型路径(背景)

一个可用 MNN 模型目录:

```
llm.mnn         — 计算图
llm.mnn.weight  — 量化后权重(体积大头)
tokenizer.mtok / tokenizer.txt
llm_config.json / config.json   ← 含 config.json 才被识别为模型
(+ visual.mnn / visual.mnn.weight  视觉投影器,仅 VL 模型有)
```

取模型三条路(优先 ①):

1. **方案 0 — 零转换(推荐)**:直接下官方预转换 `MNN/Qwen3.5-*-MNN`(ModelScope `MNN/*`、HF 镜像 `taobao-mnn/*`)。体积:0.8B≈0.55GB / 2B≈1.39GB / 4B≈2.85GB / 9B≈7.27GB。
   - **下载坑**:必须用 `/models/<ns>/<name>/resolve/<rev>/<file>` 文件直链(`…/api/v1/…/repo?FilePath=` 可能返回 200 但空);**ModelScope 大文件会静默截断**(实测少 ~19MB),**务必比对体积 + SHA-256**(GOTCHAS #102)。
2. **方案 A — 从 HF/PyTorch(safetensors)转换**:见 §D。
3. **方案 B — 从 GGUF 转换**:`gguf2mnn.py`,见 §D。

---

## 0. 一句话原则(转换/选型)

MNN 的 `llmexport.py` / `gguf2mnn.py` 只认「**架构 + 权重 + 分词器**」,**不认模型的来历或品牌名**。因此一个 HF 模型能不能转、能不能跑对,取决于它的**架构与分词器是否仍是原版 Qwen3.5 那一套**,而不是它是不是官方。

---

## 1. 转换发生在哪里(硬约束)

- 转换**只在 PC 侧**(x86 / Apple)一次性完成,**安卓/手机不能做转换,SpiritPal App 也没有转换命令**(只有 load/generate/cancel/list)。
- **方案 A(从 HF safetensors)**:需 Python + PyTorch/transformers,并自行编译 `MNNConvert`(`cmake -DMNN_BUILD_CONVERTER=ON`)。

  ```bash
  python llmexport.py --path /path/to/Qwen3.5-2B-Instruct \
    --export mnn --quant_bit 4 --quant_block 64 --hqq
  #   合并 LoRA:--lora_path /path/to/your_lora   视觉:--path /path/to/Qwen3.5-2B-VL
  ```
- **方案 B(从 GGUF)**:`python gguf2mnn.py <in>.gguf <out>/`(读 GGUF → 重排为 MNN int4/int5 布局 + 写 tokenizer),**不需要 torch**,但仍是 PC。
- **方案 0(零转换)**:官方 `MNN/Qwen3.5-*-MNN`,见 §C。
- 产物统一为 §C 的 **MNN 目录**。

## 2. 对模型类型 / 架构的要求

| 判定 | 情形 | 能否转 |
|---|---|---|
| ✅ 通常可 | **融合 / merge(mergekit/ties/dare)**:仍是标准稠密 Qwen3.5 架构、`config.json` 的 `model_type` 不变、只是权重变了 | 可 |
| ✅ 通常可 | **LoRA / QLoRA / adapter**:导出时 `--lora_path` 合并成普通模型(SpiritPal-Doro 类角色模型的官方路径) | 可 |
| ✅ 通常可 | **蒸馏 / 继续预训练 / 指令微调**,只要**未改结构、未换 tokenizer** | 可 |
| ⚠️ 有坑 | **换了非 Qwen tokenizer** | 能转,但 chat template/特殊 token 可能对不上 |
| ⚠️ 有坑 | **源是已量化权重(GGUF/AWQ/GPTQ)** | 别当 fp 源导出;从 fp16 基座重导 |
| ⚠️ 有坑 | **社区融合/蒸馏的 VL 版**(保留了视觉塔) | 可转(`--path ...VL`);**丢了视觉塔的变体** → 只能纯文本 |
| ❌ 不可 | **跨架构蒸馏**(小学生模型结构≠Qwen3.5)、自定义注意力、另类 MoE 路由、投机解码草稿模型 | 转换器无对应模板,大概率转不动 |

MNN 的架构支持面属上游、随版本变;Qwen 家族是 SpiritPal 已实测的稳妥选择,**其余以 MNN 官方支持清单为准**。

## 3. 量化 / 上下文:转换时定死,端上不可调

- **量化在导出时一次性烧进去**:`--quant_bit`(2/4/8,典型 4)+ `--quant_block`(32/64/128,SpiritPal 用 4/64)+ `--hqq`(提精度,接近官方 Q4_K_M,实机 ≈30 tok/s @12GB)。**手机端无法改量化档,要换必须回 PC 重导**。
- **上下文长度**写在 `config.json`。内存预算:**2B Q4_K_M + 视觉 + 128K(Q8 KV) ≈ 3.41GB**;12GB 旗舰舒适,8GB 须砍视觉或降上下文(`onDeviceTiers.ts`)。
- 推论(结合 §B 的 151s prefill):**量化档 + 上下文必须在转换阶段就按目标手机档位定好**,对齐 `detect_device_tier`;桌宠场景优先控长上下文以压 prefill。
- **模型规模**本身不限转换,但受设备内存天花板约束;桌宠建议 **0.8B / 2B**。
- **config.json** 是模型身份与行为载体:必须含它才被发现;`enable_thinking` 等由 `SpiritPalOnDevice.kt` 在加载前覆写后再 load(MNN 仅 load 阶段读它)。

## 4. SpiritPal 特有提醒:发现逻辑 / 推送 / 权限

- 引擎侧认**架构**,对「模型从哪来」无所谓;**但 SpiritPal 的发现逻辑可能按具体 id 或目录名匹配**(如 `Qwen3.5-2B-MNN`)。用**改名 / 变体 / 社区模型**时,要确保按「**含 `config.json` 的目录**」泛化匹配,否则**引擎支持了、app 却扫不到**。
- 内嵌路径:`/storage/emulated/0/Android/data/com.spiritpal.desktop_pet/files/models/`;`adb push` 前注意目录权限放宽(0771/0777,GOTCHAS #104)。
- 下载校验:见 §C 方案 0(GOTCHAS #102)。

## 5. 转换前四步判定(挑任意 HF 仓对着勾)

1. **`config.json` 的 `model_type` / `architectures`** 是否仍是 Qwen3.5 那套(而非跨架构蒸馏产物)。
2. 权重文件是否为 **safetensors(fp16/fp32)**,而非 GGUF/AWQ/GPTQ 量化版。
3. **tokenizer / vocab 是否与基座一致**;chat template、特殊 token 是否匹配。
4. 若需视觉:源是否为 **VL 变体**(含 projector)。

## 6. 转换后必做:真机冒烟测(「加载得动」≠「转对了」)

- 权重/模板对不上会**静默出乱码或工具调用失效**。转完 push 进手机,**跑几条固定 prompt** 验证输出连贯、模板正确、(如为 VL)带图能理解。
- 对照基线(§B):prefill ≈74、decode 18–29 tok/s;重点复测**长上下文 prefill 是否退化到分钟级**。

## 7. MNN vs GGUF 定位(避免误判「GGUF 跑通就能换 MNN」)

- **GGUF 的杀手锏只有一个**:免转换直跑 + 全生态通用(海量 HF `.gguf` 直接下)。
- **MNN 的不可替代处(在 SpiritPal 场景)**:为移动 CPU 深度定制的 **int8 W4A8 + 权重分块重排** → 更强 prefill(`arXiv:2506.10443`)、现成视觉、成熟安卓栈;代价是**必须先转 + 生态面窄**。
- **已判定(2026-09-18,同机 RMX5010 实测)**:llama.cpp 纯 CPU prefill 仅 MNN 的 **0.22–0.36×** 且随长上下文恶化(flash-attn 在 CPU 上反成负担)。**→ 维持 MNN,移动端不接 GGUF;llama.cpp 只留桌面 companion。** 详见 `ondevice-gguf-integration-effort-20260918.md §6`。

## 8. 快速结论

- **最省心、最被验证**:留在 **Qwen3.5 家族 + 官方预转换 `MNN/Qwen3.5-*-MNN`(零转换)**。
- **社区融合 / LoRA 微调角色模型**:支持,走 `llmexport --lora_path` / 融合后导出,但要过 §5 四步 + §6 冒烟测。
- **非 Qwen 家族 / 很新的架构 / 量化源 / 跨架构蒸馏**:先确认在 MNN 支持清单内,别默认能转。
- **量化档与上下文:PC 导出时定死、端上不可改**,务必按目标机 tier 先规划。

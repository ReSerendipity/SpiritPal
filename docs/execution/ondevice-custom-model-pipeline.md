# 端侧自定义模型交付流水线（SpiritPal × MNN Chat）

> 适用场景：把任意 Qwen3.5 基模 / 微调角色模型（如 SpiritPal-Doro）变成手机上可由 SpiritPal 调用的端侧模型。
> 实测基线：骁龙8至尊版 / 12GB / Android 16，Qwen3.5-2B Q4_K_M + 视觉，MNN Chat v0.8.3，**30+ tok/s**（2026-09-15）。

## 为什么需要这条流水线

MNN 运行时**只认 MNN 格式目录**，不直接吃裸 GGUF / safetensors：

```
llm.mnn  llm.mnn.weight  tokenizer.txt  llm_config.json  config.json   (+ 视觉 projector: visual.mnn*)
```

而 SpiritPal 的分发策略是「**框架-only、用户自取模型权重**」——所以模型交付 = 用户把模型
**放成 MNN 格式 → 进手机 → 加载**。

**两条路**（优先走 ①）：

| 路 | 适用 | 成本 |
|---|---|---|
| ① **直接下载官方预转换 MNN 模型**（`MNN/*-MNN` on ModelScope） | 用现成基模 | **零转换**，见 §②方案 0 |
| ② 自己转换（`llmexport.py` / `gguf2mnn.py`） | 自定义 / 微调角色模型（如 SpiritPal-Doro） | 需 PC 侧 Python + MNNConvert |

## 步骤总览

```
① 取模型（下载官方预转换 MNN  或  自选基模+LoRA 转换）
        ──►  ② 得到 MNN 格式目录  ──►  ③ 放进手机模型目录  ──►  ④ SpiritPal 加载并对话
```

> ④ 有两条落地路径：**内嵌**（SpiritPal 自己加载，设置页「端侧模型」）或 **伴侣**（MNN Chat 加载 + SpiritPal 走 OpenAI API）。本文档 ③–⑤ 以伴侣路径为例，内嵌路径把 ③ 的目录换成
> `/storage/emulated/0/Android/data/com.spiritpal.desktop_pet/files/models/` 即可。

## ② 取得 MNN 模型

### 方案 0（推荐）：直接下载官方**已转好**的 MNN 模型 —— 无需自己转换

MNN 官方已在 ModelScope / HuggingFace 发布**预转换的 MNN 格式模型**（含视觉投影器），
与 MNN Chat 的模型市场同源。清单见 MNN 仓 `apps/Android/MnnLlmChat/app/src/main/assets/model_market.json`。

| 模型 | ModelScope（国内直连） | HuggingFace 镜像 | 体积 |
|---|---|---|---|
| **Qwen3.5-2B-MNN**（项目基线同款） | `MNN/Qwen3.5-2B-MNN` | `taobao-mnn/Qwen3.5-2B-MNN` | 1.39 GB |
| Qwen3.5-0.8B-MNN（低配机 / 快速验证） | `MNN/Qwen3.5-0.8B-MNN` | `taobao-mnn/Qwen3.5-0.8B-MNN` | 0.55 GB |
| Qwen3.5-4B-MNN | `MNN/Qwen3.5-4B-MNN` | `taobao-mnn/Qwen3.5-4B-MNN` | 2.85 GB |
| Qwen3.5-9B-MNN | `MNN/Qwen3.5-9B-MNN` | `taobao-mnn/Qwen3.5-9B-MNN` | 7.27 GB |

下载（ModelScope 国内直连，无需登录）：

```bash
# 推荐：用本仓脚本（自动比对体积+SHA-256、断点续传、失败重试）
node scripts/fetch-mnn-model.mjs --repo MNN/Qwen3.5-2B-MNN --out ./Qwen3.5-2B-MNN

# 只列文件与权威哈希
node scripts/fetch-mnn-model.mjs --repo MNN/Qwen3.5-2B-MNN --list

# 校验已有目录（不下载）
node scripts/fetch-mnn-model.mjs --repo MNN/Qwen3.5-2B-MNN --out ./Qwen3.5-2B-MNN --verify-only
```

<details>
<summary>等价的纯 curl 写法（无 Node 时）</summary>

```bash
NS=MNN; NAME=Qwen3.5-2B-MNN
BASE="https://www.modelscope.cn/models/$NS/$NAME/resolve/master"
OUT="./$NAME"; mkdir -p "$OUT"
for f in config.json configuration.json export_args.json llm.mnn llm.mnn.json \
         llm_config.json tokenizer.txt visual.mnn visual.mnn.weight llm.mnn.weight; do
  curl -L -o "$OUT/$f" "$BASE/$f"
done
# ⚠️ curl 无校验 —— 必须自行核对体积/SHA（见下方「必读」）
```
</details>

产出即标准 MNN 目录（`llm.mnn` + `llm.mnn.weight` + `tokenizer.txt` + `config.json` + `visual.mnn*`），**可直接跳到 ③**。

> ⚠️ **必读（踩过的坑）**：
> 1. **必须用** `/models/<ns>/<name>/resolve/<rev>/<file>` 这个**文件直链**；
>    `/api/v1/models/<ns>/<name>/repo?FilePath=<file>` 在部分情况下返回 `HTTP 200` 但**响应体为空**。
> 2. **ModelScope 大文件会静默截断**：实测 `llm.mnn.weight` 首次下载 `http=200` 无报错，却少了 19,019,798 字节。
>    **务必比对体积 + SHA-256**（脚本已内置；纯 curl 时需自行校验），否则会拿到跑不起来的模型。
> 3. 权威体积/哈希来自仓库 API：
>    `https://www.modelscope.cn/api/v1/models/<ns>/<name>/repo/files?Revision=master&Recursive=true`

### 方案 A / B（仅当要**自定义或微调**模型时才需要）

### 方案 A：从 HuggingFace / PyTorch 模型
```bash
cd MNN/transformers/llm/export
pip install -r requirements.txt
# 先编译 MNNConvert（导出脚本默认到 ../../../build/ 查找，或 --mnnconvert 指定）
#   cd MNN && mkdir build && cd build && cmake .. -DMNN_BUILD_CONVERTER=ON && make -j16

python llmexport.py \
  --path /path/to/Qwen3.5-2B-Instruct \
  --export mnn \
  --quant_bit 4 --quant_block 64 \
  --hqq                                   # 提升量化精度（建议）
# 微调模型合并 LoRA：
#   --lora_path /path/to/your_lora
# 视觉/多模态（宠物截图理解）必须导 VL 模型，导出目录会自动含 projector：
#   --path /path/to/Qwen3.5-2B-VL  (同参数)
```
产物：含 `llm.mnn` / `llm.mnn.weight` / `tokenizer.mtok` / `llm_config.json` / `config.json` 的目录。

### 方案 B：从 GGUF（如 unsloth 的 Qwen3.5-2B Q4_K_M.gguf）
```bash
cd MNN/transformers/llm/export
python gguf2mnn.py /path/to/qwen3.5-2b-q4_k_m.gguf /out/mnn_qwen3.5-2b-q4
```
脚本读 GGUF（`gguf.gguf_reader`）→ 重排权重为 MNN int4/int5 布局 + 写 tokenizer，产出上述 MNN 目录。
**我们 benchmark 用的 unsloth Qwen3.5-2B Q4_K_M.gguf 直接可走这条**。

## ③ 推送到手机
```bash
adb push /out/mnn_qwen3.5-2b-q4 /data/local/tmp/mnn_models/spiritpal_doro/
```
MNN Chat 的 `LocalModelsProvider` 会扫描 `/data/local/tmp/mnn_models/`，凡含 `config.json` 的子目录
注册为模型 id：`local/<绝对路径>`（如 `local//data/local/tmp/mnn_models/spiritpal_doro`）。

## ④ 在 MNN Chat 加载
打开 MNN Chat → 模型列表会出现本地模型 → 点加载（首次会 mmap 权重，约数秒）。
确认「设置 → API」里服务已开启（默认 `127.0.0.1:8080`，auth 默认开 → 记下生成的 key，或关闭 auth）。

## ⑤ SpiritPal 调用
设置页选服务商 **「端侧 (MNN Chat 本地)」**：
- Base URL：`http://127.0.0.1:8080/v1`（自动填）
- API Key：粘贴 MNN Chat API 设置里的 key（若关了 auth 可留空）
- 模型：`local/<path>`（或 MNN 市场模型 id，如 `qwen3.5-2b`）

`LLMClient` 的 `ondevice` 分支复用 `chatOpenAI`，请求 `POST /v1/chat/completions`（SSE）。

## 注意事项

- **视觉常驻**：角色模型若要做截图理解，② 必须导出 **VL 模型**（含 mmproj projector），否则 `/v1/chat/completions` 带图像会失败。
- **量化质量**：`--hqq` 量化接近官方 Q4_K_M，实机速度同档（≈30 tok/s @ 12GB）。
- **内存预算**：2B Q4_K_M + 视觉 + 128K(Q8 KV) ≈ 3.41GB，仅 12GB+ 旗舰舒适；8GB 须去视觉或降上下文（见 `onDeviceTiers.ts`）。
- **转换是构建步骤**：建议把 ② 封装成 SpiritPal 的模型交付脚本/CI，用户只需提供基模与 LoRA。
- **权限**：SpiritPal 侧需 `usesCleartextTraffic=true`（MNN Chat 默认明文 HTTP + loopback）。

## 参考源码（MNN 仓，已核实）
- `apps/Android/MnnLlmChat/app/src/main/java/com/alibaba/mnnllm/android/modelist/LocalModelsProvider.kt` — 本地模型扫描
- `apps/Android/MnnLlmChat/app/src/main/java/com/alibaba/mnnllm/api/openai/service/ApiServerConfig.kt` — 端口/IP/auth 默认
- `transformers/llm/export/llmexport.py` / `gguf2mnn.py` — 转换工具
- `docs/transformers/llm.md` — 转换文档

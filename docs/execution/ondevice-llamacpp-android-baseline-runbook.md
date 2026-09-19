# 移动端 llama.cpp(GGUF)性能基线 · 准备与执行手册

> 项目:SpiritPal | 建档日期:2026-09-18
> 目标:手机一插上就能测出「llama.cpp 在目标骁龙机、跑 Qwen3.5-2B、CPU 后端的 prefill/decode」,拿去和现有 **MNN 真机基线**对比,决定是否值得把 GGUF 接进移动端。
> 关联:`ondevice-inference-framework-survey-20260915.md`(候选 C)、`ondevice-gguf-integration-effort-20260918.md`、`ondevice-mnn-conversion-checklist.md`、`docs/repo-analysis/_GGUF端侧_索引.md`、`ondevice-theory-validation-20260916.md`(MNN 基线)

---

## 0. 这次要测什么(唯一目的)

桌面那轮 `llama-bench`(35B MoE + 独显)已确认**不适用**。真正卡决策的只有一个数:

> **llama.cpp 在你骁龙机上、跑 Qwen3.5-2B(与 SpiritPal 目标同档)、CPU 后端,长上下文的 prefill 会不会比现在的 MNN 明显更差?**

- MNN 现有基线(realme RMX5010 / 骁龙8 Elite SM8750 / Android 16 / MemTotal≈15.1GB / **CPU 4 线程**):prefill ≈ **74 tok/s**、decode **18–29 tok/s**;**+2k 历史时 prefill 飙到 ~151s**(GOTCHAS #105)。
- 用**同样的设备、同样的 CPU 线程数、同样的上下文尺寸**跑 llama-bench,数字才可比。

---

## 1. 前置状态清点(本机,2026-09-18 实测)

| 项 | 状态 | 备注 |
|---|---|---|
| git | ✅ 2.55.0 | |
| Android NDK | ✅ `27.0.12077973` | 与 SpiritPal MNN 同版本,无需另装 |
| adb | ✅ | `Sdk/platform-tools`(需 `adb devices` 见到手机) |
| ✅ CMake/Ninja | 已加 PATH | 用 Android SDK 自带(`Sdk/cmake/3.22.1/bin`,`cmake 3.22.1`+`ninja 1.10.2`);经 .NET `SetEnvironmentVariable` 追加进用户 PATH(**未用 setx**,否则 1042 字符会被截断毁 PATH) |
| ✅ llama.cpp 源码 | 已 clone | `SpiritPal/references/llama.cpp/`(git 走 openssl 通、curl 走 schannel rc=35 不通;`--depth 1` **无子模块**即用) |
| ✅ **安卓 llama-bench** | **已编好并验证** | `SpiritPal/references/llama.cpp/build-android/bin/`(arm64 ELF / NDK r27 / Android-28,CPU-only) |
| 🔵 Qwen3.5-2B GGUF | 你在下 | 本地原先只有 35B MoE,不能用;下稠密 2B Q4_K_M,见 §4 |
| 🔵 目标手机 | 未连 | 插上 + 开 USB 调试,`adb devices` 见设备 |

> **准备链已跑通(§2/§3 已完成)**。你插手机后只剩:推模型(§4)→ 推已编好的二进制(§5)→ 跑测(§5)→ 判据(§6)。

---

## 2. 构建工具链 —— ✅ 已完成(记录)

- CMake/Ninja 未新装,复用 **Android SDK 自带**:`C:\Users\Doro\AppData\Local\Android\Sdk\cmake\3.22.1\bin\{cmake,ninja}.exe`。
- 已追加进用户 PATH(新开终端生效)。当前已存在的自动化 shell 若 `cmake: command not found`,临时补一句即可:
  ```bash
  export PATH="$PATH:/c/Users/Doro/AppData/Local/Android/Sdk/cmake/3.22.1/bin"
  export ANDROID_NDK=/c/Users/Doro/AppData/Local/Android/Sdk/ndk/27.0.12077973
  ```

## 3. 交叉编译安卓 llama-bench —— ✅ 已完成(记录)

```bash
cd /c/Users/Doro/SpiritPal/references/llama.cpp
cmake -B build-android -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 \
  -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DLLAMA_OPENSSL=OFF \
  -DLLAMA_CURL=OFF -DGGML_VULKAN=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build build-android --target llama-bench
```

产物在 **`build-android/bin/`**(注意:与旧版路径不同,全在一个 `bin` 目录):

```
llama-bench                      # 可执行(薄壳,7KB)
libllama-bench-impl.so  libllama-common.so  libllama.so
libggml.so  libggml-base.so  libggml-cpu.so   # CPU 后端;无 vulkan .so
```

`llama-bench` 的 NEEDED 本地库正是上述 6 个(系统库 `libc/libm/libdl/liblog/libc++_shared` 由 ROM 提供)。若嫌体积大(带 debug_info、非 stripped),可用 NDK 的 `llvm-strip` 处理后再推。

## 4. 准备模型(稠密 Qwen3.5-2B,勿用现成的 35B MoE)

- 到 HuggingFace 下 **unsloth/Qwen3.5-2B-…-GGUF 的 Q4_K_M**(仓库名以实际为准 —— 此路径需你确认/联网核;SpiritPal 的 MNN 基线正是 unsloth Qwen3.5-2B Q4_K_M,同源最好比)。
- 推到手机可读目录(与 MNN 同目录,便于对照):
  ```bash
  DIR=/storage/emulated/0/Android/data/com.spiritpal.desktop_pet/files/models
  adb shell mkdir -p "$DIR/bench2b"
  adb push qwen3.5-2b-q4_k_m.gguf "$DIR/bench2b/model.gguf"
  # 视觉不在本轮范围(本轮只量文本 prefill/decode)
  ```

## 5. 推到设备并跑测(需手机)

```bash
cd /c/Users/Doro/SpiritPal/references/llama.cpp/build-android/bin
# 5.1 推基准可执行 + 全部依赖 .so(6 个,均在 bin/ 下)到设备同一目录
adb shell mkdir -p /data/local/tmp/lbench
adb push llama-bench \
         libllama-bench-impl.so libllama-common.so libllama.so \
         libggml.so libggml-base.so libggml-cpu.so /data/local/tmp/lbench/

# 5.2 进设备,给执行位
adb shell
cd /data/local/tmp/lbench && chmod 755 llama-bench

M=/storage/emulated/0/Android/data/com.spiritpal.desktop_pet/files/models/bench2b/model.gguf
LD_LIBRARY_PATH=/data/local/tmp/lbench ./llama-bench \
  -m "$M" -ngl 0 -t 4 -p 512,2048,4096,8192 -n 128 -r 3 -fa off -o json
```

参数刻意贴 MNN 基线:`-ngl 0`(纯 CPU,对齐 MNN CPU 4 线程)、`-t 4`、`-fa off`(MNN 无 flash-attn,先同条件;开 flash 另测)。

## 6. 判据(测完当场对照)

| 观察点 | MNN 基线 | llama.cpp 结果 | 结论方向 |
|---|---|---|---|
| 短上下文 prefill pp512/2048 | ≈74 tok/s | ___ | 显著更低 → GGUF 无性能红利 |
| **长上下文 prefill pp8192** | 退化到 ~151s 级 | ___ | llama 若同样/更差 → 换它不划算 |
| decode tg128 | 18–29 tok/s | ___ | 持平即可,decode 一般非瓶颈 |

决策:
- **6.1 llama.cpp 长上下文 prefill 与 MNN 持平或更好** → 值得为「免转换直吃 GGUF」投进程内接入(路线见工作量文档 §4)。
- **6.2 明显更差(尤其长上下文)** → **维持 MNN,GGUF 仅留桌面 companion**,不在移动端接入(省 3–6 周)。
- **6.3 数据方差大/像桌面那样被冷启动污染** → 加大 `-r`、加 `--no-warmup` 对照、手机先静置降温再测,取稳态。
- **6.4(可选)Vulkan**:另编 `-DGGML_VULKAN=ON`、`-ngl 99` 测一次,看 GPU 是否能翻盘;但注意手机 GPU 常驻与发热代价,桌宠未必能长期开着。

## 7. 坑位提示(源自 MNN 侧经验)

- **热节流**:连测多轮会掉速 → 每轮间静置、或分次测;别在第一轮滚烫时取数。
- **Android 15+ 的 16KB page size**:NDK r27 默认可能需 `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON`,否则 `.so` 加载报错。
- **ModelScope/HF 大文件静默截断**:模型下完比对体积 + SHA(GOTCHAS #102)。
- **`/data/local/tmp` noexec**:llama-bench 二进制放 `/data/local/tmp` 若不可执行,改放 app 外部 files 目录或用 `adb shell` 的 app 上下文运行。
- 二进制 ABI 只 arm64-v8a(与 SpiritPal 一致)。

## 8. 结果登记

### 8.1 已实测(2026-09-18,realme RMX5010 / Android 16 / 纯 CPU / 4 线程 / `-fa off`,模型 `qwen35 2B Q4_K_M`)

| 设备 | 后端 | 线程 | pp512 | pp2048 | pp4096 | pp8192 | tg128 | 备注 |
|---|---|---|---|---|---|---|---|---|
| realme RMX5010 | CPU | 4 | **27.0 ±4.0** | **22.3 ±4.3** | — | — | — | 3 次重复;pp512 样本 [31.6,24.7,24.8] |
| (MNN 基线·同机) | CPU | 4 | ≈74 | — | — | 长上下文退化至 ~151s 级 | 18–29 | 见 `ondevice-theory-validation-20260916.md` |

**已可下的结论(部分,但方向明确)**:同机同 4 线程纯 CPU 下,**llama.cpp prefill ≈27 tok/s,仅为 MNN(≈74)的 ~0.36×(慢 ~2.7 倍)**,且 pp512→pp2048 继续走低(27→22.3)。→ 强烈指向 §6.2(移动端维持 MNN、GGUF 不接)。

**数据缺口(本次未跑完)**:跑测中**设备 USB 掉线**,pp4096 / pp8192 / decode(tg128)三档缺失。需重连设备补测,补全长上下文 prefill 与 decode 才能钉死结论。

**重跑要点(避免再被掉线坑)**:
1. 把结果写到设备端文件而非 adb stdout,断开也不丢:
   ```bash
   adb shell 'cd /data/local/tmp/lbench && LD_LIBRARY_PATH=. nohup ./llama-bench -m model.gguf -ngl 0 -t 4 -p 4096,8192 -n 128 -r 3 -fa off -o json > r_long.json 2>r_long.err &'
   ```
   之后 `adb pull /data/local/tmp/lbench/r_long.json` 取数。
2. 只补**缺的档**(4096/8192 + decode),pp512/2048 已有数不重跑,缩短窗口、降低掉线概率。
3. 排查掉线根因:关掉设备 USB 选择性暂停/息屏断连、固定线缆口、跑测时保持屏幕常亮(测前 `adb shell svc power stayon true`)。
4. 可选 Vulkan 对照(`-DGGML_VULKAN=ON` 重编、`-ngl 99`)另测,看 GPU 是否翻盘。

填完后据此更新 `ondevice-gguf-integration-effort-20260918.md` 的「门控顺序」结论,并决定是否启动移动端 GGUF 接入。

### 8.2 上限档 · 中止与最终决定(2026-09-18)

- **CPU 满载上限档未跑完即停(无需再跑)**:一次误配把上限档设成 `-fa on`,而**实测 CPU 上 flash-attn 反拖慢 prefill**(t4/fa-on pp512=17.7、pp2048=13.2,均**低于** t4/fa-off 的 27.0/22.3)——证明 **flash-attn 只利 GPU、CPU 上是负担**,故「CPU 真·上限」就是 §8.1 的 `-fa off` 档;再加线程(t8)仅线性小幅提升,量级仍够不到 MNN ≈74。pp8192 单档在此配置下 >30 min 未完,遂终止、用户拍板维持 MNN。
- **最终决定:移动端维持内嵌 MNN,不接入 GGUF/llama.cpp(路线 A/B 不立项);llama.cpp 仅保留桌面 companion。** 完整依据与机制分析见 `ondevice-gguf-integration-effort-20260918.md §6`、`ondevice-mnn-conversion-checklist.md §7`。
- 遗留(若将来确需 GGUF 上限):Vulkan 交叉编译卡在 `vulkan-shaders-gen` 的宿主机构建(host toolchain 误用安卓链),需另配 host 编译器/ Vulkan SDK 才能测 GPU 档——非当前决策必需。

# Release 发布验收清单（P1-1）

> 任务书 2026-09-10 P1-1「发布回读验证 + 干净机器安装/卸载验收」
> CI 内自动执行部分：`.github/workflows/release.yml` 的 `publish-updates` job（资产数量 + 签名文件格式校验）
> 本清单覆盖 CI 无法自动完成的**本地/真机验收**与**哈希比对**。

## 一、发布回读验证（每次发版执行）

### 1.1 资产完整性（CI 已自动，此处复核）
```bash
gh release view v<版本> --repo ReSerendipity/SpiritPal --json assets -q '.assets[].name'
```
期望至少包含（Windows 必含；Linux 按构建矩阵；**macOS 不构建**——2026-09-10 用户指示：模型必须 N 卡，不支持苹果电脑）：
- `SpiritPal_<版本>_x64-setup.exe` 及 `.sig` 签名文件（增量更新入口，**缺失即发布失败**）
- `.AppImage` / `.deb` 等 Linux 产物及对应 `.sig`

### 1.2 本地产物哈希比对（防上传损坏/篡改）
```powershell
# 下载 release 资产后与本地产物（artifacts/ 或 src-tauri/target/release/bundle/）比对
gh release download v<版本> --repo ReSerendipity/SpiritPal --pattern "*setup.exe" --dir $env:TEMP\relcheck
Get-FileHash $env:TEMP\relcheck\*.exe -Algorithm SHA256
Get-FileHash artifacts\*.exe -Algorithm SHA256   # 本地产物
# 两处哈希必须一致
```
> **2026-09-11 实测记录**：远端 setup.exe SHA256 `45604ad2…cdbff`（23,274,704 B）vs 本地 bundle `e6416f98…b3c7`（23,275,817 B）**不一致**（差 1113 B）——NSIS 含时间戳/构建元数据，本地与 CI 非可复现构建，属构建环境差异，**非篡改证据**。**更强验证（已通过）**：官方 minisign 0.12 + tauri.conf.json 内置公钥对 release 资产验签 → `Signature and comment signature verified`，trusted comment 绑定文件名 `SpiritPal_0.1.0_x64-setup.exe`；且 `updates.json` 内嵌 signature 与 release `.sig` 完全一致。

### 1.3 updates.json 可达性
```bash
curl -sI https://raw.githubusercontent.com/ReSerendipity/SpiritPal/main/updates.json
# 期望 HTTP 200；内容 version 与 tag 一致、platforms 含 windows-x86_64 与 linux-x86_64 且均有 signature
```

## 二、干净机器验收（Windows 真机，每版本抽测）

> 在**无 SpiritPal 历史安装**的机器/虚拟机执行，或先彻底卸载旧版（见 2.4 无残留检查）。

### 2.1 安装
1. 复制安装包到干净机器，双击 `SpiritPal_<版本>_x64-setup.exe`
2. SmartScreen 弹「已保护你的电脑」→ **更多信息 → 仍然运行**（无签名正常现象，勿伪造证书）
3. 安装向导完成，桌面/开始菜单出现 SpiritPal 图标
4. 安装目录存在：`%LOCALAPPDATA%\SpiritPal\`（或用户选择目录），内含 `SpiritPal.exe`

### 2.2 首次启动
1. 双击启动 → 宠物窗口出现，托盘图标出现
2. 托盘菜单：显示宠物 / 隐藏宠物 / 专注模式 / 番茄钟 / 切换形态 / 打开聊天 / **设置** / **检查更新** / 退出
3. 设置 → 关于：显示**动态读取的真实版本号**（与安装包版本一致，非硬编码旧值）
4. 设置 → 关于 → **检查更新**：弹窗显示「正在检查更新」→ 有新版则显示版本与更新说明；无新版则提示「已是最新版本」；断网时显示失败原因（不静默）
5. 托盘 → 检查更新：同样触发弹窗

### 2.3 更新流程（有新版时）
1. 点击「立即更新」→ 显示下载进度 → 校验 → 安装 → 应用自动重启
2. 重启后版本号为新版；关于页版本号同步更新
3. 若 60 秒内连续崩溃（人为制造）：第 1-3 次自动重启，第 4 次停止（防循环），日志目录存在 `crash_*.log` 与 `crash_restart.json`

### 2.4 卸载无残留
1. 控制面板/设置 → 卸载 SpiritPal
2. 检查残留（期望全部清理或仅保留用户数据目录，记录到验收结论）：
   - `%LOCALAPPDATA%\SpiritPal\`（卸载程序通常保留用户数据——需确认策略并记录）
   - 开始菜单快捷方式、注册表 `HKCU\Software\SpiritPal*` / 卸载项
   - 托盘图标消失、无 SpiritPal.exe 进程

## 三、验收记录

| 版本 | 日期 | 验收人/方式 | 安装 | 启动 | 检查更新 | 更新 | 卸载无残留 | 哈希比对 | 结论 |
|---|---|---|---|---|---|---|---|---|---|
| v0.1.0 | 2026-09-10 | AI 本机（模拟干净环境） | 见《执行对照表》P1-1 记录 | | | | | | |
| v0.1.0 | 2026-09-11 | AI 本机命令行（RTX 5070 机） | ✅ 静默安装至 `C:\Program Files\SpiritPal`（注册表 0.1.0） | ✅ 启动窗口正常、48.8 MB、10 s 稳定 | ⚠️ 需人工（GUI 自动化无管理员权限；签名链已独立验证） | 未测（无新版） | ✅ 目录+注册表清理，无残留 | ⚠️ 哈希不一致（构建环境差异，非篡改）；✅ minisign 验签通过 | 通过（2.1/2.2/2.4；2.3 无新版，GUI 项待人工） |

> 说明：本仓库无专门测试机，真机验收由所有者或 CI 化 E2E 补充；AI 侧完成「卸载残留检查 + 版本动态读取 + 更新链路单测」等本机可执行部分，并在此表留痕。

---

## 四、性能验证（本地 N 卡机器执行，2026-09-10 起）

> 2026-09-10 用户指示：模型必须 N 卡。冷启动/内存/FPS 性能门禁依赖 N 卡 GPU 与交互桌面，
> GitHub CI runner 无 GPU（此前 Windows cold-start exit 1 / Ubuntu FPS exit 2 即此根因），
> 故 CI 仅保留无需 GPU 的门禁（包大小 + 基线回归只读，release.yml `Package Size & Baseline Gate` job）；
> 以下 GPU 相关项改为**发布者本地 N 卡机器**人工执行并记录。
> **2026-09-11 已在本机完成首次实测**（NVIDIA RTX 5070 12GB，驱动 610.88，release 产物 spiritpal-app.exe），结果见下表。

| 项 | 命令 | 阈值（PRD v0.2） | 2026-09-11 实测（RTX 5070） | 记录位置 |
|---|---|---|---|---|
| 冷启动 | `pnpm perf:cold-start`（release 产物，设 `SPIRITPAL_EXE`） | < 2 s | **1071 ms ✅** | 本表 |
| 内存占用 | `pnpm perf:memory` | < 80 MB | **51.0 MB ✅**（3 次采样稳定） | 本表 |
| Live2D FPS | `pnpm perf:fps`（需 `npx playwright install chromium`） | ≥ 30 fps | **59.4 fps ✅**（Ticker 60.2，WebGL 走 N 卡） | 本表 |
| 模型切换延迟 | `pnpm perf:model-switch` | < 500 ms | **301 ms ✅**（脚本当前为模拟延迟，TODO 集成 Tauri 命令；真实切换待集成后复核） | 本表 |
| 基线回归 | `pnpm perf:baseline`（CI 只读版：`node perf/baseline-trend.mjs --read-only`） | 劣化 >20% 即失败 | ✅ 无性能回归（基线 2026-09-04） | CI 自动 + 本地 |

发布前在 N 卡机器跑上述项并记录结果；任一项超阈值需修复后才可发版（T-08 门禁的本地等价物）。
实测记录已由 AI 于 2026-09-11 在本机完成（结果 JSON 存 perf/results/，按 .gitignore 不入库）。


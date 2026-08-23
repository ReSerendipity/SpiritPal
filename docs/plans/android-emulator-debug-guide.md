# Android 模拟器桌面调试指南

> **目的**: 提供在桌面端通过 Android 模拟器调试移动端应用的完整工作流，确保 AI 助手能够复用此方法快速搭建开发环境。

---

## 📋 目录

- [环境要求](#环境要求)
- [快速启动](#快速启动)
- [详细步骤](#详细步骤)
- [常用命令](#常用命令)
- [调试技巧](#调试技巧)
- [故障排查](#故障排查)
- [性能优化](#性能优化)

---

## 环境要求

### 必需组件

1. **Android Studio** (已安装)
   - 下载地址：https://developer.android.com/studio
   - 版本：Hedgehog (2023.1.1) 或更高

2. **Android SDK** (已配置)
   - 默认路径：`C:\Users\<用户名>\AppData\Local\Android\Sdk`
   - 必需组件：
     - Android SDK Platform-Tools (包含 ADB)
     - Android SDK Build-Tools
     - Android Emulator
     - 至少一个系统镜像 (推荐 android-36, google_apis, x86_64)

3. **虚拟化管理程序** (Windows 10/11)
   - Windows Hypervisor Platform (WHPX) - 已自动启用
   - 或 Intel HAXM (Intel CPU)
   - 或 WSL2 后端

### 验证安装

```powershell
# 检查 SDK 路径
if (Test-Path "$env:LOCALAPPDATA\Android\Sdk") {
    Write-Host "✓ Android SDK 已安装"
} else {
    Write-Host "✗ Android SDK 未找到"
}

# 检查 ADB
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" version

# 检查模拟器
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -version
```

---

## 快速启动

### 一键启动命令

```powershell
# 启动 Pixel_7 模拟器（推荐配置）
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Pixel_7 -no-snapshot-load -camera-back none -camera-front emulated -dns-server 8.8.8.8

# 等待启动完成
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell getprop sys.boot_completed

# 查看设备状态
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```

预期输出：
```
List of devices attached
emulator-5554    device
```

---

## 详细步骤

### Step 1: 创建 AVD (Android Virtual Device)

#### 方式 A: 通过 Android Studio GUI

1. 打开 Android Studio
2. `Tools` → `Device Manager`
3. 点击 `Create Device`
4. 选择硬件配置：
   - **Phone**: Pixel 7
   - **RAM**: 4096 MB (建议)
   - **VM Heap**: 256 MB
   - **Internal Storage**: 2048 MB
5. 选择系统镜像：
   - **Target**: Android 14 (API 34) 或 Android 15 (API 35)
   - **ABI**: x86_64 (性能最佳)
   - **Download**: Google APIs 或 Google Play
6. 完成向导，命名 AVD 为 `Pixel_7`

#### 方式 B: 通过命令行

```powershell
# 列出可用系统镜像
& "$env:LOCALAPPDATA\Android\Sdk\sdkmanager.bat" --list | Select-String "system-images"

# 下载系统镜像
& "$env:LOCALAPPDATA\Android\Sdk\sdkmanager.bat" "system-images;android-36;google_apis;x86_64"

# 创建 AVD
& "$env:LOCALAPPDATA\Android\Sdk\tools\bin\avdmanager.bat" create avd ^
    --name "Pixel_7" ^
    --package "system-images;android-36;google_apis;x86_64" ^
    --device "pixel_7" ^
    --sdcard 512MB
```

### Step 2: 启动模拟器

#### 标准启动

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Pixel_7
```

#### 优化启动参数

| 参数 | 说明 | 推荐场景 |
|------|------|----------|
| `-no-snapshot-load` | 不使用快照，确保最新代码 | 首次测试/更新后 |
| `-snapshot <name>` | 使用指定快照 | 日常快速启动 |
| `-no-window` | 不显示窗口 (后台运行) | CI/CD |
| `-no-audio` | 禁用音频 | 节省资源 |
| `-camera-back none` | 禁用后置摄像头 | 减少权限请求 |
| `-camera-front emulated` | 使用模拟前置摄像头 | 需要摄像头功能 |
| `-dns-server 8.8.8.8` | 自定义 DNS | 网络问题排查 |
| `-memory 4096` | 设置 RAM 大小 | 内存密集型应用 |
| `-cores 2` | 设置 CPU 核心数 | 提升性能 |

### Step 3: 验证设备连接

```powershell
# 查看连接的设备
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices

# 检查设备是否完全启动
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell getprop sys.boot_completed
# 输出应为：1

# 检查屏幕分辨率
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell wm size
# 输出示例：Physical size: 1080x2400

# 检查 Android 版本
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell getprop ro.build.version.release
# 输出示例：16
```

### Step 4: 安装并运行应用

#### Tauri 开发模式 (推荐)

```bash
# 在项目根目录运行
pnpm tauri android dev
```

此命令会：
- ✅ 自动编译 Rust 后端 (Release 模式)
- ✅ 自动编译前端 React 代码
- ✅ 构建 debug APK
- ✅ 自动安装到检测到的模拟器/真机
- ✅ 自动启动应用
- ✅ 监听文件变化并热重载

#### 手动安装

```powershell
# 构建 Debug APK
pnpm tauri android build --debug

# 手动安装
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk

# 启动应用
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell am start -n com.spiritpal.desktop/.MainActivity
```

---

## 常用命令

### 设备管理

```powershell
# 列出所有模拟器
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -list-avds

# 列出连接的设备
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices

# 重启设备
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reboot

# 关闭模拟器
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu kill

# 清除应用数据
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell pm clear com.spiritpal.desktop

# 卸载应用
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" uninstall com.spiritpal.desktop
```

### 日志调试

```powershell
# 查看所有日志
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat

# 过滤特定标签
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -s SpiritPal:*

# 保存日志到文件
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -d > logcat.txt

# 清空日志缓冲区
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -c

# 只查看错误级别
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat *:E
```

### 文件系统操作

```powershell
# 推送文件到模拟器
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" push ./local_file.txt /sdcard/

# 从模拟器拉取文件
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" pull /sdcard/remote_file.txt ./

# 列出目录内容
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell ls -la /sdcard/

# 创建目录
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell mkdir /sdcard/test_folder
```

### 截图与录屏

```powershell
# 截图
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell screencap -p /sdcard/screenshot.png
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" pull /sdcard/screenshot.png ./screenshot.png

# 录屏 (最长 3 分钟)
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell screenrecord /sdcard/demo.mp4
# 按 Ctrl+C 停止录制

& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" pull /sdcard/demo.mp4 ./demo.mp4

# 获取屏幕尺寸
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell wm size
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell wm density
```

### Shell 命令执行

```powershell
# 执行任意 shell 命令
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell dumpsys window windows | Select-String "mCurrentFocus"

# 进入交互式 shell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell

# 以 root 权限执行 (仅限模拟器/已 root 设备)
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell su -c "settings put global wifi_on 1"
```

### 网络和性能

```powershell
# 模拟网络速度
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu network speed slow
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu network speed full

# 模拟网络延迟
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu network delay gprs

# 重置网络设置
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu network reset

# 查看电池状态
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell dumpsys battery

# 模拟充电
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu battery set state charging
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu battery set level 80
```

---

## 调试技巧

### Chrome DevTools 调试 WebView

#### 1. 启用开发者选项

```powershell
# 在模拟器中执行
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell settings put global developer_settings_enabled 1

# 或通过 UI: 设置 → 关于手机 → 连续点击"版本号" 7 次
```

#### 2. 开启 USB 调试

```powershell
# 通过 ADB 开启
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell settings put global adb_enabled 1

# 或通过 UI: 设置 → 系统 → 开发者选项 → USB 调试
```

#### 3. 连接 Chrome DevTools

1. 打开浏览器访问 `chrome://inspect/#devices`
2. 点击 `Configure...`
3. 添加 `localhost:5554` (或模拟器端口)
4. 在列表中可以看到模拟器中的 WebView
5. 点击 `inspect` 打开开发者工具

**可调试内容**:
- DOM 元素检查
- Console 日志
- Network 请求
- Performance 分析
- Memory 泄漏检测

### Android Studio Profiler

#### 启动 Profiler

1. 打开 Android Studio
2. `View` → `Tool Windows` → `Profiler`
3. 选择 `emulator-5554`
4. 选择目标应用 `com.spiritpal.desktop`

#### 监控指标

| 指标 | 用途 | 正常范围 |
|------|------|----------|
| **CPU** | 线程活动、方法追踪 | < 50% (空闲时) |
| **Memory** | 堆内存、GC 事件 | < 200MB (简单应用) |
| **Energy** | 电池消耗估算 | 低影响 |
| **Network** | 网络请求、数据量 | 视需求而定 |
| **GPU Rendering** | UI 渲染性能 | < 16ms/frame |

#### 性能分析流程

```powershell
# 1. 记录应用启动时间
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell am start -W com.spiritpal.desktop/.MainActivity

# 输出示例：
# ThisTime: 234
# TotalTime: 312
# StartTime: 1234567890
# EndTime: 1234568202
# StartComplete: true
```

### 热重载策略

#### Tauri 开发模式

```bash
# 自动热重载 (推荐)
pnpm tauri android dev

# 修改前端代码后自动刷新
# 修改 Rust 代码后自动重新编译
```

#### 手动刷新 WebView

```powershell
# 发送广播触发刷新
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell am broadcast -a com.spiritpal.desktop.RELOAD
```

### 多窗口调试

Tauri 支持多窗口，调试时注意：

```rust
// src-tauri/src/main.rs
#[cfg(desktop)]
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(desktop))]
fn main() {
    // Android/iOS 入口
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**关键点**: 
- 移动端需要在 `#[cfg(not(desktop))]` 中创建主 WebView
- 避免零窗口导致的白屏问题

---

## 故障排查

### 常见问题

#### 1. 模拟器无法启动

**症状**:  emulator 进程退出，提示虚拟化错误

**解决方案**:
```powershell
# 检查虚拟化支持
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All

# 启用 WHPX (需要管理员权限)
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform

# 重启电脑
Restart-Computer
```

**备选方案**: 使用 WSL2 后端
```powershell
wsl --install -d Ubuntu
wsl sudo apt-get install qemu-system-x86
```

#### 2. ADB 无法识别设备

**症状**: `adb devices` 显示 `unauthorized` 或无设备

**解决方案**:
```powershell
# 重启 ADB 服务
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" kill-server
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" start-server

# 检查模拟器窗口是否正常显示
# 如果窗口卡住，重新启动模拟器
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu kill
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Pixel_7

# 在模拟器弹窗中点击"允许 USB 调试"
```

#### 3. APK 安装失败

**症状**: `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 或 `INSTALL_PARSE_FAILED_NO_CERTIFICATES`

**解决方案**:
```powershell
# 卸载旧版本后重新安装
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" uninstall com.spiritpal.desktop
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app-debug.apk

# 或清除数据后安装
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell pm clear com.spiritpal.desktop
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app-debug.apk
```

#### 4. 白屏问题 (Tauri 移动端已知 issue)

**症状**: 应用启动后显示空白屏幕

**根本原因**: 
- `tauri.conf.json` 的 `app.windows` 为空数组
- `#[cfg(desktop)]` 只创建了桌面窗口，移动端的 WebView 未创建

**解决方案**:
```rust
// src-tauri/src/lib.rs
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Desktop-specific setup
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn setup(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Mobile: WebView is automatically created by runtime
    // No additional setup needed for basic WebView
    Ok(())
}
```

**参考**: https://github.com/tauri-apps/tauri/issues/15671

#### 5. 构建时缺少 Android ABI 二进制文件

**症状**: `error: resource path 'binaries/spiritpal-mcp-aarch64-linux-android' doesn't exist`

**解决方案**:
```powershell
# 1. 安装 Android NDK
& "$env:LOCALAPPDATA\Android\Sdk\sdkmanager.bat" "ndk;26.1.10909125"

# 2. 设置环境变量
$env:ANDROID_NDK_HOME = "$env:LOCALAPPDATA\Android\Sdk\ndk\26.1.10909125"

# 3. 交叉编译各 ABI
cargo build --release --target aarch64-linux-android
cargo build --release --target armv7-linux-androideabi
cargo build --release --target i686-linux-android
cargo build --release --target x86_64-linux-android

# 4. 将二进制文件复制到 binaries 目录
Copy-Item "target\aarch64-linux-android\release\spiritpal-mcp.exe" "src-tauri\binaries\spiritpal-mcp-aarch64-linux-android"
Copy-Item "target\armv7-linux-androideabi\release\spiritpal-mcp.exe" "src-tauri\binaries\spiritpal-mcp-armv7-linux-androideabi"
Copy-Item "target\i686-linux-android\release\spiritpal-mcp.exe" "src-tauri\binaries\spiritpal-mcp-i686-linux-android"
Copy-Item "target\x86_64-linux-android\release\spiritpal-mcp.exe" "src-tauri\binaries\spiritpal-mcp-x86_64-linux-android"
```

#### 6. 前端资产未更新

**症状**: 打包的 APK 包含旧版本的 JavaScript 代码

**解决方案**:
```powershell
# 方案 A: 清理构建缓存
Remove-Item -Recurse -Force src-tauri\gen\android\app\build
pnpm tauri android build

# 方案 B: 手动同步资产
Copy-Item -Recurse -Force dist\* src-tauri\gen\android\app\src\main\assets\
pnpm tauri android build
```

---

## 性能优化

### 模拟器配置优化

#### 内存分配

编辑 `$HOME\.android\avd\Pixel_7.avd\config.ini`:

```ini
# CPU 和内存
hw.cpu.ncore=2
hw.ramSize=4096
vm.heapSize=576

# GPU 加速
hw.gpu.enabled=yes
hw.gpu.mode=auto

# 磁盘加速
disk.dataPartition.size=2048M

# 禁用不需要的硬件
hw.keyboard=yes
hw.touch=yes
hw.trackball=no
hw.camera.back=none
hw.camera.front=emulated

# 启动优化
fastboot.forceBoot=true
avd.snapshot= yes
```

#### 启动快照

```powershell
# 首次启动后创建快照
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Pixel_7 -writeback-snapshot

# 下次启动使用快照 (5-10 秒)
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Pixel_7 -snapshots
```

### 应用性能优化

#### Rust 编译优化

```toml
# src-tauri/Cargo.toml
[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true
```

#### 前端打包优化

```json
// vite.config.ts
export default defineConfig({
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          tauri: ['@tauri-apps/api']
        }
      }
    }
  }
})
```

### 网络优化

#### 代理配置

```powershell
# 设置 HTTP 代理
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell settings put global http_proxy 127.0.0.1:8080

# 清除代理
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell settings put global http_proxy :0
```

#### WiFi 模拟

```powershell
# 启用 WiFi
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu wifi enable

# 连接到模拟网络
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu wifi connect 802.11ac

# 查看 WiFi 状态
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell dumpsys wifi
```

---

## 自动化脚本示例

### PowerShell 启动脚本

```powershell
# scripts/start-android.ps1

param(
    [string]$AvdName = "Pixel_7",
    [switch]$NoSnapshot,
    [switch]$Headless
)

Write-Host "🚀 启动 Android 模拟器..." -ForegroundColor Green

$EmulatorPath = "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe"
$AdbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

# 检查模拟器是否存在
$AvdList = & $EmulatorPath -list-avds
if ($AvdList -notcontains $AvdName) {
    Write-Host "❌ 模拟器 '$AvdName' 不存在" -ForegroundColor Red
    exit 1
}

# 构建启动参数
$Args = @("-avd", $AvdName)
if ($NoSnapshot) { $Args += "-no-snapshot-load" }
if ($Headless) { 
    $Args += @("-no-window", "-no-audio") 
}
$Args += @("-camera-back", "none", "-camera-front", "emulated", "-dns-server", "8.8.8.8")

# 启动模拟器
Write-Host "⏳ 正在启动..." -ForegroundColor Yellow
Start-Process -FilePath $EmulatorPath -ArgumentList $Args -WindowStyle Normal

# 等待启动完成
Write-Host "⏱️  等待启动完成 (约 30 秒)..." -ForegroundColor Yellow
do {
    Start-Sleep -Seconds 5
    $Status = & $AdbPath devices
} while ($Status -notlike "*emulator-*	device*")

Write-Host "✅ 模拟器已就绪!" -ForegroundColor Green

# 显示设备信息
Write-Host "`n📱 设备信息:" -ForegroundColor Cyan
& $AdbPath shell getprop ro.product.model
& $AdbPath shell getprop ro.build.version.release
& $AdbPath shell wm size

Write-Host "`n💡 提示：运行 'pnpm tauri android dev' 开始开发" -ForegroundColor Gray
```

**使用方法**:
```powershell
.\scripts\start-android.ps1 -AvdName "Pixel_7" -NoSnapshot
```

### 自动化测试脚本

```powershell
# scripts/test-mobile.ps1

Write-Host "🧪 开始移动端自动化测试..." -ForegroundColor Green

$AdbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

# 1. 确保模拟器运行中
Write-Host "`n1️⃣ 检查设备..." -ForegroundColor Cyan
$Devices = & $AdbPath devices | Select-String "emulator-"
if (-not $Devices) {
    Write-Host "❌ 没有检测到模拟器" -ForegroundColor Red
    exit 1
}

# 2. 卸载旧版本
Write-Host "`n2️⃣ 卸载旧版本..." -ForegroundColor Cyan
& $AdbPath uninstall com.spiritpal.desktop 2>$null

# 3. 构建 Debug APK
Write-Host "`n3️⃣ 构建 Debug APK..." -ForegroundColor Cyan
pnpm tauri android build --debug

# 4. 安装
Write-Host "`n4️⃣ 安装应用..." -ForegroundColor Cyan
& $AdbPath install -r src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk

# 5. 启动应用
Write-Host "`n5️⃣ 启动应用..." -ForegroundColor Cyan
& $AdbPath shell am start -n com.spiritpal.desktop/.MainActivity

# 6. 等待加载
Start-Sleep -Seconds 5

# 7. 截图验证
Write-Host "`n6️⃣ 截图验证..." -ForegroundColor Cyan
& $AdbPath shell screencap -p /sdcard/test_screenshot.png
& $AdbPath pull /sdcard/test_screenshot.png ./test-results/

Write-Host "`n✅ 测试完成！截图保存在 ./test-results/test_screenshot.png" -ForegroundColor Green
```

---

## 参考资料

### 官方文档

- [Tauri 移动端开发指南](https://v2.tauri.app/start/mobile/)
- [Android 模拟器文档](https://developer.android.com/studio/run/emulator)
- [ADB 命令参考](https://developer.android.com/tools/adb)

### 社区资源

- [Tauri 移动端 Known Issues](https://github.com/tauri-apps/tauri/labels/mobile)
- [Android Emulator Performance Tips](https://developer.android.com/studio/run/emulator-performance)

### 相关工具

- **Android Studio**: IDE 和 SDK 管理
- **ADB (Android Debug Bridge)**: 设备通信工具
- **AVD Manager**: 虚拟设备管理
- **Chrome DevTools**: WebView 调试
- **Android Profiler**: 性能分析

---

## 修订记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| v1.0 | 2026-08-22 | 初始版本，包含完整的模拟器调试工作流 | AI Assistant |

---

**最后更新**: 2026-08-22  
**维护者**: SpiritPal Team  
**许可**: MIT

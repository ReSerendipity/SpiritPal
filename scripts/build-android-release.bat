@echo off
chcp 65001 >nul 2>&1
title SpiritPal - 构建 Android 安装包

echo ============================================
echo   SpiritPal - 一键构建 Android APK
echo   AI Desktop Pet - Tauri v2 (Android)
echo   对应 docs/agents/SOPS.md SOP-4
echo ============================================
echo.
echo   说明：桌面安装包请用 scripts\build-release.bat
echo         本脚本只负责 Android arm64 release，并把
echo         SOP-4 声明为强制的两道校验接到构建出入口。
echo.

:: ------------------------------------------
:: 0. 切换到项目根目录
:: ------------------------------------------
cd /d "%~dp0\.."

:: ------------------------------------------
:: 1. 检查构建环境
:: ------------------------------------------
echo [1/5] 检查构建环境 ...

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   [错误] 未检测到 python，请先安装 Python 3 并加入 PATH
    pause
    exit /b 1
)

if not exist "src-tauri\gen\android\gradlew.bat" (
    echo   [错误] 未找到 src-tauri\gen\android\gradlew.bat，Android 工程不完整
    pause
    exit /b 1
)

echo   [OK] 构建环境就绪
echo   提示：release 签名需 app\keystore.properties + *.jks（异地备份，见 SOP-4 / GOTCHAS #115）

:: ------------------------------------------
:: 2. 拉取端侧 MNN 引擎库（SOP-4 ①，幂等）
:: ------------------------------------------
echo.
echo [2/5] 准备端侧 MNN 引擎库 ...
python scripts\download_mnn_engine.py
if %errorlevel% neq 0 (
    echo   [错误] 引擎库准备失败（离线或下载异常）；APK 将缺少端侧引擎，终止
    echo         见 SOP-4 / GOTCHAS #110 #111
    pause
    exit /b 1
)
echo   [OK] 引擎库就位

:: ------------------------------------------
:: 3. 构建前门禁：校验 Tauri/wry Kotlin 胶水层（--check，强制）
:: ------------------------------------------
echo.
echo [3/5] 校验 Android Kotlin 胶水层（构建前门禁）...
python scripts\regenerate_android_kotlin.py --check
if %errorlevel% equ 0 goto :kotlin_ok
echo   [警告] 胶水层缺失/不一致（gradle 链路不会自动生成），尝试重建 ...
python scripts\regenerate_android_kotlin.py
python scripts\regenerate_android_kotlin.py --check
if %errorlevel% neq 0 (
    echo   [错误] 重建后仍不一致，终止（见 SOP-4 / GOTCHAS #115）
    pause
    exit /b 1
)
:kotlin_ok
echo   [OK] Kotlin 胶水层就位

:: ------------------------------------------
:: 4. 出 arm64 release APK（SOP-4 ③）
:: ------------------------------------------
echo.
echo [4/5] 构建 arm64 release APK ...
echo   构建过程可能需要数分钟，请耐心等待
echo.
pushd "src-tauri\gen\android"
call gradlew.bat assembleArm64Release
set "GRADLE_RC=%errorlevel%"
popd
if not "%GRADLE_RC%"=="0" (
    echo.
    echo   [错误] gradlew assembleArm64Release 失败，请检查上方错误信息
    pause
    exit /b 1
)
echo   [OK] APK 已产出

:: ------------------------------------------
:: 5. 产物门禁：DEX 级校验 26 项 JNI keep（APK 出完后，强制）
:: ------------------------------------------
echo.
echo [5/5] 校验 release APK 的 JNI keep（DEX 级证明）...
python scripts\verify_android_jni_keeps.py
if %errorlevel% neq 0 (
    echo.
    echo   [错误] JNI keep 校验未通过（rc!=0）；真机将 NoSuchMethodError 崩溃
    echo         在 proguard-rules.pro 补 -keep 后重打（见 GOTCHAS #121 #122）
    pause
    exit /b 1
)

:: ------------------------------------------
:: 复制通过校验的 APK 到 artifacts 目录
:: ------------------------------------------
if not exist "artifacts" mkdir artifacts
set "APK_DIR=src-tauri\gen\android\app\build\outputs\apk\arm64\release"
for %%f in ("%APK_DIR%\*.apk") do (
    copy /y "%%f" "artifacts\%%~nxf" >nul
    echo   [OK] artifacts\%%~nxf
)

:: ------------------------------------------
:: 完成
:: ------------------------------------------
echo.
echo ============================================
echo   Android 构建完成！两道强制校验均已通过
echo ============================================
echo.
echo   构建产物位置: artifacts\
echo   下一步（真机验收，SOP-4）：adb install -r 后看 pidof + logcat -b crash
echo.
pause

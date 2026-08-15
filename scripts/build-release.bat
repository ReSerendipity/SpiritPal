@echo off
chcp 65001 >nul 2>&1
title SpiritPal - 构建安装包

echo ============================================
echo   SpiritPal - 一键构建安装包
echo   AI Desktop Pet - Tauri v2
echo ============================================
echo.

:: ------------------------------------------
:: 0. 切换到项目根目录
:: ------------------------------------------
cd /d "%~dp0\.."

:: ------------------------------------------
:: 1. 检查依赖
:: ------------------------------------------
echo [1/4] 检查构建环境 ...

if not exist "node_modules" (
    echo   [错误] node_modules 不存在，请先运行 install.bat
    pause
    exit /b 1
)

where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo   [错误] 未检测到 Rust，请安装: https://rustup.rs/
    pause
    exit /b 1
)

echo   [OK] 构建环境就绪

:: ------------------------------------------
:: 2. 读取版本号
:: ------------------------------------------
echo.
echo [2/4] 读取版本号 ...
for /f "tokens=2 delims=:," %%a in ('findstr /c:"\"version\"" package.json') do (
    for /f "tokens=1 delims:," %%b in ("%%a") do (
        set VERSION=%%~b
        goto :version_found
    )
)
:version_found
echo   版本: %VERSION%

:: ------------------------------------------
:: 3. 执行构建
:: ------------------------------------------
echo.
echo [3/4] 开始构建（前端 + Rust + 打包） ...
echo   构建过程可能需要 5-15 分钟，请耐心等待
echo.

call pnpm tauri build
if %errorlevel% neq 0 (
    echo.
    echo [错误] 构建失败！请检查上方错误信息。
    pause
    exit /b 1
)

:: ------------------------------------------
:: 4. 复制构建产物到 artifacts 目录
:: ------------------------------------------
echo.
echo [4/4] 复制构建产物 ...

if not exist "artifacts" mkdir artifacts

:: 复制 NSIS 安装包
set NSIS_PATH=src-tauri\target\release\bundle\nsis
if exist "%NSIS_PATH%" (
    for %%f in ("%NSIS_PATH%\*.exe") do (
        copy /y "%%f" "artifacts\%%~nxf" >nul
        echo   [OK] %%~nxf
    )
) else (
    echo   [警告] NSIS 安装包未找到
)

:: 复制可执行文件
set EXE_PATH=src-tauri\target\release
if exist "%EXE_PATH%\spiritpal-app.exe" (
    copy /y "%EXE_PATH%\spiritpal-app.exe" "artifacts\SpiritPal-v%VERSION%-desktop-x64.exe" >nul
    echo   [OK] SpiritPal-v%VERSION%-desktop-x64.exe
) else (
    echo   [警告] 可执行文件未找到
)

:: 复制 MSI 安装包（如果存在）
set MSI_PATH=src-tauri\target\release\bundle\msi
if exist "%MSI_PATH%" (
    for %%f in ("%MSIS_PATH%\*.msi") do (
        copy /y "%%f" "artifacts\%%~nxf" >nul
        echo   [OK] %%~nxf
    )
)

:: ------------------------------------------
:: 完成
:: ------------------------------------------
echo.
echo ============================================
echo   构建完成！
echo ============================================
echo.
echo   构建产物位置: artifacts\
echo   版本: %VERSION%
echo.
echo   正在打开输出目录 ...
explorer "artifacts"

echo.
pause

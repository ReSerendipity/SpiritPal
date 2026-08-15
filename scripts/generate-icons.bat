@echo off
chcp 65001 >nul 2>&1
title SpiritPal - 生成应用图标

echo ============================================
echo   SpiritPal - 应用图标生成脚本
echo   使用 Tauri CLI 从源图标生成全平台图标
echo ============================================
echo.

:: ------------------------------------------
:: 0. 切换到项目根目录
:: ------------------------------------------
cd /d "%~dp0\.."

:: ------------------------------------------
:: 1. 检查依赖
:: ------------------------------------------
echo [1/3] 检查环境 ...

if not exist "node_modules" (
    echo   [错误] node_modules 不存在，请先运行 install.bat
    pause
    exit /b 1
)

echo   [OK] 依赖已安装

:: ------------------------------------------
:: 2. 检查源图标文件
:: ------------------------------------------
echo.
echo [2/3] 检查源图标 ...
set SOURCE_ICON=src-tauri\icons\icon.png

if not exist "%SOURCE_ICON%" (
    echo   [错误] 源图标文件不存在: %SOURCE_ICON%
    echo   请准备一张 1024x1024 PNG 图标文件放在:
    echo     %SOURCE_ICON%
    echo.
    pause
    exit /b 1
)

echo   [OK] 源图标: %SOURCE_ICON%

:: ------------------------------------------
:: 3. 使用 Tauri CLI 生成图标
:: ------------------------------------------
echo.
echo [3/3] 生成全平台图标 ...
echo   将生成: ico / icns / 各尺寸 PNG / Store Logo
echo.

call pnpm tauri icon "%SOURCE_ICON%"
if %errorlevel% neq 0 (
    echo.
    echo [错误] 图标生成失败！
    echo 请检查源图标是否为 1024x1024 PNG 格式。
    pause
    exit /b 1
)

:: ------------------------------------------
:: 完成
:: ------------------------------------------
echo.
echo ============================================
echo   图标生成完成！
echo ============================================
echo.
echo   生成位置: src-tauri\icons\
echo   包含: icon.ico / icon.icns / 各尺寸 PNG / Store Logo
echo.
echo   注意: 托盘图标 (tray-icon.png) 需要单独制作
echo         建议尺寸: 32x32 或 64x64 PNG
echo.
pause

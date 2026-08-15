@echo off
chcp 65001 >nul 2>&1
title SpiritPal - 开发环境

echo ============================================
echo   SpiritPal - 启动开发环境
echo   AI Desktop Pet - Tauri v2 + React 19
echo ============================================
echo.

:: ------------------------------------------
:: 1. 检查依赖是否已安装
:: ------------------------------------------
echo [1/2] 检查项目依赖 ...
if not exist "node_modules" (
    echo   [未安装] node_modules 目录不存在
    echo   正在执行 pnpm install ...
    echo.
    call pnpm install
    if %errorlevel% neq 0 (
        echo.
        echo [错误] 依赖安装失败！
        echo 请先运行 install.bat
        echo.
        pause
        exit /b 1
    )
) else (
    echo   [OK] node_modules 已存在
)

:: 检查 Rust 工具链
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [错误] 未检测到 Rust（Cargo）！
    echo Tauri 后端需要 Rust 编译。
    echo 请安装 Rust: https://rustup.rs/
    echo.
    pause
    exit /b 1
)
echo   [OK] Rust 工具链就绪

:: ------------------------------------------
:: 2. 启动 Tauri 开发服务器
:: ------------------------------------------
echo.
echo [2/2] 启动 Tauri 开发服务器 ...
echo.
echo   前端 DevServer: http://localhost:5223
echo   Tauri 窗口将自动打开
echo   按 Ctrl+C 停止开发服务器
echo.
call pnpm tauri dev

if %errorlevel% neq 0 (
    echo.
    echo [错误] 开发服务器启动失败！
    echo 请检查错误信息后重试。
    echo.
    pause
    exit /b 1
)

pause

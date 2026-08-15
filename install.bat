@echo off
chcp 65001 >nul 2>&1
title SpiritPal - 环境安装

echo ============================================
echo   SpiritPal - 一键安装脚本
echo   AI Desktop Pet - Tauri v2 + React 19
echo ============================================
echo.

:: ------------------------------------------
:: 1. 检查 Node.js
:: ------------------------------------------
echo [1/4] 检查 Node.js ...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [错误] 未检测到 Node.js！
    echo 请先安装 Node.js 22 LTS 或更高版本：
    echo   https://nodejs.org/
    echo.
    echo 安装完成后请重新运行此脚本。
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo   [OK] Node.js 版本: %NODE_VERSION%

:: 检查 Node.js 版本是否 >= 18
for /f "tokens=1 delims=." %%a in ("%NODE_VERSION:v=%") do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
    echo   [警告] Node.js 版本过低，建议升级到 22 LTS+
    echo.
)

:: ------------------------------------------
:: 2. 检查 pnpm
:: ------------------------------------------
echo.
echo [2/4] 检查 pnpm ...
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo   [未安装] 正在通过 corepack 安装 pnpm ...
    call corepack enable pnpm >nul 2>&1
    if %errorlevel% neq 0 (
        echo   [尝试] 使用 npm 安装 pnpm ...
        call npm install -g pnpm
        if %errorlevel% neq 0 (
            echo.
            echo [错误] pnpm 安装失败！
            echo 请手动运行: npm install -g pnpm
            echo.
            pause
            exit /b 1
        )
    )
    echo   [OK] pnpm 安装完成
) else (
    for /f "tokens=*" %%v in ('pnpm -v') do set PNPM_VERSION=%%v
    echo   [OK] pnpm 版本: %PNPM_VERSION%
)

:: ------------------------------------------
:: 3. 检查 Rust（Cargo）
:: ------------------------------------------
echo.
echo [3/4] 检查 Rust 工具链 ...
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [警告] 未检测到 Rust（Cargo）！
    echo Rust 是 Tauri 后端编译所必需的。
    echo 请安装 Rust:
    echo   https://rustup.rs/
    echo.
    echo 安装完成后请重新运行此脚本。
    echo.
    choice /c yn /m "是否继续安装前端依赖（跳过 Rust）"
    if errorlevel 2 exit /b 1
) else (
    for /f "tokens=*" %%v in ('rustc --version') do set RUST_VERSION=%%v
    echo   [OK] %RUST_VERSION%
)

:: ------------------------------------------
:: 4. 安装前端依赖
:: ------------------------------------------
echo.
echo [4/4] 安装前端依赖 (pnpm install) ...
echo.
call pnpm install
if %errorlevel% neq 0 (
    echo.
    echo [错误] 前端依赖安装失败！
    echo 请检查网络连接后重试。
    echo.
    pause
    exit /b 1
)

:: ------------------------------------------
:: 完成
:: ------------------------------------------
echo.
echo ============================================
echo   安装完成！
echo ============================================
echo.
echo   下一步: 双击 start.bat 启动开发环境
echo   或手动运行: pnpm tauri dev
echo.
echo   构建安装包: 双击 scripts\build-release.bat
echo   运行全部测试: 双击 scripts\run-all-tests.bat
echo.
pause

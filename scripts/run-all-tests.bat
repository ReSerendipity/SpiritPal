@echo off
chcp 65001 >nul 2>&1
title SpiritPal - 全部测试

echo ============================================
echo   SpiritPal - 一键运行全部测试
echo   lint + vitest + e2e + cargo test
echo ============================================
echo.

:: ------------------------------------------
:: 0. 切换到项目根目录
:: ------------------------------------------
cd /d "%~dp0\.."

set PASS_COUNT=0
set FAIL_COUNT=0

:: ------------------------------------------
:: 1. TypeScript 类型检查 (lint)
:: ------------------------------------------
echo [1/4] TypeScript 类型检查 (pnpm lint) ...
echo ----------------------------------------
call pnpm lint
if %errorlevel% equ 0 (
    echo   [PASS] TypeScript 类型检查通过
    set /a PASS_COUNT+=1
) else (
    echo   [FAIL] TypeScript 类型检查失败
    set /a FAIL_COUNT+=1
)
echo.

:: ------------------------------------------
:: 2. Vitest 单元测试
:: ------------------------------------------
echo [2/4] Vitest 单元测试 (pnpm test) ...
echo ----------------------------------------
call pnpm test
if %errorlevel% equ 0 (
    echo   [PASS] Vitest 单元测试通过
    set /a PASS_COUNT+=1
) else (
    echo   [FAIL] Vitest 单元测试失败
    set /a FAIL_COUNT+=1
)
echo.

:: ------------------------------------------
:: 3. Rust 测试
:: ------------------------------------------
echo [3/4] Rust 测试 (cargo test) ...
echo ----------------------------------------
cd src-tauri
call cargo test
if %errorlevel% equ 0 (
    echo   [PASS] Rust 测试通过
    set /a PASS_COUNT+=1
) else (
    echo   [FAIL] Rust 测试失败
    set /a FAIL_COUNT+=1
)
cd ..
echo.

:: ------------------------------------------
:: 4. E2E 端到端测试（Playwright）
:: ------------------------------------------
echo [4/4] E2E 端到端测试 (pnpm test:e2e) ...
echo ----------------------------------------
echo   注意: E2E 测试需要先构建应用或启动开发服务器
echo   如测试失败，请先运行: pnpm tauri dev
echo.
call pnpm test:e2e
if %errorlevel% equ 0 (
    echo   [PASS] E2E 端到端测试通过
    set /a PASS_COUNT+=1
) else (
    echo   [FAIL] E2E 端到端测试失败
    set /a FAIL_COUNT+=1
)
echo.

:: ------------------------------------------
:: 汇总报告
:: ------------------------------------------
echo ============================================
echo   测试汇总报告
echo ============================================
echo   通过: %PASS_COUNT% / 4
echo   失败: %FAIL_COUNT% / 4
echo.

if %FAIL_COUNT% equ 0 (
    echo   *** 全部测试通过！ ***
) else (
    echo   *** 有 %FAIL_COUNT% 项测试失败，请检查上方日志 ***
)

echo.
pause

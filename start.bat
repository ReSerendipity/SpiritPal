@echo off
chcp 65001 >nul 2>&1
title SpiritPal - 开发环境 (Dev Port 5223)

echo ============================================
echo   SpiritPal - 启动开发环境
echo   AI Desktop Pet - Tauri v2 + React 19
echo   开发端口: 5223 (strictPort, 被占用将直接报错)
echo ============================================
echo.

:: ------------------------------------------
:: 0. 切换到脚本所在目录（支持任意位置双击）
:: ------------------------------------------
cd /d "%~dp0"

:: ------------------------------------------
:: 1. 检查项目依赖
:: ------------------------------------------
echo [1/3] 检查项目依赖 ...
if not exist "node_modules" goto :install_deps
    echo   [OK] node_modules 已存在
goto :after_deps

:install_deps
    echo   [未安装] node_modules 目录不存在
    echo   正在执行 pnpm install ...
    echo.
    call pnpm install
if %errorlevel% neq 0 goto :deps_fail
goto :after_deps

:deps_fail
        echo.
        echo [错误] 依赖安装失败！请检查网络后重试。
        echo.
        pause
        exit /b 1

:after_deps

:: 检查 Rust 工具链（用 goto 规避 if 括号内中文吞字符 bug）
:: rustup 代理可能缺失：探测 toolchain 目录并临时加入 PATH
set "CARGO_BIN="
for /f "tokens=*" %%c in ('"%USERPROFILE%\.cargo\bin\rustup.exe" which cargo 2^>nul') do set "CARGO_BIN=%%c"
if defined CARGO_BIN goto :cargo_found
where cargo >nul 2>&1
if not errorlevel 1 for /f "tokens=*" %%c in ('where cargo') do set "CARGO_BIN=%%c"
if defined CARGO_BIN goto :cargo_found
for /d %%t in ("%USERPROFILE%\.rustup\toolchains\*") do if exist "%%t\bin\cargo.exe" set "CARGO_BIN=%%t\bin\cargo.exe"
if not defined CARGO_BIN goto :no_rust

:cargo_found
for %%p in ("%CARGO_BIN%") do set "CARGO_DIR=%%~dpp"
if defined CARGO_DIR set "PATH=%PATH%;%CARGO_DIR:~0,-1%"
echo   [OK] Rust 工具链就绪
goto :after_rust

:no_rust
echo.
echo [错误] 未检测到 Rust（Cargo）！Tauri 后端需要 Rust 编译。
echo   请先安装 Rust 工具链：rustup.rs （浏览器打开，选 Windows 安装）
echo.
pause
exit /b 1

:after_rust

:: ------------------------------------------
:: 2. 开发端口占用预检（5223, strictPort）
::    vite.config.ts 配置 strictPort:true，
::    端口被占用时 vite 会直接崩溃而非自动换端口。
:: ------------------------------------------
set DEV_PORT=5223
echo.
echo [2/3] 检查开发端口 %DEV_PORT% 是否被占用 ...
if not defined PORT_PID goto :port_free
    echo   [警告] 端口 %DEV_PORT% 已被进程 PID=%PORT_PID% 占用！
    echo.
    echo   由于 vite 配置 strictPort:true，直接启动会报错崩溃。
    echo   请先释放端口，例如（请确认该 PID 不是重要进程）：
    echo     netstat -ano ^| findstr :%DEV_PORT%
    echo     taskkill /PID %PORT_PID% /F
    echo.
    pause
    exit /b 1

:port_free
    echo   [OK] 端口 %DEV_PORT% 空闲

:: ------------------------------------------
:: 3. 启动 Tauri 开发服务器
:: ------------------------------------------
echo.
echo [3/3] 启动 Tauri 开发服务器 ...
echo.
echo   前端 DevServer: http://localhost:%DEV_PORT%
echo   Tauri 窗口将自动打开
echo   按 Ctrl+C 停止开发服务器
echo.
call pnpm tauri dev


if %errorlevel% neq 0 goto :dev_fail
goto :dev_done

:dev_fail
    echo.
    echo [错误] 开发服务器启动失败！请检查上方错误信息。
    echo.
    pause
    exit /b 1

:dev_done

pause

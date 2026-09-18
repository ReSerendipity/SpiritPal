@echo off
setlocal
REM 定位 vcvars64.bat：优先环境变量 VCVARS64，其次常见 VS BuildTools 版本路径
if "%VCVARS64%"=="" set "VCVARS64=C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS64%" (
  for %%V in ("C:\Program Files (x86)\Microsoft Visual Studio\17\BuildTools\VC\Auxiliary\Build\vcvars64.bat" "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat") do (
    if not exist "%VCVARS64%" if exist "%%~V" set "VCVARS64=%%~V"
  )
)
call "%VCVARS64%" >nul 2>&1
cd /d "%~dp0"
pnpm tauri build --no-bundle
echo BUILD_RC=%errorlevel%
endlocal

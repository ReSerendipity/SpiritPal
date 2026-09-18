@echo off
setlocal
echo [%date% %time%] Init MSVC env via vcvars64.bat ...
REM 定位 vcvars64.bat：优先环境变量 VCVARS64（可覆盖），其次常见 VS BuildTools 版本路径
if "%VCVARS64%"=="" set "VCVARS64=C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS64%" (
  for %%V in ("C:\Program Files (x86)\Microsoft Visual Studio\17\BuildTools\VC\Auxiliary\Build\vcvars64.bat" "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat") do (
    if not exist "%VCVARS64%" if exist "%%~V" set "VCVARS64=%%~V"
  )
)
if not exist "%VCVARS64%" (
  echo [%date% %time%] vcvars64.bat NOT FOUND. Set env var VCVARS64 to your vcvars64.bat path.
  exit /b 1
)
call "%VCVARS64%" >nul 2>&1
if %errorlevel% neq 0 (
  echo [%date% %time%] vcvars64.bat FAILED
  exit /b 1
)
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
  echo [%date% %time%] pnpm not found on PATH
  exit /b 1
)
cd /d "%~dp0"
echo [%date% %time%] Starting portable build: pnpm tauri build --no-bundle ...
pnpm tauri build --no-bundle > "build_portable.log" 2>&1
set BUILD_RC=%errorlevel%
if %BUILD_RC% neq 0 (
  echo [%date% %time%] BUILD FAILED rc=%BUILD_RC%  (see build_portable.log)
  exit /b %BUILD_RC%
)
echo [%date% %time%] Build OK. Syncing pet resources (robocopy public\pets -> target\release\pets) ...
robocopy "public\pets" "src-tauri\target\release\pets" /MIR /NFL /NDL /NJH /NJS /NP
echo [%date% %time%] DONE. Portable exe: src-tauri\target\release\spiritpal-app.exe
endlocal

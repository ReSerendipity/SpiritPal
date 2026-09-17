@echo off
setlocal
echo [%date% %time%] Init MSVC env via vcvars64.bat ...
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
if %errorlevel% neq 0 (
  echo [%date% %time%] vcvars64.bat FAILED
  exit /b 1
)
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
  echo [%date% %time%] pnpm not found on PATH
  exit /b 1
)
cd /d "C:\Users\Doro\SpiritPal"
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

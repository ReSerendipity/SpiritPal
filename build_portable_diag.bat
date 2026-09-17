@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
cd /d "C:\Users\Doro\SpiritPal"
pnpm tauri build --no-bundle
echo BUILD_RC=%errorlevel%
endlocal

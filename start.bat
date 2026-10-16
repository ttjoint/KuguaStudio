@echo off
setlocal
chcp 65001 >nul
cd /d %~dp0

REM KuguaStudio
REM WebUI

REM -- Check Node.js --
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)

REM -- Release 24601 --
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":24601" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)

REM -- build WebUI(log :build.log) --
if not exist "packages\webui\dist\server.js" (
    echo [BUILD] Building...
    call npm run build > build.log 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed. See build.log
        pause
        exit /b 1
    )
)

REM -- Begin WebUI--
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Set-Location '%~dp0'; Start-Process 'node' -ArgumentList 'packages\webui\dist\server.js' -WindowStyle Hidden"

exit /b 0

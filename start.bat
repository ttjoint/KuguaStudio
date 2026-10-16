@echo off
setlocal
chcp 65001 >nul
cd /d %~dp0

REM KuguaStudio / WebUI launcher
REM Note: no port-based taskkill (the old version would kill a running instance).
REM       Single-instance protection is handled by WebUI itself (data/webui.lock):
REM       a second instance exits automatically when a live instance is detected.

REM -- Check Node.js --
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)

REM -- Build on first run --
if not exist "packages\webui\dist\server.js" (
    echo [BUILD] Building...
    call npm run build
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
)

REM -- Start WebUI in background --
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Set-Location '%~dp0'; Start-Process 'node' -ArgumentList 'packages\webui\dist\server.js' -WindowStyle Hidden"

exit /b 0

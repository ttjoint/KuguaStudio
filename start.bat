@echo off
setlocal
chcp 65001 >nul
cd /d %~dp0

REM KuguaStudio / WebUI launcher
REM Note: no port-based taskkill (the old version would kill a running instance).
REM       Single-instance protection is enforced by an OS-level lock file shared by
REM       every launch path (WebUI and main daemon):
REM         Windows: %LOCALAPPDATA%\KuguaStudio\studio.lock
REM         other:   ~/.kugua-studio/studio.lock (or $XDG_RUNTIME_DIR/kugua-studio)
REM       The lock path does NOT depend on cwd, config or KUGUA_DATA_DIR, so changing
REM       the port / config / data dir cannot bypass it. A second instance exits
REM       automatically. Port conflicts are reported as "port already in use by
REM       another program" and never mistaken for an existing Studio instance.

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

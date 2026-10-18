@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d %~dp0

REM KuguaStudio / WebUI launcher
REM
REM Note: no port-based taskkill (the old version would kill a running instance).
REM       Single-instance protection is enforced by an OS-level lock file shared by
REM       every launch path (WebUI and main daemon):
REM         Windows: %LOCALAPPDATA%\KuguaStudio\studio.lock
REM         other:   ~/.kugua-studio/studio.lock (or $XDG_RUNTIME_DIR/kugua-studio)
REM       The lock path does NOT depend on cwd, config or KUGUA_DATA_DIR, so changing
REM       the port / config / data dir cannot bypass it. A second instance exits
REM       automatically. Port conflicts are reported as "port already in use by
REM       another program" and never mistaken for an existing Studio instance.
REM
REM GUI mode is chosen by "webui.gui" in kugua.config.json:
REM       "desktop"  -> Tauri desktop shell (its own window, no browser involved)
REM       "browser"  -> open the WebUI in the default browser
REM Unset defaults to "desktop" when the shell is built, otherwise "browser".
REM Override without editing the config:  set KUGUA_GUI=browser  (or desktop)

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

REM -- Resolve GUI mode --
REM    KUGUA_GUI env var wins; otherwise read webui.gui from the config.
REM    The config may contain credentials and is not valid for plain "findstr",
REM    so let node parse it and print just the value.
set "GUI_MODE=%KUGUA_GUI%"
if not defined GUI_MODE (
    for /f "delims=" %%i in ('node -e "try{const c=require('./kugua.config.json');process.stdout.write(String(c.webui&&c.webui.gui||''))}catch(e){}" 2^>nul') do set "GUI_MODE=%%i"
)

set "DESKTOP_EXE="
REM Must be an ABSOLUTE path. "start" resolves relative paths against its own
REM working directory rather than the script's, and when start.bat is invoked via
REM "cmd /c" that directory is not the repo root. The failure is silent: start
REM still exits 0 and nothing appears to happen.
if exist "%~dp0packages\desktop\src-tauri\target\release\kugua-desktop.exe" set "DESKTOP_EXE=%~dp0packages\desktop\src-tauri\target\release\kugua-desktop.exe"
if not defined DESKTOP_EXE if exist "%~dp0packages\desktop\src-tauri\target\debug\kugua-desktop.exe" set "DESKTOP_EXE=%~dp0packages\desktop\src-tauri\target\debug\kugua-desktop.exe"

REM Default: desktop when built, browser otherwise.
if not defined GUI_MODE (
    if defined DESKTOP_EXE (set "GUI_MODE=desktop") else (set "GUI_MODE=browser")
)

if /i "!GUI_MODE!"=="desktop" goto :desktop
if /i "!GUI_MODE!"=="browser" goto :browser

echo [WARN] Unknown webui.gui value "!GUI_MODE!" (expected "desktop" or "browser").
if defined DESKTOP_EXE (set "GUI_MODE=desktop") else (set "GUI_MODE=browser")
echo        Falling back to "!GUI_MODE!".
if /i "!GUI_MODE!"=="desktop" goto :desktop
goto :browser

:desktop
REM -- Desktop shell (Tauri) --
REM    The shell enforces its own single instance: if a window already exists,
REM    the newly started process activates that window and exits immediately.
REM    So running start.bat again brings the existing window to the front
REM    instead of piling up extra windows.
if defined DESKTOP_EXE (
    start "" "!DESKTOP_EXE!"
    exit /b 0
)
echo [INFO] webui.gui is "desktop" but the desktop shell is not built yet.
echo        Build it with: node packages\desktop\scripts\build.mjs
echo        Falling back to the browser for now.
goto :browser

:browser
REM -- Browser-based WebUI --
REM    The server has its own single-instance lock. If Studio is already running
REM    it exits early and opens nothing, so we must not spawn a second browser tab.
REM    Check the port first: if something is already listening, just open the URL.
set "WEBUI_PORT=24600"
for /f "delims=" %%i in ('node -e "try{const c=require('./kugua.config.json');process.stdout.write(String((c.webui&&c.webui.port)||process.env.KUGUA_WEBUI_PORT||24600))}catch(e){process.stdout.write('24600')}" 2^>nul') do set "WEBUI_PORT=%%i"

netstat -ano | findstr /r /c:"127.0.0.1:!WEBUI_PORT! .*LISTENING" >nul 2>nul
if !errorlevel! equ 0 (
    REM Already running: do NOT open another tab. The browser tab from the first
    REM launch is still there (the page auto-reconnects), and opening the URL
    REM again would pile up duplicate tabs (one per double-clicked start.bat).
    echo [INFO] Studio is already running on port !WEBUI_PORT!.
    echo        Switch to the existing browser tab, or open http://127.0.0.1:!WEBUI_PORT!/ manually.
    exit /b 0
)

echo [INFO] Starting the WebUI in the default browser...
powershell -NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -Command "Set-Location '%~dp0'; $p = Start-Process 'node' -ArgumentList '\"%~dp0packages\webui\dist\server.js\"' -WorkingDirectory '%~dp0' -WindowStyle Hidden -PassThru; $p.Id | Out-File -Encoding ascii '.kugua.pid'"

exit /b 0

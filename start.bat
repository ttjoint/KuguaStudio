@echo off
setlocal
chcp 65001 >nul
cd /d %~dp0

REM KuguaStudio / WebUI 启动器
REM 说明：不再按端口结束进程（旧实现会误杀用户正在运行的平台实例）。
REM       单实例保护由 WebUI 自身负责（data/webui.lock）：已有存活实例时新进程自动退出。

REM -- 检查 Node.js --
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)

REM -- 首次运行需要构建 --
if not exist "packages\webui\dist\server.js" (
    echo [BUILD] Building...
    call npm run build
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
)

REM -- 后台启动 WebUI --
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Set-Location '%~dp0'; Start-Process 'node' -ArgumentList 'packages\webui\dist\server.js' -WindowStyle Hidden"

exit /b 0

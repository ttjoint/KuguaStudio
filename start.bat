@echo off
setlocal
chcp 65001 >nul
cd /d %~dp0

REM 苦瓜工作室启动脚本（隐藏黑框版）
REM 直接以 GUI 子系统方式启动 electron.exe，不产生控制台黑框

REM -- 检测 Node.js --
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)

REM -- 释放 24601 端口，避免残留主控导致重复启动 --
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":24601" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)

REM -- 若 GUI 未构建，先构建（输出写入 build.log） --
if not exist "packages\gui\dist\main.js" (
    echo [BUILD] Building GUI...
    call npm run build > build.log 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed. See build.log
        pause
        exit /b 1
    )
)

REM -- 隐藏启动 electron.exe（GUI 子系统，无黑框；隐藏 PowerShell 本身） --
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Set-Location '%~dp0packages\gui'; Start-Process '%~dp0node_modules\electron\dist\electron.exe' -ArgumentList '.'"

exit /b 0
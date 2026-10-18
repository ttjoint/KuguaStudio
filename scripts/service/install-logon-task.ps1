<#
  注册「登录时自动启动苦瓜工作室 WebUI」的 Windows 计划任务。
  无需第三方服务包装器；任务在用户登录后隐藏启动 WebUI（由 WebUI 托管主控与模块）。

  用法（管理员或当前用户均可）：
    powershell -ExecutionPolicy RemoteSigned -File scripts\service\install-logon-task.ps1
  自定义任务名：
    powershell -ExecutionPolicy RemoteSigned -File scripts\service\install-logon-task.ps1 -TaskName KuguaStudio
#>
param(
  [string]$TaskName = "KuguaStudio",
  [int]$Port = 24600
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Server = Join-Path $Root "packages\webui\dist\server.js"
if (-not (Test-Path $Server)) {
  throw "未找到 WebUI 入口：$Server`n请先在项目根执行 npm run build"
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  throw "未找到 node，请确认已安装并加入 PATH"
}

$env:KUGUA_WEBUI_PORT = "$Port"
$Action = New-ScheduledTaskAction -Execute $Node -Argument "`"$Server`" --no-open" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName `
  -Action $Action -Trigger $Trigger -Settings $Settings `
  -Description "苦瓜工作室 WebUI（登录时自动启动，端口 $Port）" -Force | Out-Null

Write-Host "已注册计划任务：$TaskName"
Write-Host "  登录后自动启动：$Node `"$Server`" --no-open"
Write-Host "  WebUI 地址：http://127.0.0.1:$Port"
Write-Host "  如需立即启动：Start-ScheduledTask -TaskName $TaskName"

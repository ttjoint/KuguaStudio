<#
  移除由 install-logon-task.ps1 注册的登录自动启动任务。

  用法：
    powershell -ExecutionPolicy RemoteSigned -File scripts\service\uninstall-logon-task.ps1
#>
param(
  [string]$TaskName = "KuguaStudio"
)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "已移除计划任务：$TaskName（若存在）"

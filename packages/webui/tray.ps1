param(
  [string]$Url = "http://127.0.0.1:24600",
  [int]$ServerPid = 0,
  [string]$Root = "",
  [string]$IconPath = "",
  [string]$LogPath = ""
)

function 写日志([string]$消息) {
  if (-not $LogPath) { return }
  try {
    $行 = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $消息
    Add-Content -Path $LogPath -Value $行 -Encoding UTF8
  } catch { }
}

# 苦瓜工作室 系统托盘：左键打开 WebUI；右键菜单：打开 / 开机启动 / 退出
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  写日志 "托盘启动：url=$Url pid=$ServerPid root=$Root"

  $icon = $null
  try {
    if ($IconPath -and (Test-Path $IconPath)) {
      $bmp = New-Object System.Drawing.Bitmap($IconPath)
      $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    }
  } catch { 写日志 "图标加载失败：$_" }

  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Text = "苦瓜工作室"
  if ($icon) { $notify.Icon = $icon } else { $notify.Icon = [System.Drawing.SystemIcons]::Application }
  $notify.Visible = $true

  $打开 = New-Object System.Windows.Forms.MenuItem("打开")
  $打开.add_Click({ try { Start-Process $Url } catch { 写日志 "打开失败：$_" } })

  $任务名 = "KuguaStudio"
  function 任务存在() {
    $null = schtasks /Query /TN $任务名 2>$null
    return $LASTEXITCODE -eq 0
  }

  $开机 = New-Object System.Windows.Forms.MenuItem("开机启动")
  $开机.Checked = 任务存在
  $开机.add_Click({
    try {
      if (任务存在) {
        schtasks /Delete /TN $任务名 /F | Out-Null
        $开机.Checked = $false
        写日志 "已取消开机启动"
      } else {
        $脚本 = Join-Path $Root "scripts\service\install-logon-task.ps1"
        if (Test-Path $脚本) {
          & powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $脚本 | Out-Null
          $开机.Checked = 任务存在
          写日志 "已设置开机启动：$($开机.Checked)"
        } else {
          [System.Windows.Forms.MessageBox]::Show("未找到安装脚本：$脚本", "苦瓜工作室") | Out-Null
        }
      }
    } catch { 写日志 "开机启动切换失败：$_" }
  })

  $退出 = New-Object System.Windows.Forms.MenuItem("退出")
  $退出.add_Click({
    try {
      if ($ServerPid -gt 0) { taskkill /PID $ServerPid /T /F | Out-Null }
    } catch { 写日志 "退出失败：$_" }
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
  })

  $menu = New-Object System.Windows.Forms.ContextMenu
  [void]$menu.MenuItems.Add($打开)
  [void]$menu.MenuItems.Add($开机)
  [void]$menu.MenuItems.Add("-")
  [void]$menu.MenuItems.Add($退出)
  $notify.ContextMenu = $menu

  $notify.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
      try { Start-Process $Url } catch { }
    }
  })

  写日志 "托盘就绪，进入消息循环"

  # 看门狗：若服务进程已退出，托盘自动退出，避免残留图标
  if ($ServerPid -gt 0) {
    $script:看门狗 = New-Object System.Windows.Forms.Timer
    $script:看门狗.Interval = 5000
    $script:看门狗.add_Tick({
      if (-not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) {
        $script:看门狗.Stop()
        写日志 "服务进程已退出，托盘自动退出"
        $notify.Visible = $false
        $notify.Dispose()
        [System.Windows.Forms.Application]::Exit()
      }
    })
    $script:看门狗.Start()
  }

  [System.Windows.Forms.Application]::Run()
  写日志 "托盘退出"
} catch {
  写日志 "托盘异常：$_"
}

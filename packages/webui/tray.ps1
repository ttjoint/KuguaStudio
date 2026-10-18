param(
  [string]$Url = "http://127.0.0.1:24600",
  [int]$ServerPid = 0,
  [string]$Root = "",
  [string]$IconPath = "",
  [string]$LogPath = "",
  [string]$DesktopExe = ""
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

  # 两个入口分别对应两种显示层，名字必须一眼能分清用的是什么：
  #   网页端 = 用默认浏览器打开（依赖用户装的 Chrome/Edge）
  #   桌面端 = Tauri 壳（独立窗口，用系统 WebView2，不受浏览器影响）
  $打开网页 = New-Object System.Windows.Forms.MenuItem("打开网页端（浏览器）")
  $打开网页.add_Click({ try { Start-Process $Url } catch { 写日志 "打开网页失败：$_" } })

  $打开桌面 = New-Object System.Windows.Forms.MenuItem("打开桌面端")
  $打开桌面.add_Click({
    try {
      if ($DesktopExe -and (Test-Path $DesktopExe)) {
        Start-Process $DesktopExe
      } else {
        [System.Windows.Forms.MessageBox]::Show(
          "未找到桌面端程序。`n`n请先构建：node packages\desktop\scriptsuild.mjs`n`n路径：$DesktopExe",
          "苦瓜工作室") | Out-Null
      }
    } catch { 写日志 "打开桌面端失败：$_" }
  })
  # 没构建桌面端时置灰，避免用户点了没反应还不知道为什么
  if (-not ($DesktopExe -and (Test-Path $DesktopExe))) { $打开桌面.Enabled = $false }

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
          & powershell -NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File $脚本 | Out-Null
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
      # 必须走 /api/shutdown，**不能**直接 Stop-Process -Force。
      #
      # 强杀会让主控来不及广播 system.shutdown：
      #   - 运行中接入的外部程序收不到退出通知（它们不受平台托管，
      #     只能靠这条消息决定要不要退）
      #   - 审计与日志来不及落盘
      # 这和设置页「退出平台」按钮的行为不一致——同一个动作两个结果。
      #
      # 先请求优雅关闭，等它自己退；超时或失败才回退强杀。
      $done = $false
      try {
        $null = Invoke-WebRequest -Uri "$Url/api/shutdown" -Method POST -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        $done = $true
        写日志 "已请求优雅退出"
      } catch { 写日志 "优雅退出请求失败：$_"; }

      if ($done -and $ServerPid -gt 0) {
        # 最多等 10 秒，让主控广播完并收掉托管模块
        for ($i = 0; $i -lt 40; $i++) {
          Start-Sleep -Milliseconds 250
          if (-not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) { break }
        }
      }
      # 兜底：还在就强杀（用 Stop-Process 而非 taskkill /F，杀软更温和）
      if ($ServerPid -gt 0) {
        Stop-Process -Id $ServerPid -Force -ErrorAction SilentlyContinue
      }
    } catch { 写日志 "退出失败：$_" }
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
  })

  $menu = New-Object System.Windows.Forms.ContextMenu
  [void]$menu.MenuItems.Add($打开桌面)
  [void]$menu.MenuItems.Add($打开网页)
  [void]$menu.MenuItems.Add($开机)
  [void]$menu.MenuItems.Add("-")
  [void]$menu.MenuItems.Add($退出)
  $notify.ContextMenu = $menu

  # 左键单击：有桌面端就用桌面端（体验更好），否则退回浏览器
  $notify.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
      try {
        if ($DesktopExe -and (Test-Path $DesktopExe)) {
          # 桌面端自带单例：已在运行会唤到前台，不会开第二个窗口
          Start-Process $DesktopExe
        } else {
          Start-Process $Url
        }
      } catch { 写日志 "左键打开失败：$_" }
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

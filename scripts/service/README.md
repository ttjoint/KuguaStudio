# 常驻与开机自启

把苦瓜工作室设为常驻后台，并在登录/开机后自动运行。提供两种方式，按需选用。

## 方式一：Windows 计划任务（推荐，无需第三方程序）

登录后隐藏启动 WebUI；WebUI 会托管主控与全部模块。

```powershell
# 注册（当前用户登录时启动）
powershell -ExecutionPolicy Bypass -File scripts\service\install-logon-task.ps1

# 立即启动一次
Start-ScheduledTask -TaskName KuguaStudio

# 移除
powershell -ExecutionPolicy Bypass -File scripts\service\uninstall-logon-task.ps1
```

- 端口可用 `-Port` 指定（默认 24600）：`... -Port 24600`
- 任务以当前用户身份运行，`node` 需在 PATH 中。
- 计划任务配置了崩溃重启（3 次 / 间隔 1 分钟）。

## 方式二：WinSW 注册为真正的服务（无用户登录也运行）

1. 下载 [WinSW](https://github.com/winsw/winsw/releases)，重命名为 `kugua-webui.exe` 放到项目根；
2. 复制 `scripts/service/kugua-webui.xml` 到项目根（与 exe 同目录）；
3. 管理员执行：
   ```
   .\kugua-webui.exe install
   .\kugua-webui.exe start
   ```
4. 卸载：`.\kugua-webui.exe stop` 然后 `.\kugua-webui.exe uninstall`。

## 开机 / 登录时执行一次性任务

调度模块支持 `触发: "startup"` 的任务：平台启动后执行一次。

- 中文指令：`添加启动任务 <名称> <模块> <动作>`
  例：`添加启动任务 每日索引 mkg fts.rebuild`
- 或用 `scheduler.task.create`，参数带 `触发: "startup"`：
  ```jsonc
  { "name": "启动自检", "触发": "startup",
    "action": { "kind": "request", "to": "monitor", "action": "monitor.stats" } }
  ```
- startup 任务不参与 cron 排程；模块每次启动会执行一次。

## 日志

- 主控日志：内存环形缓冲（默认 4000 条）+ 限流落盘 `data/logs/main.log`（仅在有内容时写，空闲不写盘）。
- 查询：`nigane` 的 `log.tail` / `log.stats` / `log.clear`；`log.tail` 支持按模块（如 `mkg`）、级别、关键词、时间过滤。
- 作业日志：`data/jobs/<id>.log`，见《架构设计.md》第五节。
- 可覆盖日志文件路径：环境变量 `KUGUA_LOG_FILE`。

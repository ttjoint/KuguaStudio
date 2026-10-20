/**
 * 定时调度模块的配置声明。
 *
 * 落到 `kugua.config.json` 的 `scheduler` 节：
 *
 *   { "scheduler": { "dataFile": "...", "commandShell": "..." } }
 *
 * 定时任务会执行本地命令，所以「用哪个 shell 跑命令」是个安全相关的选择，
 * 不能只靠默认值糊过去——不同 shell 的引号/转义规则不同，
 * 用户在别处验证过的命令换个 shell 就可能不按预期执行。
 */

import type { 配置声明 } from "@kugua/nigane";

export const 调度配置声明: 配置声明 = {
  说明:
    "定时任务调度。改动需要重启 scheduler 模块才生效（任务文件在启动时加载）。",
  字段: [
    {
      键: "dataFile",
      标题: "任务文件",
      类型: "path",
      提示: "data/scheduler/tasks.json",
      说明:
        "定时任务的持久化位置（JSON）。相对路径以平台工作目录为基准。" +
        "⚠️ 改动后需重启 scheduler 模块。指向已有文件即接续那边的任务。",
    },
    {
      键: "commandShell",
      标题: "命令执行方式",
      类型: "select",
      默认值: "默认",
      选项: [
        { 值: "默认", 标题: "默认（Windows 用 cmd，其他用 sh）" },
        { 值: "powershell", 标题: "Windows PowerShell" },
        { 值: "pwsh", 标题: "PowerShell 7+" },
        { 值: "bash", 标题: "bash" },
        { 值: "sh", 标题: "sh" },
      ],
      说明:
        "定时任务里 `command` 动作使用的 shell。不同 shell 的引号与转义规则不同，" +
        "切换后请重新验证已有命令。选了本机不存在的 shell 会导致该任务执行失败。",
    },
    {
      键: "commandDir",
      标题: "命令工作目录",
      类型: "path",
      提示: "（留空 = 平台工作目录）",
      说明:
        "定时任务里 `command` 动作的工作目录。留空则用平台工作目录。" +
        "相对路径以平台工作目录为基准。⚠️ 改动后需重启 scheduler 模块。",
    },
  ],
};

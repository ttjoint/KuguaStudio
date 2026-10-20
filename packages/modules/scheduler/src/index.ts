/**
 * 定时任务调度模块（M4）
 * 按 cron 表达式定时触发：向模块发请求 / 广播事件 / 执行本地命令。
 * 任务持久化于 data/scheduler/tasks.json。
 *
 * 启动样板（读配置 / 连主控 / 处理退出）已收敛到 @kugua/module-kit。
 */

import { resolve } from "node:path";
import { 启动模块 } from "@kugua/module-kit";
import { 任务调度器 } from "./scheduler.js";
import { 创建动作执行者, 默认数据路径, 注册调度处理器, 任务存储, 设置命令Shell, 设置命令工作目录 } from "./handlers.js";
import { 调度配置声明 } from "./declaration.js";

let 调度器: 任务调度器 | null = null;
/** 任务文件路径（读配置阶段确定，注册时使用） */
let 任务文件: string | null = null;

void 启动模块({
  name: "scheduler",
  version: "0.7.0",
  配置声明: 调度配置声明,
  读配置: (文件配置) => {
    const 节 = (文件配置.scheduler ?? {}) as { dataFile?: string; commandShell?: string; commandDir?: string };
    任务文件 = 节.dataFile ? resolve(process.cwd(), 节.dataFile) : 默认数据路径();
    设置命令Shell(节.commandShell);
    设置命令工作目录(节.commandDir ? resolve(process.cwd(), 节.commandDir) : process.cwd());
    return {};
  },
  注册: (客户端) => {
    const 存储 = new 任务存储(任务文件 ?? 默认数据路径());
    调度器 = new 任务调度器(存储, 创建动作执行者(客户端), (任务, 结果) => {
      客户端.sendEvent("scheduler.task.ran", {
        id: 任务.id,
        name: 任务.name,
        ok: 结果.ok,
        message: 结果.message,
        time: 结果.time,
      });
    });
    调度器.load();
    注册调度处理器(客户端, 调度器);
  },
  就绪: (_客户端, _配置, 连接) => {
    console.log(`[调度] 已接入主控：${连接.url}`);
    调度器?.start();
  },
  关闭: () => {
    console.log("[调度] 主控退出，保存任务并结束进程");
    调度器?.stop();
  },
});

/**
 * 定时任务调度模块（M4）
 * 按 cron 表达式定时触发：向模块发请求 / 广播事件 / 执行本地命令。
 * 任务持久化于 data/scheduler/tasks.json。
 *
 * 启动样板（读配置 / 连主控 / 处理退出）已收敛到 @kugua/module-kit。
 */

import { 启动模块 } from "@kugua/module-kit";
import { 任务调度器 } from "./scheduler.js";
import { 创建动作执行者, 默认数据路径, 注册调度处理器, 任务存储 } from "./handlers.js";

let 调度器: 任务调度器 | null = null;

void 启动模块({
  name: "scheduler",
  version: "0.6.0",
  capabilities: [
    "scheduler.task.create",
    "scheduler.task.list",
    "scheduler.task.runNow",
    "scheduler.actions",
  ],
  注册: (客户端) => {
    const 存储 = new 任务存储(默认数据路径());
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

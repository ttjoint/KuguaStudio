/**
 * 定时任务调度模块（M4）
 * 按 cron 表达式定时触发：向模块发请求 / 广播事件 / 执行本地命令。
 * 任务持久化于 data/scheduler/tasks.json。
 * 用法：node dist/index.js [主控地址] [token]
 */

import { NiganeClient } from "@kugua/nigane";
import { 任务调度器 } from "./scheduler.js";
import { 创建动作执行者, 默认数据路径, 注册调度处理器, 任务存储 } from "./handlers.js";

const 地址 = process.env.NIGANE_URL ?? process.argv[2] ?? "ws://127.0.0.1:24601";
const 令牌 = process.env.NIGANE_TOKEN ?? process.argv[3] ?? "";

const 客户端 = new NiganeClient({
  name: "scheduler",
  url: 地址,
  token: 令牌,
  version: "0.6.0",
  capabilities: ["scheduler.task.create", "scheduler.task.list", "scheduler.task.runNow"],
});

const 存储 = new 任务存储(默认数据路径());
const 调度器 = new 任务调度器(存储, 创建动作执行者(客户端), (任务, 结果) => {
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

客户端.on("shutdown", () => {
  console.log("[调度] 主控退出，保存任务并结束进程");
  调度器.stop();
  客户端.close();
  process.exit(0);
});

客户端.on("close", () => {
  console.log("[调度] 与主控的连接已断开");
  process.exit(0);
});

客户端
  .connect()
  .then(() => {
    console.log(`[调度] 已接入主控：${地址}`);
    调度器.start();
  })
  .catch((err: unknown) => {
    console.error("[调度] 接入失败：", err);
    process.exit(1);
  });

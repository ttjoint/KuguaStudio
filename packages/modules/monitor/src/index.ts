/**
 * 系统监控模块
 * 提供 monitor.stats（CPU/内存/磁盘快照）与 monitor.watch（周期广播）。
 * 用法：node dist/index.js [主控地址] [token]
 */

import { NiganeClient } from "@kugua/nigane";
import { 注册监控处理器 } from "./handlers.js";

const 地址 = process.env.NIGANE_URL ?? process.argv[2] ?? "ws://127.0.0.1:24601";
const 令牌 = process.env.NIGANE_TOKEN ?? process.argv[3] ?? "";

const 客户端 = new NiganeClient({
  name: "monitor",
  url: 地址,
  token: 令牌,
  version: "0.6.0",
  capabilities: ["monitor.stats", "monitor.watch"],
});

const 清理 = 注册监控处理器(客户端);

客户端.on("shutdown", () => {
  console.log("[监控] 主控退出，结束本进程");
  清理();
  客户端.close();
  process.exit(0);
});

客户端.on("close", () => {
  console.log("[监控] 与主控的连接已断开");
  process.exit(0);
});

客户端
  .connect()
  .then(() => console.log(`[监控] 已接入主控：${地址}`))
  .catch((err: unknown) => {
    console.error("[监控] 接入失败：", err);
    process.exit(1);
  });

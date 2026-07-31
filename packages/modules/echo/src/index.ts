/**
 * echo 示例模块
 * 注册 "echo" 能力：将收到的请求参数原样返回。
 * 用法：node dist/index.js [主控地址] [token]
 */

import { NiganeClient } from "@kugua/nigane";

const 地址 = process.env.NIGANE_URL ?? process.argv[2] ?? "ws://127.0.0.1:24601";
const 令牌 = process.env.NIGANE_TOKEN ?? process.argv[3] ?? "";

const 客户端 = new NiganeClient({
  name: "echo",
  url: 地址,
  token: 令牌,
  version: "0.1.0",
  capabilities: ["echo"],
});

客户端.onRequest("echo", (params) => params);

客户端.on("shutdown", () => {
  console.log("[echo] 主控退出，结束本进程");
  客户端.close();
  process.exit(0);
});

客户端.on("close", () => {
  console.log("[echo] 与主控的连接已断开");
  process.exit(0);
});

客户端
  .connect()
  .then(() => console.log(`[echo] 已接入主控：${地址}`))
  .catch((err: unknown) => {
    console.error("[echo] 接入失败：", err);
    process.exit(1);
  });

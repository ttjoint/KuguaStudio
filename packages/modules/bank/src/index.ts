/**
 * 积分系统模块（P3）
 * 本地账户与马币：签到低保、转账、充值、捐款、排行榜与流水（复刻参考项目 ModBank）。
 * 数据持久化于 data/bank/（可用 KUGUA_BANK_DATA 覆盖）。
 * 用法：node dist/index.js [主控地址] [token]
 */

import { NiganeClient } from "@kugua/nigane";
import { 银行 } from "./bank.js";
import { 银行存储 } from "./store.js";
import { 注册银行处理器 } from "./handlers.js";

const 地址 = process.env.NIGANE_URL ?? process.argv[2] ?? "ws://127.0.0.1:24601";
const 令牌 = process.env.NIGANE_TOKEN ?? process.argv[3] ?? "";

const 客户端 = new NiganeClient({
  name: "bank",
  url: 地址,
  token: 令牌,
  version: "0.6.0",
  capabilities: [
    "bank.balance",
    "bank.sign",
    "bank.transfer",
    "bank.grant",
    "bank.donate",
    "bank.rank",
    "bank.ledger",
    "bank.status",
  ],
});

const 银行实例 = new 银行(new 银行存储());
银行实例.load();
注册银行处理器(客户端, 银行实例);

客户端.on("shutdown", () => {
  console.log("[银行] 主控退出，结束本进程");
  客户端.close();
  process.exit(0);
});

客户端.on("close", () => {
  console.log("[银行] 与主控的连接已断开");
  process.exit(0);
});

客户端
  .connect()
  .then(() => console.log("[银行] 已接入主控（积分系统就绪）"))
  .catch((err: unknown) => {
    console.error("[银行] 接入失败：", err);
    process.exit(1);
  });

/**
 * 积分系统模块的苦音处理器。
 */

import type { NiganeClient } from "@kugua/nigane";
import { 银行 } from "./bank.js";

export function 注册银行处理器(客户端: NiganeClient, 银行实例: 银行): void {
  客户端.onRequest("bank.balance", (参数) => {
    const p = (参数 ?? {}) as { user?: string; name?: string };
    const 账户 = 银行实例.getOrCreate(p.user ?? "local", p.name);
    return { 账户, unit: 银行实例.status().unit };
  });

  客户端.onRequest("bank.sign", (参数) => {
    const p = (参数 ?? {}) as { user?: string; name?: string };
    return 银行实例.签到(p.user ?? "local", p.name);
  });

  客户端.onRequest("bank.transfer", (参数) => {
    const p = (参数 ?? {}) as { from?: string; to?: string; amount?: number; reason?: string };
    if (typeof p.to !== "string" || !p.to.trim()) throw new Error("缺少 to");
    return 银行实例.转账(p.from ?? "local", p.to.trim(), Number(p.amount), p.reason);
  });

  客户端.onRequest("bank.grant", (参数) => {
    const p = (参数 ?? {}) as { user?: string; name?: string; amount?: number };
    return 银行实例.充值(p.user ?? "local", Number(p.amount), p.name);
  });

  客户端.onRequest("bank.donate", (参数) => {
    const p = (参数 ?? {}) as { user?: string; amount?: number };
    return 银行实例.捐款(p.user ?? "local", Number(p.amount));
  });

  客户端.onRequest("bank.rank", (参数) => {
    const p = (参数 ?? {}) as { order?: string; limit?: number };
    return { list: 银行实例.排行(p.order === "poor" ? "poor" : "rich", p.limit ?? 10), unit: 银行实例.status().unit };
  });

  客户端.onRequest("bank.ledger", (参数) => {
    const p = (参数 ?? {}) as { user?: string; limit?: number };
    return { list: 银行实例.流水(p.user, p.limit ?? 50), unit: 银行实例.status().unit };
  });

  客户端.onRequest("bank.status", () => 银行实例.status());
}

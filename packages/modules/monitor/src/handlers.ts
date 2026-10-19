/**
 * 监控模块的苦音处理器：monitor.stats 按需快照、monitor.watch 周期广播。
 */

import type { NiganeClient } from "@kugua/nigane";
import { 采集快照 } from "./system.js";
import { 归一间隔 } from "./calc.js";

/** 注册监控动作；返回清理函数（停止周期广播） */
export function 注册监控处理器(客户端: NiganeClient): () => void {
  let 定时器: NodeJS.Timeout | null = null;

  客户端.onRequest("monitor.stats", () => 采集快照());
  客户端.onRequest("monitor.watch", async (参数) => {
    const p = (参数 ?? {}) as { enabled?: boolean; intervalSec?: number };
    if (定时器) {
      clearInterval(定时器);
      定时器 = null;
    }
    if (p.enabled === false) return { watching: false };
    const 间隔 = 归一间隔(p.intervalSec, 10);
    定时器 = setInterval(() => {
      void 广播();
    }, 间隔 * 1000);
    return { watching: true, intervalSec: 间隔 };
  });

  async function 广播(): Promise<void> {
    try {
      客户端.sendEvent("monitor.stats", await 采集快照());
    } catch (err) {
      console.warn("[监控] 采样失败：", err);
    }
  }

  return () => {
    if (定时器) {
      clearInterval(定时器);
      定时器 = null;
    }
  };
}

/**
 * 调度模块的苦音处理器与动作执行者（与网络/文件系统相关的接线层）。
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { NiganeClient } from "@kugua/nigane";
import { 任务调度器 } from "./scheduler.js";
import { 任务存储 } from "./store.js";
import type { 任务动作, 任务结果, 定时任务 } from "./types.js";

/** 任务数据文件路径（可用环境变量覆盖，便于测试） */
export function 默认数据路径(): string {
  return process.env.KUGUA_SCHEDULER_DATA ?? resolve(process.cwd(), "data/scheduler/tasks.json");
}

/** 创建动作执行者：request → 经苦音请求；event → 广播；command → 本地执行 */
export function 创建动作执行者(客户端: NiganeClient): (动作: 任务动作) => Promise<任务结果> {
  return async (动作) => {
    switch (动作.kind) {
      case "request": {
        const data = await 客户端.request(动作.to, 动作.action, 动作.params, 动作.timeoutMs ?? 10000);
        return { ok: true, message: JSON.stringify(data), time: Date.now() };
      }
      case "event": {
        客户端.sendEvent(动作.action, 动作.params);
        return { ok: true, message: `已广播事件 ${动作.action}`, time: Date.now() };
      }
      case "command": {
        return await 执行命令(动作.command, 动作.args ?? [], 动作.timeoutMs ?? 30000);
      }
      default:
        throw new Error(`未知动作类型：${JSON.stringify(动作)}`);
    }
  };
}

function 执行命令(command: string, args: string[], timeoutMs: number): Promise<任务结果> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { cwd: process.cwd(), shell: true, windowsHide: true });
    let 输出 = "";
    const 定时 = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);
    proc.stdout?.on("data", (b: Buffer) => {
      输出 += b.toString();
    });
    proc.stderr?.on("data", (b: Buffer) => {
      输出 += b.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(定时);
      resolve({ ok: false, message: err.message, time: Date.now() });
    });
    proc.on("close", (code) => {
      clearTimeout(定时);
      resolve({
        ok: code === 0,
        message: 输出.trim() || (code === 0 ? "命令执行完成" : `命令退出码 ${code}`),
        time: Date.now(),
      });
    });
  });
}

function 取标识(参数: unknown): string {
  const p = (参数 ?? {}) as { id?: string; name?: string };
  const 标识 = p.id ?? p.name;
  if (typeof 标识 !== "string" || !标识.trim()) throw new Error("缺少 id 或 name");
  return 标识.trim();
}

function 取任务(调度器: 任务调度器, 参数: unknown): 定时任务 {
  const 任务 = 调度器.get(取标识(参数));
  if (!任务) throw new Error("定时任务不存在");
  return 任务;
}

/** 注册调度模块的全部苦音动作 */
export function 注册调度处理器(客户端: NiganeClient, 调度器: 任务调度器): void {
  客户端.onRequest("scheduler.task.create", (参数) => 调度器.create(参数 as Parameters<任务调度器["create"]>[0]));
  客户端.onRequest("scheduler.task.list", () => 调度器.list());
  客户端.onRequest("scheduler.task.get", (参数) => 取任务(调度器, 参数));
  客户端.onRequest("scheduler.task.update", (参数) => {
    const p = (参数 ?? {}) as { id?: string; name?: string; cron?: string; enabled?: boolean; 触发?: "cron" | "startup" } & Partial<Parameters<任务调度器["update"]>[1]>;
    return 调度器.update(取标识(参数), {
      name: p.name,
      cron: p.cron,
      action: p.action,
      enabled: p.enabled,
      触发: p.触发,
    });
  });
  客户端.onRequest("scheduler.task.delete", (参数) => 调度器.remove(取标识(参数)));
  客户端.onRequest("scheduler.task.enable", (参数) => {
    const p = (参数 ?? {}) as { enabled?: boolean };
    return 调度器.setEnabled(取标识(参数), p.enabled !== false);
  });
  客户端.onRequest("scheduler.task.runNow", (参数) => 调度器.runNow(取标识(参数)));
  客户端.onRequest("scheduler.status", () => 调度器.status());

  // 可选任务动作：来自能力注册表（入口=定时），供 WebUI/命令列出候选
  客户端.onRequest("scheduler.actions", async () => {
    const 能力 = (await 客户端.request("nigane", "capability.list", { 入口: "定时" })) as Array<{
      名称: string;
      模块: string;
      动作?: string;
      标题?: string;
      说明?: string;
      中文指令?: string[];
    }>;
    return (能力 ?? []).map((c) => ({
      名称: c.名称,
      模块: c.模块,
      动作: c.动作 ?? c.名称,
      标题: c.标题,
      说明: c.说明,
      中文指令: c.中文指令 ?? [],
    }));
  });
}

export { 任务存储 };

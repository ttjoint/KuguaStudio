/**
 * 调度模块的苦音处理器与动作执行者（与网络/文件系统相关的接线层）。
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { NiganeClient } from "@kugua/nigane";
import { 任务调度器 } from "./scheduler.js";
import { 任务存储 } from "./store.js";
import type { 任务动作, 任务结果, 定时任务 } from "./types.js";

/** 强制转作业的动作：这些动作本来就是长任务，同步等返回值只会等到超时 */
export const 强制作业动作 = ["job.start", "job.rerun", "job.continue"];

/** GUI / 插件发起的普通长任务：直接调会阻塞，转成作业更合适 */
export const 建议作业动作 = ["image.batch"];

/**
 * 把一次 request 动作改写成「job.start + 能力名」。
 *
 * 为什么要在这里改写而不是让用户自己写 job.start：定时任务的作者
 * 关心的是「几点跑什么能力」，不是「怎么把它包成子进程」。
 * 而且 `执行` 声明已经写在能力里了，再让作者手写一遍命令就是第二份真相。
 *
 * `发起者`/`来源` 一并带上：作业跑完后 `job.done` 推给谁靠它判断。
 */
export function 改写为作业(动作: { to: string; action: string; params?: unknown }): {
  to: "job";
  action: "job.start";
  params: { 能力名: string; 能力参数: unknown; 发起者: string; 来源: "scheduler" };
} {
  // 能力名 = `模块.动作`；scheduler 只认这个形式，写错成裸 `batch` 不猜。
  //
  // 已经带了模块前缀就不再拼：有人把 action 写成完整能力名（`image.batch`）
  // 是常见情况，不判一下就会得到 `image.image.batch`，报「能力不存在」。
  // 那个错误信息里两个 image 挨在一起，用户会以为是模块重名而不是自己写错了。
  const 能力名 = 动作.action.startsWith(`${动作.to}.`) ? 动作.action : `${动作.to}.${动作.action}`;
  return {
    to: "job",
    action: "job.start",
    params: { 能力名, 能力参数: 动作.params ?? {}, 发起者: `scheduler:${动作.to}`, 来源: "scheduler" },
  };
}

/** 任务数据文件路径（可用环境变量覆盖，便于测试） */
export function 默认数据路径(): string {
  return process.env.KUGUA_SCHEDULER_DATA ?? resolve(process.cwd(), "data/scheduler/tasks.json");
}

/**
 * 命令执行用的 shell。
 *
 * undefined = Node 的默认行为（Windows 用 cmd.exe，其他用 /bin/sh）；
 * 其余情况显式指定可执行文件。**不用 `shell: true`**，
 * 因为那样无法换 shell，而换个 shell 往往就是用户在别处验证过的命令
 * 在这边不按预期执行的原因。
 */
let 命令Shell: string | undefined = undefined;

/**
 * 命令动作的工作目录。
 *
 * 改造前这里写的是 `process.cwd()`——那是**主控拉模块时的目录**，
 * 与任务里的相对路径毫无关系。用户在配置里写了 `cd build` 之类的
 * 相对路径命令，就会在仓库根下默默创建 / 删除文件；用户以为跑在
 * 自己的项目目录里。现在由 `scheduler.commandDir` 显式指定，
 * 默认值只有一个地方（模块入口的读配置）。
 */
let 命令工作目录 = "";

/** 由模块入口按配置调用 */
export function 设置命令Shell(shell?: string): void {
  命令Shell = shell && shell !== "默认" ? shell : undefined;
}

/** 由模块入口按配置调用（传绝对路径） */
export function 设置命令工作目录(目录: string): void {
  命令工作目录 = 目录;
}

/** 创建动作执行者：request → 经苦音请求；event → 广播；command → 本地执行 */
export function 创建动作执行者(客户端: NiganeClient): (动作: 任务动作) => Promise<任务结果> {
  return async (动作) => {
    switch (动作.kind) {
      case "request": {
        // 长任务必须转作业：scheduler 的执行者没有会话也没有进度条，
        // 同步等 10 分钟的结果就是「指令运行超时」+ 一个还在后台跑的进程。
        const 命中强转 =
          强制作业动作.includes(动作.action) || 建议作业动作.includes(`${动作.to}.${动作.action}`);
        if (命中强转) {
          const 改写 = 改写为作业(动作);
          const 数据 = await 客户端.request("job", "job.start", 改写.params, 10000);
          return { ok: true, message: JSON.stringify(数据), time: Date.now() };
        }
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
    const proc = 命令Shell
      ? spawn(命令Shell, ["-c", [command, ...args].join(" ")], {
          cwd: 命令工作目录 || process.cwd(),
          windowsHide: true,
        })
      : spawn(command, args, { cwd: 命令工作目录 || process.cwd(), shell: true, windowsHide: true });
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

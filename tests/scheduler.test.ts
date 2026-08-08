/**
 * M4 定时任务调度：cron 解析 / 调度器核心 / 苦音总线集成 / 真实进程端到端
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { NiganeClient, NiganeServer, type 模块详情 } from "../packages/nigane/src/index.js";
import { Cron错误, 解析Cron, 下次运行 } from "../packages/modules/scheduler/src/cron.js";
import { 任务调度器 } from "../packages/modules/scheduler/src/scheduler.js";
import { 任务存储 } from "../packages/modules/scheduler/src/store.js";
import { 创建动作执行者, 注册调度处理器 } from "../packages/modules/scheduler/src/handlers.js";

let 端口序号 = 25300;
const 待关闭: Array<() => unknown> = [];
const 临时目录: string[] = [];

function 临时文件(前缀: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), 前缀));
  临时目录.push(dir);
  return resolve(dir, "tasks.json");
}

function 建调度器(): { 调度器: 任务调度器; 存储: 任务存储 } {
  const 存储 = new 任务存储(临时文件("kugua-sched-"));
  const 调度器 = new 任务调度器(存储, async () => ({ ok: true, message: "ok", time: Date.now() }));
  调度器.load();
  return { 调度器, 存储 };
}

async function 启动服务端(): Promise<{ server: NiganeServer; url: string }> {
  const port = ++端口序号;
  const server = new NiganeServer({ port });
  await server.start();
  待关闭.push(() => server.stop());
  return { server, url: `ws://127.0.0.1:${port}` };
}

async function 接入(url: string, name: string): Promise<NiganeClient> {
  const client = new NiganeClient({ name, url });
  await client.connect();
  待关闭.push(() => client.close());
  return client;
}

afterEach(async () => {
  while (待关闭.length) await 待关闭.pop()?.();
  while (临时目录.length) {
    const dir = 临时目录.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("cron 解析与下次运行时间", () => {
  it("5 段：每分钟、每日零点、每周一、工作日早上 8 点", () => {
    const 任意 = 解析Cron("* * * * *");
    expect(下次运行(任意, new Date(2026, 7, 8, 10, 0, 30).getTime())).toBe(
      new Date(2026, 7, 8, 10, 1, 0).getTime(),
    );

    const 午夜 = 解析Cron("0 0 * * *");
    expect(下次运行(午夜, new Date(2026, 7, 8, 10, 30, 15).getTime())).toBe(
      new Date(2026, 7, 9, 0, 0, 0).getTime(),
    );

    const 周一 = 解析Cron("0 0 * * 1");
    expect(下次运行(周一, new Date(2026, 7, 8, 12, 0, 0).getTime())).toBe(
      new Date(2026, 7, 10, 0, 0, 0).getTime(),
    );

    const 工作日八点 = 解析Cron("0 8 * * 1-5");
    expect(下次运行(工作日八点, new Date(2026, 7, 8, 8, 30, 0).getTime())).toBe(
      new Date(2026, 7, 10, 8, 0, 0).getTime(),
    );
  });

  it("6 段（带秒）：每秒、每 15 秒、正午 12:30、步长", () => {
    const 每秒 = 解析Cron("* * * * * *");
    const from = new Date(2026, 7, 8, 10, 0, 0, 500).getTime();
    expect(下次运行(每秒, from)).toBe(new Date(2026, 7, 8, 10, 0, 1, 0).getTime());

    const 每15秒 = 解析Cron("*/15 * * * * *");
    expect(下次运行(每15秒, new Date(2026, 7, 8, 10, 0, 7).getTime())).toBe(
      new Date(2026, 7, 8, 10, 0, 15, 0).getTime(),
    );

    const 半点 = 解析Cron("0 30 12 * * *");
    expect(下次运行(半点, new Date(2026, 7, 8, 12, 0, 10).getTime())).toBe(
      new Date(2026, 7, 8, 12, 30, 0, 0).getTime(),
    );
    expect(下次运行(半点, new Date(2026, 7, 8, 12, 0, 45).getTime())).toBe(
      new Date(2026, 7, 8, 12, 30, 0, 0).getTime(),
    );
  });

  it("日/周组合语义：双方受限时任一命中即可", () => {
    // 每月 1 号或周一
    const 表达式 = 解析Cron("0 0 1 * 1");
    // 2026-08-08 是周六；2026-08-10 是周一 → 应命中周一
    expect(下次运行(表达式, new Date(2026, 7, 8, 0, 0, 0).getTime())).toBe(
      new Date(2026, 7, 10, 0, 0, 0).getTime(),
    );
  });

  it("L：月末最后一天", () => {
    const 月末 = 解析Cron("0 0 L * *");
    expect(下次运行(月末, new Date(2026, 7, 8, 0, 0, 0).getTime())).toBe(
      new Date(2026, 7, 31, 0, 0, 0).getTime(),
    );
  });

  it("罕见日期：闰年 2 月 29 日可找到", () => {
    const 闰日 = 解析Cron("0 0 29 2 *");
    expect(下次运行(闰日, new Date(2026, 7, 8, 0, 0, 0).getTime())).toBe(
      new Date(2028, 1, 29, 0, 0, 0).getTime(),
    );
  });

  it("非法表达式抛 Cron错误", () => {
    expect(() => 解析Cron("60 * * * *")).toThrow(Cron错误);
    expect(() => 解析Cron("0 0 32 * *")).toThrow(Cron错误);
    expect(() => 解析Cron("a b c")).toThrow(Cron错误);
    expect(() => 解析Cron("1,2-1 * * * *")).toThrow(Cron错误);
  });
});

describe("任务调度器核心", () => {
  it("CRUD：create/list/get/update/remove", () => {
    const { 调度器 } = 建调度器();
    const 任务 = 调度器.create({
      name: "每日备份",
      cron: "0 0 * * *",
      action: { kind: "request", to: "mkg", action: "mkg.stats" },
    });
    expect(任务.id).toBeTruthy();
    expect(任务.nextRunAt).toBeGreaterThan(Date.now());
    expect(调度器.list()).toHaveLength(1);
    expect(调度器.get("每日备份")?.id).toBe(任务.id);

    const 改后 = 调度器.update(任务.id, { enabled: false, name: "停用备份" });
    expect(改后.enabled).toBe(false);
    expect(改后.nextRunAt).toBeNull();

    expect(调度器.remove(任务.id)).toEqual({ removed: true });
    expect(调度器.list()).toHaveLength(0);
  });

  it("非法 cron / 非法动作被拒绝", () => {
    const { 调度器 } = 建调度器();
    expect(() =>
      调度器.create({ name: "坏任务", cron: "99 * * * *", action: { kind: "request", to: "x", action: "y" } }),
    ).toThrow(Cron错误);
    expect(() =>
      调度器.create({
        name: "坏动作",
        cron: "* * * * *",
        action: { kind: "request", to: "", action: "y" },
      }),
    ).toThrow("缺少 to");
  });

  it("runNow 立即执行并记录结果，不改变下次排程", async () => {
    const { 调度器 } = 建调度器();
    const 任务 = 调度器.create({
      name: "立即任务",
      cron: "0 0 * * *",
      action: { kind: "event", action: "test.ping" },
    });
    const 排程前 = 任务.nextRunAt;
    const 结果 = await 调度器.runNow(任务.id);
    expect(结果.ok).toBe(true);
    expect(调度器.get(任务.id)!.lastResult?.ok).toBe(true);
    expect(调度器.get(任务.id)!.nextRunAt).toBe(排程前);
  });

  it("每秒勾选：每秒任务自动触发（约 2.5 秒内至少触发一次）", async () => {
    const { 调度器 } = 建调度器();
    const 任务 = 调度器.create({
      name: "每秒任务",
      cron: "* * * * * *",
      action: { kind: "event", action: "tick" },
    });
    调度器.start();
    await new Promise<void>((r) => setTimeout(r, 2500));
    调度器.stop();
    const 最新 = 调度器.get(任务.id)!;
    expect(最新.lastResult?.ok).toBe(true);
    expect(最新.lastRunAt).toBeGreaterThan(0);
  });

  it("持久化：重载后任务仍在且排程被重算", async () => {
    const 路径 = 临时文件("kugua-sched-persist-");
    const 存储 = new 任务存储(路径);
    const 调度器 = new 任务调度器(存储, async () => ({ ok: true, message: "ok", time: Date.now() }));
    调度器.load();
    const 任务 = 调度器.create({ name: "持久任务", cron: "0 9 * * *", action: { kind: "command", command: "echo hi" } });
    调度器.stop();

    expect(existsSync(路径)).toBe(true);
    const 重载 = new 任务调度器(new 任务存储(路径), async () => ({ ok: true, message: "ok", time: Date.now() }));
    重载.load();
    expect(重载.get(任务.id)?.name).toBe("持久任务");
    expect(重载.get(任务.id)!.nextRunAt).toBeGreaterThan(Date.now());
  });
});

describe("苦音总线集成（进程内）", () => {
  it("创建→立即执行→查询→删除 全链路", async () => {
    const { server, url } = await 启动服务端();
    void server;
    const 目标 = await 接入(url, "目标");
    目标.onRequest("ping", (p) => ({ pong: p }));

    const 调度端 = await 接入(url, "调度端");
    const 存储 = new 任务存储(临时文件("kugua-sched-bus-"));
    const 调度器 = new 任务调度器(存储, 创建动作执行者(调度端));
    调度器.load();
    注册调度处理器(调度端, 调度器);

    const 调用方 = await 接入(url, "调用方");
    const 创建结果 = (await 调用方.request("调度端", "scheduler.task.create", {
      name: "总线任务",
      cron: "0 0 * * *",
      action: { kind: "request", to: "目标", action: "ping", params: { hi: 1 } },
    })) as { id: string };

    const 运行结果 = (await 调用方.request("调度端", "scheduler.task.runNow", { id: 创建结果.id })) as {
      ok: boolean;
      message: string;
    };
    expect(运行结果.ok).toBe(true);
    expect(运行结果.message).toContain('"hi":1');

    const 列表 = (await 调用方.request("调度端", "scheduler.task.list", {})) as Array<{ id: string; name: string }>;
    expect(列表).toHaveLength(1);
    expect(列表[0].name).toBe("总线任务");

    await 调用方.request("调度端", "scheduler.task.delete", { id: 创建结果.id });
    expect((await 调用方.request("调度端", "scheduler.task.list", {})) as unknown[]).toHaveLength(0);
  });

  it("scheduler.status 汇总", async () => {
    const { url } = await 启动服务端();
    const 调度端 = await 接入(url, "调度端2");
    const 调度器 = new 任务调度器(new 任务存储(临时文件("kugua-sched-status-")), async () => ({
      ok: true,
      message: "ok",
      time: Date.now(),
    }));
    调度器.load();
    注册调度处理器(调度端, 调度器);
    调度器.create({ name: "甲", cron: "* * * * *", action: { kind: "event", action: "x" } });

    const 调用方 = await 接入(url, "调用方2");
    const s = (await 调用方.request("调度端2", "scheduler.status", {})) as { taskCount: number; enabledCount: number };
    expect(s.module).toBe("scheduler");
    expect(s.taskCount).toBe(1);
    expect(s.enabledCount).toBe(1);
  });
});

/** 启动主控独立进程（真实链路） */
function 启动主控(端口: number): Promise<{ proc: ChildProcess; output: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["packages/main/dist/index.js"], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env: { ...process.env, KUGUA_SCHEDULER_DATA: 临时文件("kugua-sched-e2e-") },
    });
    let resolved = false;
    const 输出: string[] = [];
    const 完成 = (err?: Error): void => {
      if (!resolved) {
        resolved = true;
        if (err) reject(err);
        else resolve({ proc, output: 输出.join("") });
      }
    };
    const 定时器 = setTimeout(() => 完成(), 8000);
    proc.stdout.on("data", (d: Buffer) => {
      输出.push(d.toString());
      if (输出.join("").includes("苦音服务端已启动")) {
        clearTimeout(定时器);
        setTimeout(() => 完成(), 100);
      }
    });
    proc.stderr.on("data", (d: Buffer) => 输出.push(d.toString()));
    proc.on("error", (err) => {
      clearTimeout(定时器);
      完成(err);
    });
  });
}

describe("真实主控端到端：scheduler + monitor + echo", () => {
  it("主控拉起三个模块，定时任务按秒触发、监控返回快照", async () => {
    const port = ++端口序号;
    const fs = { readFileSync, writeFileSync };
    const cfgPath = resolve(process.cwd(), "kugua.config.json");
    const 备份 = existsSync(cfgPath) ? fs.readFileSync(cfgPath, "utf-8") : null;
    try {
      writeFileSync(
        cfgPath,
        JSON.stringify({
          host: "127.0.0.1",
          port,
          token: "",
          modules: [
            { name: "echo", type: "process", entry: "packages/modules/echo/dist/index.js", autoStart: true },
            { name: "scheduler", type: "process", entry: "packages/modules/scheduler/dist/index.js", autoStart: true },
            { name: "monitor", type: "process", entry: "packages/modules/monitor/dist/index.js", autoStart: true },
          ],
        }),
      );

      const { proc, output } = await 启动主控(port);
      try {
        // 主控按序拉起子进程（每个约 3 秒），等三个模块全部注册
        await new Promise<void>((r) => setTimeout(r, 8000));
        const 检查器 = new NiganeClient({ name: "测试检查器", url: `ws://127.0.0.1:${port}` });
        await 检查器.connect();
        try {
          const 详情 = (await 检查器.request("nigane", "nigane.registry.details", {})) as 模块详情[];
          const 在线 = 详情.filter((m) => m.online).map((m) => m.name).sort();
          for (const 名 of ["echo", "monitor", "scheduler"]) {
            expect(在线, `模块 ${名} 应在线。主控输出：${output.slice(-400)}`).toContain(名);
          }

          // 创建「每秒请求 echo」任务
          const 任务 = (await 检查器.request("scheduler", "scheduler.task.create", {
            name: "端到端任务",
            cron: "* * * * * *",
            action: { kind: "request", to: "echo", action: "echo", params: { from: "e2e" } },
          })) as { id: string };

          // 立即执行一次
          const 立即 = (await 检查器.request("scheduler", "scheduler.task.runNow", { id: 任务.id })) as {
            ok: boolean;
          };
          expect(立即.ok).toBe(true);

          // 等待自动触发 ≥1 次
          await new Promise<void>((r) => setTimeout(r, 3500));
          const 最新 = (await 检查器.request("scheduler", "scheduler.task.get", { id: 任务.id })) as {
            lastResult?: { ok: boolean };
            lastRunAt?: number;
          };
          expect(最新.lastResult?.ok).toBe(true);
          expect(最新.lastRunAt).toBeGreaterThan(0);

          // 监控快照形状
          const 快照 = (await 检查器.request("monitor", "monitor.stats", {})) as {
            cpu: { usagePct: number; cores: number };
            memory: { total: number; used: number };
            disk: Array<{ name: string; total: number }>;
          };
          expect(typeof 快照.cpu.usagePct).toBe("number");
          expect(快照.cpu.cores).toBeGreaterThan(0);
          expect(快照.memory.total).toBeGreaterThan(0);
          expect(Array.isArray(快照.disk)).toBe(true);
        } finally {
          检查器.close();
        }
      } finally {
        try {
          proc.kill("SIGTERM");
          await new Promise<void>((r) => setTimeout(r, 2500));
          if (!proc.killed) proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    } finally {
      if (备份 === null) {
        try {
          rmSync(cfgPath, { force: true });
        } catch {
          // ignore
        }
      } else {
        writeFileSync(cfgPath, 备份);
      }
    }
  }, 30000);
});

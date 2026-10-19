/**
 * 作业运行时模块（阶段 4）
 *
 * 以子进程执行脚本/爬虫/安全测试等长任务：
 *  - `job.start` / `job.status` / `job.cancel` / `job.list` / `job.get` / `job.logs` / `job.remove`
 *  - 事件：`job.log`（流式输出）、`job.done`（完成）
 *  - 历史落 SQLite（node:sqlite），日志落 data/jobs/<id>.log
 *
 * 详见 docs/架构设计.md 第五节。
 */

import { existsSync, readFileSync, createWriteStream, mkdirSync, type WriteStream, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { 启动模块 } from "@kugua/module-kit";
import { 作业配置声明 } from "./declaration.js";
import type { 能力声明 } from "@kugua/capability";
import { 作业存储, 推入日志 } from "./store.js";
import type { 作业记录, 日志行, 启动作业参数 } from "./types.js";

/** 由读配置阶段写入，供注册阶段使用 */
let 作业目录路径: string | null = null;
let 最大并发 = 4;
/** 作业未指定超时时的默认值（毫秒），0 表示不限时 */
let 默认超时 = 0;
let 存储实例: 作业存储 | null = null;
let 运行中实例: Map<string, 运行中作业> | null = null;
let 结束作业实例: ((id: string, 状态: 作业记录["状态"], 退出码: number | null, 错误: string | null) => void) | null = null;
let 杀进程树实例: ((pid: number) => void) | null = null;
/** 内存日志环形缓冲上限 */

const 能力清单: 能力声明[] = [
  {
    名称: "job.start",
    模块: "job",
    标题: "启动作业",
    说明: "以子进程执行命令/脚本，返回作业 id",
    参数: {
      type: "object",
      properties: {
        命令: { type: "string", description: "可执行命令，如 python / node / git" },
        参数: { type: "array", items: { type: "string" }, description: "命令参数" },
        工作目录: { type: "string" },
        超时毫秒: { type: "number" },
        标题: { type: "string" },
        shell: { type: "boolean", description: "是否经 shell 执行" },
      },
      required: ["命令"],
    },
    权限: ["exec"],
    危险: true,
    长任务: true,
    暴露: { 指令: false, GUI: true, 定时: false, MCP: false },
  },
  {
    名称: "job.list",
    模块: "job",
    标题: "作业列表",
    说明: "列出最近的作业",
    参数: { type: "object", properties: { limit: { type: "number" } } },
    中文指令: ["作业", "作业列表"],
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "job.get",
    模块: "job",
    标题: "作业详情",
    说明: "按 id 获取作业记录",
    参数: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "job.logs",
    模块: "job",
    标题: "作业日志",
    说明: "读取作业输出日志",
    参数: { type: "object", properties: { id: { type: "string" }, 行数: { type: "number" } }, required: ["id"] },
    中文指令: ["作业日志"],
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "job.status",
    模块: "job",
    标题: "作业状态",
    说明: "查询作业状态",
    参数: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "job.cancel",
    模块: "job",
    标题: "取消作业",
    说明: "终止作业及其子进程",
    参数: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    权限: ["exec"],
    危险: true,
    中文指令: ["取消作业"],
    暴露: { 指令: true, GUI: true, 定时: false, MCP: false },
  },
  {
    名称: "job.remove",
    模块: "job",
    标题: "删除作业记录",
    说明: "删除作业历史与日志文件",
    参数: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    权限: ["filesystem:write"],
    危险: true,
    暴露: { 指令: false, GUI: true, 定时: false, MCP: false },
  },
];

interface 运行中作业 {
  记录: 作业记录;
  进程: ChildProcess;
  定时?: NodeJS.Timeout;
  取消原因?: "cancel" | "timeout";
}

void 启动模块({
  name: "job",
  version: "0.2.0",
  能力: 能力清单,
  配置声明: 作业配置声明,
  读配置: (文件配置) => {
    const j = (文件配置.job ?? {}) as { dir?: string; maxConcurrent?: number; defaultTimeoutMs?: number };
    作业目录路径 = resolve(process.cwd(), j.dir ?? "data/jobs");
    最大并发 = Math.max(j.maxConcurrent ?? 4, 1);
    默认超时 = Math.max(j.defaultTimeoutMs ?? 0, 0);
    return {};
  },
  配置变更: (载荷) => {
    // 载荷.配置 是 job 节本身，不是整个配置文件
    const j = 载荷.配置 as { dir?: string; maxConcurrent?: number; defaultTimeoutMs?: number };
    最大并发 = Math.max(j.maxConcurrent ?? 4, 1);
    默认超时 = Math.max(j.defaultTimeoutMs ?? 0, 0);
    // 只变更并发/超时的话不需要重启：作业目录只在启动时打开一次数据库
    if (载荷.变更.some((k) => k === "dir" || k.startsWith("dir."))) {
      console.log("[作业] 作业目录已变更，需重启本模块才生效");
    }
  },
  注册: (客户端) => {
    const 作业目录 = 作业目录路径!;
    mkdirSync(作业目录, { recursive: true });
    const 存储 = new 作业存储(join(作业目录, "jobs.db"));
    存储实例 = 存储;

    const 运行中 = new Map<string, 运行中作业>();
    const 日志缓冲 = new Map<string, 日志行[]>();
    const 日志流 = new Map<string, WriteStream>();
    运行中实例 = 运行中;
    结束作业实例 = 结束作业;
    杀进程树实例 = 杀进程树;

  /** 追加一行日志：内存环形 + 文件流 + 事件推送 */
  function 追加日志(id: string, 流名: 日志行["流"], 行: string): void {
    const 条目: 日志行 = { 时间: Date.now(), 流: 流名, 行 };
    日志缓冲.set(id, 推入日志(日志缓冲.get(id) ?? [], 条目));
    日志流.get(id)?.write(`[${流名}] ${行}\n`);
    客户端.sendEvent("job.log", { id, 流: 流名, 行, 时间: 条目.时间 });
  }

  /** 结束作业：更新状态、落库、广播、清理进程句柄 */
  function 结束作业(id: string, 状态: 作业记录["状态"], 退出码: number | null, 错误: string | null): void {
    const 项 = 运行中.get(id);
    if (!项) return;
    if (项.定时) clearTimeout(项.定时);
    const 结束时间 = Date.now();
    项.记录.状态 = 状态;
    项.记录.退出码 = 退出码;
    项.记录.结束时间 = 结束时间;
    项.记录.耗时毫秒 = 结束时间 - 项.记录.启动时间;
    项.记录.错误 = 错误;
    存储.保存(项.记录);
    日志流.get(id)?.end();
    日志流.delete(id);
    运行中.delete(id);
    客户端.sendEvent("job.done", {
      id,
      状态,
      退出码,
      耗时毫秒: 项.记录.耗时毫秒,
      ok: 状态 === "done",
    });
  }

  /** 终止进程树（Windows 用 taskkill /T，POSIX 用进程组） */
  function 杀进程树(pid: number): void {
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {
        /* 忽略结果 */
      });
      return;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* 忽略 */
      }
    }
  }

  function 启动作业(参数: 启动作业参数): 作业记录 {
    if (!参数 || typeof 参数.命令 !== "string" || !参数.命令.trim()) {
      throw new Error("缺少 命令");
    }
    if (运行中.size >= 最大并发) {
      throw new Error(`并发上限已满（${最大并发}），请等待或取消其他作业`);
    }
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const 工作目录 = 参数.工作目录 ? resolve(参数.工作目录) : process.cwd();
    const 日志文件 = join(作业目录, `${id}.log`);
    const 记录: 作业记录 = {
      id,
      标题: 参数.标题?.trim() || 参数.命令,
      命令: 参数.命令,
      参数: 参数.参数 ?? [],
      工作目录,
      shell: Boolean(参数.shell),
      状态: "running",
      退出码: null,
      启动时间: Date.now(),
      结束时间: null,
      耗时毫秒: null,
      日志文件,
      错误: null,
    };
    存储.保存(记录);
    日志缓冲.set(id, []);
    日志流.set(id, createWriteStream(日志文件, { flags: "a" }));

    const 进程 = spawn(参数.命令, 参数.参数 ?? [], {
      cwd: 工作目录,
      env: { ...process.env, ...(参数.环境 ?? {}) },
      shell: Boolean(参数.shell),
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    运行中.set(id, { 记录, 进程 });
    追加日志(id, "system", `启动：${参数.命令} ${(参数.参数 ?? []).join(" ")}（cwd=${工作目录}）`);

    进程.stdout?.setEncoding("utf-8");
    进程.stdout?.on("data", (块: string) => {
      for (const 行 of String(块).split(/\r?\n/)) if (行) 追加日志(id, "stdout", 行);
    });
    进程.stderr?.setEncoding("utf-8");
    进程.stderr?.on("data", (块: string) => {
      for (const 行 of String(块).split(/\r?\n/)) if (行) 追加日志(id, "stderr", 行);
    });
    进程.on("error", (err) => {
      追加日志(id, "system", `进程错误：${err.message}`);
      结束作业(id, "failed", null, err.message);
    });
    进程.on("exit", (码, 信号) => {
      const 项 = 运行中.get(id);
      if (!项) return;
      if (项.取消原因 === "cancel") {
        追加日志(id, "system", `已取消（信号 ${信号 ?? "-"}）`);
        结束作业(id, "cancelled", 码, "用户取消");
      } else if (项.取消原因 === "timeout") {
        追加日志(id, "system", `超时终止`);
        结束作业(id, "timeout", 码, "执行超时");
      } else if (码 === 0) {
        结束作业(id, "done", 0, null);
      } else {
        结束作业(id, "failed", 码, `退出码 ${码 ?? "?"}`);
      }
    });

    // 单次调用显式指定的超时优先，否则用配置里的默认超时
    const 显式超时 = 参数.超时毫秒;
    const 超时 = typeof 显式超时 === "number" && 显式超时 > 0 ? 显式超时 : 默认超时;
    if (超时 > 0) {
      运行中.get(id)!.定时 = setTimeout(() => {
        const 项 = 运行中.get(id);
        if (!项) return;
        项.取消原因 = "timeout";
        if (项.进程.pid) 杀进程树(项.进程.pid);
      }, 超时);
    }

    return 记录;
  }

  function 取消作业(id: string): boolean {
    const 项 = 运行中.get(id);
    if (!项) return false;
    项.取消原因 = "cancel";
    if (项.进程.pid) 杀进程树(项.进程.pid);
    return true;
  }

  function 读取日志(id: string, 行数 = 200): 日志行[] {
    const 内存 = 日志缓冲.get(id);
    if (内存) return 内存.slice(-行数);
    const 记录 = 存储.获取(id);
    if (!记录 || !existsSync(记录.日志文件)) return [];
    try {
      const 文本 = readFileSync(记录.日志文件, "utf-8");
      return 文本
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-行数)
        .map((行) => ({ 时间: 0, 流: "stdout" as const, 行 }));
    } catch {
      return [];
    }
  }

  // ===== 动作注册 =====
  客户端.onRequest("job.start", (params) => 启动作业((params ?? {}) as 启动作业参数));

  客户端.onRequest("job.list", (params) => {
    const { limit } = (params ?? {}) as { limit?: number };
    return 存储.列表(typeof limit === "number" ? limit : 100);
  });

  客户端.onRequest("job.get", (params) => {
    const { id } = (params ?? {}) as { id?: string };
    if (!id) throw new Error("缺少 id");
    return 存储.获取(id);
  });

  客户端.onRequest("job.status", (params) => {
    const { id } = (params ?? {}) as { id?: string };
    if (!id) throw new Error("缺少 id");
    const r = 存储.获取(id);
    return r ? { id, 状态: r.状态, 退出码: r.退出码, 耗时毫秒: r.耗时毫秒 } : null;
  });

  客户端.onRequest("job.logs", (params) => {
    const p = (params ?? {}) as { id?: string; 行数?: number; 参数文本?: string; 原文?: string };
    const id = p.id ?? (p.参数文本 || p.原文 || "").trim().split(/\s+/).pop();
    if (!id) throw new Error("缺少 id");
    return 读取日志(id, typeof p.行数 === "number" ? p.行数 : 200);
  });

  客户端.onRequest("job.cancel", (params) => {
    const p = (params ?? {}) as { id?: string; 参数文本?: string; 原文?: string };
    const id = p.id ?? (p.参数文本 || p.原文 || "").trim().split(/\s+/).pop();
    if (!id) throw new Error("缺少 id");
    return { cancelled: 取消作业(id) };
  });

  客户端.onRequest("job.remove", (params) => {
    const { id } = (params ?? {}) as { id?: string };
    if (!id) throw new Error("缺少 id");
    if (运行中.has(id)) throw new Error("作业正在运行，请先取消");
    const 记录 = 存储.获取(id);
    if (记录 && existsSync(记录.日志文件)) {
      try {
        rmSync(记录.日志文件, { force: true });
      } catch {
        /* 忽略 */
      }
    }
    存储.删除(id);
    return { removed: true };
  });

  },
  关闭: () => {
    for (const [id, 项] of 运行中实例 ?? []) {
      if (项.进程.pid) 杀进程树实例?.(项.进程.pid);
      结束作业实例?.(id, "cancelled", null, "运行时关闭");
    }
    存储实例?.关闭();
  },
  就绪: () => console.debug("[job] 已接入主控"),
});

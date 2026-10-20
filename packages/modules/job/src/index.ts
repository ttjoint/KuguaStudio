/**
 * 作业运行时模块（阶段 4）
 *
 * 以子进程执行脚本/爬虫/安全测试等长任务：
 *  - `job.start` / `job.status` / `job.cancel` / `job.list` / `job.get` / `job.logs` / `job.remove`
 *  - `job.rerun` / `job.continue`（重跑 / 断点续跑）
 *  - 事件：`job.log`（流式输出）、`job.done`（完成）
 *  - 历史落 SQLite（node:sqlite），日志落 data/jobs/<id>.log，进度落 data/jobs/<id>.progress
 *
 * ## 为什么有「能力作业」
 *
 * 插件里一个批量去背景要跑二十分钟，插件本身（以及消息分发）等不了那么久：
 * 现有调用链全是「请求 → 等返回」，超时只能回一句「指令运行超时」，
 * 而这时外部程序其实还在跑，用户既看不到进度也停不掉。
 *
 * 所以 job 支持把**一次能力调用**转成作业：`{ 能力名: "image.batch", 能力参数: {...} }`。
 * 命令由那个能力声明的 `执行` 字段给出（见 docs/作业与插件长任务.md），
 * 解析结果落库，重跑/续跑用的还是同一份能力参数。
 *
 * ## 断点续跑的责任边界
 *
 * job 不知道自己跑到第几步——那只有批处理知道。job 保证的是三件事：
 *  1. 注入 `KUGUA_JOB_ID` / `KUGUA_JOB_ATTEMPT` / `KUGUA_JOB_PROGRESS`；
 *  2. 进度文件路径稳定（同一 id 永远同一个路径）；
 *  3. 续跑复用 id、`ATTEMPT+1`、日志追加而不是覆盖。
 * 具体从哪继续，由批处理读进度文件自己决定。详见《作业与插件长任务.md》。
 */

import { existsSync, readFileSync, createWriteStream, mkdirSync, rmSync, type WriteStream } from "node:fs";
import { resolve, join } from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { 启动模块 } from "@kugua/module-kit";
import type { NiganeClient } from "@kugua/nigane";
import { 作业配置声明 } from "./declaration.js";
import type { 能力声明 } from "@kugua/capability";
import { 作业存储, 推入日志, 归一尝试次数 } from "./store.js";
import { 归一来源, 解析能力命令, 带计数标题, 标题已含计数, 注入作业环境 } from "./pure.js";
import type { 作业记录, 日志行, 启动作业参数, 启动作业结果, 能力命令 } from "./types.js";

// 这些是模块的对外契约，也一并从这里导出，调用方不用多知道一个文件
export { 归一来源, 解析能力命令, 带计数标题, 标题已含计数, 注入作业环境 } from "./pure.js";
export type { 执行声明 } from "./pure.js";

/** 由读配置阶段写入，供注册阶段使用 */
let 作业目录路径: string | null = null;
let 最大并发 = 4;
/** 作业未指定超时时的默认值（毫秒），0 表示不限时 */
let 默认超时 = 0;
let 存储实例: 作业存储 | null = null;
let 运行中实例: Map<string, 运行中作业> | null = null;
let 结束作业实例: ((id: string, 状态: 作业记录["状态"], 退出码: number | null, 错误: string | null) => void) | null = null;
let 杀进程树实例: ((pid: number) => void) | null = null;
/** 由注册阶段写入：能力作业要回主控查声明 */
let 客户端实例: NiganeClient | null = null;

const 能力清单: 能力声明[] = [
  {
    名称: "job.start",
    模块: "job",
    标题: "启动作业",
    说明: "以子进程执行命令/脚本，或把一次能力调用转成作业，返回作业记录",
    参数: {
      type: "object",
      properties: {
        命令: { type: "string", description: "可执行命令，如 python / node / git（与 能力名 二选一）" },
        参数: { type: "array", items: { type: "string" }, description: "命令参数" },
        能力名: { type: "string", description: "把该能力的 执行 声明转成命令；与 命令 二选一" },
        能力参数: { description: "传给 能力名 的参数（重跑/续跑时原样复用）" },
        工作目录: { type: "string" },
        超时毫秒: { type: "number" },
        标题: { type: "string" },
        shell: { type: "boolean", description: "是否经 shell 执行" },
        发起者: { type: "string", description: "发起方标识（模块名/插件名），默认 system" },
        来源: { type: "string", description: "user / module / plugin / scheduler" },
      },
    },
    权限: ["exec"],
    危险: true,
    长任务: true,
    暴露: { 指令: false, GUI: true, 定时: true, MCP: false },
  },
  {
    名称: "job.rerun",
    模块: "job",
    标题: "重跑作业",
    说明: "拿旧作业的参数重新开一条（新 id，从零开始）",
    参数: { type: "object", properties: { id: { type: "string" }, 发起者: { type: "string" } }, required: ["id"] },
    权限: ["exec"],
    危险: true,
    长任务: true,
    暴露: { 指令: false, GUI: true, 定时: false, MCP: false },
  },
  {
    名称: "job.continue",
    模块: "job",
    标题: "续跑作业",
    说明: "复用原 id、尝试次数 +1、日志续写；中止/超时后可续",
    参数: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
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
    说明: "删除作业历史、日志与进度文件",
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
  version: "0.3.0",
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
    客户端实例 = 客户端;

    const 运行中 = new Map<string, 运行中作业>();
    const 日志缓冲 = new Map<string, 日志行[]>();
    const 日志流 = new Map<string, WriteStream>();
    /** 每条作业最近一次「启动时用的环境」，续跑要复用（不能重新读配置） */
    const 环境表 = new Map<string, Record<string, string>>();
    运行中实例 = 运行中;
    结束作业实例 = 结束作业;
    杀进程树实例 = 杀进程树;

  /** 追加一行日志：内存环形 + 文件流 + 事件推送 */
  function 追加日志(id: string, 流名: 日志行["流"], 行: string): void {
    const 条目: 日志行 = { 时间: Date.now(), 流: 流名, 行 };
    日志缓冲.set(id, 推入日志(日志缓冲.get(id) ?? [], 条目));
    日志流.get(id)?.write(`[${流名}] ${行}\n`);
    // 推送带上 `发起者`：插件起的作业只能推给插件自己（GUI 别被刷屏），
    // GUI 起的作业谁都能看。只带 id 的话订阅方无从判断。
    const 发起者 = 运行中.get(id)?.记录.发起者 ?? 存储.获取(id)?.发起者 ?? "";
    客户端.sendEvent("job.log", { id, 发起者, 流: 流名, 行, 时间: 条目.时间 });
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
      发起者: 项.记录.发起者,
      状态,
      退出码,
      耗时毫秒: 项.记录.耗时毫秒,
      ok: 状态 === "done",
      尝试次数: 项.记录.尝试次数,
      // 只有中止/超时才有「接着跑」的意义；done/failed 续跑是重复劳动
      可续跑: 状态 === "cancelled" || 状态 === "timeout",
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

  /**
   * 解析能力作业的命令：从主控的能力注册表里取 `执行` 声明。
   *
   * 走主控而不是在 job 里维护一张表：能力是模块自己声明的，
   * job 抄一份就是第二份真相，插件更新了执行命令而 job 没跟上，
   * 表现为「作业跑的是旧命令」且完全没有征兆。
   */
  async function 取能力命令(能力名: string, 能力参数: unknown): Promise<能力命令> {
    // 本模块自己起子进程，所以这里不能走 capability.call（那会回到 job 自己）
    const 声明 = (await 客户端.request("nigane", "capability.get", { 名称: 能力名 }, 5000)) as
      | { 名称?: string; 执行?: unknown }
      | null;
    if (!声明) throw new Error(`能力不存在：${能力名}`);
    const 解析 = 解析能力命令(声明, 能力参数);
    if (!解析) {
      throw new Error(
        `能力 ${能力名} 未声明「执行」，无法转成作业。` +
          `请在能力声明里加 执行: { 命令, 参数 }（见 docs/作业与插件长任务.md），或直接用 命令 参数启动。`,
      );
    }
    return 解析;
  }

  function 进度路径(id: string): string {
    return join(作业目录, `${id}.progress`);
  }

  /**
   * 启动（或续跑）一条作业。
   *
   * `续跑选项` 走的是同一函数：复用 id、尝试次数 +1、日志追加、不清进度文件。
   * 两个入口分成两段代码的话，「续跑」迟早会漏掉某个启动参数（比如环境变量），
   * 表现为「重跑能跑、续跑不行」，而且只在特定作业上现形。
   */
  async function 启动作业(
    参数: 启动作业参数,
    续跑选项?: { 续跑: true; id: string },
  ): Promise<启动作业结果> {
    const 能力名 = typeof 参数.能力名 === "string" && 参数.能力名.trim() ? 参数.能力名.trim() : null;
    let 命令 = typeof 参数.命令 === "string" ? 参数.命令.trim() : "";
    let 命令参数 = 参数.参数 ?? [];
    let shell = Boolean(参数.shell);
    let 能力参数: unknown = 参数.能力参数 ?? null;
    let 标题 = 参数.标题?.trim() ?? "";

    if (能力名) {
      const 解析 = await 取能力命令(能力名, 能力参数);
      命令 = 解析.命令;
      命令参数 = 解析.参数;
      shell = 解析.shell;
      能力参数 = 解析.能力参数;
      if (!标题) 标题 = 能力名;
    }
    if (!命令) throw new Error("缺少 命令（或 能力名）");

    const 续跑 = 续跑选项?.续跑 === true;
    const 旧记录 = 续跑 ? 存储.获取(续跑选项!.id) : null;
    if (续跑 && !旧记录) throw new Error(`作业不存在：${续跑选项!.id}`);
    const id = 旧记录 ? 旧记录.id : `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const 尝试次数 = 旧记录 ? 归一尝试次数(旧记录.尝试次数) + 1 : 1;

    // 同一 id 已有实例在跑：先终止，否则两条进程写同一个日志文件
    const 旧项 = 运行中.get(id);
    if (旧项) {
      旧项.取消原因 = "cancel";
      if (旧项.进程.pid) 杀进程树(旧项.进程.pid);
    }
    if (运行中.size >= 最大并发) {
      throw new Error(`并发上限已满（${最大并发}），请等待或取消其他作业`);
    }

    const 工作目录 = 参数.工作目录 ? resolve(参数.工作目录) : process.cwd();
    const 日志文件 = join(作业目录, `${id}.log`);
    const 进度文件 = 进度路径(id);
    const 来源 = 归一来源(参数.来源);
    const 发起者 = String(参数.发起者 ?? "").trim() || "system";

    const 记录: 作业记录 = {
      id,
      标题: 带计数标题(标题 || 命令, 能力参数, 旧记录 ? 标题已含计数(旧记录.标题) : false),
      命令,
      参数: 命令参数,
      工作目录,
      shell,
      状态: "running",
      退出码: null,
      启动时间: Date.now(),
      结束时间: null,
      耗时毫秒: null,
      日志文件,
      错误: null,
      发起者,
      来源,
      尝试次数,
      进度文件,
      能力名,
      能力参数,
    };
    存储.保存(记录);
    日志缓冲.set(id, 续跑 ? (日志缓冲.get(id) ?? []) : []);
    // 续跑用 "a" 追加：把上次的日志覆盖掉等于毁掉唯一的现场记录
    日志流.set(id, createWriteStream(日志文件, { flags: "a" }));

    const 环境: Record<string, string> = { ...(参数.环境 ?? {}) };
    环境表.set(id, 环境);
    // 这三个变量是断点续跑的**契约**：批处理靠它们知道「我是谁、第几次、进度放哪」
    注入作业环境(环境, id, 尝试次数, 进度文件);

    const 进程 = spawn(命令, 命令参数, {
      cwd: 工作目录,
      env: { ...process.env, ...环境 },
      shell,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    运行中.set(id, { 记录, 进程 });
    追加日志(
      id,
      "system",
      `${续跑 ? `第 ${尝试次数} 次尝试（续跑）` : "启动"}：${命令} ${命令参数.join(" ")}（cwd=${工作目录}）`,
    );

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

    return { 记录, 已清理旧进程: Boolean(旧项) };
  }

  function 取消作业(id: string): boolean {
    const 项 = 运行中.get(id);
    if (!项) return false;
    项.取消原因 = "cancel";
    if (项.进程.pid) 杀进程树(项.进程.pid);
    return true;
  }

  /**
   * 重跑：新 id、从零开始。
   *
   * 语义上就是「再启动一次，参数照抄」。和续跑分开两个动作而不是一个布尔参数，
   * 是因为两者的**结果**完全不同（新记录 vs 原记录 +1 次），
   * 一个布尔参数让调用方在日志里看不出发生了什么。
   */
  async function 重跑(id: string, 发起者?: string): Promise<启动作业结果> {
    const 旧 = 存储.获取(id);
    if (!旧) throw new Error(`作业不存在：${id}`);
    return 启动作业({
      ...(旧.能力名
        ? { 能力名: 旧.能力名, 能力参数: 旧.能力参数 }
        : { 命令: 旧.命令, 参数: 旧.参数, shell: 旧.shell }),
      工作目录: 旧.工作目录,
      标题: 旧.标题,
      环境: 环境表.get(id),
      发起者: 发起者 ?? 旧.发起者,
      来源: 旧.来源,
    });
  }

  /**
   * 续跑：复用 id、尝试次数 +1、日志追加。
   *
   * 只允许「上次不是正常结束」的作业续跑——done 的作业续跑等于重跑一遍，
   * failed 的续跑则容易让人以为「上次没跑完」，实际是全跑了一遍。
   * 真要重跑请用 job.rerun，语义清楚。
   */
  async function 续跑(id: string): Promise<启动作业结果> {
    const 旧 = 存储.获取(id);
    if (!旧) throw new Error(`作业不存在：${id}`);
    if (旧.状态 === "running") throw new Error("作业还在运行，无法续跑");
    if (旧.状态 === "done") throw new Error("作业已完成，请用 job.rerun 重跑");
    return 启动作业(
      {
        ...(旧.能力名
          ? { 能力名: 旧.能力名, 能力参数: 旧.能力参数 }
          : { 命令: 旧.命令, 参数: 旧.参数, shell: 旧.shell }),
        工作目录: 旧.工作目录,
        标题: 旧.标题,
        环境: 环境表.get(id),
        发起者: 旧.发起者,
        来源: 旧.来源,
      },
      { 续跑: true, id },
    );
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

  /** 从参数里取 id：结构化优先，其次中文指令末尾那个词 */
  function 取id(参数: unknown): string {
    const p = (参数 ?? {}) as { id?: string; 参数文本?: string; 原文?: string };
    const id = p.id ?? (p.参数文本 || p.原文 || "").trim().split(/\s+/).pop();
    if (!id) throw new Error("缺少 id");
    return id;
  }

  // ===== 动作注册 =====
  客户端.onRequest("job.start", (params) => 启动作业((params ?? {}) as 启动作业参数));

  客户端.onRequest("job.rerun", (params) => 重跑(取id(params), (params as { 发起者?: string } | undefined)?.发起者));

  客户端.onRequest("job.continue", (params) => 续跑(取id(params)));

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
    return r
      ? {
          id,
          状态: r.状态,
          退出码: r.退出码,
          耗时毫秒: r.耗时毫秒,
          尝试次数: r.尝试次数,
          可续跑: r.状态 === "cancelled" || r.状态 === "timeout",
        }
      : null;
  });

  客户端.onRequest("job.logs", (params) => {
    const p = (params ?? {}) as { id?: string; 行数?: number };
    return 读取日志(取id(params), typeof p.行数 === "number" ? p.行数 : 200);
  });

  客户端.onRequest("job.cancel", (params) => {
    return { cancelled: 取消作业(取id(params)) };
  });

  客户端.onRequest("job.remove", (params) => {
    const id = 取id(params);
    if (运行中.has(id)) throw new Error("作业正在运行，请先取消");
    const 记录 = 存储.获取(id);
    for (const 文件 of [记录?.日志文件, 记录?.进度文件]) {
      if (文件 && existsSync(文件)) {
        try {
          rmSync(文件, { force: true });
        } catch {
          /* 忽略 */
        }
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


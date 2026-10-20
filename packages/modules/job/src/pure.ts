/**
 * 作业模块的纯函数部分（无副作用、可单测）。
 *
 * ## 为什么单独一个文件
 *
 * `index.ts` 在**导入时**就执行 `启动模块({...})`：读配置、连主控，
 * 连不上直接 `process.exit(1)`。单测 import 它等于在测试进程里起一个模块，
 * 结果是「所有断言都过了，但 vitest 报 unhandled rejection: process.exit」。
 *
 * 把这些「不需要进程」的逻辑挪出来，测试就能直接 import 而不惊动运行时。
 * 顺带的好处：这些函数在文档（《作业与插件长任务.md》）里是对外契约，
 * 单独一个文件比埋在 600 行的模块入口里好找。
 */

import type { 作业来源 } from "./types.js";
import type { 能力命令 } from "./types.js";

/** 能力声明的 `执行` 字段（见 docs/作业与插件长任务.md） */
export interface 执行声明 {
  命令: string;
  参数?: string[];
  shell?: boolean;
}

const 合法来源: 作业来源[] = ["user", "module", "plugin", "scheduler"];

/** 来源归一：认不出的一律按 user，别让统计里冒出「未知」 */
export function 归一来源(值: unknown): 作业来源 {
  const 文本 = String(值 ?? "").trim();
  return (合法来源 as string[]).includes(文本) ? (文本 as 作业来源) : "user";
}

/**
 * 解析「能力作业」的命令。
 *
 * 返回 null 表示这个能力不支持转作业——调用方据此给出「用 命令 直接起」提示，
 * 而不是抛一个「执行 字段缺失」让调用者去猜。
 */
export function 解析能力命令(
  声明: { 名称?: string; 执行?: unknown } | null | undefined,
  能力参数: unknown,
): 能力命令 | null {
  const 执行 = 声明?.执行 as 执行声明 | undefined;
  if (!执行 || typeof 执行.命令 !== "string" || !执行.命令.trim()) return null;
  const 占位 = 占位替换表(能力参数);
  const 换 = (文本: string): string => 占位.reduce((acc, [键, 值]) => acc.split(键).join(值), 文本);
  const 参数 = Array.isArray(执行.参数) ? 执行.参数.map((a) => 换(String(a))) : [];
  return {
    命令: 换(执行.命令),
    参数,
    shell: Boolean(执行.shell),
    能力参数: 能力参数 ?? null,
  };
}

/**
 * 占位符表：`{path}` 形式的整段替换，外加 `{参数}` → JSON。
 *
 * 用 split/join 而不是 replace：`replace` 只换第一个，
 * 一个 `{path}` 出现两次时第二次会原样传给子进程。
 *
 * 键按长度倒序排：一旦有人加 `{p}` 这样的短键，不排序就会被长键的前缀抢先换掉。
 */
function 占位替换表(参数: unknown): Array<[string, string]> {
  const 对象 = (参数 && typeof 参数 === "object" ? 参数 : {}) as Record<string, unknown>;
  const 表: Array<[string, string]> = [["{参数}", JSON.stringify(对象)]];
  for (const [键, 值] of Object.entries(对象)) {
    if (值 === null || 值 === undefined) continue;
    表.push([`{${键}}`, typeof 值 === "string" ? 值 : String(值)]);
  }
  return 表.sort((a, b) => b[0].length - a[0].length);
}

/**
 * 标题是否该加「（N 项）」。
 *
 * 批量作业全是同一个标题时列表里分不清谁是谁。加一次就够，
 * 续跑再调用时标题里已经有计数，不能再叠加成「（3 项）（3 项）」。
 */
export function 带计数标题(原标题: string, 能力参数: unknown, 已加?: boolean): string {
  if (已加) return 原标题;
  const 对象 = (能力参数 && typeof 能力参数 === "object" ? 能力参数 : {}) as Record<string, unknown>;
  for (const 键 of ["文件列表", "文件", "列表", "paths", "files"]) {
    const 值 = 对象[键];
    if (Array.isArray(值)) return `${原标题}（${值.length} 项）`;
  }
  return 原标题;
}

/** 标题里是否已经有「（N 项）」 */
export function 标题已含计数(标题: string): boolean {
  return /（\d+ 项）$/.test(标题);
}

/**
 * 注入作业环境变量。
 *
 * 三个键就是断点续跑的**全部契约**，批处理只靠它们就能知道
 * 「我是谁、第几次、进度写到哪」。为什么不放命令行参数：
 * 环境变量不会被 shell 引号规则吃掉，也不会弄脏日志。
 *
 * 用覆盖而不是「已有就保留」：批处理自己写的 `KUGUA_JOB_ATTEMPT`
 * 一旦能生效，就能骗续跑逻辑跳过已完成的部分。
 */
export function 注入作业环境(
  环境: Record<string, string>,
  id: string,
  尝试次数: number,
  进度文件: string,
): void {
  环境.KUGUA_JOB_ID = id;
  环境.KUGUA_JOB_ATTEMPT = String(尝试次数);
  环境.KUGUA_JOB_PROGRESS = 进度文件;
}

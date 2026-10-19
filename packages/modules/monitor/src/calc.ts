/**
 * monitor 模块的纯计算部分。
 *
 * ## 为什么要抽
 *
 * 这个模块的数值全都会**直接显示给用户看**——磁盘占用、CPU 百分比、
 * 监控间隔。算错了不会报错，只会显示一个错的数：
 *
 * - 磁盘 total 为 0 时，`used/total` 得 `NaN`，界面上就是「NaN%」
 * - free > total 时（虚拟机、配额目录），`used` 会是负数
 * - 监控间隔允许传 0 或负数，`setInterval(0)` 会变成每帧一次，把 CPU 打满
 *
 * 所以这几处都必须**先把边界算清楚**，再拿去做展示。
 * 采集（拉子进程、读 os）留在 `system.ts`，这里只放能脱离环境跑的部分。
 */

export interface 磁盘信息 {
  name: string;
  total: number;
  free: number;
  used: number;
  usagePct: number;
}

/**
 * 组装一条磁盘信息。
 *
 * 三条不变量：
 * - `total` 必须是正数，否则整条磁盘没意义（`usagePct` 给 0 而不是 NaN）
 * - `free` 不小于 0（负数说明数据有问题，当 0 处理）
 * - `used` 不小于 0 且**不超过 total**（free > total 时按 0 已用算）
 */
export function 组装磁盘(name: unknown, total: unknown, free: unknown): 磁盘信息 {
  const t = typeof total === "number" && total > 0 ? total : 0;
  const f = typeof free === "number" && free >= 0 ? free : 0;
  return {
    name: String(name ?? "?"),
    total: t,
    free: f,
    // Math.max 兜住 free > total 的情况；但不能兜住它导致 usagePct 为负，
    // 所以下面算百分比时用的是**同一个** used。
    used: Math.max(0, t - f),
    usagePct: t > 0 ? (Math.max(0, t - f) / t) * 100 : 0,
  };
}

/**
 * 解析 POSIX `df -kP` 的输出。
 *
 * `-kP` 是「POSIX 输出格式 + 千字节单位」，所以每个块数要 ×1024。
 * 跳过表头行、跳过字段不足 6 的行（挂载点带空格时 POSIX 格式会被截断）。
 *
 * 注意：`df -P` 保证**一行一个文件系统**，不会像不带 `-P` 那样折行，
 * 这是这里能按行简单切的前提。
 */
export function 解析df(输出: string): 磁盘信息[] {
  const 结果: 磁盘信息[] = [];
  for (const 行 of 输出.split("\n").slice(1)) {
    const 段 = 行.trim().split(/\s+/);
    if (段.length < 6) continue;
    const 总 = Number(段[1]) * 1024;
    const 已用 = Number(段[2]) * 1024;
    if (!Number.isFinite(总) || 总 <= 0) continue;
    结果.push({
      name: 段[0],
      total: 总,
      free: 总 - 已用,
      used: 已用,
      usagePct: (已用 / 总) * 100,
    });
  }
  return 结果;
}

/** 监控广播间隔的上下限（秒） */
export const 最小间隔 = 2;
export const 最大间隔 = 3600;

/**
 * 归一 `monitor.watch` 的间隔。
 *
 * 下限 2 秒不是随便定的：`采集快照()` 里 `采样CPU使用率` 本身就要
 * 阻塞 300ms 做双采样，间隔太短会让定时器排队、越堆越多。
 *
 * 传 0 / 负数 / NaN / 非数字一律退回默认 10 秒——**不能**让
 * `setInterval(0)` 出现，那会把一个 CPU 核打满。
 */
export function 归一间隔(原值: unknown, 默认 = 10): number {
  const n = typeof 原值 === "number" ? 原值 : Number(原值);
  if (!Number.isFinite(n)) return 默认;
  const 取整 = Math.floor(n);
  if (取整 < 最小间隔) return 最小间隔;
  if (取整 > 最大间隔) return 最大间隔;
  return 取整;
}

/** 百分比留在 [0, 100]，且不给 NaN */
export function 夹百分比(值: number): number {
  if (!Number.isFinite(值)) return 0;
  return Math.max(0, Math.min(100, 值));
}

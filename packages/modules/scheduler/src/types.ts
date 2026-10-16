/**
 * 定时任务类型定义。
 * 动作（action）支持三种：
 *  - request：向指定模块发起苦音请求
 *  - event：向总线广播事件
 *  - command：在本地执行一条命令（自动化动作）
 */

/** 请求动作：向目标模块发起 request */
export interface 请求动作 {
  kind: "request";
  /** 目标模块名 */
  to: string;
  /** 动作名 */
  action: string;
  /** 请求参数 */
  params?: unknown;
  /** 超时毫秒，默认 10000 */
  timeoutMs?: number;
}

/** 事件动作：广播到总线 */
export interface 事件动作 {
  kind: "event";
  action: string;
  params?: unknown;
}

/** 命令动作：本地执行命令 */
export interface 命令动作 {
  kind: "command";
  command: string;
  args?: string[];
  /** 超时毫秒，默认 30000 */
  timeoutMs?: number;
}

export type 任务动作 = 请求动作 | 事件动作 | 命令动作;

/** 一次执行的结果记录 */
export interface 任务结果 {
  ok: boolean;
  message: string;
  time: number;
}

/** 持久化的定时任务 */
export interface 定时任务 {
  id: string;
  name: string;
  /** 触发器：cron=按表达式周期；startup=平台启动时执行一次 */
  触发?: "cron" | "startup";
  /** cron 表达式：5 段（分 时 日 月 周）或 6 段（秒 分 时 日 月 周）；startup 任务可为空 */
  cron: string;
  enabled: boolean;
  action: 任务动作;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number | null;
  lastResult?: 任务结果 | null;
  nextRunAt?: number | null;
}

/**
 * 任务调度器核心：任务 CRUD、cron 排程、每秒勾选触发。
 * 与网络解耦，执行动作由外部注入（便于测试）。
 */

import { randomUUID } from "node:crypto";
import { Cron错误, 解析并求下次 } from "./cron.js";
import type { 任务存储 } from "./store.js";
import type { 任务动作, 任务结果, 定时任务 } from "./types.js";

/** 执行者：真正运行一次任务动作 */
export type 动作执行者 = (动作: 任务动作) => Promise<任务结果>;
/** 运行完成广播（用于向总线发事件） */
export type 运行广播 = (任务: 定时任务, 结果: 任务结果) => void;

export interface 创建任务输入 {
  name: string;
  cron: string;
  action: 任务动作;
  enabled?: boolean;
  /** cron（默认）或 startup（平台启动时执行一次） */
  触发?: "cron" | "startup";
}

export class 任务调度器 {
  private 任务表 = new Map<string, 定时任务>();
  private 定时器: NodeJS.Timeout | null = null;
  private 保存定时: NodeJS.Timeout | null = null;
  private 运行中 = new Set<string>();
  private 已停止 = false;

  constructor(
    private 存储: 任务存储,
    private 执行: 动作执行者,
    private 广播?: 运行广播,
  ) {}

  /** 从存储加载任务并重算下次运行时间 */
  load(): void {
    for (const 任务 of this.存储.load()) {
      if (任务.触发 === "startup") {
        任务.nextRunAt = null;
      } else if (任务.enabled && 任务.cron) {
        try {
          任务.nextRunAt = 解析并求下次(任务.cron, Date.now());
        } catch {
          任务.enabled = false;
          任务.nextRunAt = null;
        }
      } else {
        任务.nextRunAt = null;
      }
      this.任务表.set(任务.id, 任务);
    }
    this.保存();
  }

  /** 开始每秒勾选；随后执行一次所有 startup 任务 */
  start(): void {
    if (this.定时器) return;
    this.定时器 = setInterval(() => {
      try {
        this.勾选();
      } catch (err) {
        console.error("[调度] 勾选出错：", err);
      }
    }, 1000);
    void this.运行启动任务();
  }

  /** 执行所有启用中的 startup 任务（仅一次，不改变排程） */
  private async 运行启动任务(): Promise<void> {
    for (const 任务 of this.任务表.values()) {
      if (任务.触发 !== "startup" || !任务.enabled) continue;
      if (this.运行中.has(任务.id)) continue;
      this.运行中.add(任务.id);
      try {
        await this.执行一次(任务, false);
      } finally {
        this.运行中.delete(任务.id);
      }
    }
  }

  /** 停止勾选并立即落盘 */
  stop(): void {
    this.已停止 = true;
    if (this.定时器) {
      clearInterval(this.定时器);
      this.定时器 = null;
    }
    if (this.保存定时) {
      clearTimeout(this.保存定时);
      this.保存定时 = null;
    }
    this.保存();
  }

  create(输入: 创建任务输入): 定时任务 {
    const 现在 = Date.now();
    const 触发 = 输入.触发 === "startup" ? "startup" : "cron";
    const 任务: 定时任务 = {
      id: randomUUID(),
      name: String(输入.name ?? "").trim(),
      触发,
      cron: 触发 === "startup" ? "" : String(输入.cron ?? "").trim(),
      enabled: 输入.enabled !== false,
      action: 输入.action,
      createdAt: 现在,
      updatedAt: 现在,
      nextRunAt: null,
    };
    if (!任务.name) throw new Error("定时任务缺少 name");
    if (触发 === "cron" && !任务.cron) throw new Error("cron 任务缺少 cron 表达式");
    校验动作(任务.action);
    this.重排(任务);
    this.任务表.set(任务.id, 任务);
    this.保存();
    return 任务;
  }

  list(): 定时任务[] {
    return [...this.任务表.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 按 id 或 name 查找 */
  get(标识: string): 定时任务 | null {
    return this.任务表.get(标识) ?? [...this.任务表.values()].find((t) => t.name === 标识) ?? null;
  }

  update(标识: string, 补丁: Partial<Pick<定时任务, "name" | "cron" | "action" | "enabled" | "触发">>): 定时任务 {
    const 任务 = this.get(标识);
    if (!任务) throw new Error(`定时任务不存在：${标识}`);
    if (补丁.name !== undefined) {
      任务.name = String(补丁.name).trim();
      if (!任务.name) throw new Error("定时任务 name 不能为空");
    }
    if (补丁.触发 !== undefined) {
      任务.触发 = 补丁.触发 === "startup" ? "startup" : "cron";
    }
    if (补丁.cron !== undefined) {
      任务.cron = String(补丁.cron).trim();
    }
    if (补丁.action !== undefined) {
      校验动作(补丁.action);
      任务.action = 补丁.action;
    }
    if (补丁.enabled !== undefined) {
      任务.enabled = 补丁.enabled;
    }
    this.重排(任务);
    任务.updatedAt = Date.now();
    this.保存();
    return 任务;
  }

  remove(标识: string): { removed: boolean } {
    const 任务 = this.get(标识);
    if (!任务) return { removed: false };
    this.任务表.delete(任务.id);
    this.保存();
    return { removed: true };
  }

  setEnabled(标识: string, enabled: boolean): 定时任务 {
    return this.update(标识, { enabled });
  }

  /** 立即执行一次（不改变下次排程） */
  async runNow(标识: string): Promise<任务结果> {
    const 任务 = this.get(标识);
    if (!任务) throw new Error(`定时任务不存在：${标识}`);
    return this.执行一次(任务, false);
  }

  /** 汇总状态 */
  status(): { module: string; version: string; taskCount: number; enabledCount: number } {
    const 全部 = this.list();
    return {
      module: "scheduler",
      version: "0.6.0",
      taskCount: 全部.length,
      enabledCount: 全部.filter((t) => t.enabled).length,
    };
  }

  private 重排(任务: 定时任务): void {
    if (任务.触发 === "startup") {
      任务.nextRunAt = null;
    } else if (任务.enabled && 任务.cron) {
      任务.nextRunAt = 解析并求下次(任务.cron, Date.now());
    } else {
      任务.nextRunAt = null;
    }
  }

  private 勾选(): void {
    const 现在 = Date.now();
    for (const 任务 of this.任务表.values()) {
      if (!任务.enabled || 任务.nextRunAt == null || 任务.nextRunAt > 现在) continue;
      if (this.运行中.has(任务.id)) continue;
      this.运行中.add(任务.id);
      void this.执行一次(任务, true).finally(() => this.运行中.delete(任务.id));
    }
  }

  private async 执行一次(任务: 定时任务, 更新调度: boolean): Promise<任务结果> {
    const 结果 = await this.执行(任务.action).catch(
      (err: unknown): 任务结果 => ({ ok: false, message: err instanceof Error ? err.message : String(err), time: Date.now() }),
    );
    任务.lastRunAt = Date.now();
    任务.lastResult = 结果;
    if (更新调度) {
      try {
        任务.nextRunAt = 任务.enabled ? 解析并求下次(任务.cron, Date.now()) : null;
      } catch (err) {
        任务.enabled = false;
        任务.nextRunAt = null;
        任务.lastResult = { ok: false, message: `cron 非法已停用：${err instanceof Error ? err.message : String(err)}`, time: Date.now() };
      }
    }
    任务.updatedAt = Date.now();
    this.保存();
    this.广播?.(任务, 结果);
    return 结果;
  }

  private 保存(): void {
    if (this.已停止) {
      this.存储.save([...this.任务表.values()]);
      return;
    }
    if (this.保存定时) return;
    this.保存定时 = setTimeout(() => {
      this.保存定时 = null;
      this.存储.save([...this.任务表.values()]);
    }, 300);
  }
}

export function 校验动作(动作: 任务动作): void {
  if (!动作 || typeof 动作 !== "object") throw new Error("定时任务缺少 action");
  switch (动作.kind) {
    case "request": {
      if (typeof 动作.to !== "string" || !动作.to) throw new Error("request 动作缺少 to");
      if (typeof 动作.action !== "string" || !动作.action) throw new Error("request 动作缺少 action");
      break;
    }
    case "event": {
      if (typeof 动作.action !== "string" || !动作.action) throw new Error("event 动作缺少 action");
      break;
    }
    case "command": {
      if (typeof 动作.command !== "string" || !动作.command.trim()) throw new Error("command 动作缺少 command");
      break;
    }
    default:
      throw new Error(`未知动作类型：${JSON.stringify(动作)}`);
  }
}

export { Cron错误 };

/**
 * @kugua/logger —— 日志器
 *
 * 设计要点（见 docs/架构设计.md 第九节）：
 *  - 内存环形缓冲，容量固定，避免无限增长；
 *  - 落盘限流：仅在有待写内容时批量追加，空闲时不做任何周期写盘；
 *  - 可选把控制台输出统一接入（由使用方决定）。
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type 日志级别 = "debug" | "info" | "warn" | "error";

export interface 日志条目 {
  时间: number;
  模块: string;
  级别: 日志级别;
  消息: string;
}

export interface 日志过滤 {
  模块?: string;
  级别?: 日志级别;
  /** 只返回时间 >= since 的条目（毫秒） */
  since?: number;
  关键词?: string;
  limit?: number;
}

export interface 日志器选项 {
  /** 环形缓冲容量，默认 2000 */
  容量?: number;
  /** 落盘文件路径；不设置则仅内存 */
  文件?: string;
  /** 落盘节流间隔（毫秒），默认 2000 */
  落盘间隔毫秒?: number;
}

export class 日志器 {
  private 缓冲: 日志条目[] = [];
  private 待落盘: 日志条目[] = [];
  private 定时: NodeJS.Timeout | null = null;
  private 正在落盘 = false;
  private readonly 容量: number;

  constructor(private 选项: 日志器选项 = {}) {
    this.容量 = Math.max(选项.容量 ?? 2000, 100);
    if (this.选项.文件) {
      this.定时 = setInterval(() => void this.落盘(), this.选项.落盘间隔毫秒 ?? 2000);
      this.定时.unref?.();
    }
  }

  /** 写入一条日志 */
  写(模块: string, 级别: 日志级别, 消息: string): void {
    const 条目: 日志条目 = { 时间: Date.now(), 模块, 级别, 消息 };
    this.缓冲.push(条目);
    if (this.缓冲.length > this.容量) this.缓冲.splice(0, this.缓冲.length - this.容量);
    if (this.选项.文件) this.待落盘.push(条目);
  }

  debug(模块: string, 消息: string): void {
    this.写(模块, "debug", 消息);
  }
  info(模块: string, 消息: string): void {
    this.写(模块, "info", 消息);
  }
  warn(模块: string, 消息: string): void {
    this.写(模块, "warn", 消息);
  }
  error(模块: string, 消息: string): void {
    this.写(模块, "error", 消息);
  }

  /** 最近 n 条（按时间正序） */
  尾部(n = 200): 日志条目[] {
    return this.缓冲.slice(-Math.max(n, 1));
  }

  /** 条件查询 */
  查询(过滤: 日志过滤 = {}): 日志条目[] {
    let 结果 = this.缓冲;
    if (过滤.模块) 结果 = 结果.filter((e) => e.模块 === 过滤.模块);
    if (过滤.级别) 结果 = 结果.filter((e) => e.级别 === 过滤.级别);
    if (typeof 过滤.since === "number") 结果 = 结果.filter((e) => e.时间 >= 过滤.since!);
    if (过滤.关键词) 结果 = 结果.filter((e) => e.消息.includes(过滤.关键词!));
    if (过滤.limit && 过滤.limit > 0) 结果 = 结果.slice(-过滤.limit);
    return 结果;
  }

  /** 各模块条数统计 */
  统计(): Array<{ 模块: string; 条数: number; 错误: number }> {
    const 表 = new Map<string, { 条数: number; 错误: number }>();
    for (const e of this.缓冲) {
      const 项 = 表.get(e.模块) ?? { 条数: 0, 错误: 0 };
      项.条数 += 1;
      if (e.级别 === "error") 项.错误 += 1;
      表.set(e.模块, 项);
    }
    return [...表.entries()].map(([模块, v]) => ({ 模块, ...v })).sort((a, b) => b.条数 - a.条数);
  }

  清空(): void {
    this.缓冲 = [];
    this.待落盘 = [];
  }

  /** 立即落盘（若有待写内容） */
  async 落盘(): Promise<void> {
    if (!this.选项.文件 || this.待落盘.length === 0 || this.正在落盘) return;
    this.正在落盘 = true;
    const 批次 = this.待落盘;
    this.待落盘 = [];
    try {
      await mkdir(dirname(this.选项.文件), { recursive: true });
      const 文本 = 批次
        .map((e) => `${new Date(e.时间).toISOString()} [${e.级别}] [${e.模块}] ${e.消息}`)
        .join("\n") + "\n";
      await appendFile(this.选项.文件, 文本, "utf-8");
    } catch {
      // 落盘失败不阻断主流程；把批次放回以便下次重试（限一次，避免无限增长）
      if (this.待落盘.length === 0) this.待落盘 = 批次.slice(-1000);
    } finally {
      this.正在落盘 = false;
    }
  }

  /** 关闭：停止定时器并做最后一次落盘 */
  async 关闭(): Promise<void> {
    if (this.定时) {
      clearInterval(this.定时);
      this.定时 = null;
    }
    await this.落盘();
  }
}

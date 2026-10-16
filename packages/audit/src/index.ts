/**
 * @kugua/audit —— 苦瓜工作室审计日志
 *
 * 记录每一次能力调用与模块操作（来源、通道、能力、参数摘要、结果、耗时），
 * 以 SQLite 存储（使用 Node 内置 `node:sqlite`，无原生依赖），支持查询与统计。
 *
 * 说明：主控进程会大量 spawn 子进程，而 better-sqlite3 原生模块在 Node v24 下
 * 与 spawn 组合会触发原生断言崩溃，故此处统一使用内置 `node:sqlite`。
 * 详见 docs/架构设计.md 第 4.5 节。
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** 一条审计记录 */
export interface 审计条目 {
  id: number;
  /** 秒级 Unix 时间戳 */
  time: number;
  /** 调用来源（模块名，如 webui / scheduler） */
  source: string;
  /** 通道：capability.call / capability.command / registry.start / ... */
  channel: string;
  /** 能力名（如 image.gifUnzip） */
  capability: string;
  /** 目标模块 */
  module: string;
  /** 目标动作 */
  action: string;
  /** 参数摘要（已脱敏与截断） */
  paramsDigest: string;
  /** 是否成功 */
  ok: boolean;
  /** 失败原因 */
  error: string | null;
  /** 耗时（毫秒） */
  durationMs: number;
}

/** 记录输入 */
export interface 审计输入 {
  source: string;
  channel: string;
  capability: string;
  module: string;
  action: string;
  params?: unknown;
  ok: boolean;
  error?: string;
  durationMs: number;
  /** 可选覆盖时间（秒） */
  time?: number;
}

/** 查询过滤条件 */
export interface 审计过滤 {
  source?: string;
  capability?: string;
  module?: string;
  channel?: string;
  ok?: boolean;
  /** 起始时间（秒） */
  since?: number;
  limit?: number;
  offset?: number;
}

/** 审计统计 */
export interface 审计统计 {
  总数: number;
  失败数: number;
  按模块: Array<{ module: string; 次数: number; 失败: number }>;
  按通道: Array<{ channel: string; 次数: number }>;
}

/** 敏感字段匹配（参数摘要中打码） */
const 敏感键 = /(token|api[_-]?key|secret|password|passwd|authorization|cookie)/i;

/** 生成参数摘要：脱敏 + 截断 */
export function 摘要参数(参数: unknown, 上限 = 500): string {
  if (参数 === undefined || 参数 === null) return "";
  let 文本: string;
  try {
    文本 = JSON.stringify(参数, (键, 值) => {
      if (键 && 敏感键.test(键)) return "***";
      if (typeof 值 === "string" && 值.length > 200) return `${值.slice(0, 200)}…`;
      return 值;
    });
  } catch {
    文本 = String(参数);
  }
  return 文本.length > 上限 ? `${文本.slice(0, 上限)}…` : 文本;
}

/** 审计日志（SQLite 存储，基于 node:sqlite） */
export class 审计日志 {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ":memory:") {
      try {
        this.db.exec("PRAGMA journal_mode = WAL;");
      } catch {
        /* 某些环境不支持 WAL，忽略 */
      }
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time INTEGER NOT NULL,
        source TEXT NOT NULL,
        channel TEXT NOT NULL,
        capability TEXT NOT NULL DEFAULT '',
        module TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT '',
        params_digest TEXT NOT NULL DEFAULT '',
        ok INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(time);
      CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);
      CREATE INDEX IF NOT EXISTS idx_audit_capability ON audit_logs(capability);
      CREATE INDEX IF NOT EXISTS idx_audit_source ON audit_logs(source);
    `);
  }

  /** 写入一条记录 */
  记录(输入: 审计输入): 审计条目 {
    const time = 输入.time ?? Math.floor(Date.now() / 1000);
    const digest = 摘要参数(输入.params);
    const 结果 = this.db
      .prepare(
        `INSERT INTO audit_logs (time, source, channel, capability, module, action, params_digest, ok, error, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        time,
        输入.source,
        输入.channel,
        输入.capability,
        输入.module,
        输入.action,
        digest,
        输入.ok ? 1 : 0,
        输入.error ?? null,
        输入.durationMs,
      );
    return {
      id: Number(结果.lastInsertRowid),
      time,
      source: 输入.source,
      channel: 输入.channel,
      capability: 输入.capability,
      module: 输入.module,
      action: 输入.action,
      paramsDigest: digest,
      ok: 输入.ok,
      error: 输入.error ?? null,
      durationMs: 输入.durationMs,
    };
  }

  /** 条件查询（按时间倒序） */
  查询(过滤: 审计过滤 = {}): 审计条目[] {
    const 条件: string[] = [];
    const 参数: Array<string | number | null> = [];
    if (过滤.source) {
      条件.push("source = ?");
      参数.push(过滤.source);
    }
    if (过滤.capability) {
      条件.push("capability = ?");
      参数.push(过滤.capability);
    }
    if (过滤.module) {
      条件.push("module = ?");
      参数.push(过滤.module);
    }
    if (过滤.channel) {
      条件.push("channel = ?");
      参数.push(过滤.channel);
    }
    if (typeof 过滤.ok === "boolean") {
      条件.push("ok = ?");
      参数.push(过滤.ok ? 1 : 0);
    }
    if (typeof 过滤.since === "number") {
      条件.push("time >= ?");
      参数.push(过滤.since);
    }
    const where = 条件.length > 0 ? `WHERE ${条件.join(" AND ")}` : "";
    const limit = Math.min(Math.max(过滤.limit ?? 100, 1), 1000);
    const offset = Math.max(过滤.offset ?? 0, 0);
    const rows = this.db
      .prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...参数, limit, offset) as Array<{
      id: number;
      time: number;
      source: string;
      channel: string;
      capability: string;
      module: string;
      action: string;
      params_digest: string;
      ok: number;
      error: string | null;
      duration_ms: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      time: r.time,
      source: r.source,
      channel: r.channel,
      capability: r.capability,
      module: r.module,
      action: r.action,
      paramsDigest: r.params_digest,
      ok: r.ok === 1,
      error: r.error,
      durationMs: r.duration_ms,
    }));
  }

  /** 统计概览 */
  统计(): 审计统计 {
    const 总数 = (this.db.prepare("SELECT COUNT(*) AS c FROM audit_logs").get() as { c: number }).c;
    const 失败数 = (
      this.db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE ok = 0").get() as { c: number }
    ).c;
    const 按模块 = this.db
      .prepare(
        "SELECT module, COUNT(*) AS 次数, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS 失败 FROM audit_logs GROUP BY module ORDER BY 次数 DESC",
      )
      .all() as Array<{ module: string; 次数: number; 失败: number }>;
    const 按通道 = this.db
      .prepare("SELECT channel, COUNT(*) AS 次数 FROM audit_logs GROUP BY channel ORDER BY 次数 DESC")
      .all() as Array<{ channel: string; 次数: number }>;
    return { 总数, 失败数, 按模块, 按通道 };
  }

  /** 清理早于指定时间（秒）的记录，返回删除条数 */
  清理(早于: number): number {
    const r = this.db.prepare("DELETE FROM audit_logs WHERE time < ?").run(早于);
    return Number(r.changes);
  }

  /** 关闭数据库 */
  close(): void {
    this.db.close();
  }
}

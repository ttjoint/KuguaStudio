/**
 * 作业历史存储（SQLite，使用 Node 内置 node:sqlite）。
 * 本模块会 spawn 子进程，故不能用 better-sqlite3（Node v24 下与 spawn 组合会原生崩溃）。
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { 作业记录, 作业状态 } from "./types.js";

export class 作业存储 {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    try {
      this.db.exec("PRAGMA journal_mode = WAL;");
    } catch {
      /* 忽略 */
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        command TEXT NOT NULL DEFAULT '',
        args TEXT NOT NULL DEFAULT '[]',
        cwd TEXT NOT NULL DEFAULT '',
        shell INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running',
        exit_code INTEGER,
        started_at INTEGER NOT NULL DEFAULT 0,
        ended_at INTEGER,
        duration_ms INTEGER,
        log_file TEXT NOT NULL DEFAULT '',
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_started ON jobs(started_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    `);
  }

  保存(记录: 作业记录): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, title, command, args, cwd, shell, status, exit_code, started_at, ended_at, duration_ms, log_file, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, command=excluded.command, args=excluded.args, cwd=excluded.cwd,
           shell=excluded.shell, status=excluded.status, exit_code=excluded.exit_code,
           started_at=excluded.started_at, ended_at=excluded.ended_at, duration_ms=excluded.duration_ms,
           log_file=excluded.log_file, error=excluded.error`,
      )
      .run(
        记录.id,
        记录.标题,
        记录.命令,
        JSON.stringify(记录.参数 ?? []),
        记录.工作目录,
        记录.shell ? 1 : 0,
        记录.状态,
        记录.退出码,
        记录.启动时间,
        记录.结束时间,
        记录.耗时毫秒,
        记录.日志文件,
        记录.错误,
      );
  }

  获取(id: string): 作业记录 | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? 映射(row) : null;
  }

  列表(limit = 100): 作业记录[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs ORDER BY started_at DESC LIMIT ?")
      .all(Math.min(Math.max(limit, 1), 500)) as Array<Record<string, unknown>>;
    return rows.map(映射);
  }

  删除(id: string): void {
    this.db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  }

  关闭(): void {
    this.db.close();
  }
}

function 映射(row: Record<string, unknown>): 作业记录 {
  let 参数: string[] = [];
  try {
    参数 = JSON.parse(String(row.args ?? "[]")) as string[];
  } catch {
    参数 = [];
  }
  return {
    id: String(row.id),
    标题: String(row.title ?? ""),
    命令: String(row.command ?? ""),
    参数,
    工作目录: String(row.cwd ?? ""),
    shell: Number(row.shell) === 1,
    状态: String(row.status ?? "done") as 作业状态,
    退出码: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    启动时间: Number(row.started_at ?? 0),
    结束时间: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at),
    耗时毫秒: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    日志文件: String(row.log_file ?? ""),
    错误: row.error === null || row.error === undefined ? null : String(row.error),
  };
}

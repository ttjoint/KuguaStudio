/**
 * 作业历史存储（SQLite，使用 Node 内置 node:sqlite）。
 * 本模块会 spawn 子进程，故不能用 better-sqlite3（Node v24 下与 spawn 组合会原生崩溃）。
 */

import { createRequire } from "node:module";

/**
 * `node:sqlite` 用 createRequire 加载，不用 ESM import。
 *
 * 原因：vite/vitest 在 transform 阶段会把 `import ... from "node:sqlite"`
 * 剥成裸名 `sqlite` 再当 npm 包 resolve，然后报
 * "Failed to load url sqlite. Does the file exist?"。
 * 而 `node:sqlite` 是 Node 24 内置模块，npm 上根本没有这个包。
 *
 * 换成运行期 require 后，打包器看不到这个字符串字面量以外的依赖关系，
 * 也就不会去 resolve 它。代价是少了类型推导——用 `import type` 补类型。
 */
const require_ = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require_("node:sqlite") as typeof import("node:sqlite");
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { 作业记录, 作业状态 } from "./types.js";

export class 作业存储 {
  private db: InstanceType<typeof DatabaseSync>;

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
      .all(夹取数量(limit)) as Array<Record<string, unknown>>;
    return rows.map(映射);
  }

  删除(id: string): void {
    this.db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  }

  关闭(): void {
    this.db.close();
  }
}

/** 内存日志缓冲的条数上限 */
export const 日志缓冲上限 = 2000;

/**
 * 把一行日志推进环形缓冲，超限就从头丢。
 *
 * 日志是**不能无限涨**的：长跑作业（比如一个挂一晚上的编译）
 * 能刷出几十万行，全留在内存里会把进程撑爆。
 *
 * 这里返回新数组而不原地改，是为了让「丢了多少条」可测——
 * 原地 splice 时测试只能看到最终长度，看不出是不是多丢了一条。
 */
export function 推入日志<T>(列表: T[], 条目: T, 上限 = 日志缓冲上限): T[] {
  const 新 = [...列表, 条目];
  if (新.length <= 上限) return 新;
  return 新.slice(新.length - 上限);
}

/**
 * 列表条数夹取。
 *
 * 上界 500 是防「一次拉十万条把内存打满」；下界 1 是因为
 * SQLite 的 `LIMIT 0` 返回空集——用户传 0 更可能是「忘了填」，给 1 条比给空更好排查。
 */
export function 夹取数量(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

/** 行 → 记录。导出的目的是单测：容错分支都在这里。 */
export function 映射(row: Record<string, unknown>): 作业记录 {
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

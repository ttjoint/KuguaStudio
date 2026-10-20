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

/**
 * 给已存在的老库补列。
 *
 * 为什么不用 `ALTER TABLE ... IF NOT EXISTS`：SQLite 没有这个语法，
 * 而 `ADD COLUMN` 在列已存在时会抛。所以必须自己查 `PRAGMA table_info`。
 *
 * 这一步不做的话，升级后打开旧 `jobs.db` 就是
 * `no such column: owner`——作业模块直接起不来，而用户完全不知道
 * 原因只是「之前跑过作业」。
 */
function 补列(db: InstanceType<typeof DatabaseSync>, 声明表: Array<[string, string]>): void {
  const 已有 = new Set(
    (db.prepare("PRAGMA table_info(jobs)").all() as Array<Record<string, unknown>>).map((r) => String(r.name)),
  );
  for (const [名, 类型] of 声明表) {
    if (已有.has(名)) continue;
    try {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${名} ${类型}`);
    } catch (err) {
      // 补列失败不该炸掉整个模块：缺列顶多是这一项显示为空
      console.warn(`[作业] 补列 ${名} 失败：${String(err)}`);
    }
  }
}

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
    补列(this.db, [
      ["owner", "TEXT NOT NULL DEFAULT ''"],
      ["origin", "TEXT NOT NULL DEFAULT 'user'"],
      ["attempt", "INTEGER NOT NULL DEFAULT 1"],
      ["progress_file", "TEXT NOT NULL DEFAULT ''"],
      ["capability", "TEXT"],
      ["capability_params", "TEXT"],
    ]);
  }

  保存(记录: 作业记录): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, title, command, args, cwd, shell, status, exit_code, started_at, ended_at, duration_ms, log_file, error,
                           owner, origin, attempt, progress_file, capability, capability_params)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, command=excluded.command, args=excluded.args, cwd=excluded.cwd,
           shell=excluded.shell, status=excluded.status, exit_code=excluded.exit_code,
           started_at=excluded.started_at, ended_at=excluded.ended_at, duration_ms=excluded.duration_ms,
           log_file=excluded.log_file, error=excluded.error,
           owner=excluded.owner, origin=excluded.origin, attempt=excluded.attempt,
           progress_file=excluded.progress_file, capability=excluded.capability,
           capability_params=excluded.capability_params`,
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
        记录.发起者,
        记录.来源,
        记录.尝试次数,
        记录.进度文件,
        记录.能力名,
        记录.能力参数 === undefined ? null : JSON.stringify(记录.能力参数),
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
    发起者: String(row.owner ?? ""),
    来源: 归一来源(row.origin),
    尝试次数: 归一尝试次数(row.attempt),
    进度文件: String(row.progress_file ?? ""),
    能力名: row.capability === null || row.capability === undefined ? null : String(row.capability),
    能力参数: 解析JSON列(row.capability_params),
  };
}

/**
 * `attempt` 兜底为 1。
 *
 * 这里**不能**写 `Number(row.attempt ?? 0)`——取不到时 `Number(null) === 0`
 * 会把「第一次跑」显示成「0」次，续跑逻辑还会拿它去算 ATTEMPT。
 * job 模块历史上在同样的地方栽过（映射 的三字段 null）。
 */
export function 归一尝试次数(值: unknown): number {
  if (值 === null || 值 === undefined) return 1;
  const n = Number(值);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.trunc(n);
}

/** `origin` 是补列默认值或脏数据时按 user 处理，不要统计出「未知来源」这种空类别 */
export function 归一来源(值: unknown): 作业记录["来源"] {
  const 文本 = String(值 ?? "").trim();
  if (文本 === "module" || 文本 === "plugin" || 文本 === "scheduler" || 文本 === "user") return 文本;
  return "user";
}

/** `capability_params` 是 JSON 文本列；解析失败返回 null 而不是抛 */
export function 解析JSON列(值: unknown): unknown {
  if (值 === null || 值 === undefined) return null;
  const 文本 = String(值);
  if (!文本) return null;
  try {
    return JSON.parse(文本);
  } catch {
    return null;
  }
}

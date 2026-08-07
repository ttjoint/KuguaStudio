import { readdir, stat, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { 索引选项 } from "./types.js";

/**
 * 判断路径是否应被排除
 */
function 是否排除(path: string, exclude?: string[]): boolean {
  if (!exclude || exclude.length === 0) return false;
  return exclude.some((pattern) => {
    try {
      return new RegExp(pattern).test(path);
    } catch {
      return path.includes(pattern);
    }
  });
}

/**
 * 判断文件是否为文本文件（按扩展名粗略判断）
 */
function 是文本文件(name: string): boolean {
  const 文本扩展名 = new Set([
    "txt", "md", "json", "js", "ts", "py", "cs", "java", "c", "cpp", "h",
    "html", "htm", "css", "xml", "yaml", "yml", "log", "csv", "ini", "conf",
  ]);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return 文本扩展名.has(ext);
}

/**
 * 同步计算哈希
 */
function 同步计算哈希(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface 索引结果 {
  /** 新增资源数 */
  added: number;
  /** 更新资源数 */
  updated: number;
  /** 移除资源数（已不存在于磁盘） */
  removed: number;
}

/**
 * 扫描目录并同步索引到数据库
 */
export async function 索引目录(
  db: Database.Database,
  rootPath: string,
  options: 索引选项 = {},
): Promise<索引结果> {
  const {
    maxDepth = Infinity,
    exclude = [],
    indexTextContent = true,
    maxTextSize = 10 * 1024 * 1024,
  } = options;

  const 当前时间 = Math.floor(Date.now() / 1000);

  const 查询资源 = db.prepare("SELECT id, sha256, node_id FROM resources WHERE path = ?");
  const 插入资源 = db.prepare(`
    INSERT INTO resources (path, name, size, modified_time, sha256, kind, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const 插入节点 = db.prepare(
    "INSERT INTO nodes (type, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
  );
  const 回填节点 = db.prepare("UPDATE resources SET node_id = ? WHERE id = ?");
  const 更新节点 = db.prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?");
  const 更新资源 = db.prepare(`
    UPDATE resources
    SET name = ?, size = ?, modified_time = ?, sha256 = ?, kind = ?, indexed_at = ?
    WHERE id = ?
  `);
  const 插入文本 = db.prepare(`
    INSERT INTO text_contents (resource_id, content, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(resource_id) DO UPDATE SET
      content = excluded.content,
      updated_at = excluded.updated_at
  `);
  const 删除文本 = db.prepare("DELETE FROM text_contents WHERE resource_id = ?");
  const 删除资源 = db.prepare("DELETE FROM resources WHERE id = ?");

  let added = 0;
  let updated = 0;

  async function 扫描(路径: string, 深度: number): Promise<void> {
    if (深度 > maxDepth) return;
    if (是否排除(路径, exclude)) return;

    const 信息 = await stat(路径);
    const 名称 = basename(路径);

    if (信息.isSymbolicLink()) return;
    const 是目录 = 信息.isDirectory();
    const 是文件 = 信息.isFile();
    if (!是目录 && !是文件) return;

    const hash = 是文件 ? 同步计算哈希(await readFile(路径)) : "";
    const kind = 是目录 ? "directory" : "file";
    const modifiedTime = Math.floor(信息.mtimeMs / 1000);

    const existing = 查询资源.get(路径) as { id: number; sha256: string; node_id: number | null } | undefined;

    if (existing) {
      const changed = existing.sha256 !== hash || 是目录;
      if (changed) {
        更新资源.run(名称, 是文件 ? 信息.size : 0, modifiedTime, hash, kind, 当前时间, existing.id);
        updated++;
      }
      // 确保已有资源也接入节点（兼容旧库）
      if (!existing.node_id) {
        const nres = 插入节点.run(是目录 ? "directory" : "file", 名称, 当前时间, 当前时间);
        回填节点.run(Number(nres.lastInsertRowid), existing.id);
      } else {
        更新节点.run(名称, 当前时间, existing.node_id);
      }
      if (是文件 && indexTextContent && 是文本文件(名称) && 信息.size <= maxTextSize) {
        try {
          const content = await readFile(路径, "utf-8");
          插入文本.run(existing.id, content, 当前时间);
        } catch {
          // 忽略编码错误
        }
      }
    } else {
      const result = 插入资源.run(
        路径,
        名称,
        是文件 ? 信息.size : 0,
        modifiedTime,
        hash,
        kind,
        当前时间,
      );
      added++;
      const id = Number(result.lastInsertRowid);
      // 创建统一内容节点并回填
      const nres = 插入节点.run(是目录 ? "directory" : "file", 名称, 当前时间, 当前时间);
      回填节点.run(Number(nres.lastInsertRowid), id);
      if (是文件 && indexTextContent && 是文本文件(名称) && 信息.size <= maxTextSize) {
        try {
          const content = await readFile(路径, "utf-8");
          插入文本.run(id, content, 当前时间);
        } catch {
          // 忽略编码错误
        }
      }
    }

    if (是目录) {
      const entries = await readdir(路径);
      for (const entry of entries) {
        await 扫描(join(路径, entry), 深度 + 1);
      }
    }
  }

  await 扫描(rootPath, 0);

  // 清理已不存在的资源
  const 所有已索引 = db.prepare("SELECT id, path FROM resources").all() as { id: number; path: string }[];
  let removed = 0;
  for (const { id, path } of 所有已索引) {
    try {
      await stat(path);
    } catch {
      删除文本.run(id);
      删除资源.run(id);
      removed++;
    }
  }

  return { added, updated, removed };
}

export { 是否排除, 是文本文件 };

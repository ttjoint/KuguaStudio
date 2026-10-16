/**
 * 知识库域方法：资源（查询 / 搜索 / 关系 / CRUD / 读取 / 导入）
 *
 * 从原单体 MKG 类拆出（P2 结构化改造），以原型安装方式挂到 MKG.prototype。
 */
import { existsSync, statSync, renameSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import type Database from "better-sqlite3";
import { 索引目录, type 索引结果 } from "../indexer.js";
import type {
  资源,
  资源关系类型,
  索引选项,
  搜索选项,
  搜索结果,
  资源详情,
} from "../types.js";

declare module "../index.js" {
  interface MKG {
    getResource(id: number): 资源 | undefined;
    getResource(path: string): 资源 | undefined;
    getResource(idOrPath: number | string): 资源 | undefined;
    searchByTags(tagIds: number[], options?: 搜索选项): 搜索结果<资源>;
    searchByPath(keyword: string, options?: 搜索选项): 搜索结果<资源>;
    searchByContent(keyword: string, options?: 搜索选项): 搜索结果<资源 & { snippet: string }>;
    addRelation(fromResourceId: number, toResourceId: number, relationType: 资源关系类型): void;
    getRelations(resourceId: number, relationType?: 资源关系类型): { toResourceId: number; relationType: 资源关系类型 }[];
    createResource(
      path: string,
      name: string,
      kind: "file" | "directory",
      options?: { size?: number; modifiedTime?: number; sha256?: string },
    ): 资源;
    deleteResource(id: number): void;
    deleteNode(nodeId: number): void;
    getResourceByNode(nodeId: number): 资源 | undefined;
    renameNodeTitle(nodeId: number, title: string): void;
    查询重复文件(hash: string, 排除路径?: string): 资源 | undefined;
    renameResourceFile(resourceId: number, newName: string): 资源详情;
    trashResource(resourceId: number): Promise<{ success: boolean; trashed: boolean; path: string }>;
    listResources(options?: 搜索选项): 搜索结果<资源>;
    listResourcesByTag(tagId: number, options?: 搜索选项): 搜索结果<资源>;
    importPath(path: string, options?: 索引选项): Promise<索引结果>;
    readContent(path: string): string | null;
    readContent(resourceId: number): string | null;
    readContent(idOrPath: number | string): string | null;
    获取扩展名(name: string): string;
    推断MimeType(extension: string): string;
    获取标签路径(tagId: number): string[];
  }
}

interface 上下文 {
  db: Database.Database;
  async?: never;
  getResource(idOrPath: number | string): 资源 | undefined;
  getAlias(resourceId: number): string | null;
  getResourceDetail(idOrPath: number | string): 资源详情 | undefined;
  deleteResource(id: number): void;
  查询重复文件(hash: string, 排除路径?: string): 资源 | undefined;
  setAlias(resourceId: number, alias: string): void;
  tagResource(resourceId: number, tagId: number): void;
}

export function 安装资源域(proto: { [k: string]: unknown }): void {
  proto.getResource = function (this: 上下文, idOrPath: number | string): 资源 | undefined {
    if (typeof idOrPath === "number") {
      return this.db
        .prepare("SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt FROM resources WHERE id = ?")
        .get(idOrPath) as 资源 | undefined;
    }
    return this.db
      .prepare("SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt FROM resources WHERE path = ?")
      .get(idOrPath) as 资源 | undefined;
  };

  proto.searchByTags = function (this: 上下文, tagIds: number[], options: 搜索选项 = {}): 搜索结果<资源> {
    const { limit = 50, offset = 0 } = options;
    if (tagIds.length === 0) {
      return { total: 0, items: [] };
    }

    const placeholders = tagIds.map(() => "?").join(",");
    const totalRow = this.db
      .prepare(`
        SELECT COUNT(*) as total FROM (
          SELECT r.id
          FROM resources r
          JOIN resource_tags rt ON rt.resource_id = r.id
          WHERE rt.tag_id IN (${placeholders})
          GROUP BY r.id
          HAVING COUNT(DISTINCT rt.tag_id) = ?
        )
      `)
      .get(...tagIds, tagIds.length) as { total: number } | undefined;

    const items = this.db
      .prepare(`
        SELECT r.id, r.path, r.name, r.size, r.modified_time as modifiedTime, r.sha256, r.kind, r.indexed_at as indexedAt
        FROM resources r
        JOIN resource_tags rt ON rt.resource_id = r.id
        WHERE rt.tag_id IN (${placeholders})
        GROUP BY r.id
        HAVING COUNT(DISTINCT rt.tag_id) = ?
        LIMIT ? OFFSET ?
      `)
      .all(...tagIds, tagIds.length, limit, offset) as 资源[];

    return { total: totalRow?.total ?? 0, items };
  };

  proto.searchByPath = function (this: 上下文, keyword: string, options: 搜索选项 = {}): 搜索结果<资源> {
    const { limit = 50, offset = 0 } = options;
    const pattern = `%${keyword}%`;
    const totalRow = this.db
      .prepare("SELECT COUNT(*) as total FROM resources WHERE path LIKE ? OR name LIKE ?")
      .get(pattern, pattern) as { total: number };
    const items = this.db
      .prepare(`
        SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt
        FROM resources
        WHERE path LIKE ? OR name LIKE ?
        LIMIT ? OFFSET ?
      `)
      .all(pattern, pattern, limit, offset) as 资源[];
    return { total: totalRow.total, items };
  };

  proto.searchByContent = function (
    this: 上下文,
    keyword: string,
    options: 搜索选项 = {},
  ): 搜索结果<资源 & { snippet: string }> {
    const { limit = 50, offset = 0 } = options;
    const pattern = `%${keyword}%`;
    const totalRow = this.db
      .prepare("SELECT COUNT(*) as total FROM text_contents WHERE content LIKE ?")
      .get(pattern) as { total: number };
    const rows = this.db
      .prepare(`
        SELECT r.id, r.path, r.name, r.size, r.modified_time as modifiedTime, r.sha256, r.kind, r.indexed_at as indexedAt,
               tc.content as snippet
        FROM text_contents tc
        JOIN resources r ON r.id = tc.resource_id
        WHERE tc.content LIKE ?
        LIMIT ? OFFSET ?
      `)
      .all(pattern, limit, offset) as (资源 & { snippet: string })[];
    return { total: totalRow.total, items: rows };
  };

  proto.addRelation = function (
    this: 上下文,
    fromResourceId: number,
    toResourceId: number,
    relationType: 资源关系类型,
  ): void {
    const 当前时间 = Math.floor(Date.now() / 1000);
    this.db
      .prepare("INSERT OR IGNORE INTO resource_relations (from_resource_id, to_resource_id, relation_type, created_at) VALUES (?, ?, ?, ?)")
      .run(fromResourceId, toResourceId, relationType, 当前时间);
  };

  proto.getRelations = function (
    this: 上下文,
    resourceId: number,
    relationType?: 资源关系类型,
  ): { toResourceId: number; relationType: 资源关系类型 }[] {
    if (relationType) {
      return this.db
        .prepare("SELECT to_resource_id as toResourceId, relation_type as relationType FROM resource_relations WHERE from_resource_id = ? AND relation_type = ?")
        .all(resourceId, relationType) as { toResourceId: number; relationType: 资源关系类型 }[];
    }
    return this.db
      .prepare("SELECT to_resource_id as toResourceId, relation_type as relationType FROM resource_relations WHERE from_resource_id = ?")
      .all(resourceId) as { toResourceId: number; relationType: 资源关系类型 }[];
  };

  proto.createResource = function (
    this: 上下文,
    path: string,
    name: string,
    kind: "file" | "directory",
    options?: { size?: number; modifiedTime?: number; sha256?: string },
  ): 资源 {
    const 当前时间 = Math.floor(Date.now() / 1000);
    const sha256 = options?.sha256 ?? (kind === "file" ? "" : "");
    const stmt = this.db.prepare(`
      INSERT INTO resources (path, name, size, modified_time, sha256, kind, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        size = excluded.size,
        modified_time = excluded.modified_time,
        sha256 = excluded.sha256,
        kind = excluded.kind,
        indexed_at = excluded.indexed_at
      RETURNING id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt
    `);
    const row = stmt.get(
      path,
      name,
      options?.size ?? 0,
      options?.modifiedTime ?? 当前时间,
      sha256,
      kind,
      当前时间,
    ) as 资源;
    return row;
  };

  proto.deleteResource = function (this: 上下文, id: number): void {
    // 同步删除关联的统一内容节点（resources.node_id 无外键，需显式删除）
    const row = this.db.prepare("SELECT node_id FROM resources WHERE id = ?").get(id) as
      | { node_id: number | null }
      | undefined;
    this.db.prepare("DELETE FROM resources WHERE id = ?").run(id);
    if (row?.node_id != null) {
      this.db.prepare("DELETE FROM nodes WHERE id = ?").run(row.node_id);
    }
  };

  proto.deleteNode = function (this: 上下文, nodeId: number): void {
    const row = this.db.prepare("SELECT id FROM resources WHERE node_id = ?").get(nodeId) as
      | { id: number }
      | undefined;
    if (row) {
      this.deleteResource(row.id);
      return;
    }
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(nodeId);
  };

  proto.getResourceByNode = function (this: 上下文, nodeId: number): 资源 | undefined {
    return this.db
      .prepare(
        "SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt FROM resources WHERE node_id = ?",
      )
      .get(nodeId) as 资源 | undefined;
  };

  proto.renameNodeTitle = function (this: 上下文, nodeId: number, title: string): void {
    this.db
      .prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, Math.floor(Date.now() / 1000), nodeId);
  };

  proto.查询重复文件 = function (this: 上下文, hash: string, 排除路径?: string): 资源 | undefined {
    if (!hash) return undefined;
    const row = this.db
      .prepare(
        "SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt FROM resources WHERE sha256 = ? AND kind = 'file' LIMIT 1",
      )
      .get(hash) as 资源 | undefined;
    if (!row) return undefined;
    if (排除路径 && row.path === 排除路径) return undefined;
    return row;
  };

  proto.renameResourceFile = function (this: 上下文, resourceId: number, newName: string): 资源详情 {
    const 资源 = this.getResource(resourceId);
    if (!资源) throw new Error("资源不存在");
    if (资源.kind !== "file") throw new Error("只有文件可以重命名真实文件名");
    const 名称 = newName.trim();
    if (!名称) throw new Error("文件名不能为空");
    if (名称.includes("/") || 名称.includes("\\") || 名称.includes(":") || 名称.includes("*") || 名称.includes("?") || 名称.includes('"') || 名称.includes("<") || 名称.includes(">") || 名称.includes("|")) {
      throw new Error("文件名不能包含以下字符：\\ / : * ? \" < > |");
    }
    if (名称 === 资源.name) return this.getResourceDetail(resourceId)!;
    const 新路径 = join(dirname(资源.path), 名称);
    if (existsSync(新路径)) {
      throw new Error(`无法完成操作，因为包含名为“${名称}”的项已存在。请指定其他名称。`);
    }
    try {
      renameSync(资源.path, 新路径);
    } catch (err) {
      const 消息 = err instanceof Error ? err.message : String(err);
      throw new Error(`重命名文件失败（可能被占用或无权限）：${消息}`);
    }
    const 当前时间 = Math.floor(Date.now() / 1000);
    this.db
      .prepare("UPDATE resources SET path = ?, name = ?, modified_time = ? WHERE id = ?")
      .run(新路径, 名称, 当前时间, resourceId);
    const 节点ID = this.db.prepare("SELECT node_id FROM resources WHERE id = ?").get(resourceId) as
      | { node_id: number | null }
      | undefined;
    // 知识库名称（别名）若已被用户定制则保留，否则跟随真实文件名
    const 已有别名 = this.getAlias(resourceId);
    if (节点ID?.node_id != null && 已有别名 === null) {
      this.db.prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?").run(名称, 当前时间, 节点ID.node_id);
    }
    return this.getResourceDetail(resourceId)!;
  };

  proto.trashResource = async function (
    this: 上下文,
    resourceId: number,
  ): Promise<{ success: boolean; trashed: boolean; path: string }> {
    const 资源 = this.getResource(resourceId);
    if (!资源) throw new Error("资源不存在");
    if (资源.kind !== "file" && 资源.kind !== "directory") throw new Error("仅文件/目录可移到回收站");
    let trashed = false;
    if (existsSync(资源.path)) {
      trashed = await 移入回收站(资源.path, 资源.kind === "directory");
      if (!trashed) throw new Error("移入回收站失败（可能被占用或无权限）");
    }
    this.deleteResource(resourceId);
    return { success: true, trashed, path: 资源.path };
  };

  proto.listResources = function (this: 上下文, options: 搜索选项 = {}): 搜索结果<资源> {
    const { limit = 50, offset = 0 } = options;
    const totalRow = this.db.prepare("SELECT COUNT(*) as total FROM resources").get() as { total: number };
    const items = this.db
      .prepare("SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt FROM resources LIMIT ? OFFSET ?")
      .all(limit, offset) as 资源[];
    return { total: totalRow.total, items };
  };

  proto.listResourcesByTag = function (this: 上下文, tagId: number, options: 搜索选项 = {}): 搜索结果<资源> {
    const { limit = 50, offset = 0 } = options;
    const totalRow = this.db
      .prepare("SELECT COUNT(*) as total FROM resource_tags WHERE tag_id = ?")
      .get(tagId) as { total: number };
    const items = this.db
      .prepare(`
        SELECT r.id, r.path, r.name, r.size, r.modified_time as modifiedTime, r.sha256, r.kind, r.indexed_at as indexedAt
        FROM resources r
        JOIN resource_tags rt ON rt.resource_id = r.id
        WHERE rt.tag_id = ?
        LIMIT ? OFFSET ?
      `)
      .all(tagId, limit, offset) as 资源[];
    return { total: totalRow.total, items };
  };

  proto.importPath = async function (this: 上下文, path: string, options?: 索引选项): Promise<索引结果> {
    if (!existsSync(path)) throw new Error(`路径不存在：${path}`);
    const stat = statSync(path);
    if (stat.isFile()) {
      // 导入去重：资料库已有完全一致的文件（sha256 相同且路径不同）则不再导入
      const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
      const 重复 = this.查询重复文件(hash, path);
      if (重复) {
        return {
          added: 0,
          updated: 0,
          removed: 0,
          duplicate: { id: 重复.id, path: 重复.path, name: 重复.name },
        };
      }
      return 索引目录(this.db, path, { ...options, maxDepth: 0 });
    }
    if (stat.isDirectory()) {
      return 索引目录(this.db, path, options);
    }
    throw new Error(`不支持导入的类型：${path}`);
  };

  proto.readContent = function (this: 上下文, idOrPath: number | string): string | null {
    if (typeof idOrPath === "number") {
      const row = this.db
        .prepare("SELECT content FROM text_contents WHERE resource_id = ?")
        .get(idOrPath) as { content: string } | undefined;
      return row?.content ?? null;
    }
    const row = this.db
      .prepare(`
        SELECT tc.content
        FROM text_contents tc
        JOIN resources r ON r.id = tc.resource_id
        WHERE r.path = ?
      `)
      .get(idOrPath) as { content: string } | undefined;
    return row?.content ?? null;
  };

  proto.获取扩展名 = function (this: 上下文, name: string): string {
    void this;
    return extname(name).toLowerCase();
  };

  proto.推断MimeType = function (this: 上下文, extension: string): string {
    void this;
    const textExts = [".txt", ".json", ".csv", ".md", ".markdown", ".xml", ".html", ".htm", ".css", ".scss", ".sass", ".less", ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".scala", ".r", ".lua", ".dart", ".sql", ".sh", ".bash", ".bat", ".cmd", ".ps1", ".vbs", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".log", ".env"];
    const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".ico", ".tiff", ".tif"];
    const audioExts = [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a"];
    const videoExts = [".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm"];
    const pdfExts = [".pdf"];
    const zipExts = [".zip", ".rar", ".7z", ".tar", ".gz", ".bz2"];

    if (textExts.includes(extension)) {
      if (extension === ".json") return "application/json";
      if (extension === ".xml") return "application/xml";
      if (extension === ".html" || extension === ".htm") return "text/html";
      if (extension === ".css") return "text/css";
      if (extension === ".javascript" || extension === ".js" || extension === ".mjs" || extension === ".cjs" || extension === ".ts" || extension === ".tsx" || extension === ".jsx") return "text/javascript";
      return "text/plain";
    }
    if (imageExts.includes(extension)) {
      if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
      if (extension === ".png") return "image/png";
      if (extension === ".gif") return "image/gif";
      if (extension === ".svg") return "image/svg+xml";
      if (extension === ".webp") return "image/webp";
      return "image/*";
    }
    if (audioExts.includes(extension)) return "audio/*";
    if (videoExts.includes(extension)) return "video/*";
    if (pdfExts.includes(extension)) return "application/pdf";
    if (zipExts.includes(extension)) return "application/zip";
    return "application/octet-stream";
  };

  proto.获取标签路径 = function (this: 上下文, tagId: number): string[] {
    const path: string[] = [];
    let currentId: number | null = tagId;
    const visited = new Set<number>();
    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      const tag = this.db
        .prepare("SELECT id, name, parent_id FROM tags WHERE id = ?")
        .get(currentId) as { id: number; name: string; parent_id: number | null } | undefined;
      if (!tag) break;
      path.unshift(tag.name);
      currentId = tag.parent_id;
    }
    return path;
  };
}

/**
 * 把文件/目录移到系统回收站（Windows 使用 VisualBasic 文件系统 API）
 */
function 移入回收站(路径: string, 是目录: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const 方法 = 是目录 ? "DeleteDirectory" : "DeleteFile";
    const 命令 = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${方法}('${路径.replace(/'/g, "''")}','OnlyErrorDialogs','SendToRecycleBin')`;
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", 命令],
      { timeout: 15000, windowsHide: true },
      (err: Error | null) => resolve(!err),
    );
  });
}

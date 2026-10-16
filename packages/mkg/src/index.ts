import { existsSync, statSync, mkdirSync, copyFileSync, renameSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { exec, execFile, spawn } from "node:child_process";
import { 初始化数据库 } from "./db.js";
import { 索引目录, type 索引结果 } from "./indexer.js";
import { 安装笔记域 } from "./domains/notes.js";
import { 安装素材域 } from "./domains/materials.js";
import { 安装片段域 } from "./domains/snippets.js";
import { 安装看板域 } from "./domains/board.js";
import { 安装节点域 } from "./domains/nodes.js";
import { 安装视图位置域 } from "./domains/views.js";
import type Database from "better-sqlite3";
import type {
  资源,
  标签,
  资源关系类型,
  索引选项,
  搜索选项,
  搜索结果,
  资源详情,
  打开方式配置,
  导入文件结果,
} from "./types.js";

export * from "./types.js";
export * from "./sidecar.js";
export { 索引目录, 初始化数据库, type 索引结果 };

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

/**
 * 苦瓜知识图谱主类
 */
export class MKG {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = 初始化数据库(dbPath);
  }

  /**
   * 索引指定目录
   */
  async index(rootPath: string, options?: 索引选项): Promise<索引结果> {
    return 索引目录(this.db, rootPath, options);
  }

  /**
   * 创建标签
   */
  createTag(name: string, parentId?: number | null, description?: string): 标签 {
    const 当前时间 = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      INSERT INTO tags (name, parent_id, description, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        parent_id = excluded.parent_id,
        description = excluded.description
      RETURNING id, name, parent_id, description
    `);
    const row = stmt.get(
      name,
      parentId ?? null,
      description ?? null,
      当前时间,
    ) as unknown as { id: number; name: string; parent_id: number | null; description: string | null };
    return { id: row.id, name: row.name, parentId: row.parent_id ?? null, description: row.description };
  }

  /**
   * 列出标签，可指定父标签筛选
   */
  listTags(parentId?: number | null): 标签[] {
    const rows =
      parentId === undefined
        ? (this.db.prepare("SELECT id, name, parent_id, description FROM tags").all() as unknown as { id: number; name: string; parent_id: number | null; description: string | null }[])
        : (this.db
            .prepare("SELECT id, name, parent_id, description FROM tags WHERE parent_id = ?")
            .all(parentId) as unknown as { id: number; name: string; parent_id: number | null; description: string | null }[]);
    return rows.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id ?? null, description: t.description }));
  }

  /**
   * 删除标签，会级联删除关联
   */
  deleteTag(id: number): void {
    this.db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  }

  /**
   * 给资源打标签
   */
  tagResource(resourceId: number, tagId: number): void {
    const 当前时间 = Math.floor(Date.now() / 1000);
    this.db
      .prepare("INSERT OR IGNORE INTO resource_tags (resource_id, tag_id, created_at) VALUES (?, ?, ?)")
      .run(resourceId, tagId, 当前时间);
  }

  /**
   * 移除资源的标签
   */
  untagResource(resourceId: number, tagId: number): void {
    this.db
      .prepare("DELETE FROM resource_tags WHERE resource_id = ? AND tag_id = ?")
      .run(resourceId, tagId);
  }

  /**
   * 获取资源的所有标签
   */
  getResourceTags(resourceId: number): 标签[] {
    const rows = this.db
      .prepare(`
        SELECT t.id, t.name, t.parent_id, t.description
        FROM tags t
        JOIN resource_tags rt ON rt.tag_id = t.id
        WHERE rt.resource_id = ?
      `)
      .all(resourceId) as unknown as { id: number; name: string; parent_id: number | null; description: string | null }[];
    return rows.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id ?? null, description: t.description }));
  }

  /**
   * 按 id 或绝对路径获取资源
   */
  getResource(id: number): 资源 | undefined;
  getResource(path: string): 资源 | undefined;
  getResource(idOrPath: number | string): 资源 | undefined {
    if (typeof idOrPath === "number") {
      return this.db
        .prepare("SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt FROM resources WHERE id = ?")
        .get(idOrPath) as 资源 | undefined;
    }
    return this.db
      .prepare("SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt FROM resources WHERE path = ?")
      .get(idOrPath) as 资源 | undefined;
  }

  /**
   * 按标签搜索资源（AND 关系）
   */
  searchByTags(tagIds: number[], options: 搜索选项 = {}): 搜索结果<资源> {
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
  }

  /**
   * 按路径或文件名模糊搜索
   */
  searchByPath(keyword: string, options: 搜索选项 = {}): 搜索结果<资源> {
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
  }

  /**
   * 按文本内容搜索
   */
  searchByContent(keyword: string, options: 搜索选项 = {}): 搜索结果<资源 & { snippet: string }> {
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
  }

  /**
   * 添加资源间关系
   */
  addRelation(fromResourceId: number, toResourceId: number, relationType: 资源关系类型): void {
    const 当前时间 = Math.floor(Date.now() / 1000);
    this.db
      .prepare("INSERT OR IGNORE INTO resource_relations (from_resource_id, to_resource_id, relation_type, created_at) VALUES (?, ?, ?, ?)")
      .run(fromResourceId, toResourceId, relationType, 当前时间);
  }

  /**
   * 获取资源的关系
   */
  getRelations(resourceId: number, relationType?: 资源关系类型): { toResourceId: number; relationType: 资源关系类型 }[] {
    if (relationType) {
      return this.db
        .prepare("SELECT to_resource_id as toResourceId, relation_type as relationType FROM resource_relations WHERE from_resource_id = ? AND relation_type = ?")
        .all(resourceId, relationType) as { toResourceId: number; relationType: 资源关系类型 }[];
    }
    return this.db
      .prepare("SELECT to_resource_id as toResourceId, relation_type as relationType FROM resource_relations WHERE from_resource_id = ?")
      .all(resourceId) as { toResourceId: number; relationType: 资源关系类型 }[];
  }

  /**
   * 创建一条资源记录（不检查磁盘）
   */
  createResource(
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
  }

  /**
   * 删除资源（级联删除标签、关系、文本内容）
   */
  deleteResource(id: number): void {
    // 同步删除关联的统一内容节点（resources.node_id 无外键，需显式删除）
    const row = this.db.prepare("SELECT node_id FROM resources WHERE id = ?").get(id) as
      | { node_id: number | null }
      | undefined;
    this.db.prepare("DELETE FROM resources WHERE id = ?").run(id);
    if (row?.node_id != null) {
      this.db.prepare("DELETE FROM nodes WHERE id = ?").run(row.node_id);
    }
  }

  /** 按节点删除（节点及其资源一起移除，支持统一浏览窗口的批量删除） */
  deleteNode(nodeId: number): void {
    const row = this.db.prepare("SELECT id FROM resources WHERE node_id = ?").get(nodeId) as
      | { id: number }
      | undefined;
    if (row) {
      this.deleteResource(row.id);
      return;
    }
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(nodeId);
  }

  /** 按节点查询关联资源（无资源返回 undefined） */
  getResourceByNode(nodeId: number): 资源 | undefined {
    return this.db
      .prepare(
        "SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt FROM resources WHERE node_id = ?",
      )
      .get(nodeId) as 资源 | undefined;
  }

  /** 重命名节点标题（非资源节点，如文本段/点子/素材） */
  renameNodeTitle(nodeId: number, title: string): void {
    this.db
      .prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, Math.floor(Date.now() / 1000), nodeId);
  }

  /** 按 sha256 查询资料库中已存在的完全一致文件（同路径重扫不算重复） */
  查询重复文件(hash: string, 排除路径?: string): 资源 | undefined {
    if (!hash) return undefined;
    const row = this.db
      .prepare(
        "SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt FROM resources WHERE sha256 = ? AND kind = 'file' LIMIT 1",
      )
      .get(hash) as 资源 | undefined;
    if (!row) return undefined;
    if (排除路径 && row.path === 排除路径) return undefined;
    return row;
  }

  /** 重命名真实物理文件（仅文件），更新数据库路径/名称与节点标题；出错时抛出与资源管理器类似的错误 */
  renameResourceFile(resourceId: number, newName: string): 资源详情 {
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
  }

  /** 从知识库移除并删除到系统回收站（仅文件/目录；Windows 走 VisualBasic 回收站） */
  async trashResource(resourceId: number): Promise<{ success: boolean; trashed: boolean; path: string }> {
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
  }

  /**
   * 列出所有资源，支持分页
   */
  listResources(options: 搜索选项 = {}): 搜索结果<资源> {
    const { limit = 50, offset = 0 } = options;
    const totalRow = this.db.prepare("SELECT COUNT(*) as total FROM resources").get() as { total: number };
    const items = this.db
      .prepare("SELECT id, path, name, size, modified_time as modifiedTime, sha256, kind, indexed_at as indexedAt FROM resources LIMIT ? OFFSET ?")
      .all(limit, offset) as 资源[];
    return { total: totalRow.total, items };
  }

  /**
   * 按单个标签列出资源
   */
  listResourcesByTag(tagId: number, options: 搜索选项 = {}): 搜索结果<资源> {
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
  }

  /**
   * 导入单个文件或目录
   */
  async importPath(path: string, options?: 索引选项): Promise<索引结果> {
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
  }

  /**
   * 按路径读取已索引文本资源的完整内容
   * 若资源不存在或无文本内容则返回 null
   */
  readContent(path: string): string | null;
  readContent(resourceId: number): string | null;
  readContent(idOrPath: number | string): string | null {
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
  }

  private 获取扩展名(name: string): string {
    return extname(name).toLowerCase();
  }

  private 推断MimeType(extension: string): string {
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
      if (extension === ".javascript" || extension === ".js" || extension === ".mjs") return "text/javascript";
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
  }

  private 获取标签路径(tagId: number): string[] {
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
  }

  setAlias(resourceId: number, alias: string): void {
    this.db
      .prepare(`
        INSERT INTO resource_aliases (resource_id, alias)
        VALUES (?, ?)
        ON CONFLICT(resource_id) DO UPDATE SET alias = excluded.alias
      `)
      .run(resourceId, alias);
    // 知识库内命名：同步到统一内容节点的展示标题
    const 节点ID = this.db.prepare("SELECT node_id FROM resources WHERE id = ?").get(resourceId) as
      | { node_id: number | null }
      | undefined;
    if (节点ID?.node_id != null) {
      this.db
        .prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?")
        .run(alias, Math.floor(Date.now() / 1000), 节点ID.node_id);
    }
  }

  getAlias(resourceId: number): string | null {
    const row = this.db
      .prepare("SELECT alias FROM resource_aliases WHERE resource_id = ?")
      .get(resourceId) as { alias: string } | undefined;
    return row?.alias ?? null;
  }

  getAliasByPath(path: string): string | null {
    const row = this.db
      .prepare(`
        SELECT ra.alias
        FROM resource_aliases ra
        JOIN resources r ON r.id = ra.resource_id
        WHERE r.path = ?
      `)
      .get(path) as { alias: string } | undefined;
    return row?.alias ?? null;
  }

  getDisplayName(resourceId: number): string {
    const alias = this.getAlias(resourceId);
    if (alias !== null) return alias;
    const resource = this.getResource(resourceId);
    return resource?.name ?? "";
  }

  renameResource(resourceId: number, newAlias: string): void {
    this.setAlias(resourceId, newAlias);
  }

  setOpenWith(extension: string, programPath: string, args?: string, label?: string): 打开方式配置 {
    const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    const argumentsStr = args ?? '"{0}"';
    const stmt = this.db.prepare(`
      INSERT INTO open_with_config (extension, program_path, arguments, label)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(extension) DO UPDATE SET
        program_path = excluded.program_path,
        arguments = excluded.arguments,
        label = excluded.label
      RETURNING id, extension, program_path as programPath, arguments, label
    `);
    return stmt.get(ext, programPath, argumentsStr, label ?? null) as 打开方式配置;
  }

  getOpenWith(extension: string): 打开方式配置 | null {
    const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    const row = this.db
      .prepare("SELECT id, extension, program_path as programPath, arguments, label FROM open_with_config WHERE extension = ?")
      .get(ext) as 打开方式配置 | undefined;
    return row ?? null;
  }

  listOpenWith(): 打开方式配置[] {
    return this.db
      .prepare("SELECT id, extension, program_path as programPath, arguments, label FROM open_with_config ORDER BY extension")
      .all() as 打开方式配置[];
  }

  deleteOpenWith(id: number): void {
    this.db.prepare("DELETE FROM open_with_config WHERE id = ?").run(id);
  }

  getPhysicalPath(resourceId: number): string | null {
    const row = this.db
      .prepare("SELECT path FROM resources WHERE id = ?")
      .get(resourceId) as { path: string } | undefined;
    return row?.path ?? null;
  }

  openInExplorer(resourceId: number): boolean {
    const path = this.getPhysicalPath(resourceId);
    if (!path) return false;
    try {
      exec(`explorer.exe /select,"${path}"`);
      return true;
    } catch {
      return false;
    }
  }

  openWithProgram(resourceId: number, programPath?: string): boolean {
    const filePath = this.getPhysicalPath(resourceId);
    if (!filePath) return false;
    try {
      if (programPath) {
        const ext = this.获取扩展名(basename(filePath));
        const config = this.getOpenWith(ext);
        const args = config?.arguments ?? '"{0}"';
        const formattedArgs = args.replace("{0}", filePath);
        const argParts = formattedArgs.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [filePath];
        const processedArgs = argParts.map(a => a.startsWith('"') && a.endsWith('"') ? a.slice(1, -1) : a);
        spawn(programPath, processedArgs, { detached: true, stdio: "ignore" });
        return true;
      } else {
        const ext = this.获取扩展名(basename(filePath));
        const config = this.getOpenWith(ext);
        if (config) {
          const formattedArgs = config.arguments.replace("{0}", filePath);
          const argParts = formattedArgs.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [filePath];
          const processedArgs = argParts.map(a => a.startsWith('"') && a.endsWith('"') ? a.slice(1, -1) : a);
          spawn(config.programPath, processedArgs, { detached: true, stdio: "ignore" });
        } else {
          spawn("cmd.exe", ["/c", "start", "", filePath], { detached: true, stdio: "ignore" });
        }
        return true;
      }
    } catch {
      return false;
    }
  }

  getTagTree(): Array<标签 & { children: 标签[] }> {
    const allTags = this.listTags();
    const tagMap = new Map<number, 标签 & { children: 标签[] }>();
    const roots: Array<标签 & { children: 标签[] }> = [];

    for (const tag of allTags) {
      tagMap.set(tag.id, { ...tag, children: [] });
    }

    for (const tag of tagMap.values()) {
      if (tag.parentId !== null && tagMap.has(tag.parentId)) {
        tagMap.get(tag.parentId)!.children.push(tag);
      } else {
        roots.push(tag);
      }
    }

    return roots;
  }

  /**
   * 获取动态标签树：仅当某标签的对象集完全被另一标签涵盖时，才建立父子嵌套。
   * 父为「最接近的、完全包含本标签对象集」的标签（即集合最小的超集）。
   * 对象集为「资源 + 节点」的统一集合（资源用 R 前缀、节点用 N 前缀避免 id 撞车）。
   * 该父子关系随带标签对象的增改而动态重算，不符合子节点关系时自动调整；
   * "未分类" 恒为最外层分类，不参与父子嵌套（由前端作为根节点渲染）。
   */
  获取动态标签树(): Array<标签 & { children: 标签[] }> {
    const resourcePairs = this.db
      .prepare("SELECT tag_id, 'R' || resource_id AS objId FROM resource_tags")
      .all() as { tag_id: number; objId: string }[];
    const nodePairs = this.db
      .prepare("SELECT tag_id, 'N' || node_id AS objId FROM node_tags")
      .all() as { tag_id: number; objId: string }[];

    const 标签对象 = new Map<number, Set<string>>();
    for (const p of [...resourcePairs, ...nodePairs]) {
      if (!标签对象.has(p.tag_id)) 标签对象.set(p.tag_id, new Set());
      标签对象.get(p.tag_id)!.add(p.objId);
    }
    const 全部标签 = this.listTags();
    // 补上无对象标签（空集），作为可显示的叶节点
    for (const t of 全部标签) if (!标签对象.has(t.id)) 标签对象.set(t.id, new Set());

    // 为每个标签找「最接近的完全超集」作为父
    const 父 = new Map<number, number | null>();
    for (const id of 标签对象.keys()) {
      const setA = 标签对象.get(id)!;
      if (setA.size === 0) { 父.set(id, null); continue; }
      let 严格父: number | null = null;
      let 严格父大小 = Infinity;
      let 重合父: number | null = null; // 对象集完全重合时，以较小 id 者为父
      for (const [pid, setB] of 标签对象) {
        if (pid === id) continue;
        if (setB.size < setA.size) continue;
        let 包含 = true;
        for (const o of setA) if (!setB.has(o)) { 包含 = false; break; }
        if (!包含) continue;
        if (setB.size > setA.size) {
          if (setB.size < 严格父大小) { 严格父 = pid; 严格父大小 = setB.size; }
        } else if (重合父 === null || pid < 重合父) {
          重合父 = pid;
        }
      }
      父.set(id, 严格父 !== null ? 严格父 : (重合父 !== null && 重合父 < id ? 重合父 : null));
    }

    const nodes = new Map<number, 标签 & { children: 标签[]; count: number }>();
    for (const t of 全部标签) nodes.set(t.id, { ...t, children: [], count: 标签对象.get(t.id)?.size ?? 0 });
    const roots: Array<标签 & { children: 标签[]; count: number }> = [];
    for (const id of 标签对象.keys()) {
      const p = 父.get(id);
      const node = nodes.get(id)!;
      if (p == null || !nodes.has(p)) roots.push(node);
      else nodes.get(p)!.children.push(node);
    }
    return roots;
  }

  getResourceTagPaths(resourceId: number): string[][] {
    const tags = this.getResourceTags(resourceId);
    return tags.map(tag => this.获取标签路径(tag.id));
  }

  /**
   * 获取与指定标签语义相关的标签（基于共现频率，tf-idf/PMI 风格加权）
   * 相关度 = 共现对象数 × 信息量(PMI)，既体现共现频率，又抑制高频通用标签。
   * 对象为「资源」与「节点」的统一集合：两标签被同一对象引用即视为一次共现。
   */
  getRelatedTags(tagId: number, limit = 12): Array<{ tag: 标签; 共现: number; 相关度: number }> {
    // 收集所有「标签 → 对象」映射：资源与节点统一视为对象（用类型前缀区分，避免 id 撞车）
    const resourcePairs = this.db
      .prepare("SELECT tag_id, 'R' || resource_id AS objId FROM resource_tags")
      .all() as { tag_id: number; objId: string }[];
    const nodePairs = this.db
      .prepare("SELECT tag_id, 'N' || node_id AS objId FROM node_tags")
      .all() as { tag_id: number; objId: string }[];

    const 标签对象 = new Map<number, Set<string>>();
    const 全部对象 = new Set<string>();
    for (const p of [...resourcePairs, ...nodePairs]) {
      全部对象.add(p.objId);
      if (!标签对象.has(p.tag_id)) 标签对象.set(p.tag_id, new Set());
      标签对象.get(p.tag_id)!.add(p.objId);
    }

    const 对象A = 标签对象.get(tagId);
    if (!对象A || 对象A.size === 0) return [];

    const n = 全部对象.size; // 有标签的对象总数
    const countA = 对象A.size;

    const 候选: Array<{ tagId: number; co: number; score: number }> = [];
    for (const [tid, 对象集] of 标签对象) {
      if (tid === tagId) continue;
      let co = 0;
      for (const o of 对象A) if (对象集.has(o)) co++;
      if (co === 0) continue;
      const countB = 对象集.size;
      // PMI：log( P(A∩B) / (P(A)·P(B)) )，再乘以共现次数作为权重
      const pmi = Math.log((co * n) / (countA * countB));
      候选.push({ tagId: tid, co, score: co * pmi });
    }

    候选.sort((a, b) => b.score - a.score);

    const 标签表 = new Map<number, 标签>();
    for (const t of this.listTags()) 标签表.set(t.id, t);

    return 候选
      .filter((c) => 标签表.has(c.tagId))
      .slice(0, limit)
      .map((c) => ({ tag: 标签表.get(c.tagId)!, 共现: c.co, 相关度: c.score }));
  }

  createTagTree(names: string[], description?: string): 标签 {
    if (names.length === 0) throw new Error("标签路径不能为空");
    let parentId: number | null = null;
    let createdTag: 标签 | null = null;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      let tag: 标签 | undefined;

      if (parentId === null) {
        const existing = this.db
          .prepare("SELECT id, name, parent_id, description FROM tags WHERE name = ? AND parent_id IS NULL")
          .get(name) as { id: number; name: string; parent_id: number | null; description: string | null } | undefined;
        if (existing) {
          tag = { id: existing.id, name: existing.name, parentId: existing.parent_id, description: existing.description };
        }
      } else {
        const existing = this.db
          .prepare("SELECT id, name, parent_id, description FROM tags WHERE name = ? AND parent_id = ?")
          .get(name, parentId) as { id: number; name: string; parent_id: number | null; description: string | null } | undefined;
        if (existing) {
          tag = { id: existing.id, name: existing.name, parentId: existing.parent_id, description: existing.description };
        }
      }

      if (!tag) {
        const isLast = i === names.length - 1;
        tag = this.createTag(name, parentId, isLast ? description : undefined);
      }
      parentId = tag.id;
      createdTag = tag;
    }

    return createdTag!;
  }

  getResourceDetail(idOrPath: number | string): 资源详情 | undefined {
    const resource = this.getResource(idOrPath as any);
    if (!resource) return undefined;

    const alias = this.getAlias(resource.id);
    const extension = this.获取扩展名(resource.name);
    const mimeType = this.推断MimeType(extension);
    const tagPaths = this.getResourceTagPaths(resource.id);

    return {
      ...resource,
      alias,
      extension,
      mimeType,
      tagPaths,
    };
  }

  private 资源转详情(resource: 资源): 资源详情 {
    const alias = this.getAlias(resource.id);
    const extension = this.获取扩展名(resource.name);
    const mimeType = this.推断MimeType(extension);
    const tagPaths = this.getResourceTagPaths(resource.id);
    return {
      ...resource,
      alias,
      extension,
      mimeType,
      tagPaths,
    };
  }

  listResourcesDetail(options: 搜索选项 = {}): 搜索结果<资源详情> {
    const result = this.listResources(options);
    return {
      total: result.total,
      items: result.items.map(r => this.资源转详情(r)),
    };
  }

  listResourcesByTagDetail(tagId: number, options: 搜索选项 = {}): 搜索结果<资源详情> {
    const result = this.listResourcesByTag(tagId, options);
    return {
      total: result.total,
      items: result.items.map(r => this.资源转详情(r)),
    };
  }

  /**
   * 获取知识库统计信息
   */
  getStats(): {
    资源总数: number;
    文件数: number;
    目录数: number;
    标签数: number;
    关联数: number;
    文本内容数: number;
    数据库大小: number;
  } {
    const 资源总数 = (this.db.prepare("SELECT COUNT(*) as c FROM resources").get() as { c: number }).c;
    const 文件数 = (this.db.prepare("SELECT COUNT(*) as c FROM resources WHERE kind = 'file'").get() as { c: number }).c;
    const 目录数 = (this.db.prepare("SELECT COUNT(*) as c FROM resources WHERE kind = 'directory'").get() as { c: number }).c;
    const 标签数 = (this.db.prepare("SELECT COUNT(*) as c FROM tags").get() as { c: number }).c;
    const 关联数 = (this.db.prepare("SELECT COUNT(*) as c FROM resource_tags").get() as { c: number }).c;
    const 文本内容数 = (this.db.prepare("SELECT COUNT(*) as c FROM text_contents").get() as { c: number }).c;
    return { 资源总数, 文件数, 目录数, 标签数, 关联数, 文本内容数, 数据库大小: 0 };
  }

  /**
   * 计算不冲突的目标文件路径
   */
  private 计算目标路径(源路径: string, 目标目录: string, 指定名称?: string): { 目标路径: string; 物理文件名: string } {
    const 源扩展名 = extname(源路径);
    const 源无扩展名 = basename(源路径, 源扩展名);
    let 使用基础名 = 指定名称?.trim() || 源无扩展名;
    // 如果指定名称已包含源扩展名，去掉重复后缀
    if (指定名称 && 使用基础名.endsWith(源扩展名)) {
      使用基础名 = 使用基础名.slice(0, -源扩展名.length);
    }
    let 候选名 = 使用基础名 + 源扩展名;
    let 索引 = 1;
    let 目标路径 = resolve(join(目标目录, 候选名));
    while (existsSync(目标路径)) {
      候选名 = `${使用基础名} (${索引})${源扩展名}`;
      目标路径 = resolve(join(目标目录, 候选名));
      索引++;
    }
    return { 目标路径, 物理文件名: 候选名 };
  }

  /**
   * 导入单个文件：复制到知识库目录 → 索引 → 设别名 → 打标签
   * 返回资源详情
   */
  async importFile(params: {
    sourcePath: string;
    destDir?: string;
    name?: string;
    alias?: string;
    tagIds?: number[];
  }): Promise<导入文件结果> {
    const { sourcePath, destDir, name, alias, tagIds = [] } = params;
    if (!existsSync(sourcePath)) throw new Error(`源文件不存在：${sourcePath}`);
    const stat = statSync(sourcePath);
    if (!stat.isFile()) throw new Error(`源路径不是文件：${sourcePath}`);

    // 导入去重：按 sha256 比对资料库已有文件，完全一致则不再复制导入
    const hash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    const 重复 = this.查询重复文件(hash);
    if (重复) {
      return { duplicate: true, existingId: 重复.id, existingPath: 重复.path, name: 重复.name };
    }

    // 默认知识库根目录：db 所在目录下的 library 文件夹
    let 目标目录 = destDir;
    if (!目标目录) {
      const 默认库目录 = resolve(process.cwd(), "data/library");
      目标目录 = 默认库目录;
    }
    mkdirSync(目标目录, { recursive: true });

    const { 目标路径 } = this.计算目标路径(sourcePath, 目标目录, name);
    copyFileSync(sourcePath, 目标路径);

    // 索引单个文件
    await 索引目录(this.db, 目标路径, { maxDepth: 0 });

    const 资源 = this.getResource(目标路径);
    if (!资源) throw new Error(`索引失败：${目标路径}`);

    // 设置别名
    if (alias && alias.trim()) {
      this.setAlias(资源.id, alias.trim());
    }

    // 打标签
    for (const tagId of tagIds) {
      this.tagResource(资源.id, tagId);
    }

    const 详情 = this.getResourceDetail(资源.id);
    if (!详情) throw new Error(`获取资源详情失败：${资源.id}`);
    return 详情;
  }

  /**
   * 批量导入文件
   */
  async importFiles(params: {
    items: Array<{ sourcePath: string; name?: string; alias?: string; tagIds?: number[] }>;
    destDir?: string;
  }): Promise<导入文件结果[]> {
    const 结果: 导入文件结果[] = [];
    for (const item of params.items) {
      结果.push(await this.importFile({ ...item, destDir: params.destDir }));
    }
    return 结果;
  }

  /**
   * 覆盖设置资源的标签（事务：先删旧标签再插新标签）
   */
  setResourceTags(resourceId: number, tagIds: number[]): 标签[] {
    const 去重 = Array.from(new Set(tagIds));
    const 删除旧 = this.db.prepare("DELETE FROM resource_tags WHERE resource_id = ?");
    const 插入新 = this.db.prepare("INSERT OR IGNORE INTO resource_tags (resource_id, tag_id, created_at) VALUES (?, ?, ?)");
    const tx = this.db.transaction(() => {
      删除旧.run(resourceId);
      const ts = Math.floor(Date.now() / 1000);
      for (const tid of 去重) {
        插入新.run(resourceId, tid, ts);
      }
    });
    tx();
    return this.getResourceTags(resourceId);
  }

  /**
   * 给资源批量追加标签（不影响已有标签）
   */
  addResourceTags(resourceId: number, tagIds: number[]): 标签[] {
    const 去重 = Array.from(new Set(tagIds));
    const ts = Math.floor(Date.now() / 1000);
    for (const tid of 去重) {
      this.tagResource(resourceId, tid);
      void ts;
    }
    return this.getResourceTags(resourceId);
  }

  /**
   * 从资源批量移除标签
   */
  removeResourceTags(resourceId: number, tagIds: number[]): 标签[] {
    for (const tid of tagIds) {
      this.untagResource(resourceId, tid);
    }
    return this.getResourceTags(resourceId);
  }

  // ===== 统一内容节点：实现见 domains/nodes.ts（P2 拆分）=====

  // ===== 保存视图 / 受管位置 / 侧车 / 全文检索：实现见 domains/views.ts（P2 拆分）=====

  /**
   * 关闭数据库
   */
  close(): void {
    this.db.close();
  }
}

// P2 结构化拆分：把内容节点各域方法安装到原型（类型由各域 declare module 合并）
安装笔记域(MKG.prototype as unknown as { [k: string]: unknown });
安装素材域(MKG.prototype as unknown as { [k: string]: unknown });
安装片段域(MKG.prototype as unknown as { [k: string]: unknown });
安装看板域(MKG.prototype as unknown as { [k: string]: unknown });
安装节点域(MKG.prototype as unknown as { [k: string]: unknown });
安装视图位置域(MKG.prototype as unknown as { [k: string]: unknown });

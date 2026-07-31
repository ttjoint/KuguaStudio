import { existsSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { exec, spawn } from "node:child_process";
import { 初始化数据库 } from "./db.js";
import { 索引目录, type 索引结果 } from "./indexer.js";
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
} from "./types.js";

export * from "./types.js";
export { 索引目录, 初始化数据库, type 索引结果 };

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
    this.db.prepare("DELETE FROM resources WHERE id = ?").run(id);
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
    const textExts = [".txt", ".json", ".csv", ".md", ".markdown", ".xml", ".html", ".htm", ".css", ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".go", ".rs", ".rb", ".php", ".sh", ".bat", ".ps1", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".log", ".sql"];
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

  getResourceTagPaths(resourceId: number): string[][] {
    const tags = this.getResourceTags(resourceId);
    return tags.map(tag => this.获取标签路径(tag.id));
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
   * 关闭数据库
   */
  close(): void {
    this.db.close();
  }
}

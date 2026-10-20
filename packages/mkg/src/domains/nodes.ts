/**
 * 知识库域方法：统一内容节点（标签 / 列表 / 搜索 / 统一浏览）
 *
 * 从原单体 MKG 类拆出（P2 结构化改造），以原型安装方式挂到 MKG.prototype。
 */
import type Database from "better-sqlite3";
import { basename } from "node:path";
import { statSync } from "node:fs";
import type {
  标签,
  节点类型,
  节点详情,
  内容分类,
  统一内容条目,
  搜索选项,
  搜索结果,
} from "../types.js";
import { 判定载体, 判定磁盘已变更 } from "../pure.js";

declare module "../index.js" {
  interface MKG {
    tagNode(nodeId: number, tagId: number): void;
    untagNode(nodeId: number, tagId: number): void;
    getNodeTags(nodeId: number): 标签[];
    setNodeTags(nodeId: number, tagIds: number[]): 标签[];
    listNodes(type?: 节点类型, options?: 搜索选项): 搜索结果<节点详情>;
    searchNodes(keyword: string, options?: 搜索选项): 搜索结果<节点详情>;
    listAllContent(opts?: {
      keyword?: string;
      categories?: 内容分类[];
      tagId?: number;
      noTag?: boolean;
      sort?: "import" | "name" | "updated";
      limit?: number;
    }): 统一内容条目[];
    节点转详情(row: {
      id: number;
      type: string;
      title: string;
      created_at: number;
      updated_at: number;
      meta: string;
    }): 节点详情;
    getResourceTagPathsByNode(nodeId: number): string[][];
    获取内容分类(type: string, name: string): 内容分类;
    获取节点内容(node: { id: number; type: string }): string;
    获取标签及后代Ids(tagId: number): Set<number>;
    确保笔记表(): void;
    确保素材表(): void;
    确保看板表(): void;
    确保片段表(): void;
  }
}

interface 上下文 {
  db: Database.Database;
  listTags(parentId?: number | null): 标签[];
  获取标签路径(tagId: number): string[];
  获取扩展名(name: string): string;
  getNodeTags(nodeId: number): 标签[];
  确保笔记表(): void;
  确保素材表(): void;
  确保看板表(): void;
  确保片段表(): void;
  节点转详情(row: {
    id: number;
    type: string;
    title: string;
    created_at: number;
    updated_at: number;
    meta: string;
  }): 节点详情;
  getResourceTagPathsByNode(nodeId: number): string[][];
  获取内容分类(type: string, name: string): 内容分类;
  获取节点内容(node: { id: number; type: string }): string;
  获取标签及后代Ids(tagId: number): Set<number>;
}

export function 安装节点域(proto: { [k: string]: unknown }): void {
  proto.tagNode = function (this: 上下文, nodeId: number, tagId: number): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare("INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)")
      .run(nodeId, tagId, now);
  };

  proto.untagNode = function (this: 上下文, nodeId: number, tagId: number): void {
    this.db.prepare("DELETE FROM node_tags WHERE node_id = ? AND tag_id = ?").run(nodeId, tagId);
  };

  proto.getNodeTags = function (this: 上下文, nodeId: number): 标签[] {
    const rows = this.db
      .prepare(
        "SELECT t.id, t.name, t.parent_id, t.description FROM tags t JOIN node_tags nt ON nt.tag_id = t.id WHERE nt.node_id = ?",
      )
      .all(nodeId) as unknown as { id: number; name: string; parent_id: number | null; description: string | null }[];
    return rows.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id ?? null, description: t.description }));
  };

  proto.setNodeTags = function (this: 上下文, nodeId: number, tagIds: number[]): 标签[] {
    this.db.prepare("DELETE FROM node_tags WHERE node_id = ?").run(nodeId);
    const now = Math.floor(Date.now() / 1000);
    const ins = this.db.prepare(
      "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
    );
    for (const tid of tagIds) ins.run(nodeId, tid, now);
    return this.getNodeTags(nodeId);
  };

  proto.listNodes = function (
    this: 上下文,
    type?: 节点类型,
    options: 搜索选项 = {},
  ): 搜索结果<节点详情> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    let where = "WHERE 1=1";
    const params: unknown[] = [];
    if (type) {
      where += " AND type = ?";
      params.push(type);
    }
    const total = this.db
      .prepare("SELECT COUNT(*) AS c FROM nodes " + where)
      .get(...params) as { c: number };
    const rows = this.db
      .prepare("SELECT * FROM nodes " + where + " ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(...params, limit, offset) as unknown as {
      id: number;
      type: string;
      title: string;
      created_at: number;
      updated_at: number;
      meta: string;
    }[];
    const items = rows.map((r) => this.节点转详情(r));
    return { total: total.c, items };
  };

  proto.节点转详情 = function (
    this: 上下文,
    row: {
      id: number;
      type: string;
      title: string;
      created_at: number;
      updated_at: number;
      meta: string;
    },
  ): 节点详情 {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.meta || "{}") as Record<string, unknown>; } catch { meta = {}; }
    const resource = this.db
      .prepare("SELECT id FROM resources WHERE node_id = ?")
      .get(row.id) as { id: number } | undefined;
    const tagPaths = this.getResourceTagPathsByNode(row.id);
    return {
      id: row.id,
      type: row.type as 节点类型,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      meta,
      resourceId: resource?.id ?? null,
      tagPaths,
    };
  };

  proto.getResourceTagPathsByNode = function (this: 上下文, nodeId: number): string[][] {
    const tags = this.getNodeTags(nodeId);
    return tags.map((t) => this.获取标签路径(t.id));
  };

  proto.searchNodes = function (
    this: 上下文,
    keyword: string,
    options: 搜索选项 = {},
  ): 搜索结果<节点详情> {
    this.确保笔记表();
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const like = "%" + keyword + "%";
    const rows = this.db
      .prepare(
        "SELECT DISTINCT n.* FROM nodes n LEFT JOIN note_contents c ON c.node_id = n.id WHERE n.title LIKE ? OR c.content LIKE ? ORDER BY n.id DESC LIMIT ? OFFSET ?",
      )
      .all(like, like, limit, offset) as unknown as {
      id: number;
      type: string;
      title: string;
      created_at: number;
      updated_at: number;
      meta: string;
    }[];
    const total = (
      this.db
        .prepare("SELECT COUNT(DISTINCT n.id) AS c FROM nodes n LEFT JOIN note_contents c ON c.node_id = n.id WHERE n.title LIKE ? OR c.content LIKE ?")
        .get(like, like) as { c: number }
    ).c;
    return { total, items: rows.map((r) => this.节点转详情(r)) };
  };

  proto.获取内容分类 = function (this: 上下文, type: string, name: string): 内容分类 {
    if (type === "directory") return "目录";
    if (type === "note") return "点子";
    if (type === "material") return "素材";
    if (type === "snippet") return "文本段";
    const ext = (name.split(".").pop() || "").toLowerCase();
    const 图片 = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];
    const 音乐 = ["mp3", "wav", "flac", "m4a", "ogg", "opus", "aac", "wma"];
    const 视频 = ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v"];
    const 文本 = [
      "txt", "md", "markdown", "log", "json", "yaml", "yml", "xml", "csv", "html", "htm",
      "css", "scss", "sass", "less", "js", "mjs", "cjs", "ts", "tsx", "jsx",
      "py", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "rb", "php",
      "swift", "kt", "scala", "r", "lua", "dart", "sql",
      "sh", "bash", "bat", "cmd", "ps1", "vbs", "ini", "conf", "cfg", "toml",
      "env", "gitignore", "editorconfig",
    ];
    if (图片.includes(ext)) return "图片";
    if (音乐.includes(ext)) return "音乐";
    if (视频.includes(ext)) return "视频";
    if (文本.includes(ext)) return "文本";
    return "文件";
  };

  proto.获取节点内容 = function (this: 上下文, node: { id: number; type: string }): string {
    if (node.type === "note") {
      this.确保笔记表();
      const r = this.db.prepare("SELECT content FROM note_contents WHERE node_id = ?").get(node.id) as { content: string } | undefined;
      return r?.content ?? "";
    }
    if (node.type === "material") {
      this.确保素材表();
      const r = this.db.prepare("SELECT content FROM material_contents WHERE node_id = ?").get(node.id) as { content: string } | undefined;
      return r?.content ?? "";
    }
    if (node.type === "card") {
      this.确保看板表();
      const r = this.db.prepare("SELECT content FROM card_contents WHERE node_id = ?").get(node.id) as { content: string } | undefined;
      return r?.content ?? "";
    }
    if (node.type === "snippet") {
      this.确保片段表();
      const r = this.db.prepare("SELECT content FROM snippet_contents WHERE node_id = ?").get(node.id) as { content: string } | undefined;
      return r?.content ?? "";
    }
    // file 类型：从 text_contents 表读取索引的文本内容
    if (node.type === "file") {
      const 资源 = this.db.prepare("SELECT id FROM resources WHERE node_id = ?").get(node.id) as { id: number } | undefined;
      if (资源) {
        const r = this.db.prepare("SELECT content FROM text_contents WHERE resource_id = ?").get(资源.id) as { content: string } | undefined;
        return r?.content ?? "";
      }
    }
    return "";
  };

  proto.获取标签及后代Ids = function (this: 上下文, tagId: number): Set<number> {
    const ids = new Set<number>([tagId]);
    const childMap = new Map<number, number[]>();
    for (const t of this.listTags()) {
      if (t.parentId != null) {
        const arr = childMap.get(t.parentId) ?? [];
        arr.push(t.id);
        childMap.set(t.parentId, arr);
      }
    }
    const queue = [tagId];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (const cid of childMap.get(cur) ?? []) {
        if (ids.has(cid)) continue;
        ids.add(cid);
        queue.push(cid);
      }
    }
    return ids;
  };

  proto.listAllContent = function (
    this: 上下文,
    opts: {
      keyword?: string;
      categories?: 内容分类[];
      tagId?: number;
      noTag?: boolean;
      sort?: "import" | "name" | "updated";
      limit?: number;
    } = {},
  ): 统一内容条目[] {
    const { keyword, categories, tagId, noTag, sort = "import", limit = 1000 } = opts;
    const 命中标签Ids = typeof tagId === "number" ? this.获取标签及后代Ids(tagId) : null;
    const rows = this.db.prepare("SELECT * FROM nodes ORDER BY id ASC").all() as {
      id: number; type: string; title: string; created_at: number; updated_at: number; meta: string;
    }[];
    const items: 统一内容条目[] = [];
    for (const row of rows) {
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(row.meta || "{}") as Record<string, unknown>; } catch { meta = {}; }
      if (row.type === "card") continue; // 看板卡片不参与统一浏览
      const content = this.获取节点内容(row);
      const tags = this.getNodeTags(row.id);
      const tagIds = tags.map((t) => t.id);
      const tagPaths = tags.map((t) => this.获取标签路径(t.id));
      const category = this.获取内容分类(row.type, row.title);
      if (categories && categories.length > 0 && !categories.includes(category)) continue;
      if (noTag && tagIds.length > 0) continue;
      if (命中标签Ids && !tagIds.some((tid) => 命中标签Ids.has(tid))) continue;
      if (keyword && keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        if (!row.title.toLowerCase().includes(kw) && !content.toLowerCase().includes(kw)) continue;
      }
      const 资源行 = this.db.prepare("SELECT * FROM resources WHERE node_id = ?").get(row.id) as {
        id: number; path: string; size: number; modified_time: number; indexed_at: number;
      } | undefined;
      const resourceId = 资源行?.id ?? null;
      const 载体 = 判定载体({ type: row.type, resourceId });
      // 「磁盘已变更」仅对外部文件有意义，且必须读磁盘当前 mtime 与库内记录比较：
      // 库内 modified_time 是上次索引时的快照，外部改动后不会自己更新。
      let 磁盘已变更 = false;
      if (载体 === "外部文件" && 资源行?.path) {
        try {
          const st = statSync(资源行.path);
          磁盘已变更 = 判定磁盘已变更({
            磁盘Mtime: Math.floor(st.mtimeMs / 1000),
            库内Mtime: 资源行.modified_time,
          });
        } catch {
          // 文件已被外部删除/移动：视为已变更（甚至更糟），由上层决定如何提示
          磁盘已变更 = true;
        }
      }
      items.push({
        id: row.id,
        type: row.type as 节点类型,
        category,
        name: row.title,
        content,
        tagIds,
        tagPaths,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resourceId,
        path: 资源行?.path ?? null,
        size: 资源行?.size ?? 0,
        modifiedTime: 资源行?.modified_time ?? 0,
        indexedAt: 资源行?.indexed_at ?? 0,
        realName: 资源行?.path ? basename(资源行.path) : null,
        extension: this.获取扩展名(row.title),
        meta,
        载体,
        同步时间: 载体 === "外部文件" ? (资源行?.indexed_at ?? null) : null,
        磁盘已变更,
      });
    }
    if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    else if (sort === "updated") items.sort((a, b) => b.updatedAt - a.updatedAt);
    else items.sort((a, b) => a.createdAt - b.createdAt); // 导入顺序（旧→新）
    return limit ? items.slice(0, limit) : items;
  };
}

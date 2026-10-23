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
    /**
     * 批量给多个节点**追加**标签（不覆盖原有标签）。
     *
     * 为什么需要 setNodeTags 不够：它是覆盖式（先 DELETE 全部再插入）。
     * 多选 10 条内容想统一打个标签时，用覆盖式会把它们各自的原有标签
     * 全冲掉——这是数据损坏，不是便利性问题。
     */
    addNodeTags(nodeIds: number[], tagIds: number[]): { 更新: number; 跳过: number };
    /** 批量从多个节点移除标签（不动其它标签） */
    removeNodeTags(nodeIds: number[], tagIds: number[]): { 更新: number; 跳过: number };
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
    /** AI 可读内容：仅返回带 ai_public 标签的内容（不含 aigc 类型） */
    listAiReadable(opts?: { keyword?: string; limit?: number }): 统一内容条目[];
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
    /** 批量加载：node_id → 标签列表；附全量标签表供路径解析 */
    批量加载标签索引(): Map<number, 标签[]> & { 标签表: Map<number, { id: number; name: string; parentId: number | null }> };
    /** 批量加载：node_id → 正文（note/material/card/snippet/aigc/file） */
    批量加载正文索引(): Map<number, string>;
    /** 批量加载：node_id → 资源行 */
    批量加载资源索引(): Map<number, { id: number; path: string; size: number; modified_time: number; indexed_at: number }>;
    /** 从预加载的标签表解析路径（不查库） */
    取标签路径从索引(tagId: number, 标签表: Map<number, { id: number; name: string; parentId: number | null }>): string[];
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
  确保AIGC表(): void;
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
  批量加载标签索引(): Map<number, 标签[]> & {
    标签表: Map<number, { id: number; name: string; parentId: number | null }>;
  };
  批量加载正文索引(): Map<number, string>;
  批量加载资源索引(): Map<
    number,
    { id: number; path: string; size: number; modified_time: number; indexed_at: number }
  >;
  取标签路径从索引(
    tagId: number,
    标签表: Map<number, { id: number; name: string; parentId: number | null }>,
  ): string[];
  listAllContent(opts?: {
    keyword?: string;
    categories?: 内容分类[];
    tagId?: number;
    noTag?: boolean;
    sort?: "import" | "name" | "updated";
    limit?: number;
  }): 统一内容条目[];
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

  /**
   * 批量追加标签。
   *
   * @returns 更新了几个节点、跳过几个（节点不存在）
   */
  proto.addNodeTags = function (
    this: 上下文,
    nodeIds: number[],
    tagIds: number[],
  ): { 更新: number; 跳过: number } {
    const 节点 = Array.from(new Set(nodeIds)).filter((id) => Number.isInteger(id) && id > 0);
    const 标签们 = Array.from(new Set(tagIds)).filter((id) => Number.isInteger(id) && id > 0);
    if (节点.length === 0 || 标签们.length === 0) return { 更新: 0, 跳过: 节点.length };

    const now = Math.floor(Date.now() / 1000);
    const 查存在 = this.db.prepare("SELECT 1 as x FROM nodes WHERE id = ?");
    const ins = this.db.prepare(
      "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
    );
    let 更新 = 0;
    let 跳过 = 0;
    // 整个批量放进一个事务：要么全成，要么全不成，避免半截状态
    const tx = this.db.transaction(() => {
      for (const nid of 节点) {
        if (!查存在.get(nid)) {
          跳过++;
          continue;
        }
        for (const tid of 标签们) ins.run(nid, tid, now);
        更新++;
      }
    });
    tx();
    return { 更新, 跳过 };
  };

  /**
   * 批量移除标签（只移除指定标签，其它标签保留）。
   */
  proto.removeNodeTags = function (
    this: 上下文,
    nodeIds: number[],
    tagIds: number[],
  ): { 更新: number; 跳过: number } {
    const 节点 = Array.from(new Set(nodeIds)).filter((id) => Number.isInteger(id) && id > 0);
    const 标签们 = Array.from(new Set(tagIds)).filter((id) => Number.isInteger(id) && id > 0);
    if (节点.length === 0 || 标签们.length === 0) return { 更新: 0, 跳过: 节点.length };

    const 查存在 = this.db.prepare("SELECT 1 as x FROM nodes WHERE id = ?");
    const del = this.db.prepare("DELETE FROM node_tags WHERE node_id = ? AND tag_id = ?");
    let 更新 = 0;
    let 跳过 = 0;
    const tx = this.db.transaction(() => {
      for (const nid of 节点) {
        if (!查存在.get(nid)) {
          跳过++;
          continue;
        }
        for (const tid of 标签们) del.run(nid, tid);
        更新++;
      }
    });
    tx();
    return { 更新, 跳过 };
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

  // ===== 批量索引（listAllContent 专用，消除逐节点 N 次查询）=====

  proto.批量加载标签索引 = function (
    this: 上下文,
  ): Map<number, 标签[]> & { 标签表: Map<number, { id: number; name: string; parentId: number | null }> } {
    // 全量标签表（路径解析用，一次查完）
    const tagRows = this.db
      .prepare("SELECT id, name, parent_id FROM tags")
      .all() as { id: number; name: string; parent_id: number | null }[];
    const 标签表 = new Map<number, { id: number; name: string; parentId: number | null }>();
    for (const t of tagRows) 标签表.set(t.id, { id: t.id, name: t.name, parentId: t.parent_id ?? null });

    // 一次 JOIN 拿到所有 node→tag 关系
    const 关系 = this.db
      .prepare(
        "SELECT nt.node_id AS nodeId, t.id, t.name, t.parent_id AS parentId, t.description FROM node_tags nt JOIN tags t ON t.id = nt.tag_id",
      )
      .all() as { nodeId: number; id: number; name: string; parentId: number | null; description: string | null }[];
    const 索引 = new Map<number, 标签[]>();
    for (const r of 关系) {
      const 列表 = 索引.get(r.nodeId);
      const 标签项: 标签 = { id: r.id, name: r.name, parentId: r.parentId ?? null, description: r.description };
      if (列表) 列表.push(标签项);
      else 索引.set(r.nodeId, [标签项]);
    }
    return Object.assign(索引, { 标签表 });
  };

  proto.批量加载正文索引 = function (this: 上下文): Map<number, string> {
    // 各内容表结构一致（node_id + content），分别一次性查全，再合并到同一 Map。
    // 表不存在时跳过（对应内容类型从未使用）。
    const 索引 = new Map<number, string>();
    const 表列表 = ["note_contents", "material_contents", "card_contents", "snippet_contents", "aigc_contents"];
    for (const 表 of 表列表) {
      try {
        const rows = this.db.prepare(`SELECT node_id, content FROM ${表}`).all() as {
          node_id: number;
          content: string | null;
        }[];
        for (const r of rows) 索引.set(r.node_id, r.content ?? "");
      } catch {
        // 表未创建：忽略
      }
    }
    // file 类型：正文来自 text_contents（按资源关联）
    try {
      const rows = this.db
        .prepare(
          "SELECT r.node_id AS nodeId, tc.content AS content FROM text_contents tc JOIN resources r ON r.id = tc.resource_id",
        )
        .all() as { nodeId: number; content: string | null }[];
      for (const r of rows) {
        if (!索引.has(r.nodeId)) 索引.set(r.nodeId, r.content ?? "");
      }
    } catch {
      // text_contents 或 resources 不存在：忽略
    }
    return 索引;
  };

  proto.批量加载资源索引 = function (
    this: 上下文,
  ): Map<number, { id: number; path: string; size: number; modified_time: number; indexed_at: number }> {
    const 索引 = new Map<number, { id: number; path: string; size: number; modified_time: number; indexed_at: number }>();
    try {
      const rows = this.db
        .prepare("SELECT id, node_id, path, size, modified_time, indexed_at FROM resources")
        .all() as { id: number; node_id: number; path: string; size: number; modified_time: number; indexed_at: number }[];
      for (const r of rows) {
        索引.set(r.node_id, {
          id: r.id,
          path: r.path,
          size: r.size,
          modified_time: r.modified_time,
          indexed_at: r.indexed_at,
        });
      }
    } catch {
      // resources 表未创建：忽略
    }
    return 索引;
  };

  proto.取标签路径从索引 = function (
    this: 上下文,
    tagId: number,
    标签表: Map<number, { id: number; name: string; parentId: number | null }>,
  ): string[] {
    const path: string[] = [];
    let currentId: number | null = tagId;
    const visited = new Set<number>();
    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      const tag = 标签表.get(currentId);
      if (!tag) break;
      path.unshift(tag.name);
      currentId = tag.parentId;
    }
    return path;
  };

  proto.获取内容分类 = function (this: 上下文, type: string, name: string): 内容分类 {
    if (type === "directory") return "目录";
    if (type === "note") return "点子";
    if (type === "material") return "素材";
    if (type === "snippet") return "文本段";
    if (type === "aigc") return "文本段";
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
    if (node.type === "aigc") {
      this.确保AIGC表();
      const r = this.db.prepare("SELECT content FROM aigc_contents WHERE node_id = ?").get(node.id) as { content: string } | undefined;
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

    // ===== 批量预加载（消除逐节点 N 次查询）=====
    // 原实现在循环内为每个节点单独查标签、标签路径、正文、资源，
    // 总代价 O(N × M × 深度) + N 次 prepare；节点上万时 AI 检索会卡住。
    // 这里先一次性取全量索引，循环内只做 Map 命中。
    const 标签索引 = this.批量加载标签索引();
    const 正文索引 = this.批量加载正文索引();
    const 资源索引 = this.批量加载资源索引();

    const items: 统一内容条目[] = [];
    for (const row of rows) {
      if (row.type === "card") continue; // 看板卡片不参与统一浏览
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(row.meta || "{}") as Record<string, unknown>; } catch { meta = {}; }
      const content = 正文索引.get(row.id) ?? "";
      const tags = 标签索引.get(row.id) ?? [];
      const tagIds = tags.map((t) => t.id);
      const tagPaths = tags.map((t) => this.取标签路径从索引(t.id, 标签索引.标签表));
      const category = this.获取内容分类(row.type, row.title);
      if (categories && categories.length > 0 && !categories.includes(category)) continue;
      if (noTag && tagIds.length > 0) continue;
      if (命中标签Ids && !tagIds.some((tid) => 命中标签Ids.has(tid))) continue;
      if (keyword && keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        if (!row.title.toLowerCase().includes(kw) && !content.toLowerCase().includes(kw)) continue;
      }
      const 资源行 = 资源索引.get(row.id);
      const resourceId = 资源行?.id ?? null;
      const 载体 = 判定载体({ type: row.type, resourceId });
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
        磁盘已变更: false, // 下面只对最终结果集检查
      });
    }
    if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    else if (sort === "updated") items.sort((a, b) => b.updatedAt - a.updatedAt);
    else items.sort((a, b) => a.createdAt - b.createdAt); // 导入顺序（旧→新）
    const 结果 = limit ? items.slice(0, limit) : items;

    // 「磁盘已变更」需读盘（statSync 是系统调用，很贵）：只对最终返回集检查，不遍及全集。
    // 库内 modified_time 是上次索引时的快照，外部改动后不会自己更新。
    for (const item of 结果) {
      if (item.载体 !== "外部文件" || !item.path) continue;
      try {
        const st = statSync(item.path);
        item.磁盘已变更 = 判定磁盘已变更({
          磁盘Mtime: Math.floor(st.mtimeMs / 1000),
          库内Mtime: item.modifiedTime,
        });
      } catch {
        // 文件已被外部删除/移动：视为已变更（甚至更糟），由上层决定如何提示
        item.磁盘已变更 = true;
      }
    }
    return 结果;
  };

  proto.listAiReadable = function (
    this: 上下文,
    opts: { keyword?: string; limit?: number } = {},
  ): 统一内容条目[] {
    const 全部 = this.listAllContent({
      keyword: opts.keyword,
      limit: 100000,
    });
    // 先收集所有 ai_public 标签 id（含后代：父标签 ai_public 时，子标签下的内容也应可读）
    const aiPublic标签 = new Set<number>();
    for (const t of this.listTags()) {
      if (t.aiPublic) {
        // 该标签及其全部后代都算 ai_public
        for (const id of this.获取标签及后代Ids(t.id)) aiPublic标签.add(id);
      }
    }
    const 结果 = 全部.filter((x) => {
      if (x.type === "aigc") return false; // AI 生成物走 listAigcByAgent，不在此列
      return x.tagIds.some((tid: number) => aiPublic标签.has(tid));
    });
    return opts.limit ? 结果.slice(0, opts.limit) : 结果;
  };
}

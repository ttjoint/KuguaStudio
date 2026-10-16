/**
 * 知识库域方法：工作流看板（列 + 卡片）
 *
 * 从原单体 MKG 类拆出（P2 结构化改造），以原型安装方式挂到 MKG.prototype。
 */
import type Database from "better-sqlite3";
import type { 看板列, 看板列更新, 卡片, 卡片更新 } from "../types.js";

declare module "../index.js" {
  interface MKG {
    确保看板表(): void;
    createColumn(name: string): 看板列;
    getColumn(id: number): 看板列 | undefined;
    listColumns(): 看板列[];
    updateColumn(id: number, patch: 看板列更新): 看板列 | undefined;
    deleteColumn(id: number): void;
    createCard(data: { title: string; content?: string; columnId?: number | null; tagIds?: number[]; color?: string | null; sort?: number }): 卡片;
    getCard(id: number): 卡片 | undefined;
    listCards(columnId?: number | null): 卡片[];
    updateCard(id: number, patch: 卡片更新): 卡片 | undefined;
    deleteCard(id: number): void;
    读取卡片附加(id: number): { color: string | null; sort: number };
  }
}

interface 上下文 {
  db: Database.Database;
  确保看板表(): void;
  getColumn(id: number): 看板列 | undefined;
  getCard(id: number): 卡片 | undefined;
}

export function 安装看板域(proto: { [k: string]: unknown }): void {
  proto.确保看板表 = function (this: 上下文): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS card_columns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS card_contents (
        node_id INTEGER PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );
    `);
    // 兼容旧库：cards 的 color/sort 存在 nodes.meta 中，这里仅确保表结构存在
  };

  /** 读取某张卡片在 nodes.meta 中的附加字段 */
  proto.读取卡片附加 = function (this: 上下文, id: number): { color: string | null; sort: number } {
    const row = this.db.prepare("SELECT meta FROM nodes WHERE id = ?").get(id) as { meta: string } | undefined;
    let meta: { color?: string | null; sort?: number } = {};
    try {
      meta = JSON.parse(row?.meta || "{}") as typeof meta;
    } catch {
      meta = {};
    }
    return { color: meta.color ?? null, sort: typeof meta.sort === "number" ? meta.sort : 0 };
  };

  proto.createColumn = function (this: 上下文, name: string): 看板列 {
    this.确保看板表();
    const now = Math.floor(Date.now() / 1000);
    const 最大排序 = this.db.prepare("SELECT COALESCE(MAX(sort), -1) AS m FROM card_columns").get() as { m: number };
    const res = this.db
      .prepare("INSERT INTO card_columns (name, sort, created_at) VALUES (?, ?, ?)")
      .run(name, 最大排序.m + 1, now);
    return this.getColumn(Number(res.lastInsertRowid))!;
  };

  proto.getColumn = function (this: 上下文, id: number): 看板列 | undefined {
    this.确保看板表();
    const row = this.db
      .prepare("SELECT id, name, sort, created_at AS createdAt FROM card_columns WHERE id = ?")
      .get(id) as { id: number; name: string; sort: number; createdAt: number } | undefined;
    return row ?? undefined;
  };

  proto.listColumns = function (this: 上下文): 看板列[] {
    this.确保看板表();
    return this.db
      .prepare("SELECT id, name, sort, created_at AS createdAt FROM card_columns ORDER BY sort ASC, id ASC")
      .all() as 看板列[];
  };

  proto.updateColumn = function (this: 上下文, id: number, patch: 看板列更新): 看板列 | undefined {
    this.确保看板表();
    const existing = this.getColumn(id);
    if (!existing) return undefined;
    if (patch.name !== undefined) {
      this.db.prepare("UPDATE card_columns SET name = ? WHERE id = ?").run(patch.name, id);
    }
    if (patch.sort !== undefined) {
      this.db.prepare("UPDATE card_columns SET sort = ? WHERE id = ?").run(patch.sort, id);
    }
    return this.getColumn(id);
  };

  proto.deleteColumn = function (this: 上下文, id: number): void {
    this.确保看板表();
    const 剩余列 = this.db
      .prepare("SELECT id FROM card_columns WHERE id != ? ORDER BY sort ASC, id ASC LIMIT 1")
      .get(id) as { id: number } | undefined;
    const 卡片行 = this.db.prepare("SELECT id FROM nodes WHERE type = 'card'").all() as { id: number }[];
    for (const c of 卡片行) {
      const metaRaw = this.db.prepare("SELECT meta FROM nodes WHERE id = ?").get(c.id) as { meta: string };
      let meta: { columnId?: number | null } = {};
      try { meta = JSON.parse(metaRaw.meta || "{}") as typeof meta; } catch { meta = {}; }
      if (meta.columnId === id) {
        meta.columnId = 剩余列 ? 剩余列.id : null;
        this.db.prepare("UPDATE nodes SET meta = ? WHERE id = ?").run(JSON.stringify(meta), c.id);
      }
    }
    this.db.prepare("DELETE FROM card_columns WHERE id = ?").run(id);
  };

  proto.createCard = function (
    this: 上下文,
    data: { title: string; content?: string; columnId?: number | null; tagIds?: number[]; color?: string | null; sort?: number },
  ): 卡片 {
    this.确保看板表();
    const now = Math.floor(Date.now() / 1000);
    const meta = JSON.stringify({ columnId: data.columnId ?? null, color: data.color ?? null, sort: data.sort ?? 0 });
    const res = this.db
      .prepare("INSERT INTO nodes (type, title, meta, created_at, updated_at) VALUES ('card', ?, ?, ?, ?)")
      .run(data.title, meta, now, now);
    const nodeId = Number(res.lastInsertRowid);
    this.db.prepare("INSERT INTO card_contents (node_id, content) VALUES (?, ?)").run(nodeId, data.content ?? "");
    const ins = this.db.prepare(
      "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
    );
    for (const tid of data.tagIds ?? []) ins.run(nodeId, tid, now);
    return this.getCard(nodeId)!;
  };

  proto.getCard = function (this: 上下文, id: number): 卡片 | undefined {
    this.确保看板表();
    const row = this.db
      .prepare(
        "SELECT n.id, n.title, n.meta, n.created_at AS createdAt, n.updated_at AS updatedAt, c.content FROM nodes n LEFT JOIN card_contents c ON c.node_id = n.id WHERE n.id = ? AND n.type = 'card'",
      )
      .get(id) as
      | { id: number; title: string; meta: string; createdAt: number; updatedAt: number; content: string | null }
      | undefined;
    if (!row) return undefined;
    let meta: { columnId?: number | null; color?: string | null; sort?: number } = {};
    try { meta = JSON.parse(row.meta || "{}") as typeof meta; } catch { meta = {}; }
    const tagIds = (
      this.db.prepare("SELECT tag_id AS id FROM node_tags WHERE node_id = ?").all(id) as { id: number }[]
    ).map((r) => r.id);
    return {
      id: row.id,
      title: row.title,
      content: row.content ?? "",
      columnId: meta.columnId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tagIds,
      color: meta.color ?? null,
      sort: typeof meta.sort === "number" ? meta.sort : 0,
    };
  };

  proto.listCards = function (this: 上下文, columnId?: number | null): 卡片[] {
    this.确保看板表();
    // 按列内排序权重（sort）升序，其次按创建时间升序
    const rows = this.db.prepare("SELECT id FROM nodes WHERE type = 'card'").all() as { id: number }[];
    let 结果 = rows.map((r) => this.getCard(r.id)!).filter(Boolean);
    if (columnId !== undefined) {
      结果 = 结果.filter((c) => c.columnId === columnId);
    }
    结果.sort((a, b) => (a.sort - b.sort) || (a.createdAt - b.createdAt) || (a.id - b.id));
    return 结果;
  };

  proto.updateCard = function (this: 上下文, id: number, patch: 卡片更新): 卡片 | undefined {
    this.确保看板表();
    const existing = this.getCard(id);
    if (!existing) return undefined;
    const now = Math.floor(Date.now() / 1000);
    if (patch.title !== undefined) {
      this.db.prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?").run(patch.title, now, id);
    }
    if (patch.content !== undefined) {
      this.db
        .prepare("INSERT INTO card_contents (node_id, content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET content = excluded.content")
        .run(id, patch.content);
    }
    if (patch.columnId !== undefined) {
      const metaRaw = this.db.prepare("SELECT meta FROM nodes WHERE id = ?").get(id) as { meta: string };
      let meta: { columnId?: number | null; color?: string | null; sort?: number } = {};
      try { meta = JSON.parse(metaRaw.meta || "{}") as typeof meta; } catch { meta = {}; }
      meta.columnId = patch.columnId;
      this.db.prepare("UPDATE nodes SET meta = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(meta), now, id);
    }
    if (patch.color !== undefined || patch.sort !== undefined) {
      const metaRaw = this.db.prepare("SELECT meta FROM nodes WHERE id = ?").get(id) as { meta: string };
      let meta: { columnId?: number | null; color?: string | null; sort?: number } = {};
      try { meta = JSON.parse(metaRaw.meta || "{}") as typeof meta; } catch { meta = {}; }
      if (patch.color !== undefined) meta.color = patch.color;
      if (patch.sort !== undefined) meta.sort = patch.sort;
      this.db.prepare("UPDATE nodes SET meta = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(meta), now, id);
    }
    if (patch.tagIds !== undefined) {
      this.db.prepare("DELETE FROM node_tags WHERE node_id = ?").run(id);
      const ins = this.db.prepare(
        "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
      );
      for (const tid of patch.tagIds) ins.run(id, tid, now);
    }
    return this.getCard(id);
  };

  proto.deleteCard = function (this: 上下文, id: number): void {
    this.db.prepare("DELETE FROM nodes WHERE id = ? AND type = 'card'").run(id);
  };
}

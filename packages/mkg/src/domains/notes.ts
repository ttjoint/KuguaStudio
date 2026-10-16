/**
 * 知识库域方法：笔记（点子）
 *
 * 从原单体 MKG 类拆出（P2 结构化改造），以原型安装方式挂到 MKG.prototype。
 * `declare module` 声明合并让 MKG 实例具备这些方法的类型。
 */
import type Database from "better-sqlite3";
import type { 笔记 } from "../types.js";

declare module "../index.js" {
  interface MKG {
    确保笔记表(): void;
    createNote(title: string, content?: string, tagIds?: number[]): 笔记;
    getNote(id: number): 笔记 | undefined;
    listNotes(): 笔记[];
    updateNote(
      id: number,
      patch: { title?: string; content?: string; tagIds?: number[] },
    ): 笔记 | undefined;
    deleteNote(id: number): void;
  }
}

/** 本域方法使用的实例上下文 */
interface 上下文 {
  db: Database.Database;
  确保笔记表(): void;
  getNote(id: number): 笔记 | undefined;
}

export function 安装笔记域(proto: { [k: string]: unknown }): void {
  proto.确保笔记表 = function (this: 上下文): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS note_contents (
        node_id INTEGER PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      )
    `);
  };

  proto.createNote = function (this: 上下文, title: string, content = "", tagIds: number[] = []): 笔记 {
    this.确保笔记表();
    const now = Math.floor(Date.now() / 1000);
    const res = this.db
      .prepare("INSERT INTO nodes (type, title, created_at, updated_at) VALUES ('note', ?, ?, ?)")
      .run(title, now, now);
    const nodeId = Number(res.lastInsertRowid);
    this.db.prepare("INSERT INTO note_contents (node_id, content) VALUES (?, ?)").run(nodeId, content);
    const ins = this.db.prepare(
      "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
    );
    for (const tid of tagIds) ins.run(nodeId, tid, now);
    return this.getNote(nodeId)!;
  };

  proto.getNote = function (this: 上下文, id: number): 笔记 | undefined {
    this.确保笔记表();
    const row = this.db
      .prepare(
        "SELECT n.id, n.title, n.created_at AS createdAt, n.updated_at AS updatedAt, c.content FROM nodes n LEFT JOIN note_contents c ON c.node_id = n.id WHERE n.id = ? AND n.type = 'note'",
      )
      .get(id) as
      | { id: number; title: string; createdAt: number; updatedAt: number; content: string | null }
      | undefined;
    if (!row) return undefined;
    const tagIds = (
      this.db.prepare("SELECT tag_id AS id FROM node_tags WHERE node_id = ?").all(id) as { id: number }[]
    ).map((r) => r.id);
    return {
      id: row.id,
      title: row.title,
      content: row.content ?? "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tagIds,
    };
  };

  proto.listNotes = function (this: 上下文): 笔记[] {
    this.确保笔记表();
    const rows = this.db
      .prepare("SELECT id FROM nodes WHERE type = 'note' ORDER BY id DESC")
      .all() as { id: number }[];
    return rows.map((r) => this.getNote(r.id)!).filter(Boolean);
  };

  proto.updateNote = function (
    this: 上下文,
    id: number,
    patch: { title?: string; content?: string; tagIds?: number[] },
  ): 笔记 | undefined {
    this.确保笔记表();
    const existing = this.getNote(id);
    if (!existing) return undefined;
    const now = Math.floor(Date.now() / 1000);
    if (patch.title !== undefined) {
      this.db.prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?").run(patch.title, now, id);
    }
    if (patch.content !== undefined) {
      this.db
        .prepare("INSERT INTO note_contents (node_id, content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET content = excluded.content")
        .run(id, patch.content);
    }
    if (patch.tagIds !== undefined) {
      this.db.prepare("DELETE FROM node_tags WHERE node_id = ?").run(id);
      const ins = this.db.prepare(
        "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
      );
      for (const tid of patch.tagIds) ins.run(id, tid, now);
    }
    return this.getNote(id);
  };

  proto.deleteNote = function (this: 上下文, id: number): void {
    this.db.prepare("DELETE FROM nodes WHERE id = ? AND type = 'note'").run(id);
  };
}

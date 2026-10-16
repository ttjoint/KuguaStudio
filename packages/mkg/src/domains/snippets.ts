/**
 * 知识库域方法：文本段（snippet）
 *
 * 从原单体 MKG 类拆出（P2 结构化改造），以原型安装方式挂到 MKG.prototype。
 */
import type Database from "better-sqlite3";
import type { 文本片段, 文本片段更新 } from "../types.js";

declare module "../index.js" {
  interface MKG {
    确保片段表(): void;
    createSnippet(title: string, content?: string, tagIds?: number[]): 文本片段;
    getSnippet(id: number): 文本片段 | undefined;
    listSnippets(): 文本片段[];
    updateSnippet(id: number, patch: 文本片段更新): 文本片段 | undefined;
    deleteSnippet(id: number): void;
  }
}

interface 上下文 {
  db: Database.Database;
  确保片段表(): void;
  getSnippet(id: number): 文本片段 | undefined;
}

export function 安装片段域(proto: { [k: string]: unknown }): void {
  proto.确保片段表 = function (this: 上下文): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snippet_contents (
        node_id INTEGER PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      )
    `);
  };

  proto.createSnippet = function (this: 上下文, title: string, content = "", tagIds: number[] = []): 文本片段 {
    this.确保片段表();
    const now = Math.floor(Date.now() / 1000);
    const res = this.db
      .prepare("INSERT INTO nodes (type, title, created_at, updated_at) VALUES ('snippet', ?, ?, ?)")
      .run(title, now, now);
    const nodeId = Number(res.lastInsertRowid);
    this.db.prepare("INSERT INTO snippet_contents (node_id, content) VALUES (?, ?)").run(nodeId, content);
    const ins = this.db.prepare(
      "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
    );
    for (const tid of tagIds) ins.run(nodeId, tid, now);
    return this.getSnippet(nodeId)!;
  };

  proto.getSnippet = function (this: 上下文, id: number): 文本片段 | undefined {
    this.确保片段表();
    const row = this.db
      .prepare(
        "SELECT n.id, n.title, n.created_at AS createdAt, n.updated_at AS updatedAt, c.content FROM nodes n LEFT JOIN snippet_contents c ON c.node_id = n.id WHERE n.id = ? AND n.type = 'snippet'",
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

  proto.listSnippets = function (this: 上下文): 文本片段[] {
    this.确保片段表();
    const rows = this.db
      .prepare("SELECT id FROM nodes WHERE type = 'snippet' ORDER BY id DESC")
      .all() as { id: number }[];
    return rows.map((r) => this.getSnippet(r.id)!).filter(Boolean);
  };

  proto.updateSnippet = function (this: 上下文, id: number, patch: 文本片段更新): 文本片段 | undefined {
    this.确保片段表();
    const existing = this.getSnippet(id);
    if (!existing) return undefined;
    const now = Math.floor(Date.now() / 1000);
    if (patch.title !== undefined) {
      this.db.prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?").run(patch.title, now, id);
    }
    if (patch.content !== undefined) {
      this.db
        .prepare("INSERT INTO snippet_contents (node_id, content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET content = excluded.content")
        .run(id, patch.content);
    }
    if (patch.tagIds !== undefined) {
      this.db.prepare("DELETE FROM node_tags WHERE node_id = ?").run(id);
      const ins = this.db.prepare(
        "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
      );
      for (const tid of patch.tagIds) ins.run(id, tid, now);
    }
    return this.getSnippet(id);
  };

  proto.deleteSnippet = function (this: 上下文, id: number): void {
    this.db.prepare("DELETE FROM nodes WHERE id = ? AND type = 'snippet'").run(id);
  };
}

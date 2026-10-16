/**
 * 知识库域方法：素材（material）
 *
 * 从原单体 MKG 类拆出（P2 结构化改造），以原型安装方式挂到 MKG.prototype。
 */
import type Database from "better-sqlite3";
import type { 素材, 素材更新 } from "../types.js";

declare module "../index.js" {
  interface MKG {
    确保素材表(): void;
    createMaterial(data: {
      title: string;
      content?: string;
      kind?: string;
      sourceUrl?: string;
      imageUrl?: string;
      tagIds?: number[];
    }): 素材;
    getMaterial(id: number): 素材 | undefined;
    listMaterials(): 素材[];
    updateMaterial(id: number, patch: 素材更新): 素材 | undefined;
    deleteMaterial(id: number): void;
  }
}

interface 上下文 {
  db: Database.Database;
  确保素材表(): void;
  getMaterial(id: number): 素材 | undefined;
}

export function 安装素材域(proto: { [k: string]: unknown }): void {
  proto.确保素材表 = function (this: 上下文): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS material_contents (
        node_id INTEGER PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      )
    `);
  };

  proto.createMaterial = function (
    this: 上下文,
    data: { title: string; content?: string; kind?: string; sourceUrl?: string; imageUrl?: string; tagIds?: number[] },
  ): 素材 {
    this.确保素材表();
    const now = Math.floor(Date.now() / 1000);
    const meta = JSON.stringify({
      kind: data.kind ?? "",
      sourceUrl: data.sourceUrl ?? "",
      imageUrl: data.imageUrl ?? "",
    });
    const res = this.db
      .prepare("INSERT INTO nodes (type, title, meta, created_at, updated_at) VALUES ('material', ?, ?, ?, ?)")
      .run(data.title, meta, now, now);
    const nodeId = Number(res.lastInsertRowid);
    this.db.prepare("INSERT INTO material_contents (node_id, content) VALUES (?, ?)").run(nodeId, data.content ?? "");
    const ins = this.db.prepare(
      "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
    );
    for (const tid of data.tagIds ?? []) ins.run(nodeId, tid, now);
    return this.getMaterial(nodeId)!;
  };

  proto.getMaterial = function (this: 上下文, id: number): 素材 | undefined {
    this.确保素材表();
    const row = this.db
      .prepare(
        "SELECT n.id, n.title, n.meta, n.created_at AS createdAt, n.updated_at AS updatedAt, c.content FROM nodes n LEFT JOIN material_contents c ON c.node_id = n.id WHERE n.id = ? AND n.type = 'material'",
      )
      .get(id) as
      | { id: number; title: string; meta: string; createdAt: number; updatedAt: number; content: string | null }
      | undefined;
    if (!row) return undefined;
    let meta: { kind?: string; sourceUrl?: string; imageUrl?: string } = {};
    try { meta = JSON.parse(row.meta || "{}") as typeof meta; } catch { meta = {}; }
    const tagIds = (
      this.db.prepare("SELECT tag_id AS id FROM node_tags WHERE node_id = ?").all(id) as { id: number }[]
    ).map((r) => r.id);
    return {
      id: row.id,
      title: row.title,
      content: row.content ?? "",
      kind: meta.kind ?? "",
      sourceUrl: meta.sourceUrl ?? "",
      imageUrl: meta.imageUrl ?? "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tagIds,
    };
  };

  proto.listMaterials = function (this: 上下文): 素材[] {
    this.确保素材表();
    const rows = this.db
      .prepare("SELECT id FROM nodes WHERE type = 'material' ORDER BY id DESC")
      .all() as { id: number }[];
    return rows.map((r) => this.getMaterial(r.id)!).filter(Boolean);
  };

  proto.updateMaterial = function (this: 上下文, id: number, patch: 素材更新): 素材 | undefined {
    this.确保素材表();
    const existing = this.getMaterial(id);
    if (!existing) return undefined;
    const now = Math.floor(Date.now() / 1000);
    if (patch.title !== undefined) {
      this.db.prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?").run(patch.title, now, id);
    }
    if (patch.content !== undefined) {
      this.db
        .prepare("INSERT INTO material_contents (node_id, content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET content = excluded.content")
        .run(id, patch.content);
    }
    const metaRaw = this.db.prepare("SELECT meta FROM nodes WHERE id = ?").get(id) as { meta: string };
    let meta: { kind?: string; sourceUrl?: string; imageUrl?: string } = {};
    try { meta = JSON.parse(metaRaw.meta || "{}") as typeof meta; } catch { meta = {}; }
    if (patch.kind !== undefined) meta.kind = patch.kind;
    if (patch.sourceUrl !== undefined) meta.sourceUrl = patch.sourceUrl;
    if (patch.imageUrl !== undefined) meta.imageUrl = patch.imageUrl;
    this.db.prepare("UPDATE nodes SET meta = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(meta), now, id);
    if (patch.tagIds !== undefined) {
      this.db.prepare("DELETE FROM node_tags WHERE node_id = ?").run(id);
      const ins = this.db.prepare(
        "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
      );
      for (const tid of patch.tagIds) ins.run(id, tid, now);
    }
    return this.getMaterial(id);
  };

  proto.deleteMaterial = function (this: 上下文, id: number): void {
    this.db.prepare("DELETE FROM nodes WHERE id = ? AND type = 'material'").run(id);
  };
}

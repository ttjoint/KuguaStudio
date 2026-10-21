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
    /** 按来源 URL 查素材（真列 + 索引，AI 检索用） */
    listMaterialsBySourceUrl(sourceUrl: string, limit?: number): 素材[];
    updateMaterial(id: number, patch: 素材更新): 素材 | undefined;
    deleteMaterial(id: number): void;
  }
}

interface 上下文 {
  db: Database.Database;
  确保素材表(): void;
  getMaterial(id: number): 素材 | undefined;
  /** 一次性初始化守卫（避免每次 CRUD 重复跑列检测/回填扫描） */
  素材表已就绪?: boolean;
}
export function 安装素材域(proto: { [k: string]: unknown }): void {
  proto.确保素材表 = function (this: 上下文): void {
    // 幂等且只做一次：本函数在每次 CRUD 都会调用，而下面的列检测 + 回填扫描
    // 不需要重复执行（表结构不会在运行中变化），重复执行会累积语句句柄并拖慢每次读写。
    if (this.素材表已就绪) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS material_contents (
        node_id INTEGER PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      )
    `);
    // 真列化（技术债 P2）：kind / source_url / image_url 从 nodes.meta 搬到真列。
    // 为何要搬：meta 是黑盒 JSON，无法 WHERE / ORDER / 建索引；AI 检索需要按 sourceUrl 查。
    const 列 = this.db.prepare("PRAGMA table_info(material_contents)").all() as { name: string }[];
    const 有 = new Set(列.map((c) => c.name));
    if (!有.has("kind")) this.db.exec("ALTER TABLE material_contents ADD COLUMN kind TEXT NOT NULL DEFAULT ''");
    if (!有.has("source_url")) this.db.exec("ALTER TABLE material_contents ADD COLUMN source_url TEXT NOT NULL DEFAULT ''");
    if (!有.has("image_url")) this.db.exec("ALTER TABLE material_contents ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
    // 一次性回填：把旧库 nodes.meta 里的字段搬进真列（仅在真列仍为空时）
    try {
      const 待回填 = this.db
        .prepare(
          "SELECT n.id AS id, n.meta AS meta FROM nodes n JOIN material_contents c ON c.node_id = n.id WHERE n.type = 'material' AND c.kind = '' AND c.source_url = '' AND c.image_url = '' AND n.meta LIKE '%kind%'",
        )
        .all() as { id: number; meta: string }[];
      const 更新 = this.db.prepare(
        "UPDATE material_contents SET kind = ?, source_url = ?, image_url = ? WHERE node_id = ?",
      );
      for (const r of 待回填) {
        let m: { kind?: string; sourceUrl?: string; imageUrl?: string } = {};
        try {
          m = JSON.parse(r.meta || "{}") as typeof m;
        } catch {
          continue;
        }
        更新.run(m.kind ?? "", m.sourceUrl ?? "", m.imageUrl ?? "", r.id);
      }
    } catch {
      // 回填失败不影响使用：读时仍有 meta 回退
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_material_source_url ON material_contents(source_url)");
    this.素材表已就绪 = true;
  };

  proto.createMaterial = function (
    this: 上下文,
    data: { title: string; content?: string; kind?: string; sourceUrl?: string; imageUrl?: string; tagIds?: number[] },
  ): 素材 {
    this.确保素材表();
    const now = Math.floor(Date.now() / 1000);
    // meta 保留为兜底（旧版本程序读新库时不至于丢字段），但真列才是事实来源
    const meta = JSON.stringify({
      kind: data.kind ?? "",
      sourceUrl: data.sourceUrl ?? "",
      imageUrl: data.imageUrl ?? "",
    });
    const res = this.db
      .prepare("INSERT INTO nodes (type, title, meta, created_at, updated_at) VALUES ('material', ?, ?, ?, ?)")
      .run(data.title, meta, now, now);
    const nodeId = Number(res.lastInsertRowid);
    this.db
      .prepare("INSERT INTO material_contents (node_id, content, kind, source_url, image_url) VALUES (?, ?, ?, ?, ?)")
      .run(nodeId, data.content ?? "", data.kind ?? "", data.sourceUrl ?? "", data.imageUrl ?? "");
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
        "SELECT n.id, n.title, n.meta, n.created_at AS createdAt, n.updated_at AS updatedAt, c.content, c.kind AS cKind, c.source_url AS cSourceUrl, c.image_url AS cImageUrl FROM nodes n LEFT JOIN material_contents c ON c.node_id = n.id WHERE n.id = ? AND n.type = 'material'",
      )
      .get(id) as
      | {
          id: number;
          title: string;
          meta: string;
          createdAt: number;
          updatedAt: number;
          content: string | null;
          cKind: string | null;
          cSourceUrl: string | null;
          cImageUrl: string | null;
        }
      | undefined;
    if (!row) return undefined;
    // 真列优先；为空时回退到 meta（旧库尚未回填的情况）
    let meta: { kind?: string; sourceUrl?: string; imageUrl?: string } = {};
    try { meta = JSON.parse(row.meta || "{}") as typeof meta; } catch { meta = {}; }
    const tagIds = (
      this.db.prepare("SELECT tag_id AS id FROM node_tags WHERE node_id = ?").all(id) as { id: number }[]
    ).map((r) => r.id);
    return {
      id: row.id,
      title: row.title,
      content: row.content ?? "",
      kind: row.cKind || meta.kind || "",
      sourceUrl: row.cSourceUrl || meta.sourceUrl || "",
      imageUrl: row.cImageUrl || meta.imageUrl || "",
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

  proto.listMaterialsBySourceUrl = function (
    this: 上下文,
    sourceUrl: string,
    limit = 100,
  ): 素材[] {
    this.确保素材表();
    if (!sourceUrl) return [];
    // 走真列索引（idx_material_source_url），不扫 meta JSON。
    // 注意：不在 SQL 里 ORDER BY——本机 better-sqlite3 + Node 24 在
    // 「source_url 等值 + ORDER BY node_id」的索引扫描路径上会触发原生断言崩溃。
    // 改为取回后在内存排序（结果集受 limit 限制，代价可忽略）。
    const rows = this.db
      .prepare("SELECT node_id AS id FROM material_contents WHERE source_url = ? LIMIT ?")
      .all(sourceUrl, Math.max(1, Math.min(limit, 1000))) as { id: number }[];
    rows.sort((a, b) => b.id - a.id); // 新→旧
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
    // 真列写入（事实来源）
    const 列更新: string[] = [];
    const 参数: unknown[] = [];
    if (patch.kind !== undefined) {
      列更新.push("kind = ?");
      参数.push(patch.kind);
    }
    if (patch.sourceUrl !== undefined) {
      列更新.push("source_url = ?");
      参数.push(patch.sourceUrl);
    }
    if (patch.imageUrl !== undefined) {
      列更新.push("image_url = ?");
      参数.push(patch.imageUrl);
    }
    if (列更新.length > 0) {
      this.db.prepare(`UPDATE material_contents SET ${列更新.join(", ")} WHERE node_id = ?`).run(...参数, id);
    }
    // meta 同步（向旧版本程序兼容；读取时真列优先，所以 meta 落后也不影响本版本）
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

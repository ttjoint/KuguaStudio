/**
 * 知识库域方法：AI 生成内容（aigc）
 *
 * 沙箱边界：AI 只能写自己 session（agent_id）下的 aigc 节点，
 * 正文存 aigc_contents 表，绝不直接写磁盘文件。
 */
import type Database from "better-sqlite3";
import type { AIGC内容, AIGC更新 } from "../types.js";

declare module "../index.js" {
  interface MKG {
    确保AIGC表(): void;
    createAigc(agentId: string, title: string, content?: string, tagIds?: number[]): AIGC内容;
    getAigc(agentId: string, id: number): AIGC内容 | undefined;
    listAigcByAgent(agentId: string): AIGC内容[];
    updateAigc(agentId: string, id: number, patch: AIGC更新): AIGC内容 | undefined;
    deleteAigc(agentId: string, id: number): void;
    /** 用户视角：查看任意 aigc（不按 agent_id 隔离，用户拥有整个知识库） */
    用户GetAigc(id: number): AIGC内容 | undefined;
    /** 用户视角：列出全部 aigc（可按 agentId / 关键词筛选） */
    用户ListAigc(opts?: { agentId?: string; keyword?: string; limit?: number }): AIGC内容[];
    /** 用户视角：删除任意 aigc */
    用户DeleteAigc(id: number): void;
    /** 列出所有产生过 aigc 的 agent_id 及其内容数 */
    列表AigcAgent(): Array<{ agentId: string; count: number }>;
  }
}

interface 上下文 {
  db: Database.Database;
  确保AIGC表(): void;
  getAigc(agentId: string, id: number): AIGC内容 | undefined;
  用户GetAigc(id: number): AIGC内容 | undefined;
}

export function 安装AIGC域(proto: { [k: string]: unknown }): void {
  proto.确保AIGC表 = function (this: 上下文): void {
    // 表已在 db.ts 初始化时创建（含 agent_id 索引），这里幂等兜底
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS aigc_contents (
        node_id INTEGER PRIMARY KEY,
        agent_id TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_aigc_agent ON aigc_contents(agent_id);
    `);
  };

  proto.createAigc = function (
    this: 上下文,
    agentId: string,
    title: string,
    content = "",
    tagIds: number[] = [],
  ): AIGC内容 {
    this.确保AIGC表();
    const now = Math.floor(Date.now() / 1000);
    const res = this.db
      .prepare("INSERT INTO nodes (type, title, created_at, updated_at) VALUES ('aigc', ?, ?, ?)")
      .run(title, now, now);
    const nodeId = Number(res.lastInsertRowid);
    this.db
      .prepare("INSERT INTO aigc_contents (node_id, agent_id, content, updated_at) VALUES (?, ?, ?, ?)")
      .run(nodeId, agentId, content, now);
    const ins = this.db.prepare(
      "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
    );
    for (const tid of tagIds) ins.run(nodeId, tid, now);
    return this.getAigc(agentId, nodeId)!;
  };

  proto.getAigc = function (this: 上下文, agentId: string, id: number): AIGC内容 | undefined {
    this.确保AIGC表();
    const row = this.db
      .prepare(
        "SELECT n.id, n.title, n.created_at AS createdAt, n.updated_at AS updatedAt, c.agent_id AS agentId, c.content FROM nodes n LEFT JOIN aigc_contents c ON c.node_id = n.id WHERE n.id = ? AND n.type = 'aigc'",
      )
      .get(id) as
      | {
          id: number;
          title: string;
          createdAt: number;
          updatedAt: number;
          agentId: string | null;
          content: string | null;
        }
      | undefined;
    if (!row) return undefined;
    // 隔离边界：只能读到自己的 aigc
    if (row.agentId !== agentId) return undefined;
    const tagIds = (
      this.db.prepare("SELECT tag_id AS id FROM node_tags WHERE node_id = ?").all(id) as { id: number }[]
    ).map((r) => r.id);
    return {
      id: row.id,
      agentId: row.agentId ?? agentId,
      title: row.title,
      content: row.content ?? "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tagIds,
    };
  };

  proto.listAigcByAgent = function (this: 上下文, agentId: string): AIGC内容[] {
    this.确保AIGC表();
    const rows = this.db
      .prepare(
        "SELECT n.id FROM nodes n JOIN aigc_contents c ON c.node_id = n.id WHERE n.type = 'aigc' AND c.agent_id = ? ORDER BY n.id DESC",
      )
      .all(agentId) as { id: number }[];
    return rows.map((r) => this.getAigc(agentId, r.id)!).filter(Boolean);
  };

  proto.updateAigc = function (
    this: 上下文,
    agentId: string,
    id: number,
    patch: AIGC更新,
  ): AIGC内容 | undefined {
    this.确保AIGC表();
    const existing = this.getAigc(agentId, id);
    if (!existing) return undefined;
    const now = Math.floor(Date.now() / 1000);
    if (patch.title !== undefined) {
      this.db.prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?").run(patch.title, now, id);
    }
    if (patch.content !== undefined) {
      this.db
        .prepare(
          "INSERT INTO aigc_contents (node_id, agent_id, content, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(node_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
        )
        .run(id, agentId, patch.content, now);
    }
    if (patch.tagIds !== undefined) {
      this.db.prepare("DELETE FROM node_tags WHERE node_id = ?").run(id);
      const ins = this.db.prepare(
        "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) VALUES (?, ?, ?)",
      );
      for (const tid of patch.tagIds) ins.run(id, tid, now);
    }
    return this.getAigc(agentId, id);
  };

  proto.deleteAigc = function (this: 上下文, agentId: string, id: number): void {
    // 隔离边界：只删自己的
    this.db
      .prepare("DELETE FROM nodes WHERE id = ? AND type = 'aigc' AND id IN (SELECT node_id FROM aigc_contents WHERE agent_id = ?)")
      .run(id, agentId);
  };

  // ===== 用户视角（不按 agent_id 隔离）=====
  // 用户拥有整个知识库，UI 需要看到/管理所有 AI 生成内容。

  /** 按 id 读任意 aigc（用户视角，无隔离） */
  proto.用户GetAigc = function (this: 上下文, id: number): AIGC内容 | undefined {
    this.确保AIGC表();
    const row = this.db
      .prepare(
        "SELECT n.id, n.title, n.created_at AS createdAt, n.updated_at AS updatedAt, c.agent_id AS agentId, c.content FROM nodes n LEFT JOIN aigc_contents c ON c.node_id = n.id WHERE n.id = ? AND n.type = 'aigc'",
      )
      .get(id) as
      | {
          id: number;
          title: string;
          createdAt: number;
          updatedAt: number;
          agentId: string | null;
          content: string | null;
        }
      | undefined;
    if (!row) return undefined;
    const tagIds = (
      this.db.prepare("SELECT tag_id AS id FROM node_tags WHERE node_id = ?").all(id) as { id: number }[]
    ).map((r) => r.id);
    return {
      id: row.id,
      agentId: row.agentId ?? "",
      title: row.title,
      content: row.content ?? "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tagIds,
    };
  };

  /** 列出全部 aigc（用户视角，可按 agentId / 关键词筛选） */
  proto.用户ListAigc = function (
    this: 上下文,
    opts: { agentId?: string; keyword?: string; limit?: number } = {},
  ): AIGC内容[] {
    this.确保AIGC表();
    const 条件: string[] = ["n.type = 'aigc'"];
    const 参数: unknown[] = [];
    if (opts.agentId) {
      条件.push("c.agent_id = ?");
      参数.push(opts.agentId);
    }
    if (opts.keyword) {
      条件.push("(n.title LIKE ? OR c.content LIKE ?)");
      参数.push(`%${opts.keyword}%`, `%${opts.keyword}%`);
    }
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 2000));
    const rows = this.db
      .prepare(
        `SELECT n.id FROM nodes n JOIN aigc_contents c ON c.node_id = n.id WHERE ${条件.join(" AND ")} ORDER BY n.updated_at DESC, n.id DESC LIMIT ?`,
      )
      .all(...参数, limit) as { id: number }[];
    return rows.map((r) => this.用户GetAigc(r.id)!).filter(Boolean);
  };

  /** 删除任意 aigc（用户视角；aigc_contents 随外键级联删除） */
  proto.用户DeleteAigc = function (this: 上下文, id: number): void {
    this.db.prepare("DELETE FROM nodes WHERE id = ? AND type = 'aigc'").run(id);
  };

  /** 列出所有产生过 aigc 的 agent_id 及内容数（用于 UI 分组） */
  proto.列表AigcAgent = function (this: 上下文): Array<{ agentId: string; count: number }> {
    this.确保AIGC表();
    return this.db
      .prepare(
        "SELECT c.agent_id AS agentId, COUNT(*) AS count FROM aigc_contents c JOIN nodes n ON n.id = c.node_id WHERE n.type = 'aigc' GROUP BY c.agent_id ORDER BY count DESC",
      )
      .all() as Array<{ agentId: string; count: number }>;
  };
}

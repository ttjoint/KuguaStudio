/**
 * 知识库域方法：工作区（workspace）
 *
 * 工作区是对「库内已有节点」的可视化摆放视图（类似 ComfyUI 画布 / 文件夹），
 * **本身不存储任何资源数据**，仅保存：引用了哪个 node、摆在画布的什么位置/尺寸、
 * 以及可选的颜色标记与备注。删除工作区或放置项不会影响被引用的资源本身。
 *
 * 以原型安装方式挂到 MKG.prototype（P2 结构化改造同一范式）。
 */
import type Database from "better-sqlite3";
import type { 工作区, 工作区放置项, 放置项更新 } from "../types.js";

declare module "../index.js" {
  interface MKG {
    确保工作区表(): void;
    创建工作区(name: string, sort?: number): 工作区;
    获取工作区(id: number): 工作区 | null;
    列出工作区(): 工作区[];
    更新工作区(id: number, patch: { name?: string; sort?: number }): 工作区 | null;
    删除工作区(id: number): void;
    添加放置项(workspaceId: number, nodeId: number, 位置?: Partial<放置项更新>): 工作区放置项;
    列出放置项(workspaceId: number): 工作区放置项[];
    更新放置项(id: number, patch: 放置项更新): 工作区放置项 | null;
    删除放置项(id: number): void;
    清空放置项(workspaceId: number): void;
  }
}

interface 上下文 {
  db: Database.Database;
  确保工作区表(): void;
  获取工作区(id: number): 工作区 | null;
}

export function 安装工作区域(proto: { [k: string]: unknown }): void {
  proto.确保工作区表 = function (this: 上下文): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS workspace_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL,
        node_id INTEGER NOT NULL,
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        width REAL NOT NULL DEFAULT 220,
        height REAL NOT NULL DEFAULT 160,
        color TEXT,
        note TEXT,
        created_at INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_items_ws ON workspace_items(workspace_id);
    `);
  };

  proto.创建工作区 = function (this: 上下文, name: string, sort?: number): 工作区 {
    this.确保工作区表();
    const now = Math.floor(Date.now() / 1000);
    let 排序 = sort;
    if (排序 === undefined) {
      const 最大 = this.db.prepare("SELECT COALESCE(MAX(sort), -1) AS m FROM workspaces").get() as { m: number };
      排序 = 最大.m + 1;
    }
    const res = this.db
      .prepare("INSERT INTO workspaces (name, sort, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(name, 排序, now, now);
    return this.获取工作区(Number(res.lastInsertRowid))!;
  };

  proto.获取工作区 = function (this: 上下文, id: number): 工作区 | null {
    this.确保工作区表();
    const row = this.db
      .prepare(
        "SELECT id, name, sort, created_at AS createdAt, updated_at AS updatedAt FROM workspaces WHERE id = ?",
      )
      .get(id) as 工作区 | undefined;
    return row ?? null;
  };

  proto.列出工作区 = function (this: 上下文): 工作区[] {
    this.确保工作区表();
    return this.db
      .prepare(
        "SELECT id, name, sort, created_at AS createdAt, updated_at AS updatedAt FROM workspaces ORDER BY sort ASC, id ASC",
      )
      .all() as 工作区[];
  };

  proto.更新工作区 = function (
    this: 上下文,
    id: number,
    patch: { name?: string; sort?: number },
  ): 工作区 | null {
    this.确保工作区表();
    const 现有 = this.获取工作区(id);
    if (!现有) return null;
    const now = Math.floor(Date.now() / 1000);
    if (patch.name !== undefined) {
      this.db.prepare("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?").run(patch.name, now, id);
    }
    if (patch.sort !== undefined) {
      this.db.prepare("UPDATE workspaces SET sort = ?, updated_at = ? WHERE id = ?").run(patch.sort, now, id);
    }
    return this.获取工作区(id);
  };

  proto.删除工作区 = function (this: 上下文, id: number): void {
    this.确保工作区表();
    // 放置项随外键级联删除；不触碰被引用的资源/节点本身
    this.db.prepare("DELETE FROM workspace_items WHERE workspace_id = ?").run(id);
    this.db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  };

  const 读取放置项 = (db: Database.Database, id: number): 工作区放置项 | null => {
    const row = db
      .prepare(
        "SELECT id, workspace_id AS workspaceId, node_id AS nodeId, x, y, width, height, color, note, created_at AS createdAt FROM workspace_items WHERE id = ?",
      )
      .get(id) as 工作区放置项 | undefined;
    return row ?? null;
  };

  proto.添加放置项 = function (
    this: 上下文,
    workspaceId: number,
    nodeId: number,
    位置?: Partial<放置项更新>,
  ): 工作区放置项 {
    this.确保工作区表();
    const now = Math.floor(Date.now() / 1000);
    const res = this.db
      .prepare(
        "INSERT INTO workspace_items (workspace_id, node_id, x, y, width, height, color, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        workspaceId,
        nodeId,
        位置?.x ?? 0,
        位置?.y ?? 0,
        位置?.width ?? 220,
        位置?.height ?? 160,
        位置?.color ?? null,
        位置?.note ?? null,
        now,
      );
    return 读取放置项(this.db, Number(res.lastInsertRowid))!;
  };

  proto.列出放置项 = function (this: 上下文, workspaceId: number): 工作区放置项[] {
    this.确保工作区表();
    return this.db
      .prepare(
        "SELECT id, workspace_id AS workspaceId, node_id AS nodeId, x, y, width, height, color, note, created_at AS createdAt FROM workspace_items WHERE workspace_id = ? ORDER BY id ASC",
      )
      .all(workspaceId) as 工作区放置项[];
  };

  proto.更新放置项 = function (this: 上下文, id: number, patch: 放置项更新): 工作区放置项 | null {
    this.确保工作区表();
    const 现有 = 读取放置项(this.db, id);
    if (!现有) return null;
    const 字段: string[] = [];
    const 值: unknown[] = [];
    for (const k of ["x", "y", "width", "height", "color", "note"] as const) {
      if (patch[k] !== undefined) {
        字段.push(`${k} = ?`);
        值.push(patch[k]);
      }
    }
    if (字段.length === 0) return 现有;
    值.push(id);
    this.db.prepare(`UPDATE workspace_items SET ${字段.join(", ")} WHERE id = ?`).run(...值);
    return 读取放置项(this.db, id);
  };

  proto.删除放置项 = function (this: 上下文, id: number): void {
    this.确保工作区表();
    this.db.prepare("DELETE FROM workspace_items WHERE id = ?").run(id);
  };

  proto.清空放置项 = function (this: 上下文, workspaceId: number): void {
    this.确保工作区表();
    this.db.prepare("DELETE FROM workspace_items WHERE workspace_id = ?").run(workspaceId);
  };
}

/**
 * 知识库域方法：保存视图 / 受管位置 / 侧车 / 全文检索
 *
 * 从原单体 MKG 类拆出（P2 结构化改造），以原型安装方式挂到 MKG.prototype。
 * 详见 docs/知识库设计.md（v0.4）。
 */
import type Database from "better-sqlite3";
import type { 保存视图, 查询条件, 位置, 统一内容条目, 资源, 侧车数据 } from "../types.js";
import {
  读取侧车 as 侧车读取,
  写入侧车 as 侧车写入,
  合并侧车 as 侧车合并,
  侧车路径,
  侧车存在,
} from "../sidecar.js";

declare module "../index.js" {
  interface MKG {
    添加保存视图(name: string, query: 查询条件, icon?: string, sort?: number): 保存视图;
    获取保存视图(id: number): 保存视图 | null;
    列出保存视图(): 保存视图[];
    删除保存视图(id: number): void;
    执行查询(条件: 查询条件, limit?: number): 统一内容条目[];
    添加位置(path: string, name?: string, mode?: "watch" | "manual", excludes?: string[]): 位置;
    列出位置(): 位置[];
    删除位置(id: number): void;
    读取侧车(路径: string): 侧车数据 | null;
    写入侧车(路径: string, 数据: 侧车数据): void;
    合并侧车(路径: string, 补丁: Partial<侧车数据>): 侧车数据;
    侧车信息(路径: string): { path: string; exists: boolean };
    确保标签(name: string): import("../types.js").标签;
    导出侧车(nodeId: number): 侧车数据 | null;
    导入侧车(路径: string): { 资源id: number | null; 标签: number[] };
    重建全文索引(): { 节点数: number };
    全文检索(关键词: string, limit?: number): 统一内容条目[];
  }
}

interface 上下文 {
  db: Database.Database;
  listAllContent(opts?: { keyword?: string; sort?: "import" | "name" | "updated"; limit?: number }): 统一内容条目[];
  获取标签及后代Ids(tagId: number): Set<number>;
  列出位置(): 位置[];
  listTags(parentId?: number | null): import("../types.js").标签[];
  createTag(name: string, parentId?: number | null, description?: string): import("../types.js").标签;
  getResourceByNode(nodeId: number): 资源 | undefined;
  getResource(idOrPath: number | string): 资源 | undefined;
  getNodeTags(nodeId: number): import("../types.js").标签[];
  getAlias(resourceId: number): string | null;
  addResourceTags(resourceId: number, tagIds: number[]): import("../types.js").标签[];
  获取节点内容(node: { id: number; type: string }): string;
  添加保存视图(name: string, query: 查询条件, icon?: string, sort?: number): 保存视图;
  确保标签(name: string): import("../types.js").标签;
  获取保存视图(id: number): 保存视图 | null;
}

export function 安装视图位置域(proto: { [k: string]: unknown }): void {
  proto.添加保存视图 = function (
    this: 上下文,
    name: string,
    query: 查询条件,
    icon?: string,
    sort = 0,
  ): 保存视图 {
    const 当前 = Math.floor(Date.now() / 1000);
    const 结果 = this.db
      .prepare("INSERT INTO saved_views (name, query, icon, sort, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(name, JSON.stringify(query ?? {}), icon ?? null, sort, 当前);
    const 视图 = this.获取保存视图(Number(结果.lastInsertRowid));
    if (!视图) throw new Error("新增保存视图失败");
    return 视图;
  };

  proto.获取保存视图 = function (this: 上下文, id: number): 保存视图 | null {
    const row = this.db.prepare("SELECT * FROM saved_views WHERE id = ?").get(id) as
      | { id: number; name: string; query: string; icon: string | null; sort: number; created_at: number }
      | undefined;
    if (!row) return null;
    let query: 查询条件 = {};
    try {
      query = JSON.parse(row.query) as 查询条件;
    } catch {
      query = {};
    }
    return { id: row.id, name: row.name, query, icon: row.icon, sort: row.sort, createdAt: row.created_at };
  };

  proto.列出保存视图 = function (this: 上下文): 保存视图[] {
    const rows = this.db
      .prepare("SELECT id FROM saved_views ORDER BY sort ASC, id ASC")
      .all() as { id: number }[];
    return rows.map((r) => this.获取保存视图(r.id)).filter((v): v is 保存视图 => v !== null);
  };

  proto.删除保存视图 = function (this: 上下文, id: number): void {
    this.db.prepare("DELETE FROM saved_views WHERE id = ?").run(id);
  };

  proto.执行查询 = function (this: 上下文, 条件: 查询条件, limit = 2000): 统一内容条目[] {
    const 全部 = this.listAllContent({
      keyword: 条件.text,
      sort: 条件.sort ?? "import",
      limit: 100000,
    });
    const 命中标签 = new Set<number>();
    for (const tid of 条件.tags ?? []) {
      for (const x of this.获取标签及后代Ids(tid)) 命中标签.add(x);
    }
    const 排除标签 = new Set<number>();
    for (const tid of 条件.notTags ?? []) {
      for (const x of this.获取标签及后代Ids(tid)) 排除标签.add(x);
    }
    const 位置表 = 条件.locations && 条件.locations.length > 0 ? this.列出位置() : [];
    return 全部
      .filter((项) => {
        if (条件.type && 项.category !== 条件.type && 项.type !== 条件.type) return false;
        if (命中标签.size > 0 && !项.tagIds.some((t) => 命中标签.has(t))) return false;
        if (排除标签.size > 0 && 项.tagIds.some((t) => 排除标签.has(t))) return false;
        if (位置表.length > 0 && 项.path) {
          if (!位置表.some((l) => 项.path!.startsWith(l.path))) return false;
        }
        return true;
      })
      .slice(0, limit);
  };

  proto.添加位置 = function (
    this: 上下文,
    path: string,
    name?: string,
    mode: "watch" | "manual" = "watch",
    excludes: string[] = [],
  ): 位置 {
    const 当前 = Math.floor(Date.now() / 1000);
    const 结果 = this.db
      .prepare("INSERT INTO locations (path, name, mode, excludes, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(path, name ?? null, mode, JSON.stringify(excludes), 当前);
    return {
      id: Number(结果.lastInsertRowid),
      path,
      name: name ?? null,
      mode,
      excludes,
      createdAt: 当前,
    };
  };

  proto.列出位置 = function (this: 上下文): 位置[] {
    const rows = this.db.prepare("SELECT * FROM locations ORDER BY id ASC").all() as {
      id: number;
      path: string;
      name: string | null;
      mode: string;
      excludes: string;
      created_at: number;
    }[];
    return rows.map((row) => {
      let excludes: string[] = [];
      try {
        excludes = JSON.parse(row.excludes) as string[];
      } catch {
        excludes = [];
      }
      return {
        id: row.id,
        path: row.path,
        name: row.name,
        mode: row.mode === "manual" ? "manual" : "watch",
        excludes,
        createdAt: row.created_at,
      };
    });
  };

  proto.删除位置 = function (this: 上下文, id: number): void {
    this.db.prepare("DELETE FROM locations WHERE id = ?").run(id);
  };

  proto.读取侧车 = function (this: 上下文, 路径: string): 侧车数据 | null {
    void this;
    return 侧车读取(路径);
  };

  proto.写入侧车 = function (this: 上下文, 路径: string, 数据: 侧车数据): void {
    void this;
    侧车写入(路径, 数据);
  };

  proto.合并侧车 = function (this: 上下文, 路径: string, 补丁: Partial<侧车数据>): 侧车数据 {
    void this;
    return 侧车合并(路径, 补丁);
  };

  proto.侧车信息 = function (this: 上下文, 路径: string): { path: string; exists: boolean } {
    void this;
    return { path: 侧车路径(路径), exists: 侧车存在(路径) };
  };

  proto.确保标签 = function (this: 上下文, name: string): import("../types.js").标签 {
    const 现有 = this.listTags().find((t) => t.name === name);
    return 现有 ?? this.createTag(name);
  };

  proto.导出侧车 = function (this: 上下文, nodeId: number): 侧车数据 | null {
    const 资源 = this.getResourceByNode(nodeId);
    if (!资源) return null;
    const tags = this.getNodeTags(nodeId).map((t) => t.name);
    const 数据: 侧车数据 = {
      version: 1,
      sha256: 资源.sha256 || undefined,
      tags,
      relations: [],
      note: this.getAlias(资源.id) ?? undefined,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    侧车写入(资源.path, 数据);
    return 数据;
  };

  proto.导入侧车 = function (this: 上下文, 路径: string): { 资源id: number | null; 标签: number[] } {
    const 数据 = 侧车读取(路径);
    if (!数据) return { 资源id: null, 标签: [] };
    const 资源 = this.getResource(路径);
    if (!资源) return { 资源id: null, 标签: [] };
    const tagIds = (数据.tags ?? []).map((名) => this.确保标签(名).id);
    if (tagIds.length > 0) this.addResourceTags(资源.id, tagIds);
    return { 资源id: 资源.id, 标签: tagIds };
  };

  proto.重建全文索引 = function (this: 上下文): { 节点数: number } {
    const rows = this.db.prepare("SELECT id, type, title FROM nodes").all() as {
      id: number;
      type: string;
      title: string;
    }[];
    const 清空 = this.db.prepare("DELETE FROM node_fts");
    const 插入 = this.db.prepare("INSERT INTO node_fts (node_id, title, body) VALUES (?, ?, ?)");
    const 事务 = this.db.transaction(() => {
      清空.run();
      for (const row of rows) {
        插入.run(row.id, row.title, this.获取节点内容(row));
      }
    });
    事务();
    return { 节点数: rows.length };
  };

  proto.全文检索 = function (this: 上下文, 关键词: string, limit = 50): 统一内容条目[] {
    const 词 = 关键词.trim();
    if (!词) return [];
    let 命中: Set<number>;
    try {
      const rows = this.db
        .prepare("SELECT node_id FROM node_fts WHERE node_fts MATCH ? LIMIT ?")
        .all(词, limit) as { node_id: number }[];
      命中 = new Set(rows.map((r) => r.node_id));
    } catch {
      return this.listAllContent({ keyword: 词, limit });
    }
    const 全部 = this.listAllContent({ limit: 100000 });
    return 全部.filter((项) => 命中.has(项.id)).slice(0, limit);
  };
}

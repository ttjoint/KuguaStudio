/**
 * 知识库域方法：标签（创建 / 树 / 关联 / 相关标签）
 *
 * 从原单体 MKG 类拆出（P2 结构化改造），以原型安装方式挂到 MKG.prototype。
 */
import type Database from "better-sqlite3";
import type { 标签 } from "../types.js";

declare module "../index.js" {
  interface MKG {
    createTag(name: string, parentId?: number | null, description?: string): 标签;
    listTags(parentId?: number | null): 标签[];
    deleteTag(id: number): void;
    tagResource(resourceId: number, tagId: number): void;
    untagResource(resourceId: number, tagId: number): void;
    getResourceTags(resourceId: number): 标签[];
    getTagTree(): Array<标签 & { children: 标签[] }>;
    获取动态标签树(): Array<标签 & { children: 标签[]; count?: number }>;
    getResourceTagPaths(resourceId: number): string[][];
    getRelatedTags(tagId: number, limit?: number): Array<{ tag: 标签; 共现: number; 相关度: number }>;
    createTagTree(names: string[], description?: string): 标签;
    setResourceTags(resourceId: number, tagIds: number[]): 标签[];
    addResourceTags(resourceId: number, tagIds: number[]): 标签[];
    removeResourceTags(resourceId: number, tagIds: number[]): 标签[];
    获取标签路径(tagId: number): string[];
    setTagAiPublic(tagId: number, aiPublic: boolean): 标签;
  }
}

interface 上下文 {
  db: Database.Database;
  createTag(name: string, parentId?: number | null, description?: string): 标签;
  listTags(parentId?: number | null): 标签[];
  getResourceTags(resourceId: number): 标签[];
  获取标签路径(tagId: number): string[];
  tagResource(resourceId: number, tagId: number): void;
  untagResource(resourceId: number, tagId: number): void;
}

export function 安装标签域(proto: { [k: string]: unknown }): void {
  proto.createTag = function (
    this: 上下文,
    name: string,
    parentId?: number | null,
    description?: string,
  ): 标签 {
    const 当前时间 = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      INSERT INTO tags (name, parent_id, description, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        parent_id = excluded.parent_id,
        description = excluded.description
      RETURNING id, name, parent_id, description, ai_public
    `);
    const row = stmt.get(
      name,
      parentId ?? null,
      description ?? null,
      当前时间,
    ) as unknown as {
      id: number;
      name: string;
      parent_id: number | null;
      description: string | null;
      ai_public: number;
    };
    return {
      id: row.id,
      name: row.name,
      parentId: row.parent_id ?? null,
      description: row.description,
      aiPublic: row.ai_public === 1,
    };
  };

  proto.setTagAiPublic = function (this: 上下文, tagId: number, aiPublic: boolean): 标签 {
    this.db
      .prepare("UPDATE tags SET ai_public = ? WHERE id = ?")
      .run(aiPublic ? 1 : 0, tagId);
    const row = this.db
      .prepare("SELECT id, name, parent_id, description, ai_public FROM tags WHERE id = ?")
      .get(tagId) as unknown as
      | { id: number; name: string; parent_id: number | null; description: string | null; ai_public: number }
      | undefined;
    if (!row) throw new Error(`标签不存在：${tagId}`);
    return {
      id: row.id,
      name: row.name,
      parentId: row.parent_id ?? null,
      description: row.description,
      aiPublic: row.ai_public === 1,
    };
  };

  proto.listTags = function (this: 上下文, parentId?: number | null): 标签[] {
    const rows =
      parentId === undefined
        ? (this.db
            .prepare("SELECT id, name, parent_id, description, ai_public FROM tags")
            .all() as unknown as {
            id: number;
            name: string;
            parent_id: number | null;
            description: string | null;
            ai_public: number;
          }[])
        : (this.db
            .prepare("SELECT id, name, parent_id, description, ai_public FROM tags WHERE parent_id = ?")
            .all(parentId) as unknown as {
            id: number;
            name: string;
            parent_id: number | null;
            description: string | null;
            ai_public: number;
          }[]);
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      parentId: t.parent_id ?? null,
      description: t.description,
      aiPublic: t.ai_public === 1,
    }));
  };

  proto.deleteTag = function (this: 上下文, id: number): void {
    this.db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  };

  proto.tagResource = function (this: 上下文, resourceId: number, tagId: number): void {
    const 当前时间 = Math.floor(Date.now() / 1000);
    this.db
      .prepare("INSERT OR IGNORE INTO resource_tags (resource_id, tag_id, created_at) VALUES (?, ?, ?)")
      .run(resourceId, tagId, 当前时间);
  };

  proto.untagResource = function (this: 上下文, resourceId: number, tagId: number): void {
    this.db
      .prepare("DELETE FROM resource_tags WHERE resource_id = ? AND tag_id = ?")
      .run(resourceId, tagId);
  };

  proto.getResourceTags = function (this: 上下文, resourceId: number): 标签[] {
    const rows = this.db
      .prepare(`
        SELECT t.id, t.name, t.parent_id, t.description
        FROM tags t
        JOIN resource_tags rt ON rt.tag_id = t.id
        WHERE rt.resource_id = ?
      `)
      .all(resourceId) as unknown as { id: number; name: string; parent_id: number | null; description: string | null }[];
    return rows.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id ?? null, description: t.description }));
  };

  proto.getTagTree = function (this: 上下文): Array<标签 & { children: 标签[] }> {
    const allTags = this.listTags();
    const tagMap = new Map<number, 标签 & { children: 标签[] }>();
    const roots: Array<标签 & { children: 标签[] }> = [];

    for (const tag of allTags) {
      tagMap.set(tag.id, { ...tag, children: [] });
    }

    for (const tag of tagMap.values()) {
      if (tag.parentId !== null && tagMap.has(tag.parentId)) {
        tagMap.get(tag.parentId)!.children.push(tag);
      } else {
        roots.push(tag);
      }
    }

    return roots;
  };

  proto.获取动态标签树 = function (this: 上下文): Array<标签 & { children: 标签[]; count: number }> {
    const resourcePairs = this.db
      .prepare("SELECT tag_id, 'R' || resource_id AS objId FROM resource_tags")
      .all() as { tag_id: number; objId: string }[];
    const nodePairs = this.db
      .prepare("SELECT tag_id, 'N' || node_id AS objId FROM node_tags")
      .all() as { tag_id: number; objId: string }[];

    const 标签对象 = new Map<number, Set<string>>();
    for (const p of [...resourcePairs, ...nodePairs]) {
      if (!标签对象.has(p.tag_id)) 标签对象.set(p.tag_id, new Set());
      标签对象.get(p.tag_id)!.add(p.objId);
    }
    const 全部标签 = this.listTags();
    // 补上无对象标签（空集），作为可显示的叶节点
    for (const t of 全部标签) if (!标签对象.has(t.id)) 标签对象.set(t.id, new Set());

    // 为每个标签找「最接近的完全超集」作为父
    const 父 = new Map<number, number | null>();
    for (const id of 标签对象.keys()) {
      const setA = 标签对象.get(id)!;
      if (setA.size === 0) { 父.set(id, null); continue; }
      let 严格父: number | null = null;
      let 严格父大小 = Infinity;
      let 重合父: number | null = null; // 对象集完全重合时，以较小 id 者为父
      for (const [pid, setB] of 标签对象) {
        if (pid === id) continue;
        if (setB.size < setA.size) continue;
        let 包含 = true;
        for (const o of setA) if (!setB.has(o)) { 包含 = false; break; }
        if (!包含) continue;
        if (setB.size > setA.size) {
          if (setB.size < 严格父大小) { 严格父 = pid; 严格父大小 = setB.size; }
        } else if (重合父 === null || pid < 重合父) {
          重合父 = pid;
        }
      }
      父.set(id, 严格父 !== null ? 严格父 : (重合父 !== null && 重合父 < id ? 重合父 : null));
    }

    const nodes = new Map<number, 标签 & { children: 标签[]; count: number }>();
    for (const t of 全部标签) nodes.set(t.id, { ...t, children: [], count: 标签对象.get(t.id)?.size ?? 0 });
    const roots: Array<标签 & { children: 标签[]; count: number }> = [];
    for (const id of 标签对象.keys()) {
      const p = 父.get(id);
      const node = nodes.get(id)!;
      if (p == null || !nodes.has(p)) roots.push(node);
      else nodes.get(p)!.children.push(node);
    }
    return roots;
  };

  proto.getResourceTagPaths = function (this: 上下文, resourceId: number): string[][] {
    const tags = this.getResourceTags(resourceId);
    return tags.map((tag) => this.获取标签路径(tag.id));
  };

  proto.getRelatedTags = function (
    this: 上下文,
    tagId: number,
    limit = 12,
  ): Array<{ tag: 标签; 共现: number; 相关度: number }> {
    // 收集所有「标签 → 对象」映射：资源与节点统一视为对象（用类型前缀区分，避免 id 撞车）
    const resourcePairs = this.db
      .prepare("SELECT tag_id, 'R' || resource_id AS objId FROM resource_tags")
      .all() as { tag_id: number; objId: string }[];
    const nodePairs = this.db
      .prepare("SELECT tag_id, 'N' || node_id AS objId FROM node_tags")
      .all() as { tag_id: number; objId: string }[];

    const 标签对象 = new Map<number, Set<string>>();
    const 全部对象 = new Set<string>();
    for (const p of [...resourcePairs, ...nodePairs]) {
      全部对象.add(p.objId);
      if (!标签对象.has(p.tag_id)) 标签对象.set(p.tag_id, new Set());
      标签对象.get(p.tag_id)!.add(p.objId);
    }

    const 对象A = 标签对象.get(tagId);
    if (!对象A || 对象A.size === 0) return [];

    const n = 全部对象.size; // 有标签的对象总数
    const countA = 对象A.size;

    const 候选: Array<{ tagId: number; co: number; score: number }> = [];
    for (const [tid, 对象集] of 标签对象) {
      if (tid === tagId) continue;
      let co = 0;
      for (const o of 对象A) if (对象集.has(o)) co++;
      if (co === 0) continue;
      const countB = 对象集.size;
      // PMI：log( P(A∩B) / (P(A)·P(B)) )，再乘以共现次数作为权重
      const pmi = Math.log((co * n) / (countA * countB));
      候选.push({ tagId: tid, co, score: co * pmi });
    }

    候选.sort((a, b) => b.score - a.score);

    const 标签表 = new Map<number, 标签>();
    for (const t of this.listTags()) 标签表.set(t.id, t);

    return 候选
      .filter((c) => 标签表.has(c.tagId))
      .slice(0, limit)
      .map((c) => ({ tag: 标签表.get(c.tagId)!, 共现: c.co, 相关度: c.score }));
  };

  proto.createTagTree = function (this: 上下文, names: string[], description?: string): 标签 {
    if (names.length === 0) throw new Error("标签路径不能为空");
    let parentId: number | null = null;
    let createdTag: 标签 | null = null;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      let tag: 标签 | undefined;

      if (parentId === null) {
        const existing = this.db
          .prepare("SELECT id, name, parent_id, description FROM tags WHERE name = ? AND parent_id IS NULL")
          .get(name) as { id: number; name: string; parent_id: number | null; description: string | null } | undefined;
        if (existing) {
          tag = { id: existing.id, name: existing.name, parentId: existing.parent_id, description: existing.description };
        }
      } else {
        const existing = this.db
          .prepare("SELECT id, name, parent_id, description FROM tags WHERE name = ? AND parent_id = ?")
          .get(name, parentId) as { id: number; name: string; parent_id: number | null; description: string | null } | undefined;
        if (existing) {
          tag = { id: existing.id, name: existing.name, parentId: existing.parent_id, description: existing.description };
        }
      }

      if (!tag) {
        const isLast = i === names.length - 1;
        tag = this.createTag(name, parentId, isLast ? description : undefined);
      }
      parentId = tag.id;
      createdTag = tag;
    }

    return createdTag!;
  };

  proto.setResourceTags = function (this: 上下文, resourceId: number, tagIds: number[]): 标签[] {
    const 去重 = Array.from(new Set(tagIds));
    const 删除旧 = this.db.prepare("DELETE FROM resource_tags WHERE resource_id = ?");
    const 插入新 = this.db.prepare("INSERT OR IGNORE INTO resource_tags (resource_id, tag_id, created_at) VALUES (?, ?, ?)");
    const tx = this.db.transaction(() => {
      删除旧.run(resourceId);
      const ts = Math.floor(Date.now() / 1000);
      for (const tid of 去重) {
        插入新.run(resourceId, tid, ts);
      }
    });
    tx();
    return this.getResourceTags(resourceId);
  };

  proto.addResourceTags = function (this: 上下文, resourceId: number, tagIds: number[]): 标签[] {
    const 去重 = Array.from(new Set(tagIds));
    const ts = Math.floor(Date.now() / 1000);
    for (const tid of 去重) {
      this.tagResource(resourceId, tid);
      void ts;
    }
    return this.getResourceTags(resourceId);
  };

  proto.removeResourceTags = function (this: 上下文, resourceId: number, tagIds: number[]): 标签[] {
    for (const tid of tagIds) {
      this.untagResource(resourceId, tid);
    }
    return this.getResourceTags(resourceId);
  };
}

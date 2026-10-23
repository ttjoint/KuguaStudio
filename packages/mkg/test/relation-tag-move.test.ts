/**
 * 关联删除 + 标签移动
 *
 * 两个此前缺失的能力：
 * 1. 关联只能 add 不能 remove —— 建错了无法撤销，只能删内容重建
 * 2. 标签只能新建/删除，不能改父节点 —— 挂错位置只能删掉（丢内容关联）
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "../src/index.js";

function 造库(): MKG {
  const 目录 = mkdtempSync(join(tmpdir(), "mkg-rel-"));
  return new MKG(join(目录, "t.db"));
}

describe("removeRelation：关联可撤销", () => {
  it("删除已存在的关联返回 true，且列表里消失", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "内容A");
    const b = mkg.createNote("B", "内容B");
    mkg.addRelation(a.id, b.id, "references");
    expect(mkg.getRelations(a.id)).toHaveLength(1);

    expect(mkg.removeRelation(a.id, b.id, "references")).toBe(true);
    expect(mkg.getRelations(a.id)).toHaveLength(0);
  });

  it("删除不存在的关联返回 false（不抛错）", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "x");
    const b = mkg.createNote("B", "y");
    expect(mkg.removeRelation(a.id, b.id, "contains")).toBe(false);
  });

  it("只删指定类型，不影响其它类型", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "x");
    const b = mkg.createNote("B", "y");
    mkg.addRelation(a.id, b.id, "references");
    mkg.addRelation(a.id, b.id, "similar");

    mkg.removeRelation(a.id, b.id, "references");
    const 剩 = mkg.getRelations(a.id);
    expect(剩).toHaveLength(1);
    expect(剩[0].relationType).toBe("similar");
  });

  it("只删指定方向，反向关系不受影响", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "x");
    const b = mkg.createNote("B", "y");
    mkg.addRelation(a.id, b.id, "references");
    mkg.addRelation(b.id, a.id, "references");

    mkg.removeRelation(a.id, b.id, "references");
    expect(mkg.getRelations(a.id)).toHaveLength(0);
    expect(mkg.getRelations(b.id)).toHaveLength(1);
  });
});

describe("moveTag：标签可移动", () => {
  it("移到另一个标签下成为子标签", () => {
    const mkg = 造库();
    const 种植 = mkg.createTag("种植");
    const 番茄 = mkg.createTag("番茄");

    const 移动后 = mkg.moveTag(番茄.id, 种植.id);
    expect(移动后.parentId).toBe(种植.id);
    expect(mkg.listTags(种植.id).map((t) => t.name)).toEqual(["番茄"]);
  });

  it("移到根（newParentId = null）", () => {
    const mkg = 造库();
    const 种植 = mkg.createTag("种植");
    const 番茄 = mkg.createTag("番茄", 种植.id);
    expect(番茄.parentId).toBe(种植.id);

    const 移动后 = mkg.moveTag(番茄.id, null);
    expect(移动后.parentId).toBeNull();
  });

  it("拒绝移到自己下面", () => {
    const mkg = 造库();
    const a = mkg.createTag("A");
    expect(() => mkg.moveTag(a.id, a.id)).toThrow(/移到自己下面/);
  });

  it("拒绝移到自己的子孙下面（防循环）", () => {
    const mkg = 造库();
    const 根 = mkg.createTag("根");
    const 子 = mkg.createTag("子", 根.id);
    const 孙 = mkg.createTag("孙", 子.id);

    expect(() => mkg.moveTag(根.id, 孙.id)).toThrow(/子孙下面/);
    expect(() => mkg.moveTag(根.id, 子.id)).toThrow(/子孙下面/);
    // 树结构未被破坏
    expect(mkg.listTags(null).map((t) => t.name)).toEqual(["根"]);
  });

  it("目标父标签不存在时报错", () => {
    const mkg = 造库();
    const a = mkg.createTag("A");
    expect(() => mkg.moveTag(a.id, 99999)).toThrow(/目标父标签不存在/);
  });

  it("标签不存在时报错", () => {
    const mkg = 造库();
    expect(() => mkg.moveTag(99999, null)).toThrow(/标签不存在/);
  });

  it("移动不影响标签 id 与描述（只改父子关系）", () => {
    const mkg = 造库();
    const a = mkg.createTag("A", null, "原描述");
    const b = mkg.createTag("B");
    const 移动后 = mkg.moveTag(a.id, b.id);
    expect(移动后.id).toBe(a.id);
    expect(移动后.description).toBe("原描述");
  });

  it("移动后标签下的内容不受影响", () => {
    const mkg = 造库();
    const a = mkg.createTag("A");
    const b = mkg.createTag("B");
    const n = mkg.createNote("笔记", "内容", [a.id]);

    mkg.moveTag(a.id, b.id);
    // 内容仍挂在 a 上
    const 条目 = mkg.listAllContent({ limit: 100 }).find((x) => x.id === n.id);
    expect(条目?.tagIds).toContain(a.id);
  });
});

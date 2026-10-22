/**
 * 标签创建稳定性：同名标签不得被「搬家」
 *
 * 事故背景（用户报告的 bug）：
 *   在知识库页面点开文档，在左侧详情栏连续输入两个标签，
 *   后输入的那个会被自动挂到前一个标签下面，标签树结构错乱。
 *
 * 根因：tags.name 上有全局 UNIQUE 约束，而 createTag 原来用
 *   INSERT ... ON CONFLICT(name) DO UPDATE SET parent_id = excluded.parent_id
 * 这意味着「重新创建一个已存在于其它父节点下的同名标签」时，会把它从
 * 原位置**搬走**到新父节点下——静默破坏标签树。
 *
 * 修复：同名标签已存在就返回它（位置不变），只允许更新描述。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "../src/index.js";

function 造库(): MKG {
  const 目录 = mkdtempSync(join(tmpdir(), "mkg-tags-"));
  return new MKG(join(目录, "t.db"));
}

describe("createTag：同名标签保持原位置", () => {
  it("已存在于某父节点下时，再次创建不会把它搬到根", () => {
    const mkg = 造库();
    const 种植 = mkg.createTagTree(["种植"]);
    const 番茄 = mkg.createTagTree(["种植", "番茄"]);
    expect(番茄.parentId).toBe(种植.id);

    // 关键：单独创建同名标签（模拟用户在详情栏输入「番茄」）
    const 再次 = mkg.createTagTree(["番茄"]);

    expect(再次.id).toBe(番茄.id); // 是同一个标签
    expect(再次.parentId).toBe(种植.id); // 位置没变（修复前会变成 null）
  });

  it("已存在于根下时，再次创建不会把它搬到子节点下", () => {
    const mkg = 造库();
    const 番茄 = mkg.createTagTree(["番茄"]);
    expect(番茄.parentId).toBeNull();

    const 种植 = mkg.createTagTree(["种植"]);
    // 试图在 种植 下创建同名「番茄」
    const 再次 = mkg.createTagTree(["种植", "番茄"]);

    expect(再次.id).toBe(番茄.id);
    expect(再次.parentId).toBeNull(); // 仍在根下（修复前会被搬到 种植 下）
    expect(种植.id).not.toBe(番茄.id);
  });

  it("标签树结构在多次创建后保持稳定", () => {
    const mkg = 造库();
    mkg.createTagTree(["种植", "番茄"]);
    mkg.createTagTree(["养殖", "鸡"]);
    // 反复重新创建已有名字（模拟用户多次输入）
    mkg.createTagTree(["番茄"]);
    mkg.createTagTree(["鸡"]);
    mkg.createTagTree(["种植"]);

    // 根标签 = parentId 为 null
    const 全部 = mkg.listTags();
    const 根名 = 全部.filter((t) => t.parentId === null).map((t) => t.name).sort();
    expect(根名).toEqual(["养殖", "种植"]); // 番茄/鸡 不应跑到根下

    const 种植 = 全部.find((t) => t.name === "种植")!;
    const 子 = mkg.listTags(种植.id);
    expect(子.map((t) => t.name)).toContain("番茄");
  });

  it("描述：显式传入时更新，不传时保留原值", () => {
    const mkg = 造库();
    const a = mkg.createTag("标签", null, "原描述");
    expect(a.description).toBe("原描述");

    // 不传描述：保留
    const b = mkg.createTag("标签");
    expect(b.description).toBe("原描述");

    // 显式传描述：更新
    const c = mkg.createTag("标签", null, "新描述");
    expect(c.description).toBe("新描述");
  });

  it("同一父节点下同名标签返回同一个 id（幂等）", () => {
    const mkg = 造库();
    const a = mkg.createTagTree(["父", "子"]);
    const b = mkg.createTagTree(["父", "子"]);
    expect(b.id).toBe(a.id);
    expect(b.parentId).toBe(a.parentId);
  });
});

/**
 * 批量打标签：追加 / 移除
 *
 * 为什么需要：setNodeTags 是覆盖式（先 DELETE 全部再插入）。
 * 多选 10 条内容统一打标签时用它会把各自原有标签全冲掉——
 * 这是数据损坏，不是便利性问题。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "../src/index.js";

function 造库(): MKG {
  const 目录 = mkdtempSync(join(tmpdir(), "mkg-batch-"));
  return new MKG(join(目录, "t.db"));
}

describe("addNodeTags：批量追加", () => {
  it("给多个节点追加同一个标签", () => {
    const mkg = 造库();
    const t = mkg.createTag("统一标签");
    const a = mkg.createNote("A", "x");
    const b = mkg.createNote("B", "y");
    const c = mkg.createNote("C", "z");

    const r = mkg.addNodeTags([a.id, b.id, c.id], [t.id]);
    expect(r.更新).toBe(3);
    expect(r.跳过).toBe(0);

    for (const n of [a, b, c]) {
      expect(mkg.getNodeTags(n.id).map((x) => x.id)).toContain(t.id);
    }
  });

  it("**保留**原有标签（这是与 setNodeTags 的关键区别）", () => {
    const mkg = 造库();
    const 原有 = mkg.createTag("原有");
    const 新增 = mkg.createTag("新增");
    const a = mkg.createNote("A", "x", [原有.id]);
    expect(mkg.getNodeTags(a.id).map((x) => x.name)).toEqual(["原有"]);

    mkg.addNodeTags([a.id], [新增.id]);

    const 结果 = mkg.getNodeTags(a.id).map((x) => x.name).sort();
    expect(结果).toEqual(["原有", "新增"].sort()); // 原有没丢
  });

  it("一次追加多个标签", () => {
    const mkg = 造库();
    const t1 = mkg.createTag("T1");
    const t2 = mkg.createTag("T2");
    const a = mkg.createNote("A", "x");

    mkg.addNodeTags([a.id], [t1.id, t2.id]);
    expect(mkg.getNodeTags(a.id)).toHaveLength(2);
  });

  it("重复追加不产生重复记录（幂等）", () => {
    const mkg = 造库();
    const t = mkg.createTag("T");
    const a = mkg.createNote("A", "x");
    mkg.addNodeTags([a.id], [t.id]);
    mkg.addNodeTags([a.id], [t.id]);
    expect(mkg.getNodeTags(a.id)).toHaveLength(1);
  });

  it("不存在的节点被跳过并计数", () => {
    const mkg = 造库();
    const t = mkg.createTag("T");
    const a = mkg.createNote("A", "x");
    const r = mkg.addNodeTags([a.id, 999999], [t.id]);
    expect(r.更新).toBe(1);
    expect(r.跳过).toBe(1);
  });

  it("空输入安全返回", () => {
    const mkg = 造库();
    expect(mkg.addNodeTags([], [1])).toEqual({ 更新: 0, 跳过: 0 });
    expect(mkg.addNodeTags([1], [])).toEqual({ 更新: 0, 跳过: 1 });
  });

  it("非法 id 被过滤", () => {
    const mkg = 造库();
    const t = mkg.createTag("T");
    const a = mkg.createNote("A", "x");
    const r = mkg.addNodeTags([a.id, 0, -1, 1.5], [t.id]);
    expect(r.更新).toBe(1);
  });
});

describe("removeNodeTags：批量移除", () => {
  it("只移除指定标签，其它保留", () => {
    const mkg = 造库();
    const 留 = mkg.createTag("留");
    const 去 = mkg.createTag("去");
    const a = mkg.createNote("A", "x", [留.id, 去.id]);

    mkg.removeNodeTags([a.id], [去.id]);

    const 剩 = mkg.getNodeTags(a.id).map((x) => x.name);
    expect(剩).toEqual(["留"]);
  });

  it("批量移除多个节点的同一标签", () => {
    const mkg = 造库();
    const t = mkg.createTag("T");
    const a = mkg.createNote("A", "x", [t.id]);
    const b = mkg.createNote("B", "y", [t.id]);

    const r = mkg.removeNodeTags([a.id, b.id], [t.id]);
    expect(r.更新).toBe(2);
    expect(mkg.getNodeTags(a.id)).toHaveLength(0);
    expect(mkg.getNodeTags(b.id)).toHaveLength(0);
  });

  it("移除不存在的标签不报错", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "x");
    expect(() => mkg.removeNodeTags([a.id], [999999])).not.toThrow();
  });

  it("不存在的节点被跳过", () => {
    const mkg = 造库();
    const t = mkg.createTag("T");
    const a = mkg.createNote("A", "x", [t.id]);
    const r = mkg.removeNodeTags([a.id, 999999], [t.id]);
    expect(r.更新).toBe(1);
    expect(r.跳过).toBe(1);
  });
});

describe("对照：setNodeTags 是覆盖式（所以才需要 addNodeTags）", () => {
  it("setNodeTags 会清掉原有标签", () => {
    const mkg = 造库();
    const 原有 = mkg.createTag("原有");
    const 新 = mkg.createTag("新");
    const a = mkg.createNote("A", "x", [原有.id]);

    mkg.setNodeTags(a.id, [新.id]);

    const 结果 = mkg.getNodeTags(a.id).map((x) => x.name);
    expect(结果).toEqual(["新"]); // 原有被冲掉了
    expect(结果).not.toContain("原有");
  });
});

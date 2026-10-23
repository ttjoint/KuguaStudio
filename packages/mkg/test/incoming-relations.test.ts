/**
 * 反向关联：谁引用了我
 *
 * 为什么重要：getRelations 只查 from_node_id，B 的作者看不到「A 引用了我」。
 * 而 node_relations.to_node_id 有 ON DELETE CASCADE —— B 被删除时那些引用
 * 会静默消失，引用方毫无察觉。用户必须在删除前知道这个风险。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "../src/index.js";

function 造库(): MKG {
  const 目录 = mkdtempSync(join(tmpdir(), "mkg-inc-"));
  return new MKG(join(目录, "t.db"));
}

describe("getIncomingRelations：谁引用了我", () => {
  it("能查到引用方", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "x");
    const b = mkg.createNote("B", "y");
    mkg.addRelation(a.id, b.id, "references");

    const 被引用 = mkg.getIncomingRelations(b.id);
    expect(被引用).toHaveLength(1);
    expect(被引用[0].fromNodeId).toBe(a.id);
    expect(被引用[0].relationType).toBe("references");
  });

  it("与正向查询互不干扰（方向是独立的）", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "x");
    const b = mkg.createNote("B", "y");
    mkg.addRelation(a.id, b.id, "references");

    // A 正向有 1 条，反向 0 条
    expect(mkg.getRelations(a.id)).toHaveLength(1);
    expect(mkg.getIncomingRelations(a.id)).toHaveLength(0);
    // B 反过来
    expect(mkg.getRelations(b.id)).toHaveLength(0);
    expect(mkg.getIncomingRelations(b.id)).toHaveLength(1);
  });

  it("多个引用方都能查到", () => {
    const mkg = 造库();
    const 目标 = mkg.createNote("目标", "x");
    const a = mkg.createNote("A", "1");
    const b = mkg.createNote("B", "2");
    const c = mkg.createNote("C", "3");
    mkg.addRelation(a.id, 目标.id, "references");
    mkg.addRelation(b.id, 目标.id, "contains");
    mkg.addRelation(c.id, 目标.id, "similar");

    const 被引用 = mkg.getIncomingRelations(目标.id);
    expect(被引用).toHaveLength(3);
    expect(被引用.map((r) => r.fromNodeId).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("可按类型过滤", () => {
    const mkg = 造库();
    const 目标 = mkg.createNote("目标", "x");
    const a = mkg.createNote("A", "1");
    mkg.addRelation(a.id, 目标.id, "references");
    mkg.addRelation(a.id, 目标.id, "similar");

    expect(mkg.getIncomingRelations(目标.id, "references")).toHaveLength(1);
    expect(mkg.getIncomingRelations(目标.id, "contains")).toHaveLength(0);
  });

  it("无人引用时返回空数组", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "x");
    expect(mkg.getIncomingRelations(a.id)).toEqual([]);
  });

  it("删除关联后反向列表同步消失", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "x");
    const b = mkg.createNote("B", "y");
    mkg.addRelation(a.id, b.id, "references");
    expect(mkg.getIncomingRelations(b.id)).toHaveLength(1);

    mkg.removeRelation(a.id, b.id, "references");
    expect(mkg.getIncomingRelations(b.id)).toHaveLength(0);
  });
});

describe("countIncomingRelations：删除前警告用", () => {
  it("数量与列表长度一致", () => {
    const mkg = 造库();
    const 目标 = mkg.createNote("目标", "x");
    const a = mkg.createNote("A", "1");
    const b = mkg.createNote("B", "2");
    mkg.addRelation(a.id, 目标.id, "references");
    mkg.addRelation(b.id, 目标.id, "contains");

    expect(mkg.countIncomingRelations(目标.id)).toBe(2);
    expect(mkg.countIncomingRelations(目标.id)).toBe(mkg.getIncomingRelations(目标.id).length);
  });

  it("无人引用时为 0（不是 undefined）", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "x");
    expect(mkg.countIncomingRelations(a.id)).toBe(0);
  });

  it("不存在的节点也返回 0（不抛错）", () => {
    const mkg = 造库();
    expect(mkg.countIncomingRelations(999999)).toBe(0);
  });
});

describe("删除被引用的内容：引用级联消失（这就是要警告的原因）", () => {
  it("删除目标后，引用方的正向关联也没了", () => {
    const mkg = 造库();
    const a = mkg.createNote("A", "x");
    const b = mkg.createNote("B", "y");
    mkg.addRelation(a.id, b.id, "references");
    expect(mkg.getRelations(a.id)).toHaveLength(1);

    // 删除 B（被引用方）
    mkg.deleteNode(b.id);

    // A 的关联被外键级联删除，A 自己毫无察觉
    expect(mkg.getRelations(a.id)).toHaveLength(0);
  });
});

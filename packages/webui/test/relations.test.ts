/**
 * 内容关联 UI：契约与逻辑
 *
 * 背景：后端 mkg.relation.add / list 早已实现（contains/references/similar
 * 三种语义关系），但界面一直没入口，能力完全被浪费。
 * 现在详情栏加了关联区块。
 *
 * WebUI 测试跑在 Node（无 DOM），这里检查源码契约 + 独立验证分组逻辑。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const 根 = resolve(process.cwd(), "packages/webui");
function 读(相对: string): string {
  const p = resolve(根, 相对);
  if (!existsSync(p)) throw new Error(`找不到：${p}`);
  return readFileSync(p, "utf-8");
}

const 关联源 = () => 读("src/renderer/parts/07o-explorer-relations.ts");
const 页面源 = () => 读("src/renderer/index.html");
const 标签源 = () => 读("src/renderer/parts/07j-explorer-tags.ts");

describe("关联 UI：源码契约", () => {
  it("详情栏有关联区块容器与建立按钮", () => {
    const 源 = 页面源();
    expect(源).toContain('id="ex-info-relations"');
    expect(源).toContain('id="ex-info-relation-add"');
  });

  it("详情栏的重复标签树已移除", () => {
    // 同一界面不该有两棵标签树（左侧导航已有一棵）
    expect(页面源()).not.toContain('id="ex-info-tag-tree"');
  });

  it("关联列表走 mkg.relation.list", () => {
    expect(关联源()).toContain('"mkg.relation.list"');
  });

  it("建立关联走 mkg.relation.add，且带三个必需参数", () => {
    const 源 = 关联源();
    expect(源).toContain('"mkg.relation.add"');
    expect(源).toContain("fromNodeId");
    expect(源).toContain("toNodeId");
    expect(源).toContain("relationType");
  });

  it("三种关系类型都有中文名", () => {
    const 源 = 关联源();
    expect(源).toContain("contains");
    expect(源).toContain("references");
    expect(源).toContain("similar");
    expect(源).toContain("包含");
    expect(源).toContain("引用");
    expect(源).toContain("相似");
  });

  it("异步渲染有节点 id 守卫（防止把旧结果画到新条目上）", () => {
    const 源 = 关联源();
    // 请求前后都要检查 渲染中的节点ID
    const 守卫次数 = (源.match(/渲染中的节点ID !== nodeId/g) ?? []).length;
    expect(守卫次数).toBeGreaterThanOrEqual(2);
  });

  it("跳转用 mkg.node.get（查询条件无 nodeIds 字段）", () => {
    const 源 = 关联源();
    expect(源).toContain('"mkg.node.get"');
    expect(源).not.toContain("nodeIds:");
  });

  it("无选中内容时清空关联区", () => {
    expect(标签源()).toContain("清空关联()");
  });

  it("选中内容时触发关联渲染", () => {
    expect(标签源()).toContain("渲染关联(f.id)");
  });

  it("建立关联按钮已绑定", () => {
    const 源 = 读("src/renderer/parts/09-init.ts");
    expect(源).toContain("绑定关联事件()");
  });
});

describe("关联分组逻辑", () => {
  type 类型 = "contains" | "references" | "similar";
  interface 项 {
    toNodeId: number;
    relationType: 类型;
  }
  /** 复刻 07o 里的分组实现 */
  function 分组(列表: 项[]): Map<类型, number[]> {
    const m = new Map<类型, number[]>();
    for (const r of 列表) {
      const 组 = m.get(r.relationType);
      if (组) 组.push(r.toNodeId);
      else m.set(r.relationType, [r.toNodeId]);
    }
    return m;
  }

  it("按类型分组且保留顺序", () => {
    const 结果 = 分组([
      { toNodeId: 1, relationType: "references" },
      { toNodeId: 2, relationType: "contains" },
      { toNodeId: 3, relationType: "references" },
    ]);
    expect(结果.get("references")).toEqual([1, 3]);
    expect(结果.get("contains")).toEqual([2]);
    expect(结果.has("similar")).toBe(false);
  });

  it("空列表得到空分组", () => {
    expect(分组([]).size).toBe(0);
  });

  it("同类型多个目标不丢", () => {
    const 结果 = 分组([
      { toNodeId: 5, relationType: "similar" },
      { toNodeId: 6, relationType: "similar" },
      { toNodeId: 7, relationType: "similar" },
    ]);
    expect(结果.get("similar")).toEqual([5, 6, 7]);
  });
});

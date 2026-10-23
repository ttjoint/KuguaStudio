/**
 * 使用性复核修复：契约检查
 *
 * 这一批不是新功能，而是「用起来不合理」的问题：
 * 1. 全文搜索无结果时一片空白（用户以为搜索坏了）
 * 2. 筛选摘要不显示检索模式（切到「标签」模式搜不到正文，用户不知道为什么）
 * 3. 关联跳转强行重置标签筛选（回不去原来的浏览位置）
 * 4. 关联只能建不能删（建错了没救）
 * 5. 标签不能移动（挂错位置只能删掉重建）
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

describe("空结果提示", () => {
  it("渲染内容列表时调用空状态渲染", () => {
    const 源 = 读("src/renderer/parts/07-explorer.ts");
    expect(源).toContain("渲染空状态(files.length === 0)");
  });

  it("按检索模式给出不同建议", () => {
    const 源 = 读("src/renderer/parts/07-explorer.ts");
    expect(源).toContain("切到「全文」能搜正文内容");
    expect(源).toContain("「标签」模式只匹配标签名");
  });

  it("空状态里插关键词做了 HTML 转义", () => {
    const 源 = 读("src/renderer/parts/07-explorer.ts");
    expect(源).toContain("转义文本");
    expect(源).toContain("&amp;");
  });
});

describe("筛选摘要显示检索模式", () => {
  it("搜索摘要带模式名", () => {
    const 源 = 读("src/renderer/parts/07j-explorer-tags.ts");
    expect(源).toContain("搜索（${模式名}）");
    expect(源).toContain('Explorer.检索模式 === "full"');
  });
});

describe("关联跳转保留上下文", () => {
  it("跳转不再重置标签筛选", () => {
    const 源 = 读("src/renderer/parts/07o-explorer-relations.ts");
    const 段 = 源.slice(源.indexOf("async function 跳转并选中"));
    const 函数体 = 段.slice(0, 段.indexOf("/** 返回上一个跳转来源"));
    expect(函数体).not.toContain('Explorer.当前标签ID = "all"');
  });

  it("有跳转来源栈与返回函数", () => {
    const 源 = 读("src/renderer/parts/07o-explorer-relations.ts");
    expect(源).toContain("跳转来源栈");
    expect(源).toContain("返回上一跳转");
    expect(源).toContain("有跳转历史");
  });
});

describe("关联可删除", () => {
  it("前端调 mkg.relation.remove", () => {
    expect(读("src/renderer/parts/07o-explorer-relations.ts")).toContain('"mkg.relation.remove"');
  });

  it("后端有 removeRelation 域方法与 handler", () => {
    expect(读("../mkg/src/domains/resources.ts")).toContain("proto.removeRelation");
    expect(读("../modules/mkg/src/index.ts")).toContain('"mkg.relation.remove"');
    expect(读("../modules/mkg/src/capabilities.ts")).toContain('"mkg.relation.remove"');
  });
});

describe("标签可移动", () => {
  it("前端标签树支持拖拽", () => {
    const 源 = 读("src/renderer/parts/07j-explorer-tags.ts");
    expect(源).toContain("application/x-kugua-tag");
    expect(源).toContain("移动标签(源ID, node.id)");
  });

  it("提供「移到根」右键项", () => {
    expect(读("src/renderer/parts/07j-explorer-tags.ts")).toContain("移到根标签");
  });

  it("后端有 moveTag + handler + 能力声明", () => {
    expect(读("../mkg/src/domains/tags.ts")).toContain("proto.moveTag");
    expect(读("../modules/mkg/src/index.ts")).toContain('"mkg.tag.move"');
    expect(读("../modules/mkg/src/capabilities.ts")).toContain('"mkg.tag.move"');
  });
});

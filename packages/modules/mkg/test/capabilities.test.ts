/**
 * mkg 能力声明元数据校验。
 *
 * 这里不测试 handler 运行时（那属于集成测试），只验证声明本身自洽：
 * 名称唯一、破坏类必标危险、只读类 MCP 开放而写/破坏类 MCP 关闭。
 *
 * 这些约束一旦被破坏，会把 mkg 的写/删除操作泄漏给外部 agent（MCP），
 * 属于「看起来正常、实际开了口子」的安全问题，因此用测试锁死。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { 能力清单 } from "../src/capabilities";

describe("mkg 能力声明：唯一性与暴露策略", () => {
  it("能力名全局唯一", () => {
    const 名 = 能力清单.map((c) => c.名称);
    expect(new Set(名).size).toBe(名.length);
  });

  it("破坏类（删除/移除）全部标记危险", () => {
    const 破坏名 = 能力清单
      .filter((c) => /(delete|remove|trash)$/.test(c.名称))
      .map((c) => c.名称);
    expect(破坏名.length).toBeGreaterThan(0);
    for (const 名 of 破坏名) {
      const 声明 = 能力清单.find((c) => c.名称 === 名)!;
      expect(声明.危险, `破坏能力应标危险：${名}`).toBe(true);
    }
  });

  it("危险能力绝不可经 MCP 暴露", () => {
    for (const c of 能力清单) {
      if (c.危险) {
        expect(c.暴露?.MCP, `危险能力不可 MCP 暴露：${c.名称}`).not.toBe(true);
      }
    }
  });

  it("只读查询能力 MCP 开放（供外部 agent 检索）", () => {
    const 只读名 = [
      "mkg.query", "mkg.fts.search", "mkg.node.listAll", "mkg.node.get",
      "mkg.node.list", "mkg.node.search", "mkg.stats", "mkg.tag.tree",
      "mkg.tag.list", "mkg.tag.related", "mkg.note.list", "mkg.note.get",
      "mkg.material.list", "mkg.material.get", "mkg.snippet.list", "mkg.snippet.get",
      "mkg.card.columnList", "mkg.card.list", "mkg.card.get", "mkg.view.list",
      "mkg.view.get", "mkg.view.run", "mkg.location.list", "mkg.resource.list",
      "mkg.resource.get", "mkg.resource.detail", "mkg.data.read",
      "mkg.workspace.list",
      "mkg.workspace.items",
    ];
    for (const 名 of 只读名) {
      const 声明 = 能力清单.find((c) => c.名称 === 名);
      expect(声明, `缺失只读声明：${名}`).toBeDefined();
      expect(声明?.暴露?.MCP, `只读能力应 MCP 开放：${名}`).toBe(true);
      expect(声明?.危险, `只读能力不应标危险：${名}`).not.toBe(true);
    }
  });

  it("写入能力默认不对外（MCP=false）", () => {
    const 写入名 = 能力清单
      .filter((c) => /(create|update|save|add)$/.test(c.名称))
      .map((c) => c.名称);
    expect(写入名.length).toBeGreaterThan(0);
    for (const 名 of 写入名) {
      const 声明 = 能力清单.find((c) => c.名称 === 名)!;
      expect(声明.暴露?.MCP, `写入能力不应 MCP 暴露：${名}`).not.toBe(true);
    }
  });

  it("关键 CRUD 域都有完整声明覆盖", () => {
    // 每个内容域都应有 list/get/create/update/delete 的声明形态
    const 域 = ["note", "material", "snippet", "card"];
    for (const d of 域) {
      const 域声明 = 能力清单.filter((c) => c.名称.startsWith(`mkg.${d}.`));
      const 动作 = 域声明.map((c) => c.名称.replace(`mkg.${d}.`, ""));
      // 至少 list 和 create 一定在
      expect(动作).toContain("list");
      expect(动作).toContain("create");
    }
  });
});

describe("mkg 能力声明 ↔ handler 一致性", () => {
  it("每条声明都有对应的 onRequest handler 注册", () => {
    // 交叉验证：能力声明是元数据，handler 是实现。若声明了一个
    // 不存在的 handler（或 handler 被改名/删除而声明未同步），
    // 外部 agent 调它时会静默失败，故用测试锁死两者同步。
    const src = readFileSync(resolve(__dirname, "../src/index.ts"), "utf-8");
    const 缺失: string[] = [];
    for (const c of 能力清单) {
      if (!src.includes(`onRequest("${c.名称}"`)) {
        缺失.push(c.名称);
      }
    }
    expect(缺失, `声明了但缺 handler：${缺失.join(", ")}`).toEqual([]);
  });
});

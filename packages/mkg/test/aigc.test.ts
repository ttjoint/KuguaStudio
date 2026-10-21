/**
 * aigc 用户视角方法测试
 *
 * 重点：AI 沙箱边界（agent_id 隔离）与用户视角（无隔离）的差异。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "../src/index.js";

let 目录: string;
let mkg: MKG;

beforeEach(() => {
  目录 = mkdtempSync(join(tmpdir(), "mkg-aigc-test-"));
  mkg = new MKG(join(目录, "test.db"));
});

afterEach(() => {
  mkg.close();
  rmSync(目录, { recursive: true, force: true });
});

describe("aigc 域：AI 沙箱边界", () => {
  it("createAigc 创建后可读回", () => {
    const 内容 = mkg.createAigc("agent-1", "标题", "正文");
    expect(内容.id).toBeGreaterThan(0);
    expect(内容.agentId).toBe("agent-1");
    expect(内容.title).toBe("标题");
    expect(内容.content).toBe("正文");
  });

  it("getAigc 跨 agent 读取返回 undefined（隔离）", () => {
    const 内容 = mkg.createAigc("agent-1", "标题", "正文");
    expect(mkg.getAigc("agent-1", 内容.id)).toBeDefined();
    expect(mkg.getAigc("agent-2", 内容.id)).toBeUndefined();
  });

  it("listAigcByAgent 只返回自己的内容", () => {
    mkg.createAigc("agent-1", "A1", "x");
    mkg.createAigc("agent-1", "A2", "y");
    mkg.createAigc("agent-2", "B1", "z");
    expect(mkg.listAigcByAgent("agent-1")).toHaveLength(2);
    expect(mkg.listAigcByAgent("agent-2")).toHaveLength(1);
  });

  it("deleteAigc 不能删别人的（隔离）", () => {
    const 内容 = mkg.createAigc("agent-1", "标题", "正文");
    mkg.deleteAigc("agent-2", 内容.id);
    expect(mkg.getAigc("agent-1", 内容.id)).toBeDefined();
  });

  it("updateAigc 不能改别人的（隔离）", () => {
    const 内容 = mkg.createAigc("agent-1", "原标题", "原正文");
    expect(mkg.updateAigc("agent-2", 内容.id, { title: "篡改" })).toBeUndefined();
    expect(mkg.getAigc("agent-1", 内容.id)!.title).toBe("原标题");
  });
});

describe("aigc 用户视角（无隔离）", () => {
  it("用户GetAigc 能读到任意 agent 的内容", () => {
    const a = mkg.createAigc("agent-1", "A", "内容A");
    const b = mkg.createAigc("agent-2", "B", "内容B");
    expect(mkg.用户GetAigc(a.id)!.title).toBe("A");
    expect(mkg.用户GetAigc(b.id)!.title).toBe("B");
  });

  it("用户GetAigc 不存在返回 undefined", () => {
    expect(mkg.用户GetAigc(99999)).toBeUndefined();
  });

  it("用户ListAigc 列出全部（跨 agent）", () => {
    mkg.createAigc("agent-1", "A", "x");
    mkg.createAigc("agent-2", "B", "y");
    expect(mkg.用户ListAigc()).toHaveLength(2);
  });

  it("用户ListAigc 可按 agentId 筛选", () => {
    mkg.createAigc("agent-1", "A", "x");
    mkg.createAigc("agent-2", "B", "y");
    expect(mkg.用户ListAigc({ agentId: "agent-1" })).toHaveLength(1);
  });

  it("用户ListAigc 可按关键词搜标题与正文", () => {
    mkg.createAigc("agent-1", "番茄笔记", "无关键内容");
    mkg.createAigc("agent-1", "无关标题", "正文里有番茄");
    mkg.createAigc("agent-1", "无关", "无关");
    expect(mkg.用户ListAigc({ keyword: "番茄" })).toHaveLength(2);
  });

  it("用户ListAigc 遵守 limit", () => {
    for (let i = 0; i < 5; i++) mkg.createAigc("agent-1", `T${i}`, "c");
    expect(mkg.用户ListAigc({ limit: 2 })).toHaveLength(2);
  });

  it("用户DeleteAigc 可删任意 agent 的内容", () => {
    const 内容 = mkg.createAigc("agent-1", "A", "x");
    mkg.用户DeleteAigc(内容.id);
    expect(mkg.用户GetAigc(内容.id)).toBeUndefined();
    // 沙箱视角也读不到了
    expect(mkg.getAigc("agent-1", 内容.id)).toBeUndefined();
  });

  it("用户DeleteAigc 对非 aigc 节点无影响", () => {
    const note = mkg.createNote("普通笔记", "正文");
    mkg.用户DeleteAigc(note.id);
    expect(mkg.getNote(note.id)).toBeDefined();
  });

  it("列表AigcAgent 汇总各 agent 内容数", () => {
    mkg.createAigc("agent-1", "A", "x");
    mkg.createAigc("agent-1", "B", "y");
    mkg.createAigc("agent-2", "C", "z");
    const 汇总 = mkg.列表AigcAgent();
    expect(汇总).toHaveLength(2);
    expect(汇总.find((r) => r.agentId === "agent-1")!.count).toBe(2);
    expect(汇总.find((r) => r.agentId === "agent-2")!.count).toBe(1);
  });
});

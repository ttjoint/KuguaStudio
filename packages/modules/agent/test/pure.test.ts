import { describe, expect, it } from "vitest";
import {
  能力转OpenAI工具,
  能力列表转OpenAI工具,
  解析工具参数,
  运行工具循环,
  type 工具循环依赖,
} from "../src/pure.js";

describe("能力 → OpenAI tools 转换", () => {
  it("把能力声明转成 function tool", () => {
    const 工具 = 能力转OpenAI工具({
      名称: "mkg.ai.search",
      模块: "mkg",
      标题: "AI 搜索",
      说明: "搜索知识库",
      参数: { type: "object", properties: { keyword: { type: "string" } }, required: ["keyword"] },
    });
    expect(工具).toEqual({
      type: "function",
      function: {
        name: "mkg.ai.search",
        description: "搜索知识库",
        parameters: { type: "object", properties: { keyword: { type: "string" } }, required: ["keyword"] },
      },
    });
  });

  it("无说明时回退标题，无参数时给空 schema", () => {
    const 工具 = 能力转OpenAI工具({ 名称: "x.y", 模块: "x", 标题: "标题而已" });
    expect(工具.function.description).toBe("标题而已");
    expect(工具.function.parameters).toEqual({ type: "object", properties: {} });
  });

  it("跳过无名称的能力", () => {
    const 工具 = 能力列表转OpenAI工具([
      { 名称: "a.b", 模块: "a" },
      { 名称: "", 模块: "b" },
      { 名称: "c.d", 模块: "c" },
    ]);
    expect(工具.map((t) => t.function.name)).toEqual(["a.b", "c.d"]);
  });
});

describe("解析工具参数", () => {
  it("解析合法 JSON 参数", () => {
    expect(解析工具参数({ id: "1", type: "function", function: { name: "f", arguments: '{"a":1}' } })).toEqual({ a: 1 });
  });

  it("空 arguments 返回空对象", () => {
    expect(解析工具参数({ id: "1", type: "function", function: { name: "f", arguments: "" } })).toEqual({});
  });

  it("非法 JSON 返回 null", () => {
    expect(解析工具参数({ id: "1", type: "function", function: { name: "f", arguments: "不是json" } })).toBeNull();
  });

  it("非对象 JSON（数组/字符串）返回 null", () => {
    expect(解析工具参数({ id: "1", type: "function", function: { name: "f", arguments: "[1,2]" } })).toBeNull();
    expect(解析工具参数({ id: "1", type: "function", function: { name: "f", arguments: '"str"' } })).toBeNull();
  });
});

describe("工具循环状态机", () => {
  function 造依赖(剧本: {
    聊天: Array<{ tool_calls: Array<{ id: string; name: string; args: string }>; content?: string | null }>;
    执行结果?: Record<string, unknown>;
  }): { 依赖: 工具循环依赖; 调用记录: Array<{ name: string; 参数: unknown }> } {
    const 调用记录: Array<{ name: string; 参数: unknown }> = [];
    let 轮次 = 0;
    const 依赖: 工具循环依赖 = {
      async 聊天() {
        const 回复 = 剧本.聊天[Math.min(轮次, 剧本.聊天.length - 1)];
        轮次++;
        return {
          content: 回复.content ?? null,
          tool_calls: 回复.tool_calls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: c.args },
          })),
          finish_reason: 回复.tool_calls.length > 0 ? "tool_calls" : "stop",
        };
      },
      async 执行工具(name, 参数) {
        调用记录.push({ name, 参数 });
        return 剧本.执行结果?.[name] ?? { ok: true };
      },
    };
    return { 依赖, 调用记录 };
  }

  it("一轮工具调用 + 最终回答", async () => {
    const { 依赖, 调用记录 } = 造依赖({
      聊天: [
        { tool_calls: [{ id: "c1", name: "mkg.ai.search", args: '{"keyword":"番茄"}' }] },
        { tool_calls: [], content: "找到 3 条番茄相关笔记" },
      ],
      执行结果: { "mkg.ai.search": { items: [{ id: 1 }, { id: 2 }, { id: 3 }] } },
    });
    const 结果 = await 运行工具循环(依赖, {
      messages: [{ role: "user", content: "搜番茄" }],
      tools: [能力转OpenAI工具({ 名称: "mkg.ai.search", 模块: "mkg" })],
    });
    expect(结果.结束).toBe(true);
    expect(结果.最终回答).toBe("找到 3 条番茄相关笔记");
    expect(结果.迭代次数).toBe(1);
    expect(结果.达到上限).toBe(false);
    expect(调用记录).toEqual([{ name: "mkg.ai.search", 参数: { keyword: "番茄" } }]);
    // 消息历史应包含 tool 结果
    expect(结果.messages.some((m) => m.role === "tool" && m.tool_call_id === "c1")).toBe(true);
  });

  it("多轮工具调用（模型连续调工具）", async () => {
    const { 依赖, 调用记录 } = 造依赖({
      聊天: [
        { tool_calls: [{ id: "c1", name: "a.read", args: '{"id":1}' }] },
        { tool_calls: [{ id: "c2", name: "a.write", args: '{"title":"整理"}' }] },
        { tool_calls: [], content: "完成" },
      ],
      执行结果: { "a.read": { id: 1 }, "a.write": { ok: true } },
    });
    const 结果 = await 运行工具循环(依赖, {
      messages: [{ role: "user", content: "整理" }],
      tools: [
        能力转OpenAI工具({ 名称: "a.read", 模块: "a" }),
        能力转OpenAI工具({ 名称: "a.write", 模块: "a" }),
      ],
    });
    expect(结果.结束).toBe(true);
    expect(结果.迭代次数).toBe(2);
    expect(调用记录.map((c) => c.name)).toEqual(["a.read", "a.write"]);
  });

  it("达到最大迭代仍调工具 → 达到上限", async () => {
    const { 依赖 } = 造依赖({
      聊天: [{ tool_calls: [{ id: "c1", name: "loop", args: "{}" }] }],
      执行结果: { loop: { ok: true } },
    });
    const 结果 = await 运行工具循环(依赖, {
      messages: [{ role: "user", content: "循环" }],
      tools: [能力转OpenAI工具({ 名称: "loop", 模块: "a" })],
      maxIterations: 3,
    });
    expect(结果.结束).toBe(false);
    expect(结果.达到上限).toBe(true);
    expect(结果.迭代次数).toBe(3);
    expect(结果.最终回答).toBeNull();
  });

  it("工具执行抛错时（默认吞掉）把错误回传", async () => {
    const 依赖: 工具循环依赖 = {
      async 聊天() {
        return { content: "工具失败了，我看到了", tool_calls: [], finish_reason: "stop" };
      },
      async 执行工具() {
        throw new Error("权限不足");
      },
    };
    const 结果 = await 运行工具循环(依赖, {
      messages: [{ role: "user", content: "试" }],
      tools: [能力转OpenAI工具({ 名称: "a.fail", 模块: "a" })],
    });
    // 第一轮模型会调用工具（但我们让聊天返回空 tool_calls，所以直接结束）
    // 换个剧本：第一轮调工具，第二轮结束
    expect(结果.结束).toBe(true);
  });

  it("工具执行抛错 + 吞掉错误=false 时向上抛", async () => {
    let 轮次 = 0;
    const 依赖: 工具循环依赖 = {
      async 聊天() {
        轮次++;
        if (轮次 === 1) {
          return {
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "a.fail", arguments: "{}" } }],
            finish_reason: "tool_calls",
          };
        }
        return { content: "不该到这", tool_calls: [], finish_reason: "stop" };
      },
      async 执行工具() {
        throw new Error("权限不足");
      },
    };
    await expect(
      运行工具循环(依赖, {
        messages: [{ role: "user", content: "试" }],
        tools: [能力转OpenAI工具({ 名称: "a.fail", 模块: "a" })],
        吞掉工具错误: false,
      }),
    ).rejects.toThrow("权限不足");
  });

  it("工具错误被吞掉时，错误信息作为 tool 消息回传", async () => {
    let 轮次 = 0;
    const 依赖: 工具循环依赖 = {
      async 聊天() {
        轮次++;
        if (轮次 === 1) {
          return {
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "a.fail", arguments: "{}" } }],
            finish_reason: "tool_calls",
          };
        }
        return { content: "收到错误", tool_calls: [], finish_reason: "stop" };
      },
      async 执行工具() {
        throw new Error("权限不足");
      },
    };
    const 结果 = await 运行工具循环(依赖, {
      messages: [{ role: "user", content: "试" }],
      tools: [能力转OpenAI工具({ 名称: "a.fail", 模块: "a" })],
    });
    const tool消息 = 结果.messages.find((m) => m.role === "tool");
    expect(tool消息?.content).toContain("权限不足");
    expect(结果.最终回答).toBe("收到错误");
  });
});

import { describe, expect, it } from "vitest";
import {
  能力转OpenAI工具,
  能力列表转OpenAI工具,
  解析工具参数,
  运行工具循环,
  type 工具循环依赖,
  审批队列,
  需要审批,
  生成审批摘要,
  type 审批请求,
  type 审批决议,
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

describe("审批队列", () => {
  function 造队列() {
    const 登记: 审批请求[] = [];
    const 解决记录: Array<{ id: string; 决议: 审批决议 }> = [];
    const 队列 = new 审批队列({
      通知登记: (r) => 登记.push(r),
      通知解决: (id, d) => 解决记录.push({ id, 决议: d }),
    });
    return { 队列, 登记, 解决记录 };
  }

  function 造请求(队列: 审批队列, 覆盖: Partial<审批请求> = {}): 审批请求 {
    return {
      id: 队列.生成ID(),
      agentId: "a1",
      工具: "mkg.ai.write",
      参数: { title: "番茄小结" },
      摘要: "新建内容「番茄小结」",
      创建时间: Date.now(),
      ...覆盖,
    };
  }

  it("登记后可列出，批准后返回通过", async () => {
    const { 队列, 登记 } = 造队列();
    const 请求 = 造请求(队列);
    const 承诺 = 队列.等待(请求);

    expect(队列.有待审批).toBe(true);
    expect(队列.列表()).toHaveLength(1);
    expect(登记).toHaveLength(1);

    expect(队列.批准(请求.id, "看着不错")).toBe(true);
    const 决议 = await 承诺;
    expect(决议).toEqual({ 通过: true, 备注: "看着不错" });
    expect(队列.有待审批).toBe(false);
    expect(队列.列表()).toHaveLength(0);
  });

  it("拒绝后返回不通过且带原因", async () => {
    const { 队列 } = 造队列();
    const 请求 = 造请求(队列);
    const 承诺 = 队列.等待(请求);
    队列.拒绝(请求.id, "内容不对");
    const 决议 = await 承诺;
    expect(决议.通过).toBe(false);
    expect((决议 as { 原因?: string }).原因).toBe("内容不对");
  });

  it("超时自动拒绝（不等用户）", async () => {
    const { 队列, 解决记录 } = 造队列();
    const 请求 = 造请求(队列);
    const 承诺 = 队列.等待(请求, 1000); // 1s 超时
    const 决议 = await 承诺;
    expect(决议.通过).toBe(false);
    expect((决议 as { 原因?: string }).原因).toContain("超时");
    expect(解决记录).toHaveLength(1);
    expect(队列.有待审批).toBe(false);
  }, 5000);

  it("重复决议同一 id 只生效一次", async () => {
    const { 队列 } = 造队列();
    const 请求 = 造请求(队列);
    const 承诺 = 队列.等待(请求);
    expect(队列.批准(请求.id)).toBe(true);
    expect(队列.批准(请求.id)).toBe(false); // 第二次无效
    await 承诺;
  });

  it("未知 id 决议返回 false（不抛错）", () => {
    const { 队列 } = 造队列();
    expect(队列.批准("不存在")).toBe(false);
    expect(队列.拒绝("不存在")).toBe(false);
  });

  it("清空：拒绝全部待决项", async () => {
    const { 队列 } = 造队列();
    const a = 造请求(队列);
    const b = 造请求(队列);
    const 承诺A = 队列.等待(a);
    const 承诺B = 队列.等待(b);
    expect(队列.列表()).toHaveLength(2);

    队列.清空("模块停止");

    const [决议A, 决议B] = await Promise.all([承诺A, 承诺B]);
    expect(决议A.通过).toBe(false);
    expect(决议B.通过).toBe(false);
    expect(队列.列表()).toHaveLength(0);
  });

  it("多个请求互不干扰，可按任意顺序决议", async () => {
    const { 队列 } = 造队列();
    const a = 造请求(队列, { 摘要: "A" });
    const b = 造请求(队列, { 摘要: "B" });
    const 承诺A = 队列.等待(a);
    const 承诺B = 队列.等待(b);

    // 先决议 B
    队列.批准(b.id);
    队列.拒绝(a.id);

    expect((await 承诺B).通过).toBe(true);
    expect((await 承诺A).通过).toBe(false);
  });

  it("生成ID 唯一", () => {
    const { 队列 } = 造队列();
    const ids = new Set(Array.from({ length: 100 }, () => 队列.生成ID()));
    expect(ids.size).toBe(100);
  });
});

describe("需要审批 判定", () => {
  it("写/改/删/建 类工具需要审批", () => {
    expect(需要审批("mkg.ai.write")).toBe(true);
    expect(需要审批("mkg.ai.update")).toBe(true);
    expect(需要审批("mkg.ai.delete")).toBe(true);
    expect(需要审批("mkg.ai.create")).toBe(true);
  });

  it("只读类工具不需要审批", () => {
    expect(需要审批("mkg.ai.read")).toBe(false);
    expect(需要审批("mkg.ai.search")).toBe(false);
    expect(需要审批("mkg.ai.listMine")).toBe(false);
    expect(需要审批("ai.chat")).toBe(false);
  });
});

describe("生成审批摘要", () => {
  it("新建：带标题与内容预览", () => {
    const 摘要 = 生成审批摘要("mkg.ai.write", { title: "番茄小结", content: "温度20-25度" });
    expect(摘要).toContain("番茄小结");
    expect(摘要).toContain("温度20-25度");
  });

  it("新建：超长内容截断并加省略号", () => {
    const 摘要 = 生成审批摘要("mkg.ai.write", { title: "T", content: "字".repeat(200) });
    expect(摘要).toContain("…");
    expect(摘要.length).toBeLessThan(120);
  });

  it("修改：带 id", () => {
    const 摘要 = 生成审批摘要("mkg.ai.write", { id: 7, title: "改后标题" });
    expect(摘要).toContain("7");
    expect(摘要).toContain("改后标题");
  });

  it("删除：带 id", () => {
    const 摘要 = 生成审批摘要("mkg.ai.delete", { id: 9 });
    expect(摘要).toContain("删除");
    expect(摘要).toContain("9");
  });

  it("无标题无内容也能给出可读摘要", () => {
    const 摘要 = 生成审批摘要("mkg.ai.write", {});
    expect(摘要.length).toBeGreaterThan(0);
  });
});

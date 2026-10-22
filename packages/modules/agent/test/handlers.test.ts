import { describe, expect, it } from "vitest";
import { 注册Agent处理器 } from "../src/handlers.js";
import { 审批队列 } from "../src/pure.js";
import type { 循环消息, OpenAI工具 } from "../src/pure.js";

/** 最小 NiganeClient 桩：只记录 onRequest 注册的 handler */
function 造客户端(): {
  客户端: {
    handlers: Map<string, (参数: unknown) => Promise<unknown> | unknown>;
    onRequest: (a: string, h: (参数: unknown) => unknown) => void;
    sendEvent: (action: string, params?: unknown) => void;
  };
  处理: (action: string, 参数: unknown) => Promise<unknown>;
  事件: Array<{ action: string; params: unknown }>;
} {
  const handlers = new Map<string, (参数: unknown) => unknown>();
  const 事件: Array<{ action: string; params: unknown }> = [];
  return {
    客户端: {
      handlers,
      onRequest: (action, h) => handlers.set(action, h),
      sendEvent: (action, params) => 事件.push({ action, params }),
    },
    事件,
    处理: async (action, 参数) => {
      const h = handlers.get(action);
      if (!h) throw new Error(`无 handler：${action}`);
      return h(参数);
    },
  };
}

describe("agent handlers：能力过滤 + 工具循环接线", () => {
  function 造依赖(覆盖: {
    聊天?: (messages: 循环消息[], tools: OpenAI工具[]) => Promise<{ content: string | null; tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>; finish_reason?: string }>;
    执行工具?: (name: string, 参数: Record<string, unknown>) => Promise<unknown>;
    获取能力?: () => Promise<Array<{ 名称: string; 模块: string; 标题?: string; 说明?: string; 参数?: Record<string, unknown>; 危险?: boolean }>>;
  } = {}) {
    const 依赖 = {
      聊天: 覆盖.聊天 ?? (async () => ({ content: "完成", tool_calls: [], finish_reason: "stop" })),
      执行工具: 覆盖.执行工具 ?? (async () => ({ ok: true })),
      获取能力: 覆盖.获取能力 ?? (async () => [
        { 名称: "mkg.ai.read", 模块: "mkg", 标题: "读", 说明: "读可读内容" },
        { 名称: "mkg.ai.write", 模块: "mkg", 标题: "写", 说明: "写 aigc" },
        { 名称: "ai.chat", 模块: "ai", 标题: "对话", 说明: "AI 对话" },
        { 名称: "mkg.tag.delete", 模块: "mkg", 标题: "删标签", 说明: "删除", 危险: true },
      ]),
    };
    return 依赖;
  }

  it("agent.tools 只返回 AI 可见能力（危险能力被过滤，默认只读过滤写入）", async () => {
    const { 客户端, 处理 } = 造客户端();
    注册Agent处理器(客户端 as never, 造依赖());
    const 工具名 = (await 处理("agent.tools", {})) as string[];
    expect(工具名).toContain("mkg.ai.read");
    expect(工具名).toContain("ai.chat");
    expect(工具名).not.toContain("mkg.ai.write"); // 默认只读模式，写入能力被过滤
    expect(工具名).not.toContain("mkg.tag.delete");
  });

  it("agent.tools 只读=false 时包含写入能力", async () => {
    const { 客户端, 处理 } = 造客户端();
    注册Agent处理器(客户端 as never, 造依赖());
    const 工具名 = (await 处理("agent.tools", { 只读: false })) as string[];
    expect(工具名).toContain("mkg.ai.write");
    expect(工具名).toContain("mkg.ai.read");
    expect(工具名).not.toContain("mkg.tag.delete");
  });

  it("agent.run 执行完整工具循环并返回 agentId", async () => {
    const 调用 = { 聊天: 0, 执行: 0 };
    const { 客户端, 处理 } = 造客户端();
    const 依赖 = 造依赖({
      聊天: async () => {
        调用.聊天++;
        return { content: "已找到结果", tool_calls: [], finish_reason: "stop" };
      },
      执行工具: async () => {
        调用.执行++;
        return { ok: true };
      },
    });
    注册Agent处理器(客户端 as never, 依赖);
    const 结果 = (await 处理("agent.run", { prompt: "搜番茄", agentId: "agent-1" })) as {
      agentId: string;
      结束: boolean;
      最终回答: string;
    };
    expect(结果.agentId).toBe("agent-1");
    expect(结果.结束).toBe(true);
    expect(结果.最终回答).toBe("已找到结果");
    expect(调用.聊天).toBe(1);
  });

  it("agent.run 缺少 prompt 报错", async () => {
    const { 客户端, 处理 } = 造客户端();
    注册Agent处理器(客户端 as never, 造依赖());
    await expect(处理("agent.run", {})).rejects.toThrow("缺少 prompt");
  });

  it("工具循环里调用工具（模型发起 tool_calls）", async () => {
    const 调用 = { 执行工具名: "", 执行参数: {} as Record<string, unknown> };
    const { 客户端, 处理 } = 造客户端();
    let 轮次 = 0;
    const 依赖 = 造依赖({
      聊天: async () => {
        轮次++;
        if (轮次 === 1) {
          return {
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "mkg.ai.search", arguments: '{"keyword":"番茄"}' } }],
            finish_reason: "tool_calls",
          };
        }
        return { content: "找到番茄笔记", tool_calls: [], finish_reason: "stop" };
      },
      执行工具: async (name, 参数) => {
        调用.执行工具名 = name;
        调用.执行参数 = 参数;
        return { items: [1, 2] };
      },
    });
    注册Agent处理器(客户端 as never, 依赖);
    const 结果 = (await 处理("agent.run", { prompt: "搜番茄", agentId: "a" })) as { 最终回答: string };
    expect(结果.最终回答).toBe("找到番茄笔记");
    expect(调用.执行工具名).toBe("mkg.ai.search");
    expect(调用.执行参数).toEqual({ keyword: "番茄" });
  });
});

describe("agent 进度推送", () => {
  it("工具循环期间推送 agent.progress 事件（准备/思考/执行/结束）", async () => {
    const { 客户端, 处理, 事件 } = 造客户端();
    let 轮次 = 0;
    注册Agent处理器(客户端 as never, {
      聊天: async () => {
        轮次++;
        if (轮次 === 1) {
          return {
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "mkg.ai.search", arguments: '{"keyword":"x"}' } }],
            finish_reason: "tool_calls",
          };
        }
        return { content: "完成", tool_calls: [], finish_reason: "stop" };
      },
      执行工具: async () => ({ ok: true }),
      获取能力: async () => [{ 名称: "mkg.ai.search", 模块: "mkg" }],
    });

    await 处理("agent.run", { prompt: "搜", agentId: "a", 进度ID: "p1" });

    const 阶段 = 事件.filter((e) => e.action === "agent.progress").map((e) => (e.params as { 阶段: string }).阶段);
    expect(阶段).toContain("准备");
    expect(阶段).toContain("思考");
    expect(阶段).toContain("决定调用");
    expect(阶段).toContain("执行工具");
    expect(阶段).toContain("工具完成");
    expect(阶段).toContain("结束");
  });

  it("进度事件带同一个 进度ID（前端据此过滤）", async () => {
    const { 客户端, 处理, 事件 } = 造客户端();
    注册Agent处理器(客户端 as never, {
      聊天: async () => ({ content: "好", tool_calls: [], finish_reason: "stop" }),
      执行工具: async () => ({}),
      获取能力: async () => [],
    });
    const r = (await 处理("agent.run", { prompt: "x", 进度ID: "my-progress" })) as { 进度ID: string };
    expect(r.进度ID).toBe("my-progress");
    const ids = 事件
      .filter((e) => e.action === "agent.progress")
      .map((e) => (e.params as { 进度ID: string }).进度ID);
    expect(ids.every((id) => id === "my-progress")).toBe(true);
  });

  it("工具失败时推送「工具失败」但循环仍能结束（错误被吞）", async () => {
    const { 客户端, 处理, 事件 } = 造客户端();
    let 轮次 = 0;
    注册Agent处理器(客户端 as never, {
      聊天: async () => {
        轮次++;
        if (轮次 === 1) {
          return {
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "a.fail", arguments: "{}" } }],
            finish_reason: "tool_calls",
          };
        }
        return { content: "看到错误了", tool_calls: [], finish_reason: "stop" };
      },
      执行工具: async () => {
        throw new Error("炸了");
      },
      获取能力: async () => [{ 名称: "a.fail", 模块: "a" }],
    });

    const r = (await 处理("agent.run", { prompt: "x", 进度ID: "p2" })) as { 最终回答: string };
    expect(r.最终回答).toBe("看到错误了");
    const 失败 = 事件.find(
      (e) => e.action === "agent.progress" && (e.params as { 阶段: string }).阶段 === "工具失败",
    );
    expect(失败).toBeDefined();
    expect((失败!.params as { 错误: string }).错误).toContain("炸了");
  });
});

describe("agent 审批队列集成", () => {
  /** 造一个会调用 write 的聊天剧本 */
  function 造写剧本() {
    let 轮次 = 0;
    return async () => {
      轮次++;
      if (轮次 === 1) {
        return {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function" as const,
              function: { name: "mkg.ai.write", arguments: '{"title":"番茄小结","content":"温度20度"}' },
            },
          ],
          finish_reason: "tool_calls",
        };
      }
      return { content: "写完了", tool_calls: [], finish_reason: "stop" };
    };
  }

  it("可写模式下写操作需审批：批准后执行", async () => {
    const { 客户端, 处理 } = 造客户端();
    const 审批 = new 审批队列();
    const 已执行: string[] = [];

    注册Agent处理器(客户端 as never, {
      聊天: 造写剧本(),
      执行工具: async (name) => {
        已执行.push(name);
        return { id: 1, title: "番茄小结" };
      },
      获取能力: async () => [{ 名称: "mkg.ai.write", 模块: "mkg" }],
      审批,
    });

    // 后台跑 agent.run；主线程负责批准
    const 任务 = 处理("agent.run", { prompt: "写笔记", agentId: "a", 只读: false });
    // 等审批登记出现
    await new Promise((r) => setTimeout(r, 20));
    const 待审 = 审批.列表();
    expect(待审).toHaveLength(1);
    expect(待审[0].工具).toBe("mkg.ai.write");
    expect(待审[0].摘要).toContain("番茄小结");

    审批.批准(待审[0].id);
    const r = (await 任务) as { 最终回答: string };
    expect(r.最终回答).toBe("写完了");
    expect(已执行).toEqual(["mkg.ai.write"]);
  });

  it("拒绝后不执行工具，且模型收到「已拒绝」", async () => {
    const { 客户端, 处理 } = 造客户端();
    const 审批 = new 审批队列();
    const 已执行: string[] = [];
    let 收到的工具结果 = "";

    注册Agent处理器(客户端 as never, {
      聊天: async (messages) => {
        // 第二轮时检查 tool 消息内容
        const tool消息 = messages.filter((m) => m.role === "tool").pop();
        if (tool消息) {
          收到的工具结果 = String(tool消息.content ?? "");
          return { content: "用户拒绝了，我不写了", tool_calls: [], finish_reason: "stop" };
        }
        return {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function" as const,
              function: { name: "mkg.ai.write", arguments: '{"title":"不该写"}' },
            },
          ],
          finish_reason: "tool_calls",
        };
      },
      执行工具: async (name) => {
        已执行.push(name);
        return {};
      },
      获取能力: async () => [{ 名称: "mkg.ai.write", 模块: "mkg" }],
      审批,
    });

    const 任务 = 处理("agent.run", { prompt: "写", agentId: "a", 只读: false });
    await new Promise((r) => setTimeout(r, 20));
    审批.拒绝(审批.列表()[0].id, "内容不对");
    const r = (await 任务) as { 最终回答: string };

    expect(已执行).toEqual([]); // 关键：没有真的执行
    expect(收到的工具结果).toContain("已拒绝");
    expect(r.最终回答).toContain("拒绝");
  });

  it("只读模式下根本不会触发审批（写工具不在工具列表）", async () => {
    const { 客户端, 处理 } = 造客户端();
    const 审批 = new 审批队列();

    注册Agent处理器(客户端 as never, {
      聊天: async () => ({ content: "只读完成", tool_calls: [], finish_reason: "stop" }),
      执行工具: async () => ({}),
      获取能力: async () => [
        { 名称: "mkg.ai.read", 模块: "mkg" },
        { 名称: "mkg.ai.write", 模块: "mkg" },
      ],
      审批,
    });

    await 处理("agent.run", { prompt: "读", agentId: "a", 只读: true });
    expect(审批.列表()).toHaveLength(0);
  });

  it("审批超时 → 工具不执行，循环继续（模型收到超时原因）", async () => {
    const { 客户端, 处理 } = 造客户端();
    const 审批 = new 审批队列();
    const 已执行: string[] = [];

    注册Agent处理器(客户端 as never, {
      聊天: 造写剧本(),
      执行工具: async (name) => {
        已执行.push(name);
        return {};
      },
      获取能力: async () => [{ 名称: "mkg.ai.write", 模块: "mkg" }],
      审批,
    });

    // 不批准，让它超时（用默认 120s 太久，这里直接手动清空模拟超时）
    const 任务 = 处理("agent.run", { prompt: "写", agentId: "a", 只读: false });
    await new Promise((r) => setTimeout(r, 20));
    审批.清空("测试超时");
    const r = (await 任务) as { 最终回答: string };

    expect(已执行).toEqual([]);
    expect(r.最终回答).toBe("写完了");
  });

  it("agent.approve / agent.reject 对未知 id 报错", async () => {
    const { 客户端, 处理 } = 造客户端();
    注册Agent处理器(客户端 as never, {
      聊天: async () => ({ content: "", tool_calls: [], finish_reason: "stop" }),
      执行工具: async () => ({}),
      获取能力: async () => [],
      审批: new 审批队列(),
    });
    await expect(处理("agent.approve", { id: "nope" })).rejects.toThrow(/未找到待审批请求/);
    await expect(处理("agent.reject", { id: "nope" })).rejects.toThrow(/未找到待审批请求/);
  });

  it("未传审批队列时，写操作直接执行（向后兼容）", async () => {
    const { 客户端, 处理 } = 造客户端();
    const 已执行: string[] = [];
    注册Agent处理器(客户端 as never, {
      聊天: 造写剧本(),
      执行工具: async (name) => {
        已执行.push(name);
        return {};
      },
      获取能力: async () => [{ 名称: "mkg.ai.write", 模块: "mkg" }],
    });
    await 处理("agent.run", { prompt: "写", agentId: "a", 只读: false });
    expect(已执行).toEqual(["mkg.ai.write"]);
  });
});

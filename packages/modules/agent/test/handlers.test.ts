import { describe, expect, it } from "vitest";
import { 注册Agent处理器 } from "../src/handlers.js";
import type { 循环消息, OpenAI工具 } from "../src/pure.js";

/** 最小 NiganeClient 桩：只记录 onRequest 注册的 handler */
function 造客户端(): {
  客户端: { handlers: Map<string, (参数: unknown) => Promise<unknown> | unknown>; onRequest: (a: string, h: (参数: unknown) => unknown) => void };
  处理: (action: string, 参数: unknown) => Promise<unknown>;
} {
  const handlers = new Map<string, (参数: unknown) => unknown>();
  return {
    客户端: {
      handlers,
      onRequest: (action, h) => handlers.set(action, h),
    },
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

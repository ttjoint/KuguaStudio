/**
 * ai.chat handler：流式分支与事件转发
 *
 * 为什么需要这层测试：
 * - `client.ts` 的 `流式聊天` 已有单测（SSE 解析），但那只是**一半**。
 * - 真正的链路是：ai.chat handler → 逐块 sendEvent("ai.chunk") → WebUI 转发 → 前端渲染。
 *   中间任何一环错（事件名拼错、流式ID 没透传、完成事件漏发）都会让前端空白，
 *   而 client 层单测完全测不到。
 *
 * 这里用桩客户端 + 桩 fetch，锁死「handler 确实把增量推出去了」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { 注册AI处理器 } from "../src/handlers.js";

const NL = String.fromCharCode(10);

let 目录: string;
let 主配置: string;
let 本地配置: string;

/** 桩客户端：记录 handler 与发出的总线事件 */
function 造客户端() {
  const handlers = new Map<string, (参数: unknown) => Promise<unknown> | unknown>();
  const 事件: Array<{ action: string; params: unknown }> = [];
  return {
    客户端: {
      onRequest: (action: string, h: (参数: unknown) => unknown) => handlers.set(action, h),
      sendEvent: (action: string, params?: unknown) => 事件.push({ action, params }),
      request: async () => ({}),
    },
    处理: async (action: string, 参数: unknown) => {
      const h = handlers.get(action);
      if (!h) throw new Error(`无 handler：${action}`);
      return h(参数);
    },
    事件,
  };
}

/** 造 SSE 响应：若干 data 行 */
function 造SSE(块列表: Array<Record<string, unknown>>): Response {
  const 文本 = 块列表.map((b) => "data: " + JSON.stringify(b) + NL + NL).join("") + "data: [DONE]" + NL + NL;
  return new Response(文本, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

beforeEach(() => {
  目录 = mkdtempSync(join(tmpdir(), "ai-handler-"));
  主配置 = join(目录, "kugua.config.json");
  本地配置 = join(目录, "kugua.config.local.json");
  process.env.KUGUA_CONFIG = 主配置;
  process.env.KUGUA_CONFIG_LOCAL = 本地配置;
  // 配置一个直连提供方（不走 OpenWebUI，才能测流式分支）
  writeFileSync(
    主配置,
    JSON.stringify({
      ai: {
        default: "lmstudio",
        providers: [{ name: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1", chatModel: "test-model" }],
      },
    }),
    "utf-8",
  );
  writeFileSync(本地配置, JSON.stringify({ ai: {} }), "utf-8");
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KUGUA_CONFIG;
  delete process.env.KUGUA_CONFIG_LOCAL;
  try {
    rmSync(目录, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("ai.chat：流式分支", () => {
  it("流式：逐块推送 ai.chunk（增量 + 累计 + 流式ID）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        造SSE([
          { choices: [{ delta: { content: "番茄" } }] },
          { choices: [{ delta: { content: "育苗" } }] },
          { choices: [{ delta: { content: "20度" }, finish_reason: "stop" }] },
        ]),
      ),
    );
    const { 客户端, 处理, 事件 } = 造客户端();
    注册AI处理器(客户端 as never);

    const r = (await 处理("ai.chat", {
      prompt: "说点什么",
      chatId: "t1",
      流式: true,
      流式ID: "sid-1",
    })) as { reply: string };

    expect(r.reply).toBe("番茄育苗20度");

    const 块事件 = 事件.filter((e) => e.action === "ai.chunk").map((e) => e.params as Record<string, unknown>);
    // 3 个增量 + 1 个完成
    expect(块事件.length).toBe(4);
    // 关键：流式ID 必须透传，否则前端无法把增量归到对应气泡
    expect(块事件.every((e) => e.流式ID === "sid-1")).toBe(true);
    // 增量与累计
    expect(块事件[0].增量).toBe("番茄");
    expect(块事件[0].累计).toBe("番茄");
    expect(块事件[1].累计).toBe("番茄育苗");
    // 完成事件
    const 完成 = 块事件.find((e) => e.完成 === true);
    expect(完成).toBeDefined();
    expect(完成!.累计).toBe("番茄育苗20度");
  });

  it("流式：未传 流式ID 时自动生成（前端仍能收到）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => 造SSE([{ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] }])),
    );
    const { 客户端, 处理, 事件 } = 造客户端();
    注册AI处理器(客户端 as never);

    await 处理("ai.chat", { prompt: "hi", 流式: true });

    const 块事件 = 事件.filter((e) => e.action === "ai.chunk").map((e) => e.params as Record<string, unknown>);
    expect(块事件.length).toBeGreaterThan(0);
    expect(typeof 块事件[0].流式ID).toBe("string");
    expect(String(块事件[0].流式ID).length).toBeGreaterThan(0);
  });

  it("流式：reasoning_content 走 思考增量，不混进 reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        造SSE([
          { choices: [{ delta: { reasoning_content: "想想" } }] },
          { choices: [{ delta: { content: "答案" }, finish_reason: "stop" }] },
        ]),
      ),
    );
    const { 客户端, 处理, 事件 } = 造客户端();
    注册AI处理器(客户端 as never);

    const r = (await 处理("ai.chat", { prompt: "hi", 流式: true, 流式ID: "s2" })) as { reply: string };

    expect(r.reply).toBe("答案");
    const 块事件 = 事件.filter((e) => e.action === "ai.chunk").map((e) => e.params as Record<string, unknown>);
    expect(块事件.some((e) => e.思考增量 === "想想")).toBe(true);
    expect(块事件.some((e) => e.思考累计 === "想想")).toBe(true);
  });

  it("带 tools 时**不**走流式（工具调用需完整 JSON）", async () => {
    let 收到体: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        收到体 = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], model: "test-model" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    const { 客户端, 处理, 事件 } = 造客户端();
    注册AI处理器(客户端 as never);

    await 处理("ai.chat", {
      prompt: "hi",
      流式: true,
      流式ID: "s3",
      tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }],
    });

    // 关键：请求体应是 stream:false（走了非流式分支）
    expect(收到体.stream).toBe(false);
    // 且没有推任何 ai.chunk
    expect(事件.filter((e) => e.action === "ai.chunk")).toHaveLength(0);
  });

  it("非流式请求（不传 流式）不推 ai.chunk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "普通回答" }, finish_reason: "stop" }], model: "test-model" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const { 客户端, 处理, 事件 } = 造客户端();
    注册AI处理器(客户端 as never);

    const r = (await 处理("ai.chat", { prompt: "hi" })) as { reply: string };
    expect(r.reply).toBe("普通回答");
    expect(事件.filter((e) => e.action === "ai.chunk")).toHaveLength(0);
  });

  it("流式出错时推 ai.chunk 错误事件", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const { 客户端, 处理, 事件 } = 造客户端();
    注册AI处理器(客户端 as never);

    await expect(处理("ai.chat", { prompt: "hi", 流式: true, 流式ID: "s4" })).rejects.toThrow(/500/);

    const 错误事件 = 事件
      .filter((e) => e.action === "ai.chunk")
      .map((e) => e.params as Record<string, unknown>)
      .find((e) => typeof e.错误 === "string");
    expect(错误事件).toBeDefined();
    expect(错误事件!.流式ID).toBe("s4");
  });
});

describe("ai.chat：记忆与基本行为", () => {
  it("缺 prompt 且无 messages 时报错", async () => {
    const { 客户端, 处理 } = 造客户端();
    注册AI处理器(客户端 as never);
    await expect(处理("ai.chat", {})).rejects.toThrow(/缺少 prompt/);
  });

  it("reset 清空记忆并直接返回", async () => {
    const { 客户端, 处理 } = 造客户端();
    注册AI处理器(客户端 as never);
    const r = (await 处理("ai.chat", { reset: true, chatId: "c1" })) as { reset: boolean; chatId: string };
    expect(r.reset).toBe(true);
    expect(r.chatId).toBe("c1");
  });
});

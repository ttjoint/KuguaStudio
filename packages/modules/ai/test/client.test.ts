import { describe, expect, it, vi, afterEach } from "vitest";
import { 聊天, 列出模型, type AI提供方 } from "../src/client.js";

const 提供方: AI提供方 = {
  name: "test",
  baseUrl: "http://127.0.0.1:9999/v1",
  apiKey: "sk-test",
  models: { chat: "test-chat" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI client：tools 透传", () => {
  it("下发 tools 时把 tools 与 tool_choice 写进请求体", async () => {
    let 收到体: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        收到体 = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], model: "test-chat" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    await 聊天(提供方, {
      messages: [{ role: "user", content: "查天气" }],
      tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: {} } } }],
    });
    expect(收到体.tools).toEqual([
      { type: "function", function: { name: "get_weather", parameters: { type: "object", properties: {} } } },
    ]);
    expect(收到体.tool_choice).toBe("auto");
  });

  it("不传 tools 时请求体不带 tools / tool_choice", async () => {
    let 收到体: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        收到体 = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], model: "test-chat" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    await 聊天(提供方, { messages: [{ role: "user", content: "hi" }] });
    expect(收到体.tools).toBeUndefined();
    expect(收到体.tool_choice).toBeUndefined();
  });

  it("模型返回 tool_calls 时解析为结构化结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"北京"}' } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            model: "test-chat",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const 结果 = await 聊天(提供方, {
      messages: [{ role: "user", content: "北京天气" }],
      tools: [{ type: "function", function: { name: "get_weather" } }],
    });
    expect(结果.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"北京"}' } },
    ]);
    expect(结果.finish_reason).toBe("tool_calls");
  });

  it("纯文本路径仍正常工作（无 tool_calls 时要求非空 content）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "你好" }, finish_reason: "stop" }], model: "test-chat" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const 结果 = await 聊天(提供方, { messages: [{ role: "user", content: "hi" }] });
    expect(结果.reply).toBe("你好");
    expect(结果.tool_calls).toBeUndefined();
  });

  it("空 tool_calls 且 content 为空时报错（不静默返回空）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "", tool_calls: [] }, finish_reason: "stop" }], model: "test-chat" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(聊天(提供方, { messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("缺少文本内容");
  });
});

describe("AI client：tool 角色消息透传", () => {
  it("messages 含 tool 角色时原样进入请求体", async () => {
    let 收到体: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        收到体 = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "结果" }, finish_reason: "stop" }], model: "test-chat" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    await 聊天(提供方, {
      messages: [
        { role: "user", content: "查天气" },
        { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" } }] },
        { role: "tool", content: "{}", tool_call_id: "call_1" },
      ],
    });
    const 消息 = 收到体.messages as Array<{ role: string; tool_call_id?: string }>;
    expect(消息.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(消息[2].tool_call_id).toBe("call_1");
  });
});

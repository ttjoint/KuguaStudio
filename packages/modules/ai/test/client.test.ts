import { describe, expect, it, vi, afterEach } from "vitest";
import { 聊天, 流式聊天, 列出模型, type AI提供方 } from "../src/client.js";

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

describe("AI client：流式聊天（SSE）", () => {
  /** 造一个 SSE 响应体：把若干 data 行拼成流 */
  function 造SSE(块列表: string[]): Response {
    const NL = String.fromCharCode(10);
    const 文本 = 块列表.map((b) => "data: " + b + NL + NL).join("") + "data: [DONE]" + NL + NL;
    return new Response(文本, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  it("逐块回调增量，并返回完整累计结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        造SSE([
          JSON.stringify({ model: "test-chat", choices: [{ delta: { content: "番茄" } }] }),
          JSON.stringify({ model: "test-chat", choices: [{ delta: { content: "育苗" } }] }),
          JSON.stringify({ model: "test-chat", choices: [{ delta: { content: "温度20度" }, finish_reason: "stop" }] }),
        ]),
      ),
    );

    const 增量列表: string[] = [];
    const 结果 = await 流式聊天(
      提供方,
      { messages: [{ role: "user", content: "说点什么" }] },
      { onChunk: (增量) => 增量列表.push(增量) },
    );

    expect(增量列表).toEqual(["番茄", "育苗", "温度20度"]);
    expect(结果.reply).toBe("番茄育苗温度20度");
    expect(结果.model).toBe("test-chat");
    expect(结果.finish_reason).toBe("stop");
  });

  it("请求体带 stream:true", async () => {
    let 收到体: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        收到体 = JSON.parse(String(init?.body));
        return 造SSE([JSON.stringify({ choices: [{ delta: { content: "x" } }] })]);
      }),
    );
    await 流式聊天(提供方, { messages: [{ role: "user", content: "hi" }] }, {});
    expect(收到体.stream).toBe(true);
  });

  it("累计值随每块增长（onChunk 第二参）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        造SSE([
          JSON.stringify({ choices: [{ delta: { content: "A" } }] }),
          JSON.stringify({ choices: [{ delta: { content: "B" } }] }),
        ]),
      ),
    );
    const 累计列表: string[] = [];
    await 流式聊天(提供方, { messages: [{ role: "user", content: "hi" }] }, {
      onChunk: (_增量, 累计) => 累计列表.push(累计),
    });
    expect(累计列表).toEqual(["A", "AB"]);
  });

  it("忽略空 delta 与非 data 行（不崩溃）", async () => {
    const NL = String.fromCharCode(10);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            ": keep-alive" + NL + NL +
              "data: " + JSON.stringify({ choices: [{ delta: {} }] }) + NL + NL +
              "data: " + JSON.stringify({ choices: [{ delta: { content: "OK" } }] }) + NL + NL +
              "data: [DONE]" + NL + NL,
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    const 结果 = await 流式聊天(提供方, { messages: [{ role: "user", content: "hi" }] }, {});
    expect(结果.reply).toBe("OK");
  });

  it("单个坏 JSON 块被跳过，后续块仍生效", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        造SSE([
          "{ 这不是合法JSON",
          JSON.stringify({ choices: [{ delta: { content: "好" } }] }),
        ]),
      ),
    );
    const 结果 = await 流式聊天(提供方, { messages: [{ role: "user", content: "hi" }] }, {});
    expect(结果.reply).toBe("好");
  });

  it("全空响应 → 报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => 造SSE([JSON.stringify({ choices: [{ delta: {} }] })])),
    );
    await expect(流式聊天(提供方, { messages: [{ role: "user", content: "hi" }] }, {})).rejects.toThrow(
      /流式响应为空/,
    );
  });

  it("HTTP 错误 → 抛错且触发 onError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const 错误列表: string[] = [];
    await expect(
      流式聊天(提供方, { messages: [{ role: "user", content: "hi" }] }, {
        onError: (e) => 错误列表.push(e.message),
      }),
    ).rejects.toThrow(/500/);
    expect(错误列表).toHaveLength(1);
  });

  it("带 tools 时请求体仍包含 tools（但调用方应避免流式）", async () => {
    let 收到体: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        收到体 = JSON.parse(String(init?.body));
        return 造SSE([JSON.stringify({ choices: [{ delta: { content: "x" } }] })]);
      }),
    );
    await 流式聊天(
      提供方,
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }],
      },
      {},
    );
    expect(收到体.tools).toBeDefined();
  });
});

describe("AI client：流式聊天支持推理模型的 reasoning_content", () => {
  const NL = String.fromCharCode(10);
  function 造SSE(块列表: string[]): Response {
    const 文本 = 块列表.map((b) => "data: " + b + NL + NL).join("") + "data: [DONE]" + NL + NL;
    return new Response(文本, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  it("reasoning_content 走 onReasoning，不混入 reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        造SSE([
          JSON.stringify({ choices: [{ delta: { reasoning_content: "让我想想" } }] }),
          JSON.stringify({ choices: [{ delta: { reasoning_content: "……" } }] }),
          JSON.stringify({ choices: [{ delta: { content: "答案是番茄" }, finish_reason: "stop" }] }),
        ]),
      ),
    );

    const 思考块: string[] = [];
    const 正文块: string[] = [];
    const 结果 = await 流式聊天(提供方, { messages: [{ role: "user", content: "hi" }] }, {
      onReasoning: (增量) => 思考块.push(增量),
      onChunk: (增量) => 正文块.push(增量),
    });

    expect(思考块).toEqual(["让我想想", "……"]);
    expect(正文块).toEqual(["答案是番茄"]);
    // 关键：思考内容不能污染最终回答
    expect(结果.reply).toBe("答案是番茄");
    expect(结果.reply).not.toContain("让我想想");
  });

  it("思考耗尽 token 预算（finish_reason=length 且无正文）→ 明确报错而非返回空串", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        造SSE([JSON.stringify({ choices: [{ delta: { reasoning_content: "思考中" }, finish_reason: "length" }] })]),
      ),
    );
    const 错误列表: string[] = [];
    await expect(
      流式聊天(提供方, { messages: [{ role: "user", content: "hi" }], maxTokens: 300 }, {
        onError: (e) => 错误列表.push(e.message),
      }),
    ).rejects.toThrow(/都用?在思考上|maxTokens/);
    expect(错误列表).toHaveLength(1);
    expect(错误列表[0]).toContain("maxTokens");
  });

  it("思考有内容且正文也有（正常推理模型）→ 正常返回正文", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        造SSE([
          JSON.stringify({ choices: [{ delta: { reasoning_content: "想一下" } }] }),
          JSON.stringify({ choices: [{ delta: { content: "答案" }, finish_reason: "stop" }] }),
        ]),
      ),
    );
    const 结果 = await 流式聊天(提供方, { messages: [{ role: "user", content: "hi" }] }, {});
    expect(结果.reply).toBe("答案");
  });

  it("思考与正文交替到达时各自累计互不干扰", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        造SSE([
          JSON.stringify({ choices: [{ delta: { reasoning_content: "A" } }] }),
          JSON.stringify({ choices: [{ delta: { content: "1" } }] }),
          JSON.stringify({ choices: [{ delta: { reasoning_content: "B" } }] }),
          JSON.stringify({ choices: [{ delta: { content: "2" } }] }),
        ]),
      ),
    );
    const 思考累计: string[] = [];
    const 正文累计: string[] = [];
    const 结果 = await 流式聊天(提供方, { messages: [{ role: "user", content: "hi" }] }, {
      onReasoning: (_i, c) => 思考累计.push(c),
      onChunk: (_i, c) => 正文累计.push(c),
    });
    expect(思考累计).toEqual(["A", "AB"]);
    expect(正文累计).toEqual(["1", "12"]);
    expect(结果.reply).toBe("12");
  });
});

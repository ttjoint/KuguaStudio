/**
 * OpenAI 兼容客户端（网关）：对话 / 图像生成 / 向量 / 模型列表。
 * 支持按提供方与用途选择模型；未指定模型时自动取该提供方 /models 的第一个。
 */

import type { AI提供方 } from "./providers.js";

export interface 对话消息 {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** assistant 消息带工具调用时填写 */
  tool_calls?: 工具调用[];
  /** tool 消息携带的调用 id（对应上一条 assistant 的 tool_calls[].id） */
  tool_call_id?: string;
}

/** OpenAI 标准工具定义（function calling） */
export interface 工具定义 {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** 模型返回的工具调用（assistant 消息里的 tool_calls） */
export interface 工具调用 {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface 聊天参数 {
  model?: string;
  messages: 对话消息[];
  temperature?: number;
  maxTokens?: number;
  /** 下发给模型的工具定义（OpenAI function calling） */
  tools?: 工具定义[];
  /** auto / required / none / 或指定某工具名 */
  tool_choice?: "auto" | "required" | "none" | string;
}

export interface 聊天结果 {
  reply: string;
  model: string;
  提供方: string;
  usage?: unknown;
  /** 模型请求调用工具（finish_reason=tool_calls 时非空） */
  tool_calls?: 工具调用[];
  /** 原始 finish_reason，供 agent 循环判断是否继续 */
  finish_reason?: string;
}

const 模型缓存 = new Map<string, string>();

function 请求头(提供方: AI提供方): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(提供方.apiKey ? { Authorization: `Bearer ${提供方.apiKey}` } : {}),
  };
}

/** 列出提供方可用模型 */
export async function 列出模型(提供方: AI提供方): Promise<string[]> {
  const r = await fetch(`${提供方.baseUrl}/models`, {
    headers: 请求头(提供方),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`列出模型失败：HTTP ${r.status}`);
  const j = (await r.json()) as { data?: Array<{ id?: string }> };
  return (j.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean);
}

/** 解析用途对应的模型：显式 → 配置 → 自动取第一个 */
async function 解析模型(提供方: AI提供方, 用途: "chat" | "image" | "embed", 显式?: string): Promise<string> {
  if (显式 && 显式.trim()) return 显式.trim();
  const 配置模型 = 提供方.models[用途];
  if (配置模型 && 配置模型.trim()) return 配置模型.trim();
  const 键 = `${提供方.baseUrl}:${用途}`;
  if (模型缓存.has(键)) return 模型缓存.get(键)!;
  try {
    const 全部 = await 列出模型(提供方);
    if (全部.length > 0) {
      模型缓存.set(键, 全部[0]);
      return 全部[0];
    }
  } catch {
    /* 无 /models 时后面报错 */
  }
  throw new Error(`提供方 ${提供方.name} 未配置 ${用途} 模型，且无法自动获取（请在 kugua.config.json 的 ai.providers[].models.${用途} 指定）`);
}

export async function 聊天(提供方: AI提供方, 参数: 聊天参数): Promise<聊天结果> {
  const 模型 = await 解析模型(提供方, "chat", 参数.model);
  const 体: Record<string, unknown> = {
    model: 模型,
    messages: 参数.messages,
    temperature: 参数.temperature,
    max_tokens: 参数.maxTokens,
    stream: false,
  };
  if (参数.tools && 参数.tools.length > 0) {
    体.tools = 参数.tools;
    体.tool_choice = 参数.tool_choice ?? "auto";
  }
  const r = await fetch(`${提供方.baseUrl}/chat/completions`, {
    method: "POST",
    headers: 请求头(提供方),
    body: JSON.stringify(体),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`AI 对话返回 ${r.status}：${(await r.text()).slice(0, 300)}`);
  const 数据 = (await r.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown;
        tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
      };
      finish_reason?: string;
    }>;
    model?: string;
    usage?: unknown;
  };
  const 选中 = 数据.choices?.[0];
  const 内容 = 选中?.message?.content;
  const 工具调用 = (选中?.message?.tool_calls ?? [])
    .map((t) => ({
      id: String(t.id ?? ""),
      type: "function" as const,
      function: { name: String(t.function?.name ?? ""), arguments: String(t.function?.arguments ?? "") },
    }))
    .filter((t) => t.function.name);
  if (工具调用.length > 0) {
    return {
      reply: typeof 内容 === "string" ? 内容 : "",
      model: 数据.model ?? 模型,
      提供方: 提供方.name,
      usage: 数据.usage,
      tool_calls: 工具调用,
      finish_reason: 选中?.finish_reason,
    };
  }
  if (typeof 内容 !== "string" || !内容.trim()) throw new Error("AI 响应缺少文本内容");
  return {
    reply: 内容,
    model: 数据.model ?? 模型,
    提供方: 提供方.name,
    usage: 数据.usage,
    finish_reason: 选中?.finish_reason,
  };
}

/**
 * 流式聊天（SSE）：逐块回调增量文本，结束时返回完整结果。
 *
 * 为何需要：本地 9B 模型跑工具循环常需几十秒，非流式下用户只能盯着空白。
 * 流式让前端能边收边渲染，并有进度感知。
 *
 * 注意：带 tools 的请求**不走流式**——工具调用需要完整 JSON 才能解析，
 * 逐块拼接容易出错（且多数 OpenAI 兼容端在 tool_calls 时不返回增量内容）。
 * 调用方（agent 工具循环）应继续用非流式的 `聊天()`。
 */
export async function 流式聊天(
  提供方: AI提供方,
  参数: 聊天参数,
  回调: {
    /** 收到一段正文增量 */
    onChunk?: (增量: string, 累计: string) => void;
    /**
     * 收到一段「思考过程」增量（推理模型专有，如 qwen3 的 reasoning_content）。
     * 思考内容不计入 reply，只用于让前端显示「正在思考…」。
     */
    onReasoning?: (增量: string, 累计思考: string) => void;
    /** 结束（无论成功/失败） */
    onDone?: (结果: 聊天结果) => void;
    /** 出错 */
    onError?: (错误: Error) => void;
  },
  /** 外部取消信号（用户点「停止」时用） */
  取消信号?: AbortSignal,
): Promise<聊天结果> {
  const 模型 = await 解析模型(提供方, "chat", 参数.model);
  const 体: Record<string, unknown> = {
    model: 模型,
    messages: 参数.messages,
    temperature: 参数.temperature,
    max_tokens: 参数.maxTokens,
    stream: true,
  };
  // 工具调用不走流式（见上方说明）
  if (参数.tools && 参数.tools.length > 0) {
    体.tools = 参数.tools;
    体.tool_choice = 参数.tool_choice ?? "auto";
  }

  // 组合超时与外部取消
  const 超时信号 = AbortSignal.timeout(300000);
  const 信号 = 取消信号 ? AbortSignal.any([超时信号, 取消信号]) : 超时信号;

  let 累计 = "";
  let 思考累计 = "";
  let 实际模型 = 模型;
  let usage: unknown;
  let finish: string | undefined;

  try {
    const r = await fetch(`${提供方.baseUrl}/chat/completions`, {
      method: "POST",
      headers: 请求头(提供方),
      body: JSON.stringify(体),
      signal: 信号,
    });
    if (!r.ok) throw new Error(`AI 对话返回 ${r.status}：${(await r.text()).slice(0, 300)}`);
    if (!r.body) throw new Error("AI 响应无 body（无法流式读取）");

    const 读 = r.body.getReader();
    const 解 = new TextDecoder();
    let 缓冲 = "";

    for (;;) {
      const { done, value } = await 读.read();
      if (done) break;
      缓冲 += 解.decode(value, { stream: true });

      // SSE 按行切分；只处理 data: 行
      const 行列表 = 缓冲.split("\n");
      缓冲 = 行列表.pop() ?? ""; // 最后一段可能不完整，留到下一轮
      for (const 原行 of 行列表) {
        const 行 = 原行.trim();
        if (!行 || !行.startsWith("data:")) continue;
        const 数据文本 = 行.slice(5).trim();
        if (数据文本 === "[DONE]") continue;
        let 块: {
          model?: string;
          choices?: Array<{
            delta?: { content?: unknown; reasoning_content?: unknown };
            finish_reason?: string;
          }>;
          usage?: unknown;
        };
        try {
          块 = JSON.parse(数据文本) as typeof 块;
        } catch {
          continue; // 单个坏块不致命
        }
        if (块.model) 实际模型 = 块.model;
        if (块.usage) usage = 块.usage;
        const 选 = 块.choices?.[0];
        if (选?.finish_reason) finish = 选.finish_reason;
        // 推理模型（qwen3 等）先输出 reasoning_content，正文 content 稍后才来。
        // 两者必须分开处理：思考内容不能混进最终回答。
        const 思考 = 选?.delta?.reasoning_content;
        if (typeof 思考 === "string" && 思考) {
          思考累计 += 思考;
          回调.onReasoning?.(思考, 思考累计);
        }
        const 增量 = 选?.delta?.content;
        if (typeof 增量 === "string" && 增量) {
          累计 += 增量;
          回调.onChunk?.(增量, 累计);
        }
      }
    }

    if (!累计.trim() && !思考累计.trim()) throw new Error("AI 流式响应为空");

    // 推理模型的常见坑：思考过程把 max_tokens 用光，正文一个字都没输出。
    // 这时 finish_reason 是 "length" 且 content 为空——不能静默返回空串，
    // 否则前端显示空白，用户以为功能坏了。
    if (!累计.trim() && finish === "length") {
      const 提示 =
        `模型把 ${参数.maxTokens ?? "全部"} token 都用在思考上，正文未输出（finish_reason=length）。` +
        `请调大 maxTokens（建议 ≥ 2000）或换用非推理模型。`;
      // 标记已通知，避免外层 catch 重复调用 onError
      const 错误 = new Error(提示) as Error & { 已通知?: boolean };
      错误.已通知 = true;
      回调.onError?.(错误);
      throw 错误;
    }

    const 结果: 聊天结果 = { reply: 累计, model: 实际模型, 提供方: 提供方.name, usage, finish_reason: finish };
    回调.onDone?.(结果);
    return 结果;
  } catch (err) {
    const 错误 = err instanceof Error ? err : new Error(String(err));
    // 用户主动取消：返回已收到的部分，不当成错误
    if (错误.name === "AbortError" && 累计) {
      const 结果: 聊天结果 = { reply: 累计, model: 实际模型, 提供方: 提供方.name, usage, finish_reason: "aborted" };
      回调.onDone?.(结果);
      return 结果;
    }
    // 已被内层通知过的错误不再重复通知（避免前端收到两条相同报错）
    if (!(错误 as Error & { 已通知?: boolean }).已通知) 回调.onError?.(错误);
    throw 错误;
  }
}

export interface 图像参数 {
  prompt: string;
  model?: string;
  size?: string;
}

export interface 图像结果 {
  base64: string;
  format: string;
  model: string;
  提供方: string;
}

export async function 生成图像(提供方: AI提供方, 参数: 图像参数): Promise<图像结果> {
  const 模型 = await 解析模型(提供方, "image", 参数.model);
  const r = await fetch(`${提供方.baseUrl}/images/generations`, {
    method: "POST",
    headers: 请求头(提供方),
    body: JSON.stringify({
      model: 模型,
      prompt: 参数.prompt,
      size: 参数.size ?? "1024x1024",
      n: 1,
      response_format: "b64_json",
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error(`AI 图像接口返回 ${r.status}：${(await r.text()).slice(0, 300)}`);
  const 数据 = (await r.json()) as {
    data?: Array<{ b64_json?: string; url?: string; mime_type?: string }>;
    model?: string;
  };
  const 项 = 数据.data?.[0];
  if (!项) throw new Error("AI 图像响应为空");
  const 名 = 数据.model ?? 模型;
  if (typeof 项.b64_json === "string" && 项.b64_json) {
    const 类型 = String(项.mime_type ?? "image/png");
    return { base64: 项.b64_json, format: 类型.replace("image/", "").split(";")[0] || "png", model: 名, 提供方: 提供方.name };
  }
  if (typeof 项.url === "string" && 项.url) {
    const 图 = await fetch(项.url, { signal: AbortSignal.timeout(60000) });
    if (!图.ok) throw new Error(`下载图像失败 ${图.status}`);
    const 类型 = String(图.headers.get("content-type") ?? "image/png");
    return {
      base64: Buffer.from(await 图.arrayBuffer()).toString("base64"),
      format: 类型.replace("image/", "").split(";")[0] || "png",
      model: 名,
      提供方: 提供方.name,
    };
  }
  throw new Error("AI 图像响应缺少数据");
}

export interface 向量结果 {
  vectors: number[][];
  model: string;
  提供方: string;
}

/** 文本向量（OpenAI /v1/embeddings 兼容） */
export async function 向量(提供方: AI提供方, 输入: string | string[], model?: string): Promise<向量结果> {
  const 模型 = await 解析模型(提供方, "embed", model);
  const r = await fetch(`${提供方.baseUrl}/embeddings`, {
    method: "POST",
    headers: 请求头(提供方),
    body: JSON.stringify({ model: 模型, input: 输入 }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`AI 向量接口返回 ${r.status}：${(await r.text()).slice(0, 300)}`);
  const 数据 = (await r.json()) as { data?: Array<{ embedding?: number[] }>; model?: string };
  return {
    vectors: (数据.data ?? []).map((d) => d.embedding ?? []),
    model: 数据.model ?? 模型,
    提供方: 提供方.name,
  };
}

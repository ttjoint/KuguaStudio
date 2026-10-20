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

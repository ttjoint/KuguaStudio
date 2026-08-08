/**
 * OpenAI 兼容 API 客户端（fetch 实现，零额外依赖）。
 * 端点可指向任意 OpenAI 兼容服务（OpenAI / Ollama / 中转平台等）。
 */

export interface AI配置 {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  imageModel: string;
}

/** 读取环境变量得到默认配置（请求参数可覆盖模型） */
export function 默认配置(): AI配置 {
  return {
    baseUrl: (process.env.KUGUA_AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    apiKey: process.env.KUGUA_AI_API_KEY ?? "",
    chatModel: process.env.KUGUA_AI_CHAT_MODEL ?? "gpt-4o-mini",
    imageModel: process.env.KUGUA_AI_IMAGE_MODEL ?? "dall-e-3",
  };
}

export interface 对话消息 {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface 聊天参数 {
  model?: string;
  messages: 对话消息[];
  temperature?: number;
  maxTokens?: number;
}

export interface 聊天结果 {
  reply: string;
  model: string;
  usage?: unknown;
}

/** 发起 chat completions 请求 */
export async function 聊天(配置: AI配置, 参数: 聊天参数): Promise<聊天结果> {
  const 响应 = await fetch(`${配置.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(配置.apiKey ? { Authorization: `Bearer ${配置.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: 参数.model ?? 配置.chatModel,
      messages: 参数.messages,
      temperature: 参数.temperature,
      max_tokens: 参数.maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!响应.ok) {
    throw new Error(`AI 接口返回 ${响应.status}：${(await 响应.text()).slice(0, 300)}`);
  }
  const 数据 = (await 响应.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    model?: string;
    usage?: unknown;
  };
  const 内容 = 数据.choices?.[0]?.message?.content;
  if (typeof 内容 !== "string" || !内容.trim()) {
    throw new Error("AI 响应缺少文本内容");
  }
  return { reply: 内容, model: 数据.model ?? 参数.model ?? 配置.chatModel, usage: 数据.usage };
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
}

/** 发起图像生成请求（优先 b64_json，其次下载 url） */
export async function 生成图像(配置: AI配置, 参数: 图像参数): Promise<图像结果> {
  const 响应 = await fetch(`${配置.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(配置.apiKey ? { Authorization: `Bearer ${配置.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: 参数.model ?? 配置.imageModel,
      prompt: 参数.prompt,
      size: 参数.size ?? "1024x1024",
      n: 1,
      response_format: "b64_json",
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!响应.ok) {
    throw new Error(`AI 图像接口返回 ${响应.status}：${(await 响应.text()).slice(0, 300)}`);
  }
  const 数据 = (await 响应.json()) as {
    data?: Array<{ b64_json?: string; url?: string; mime_type?: string }>;
    model?: string;
  };
  const 项 = 数据.data?.[0];
  if (!项) throw new Error("AI 图像响应为空");
  const 模型 = 数据.model ?? 参数.model ?? 配置.imageModel;
  if (typeof 项.b64_json === "string" && 项.b64_json) {
    const 类型 = String(项.mime_type ?? "image/png");
    return { base64: 项.b64_json, format: 类型.replace("image/", "").split(";")[0] || "png", model: 模型 };
  }
  if (typeof 项.url === "string" && 项.url) {
    const 图 = await fetch(项.url, { signal: AbortSignal.timeout(60000) });
    if (!图.ok) throw new Error(`下载图像失败 ${图.status}`);
    const buf = Buffer.from(await 图.arrayBuffer());
    const 类型 = String(图.headers.get("content-type") ?? "image/png");
    return { base64: buf.toString("base64"), format: 类型.replace("image/", "").split(";")[0] || "png", model: 模型 };
  }
  throw new Error("AI 图像响应缺少 b64_json 或 url");
}

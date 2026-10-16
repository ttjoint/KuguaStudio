/**
 * AI 网关处理器：对话 / 图像 / 向量 / 模型列表 / 提供方 / 记忆。
 * 模型与端点集中在 kugua.config.json 的 `ai.providers`，请求可用 provider/model 覆盖。
 */

import type { NiganeClient } from "@kugua/nigane";
import type { 能力声明 } from "@kugua/capability";
import { 加载AI配置, 取提供方 } from "./providers.js";
import { 聊天, 生成图像, 向量, 列出模型, type 对话消息 } from "./client.js";
import { 默认系统提示, 加载记忆, 保存记忆, 清空记忆 } from "./memory.js";

export const 能力清单: 能力声明[] = [
  { 名称: "ai.chat", 模块: "ai", 标题: "AI 对话", 说明: "OpenAI 兼容对话（可指定提供方/模型，按 chatId 记忆）", 参数: { type: "object", properties: { prompt: { type: "string" }, messages: { type: "array" }, chatId: { type: "string" }, system: { type: "string" }, provider: { type: "string" }, model: { type: "string" }, temperature: { type: "number" }, maxTokens: { type: "number" }, reset: { type: "boolean" } } }, 暴露: { 指令: false, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.image", 模块: "ai", 标题: "AI 图像生成", 说明: "OpenAI 兼容图像生成", 参数: { type: "object", properties: { prompt: { type: "string" }, provider: { type: "string" }, model: { type: "string" }, size: { type: "string" } }, required: ["prompt"] }, 暴露: { 指令: false, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.embed", 模块: "ai", 标题: "文本向量", 说明: "OpenAI 兼容 /embeddings", 参数: { type: "object", properties: { input: {}, provider: { type: "string" }, model: { type: "string" } }, required: ["input"] }, 暴露: { 指令: false, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.models", 模块: "ai", 标题: "模型列表", 说明: "列出提供方可用模型", 参数: { type: "object", properties: { provider: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.providers", 模块: "ai", 标题: "AI 提供方", 说明: "列出已配置的提供方", 参数: { type: "object", properties: {} }, 中文指令: ["AI提供方"], 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.memory.clear", 模块: "ai", 标题: "清空 AI 记忆", 说明: "清空指定会话记忆", 参数: { type: "object", properties: { chatId: { type: "string" }, system: { type: "string" } } }, 中文指令: ["清空AI", "清空AI记忆"], 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.status", 模块: "ai", 标题: "AI 状态", 说明: "提供方连通性与默认配置", 参数: { type: "object", properties: {} }, 暴露: { 指令: false, GUI: true, 定时: false, MCP: true } },
];

export function 注册AI处理器(客户端: NiganeClient): 能力声明[] {
  const 取方 = (名称?: string) => 取提供方(加载AI配置(), 名称);

  客户端.onRequest("ai.chat", async (参数) => {
    const p = (参数 ?? {}) as {
      prompt?: string;
      messages?: 对话消息[];
      chatId?: string;
      system?: string;
      provider?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      reset?: boolean;
    };
    const 提供方 = 取方(p.provider);
    const 系统提示 = typeof p.system === "string" && p.system.trim() ? p.system : 默认系统提示;
    const chatId = typeof p.chatId === "string" && p.chatId.trim() ? p.chatId.trim() : "default";
    if (p.reset) {
      清空记忆(chatId, 系统提示);
      return { reset: true, chatId };
    }
    let 消息: 对话消息[];
    if (Array.isArray(p.messages) && p.messages.length > 0) {
      消息 = [...p.messages];
    } else {
      消息 = 加载记忆(chatId, 系统提示);
      const 提问 = typeof p.prompt === "string" ? p.prompt.trim() : "";
      if (!提问) throw new Error("缺少 prompt");
      消息.push({ role: "user", content: 提问 });
    }
    const 结果 = await 聊天(提供方, { model: p.model, messages: 消息, temperature: p.temperature, maxTokens: p.maxTokens });
    消息.push({ role: "assistant", content: 结果.reply });
    保存记忆(chatId, 消息.length > 21 ? [消息[0], ...消息.slice(-20)] : 消息);
    return { ...结果, chatId };
  });

  客户端.onRequest("ai.image", (参数) => {
    const p = (参数 ?? {}) as { prompt?: string; provider?: string; model?: string; size?: string };
    if (typeof p.prompt !== "string" || !p.prompt.trim()) throw new Error("缺少 prompt");
    return 生成图像(取方(p.provider), { prompt: p.prompt.trim(), model: p.model, size: p.size });
  });

  客户端.onRequest("ai.embed", (参数) => {
    const p = (参数 ?? {}) as { input?: unknown; provider?: string; model?: string };
    if (p.input === undefined || p.input === null) throw new Error("缺少 input");
    return 向量(取方(p.provider), p.input as string | string[], p.model);
  });

  客户端.onRequest("ai.models", async (参数) => {
    const p = (参数 ?? {}) as { provider?: string };
    const 提供方 = 取方(p.provider);
    return { provider: 提供方.name, models: await 列出模型(提供方) };
  });

  客户端.onRequest("ai.providers", () => {
    const 配置 = 加载AI配置();
    return {
      default: 配置.default,
      providers: 配置.providers.map((p) => ({ name: p.name, baseUrl: p.baseUrl, hasKey: Boolean(p.apiKey), models: p.models })),
    };
  });

  客户端.onRequest("ai.memory.clear", (参数) => {
    const p = (参数 ?? {}) as { chatId?: string; system?: string };
    const chatId = typeof p.chatId === "string" && p.chatId.trim() ? p.chatId.trim() : "default";
    清空记忆(chatId, typeof p.system === "string" && p.system.trim() ? p.system : 默认系统提示);
    return { cleared: true, chatId };
  });

  客户端.onRequest("ai.status", async () => {
    const 配置 = 加载AI配置();
    const 结果 = [];
    for (const p of 配置.providers) {
      try {
        const 模型 = await 列出模型(p);
        结果.push({ name: p.name, baseUrl: p.baseUrl, ok: true, models: 模型 });
      } catch (err) {
        结果.push({ name: p.name, baseUrl: p.baseUrl, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { default: 配置.default, providers: 结果 };
  });

  return 能力清单;
}

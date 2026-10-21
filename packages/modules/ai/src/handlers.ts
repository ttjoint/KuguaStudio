/**
 * AI 网关处理器：对话 / 图像 / 向量 / 模型列表 / 提供方 / 记忆。
 * 模型与端点集中在 kugua.config.json 的 `ai.providers`，请求可用 provider/model 覆盖。
 */

import type { NiganeClient } from "@kugua/nigane";
import type { 能力声明 } from "@kugua/capability";
import { 加载AI配置, 取提供方 } from "./providers.js";
import { 聊天, 生成图像, 向量, 列出模型, type 对话消息 } from "./client.js";
import { 默认系统提示, 加载记忆, 保存记忆, 清空记忆 } from "./memory.js";
import { OWU聊天, OWU探活, 列出OWU模型, 清空OWU缓存, type OWU模型 } from "./openwebui.js";

export const 能力清单: 能力声明[] = [
  { 名称: "ai.chat", 模块: "ai", 标题: "AI 对话", 说明: "OpenAI 兼容对话（可指定提供方/模型，按 chatId 记忆）", 参数: { type: "object", properties: { prompt: { type: "string" }, messages: { type: "array" }, chatId: { type: "string" }, system: { type: "string" }, provider: { type: "string" }, model: { type: "string" }, temperature: { type: "number" }, maxTokens: { type: "number" }, reset: { type: "boolean" } } }, 暴露: { 指令: false, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.image", 模块: "ai", 标题: "AI 图像生成", 说明: "OpenAI 兼容图像生成", 参数: { type: "object", properties: { prompt: { type: "string" }, provider: { type: "string" }, model: { type: "string" }, size: { type: "string" } }, required: ["prompt"] }, 暴露: { 指令: false, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.embed", 模块: "ai", 标题: "文本向量", 说明: "OpenAI 兼容 /embeddings", 参数: { type: "object", properties: { input: {}, provider: { type: "string" }, model: { type: "string" } }, required: ["input"] }, 暴露: { 指令: false, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.models", 模块: "ai", 标题: "模型列表", 说明: "列出提供方可用模型", 参数: { type: "object", properties: { provider: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.providers", 模块: "ai", 标题: "AI 提供方", 说明: "列出已配置的提供方", 参数: { type: "object", properties: {} }, 中文指令: ["AI提供方"], 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.memory.clear", 模块: "ai", 标题: "清空 AI 记忆", 说明: "清空指定会话记忆", 参数: { type: "object", properties: { chatId: { type: "string" }, system: { type: "string" } } }, 中文指令: ["清空AI", "清空AI记忆"], 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.status", 模块: "ai", 标题: "AI 状态", 说明: "提供方连通性与默认配置", 参数: { type: "object", properties: {} }, 暴露: { 指令: false, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.openwebui.models", 模块: "ai", 标题: "OpenWebUI 模型列表", 说明: "列出 OpenWebUI 中已接入的全部模型（含连接前缀）", 参数: { type: "object", properties: { prefix: { type: "string" }, refresh: { type: "boolean" } } }, 中文指令: ["OpenWebUI模型", "列出模型"], 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "ai.openwebui.status", 模块: "ai", 标题: "OpenWebUI 状态", 说明: "OpenWebUI 连通性、模型数与默认模型", 参数: { type: "object", properties: {} }, 中文指令: ["OpenWebUI状态"], 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
];

export function 注册AI处理器(客户端: NiganeClient): 能力声明[] {
  const 取方 = (名称?: string) => 取提供方(加载AI配置(), 名称);

  /**
   * 选择对话通路：
   * - provider === "openwebui" → 强制走 OpenWebUI
   * - model 形如 `前缀.模型名` 且启用了 OpenWebUI → 自动走 OpenWebUI
   * - 其余 → 走配置里的普通 OpenAI 兼容提供方
   */
  const 选通道 = (provider?: string, model?: string): "openwebui" | "provider" => {
    if (provider && provider.trim() === "openwebui") return "openwebui";
    const 配置 = 加载AI配置();
    if (配置.openwebui && model && /^[^.]+\.[^.]/.test(model.trim())) return "openwebui";
    if (配置.openwebui && 配置.providers.length === 0) return "openwebui";
    return "provider";
  };

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
      tools?: Array<{
        type: "function";
        function: { name: string; description?: string; parameters?: Record<string, unknown> };
      }>;
      tool_choice?: "auto" | "required" | "none" | string;
    };
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

    let 结果: {
      reply: string;
      model: string;
      提供方: string;
      usage?: unknown;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
      finish_reason?: string;
    };
    if (选通道(p.provider, p.model) === "openwebui") {
      const 配置 = 加载AI配置();
      if (!配置.openwebui) throw new Error("未配置 OpenWebUI（ai.openwebui）");
      结果 = await OWU聊天(配置.openwebui, {
        model: p.model,
        messages: 消息,
        temperature: p.temperature,
        maxTokens: p.maxTokens,
        tools: p.tools,
        tool_choice: p.tool_choice,
      });
    } else {
      结果 = await 聊天(取方(p.provider), {
        model: p.model,
        messages: 消息,
        temperature: p.temperature,
        maxTokens: p.maxTokens,
        tools: p.tools,
        tool_choice: p.tool_choice,
      });
    }
    消息.push({ role: "assistant", content: 结果.reply, tool_calls: 结果.tool_calls });
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

  // —— OpenWebUI：模型目录与探活 ——
  客户端.onRequest("ai.openwebui.models", async (参数) => {
    const p = (参数 ?? {}) as { prefix?: string; refresh?: boolean };
    const 配置 = 加载AI配置();
    if (!配置.openwebui) throw new Error("未配置 OpenWebUI（kugua.config.json 的 ai.openwebui）");
    if (p.refresh) 清空OWU缓存();
    let models = await 列出OWU模型(配置.openwebui, Boolean(p.refresh));
    if (typeof p.prefix === "string" && p.prefix.trim()) {
      const 键 = p.prefix.trim();
      models = models.filter((m) => m.prefix === 键);
    }
    // 按连接分组，便于 UI 渲染
    const 分组: Record<string, OWU模型[]> = {};
    for (const m of models) (分组[m.prefix || "（未分组）"] ??= []).push(m);
    return {
      total: models.length,
      default: 配置.openwebui.defaultModel ?? null,
      分组: Object.entries(分组)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([prefix, items]) => ({ prefix, count: items.length, models: items.map((m) => m.id) })),
    };
  });

  客户端.onRequest("ai.openwebui.status", async () => {
    const 配置 = 加载AI配置();
    if (!配置.openwebui) return { enabled: false };
    const 探活 = await OWU探活(配置.openwebui);
    return {
      enabled: true,
      ...探活,
      defaultModel: 配置.openwebui.defaultModel ?? null,
      hasCredentials: Boolean(配置.openwebui.token || (配置.openwebui.email && 配置.openwebui.password)),
    };
  });

  客户端.onRequest("ai.providers", () => {
    const 配置 = 加载AI配置();
    return {
      default: 配置.default,
      providers: 配置.providers.map((p) => ({ name: p.name, baseUrl: p.baseUrl, hasKey: Boolean(p.apiKey), models: p.models })),
      openwebui: 配置.openwebui
        ? {
            baseUrl: 配置.openwebui.baseUrl,
            defaultModel: 配置.openwebui.defaultModel ?? null,
            hasCredentials: Boolean(
              配置.openwebui.token || (配置.openwebui.email && 配置.openwebui.password),
            ),
          }
        : null,
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
    const openwebui = 配置.openwebui
      ? { enabled: true, ...(await OWU探活(配置.openwebui)), defaultModel: 配置.openwebui.defaultModel ?? null }
      : { enabled: false };
    return { default: 配置.default, providers: 结果, openwebui };
  });

  return 能力清单;
}

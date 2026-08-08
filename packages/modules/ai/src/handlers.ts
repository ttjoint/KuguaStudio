/**
 * AI 模块的苦音处理器：对话 / 图像生成 / 记忆管理 / 状态。
 */

import type { NiganeClient } from "@kugua/nigane";
import { 聊天, 生成图像, 默认配置, type 对话消息 } from "./client.js";
import { 默认系统提示, 加载记忆, 保存记忆, 清空记忆 } from "./memory.js";

export function 注册AI处理器(客户端: NiganeClient): void {
  客户端.onRequest("ai.chat", async (参数) => {
    const p = (参数 ?? {}) as {
      prompt?: string;
      messages?: 对话消息[];
      chatId?: string;
      system?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      reset?: boolean;
    };
    const 配置 = 默认配置();
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

    const 结果 = await 聊天(配置, {
      model: p.model,
      messages: 消息,
      temperature: p.temperature,
      maxTokens: p.maxTokens,
    });
    消息.push({ role: "assistant", content: 结果.reply });
    // 裁剪：保留系统提示 + 最近 20 条消息
    保存记忆(chatId, 消息.length > 21 ? [消息[0], ...消息.slice(-20)] : 消息);
    return { ...结果, chatId };
  });

  客户端.onRequest("ai.image", (参数) => {
    const p = (参数 ?? {}) as { prompt?: string; model?: string; size?: string };
    if (typeof p.prompt !== "string" || !p.prompt.trim()) throw new Error("缺少 prompt");
    return 生成图像(默认配置(), { prompt: p.prompt.trim(), model: p.model, size: p.size });
  });

  客户端.onRequest("ai.memory.clear", (参数) => {
    const p = (参数 ?? {}) as { chatId?: string; system?: string };
    const chatId = typeof p.chatId === "string" && p.chatId.trim() ? p.chatId.trim() : "default";
    清空记忆(chatId, typeof p.system === "string" && p.system.trim() ? p.system : 默认系统提示);
    return { cleared: true, chatId };
  });

  客户端.onRequest("ai.status", () => {
    const 配置 = 默认配置();
    return {
      module: "ai",
      baseUrl: 配置.baseUrl,
      chatModel: 配置.chatModel,
      imageModel: 配置.imageModel,
      hasKey: Boolean(配置.apiKey),
    };
  });
}

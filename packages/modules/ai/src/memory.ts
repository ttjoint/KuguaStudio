/**
 * AI 对话记忆：按 chatId 持久化到 data/ai/memory/<chatId>.json。
 * 可通过 KUGUA_AI_MEMORY_DIR 覆盖目录（便于测试）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { 对话消息 } from "./client.js";

export const 默认系统提示 = "你是苦瓜工作室（KuguaStudio）的本地 AI 助手。回答简洁、准确、友好，尽量依据事实。";

export function 记忆路径(chatId: string): string {
  const 根 = process.env.KUGUA_AI_MEMORY_DIR ?? resolve(process.cwd(), "data/ai/memory");
  const 安全名 = chatId.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "_");
  return resolve(根, `${安全名}.json`);
}

/** 加载记忆；无记忆时返回仅含系统提示的消息列表 */
export function 加载记忆(chatId: string, 系统提示: string): 对话消息[] {
  const 路径 = 记忆路径(chatId);
  if (existsSync(路径)) {
    try {
      const 数据 = JSON.parse(readFileSync(路径, "utf-8")) as 对话消息[];
      if (Array.isArray(数据) && 数据.length > 0) return 数据;
    } catch {
      // 记忆损坏时忽略，重建
    }
  }
  return [{ role: "system", content: 系统提示 }];
}

export function 保存记忆(chatId: string, 消息: 对话消息[]): void {
  try {
    const 路径 = 记忆路径(chatId);
    mkdirSync(dirname(路径), { recursive: true });
    const 临时 = `${路径}.tmp`;
    writeFileSync(临时, JSON.stringify(消息, null, 2), "utf-8");
    renameSync(临时, 路径);
  } catch (err) {
    console.warn(`[AI] 保存记忆失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

export function 清空记忆(chatId: string, 系统提示: string): void {
  保存记忆(chatId, [{ role: "system", content: 系统提示 }]);
}

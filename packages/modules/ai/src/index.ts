/**
 * AI 接入模块（M6）
 * OpenAI 兼容 API：ai.chat 对话（含按 chatId 的记忆）、ai.image 图像生成。
 * 配置环境变量：KUGUA_AI_BASE_URL / KUGUA_AI_API_KEY / KUGUA_AI_CHAT_MODEL / KUGUA_AI_IMAGE_MODEL。
 * 用法：node dist/index.js [主控地址] [token]
 */

import { NiganeClient } from "@kugua/nigane";
import { 默认配置 } from "./client.js";
import { 注册AI处理器 } from "./handlers.js";

const 地址 = process.env.NIGANE_URL ?? process.argv[2] ?? "ws://127.0.0.1:24601";
const 令牌 = process.env.NIGANE_TOKEN ?? process.argv[3] ?? "";

const 客户端 = new NiganeClient({
  name: "ai",
  url: 地址,
  token: 令牌,
  version: "0.6.0",
  capabilities: ["ai.chat", "ai.image", "ai.memory.clear", "ai.status"],
});

注册AI处理器(客户端);

客户端.on("shutdown", () => {
  console.log("[AI] 主控退出，结束本进程");
  客户端.close();
  process.exit(0);
});

客户端.on("close", () => {
  console.log("[AI] 与主控的连接已断开");
  process.exit(0);
});

客户端
  .connect()
  .then(() => {
    const 配置 = 默认配置();
    console.log(`[AI] 已接入主控：${地址}（${配置.baseUrl}，对话模型 ${配置.chatModel}）`);
  })
  .catch((err: unknown) => {
    console.error("[AI] 接入失败：", err);
    process.exit(1);
  });

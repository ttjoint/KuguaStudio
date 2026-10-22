/**
 * AI 网关模块
 *
 * 统一接入本地/远端 OpenAI 兼容模型（仿 Open WebUI 的「模型网关」思路）：
 * 端点与模型集中在 `kugua.config.json` 的 `ai.providers`，请求可用 provider/model 覆盖。
 * 缺省：LM Studio（http://127.0.0.1:1234/v1）与 Ollama（http://127.0.0.1:11434/v1）。
 *
 * 能力见 handlers.ts（chat/image/embed/models/providers/memory.clear/status）。
 * 启动样板（读配置 / 连主控 / 处理退出）已收敛到 @kugua/module-kit。
 */

import { 启动模块 } from "@kugua/module-kit";
import { 能力清单, 注册AI处理器 } from "./handlers.js";
import { AI配置声明 } from "./declaration.js";
import { 加载AI配置 } from "./providers.js";

void 启动模块({
  name: "ai",
  version: "0.8.0",
  // AI 对话是长任务：本地 9B 模型单轮可达 40s+，默认 30s handler 超时会先放弃，
  // 表现为调用方收到「处理超时（30000ms）：ai.chat」而模型其实还在生成。
  请求超时毫秒: 600000,
  能力: 能力清单,
  // 声明一次，平台自动生成配置页（提供方表格 + OpenWebUI 各项）
  配置声明: AI配置声明,
  // 本模块每次调用都重新读配置，无需清缓存；这里只记一笔方便排查
  配置变更: (载荷) => {
    const 摘要 = 载荷.变更.length ? 载荷.变更.join(", ") : "无字段变化";
    console.log(`[AI网关] 配置已更新（来源：${载荷.来源}，变更：${摘要}）`);
  },
  注册: (客户端) => {
    注册AI处理器(客户端);
  },
  就绪: (_客户端, _配置, 连接) => {
    const 配置 = 加载AI配置();
    console.log(
      `[AI网关] 已接入主控：${连接.url}（默认提供方 ${配置.default}，共 ${配置.providers.length} 个）`,
    );
  },
});

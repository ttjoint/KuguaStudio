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
import { 加载AI配置 } from "./providers.js";

void 启动模块({
  name: "ai",
  version: "0.7.0",
  能力: 能力清单,
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

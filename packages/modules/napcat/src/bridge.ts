/**
 * Napcat 桥接逻辑（可编程启动，便于集成测试）
 *
 * 上行：Napcat 事件 → 苦音总线事件（action 形如 "napcat.message.group"）
 * 下行：苦音请求 → Napcat API
 *  - "api"：{ action, params } 透传任意 OneBot API
 *  - "send_msg" / "send_group_msg" / "send_private_msg"：常用发送捷径
 */

import { NiganeClient } from "@kugua/nigane";
import { Ob11Client } from "@kugua/onebot11";
import { 事件名, 应转发, 解析Api请求 } from "./pure.js";

export interface Napcat桥配置 {
  /** 苦音主控地址 */
  苦音地址: string;
  苦音令牌?: string;
  /** Napcat 正向 WS 地址 */
  napcat地址: string;
  napcat令牌?: string;
  /** 是否转发心跳事件到总线（默认否，避免噪声） */
  转发心跳?: boolean;
}

export interface Napcat桥 {
  苦音: NiganeClient;
  ob11: Ob11Client;
  关闭: () => void;
}

export async function 启动Napcat桥(配置: Napcat桥配置): Promise<Napcat桥> {
  const 苦音 = new NiganeClient({
    name: "napcat",
    url: 配置.苦音地址,
    token: 配置.苦音令牌 ?? "",
    version: "0.2.0",
    capabilities: ["napcat.api", "napcat.send", "napcat.event"],
  });
  const ob11 = new Ob11Client({
    url: 配置.napcat地址,
    token: 配置.napcat令牌,
  });

  // 下行：苦音请求 → Napcat API
  苦音.onRequest("api", async (params) => {
    const { action, 参数 } = 解析Api请求(params);
    return ob11.callApi(action, 参数);
  });
  苦音.onRequest("send_msg", (params) => ob11.callApi("send_msg", params));
  苦音.onRequest("send_group_msg", (params) => ob11.callApi("send_group_msg", params));
  苦音.onRequest("send_private_msg", (params) => ob11.callApi("send_private_msg", params));

  // 上行：Napcat 事件 → 苦音广播
  ob11.on("event", (分类: string, 数据: unknown) => {
    if (!应转发(分类, 配置.转发心跳 ?? false)) return;
    苦音.sendEvent(事件名(分类), 数据);
  });
  ob11.on("connect", () => console.log("[napcat桥] Napcat 已连接"));
  ob11.on("close", () => console.warn("[napcat桥] Napcat 连接断开，等待自动重连……"));

  await 苦音.connect();
  await ob11.connect();

  return {
    苦音,
    ob11,
    关闭: () => {
      ob11.close();
      苦音.close();
    },
  };
}

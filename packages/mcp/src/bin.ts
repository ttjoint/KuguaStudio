#!/usr/bin/env node
/**
 * 独立 stdio MCP server 入口。
 *
 * 连接苦音主控，把平台能力（入口=MCP）暴露为标准 MCP（JSON Lines，stdio）。
 * 供只支持 stdio 的 MCP 客户端使用（在客户端里配置命令为：
 *   node <项目>/packages/mcp/dist/bin.js）
 *
 * 用法：node packages/mcp/dist/bin.js [ws://127.0.0.1:24601] [token]
 */

import { NiganeClient } from "@kugua/nigane";
import type { 能力声明 } from "@kugua/capability";
import { 启动标准输入服务器 } from "./server.js";

const 地址 = process.env.NIGANE_URL ?? process.argv[2] ?? "ws://127.0.0.1:24601";
const 令牌 = process.env.NIGANE_TOKEN ?? process.argv[3] ?? "";

const 客户端 = new NiganeClient({
  name: "mcp-stdio",
  url: 地址,
  token: 令牌,
  version: "0.1.0",
  capabilities: ["mcp"],
});

async function 主流程(): Promise<void> {
  await 客户端.connect();
  启动标准输入服务器({
    名称: "kugua-studio",
    版本: "0.1.0",
    能力: async () => (await 客户端.request("nigane", "capability.list", { 入口: "MCP" })) as 能力声明[],
    调用: async (名称, 参数) =>
       (await 客户端.request("nigane", "capability.call", { 名称, 参数 }, 600000)) as unknown,
    列出资源: async () => {
      try {
        const items = (await 客户端.request("mkg", "mkg.node.listAll", { limit: 50 })) as Array<{
          id: number;
          name: string;
          category: string;
        }>;
        return (items ?? []).map((n) => ({ uri: `mkg://node/${n.id}`, name: n.name, description: n.category }));
      } catch {
        return [];
      }
    },
    读取资源: async (uri) => {
      const m = /^mkg:\/\/node\/(\d+)$/.exec(uri);
      if (!m) throw new Error(`未知资源 URI：${uri}`);
      return 客户端.request("mkg", "mkg.node.get", { id: Number(m[1]) });
    },
    日志: (消息) => process.stderr.write(`[mcp] ${消息}\n`),
  });
  process.stderr.write(`[mcp] stdio MCP server 已就绪（主控：${地址}）\n`);
}

主流程().catch((err: unknown) => {
  process.stderr.write(`[mcp] 启动失败：${String(err)}\n`);
  process.exit(1);
});

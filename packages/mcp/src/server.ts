/**
 * MCP Server：把能力注册表暴露为 MCP（JSON-RPC 2.0）。
 *
 * 支持方法：initialize / ping / tools/list / tools/call /
 *           resources/list / resources/read（可选）
 * 传输：默认 stdio（见 启动标准输入服务器）。
 *
 * 详见 docs/互操作设计.md。
 */

import { 能力暴露于, type 能力声明 } from "@kugua/capability";
import { 能力列表转工具, type MCP资源, type MCP工具 } from "./schema.js";

/** 当前 MCP 协议版本（streamable HTTP / stdio 通用的稳定版日期） */
export const MCP协议版本 = "2025-06-18";

export interface MCP服务器选项 {
  名称?: string;
  版本?: string;
  /** 能力来源：返回当前可用的能力声明（可异步，用于按需从主控拉取） */
  能力: () => Promise<能力声明[]> | 能力声明[];
  /** 统一调用实现：给定能力名与参数，返回结果 */
  调用: (名称: string, 参数: unknown) => Promise<unknown>;
  /** 是否允许暴露危险能力（默认 false） */
  允许危险?: boolean;
  /** 列出可读资源（可选，通常由 MKG 提供） */
  列出资源?: () => Promise<MCP资源[]>;
  /** 读取资源内容（可选） */
  读取资源?: (uri: string) => Promise<unknown>;
  日志?: (消息: string) => void;
  协议版本?: string;
}

interface JSONRPC请求 {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPC错误 {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPC响应 {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JSONRPC错误;
}

export class MCP服务器 {
  constructor(private 选项: MCP服务器选项) {}

  /** 当前允许暴露的工具 */
  async 列出工具(): Promise<MCP工具[]> {
    const 全部 = await this.选项.能力();
    const 声明列表 = 全部.filter((声明: 能力声明) =>
      能力暴露于(声明, "MCP", this.选项.允许危险 ?? false),
    );
    return 能力列表转工具(声明列表);
  }

  /** 处理一条 JSON-RPC 请求；通知（无 id）返回 null */
  async 处理(请求: JSONRPC请求): Promise<JSONRPC响应 | null> {
    const id = 请求.id ?? null;
    const 是通知 = 请求.id === undefined;
    try {
      const 结果 = await this.分派(请求);
      if (是通知) return null;
      return { jsonrpc: "2.0", id, result: 结果 };
    } catch (err) {
      if (是通知) return null;
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  private async 分派(请求: JSONRPC请求): Promise<unknown> {
    switch (请求.method) {
      case "initialize":
        return {
          protocolVersion: this.选项.协议版本 ?? MCP协议版本,
          capabilities: {
            tools: { listChanged: true },
            ...(this.选项.列出资源 ? { resources: { listChanged: true } } : {}),
          },
          serverInfo: {
            name: this.选项.名称 ?? "kugua-studio",
            version: this.选项.版本 ?? "0.1.0",
          },
        };
      case "notifications/initialized":
      case "notifications/cancelled":
        return undefined;
      case "ping":
        return {};
      case "tools/list":
        return { tools: await this.列出工具() };
      case "tools/call": {
        const 名称 = String(请求.params?.name ?? "");
        const 参数 = 请求.params?.arguments ?? {};
        const 全部 = await this.选项.能力();
        const 声明 = 全部.find((c) => c.名称 === 名称 && 能力暴露于(c, "MCP", this.选项.允许危险 ?? false));
        if (!声明) throw new Error(`未知工具：${名称}`);
        const 结果 = await this.选项.调用(名称, 参数);
        return {
          content: [{ type: "text", text: 序列化(结果) }],
          isError: false,
        };
      }
      case "resources/list": {
        if (!this.选项.列出资源) return { resources: [] };
        return { resources: await this.选项.列出资源() };
      }
      case "resources/read": {
        if (!this.选项.读取资源) throw new Error("本服务未提供资源");
        const uri = String(请求.params?.uri ?? "");
        const 内容 = await this.选项.读取资源(uri);
        return {
          contents: [{ uri, mimeType: "text/plain", text: 序列化(内容) }],
        };
      }
      default:
        throw new Error(`不支持的方法：${请求.method}`);
    }
  }
}

function 序列化(值: unknown): string {
  if (typeof 值 === "string") return 值;
  try {
    return JSON.stringify(值 ?? null);
  } catch {
    return String(值);
  }
}

/**
 * 以 stdio 运行 MCP server：按行读取 JSON-RPC 请求，按行写出响应。
 * 与"模块即进程"的模型一致，天然隔离，不监听网络。
 */
export function 启动标准输入服务器(选项: MCP服务器选项): MCP服务器 {
  const 服务器 = new MCP服务器(选项);
  const 日志 = 选项.日志 ?? ((消息: string) => process.stderr.write(`[mcp] ${消息}\n`));
  let 缓冲 = "";

  const 处理行 = async (行: string): Promise<void> => {
    let 请求: JSONRPC请求;
    try {
      请求 = JSON.parse(行) as JSONRPC请求;
    } catch {
      日志(`忽略非法 JSON：${行.slice(0, 120)}`);
      return;
    }
    const 响应 = await 服务器.处理(请求);
    if (响应) process.stdout.write(`${JSON.stringify(响应)}\n`);
  };

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (块: string) => {
    缓冲 += 块;
    let 换行位置 = 缓冲.indexOf("\n");
    while (换行位置 >= 0) {
      const 行 = 缓冲.slice(0, 换行位置).trim();
      缓冲 = 缓冲.slice(换行位置 + 1);
      if (行) void 处理行(行);
      换行位置 = 缓冲.indexOf("\n");
    }
  });
  process.stdin.on("end", () => process.exit(0));

  return 服务器;
}

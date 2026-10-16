/**
 * MCP 与能力的 Schema 互转。
 *
 * 依据 docs/互操作设计.md：
 *   能力声明（暴露.MCP=true）  ->  MCP tools
 *   MCP tool                  ->  能力声明（外部项目接入）
 */

import type { 能力声明, JSONSchema } from "@kugua/capability";

/** MCP 工具定义 */
export interface MCP工具 {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** MCP 资源定义 */
export interface MCP资源 {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

/** MCP 工具调用返回的文本内容 */
export interface MCP文本内容 {
  type: "text";
  text: string;
}

/** 能力 -> MCP 工具 */
export function 能力转工具(声明: 能力声明): MCP工具 {
  return {
    name: 声明.名称,
    description: 声明.说明 ?? 声明.标题 ?? 声明.名称,
    inputSchema:
      (声明.参数 as Record<string, unknown> | undefined) ?? {
        type: "object",
        properties: {},
      },
  };
}

/** 能力列表 -> MCP 工具列表 */
export function 能力列表转工具(声明列表: 能力声明[]): MCP工具[] {
  return 声明列表.map(能力转工具);
}

/**
 * MCP 工具 -> 能力声明。
 * 外部 MCP server 的工具默认视为危险（exec + 来自外部），不级联暴露给 MCP。
 */
export function 工具转能力声明(
  工具: MCP工具,
  模块: string,
  选项: { 前缀?: string; 服务器?: string } = {},
): 能力声明 {
  const 前缀 = 选项.前缀 ?? "ext";
  return {
    名称: `${前缀}.${工具.name}`,
    模块,
    动作: "mcp.call",
    标题: 工具.name,
    说明: 工具.description,
    参数: 工具.inputSchema as JSONSchema,
    权限: ["exec"],
    危险: true,
    暴露: { 指令: false, GUI: true, 定时: false, MCP: false },
    扩展: { mcp: { server: 选项.服务器, tool: 工具.name } },
  };
}

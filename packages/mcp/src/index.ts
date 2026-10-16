/**
 * @kugua/mcp —— 苦瓜工作室 MCP 互操作层。
 *
 * - MCP Server：把能力注册表暴露为 MCP tools/resources
 * - MCP Client：连接外部 MCP server，把其工具导入为本地能力
 *
 * 详见 docs/互操作设计.md。
 */

export * from "./schema.js";
export * from "./server.js";
export * from "./client.js";

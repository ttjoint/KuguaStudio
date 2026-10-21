/**
 * agent 模块：智能管理终端（AI 工具循环，按 agent_id 沙箱隔离）
 *
 * 依赖：
 * - ai 模块：提供 ai.chat（带 tools 透传）
 * - 主控（nigane）：capability.list（能力发现）、capability.call（工具执行）
 * - mkg 模块：mkg.ai.*（AI 专属能力族，agent_id 隔离）
 *
 * 模块默认不随主控自动启动（autoStart=false）：
 * 这是「智能管理终端」的可选增强，用户需要时才启用。
 */

import { 启动模块 } from "@kugua/module-kit";
import { 注册Agent处理器 } from "./handlers.js";
import type { 能力声明 } from "@kugua/capability";

const 能力清单: 能力声明[] = [
  {
    名称: "agent.run",
    模块: "agent",
    标题: "AI 智能执行",
    说明: "让 AI 调用平台能力完成任务（读知识库/搜索/写 aigc 笔记，按 agent_id 沙箱）",
    参数: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "任务描述" },
        agentId: { type: "string", description: "会话隔离 id（缺省自动生成）" },
        system: { type: "string", description: "自定义系统提示" },
        maxIterations: { type: "number", description: "工具循环上限，默认 8" },
        只读: { type: "boolean", description: "只读模式（默认 true）：AI 不能写，只能读/搜索" },
      },
      required: ["prompt"],
    },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: false },
  },
  {
    名称: "agent.tools",
    模块: "agent",
    标题: "AI 可用工具",
    说明: "列出 AI 可见的能力（工具）清单（只读模式默认过滤写入）",
    参数: { type: "object", properties: { 只读: { type: "boolean", description: "只读模式（默认 true）" } } },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: false },
  },
];

void 启动模块({
  name: "agent",
  version: "0.1.0",
  能力: 能力清单,
  注册: (客户端) => {
    注册Agent处理器(客户端, {
      // 聊天：走 ai 模块的 ai.chat（带 tools）
      async 聊天(messages, tools) {
        const 回复 = (await 客户端.request("ai", "ai.chat", {
          messages,
          tools,
          tool_choice: "auto",
          chatId: "agent",
        })) as {
          reply?: string;
          tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
          finish_reason?: string;
        };
        return {
          content: 回复.reply ?? null,
          tool_calls: 回复.tool_calls ?? [],
          finish_reason: 回复.finish_reason,
        };
      },
      // 执行工具：走主控 capability.call
      async 执行工具(name, 参数) {
        return 客户端.request("nigane", "capability.call", { 名称: name, 参数 }, 120000);
      },
      // 能力发现：走主控 capability.list（仅 AI 可见）
      async 获取能力() {
        const 全部 = (await 客户端.request("nigane", "capability.list", {})) as Array<{
          名称: string;
          模块: string;
          标题?: string;
          说明?: string;
          参数?: Record<string, unknown>;
          危险?: boolean;
        }>;
        // 只暴露 mkg.ai.* 与 ai.*（危险能力绝不进工具列表）
        return (全部 ?? []).filter(
          (c) => !c.危险 && (c.名称.startsWith("mkg.ai.") || c.名称.startsWith("ai.")),
        );
      },
    });
  },
  就绪: (_客户端, _配置, 连接) => {
    console.log(`[agent] 智能管理终端已就绪（${连接.url}）`);
  },
});

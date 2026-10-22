/**
 * agent 模块处理器：能力发现 + 工具循环入口。
 *
 * 设计：
 * - 能力来源：`capability.list`（主控）里「AI 可见」的能力（本模块暴露 ai.agent.run 给用户）。
 * - 工具执行：`capability.call`（主控），带 agent_id 沙箱（mkg.ai.* 按 agent_id 隔离）。
 * - 工具循环：纯逻辑在 pure.ts（已测）；这里只做 IO 接线。
 */

import type { NiganeClient } from "@kugua/nigane";
import type { 能力声明 } from "@kugua/capability";
import {
  能力列表转OpenAI工具,
  运行工具循环,
  默认代理系统提示,
  需要审批,
  生成审批摘要,
  审批队列,
  type 循环消息,
  type OpenAI工具,
  type 审批请求,
} from "./pure.js";

/** agent 可用能力：只读 + AI 专属（不含危险、不含写盘） */
const AI可调用能力过滤 = (声明: 能力声明摘要, 只读模式 = true): boolean => {
  // 仅暴露 mkg.ai.* 与 ai.* 能力；危险能力绝不进工具列表
  if (声明.危险) return false;
  if (声明.名称.startsWith("ai.")) return true;
  if (!声明.名称.startsWith("mkg.ai.")) return false;
  // 只读模式：过滤掉写入能力（mkg.ai.write）——AI 写内容需用户显式允许
  if (只读模式 && 声明.名称 === "mkg.ai.write") return false;
  return true;
};

/** 统一取「AI 可调用能力」：依赖注入返回什么，这里都再兜底过滤一次（安全边界双保险） */
function 取可调用能力(
  获取能力: () => Promise<能力声明摘要[]>,
  只读模式 = true,
): Promise<能力声明摘要[]> {
  return 获取能力().then((列表) => (列表 ?? []).filter((c) => AI可调用能力过滤(c, 只读模式)));
}

export interface 能力声明摘要 {
  名称: string;
  模块: string;
  标题?: string;
  说明?: string;
  参数?: Record<string, unknown>;
  危险?: boolean;
}

/**
 * 注册 agent 处理器。
 *
 * 依赖注入 `聊天` 与 `执行工具` 便于测试；实际运行时接 AI 网关与主控。
 */
export function 注册Agent处理器(
  客户端: NiganeClient,
  依赖: {
    /**
     * 发起一次带工具的聊天（实际走 ai 模块的 ai.chat）。
     *
     * 模型选择必须逐次透传：`聊天选项` 里的 provider/model 来自本次请求，
     * 不能省——否则 ai 模块回退到配置默认值，用户在界面上选的模型不生效。
     */
    聊天: (
      messages: 循环消息[],
      tools: OpenAI工具[],
      聊天选项?: { provider?: string; model?: string },
    ) => Promise<{ content: string | null; tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>; finish_reason?: string }>;
    /** 执行一个能力（实际走主控 capability.call） */
    执行工具: (name: string, 参数: Record<string, unknown>) => Promise<unknown>;
    /** 获取 AI 可调用能力清单 */
    获取能力: () => Promise<能力声明摘要[]>;
    /** 审批队列（写操作逐次确认）；不传则不审批（兼容旧调用/测试） */
    审批?: 审批队列;
  },
): void {
  /** 审批队列（供 agent.approvals / agent.approve / agent.reject 共用） */
  const 审批 = 依赖.审批 ?? null;
  // agent 运行：入口
  客户端.onRequest("agent.run", async (参数) => {
    const p = (参数 ?? {}) as {
      prompt?: string;
      agentId?: string;
      system?: string;
      maxIterations?: number;
      只读?: boolean;
      /** 进度事件标识（前端据此把进度归到对应气泡） */
      进度ID?: string;
      /** 提供方名（缺省用 ai 配置默认值）。必须透传，否则界面选的模型不生效 */
      provider?: string;
      /** 模型名（缺省用提供方默认模型） */
      model?: string;
    };
    const prompt = typeof p.prompt === "string" ? p.prompt.trim() : "";
    if (!prompt) throw new Error("缺少 prompt");
    const agentId = typeof p.agentId === "string" && p.agentId.trim() ? p.agentId.trim() : `agent-${Date.now()}`;
    const 只读模式 = p.只读 !== false; // 默认只读：写入能力不进工具列表
    const 系统提示 = typeof p.system === "string" && p.system.trim() ? p.system : 默认代理系统提示;
    // 模型选择：透传给 ai.chat。空串视为未指定（用配置默认值）。
    const provider = typeof p.provider === "string" && p.provider.trim() ? p.provider.trim() : undefined;
    const model = typeof p.model === "string" && p.model.trim() ? p.model.trim() : undefined;

    // 进度推送：工具循环可能跑几十秒，用户需要看到「现在到哪一步」
    const 进度ID = typeof p.进度ID === "string" && p.进度ID ? p.进度ID : `p-${Date.now()}`;
    const 推 = (阶段: string, 补充: Record<string, unknown> = {}) => {
      try {
        客户端.sendEvent("agent.progress", { 进度ID, 阶段, agentId, ...补充 });
      } catch {
        // 推送失败不影响主流程（比如前端已断开）
      }
    };

    // 能力 → 工具定义（安全边界双保险：这里再过滤一次危险/非 AI 能力）
    const 能力 = await 取可调用能力(依赖.获取能力, 只读模式);
    const 工具 = 能力列表转OpenAI工具(能力 as 能力声明[]);
    推("准备", { 工具数: 工具.length, 只读模式 });

    // 初始消息
    const messages: 循环消息[] = [
      { role: "system", content: `${系统提示}\n你的 agent_id 是 ${agentId}，写入时用这个 id。` },
      { role: "user", content: prompt },
    ];

    let 轮次 = 0;
    const 结果 = await 运行工具循环(
      {
        聊天: async (msgs, tools) => {
          轮次++;
          推("思考", { 轮次 });
          const 回复 = await 依赖.聊天(msgs, tools, { provider, model });
          const 调用数 = 回复.tool_calls?.length ?? 0;
          if (调用数 > 0) {
            推("决定调用", {
              轮次,
              工具: (回复.tool_calls ?? []).map((t) => t.function.name),
            });
          }
          return 回复;
        },
        执行工具: async (name, 参数) => {
          // 写操作逐次审批：入队 → 推送事件 → 阻塞等用户决议
          // 注意：只有可写模式下才有写工具可用；只读模式根本不会走到这里。
          if (审批 && 需要审批(name)) {
            const 请求: 审批请求 = {
              id: 审批.生成ID(),
              agentId,
              工具: name,
              参数,
              摘要: 生成审批摘要(name, 参数),
              创建时间: Date.now(),
            };
            推("等待审批", { 轮次, 工具: name, 审批ID: 请求.id, 摘要: 请求.摘要 });
            const 决议 = await 审批.等待(请求);
            if (!决议.通过) {
              推("审批拒绝", { 轮次, 工具: name, 审批ID: 请求.id, 原因: 决议.原因 });
              // 作为工具结果回传给模型，让它知道被拒绝（而不是抛错中断循环）
              return { 已拒绝: true, 原因: 决议.原因 ?? "用户拒绝" };
            }
            推("审批通过", { 轮次, 工具: name, 审批ID: 请求.id });
          }
          推("执行工具", { 轮次, 工具: name, 参数 });
          try {
            const r = await 依赖.执行工具(name, 参数);
            推("工具完成", { 轮次, 工具: name });
            return r;
          } catch (err) {
            推("工具失败", { 轮次, 工具: name, 错误: err instanceof Error ? err.message : String(err) });
            throw err;
          }
        },
      },
      {
        messages,
        tools: 工具,
        maxIterations: typeof p.maxIterations === "number" ? p.maxIterations : 8,
      },
    );

    推("结束", {
      轮次: 结果.迭代次数,
      结束: 结果.结束,
      达到上限: 结果.达到上限,
    });

    return {
      agentId,
      只读模式,
      // 回显实际请求的模型：排查「界面选了 A 却用了 B」时看这个字段
      provider: provider ?? null,
      model: model ?? null,
      ...结果,
      工具数: 工具.length,
      进度ID,
    };
  });

  // 列出 AI 可见能力（调试/审查用）
  客户端.onRequest("agent.tools", async (参数) => {
    const p = (参数 ?? {}) as { 只读?: boolean };
    const 只读模式 = p.只读 !== false;
    const 能力 = await 取可调用能力(依赖.获取能力, 只读模式);
    return 能力列表转OpenAI工具(能力 as 能力声明[]).map((t) => t.function.name);
  });

  // ===== 审批（写操作逐次确认）=====

  // 列出待审批请求（前端打开面板/重连时拉取）
  客户端.onRequest("agent.approvals", () => (审批 ? 审批.列表() : []));

  // 用户批准
  客户端.onRequest("agent.approve", (参数) => {
    if (!审批) throw new Error("审批队列未启用");
    const { id, 备注 } = (参数 ?? {}) as { id?: string; 备注?: string };
    if (!id) throw new Error("缺少 id");
    const 成功 = 审批.批准(id, 备注);
    if (!成功) throw new Error(`未找到待审批请求 ${id}（可能已超时或已处理）`);
    return { 已批准: id };
  });

  // 用户拒绝
  客户端.onRequest("agent.reject", (参数) => {
    if (!审批) throw new Error("审批队列未启用");
    const { id, 原因 } = (参数 ?? {}) as { id?: string; 原因?: string };
    if (!id) throw new Error("缺少 id");
    const 成功 = 审批.拒绝(id, 原因);
    if (!成功) throw new Error(`未找到待审批请求 ${id}（可能已超时或已处理）`);
    return { 已拒绝: id };
  });
}

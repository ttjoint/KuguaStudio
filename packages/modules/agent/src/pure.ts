/**
 * agent 模块纯逻辑：能力声明 → OpenAI tools 转换 + 工具循环状态机。
 *
 * 全部为纯函数/依赖注入，便于单测（LLM 与工具执行都是外部 IO，测试时注入桩）。
 */

import type { 能力声明 } from "@kugua/capability";

/** OpenAI 标准工具定义（function calling） */
export interface OpenAI工具 {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** 模型返回的工具调用 */
export interface 工具调用 {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** 对话消息（工具循环中的完整形态） */
export interface 循环消息 {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: 工具调用[];
  tool_call_id?: string;
}

/** 把一条能力声明转成 OpenAI function tool */
export function 能力转OpenAI工具(声明: 能力声明): OpenAI工具 {
  return {
    type: "function",
    function: {
      name: 声明.名称,
      description: 声明.说明 ?? 声明.标题 ?? 声明.名称,
      parameters: (声明.参数 as Record<string, unknown> | undefined) ?? {
        type: "object",
        properties: {},
      },
    },
  };
}

/** 把一批能力声明转成 OpenAI tools（跳过无名称的） */
export function 能力列表转OpenAI工具(声明列表: 能力声明[]): OpenAI工具[] {
  return 声明列表.filter((d) => Boolean(d.名称)).map(能力转OpenAI工具);
}

/** 解析模型返回的工具调用 arguments（JSON 字符串 → 对象；解析失败返回 null） */
export function 解析工具参数(调用: 工具调用): Record<string, unknown> | null {
  try {
    const 值 = JSON.parse(调用.function.arguments || "{}") as unknown;
    if (值 && typeof 值 === "object" && !Array.isArray(值)) {
      return 值 as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** 工具执行依赖：一次 LLM 聊天 + 一次工具执行（注入以便测试） */
export interface 工具循环依赖 {
  /** 发起一次聊天（带 tools），返回模型回复 */
  聊天(
    messages: 循环消息[],
    tools: OpenAI工具[],
  ): Promise<{
    content: string | null;
    tool_calls: 工具调用[];
    finish_reason?: string;
  }>;
  /** 执行一个工具，返回可序列化结果 */
  执行工具(name: string, 参数: Record<string, unknown>): Promise<unknown>;
}

/** 工具循环选项 */
export interface 工具循环选项 {
  /** 初始消息（含 system 与 user） */
  messages: 循环消息[];
  /** 下发给模型的工具定义 */
  tools: OpenAI工具[];
  /** 最大迭代次数（每轮执行一批工具算一次），默认 8 */
  maxIterations?: number;
  /** 单次工具执行失败时，是否把错误作为工具结果回传（默认 true，让模型看到错误） */
  吞掉工具错误?: boolean;
}

/** 工具循环结果 */
export interface 工具循环结果 {
  /** 是否正常结束（模型给出最终回答） */
  结束: boolean;
  /** 最终文本回答（未正常结束时为 null） */
  最终回答: string | null;
  /** 完整消息历史（含 tool 结果，可持久化） */
  messages: 循环消息[];
  /** 实际迭代次数 */
  迭代次数: number;
  /** 达到最大迭代但模型仍在调用工具时为 true */
  达到上限: boolean;
}

/**
 * 工具循环状态机：
 *
 * 1. 带 tools 发起聊天；
 * 2. 若模型返回 tool_calls → 逐个执行工具，把结果作为 tool 消息追加；
 * 3. 回到 1；
 * 4. 若模型不再调用工具（无 tool_calls）→ 返回最终回答。
 */
export async function 运行工具循环(
  依赖: 工具循环依赖,
  选项: 工具循环选项,
): Promise<工具循环结果> {
  const max = Math.max(1, 选项.maxIterations ?? 8);
  const messages = [...选项.messages];
  const 吞掉错误 = 选项.吞掉工具错误 ?? true;

  for (let i = 0; i < max; i++) {
    const 回复 = await 依赖.聊天(messages, 选项.tools);
    const 调用列表 = 回复.tool_calls ?? [];

    if (调用列表.length === 0) {
      return {
        结束: true,
        最终回答: 回复.content ?? "",
        messages,
        迭代次数: i,
        达到上限: false,
      };
    }

    // 追加 assistant 消息（含 tool_calls）
    messages.push({
      role: "assistant",
      content: 回复.content ?? "",
      tool_calls: 调用列表,
    });

    // 逐个执行工具，追加 tool 结果消息
    for (const 调用 of 调用列表) {
      const 参数 = 解析工具参数(调用) ?? {};
      let 结果: unknown;
      try {
        结果 = await 依赖.执行工具(调用.function.name, 参数);
      } catch (err) {
        if (!吞掉错误) throw err;
        结果 = { 错误: err instanceof Error ? err.message : String(err) };
      }
      messages.push({
        role: "tool",
        content: typeof 结果 === "string" ? 结果 : JSON.stringify(结果),
        tool_call_id: 调用.id,
      });
    }
  }

  return {
    结束: false,
    最终回答: null,
    messages,
    迭代次数: max,
    达到上限: true,
  };
}

/**
 * 默认系统提示：引导模型「必须用工具、只回答可读内容」。
 * P0 实测结论：没有明确引导时模型会把 tools 当说明文档念，而不是调用。
 */
export const 默认代理系统提示 =
  "你是苦瓜工作室的智能管理助手。你可以调用提供的工具来读取知识库、搜索内容、写入你自己的笔记。" +
  "当问题需要查询或写入知识库时，必须调用对应工具，不要凭空猜测。" +
  "工具结果是你唯一的事实来源，最终回答要基于工具结果。" +
  "你只能通过 mkg.ai.* 工具访问知识库；读不到的内容不要编造。";

// ===== 审批队列（写操作逐次确认）=====
//
// 为什么需要：只读/可写是「整场会话」的开关，一旦开到可写，AI 就能连续写任意多条。
// 用户对「它到底写了什么」没有逐次把关的机会。
//
// 设计要点：
// - 纯内存 + Promise 阻塞：工具循环的「执行工具」本身就是 async，
//   所以审批天然可以 await，不需要改造循环结构。
// - 超时自动拒绝：避免前端关闭/断线导致循环永久挂起。
// - 队列不持久化：进程重启后未决的审批自然作废（AI 的写入也随之失败），这是可接受语义。

/** 一条待审批的写操作 */
export interface 审批请求 {
  id: string;
  agentId: string;
  工具: string;
  参数: Record<string, unknown>;
  /** 给用户看的摘要（如「新建 aigc：番茄育苗小结」） */
  摘要: string;
  创建时间: number;
}

/** 审批决议 */
export type 审批决议 =
  | { 通过: true; 备注?: string }
  | { 通过: false; 原因?: string };

interface 待决项 {
  请求: 审批请求;
  解决: (决议: 审批决议) => void;
  定时器: ReturnType<typeof setTimeout>;
}

/**
 * 审批队列：登记待审批请求，等用户决议。
 *
 * 使用方式：
 * ```ts
 * const 决议 = await 队列.等待({ agentId, 工具, 参数, 摘要 }, 120000);
 * if (!决议.通过) throw new Error("用户拒绝了该操作");
 * ```
 */
export class 审批队列 {
  private 待决 = new Map<string, 待决项>();
  private 序号 = 0;

  constructor(
    /** 登记新请求时的回调（用于推送给前端） */
    private 选项: {
      通知登记?: (请求: 审批请求) => void;
      通知解决?: (id: string, 决议: 审批决议) => void;
    } = {},
  ) {}

  /** 当前待审批列表（前端刷新用） */
  列表(): 审批请求[] {
    return [...this.待决.values()].map((x) => x.请求).sort((a, b) => a.创建时间 - b.创建时间);
  }

  /** 是否有待审批 */
  get 有待审批(): boolean {
    return this.待决.size > 0;
  }

  /** 生成请求 id（单调递增，便于前端排序/去重） */
  生成ID(): string {
    this.序号 += 1;
    return `ap-${Date.now()}-${this.序号}`;
  }

  /**
   * 登记并等待决议。
   *
   * @param 请求 待审批请求（id 由调用方用 生成ID() 生成）
   * @param 超时毫秒 超时后自动拒绝（默认 120s）
   */
  等待(请求: 审批请求, 超时毫秒 = 120000): Promise<审批决议> {
    return new Promise<审批决议>((解决) => {
      const 定时器 = setTimeout(() => {
        // 超时：视为拒绝，并清理
        const 项 = this.待决.get(请求.id);
        if (!项) return;
        this.待决.delete(请求.id);
        解决({ 通过: false, 原因: "审批超时（用户未响应）" });
        this.选项.通知解决?.(请求.id, { 通过: false, 原因: "审批超时" });
      }, Math.max(1000, 超时毫秒));

      this.待决.set(请求.id, { 请求, 解决, 定时器 });
      this.选项.通知登记?.(请求);
    });
  }

  /** 用户决议：批准 */
  批准(id: string, 备注?: string): boolean {
    return this.解决(id, { 通过: true, 备注 });
  }

  /** 用户决议：拒绝 */
  拒绝(id: string, 原因?: string): boolean {
    return this.解决(id, { 通过: false, 原因 });
  }

  /** 内部：解决一条待决项 */
  private 解决(id: string, 决议: 审批决议): boolean {
    const 项 = this.待决.get(id);
    if (!项) return false;
    this.待决.delete(id);
    clearTimeout(项.定时器);
    项.解决(决议);
    this.选项.通知解决?.(id, 决议);
    return true;
  }

  /** 清空全部（拒绝所有待决；进程退出/停止模块时用） */
  清空(原因 = "队列已清空"): void {
    for (const [id, 项] of [...this.待决]) {
      this.待决.delete(id);
      clearTimeout(项.定时器);
      项.解决({ 通过: false, 原因 });
      this.选项.通知解决?.(id, { 通过: false, 原因 });
    }
  }
}

/** 哪些工具需要审批：写操作 + 删除类 */
export function 需要审批(工具名: string): boolean {
  // 目前只有 mkg.ai.write 是 AI 可用的写能力。
  // 用「后缀/前缀匹配」而非硬编码单值，将来加 mkg.ai.update 等无需改这里。
  return /\.write$|\.update$|\.delete$|\.create$/.test(工具名);
}

/** 从工具调用生成给人看的摘要 */
export function 生成审批摘要(工具: string, 参数: Record<string, unknown>): string {
  const 标题 = typeof 参数.title === "string" ? 参数.title : "";
  const id = 参数.id;
  const 内容 = typeof 参数.content === "string" ? 参数.content : "";
  if (/\.delete$/.test(工具)) return `删除内容 ${id ?? ""}`;
  if (id !== undefined) return `修改内容 ${id}${标题 ? `「${标题}」` : ""}`;
  const 预览 = 内容.replace(/\s+/g, " ").slice(0, 60);
  return `新建内容${标题 ? `「${标题}」` : ""}${预览 ? `：${预览}${内容.length > 60 ? "…" : ""}` : ""}`;
}

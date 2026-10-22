/**
 * 端到端实测：可写模式 + 审批队列（真实 LLM）
 * 放到 mkg/test 下复用现有 vitest 环境，跑完即删。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "../src/index.js";
import { 运行工具循环, 能力列表转OpenAI工具, 审批队列, 需要审批, 生成审批摘要, type 循环消息, type OpenAI工具 } from "../../modules/agent/src/pure.js";

const 端点 = "http://127.0.0.1:1234/v1";
const 模型 = "qwen/qwen3.5-9b";

let 可用 = false;
try {
  const r = await fetch(`${端点}/models`, { signal: AbortSignal.timeout(8000) });
  可用 = r.ok;
} catch { 可用 = false; }

async function 聊天(messages: 循环消息[], tools: OpenAI工具[]) {
  const res = await fetch(`${端点}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: 模型, messages, tools, tool_choice: "auto", max_tokens: 2000 }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const d = (await res.json()) as { choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }; finish_reason: string }> };
  const m = d.choices[0].message;
  return { content: m.content ?? null, tool_calls: m.tool_calls ?? [], finish_reason: d.choices[0].finish_reason };
}

describe.skipIf(!可用)("端到端：审批队列拦截 AI 写入", () => {
  it("AI 请求写入 → 进审批队列 → 批准后才落库", async () => {
    const 目录 = mkdtempSync(join(tmpdir(), "e2e-approval-"));
    const mkg = new MKG(join(目录, "e2e.db"));
    const 标签 = mkg.createTag("测试");
    mkg.setTagAiPublic(标签.id, true);
    mkg.createNote("番茄育苗", "育苗温度 20-25 度。", [标签.id]);

    const agentId = "e2e-approver";
    const 审批 = new 审批队列();
    const 审批记录: Array<{ 摘要: string; 通过: boolean }> = [];

    const 能力 = [
      { 名称: "mkg.ai.search", 模块: "mkg", 说明: "搜索知识库", 参数: { type: "object", properties: { keyword: { type: "string" } }, required: ["keyword"] } },
      { 名称: "mkg.ai.read", 模块: "mkg", 说明: "读取内容（需 id）", 参数: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } },
      { 名称: "mkg.ai.write", 模块: "mkg", 说明: "写 AI 生成内容（需 agentId+title+content）", 参数: { type: "object", properties: { agentId: { type: "string" }, title: { type: "string" }, content: { type: "string" } }, required: ["agentId", "title", "content"] } },
    ];

    const 结果 = await 运行工具循环(
      {
        聊天,
        执行工具: async (name, 参数) => {
          // 审批拦截
          if (需要审批(name)) {
            const 请求 = {
              id: 审批.生成ID(),
              agentId,
              工具: name,
              参数,
              摘要: 生成审批摘要(name, 参数),
              创建时间: Date.now(),
            };
            // 模拟用户：延迟 100ms 后批准
            setTimeout(() => 审批.批准(请求.id), 100);
            const 决议 = await 审批.等待(请求, 30000);
            审批记录.push({ 摘要: 请求.摘要, 通过: 决议.通过 });
            if (!决议.通过) return { 已拒绝: true };
          }
          if (name === "mkg.ai.search") {
            const items = mkg.listAiReadable({ keyword: String(参数.keyword ?? ""), limit: 50 });
            return { total: items.length, items: items.map((x) => ({ id: x.id, name: x.name })) };
          }
          if (name === "mkg.ai.read") {
            const items = mkg.listAiReadable({ limit: 1000 });
            const hit = items.find((x) => x.id === Number(参数.id));
            if (!hit) throw new Error(`未找到 ${参数.id}`);
            return { id: hit.id, name: hit.name, content: hit.content };
          }
          if (name === "mkg.ai.write") {
            return mkg.createAigc(String(参数.agentId ?? agentId), String(参数.title ?? ""), String(参数.content ?? ""), [标签.id]);
          }
          throw new Error(`未知工具 ${name}`);
        },
      },
      {
        messages: [
          { role: "system", content: `你是助手。你的 agent_id 是 ${agentId}，写入时必须带上它。` },
          { role: "user", content: `读取知识库里番茄育苗的内容，整理成标题「番茄育苗小结」的笔记，用 mkg.ai.write 保存（agentId 用 ${agentId}）。` },
        ],
        tools: 能力列表转OpenAI工具(能力 as never),
        maxIterations: 8,
      },
    );

    expect(结果.结束).toBe(true);
    // 审批记录：至少有一次写操作经过审批，且被批准
    expect(审批记录.length).toBeGreaterThanOrEqual(1);
    expect(审批记录.some((r) => r.通过)).toBe(true);
    // 批准后才落库
    const 我的 = mkg.listAigcByAgent(agentId);
    expect(我的.length).toBeGreaterThanOrEqual(1);
    expect(我的.some((a) => a.title.includes("番茄育苗"))).toBe(true);
    console.log(`[审批] 共 ${审批记录.length} 次审批，摘要：${审批记录.map((r) => r.摘要).join(" | ")}`);
    console.log(`[落库] ${我的.map((a) => a.title).join(", ")}`);
  }, 300000);
});

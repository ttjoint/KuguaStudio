/**
 * 端到端实测（需要本地 LM Studio，缺省跳过）
 *
 * 目的：验证 agent 工具循环 × 真实 LLM × 真实知识库 的完整链路，
 * 包括只读模式的内容检索与可写模式的 aigc 落库 + agent_id 隔离。
 *
 * 跳过条件：LM Studio（127.0.0.1:1234）不可达时自动 skip，不阻塞 CI。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "../src/index.js";
import {
  运行工具循环,
  能力列表转OpenAI工具,
  默认代理系统提示,
  type OpenAI工具,
  type 循环消息,
} from "../../modules/agent/src/pure.js";

const 端点 = "http://127.0.0.1:1234/v1";
const 模型 = "qwen/qwen3.5-9b";

let 可用 = false;
try {
  // 全量并发跑时 2s 容易超时（本地模型加载占 CPU），放宽到 8s
  const r = await fetch(`${端点}/models`, { signal: AbortSignal.timeout(8000) });
  可用 = r.ok;
} catch {
  可用 = false;
}

let 目录: string;
let mkg: MKG;

beforeAll(() => {
  目录 = mkdtempSync(join(tmpdir(), "e2e-agent-"));
  mkg = new MKG(join(目录, "e2e.db"));
});

afterAll(() => {
  try {
    mkg.close();
  } catch {
    /* ignore */
  }
});

async function 聊天(messages: 循环消息[], tools: OpenAI工具[]) {
  const res = await fetch(`${端点}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: 模型, messages, tools, tool_choice: "auto", max_tokens: 800 }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const d = (await res.json()) as {
    choices: Array<{
      message: { content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> };
      finish_reason: string;
    }>;
  };
  const m = d.choices[0].message;
  return { content: m.content ?? null, tool_calls: m.tool_calls ?? [], finish_reason: d.choices[0].finish_reason };
}

const 能力 = [
  { 名称: "mkg.ai.search", 模块: "mkg", 说明: "在 AI 可读范围内按关键词搜索，返回 id 与标题",
    参数: { type: "object", properties: { keyword: { type: "string" } }, required: ["keyword"] } },
  { 名称: "mkg.ai.read", 模块: "mkg", 说明: "读取可读内容：给 id 读单条全文，不给 id 列出全部",
    参数: { type: "object", properties: { id: { type: "number" } } } },
  { 名称: "mkg.ai.write", 模块: "mkg", 说明: "写 AI 生成内容（新建需 agentId+title+content）",
    参数: { type: "object", properties: { agentId: { type: "string" }, title: { type: "string" }, content: { type: "string" } }, required: ["agentId", "title", "content"] } },
];

describe.skipIf(!可用)("端到端：agent 工具循环 × 真实 LLM", () => {
  it("只读模式：搜索 + 读取 + 汇总，且不泄漏未标记内容", async () => {
    const 种植 = mkg.createTag("种植");
    const 番茄 = mkg.createTag("番茄", 种植.id);
    const 内部 = mkg.createTag("内部资料");
    mkg.createNote("番茄育苗要点", "番茄育苗温度保持 20-25 度，出苗后及时通风，避免徒长。", [番茄.id]);
    mkg.createNote("番茄整枝方法", "番茄单干整枝：保留主干，摘除全部侧枝，留 4-5 穗果后打顶。", [番茄.id]);
    mkg.createNote("内部会议记录", "这条不应该被 AI 读到。", [内部.id]);
    mkg.setTagAiPublic(种植.id, true); // 后代「番茄」继承可读

    // 只读工具集：不含 write
    const 只读能力 = 能力.filter((c) => c.名称 !== "mkg.ai.write");
    const tools = 能力列表转OpenAI工具(只读能力 as never);

    const 结果 = await 运行工具循环(
      {
        聊天,
        执行工具: async (name, 参数) => {
          if (name === "mkg.ai.search") {
            const items = mkg.listAiReadable({ keyword: String(参数.keyword ?? ""), limit: 50 });
            return { total: items.length, items: items.map((x) => ({ id: x.id, name: x.name })) };
          }
          if (name === "mkg.ai.read") {
            const items = mkg.listAiReadable({ limit: 1000 });
            const hit = items.find((x) => x.id === Number(参数.id));
            if (!hit) throw new Error(`未找到可读内容 ${参数.id}`);
            return { id: hit.id, name: hit.name, content: hit.content };
          }
          throw new Error(`只读模式不该有工具 ${name}`);
        },
      },
      {
        messages: [
          { role: "system", content: `${默认代理系统提示}\n你的 agent_id 是 e2e-reader。` },
          { role: "user", content: "知识库里关于番茄育苗和整枝的要点是什么？请先搜索再读取具体内容后回答。" },
        ],
        tools,
        maxIterations: 6,
      },
    );

    expect(结果.结束).toBe(true);
    expect(结果.messages.filter((m) => m.role === "tool").length).toBeGreaterThan(0);
    const 回答 = 结果.最终回答 ?? "";
    expect(回答).toMatch(/20|25|温度/);
    expect(回答).toMatch(/整枝|侧枝|主干/);
    expect(回答).not.toMatch(/内部会议|不应该被 AI 读到/);
  }, 180000);

  it("可写模式：整理要点写入 aigc，agent_id 隔离生效", async () => {
    const 标签 = mkg.createTag("可写测试");
    mkg.setTagAiPublic(标签.id, true);
    mkg.createNote("育苗资料", "育苗温度 20-25 度，出苗后通风防徒长。", [标签.id]);

    const agentId = "e2e-writer";
    const tools = 能力列表转OpenAI工具(能力 as never);

    const 结果 = await 运行工具循环(
      {
        聊天,
        执行工具: async (name, 参数) => {
          if (name === "mkg.ai.search") {
            const items = mkg.listAiReadable({ keyword: String(参数.keyword ?? ""), limit: 50 });
            return { total: items.length, items: items.map((x) => ({ id: x.id, name: x.name })) };
          }
          if (name === "mkg.ai.read") {
            const items = mkg.listAiReadable({ limit: 1000 });
            const hit = items.find((x) => x.id === Number(参数.id));
            if (!hit) throw new Error(`未找到可读内容 ${参数.id}`);
            return { id: hit.id, name: hit.name, content: hit.content };
          }
          if (name === "mkg.ai.write") {
            const aid = String(参数.agentId ?? agentId);
            return mkg.createAigc(aid, String(参数.title ?? "无标题"), String(参数.content ?? ""), [标签.id]);
          }
          throw new Error(`未知工具 ${name}`);
        },
      },
      {
        messages: [
          { role: "system", content: `${默认代理系统提示}\n你的 agent_id 是 ${agentId}，写入时必须带上它。` },
          { role: "user", content: `读取知识库里关于番茄育苗的内容，把要点整理成标题为「番茄育苗小结」的笔记，用 mkg.ai.write 保存（agentId 用 ${agentId}）。` },
        ],
        tools,
        maxIterations: 8,
      },
    );

    expect(结果.结束).toBe(true);

    // 写入落库 + 隔离
    const 我的 = mkg.listAigcByAgent(agentId);
    expect(我的.length).toBeGreaterThanOrEqual(1);
    expect(我的.some((a) => a.title.includes("番茄育苗"))).toBe(true);
    expect(我的.some((a) => /温度|20|通风/.test(a.content))).toBe(true);

    // 别的 agent 读不到
    expect(mkg.listAigcByAgent("other-agent")).toHaveLength(0);
    // 用户视角能看到
    expect(mkg.用户ListAigc().length).toBeGreaterThanOrEqual(1);
    // 按来源汇总
    expect(mkg.列表AigcAgent().some((r) => r.agentId === agentId && r.count >= 1)).toBe(true);
  }, 180000);
});

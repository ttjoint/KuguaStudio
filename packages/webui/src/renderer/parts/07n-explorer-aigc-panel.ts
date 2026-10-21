// ===== AI 内容面板：按 agent 分组的 aigc 浏览 =====
//
// 设计意图：用户是超级管理员，不该需要「猜」AI 写了什么。
// 这里提供独立入口（智能视图区顶部固定项），按来源 agent 分组展示，
// 支持查看/编辑（复用 07m 对话框）与删除。
//
// 与统一浏览的区别：统一浏览把 aigc 混在各类内容里靠 🤖 图标区分，
// 本面板只聚焦 AI 生成物，且按 agent 分组——回答「哪个 AI 写了什么」。
import { Explorer } from "./07-explorer";
import { 添加消息 } from "./03-preview";
import { 打开AIGC查看 } from "./07m-explorer-aigc";

interface AIGC项 {
  id: number;
  agentId: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

interface Agent汇总 {
  agentId: string;
  count: number;
}

/** 面板是否处于打开态（避免与统一浏览的渲染互相覆盖） */
export let AI内容面板已打开 = false;

function 格式化时间(秒: number): string {
  if (!秒) return "—";
  const d = new Date(秒 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 把 aigc 条目转成 07m 对话框需要的 内容条目 形状 */
function 转内容条目(a: AIGC项): Explorer.内容条目 {
  return {
    id: a.id,
    type: "aigc",
    category: "AI 生成",
    name: a.title,
    content: a.content,
    tagIds: a.tagIds,
    tagPaths: [],
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    resourceId: null,
    path: null,
    size: 0,
    modifiedTime: 0,
    indexedAt: 0,
    realName: null,
    extension: "",
    meta: {},
  };
}

/** 打开 AI 内容面板（替换内容区） */
export async function 打开AI内容面板(): Promise<void> {
  AI内容面板已打开 = true;
  const 内容区 = document.getElementById("ex-content") ?? document.getElementById("ex-file-list");
  if (!内容区) {
    添加消息("找不到内容区容器，无法打开 AI 内容面板", "error");
    return;
  }

  内容区.innerHTML = "";
  const 面板 = document.createElement("div");
  面板.className = "ex-aigc-panel";
  面板.style.cssText = "padding:0.75rem;overflow:auto;height:100%;display:flex;flex-direction:column;gap:0.75rem";

  // 标题栏
  const 头 = document.createElement("div");
  头.style.cssText = "display:flex;align-items:center;gap:0.5rem;flex-shrink:0";
  const 标题 = document.createElement("div");
  标题.textContent = "🤖 AI 生成内容";
  标题.style.cssText = "font-weight:600;font-size:0.95rem";
  头.appendChild(标题);
  const 说明 = document.createElement("span");
  说明.textContent = "（AI 写入的知识库内容，按来源分组）";
  说明.style.cssText = "font-size:0.72rem;opacity:0.65";
  头.appendChild(说明);
  const 刷新 = document.createElement("button");
  刷新.className = "mini-btn";
  刷新.textContent = "↻";
  刷新.title = "刷新";
  刷新.style.marginLeft = "auto";
  刷新.addEventListener("click", () => void 打开AI内容面板());
  头.appendChild(刷新);
  const 关闭 = document.createElement("button");
  关闭.className = "mini-btn";
  关闭.textContent = "✕";
  关闭.title = "关闭面板，回到统一浏览";
  关闭.addEventListener("click", () => {
    AI内容面板已打开 = false;
    void Explorer.加载所有内容();
  });
  头.appendChild(关闭);
  面板.appendChild(头);

  // 取数据
  let 汇总: Agent汇总[] = [];
  let 全部: AIGC项[] = [];
  try {
    const [汇总结果, 列表结果] = await Promise.all([
      window.kugua.request("mkg", "mkg.aigc.agents", {}) as Promise<Agent汇总[]>,
      window.kugua.request("mkg", "mkg.aigc.list", { limit: 500 }) as Promise<{ total: number; items: AIGC项[] }>,
    ]);
    汇总 = 汇总结果 ?? [];
    全部 = 列表结果.items ?? [];
  } catch (err) {
    添加消息("加载 AI 内容失败：" + String(err), "error");
  }

  if (全部.length === 0) {
    const 空 = document.createElement("div");
    空.style.cssText = "opacity:0.6;font-size:0.82rem;padding:1rem 0";
    空.textContent = "还没有 AI 生成的内容。用 agent 指令让它写点什么试试（例如「agent 整理今天的笔记」）。";
    面板.appendChild(空);
    内容区.appendChild(面板);
    return;
  }

  // 按 agent 分组
  const 分组 = new Map<string, AIGC项[]>();
  for (const a of 全部) {
    const k = a.agentId || "（未知来源）";
    const 组 = 分组.get(k);
    if (组) 组.push(a);
    else 分组.set(k, [a]);
  }

  for (const [agentId, 项列表] of 分组) {
    const 组盒 = document.createElement("div");
    组盒.style.cssText = "border:1px solid var(--border);border-radius:6px;overflow:hidden";

    const 组头 = document.createElement("div");
    组头.style.cssText =
      "padding:0.4rem 0.6rem;background:var(--bg-hover);font-size:0.78rem;display:flex;align-items:center;gap:0.4rem";
    const 组名 = document.createElement("span");
    组名.textContent = `agent: ${agentId}`;
    组名.style.cssText = "font-weight:600;font-family:ui-monospace,monospace";
    组头.appendChild(组名);
    const 计数 = document.createElement("span");
    const 汇总项 = 汇总.find((s) => s.agentId === agentId);
    计数.textContent = `${汇总项?.count ?? 项列表.length} 条`;
    计数.style.cssText = "opacity:0.65";
    组头.appendChild(计数);
    组盒.appendChild(组头);

    for (const a of 项列表) {
      const 行 = document.createElement("div");
      行.style.cssText =
        "padding:0.4rem 0.6rem;border-top:1px solid var(--border);cursor:pointer;display:flex;flex-direction:column;gap:0.15rem";
      行.addEventListener("mouseenter", () => (行.style.background = "var(--bg-hover)"));
      行.addEventListener("mouseleave", () => (行.style.background = ""));
      行.addEventListener("dblclick", () => void 打开AIGC查看(转内容条目(a)));

      const 名行 = document.createElement("div");
      名行.style.cssText = "display:flex;align-items:center;gap:0.4rem";
      const 名 = document.createElement("span");
      名.textContent = a.title || "（无标题）";
      名.style.cssText = "font-size:0.82rem;font-weight:500";
      名行.appendChild(名);
      const 时间 = document.createElement("span");
      时间.textContent = 格式化时间(a.updatedAt);
      时间.style.cssText = "margin-left:auto;font-size:0.7rem;opacity:0.55";
      名行.appendChild(时间);
      行.appendChild(名行);

      const 摘要 = document.createElement("div");
      摘要.textContent = (a.content || "").replace(/\s+/g, " ").slice(0, 100) || "（空）";
      摘要.style.cssText = "font-size:0.74rem;opacity:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      行.appendChild(摘要);

      行.title = "双击查看/编辑";
      组盒.appendChild(行);
    }
    面板.appendChild(组盒);
  }

  内容区.appendChild(面板);
}

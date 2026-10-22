// ===== AI 写操作审批 UI =====
//
// 设计：可写模式下，AI 每次要写（mkg.ai.write）都会先入队等用户批准。
// 这里负责：
// 1. 订阅 agent.approval 事件（登记/解决）
// 2. 在对话流里显示审批卡片（摘要 + 批准/拒绝）
// 3. 面板关闭/重连时通过 agent.approvals 拉取未决项
//
// 为什么用卡片而不是 window.confirm：
// - confirm 会阻塞整个渲染线程，AI 循环期间无法显示进度
// - 卡片可以带上下文（哪个 agent、什么工具、写了什么）
// - 多个请求排队时 confirm 会连弹，体验差
import { 聊天日志 } from "./02-chat-core";
import { 添加消息 } from "./03-preview";

interface 审批请求 {
  id: string;
  agentId: string;
  工具: string;
  参数: Record<string, unknown>;
  摘要: string;
  创建时间: number;
}

interface 审批决议 {
  通过: boolean;
  备注?: string;
  原因?: string;
}

/** 已渲染的审批卡片（避免重复渲染） */
const 已渲染 = new Set<string>();

/** 创建一张审批卡片 */
function 渲染审批卡片(请求: 审批请求): void {
  if (已渲染.has(请求.id)) return;
  已渲染.add(请求.id);

  const 卡 = document.createElement("div");
  卡.className = "approval-card";
  卡.dataset.approvalId = 请求.id;
  卡.style.cssText = [
    "border:1px solid var(--warning, #d09a3c)",
    "border-radius:6px",
    "padding:0.6rem 0.75rem",
    "margin:0.5rem 0",
    "background:var(--bg-hover)",
    "display:flex",
    "flex-direction:column",
    "gap:0.45rem",
  ].join(";");

  const 头 = document.createElement("div");
  头.style.cssText = "display:flex;align-items:center;gap:0.4rem;font-size:0.8rem";
  const 图标 = document.createElement("span");
  图标.textContent = "⚠️";
  头.appendChild(图标);
  const 标题 = document.createElement("span");
  标题.textContent = "AI 请求写入，需要你确认";
  标题.style.cssText = "font-weight:600";
  头.appendChild(标题);
  const 来源 = document.createElement("span");
  来源.textContent = `agent: ${请求.agentId}`;
  来源.style.cssText = "margin-left:auto;font-size:0.7rem;opacity:0.6;font-family:ui-monospace,monospace";
  头.appendChild(来源);
  卡.appendChild(头);

  const 摘要 = document.createElement("div");
  摘要.textContent = 请求.摘要;
  摘要.style.cssText = "font-size:0.8rem;line-height:1.5";
  卡.appendChild(摘要);

  // 参数详情（折叠，默认收起，避免刷屏）
  const 详情钮 = document.createElement("button");
  详情钮.className = "mini-btn";
  详情钮.textContent = "查看参数";
  详情钮.style.cssText = "align-self:flex-start;font-size:0.7rem";
  const 详情 = document.createElement("pre");
  详情.textContent = JSON.stringify(请求.参数, null, 2);
  详情.style.cssText = [
    "display:none",
    "font-size:0.7rem",
    "max-height:180px",
    "overflow:auto",
    "background:var(--bg)",
    "padding:0.4rem",
    "border-radius:4px",
    "white-space:pre-wrap",
    "word-break:break-all",
  ].join(";");
  详情钮.addEventListener("click", () => {
    const 显示 = 详情.style.display === "none";
    详情.style.display = 显示 ? "block" : "none";
    详情钮.textContent = 显示 ? "收起参数" : "查看参数";
  });
  卡.appendChild(详情钮);
  卡.appendChild(详情);

  const 按钮行 = document.createElement("div");
  按钮行.style.cssText = "display:flex;gap:0.4rem;justify-content:flex-end";

  const 拒绝钮 = document.createElement("button");
  拒绝钮.className = "btn";
  拒绝钮.textContent = "拒绝";
  拒绝钮.style.cssText = "font-size:0.78rem;padding:0.25rem 0.7rem";
  拒绝钮.addEventListener("click", async () => {
    拒绝钮.disabled = true;
    批准钮.disabled = true;
    try {
      await window.kugua.request("agent", "agent.reject", { id: 请求.id, 原因: "用户拒绝" });
      标记结果(卡, "已拒绝", false);
    } catch (err) {
      标记结果(卡, "拒绝失败：" + String(err), false);
    }
  });

  const 批准钮 = document.createElement("button");
  批准钮.className = "btn primary";
  批准钮.textContent = "批准";
  批准钮.style.cssText = "font-size:0.78rem;padding:0.25rem 0.7rem";
  批准钮.addEventListener("click", async () => {
    批准钮.disabled = true;
    拒绝钮.disabled = true;
    try {
      await window.kugua.request("agent", "agent.approve", { id: 请求.id });
      标记结果(卡, "已批准，AI 继续执行", true);
    } catch (err) {
      标记结果(卡, "批准失败：" + String(err), false);
    }
  });

  按钮行.appendChild(拒绝钮);
  按钮行.appendChild(批准钮);
  卡.appendChild(按钮行);

  聊天日志.appendChild(卡);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}

/** 决议后把卡片变成静态状态（移除按钮） */
function 标记结果(卡: HTMLDivElement, 文本: string, 通过: boolean): void {
  const 按钮行 = 卡.querySelector("div:last-child");
  按钮行?.remove();
  const 结果 = document.createElement("div");
  结果.textContent = (通过 ? "✅ " : "❌ ") + 文本;
  结果.style.cssText = `font-size:0.78rem;opacity:0.85;color:${通过 ? "var(--ok, #3c9)" : "var(--err, #e55)"}`;
  卡.appendChild(结果);
  卡.style.borderColor = 通过 ? "var(--ok, #3c9)" : "var(--err, #e55)";
}

/** 处理事件里的「解决」（可能来自另一个窗口/超时） */
function 处理解决(id: string, 决议: 审批决议): void {
  const 卡 = document.querySelector(`.approval-card[data-approval-id="${id}"]`) as HTMLDivElement | null;
  if (!卡) return;
  // 已经手动处理过的卡片不再覆盖
  if (!卡.querySelector("button")) return;
  标记结果(卡, 决议.通过 ? "已批准（外部）" : `已拒绝${决议.原因 ? `：${决议.原因}` : ""}`, 决议.通过);
}

/** 初始化：订阅审批事件 */
export function 初始化审批UI(): void {
  window.kugua.onBus((action: string, params: unknown) => {
    if (action !== "agent.approval") return;
    const p = (params ?? {}) as { 类型?: string; 请求?: 审批请求; id?: string; 决议?: 审批决议 };
    if (p.类型 === "登记" && p.请求) {
      渲染审批卡片(p.请求);
    } else if (p.类型 === "解决" && p.id && p.决议) {
      处理解决(p.id, p.决议);
    }
  });
}

/** 拉取未决审批（页面重连/切换对话后补渲染） */
export async function 刷新待审批(): Promise<void> {
  try {
    const 列表 = (await window.kugua.request("agent", "agent.approvals", {})) as 审批请求[];
    for (const r of 列表 ?? []) 渲染审批卡片(r);
  } catch (err) {
    // agent 模块可能未启动：静默（这是可选模块）
    void err;
  }
}

/** 供对话页调用：清掉已渲染记录（切换对话时避免串场） */
export function 重置审批渲染记录(): void {
  已渲染.clear();
}

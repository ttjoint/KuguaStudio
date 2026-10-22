import { 聊天日志 } from "./02-chat-core";
import { 添加独立回应, 绑定消息编辑, 恢复回复交互 } from "./03-preview";

// ===== 对话页：多对话 / 多项目（类 Open WebUI）=====
export interface 对话记录 {
  id: string;
  title: string;
  projectId: string | null;
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  html: string;
}
export interface 项目记录 {
  id: string;
  name: string;
}
export const 对话存储键 = "kugua_chats_v1";
export const 项目存储键 = "kugua_projects_v1";
export let 对话列表: 对话记录[] = [];
export let 项目列表: 项目记录[] = [];
export let 当前对话ID = "";
export let 当前项目过滤: string | null = null;
export let 对话已初始化 = false;

export function 读存储<T>(键: string, 默认: T): T {
  try {
    const s = localStorage.getItem(键);
    return s ? (JSON.parse(s) as T) : 默认;
  } catch {
    return 默认;
  }
}
export function 写存储(键: string, 值: unknown): void {
  try {
    localStorage.setItem(键, JSON.stringify(值));
  } catch {
    /* 忽略 */
  }
}
export function 新ID(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
export function 当前对话(): 对话记录 | undefined {
  return 对话列表.find((c) => c.id === 当前对话ID);
}
export function 保存对话列表(): void {
  写存储(对话存储键, 对话列表);
}
export function 保存项目列表(): void {
  写存储(项目存储键, 项目列表);
}

export function 保存当前对话DOM(): void {
  const d = 当前对话();
  if (!d) return;
  d.html = 聊天日志.innerHTML;
  d.updatedAt = Date.now();
  if (d.title === "新对话") {
    const 首 = 聊天日志.querySelector(".chat-msg.user .msg-content") as HTMLElement | null;
    if (首?.textContent?.trim()) d.title = 首.textContent.trim().slice(0, 24);
  }
  const 标题 = document.getElementById("chat-conv-title");
  if (标题) 标题.textContent = "💬 " + d.title;
  保存对话列表();
  const 列表 = document.getElementById("conv-list");
  const 活动 = 列表?.querySelector(".conv-item.active .conv-name") as HTMLElement | null;
  if (活动) 活动.textContent = d.title;
}

/** 从 localStorage/HTML 恢复对话后，重新绑定所有交互事件（innerHTML 不保留监听器） */
export function 恢复对话交互(): void {
  for (const 气泡 of 聊天日志.querySelectorAll<HTMLDivElement>(".chat-msg.user")) {
    if (!气泡.dataset.原文) {
      const c = 气泡.querySelector(".msg-content");
      气泡.dataset.原文 = c?.textContent ?? "";
    }
    绑定消息编辑(气泡);
  }
  恢复回复交互();
}

export function 切换对话(id: string): void {
  if (当前对话ID && 当前对话ID !== id) 保存当前对话DOM();
  当前对话ID = id;
  const d = 当前对话();
  聊天日志.innerHTML = d?.html ?? "";
  恢复对话交互();
  const 标题 = document.getElementById("chat-conv-title");
  if (标题) 标题.textContent = "💬 " + (d?.title ?? "新对话");
  const 模型框 = document.getElementById("chat-ai-model") as HTMLSelectElement | null;
  if (模型框 && d) 模型框.value = `${d.provider}|${d.model}`;
  渲染对话列表();
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}

export function 新建对话(projectId: string | null = null): void {
  const d: 对话记录 = {
    id: 新ID(),
    title: "新对话",
    projectId,
    provider: "",
    model: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    html: "",
  };
  对话列表.unshift(d);
  保存对话列表();
  切换对话(d.id);
}

export function 新建项目(): void {
  const 名 = window.prompt("项目名称：", "");
  if (!名 || !名.trim()) return;
  项目列表.push({ id: 新ID(), name: 名.trim() });
  保存项目列表();
  渲染对话列表();
}

export function 删除对话(id: string): void {
  if (!window.confirm("删除该对话？")) return;
  对话列表 = 对话列表.filter((c) => c.id !== id);
  保存对话列表();
  if (当前对话ID === id) {
    当前对话ID = "";
    切换对话(对话列表[0]?.id ?? "");
  } else {
    渲染对话列表();
  }
}

export function 重命名对话(id: string): void {
  const d = 对话列表.find((c) => c.id === id);
  if (!d) return;
  const 名 = window.prompt("对话名称：", d.title);
  if (!名 || !名.trim()) return;
  d.title = 名.trim();
  保存对话列表();
  if (id === 当前对话ID) {
    const 标题 = document.getElementById("chat-conv-title");
    if (标题) 标题.textContent = "💬 " + d.title;
  }
  渲染对话列表();
}

export function 渲染对话列表(): void {
  const 容器 = document.getElementById("conv-list");
  const 项目容器 = document.getElementById("conv-projects");
  if (!容器 || !项目容器) return;
  项目容器.innerHTML = "";
  const 全部 = document.createElement("button");
  全部.className = "conv-project-chip" + (当前项目过滤 == null ? " active" : "");
  全部.textContent = "全部";
  全部.addEventListener("click", () => {
    当前项目过滤 = null;
    渲染对话列表();
  });
  项目容器.appendChild(全部);
  for (const p of 项目列表) {
    const chip = document.createElement("button");
    chip.className = "conv-project-chip" + (当前项目过滤 === p.id ? " active" : "");
    chip.textContent = p.name;
    chip.addEventListener("click", () => {
      当前项目过滤 = p.id;
      渲染对话列表();
    });
    项目容器.appendChild(chip);
  }
  容器.innerHTML = "";
  const 过滤后 = 当前项目过滤 ? 对话列表.filter((c) => c.projectId === 当前项目过滤) : 对话列表;
  for (const d of 过滤后) {
    const 行 = document.createElement("div");
    行.className = "conv-item" + (d.id === 当前对话ID ? " active" : "");
    const 名 = document.createElement("span");
    名.className = "conv-name";
    名.textContent = d.title;
    名.title = new Date(d.updatedAt).toLocaleString();
    行.appendChild(名);
    const 操 = document.createElement("span");
    操.className = "conv-ops";
    const 改 = document.createElement("button");
    改.className = "mini-btn";
    改.textContent = "✎";
    改.title = "重命名";
    改.addEventListener("click", (e) => {
      e.stopPropagation();
      重命名对话(d.id);
    });
    操.appendChild(改);
    const 删 = document.createElement("button");
    删.className = "mini-btn";
    删.textContent = "×";
    删.title = "删除";
    删.addEventListener("click", (e) => {
      e.stopPropagation();
      删除对话(d.id);
    });
    操.appendChild(删);
    行.appendChild(操);
    行.addEventListener("click", () => 切换对话(d.id));
    容器.appendChild(行);
  }
  if (过滤后.length === 0) 容器.innerHTML = '<div class="conv-empty">（无对话）</div>';
}

/**
 * 刷新 AI 模型选择器。
 *
 * 两条来源合并：
 * 1. OpenWebUI（若已配置）：按「连接」分组列出全部模型，值形如 `openwebui|前缀.模型`
 * 2. 本地 providers：每项一个 `提供方|默认模型`
 *
 * 模型总数可能上百，用 optgroup 分组，靠原生下拉的键盘搜索定位。
 */
export async function 刷新AI模型选择器(): Promise<void> {
  const 框 = document.getElementById("chat-ai-model") as HTMLSelectElement | null;
  if (!框) return;
  const 组: string[] = [];

  try {
    const p = (await window.kugua.request("ai", "ai.providers", {})) as {
      default: string;
      providers: Array<{ name: string; models: Record<string, string> }>;
      openwebui?: { baseUrl: string; defaultModel: string | null } | null;
    };

    // —— OpenWebUI：按连接分组 ——
    if (p.openwebui) {
      try {
        const m = (await window.kugua.request("ai", "ai.openwebui.models", {}, 30000)) as {
          total: number;
          分组: Array<{ prefix: string; count: number; models: string[] }>;
        };
        const 默认 = p.openwebui.defaultModel;
        // optgroup 不能嵌套，每个连接一个平级 optgroup
        组.push(
          `<optgroup label="OpenWebUI · 默认">` +
            `<option value="openwebui|">使用默认（${escapeAttr(默认 ?? "首个模型")}）</option>` +
            `</optgroup>`,
        );
        for (const g of m.分组 ?? []) {
          组.push(
            `<optgroup label="${escapeAttr(g.prefix)}（${g.count}）">` +
              g.models.map((id) => `<option value="openwebui|${escapeAttr(id)}">${escapeAttr(id)}</option>`).join("") +
              `</optgroup>`,
          );
        }
      } catch (err) {
        组.push(`<optgroup label="OpenWebUI"><option value="openwebui|">（不可用：${escapeAttr(String(err).slice(0, 40))}）</option></optgroup>`);
      }
    }

    // —— 本地 providers ——
    if ((p.providers ?? []).length > 0) {
      组.push(
        `<optgroup label="本地提供方">` +
          p.providers
            .map((prov) => {
              const 模型 = prov.models?.chat ?? "";
              return `<option value="${escapeAttr(prov.name)}|${escapeAttr(模型)}">${escapeAttr(prov.name)}${模型 ? " / " + escapeAttr(模型) : "（自动）"}</option>`;
            })
            .join("") +
          `</optgroup>`,
      );
    }
  } catch {
    /* 下面统一兜底 */
  }

  框.innerHTML = 组.length > 0 ? 组.join("") : '<option value="">（AI 未配置）</option>';

  // 下拉的 title 兼作状态提示：悬停即可看到 OpenWebUI 是否连通
  try {
    const st = (await window.kugua.request("ai", "ai.openwebui.status", {}, 20000)) as {
      enabled: boolean;
      ok?: boolean;
      模型数?: number;
      错误?: string;
    };
    if (!st.enabled) 框.title = "AI 模型（未配置 OpenWebUI）";
    else if (st.ok) 框.title = `AI 模型（OpenWebUI 已连接，${st.模型数 ?? 0} 个模型）`;
    else 框.title = `AI 模型（OpenWebUI 不可用：${st.错误 ?? "未知错误"}）`;
  } catch {
    框.title = "AI 模型";
  }

  // 恢复当前对话的选择；值不匹配（如模型已被移除）时回落到第一项
  const d = 当前对话();
  if (d) {
    const 目标 = `${d.provider || ""}|${d.model || ""}`;
    框.value = 目标;
    if (框.selectedIndex < 0) {
      框.selectedIndex = 0;
      const [provider, model] = String(框.value).split("|");
      d.provider = provider ?? "";
      d.model = model ?? "";
      保存对话列表();
    }
  }
}

/** 转义 HTML 属性值 */
function escapeAttr(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export async function 与AI对话(文本: string): Promise<void> {
  const d = 当前对话();
  const chatId = d?.id ?? "default";

  // 流式渲染：先落一个空回应，逐块填内容。
  // 为何不先调再显示：本地模型首字可能要几秒，空回应至少能告诉用户「在跑」。
  const 流式ID = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const 块 = 添加独立回应("", "AI（生成中…）");
  const 内容块 = 块.querySelector(".msg-reply-content") as HTMLDivElement | null;
  const 发送者块 = 块.querySelector(".msg-reply-sender") as HTMLDivElement | null;
  let 已收到流 = false;

  // 订阅增量：只处理本次流式ID的事件
  const 取消订阅 = window.kugua.onBus((action: string, params: unknown) => {
    if (action !== "ai.chunk") return;
    const p = (params ?? {}) as {
      流式ID?: string;
      增量?: string;
      累计?: string;
      思考增量?: string;
      思考累计?: string;
      完成?: boolean;
      错误?: string;
      model?: string;
      提供方?: string;
    };
    if (p.流式ID !== 流式ID) return;
    if (p.错误) {
      内容块 && (内容块.textContent = "AI 调用失败：" + p.错误);
      块.classList.add("error");
      return;
    }
    // 推理模型的思考阶段：显示「正在思考…」，不把思考内容当回答
    if (p.思考增量) {
      if (!已收到流 && 内容块) {
        内容块.textContent = "（正在思考…）";
        内容块.style.opacity = "0.6";
      }
      return;
    }
    if (p.增量 && 内容块) {
      已收到流 = true;
      内容块.style.opacity = "";
      内容块.textContent = p.累计 ?? (内容块.textContent ?? "") + p.增量;
      聊天日志.scrollTop = 聊天日志.scrollHeight;
    }
    if (p.完成 && 发送者块) {
      发送者块.textContent = `AI（${p.提供方 ?? ""}${p.model ? "/" + p.model : ""}）`;
    }
  });

  try {
    const r = (await window.kugua.request(
      "ai",
      "ai.chat",
      {
        prompt: 文本,
        chatId,
        provider: d?.provider || undefined,
        model: d?.model || undefined,
        流式: true,
        流式ID,
      },
      300000,
    )) as { reply: string; model: string; 提供方: string };

    // 完成后用最终结果兜底（防止事件丢失导致空白）
    if (内容块) 内容块.textContent = r.reply || 内容块.textContent || "";
    if (发送者块) 发送者块.textContent = `AI（${r.提供方}${r.model ? "/" + r.model : ""}）`;
  } catch (err) {
    if (内容块) 内容块.textContent = "AI 调用失败：" + String(err);
    块.classList.add("error");
  } finally {
    取消订阅();
    // 流式期间未收到任何块（如服务端降级为非流式），不显示「生成中…」
    if (!已收到流 && 发送者块) 发送者块.textContent = "AI";
    聊天日志.scrollTop = 聊天日志.scrollHeight;
  }
}

export interface 智能任务结果 {
  agentId: string;
  只读模式: boolean;
  结束: boolean;
  最终回答: string | null;
  迭代次数: number;
  达到上限: boolean;
  工具数: number;
  /** 实际请求的提供方（null = 未指定，用配置默认值） */
  provider?: string | null;
  /** 实际请求的模型（null = 未指定） */
  model?: string | null;
  messages?: Array<{ role: string; content: string | null; tool_calls?: unknown[] }>;
}

/**
 * 智能任务（agent 工具循环）。
 *
 * 工具循环可能跑多轮，耗时远大于普通对话，因此先落一条「进行中」回应，
 * 完成后就地替换为结果（含工具调用统计）。
 */
export async function 与AI任务(任务: string, 只读 = true): Promise<void> {
  const 标签 = 只读 ? "智能任务（只读）" : "智能任务（可写）";
  const 占位 = 添加独立回应(
    `⏳ 正在执行：${任务}\n（模式：${只读 ? "只读——只能读取/搜索知识库" : "可写——每次写入会请你确认"}）`,
    标签,
  );
  const 内容块 = 占位.querySelector(".msg-reply-content") as HTMLDivElement | null;
  const 设置文本 = (文本: string) => {
    if (内容块) 内容块.textContent = 文本;
    else 占位.textContent = 文本;
  };

  const 进度ID = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // 进度行：实时追加在正文下方，让用户看到「现在在调什么工具」
  const 进度行: string[] = [];
  const 渲染 = (正文: string) => {
    const 进度 = 进度行.length > 0 ? "\n\n" + 进度行.slice(-6).join("\n") : "";
    设置文本(正文 + 进度);
    聊天日志.scrollTop = 聊天日志.scrollHeight;
  };

  const 取消订阅 = window.kugua.onBus((action: string, params: unknown) => {
    if (action !== "agent.progress") return;
    const p = (params ?? {}) as {
      进度ID?: string;
      阶段?: string;
      轮次?: number;
      工具?: string | string[];
      错误?: string;
    };
    if (p.进度ID !== 进度ID) return;
    const 轮 = p.轮次 ? `#${p.轮次} ` : "";
    switch (p.阶段) {
      case "准备":
        进度行.push(`· 可用工具 ${(params as { 工具数?: number }).工具数 ?? 0} 个`);
        break;
      case "思考":
        进度行.push(`· ${轮}思考中…`);
        break;
      case "决定调用":
        进度行.push(`· ${轮}决定调用 ${Array.isArray(p.工具) ? p.工具.join(", ") : p.工具 ?? ""}`);
        break;
      case "执行工具":
        进度行.push(`· ${轮}执行 ${p.工具}`);
        break;
      case "工具完成":
        进度行.push(`· ${轮}${p.工具} 完成`);
        break;
      case "工具失败":
        进度行.push(`· ${轮}${p.工具} 失败：${p.错误 ?? "未知"}`);
        break;
      case "结束":
        break;
    }
    渲染(`⏳ 正在执行：${任务}`);
  });

  try {
    // agentId 复用会话 id，让同一对话里的连续任务共享沙箱（能读到自己上次写的）
    const d = 当前对话();
    const agentId = `ui-${d?.id ?? "default"}`;
    // 模型选择：必须把右上角选的值传下去。不传则 ai 模块用配置默认值，
    // 表现为「界面上选了 A 模型，实际用了 B」（曾导致选免费模型却报付费模型 402）。
    const 模型参数 = {
      ...(d?.provider ? { provider: d.provider } : {}),
      ...(d?.model ? { model: d.model } : {}),
    };
    const r = (await window.kugua.request(
      "agent",
      "agent.run",
      { prompt: 任务, agentId, 只读, 进度ID, ...模型参数 },
      600000,
    )) as 智能任务结果;

    const 工具调用数 = (r.messages ?? []).reduce<number>((n, m) => {
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) return n + m.tool_calls.length;
      return n;
    }, 0);
    const 统计 = `轮次 ${r.迭代次数} · 工具调用 ${工具调用数} · 可用工具 ${r.工具数} · agent ${r.agentId}`;
    // 模型信息：显示实际用的模型，方便一眼看出「是不是我选的那个」
    const 模型行 = r.model ? ` · 模型 ${r.provider ? r.provider + "/" : ""}${r.model}` : "";
    const 正文 = r.结束
      ? r.最终回答 || "（AI 未给出文字回答）"
      : r.达到上限
        ? `⚠️ 达到工具循环上限（${r.迭代次数} 轮）仍未完成。可把任务拆小后重试。\n\n${r.最终回答 ?? ""}`.trim()
        : r.最终回答 || "（任务未正常结束）";

    设置文本(`${正文}\n\n—— ${统计}${模型行}`);
  } catch (err) {
    const 失败文本 = "智能任务失败：" + String(err);
    设置文本(失败文本);
    占位.classList.add("msg-error");
  } finally {
    取消订阅();
  }
}

export function 初始化对话页(): void {
  if (对话已初始化) return;
  对话已初始化 = true;
  对话列表 = 读存储(对话存储键, []);
  项目列表 = 读存储(项目存储键, []);
  if (对话列表.length === 0) 新建对话();
  else 切换对话(对话列表[0].id);
  渲染对话列表();
  void 刷新AI模型选择器();
}

// 对话 persistence：观察 #chat-log 变化并保存到当前对话
export const 对话观察器 = new MutationObserver(() => 保存当前对话DOM());
对话观察器.observe(聊天日志, { childList: true, subtree: true, characterData: true });

document.getElementById("conv-new")?.addEventListener("click", () => 新建对话());
document.getElementById("conv-project-new")?.addEventListener("click", () => 新建项目());
document.getElementById("chat-ai-refresh")?.addEventListener("click", () => {
  void 刷新AI模型选择器();
});

document.getElementById("chat-ai-model")?.addEventListener("change", (e) => {
  const d = 当前对话();
  if (!d) return;
  const [provider, model] = String((e.target as HTMLSelectElement).value).split("|");
  d.provider = provider ?? "";
  d.model = model ?? "";
  保存对话列表();
});


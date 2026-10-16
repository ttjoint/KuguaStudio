/**
 * 指令面板（聊天页左侧）：
 *   - 数据来源：能力注册表（capability.list）+ 本地路由内置指令库；
 *   - 随模块上下线（capability.changed）动态刷新；
 *   - 最近使用的指令排在最上面（localStorage 记忆）；
 *   - 单击：无需参数 → 直接调用；需要参数 → 把前缀填入输入框；
 *   - 双击：设为「持续前缀 / 对话模式」（互斥，仅一个），此后每条输入自动走该指令。
 *
 * 说明：本面板只在聊天页使用（index.html 中位于 #chat-page-view 内）。
 */

import { 指令库, 输入框 } from "./02-chat-core";
import { 添加回应, 添加消息 } from "./03-preview";
import { 处理输入, 尝试能力指令 } from "./04-router";

// ===== 状态 =====

export interface 指令面板项 {
  /** 主指令词（点击/前缀使用的文本） */
  命令: string;
  /** 说明文本 */
  说明: string;
  /** 所属模块（注册表来源时可用） */
  模块?: string;
  /** 是否为「无需参数」指令（单击直接调用） */
  免参: boolean;
  /** 注册表能力名（若有） */
  能力?: string;
}

/** 持续前缀（对话模式）：为空表示未启用 */
export let 持续前缀 = "";
/** 最近使用：命令 -> 最后使用时间戳 */
export const 最近键 = "kugua_recent_cmds_v1";
export const 面板宽度键 = "kugua_cmd_panel_w";
export const 面板折叠键 = "kugua_cmd_panel_collapsed";
let 最近使用: Record<string, number> = {};
let 面板项: 指令面板项[] = [];
let 关键字 = "";

function 读JSON<T>(键: string, 默认: T): T {
  try {
    const s = localStorage.getItem(键);
    return s ? (JSON.parse(s) as T) : 默认;
  } catch {
    return 默认;
  }
}
function 写JSON(键: string, 值: unknown): void {
  try {
    localStorage.setItem(键, JSON.stringify(值));
  } catch {
    /* 忽略 */
  }
}

/** 记录一次使用，用于「最近使用」排序 */
export function 记录使用(命令: string): void {
  if (!命令) return;
  最近使用[命令] = Date.now();
  // 只保留最近 200 条，避免无限增长
  const 项 = Object.entries(最近使用).sort((a, b) => b[1] - a[1]).slice(0, 200);
  最近使用 = Object.fromEntries(项);
  写JSON(最近键, 最近使用);
}

// ===== 数据构建 =====

/** 本地路由内置指令中「无需额外参数」的集合（单击直接调用） */
const 本地免参命令 = new Set<string>([
  "统计", "资源列表", "标签列表", "模块列表", "模块详情",
  "定时任务", "定时任务列表", "任务动作", "监控", "系统状态", "资源监控",
  "今天", "公历", "黄历", "历史上的今天",
  "随机像素", "清空AI", "清空AI记忆", "AI提供方",
]);

/** 从能力声明判断「无需参数」（无 properties 或无 required） */
function 判断免参(参数: unknown): boolean {
  const p = 参数 as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  if (!p || !p.properties || Object.keys(p.properties).length === 0) return true;
  return !p.required || p.required.length === 0;
}

/**
 * 拉取注册表能力，构建面板项；失败时回退到本地指令库。
 */
export async function 加载指令面板数据(): Promise<void> {
  const 表 = new Map<string, 指令面板项>();

  // 1) 本地路由内置指令库（说明已手工维护）；「帮助」不再入列（左侧面板已直接列出全部指令）
  for (const c of 指令库) {
    if (c.命令 === "帮助") continue;
    表.set(c.命令, { 命令: c.命令, 说明: c.说明, 免参: 本地免参命令.has(c.命令) });
  }

  // 2) 注册表能力（提供模块与参数信息，覆盖内置说明）
  try {
    const 列表 = (await window.kugua.request("nigane", "capability.list", { 入口: "GUI" })) as Array<{
      名称: string;
      模块: string;
      标题?: string;
      说明?: string;
      中文指令?: string[];
      参数?: unknown;
    }>;
    for (const 能力 of 列表 ?? []) {
      const 免参 = 判断免参(能力.参数);
      for (const 命令 of 能力.中文指令 ?? []) {
        const 旧 = 表.get(命令);
        表.set(命令, {
          命令,
          说明: 能力.说明 ?? 能力.标题 ?? 旧?.说明 ?? 能力.名称,
          模块: 能力.模块,
          免参,
          能力: 能力.名称,
        });
      }
    }
  } catch (err) {
    console.warn("[webui] 指令面板数据加载失败：", err);
  }

  面板项 = [...表.values()];
  渲染指令面板();
}

// ===== 排序 =====

function 排序后(): 指令面板项[] {
  const 过滤 = 关键字
    ? 面板项.filter((i) => i.命令.includes(关键字) || i.说明.includes(关键字))
    : 面板项;
  return [...过滤].sort((a, b) => {
    const ta = 最近使用[a.命令] ?? 0;
    const tb = 最近使用[b.命令] ?? 0;
    if (ta !== tb) return tb - ta; // 最近使用优先
    return a.命令.localeCompare(b.命令, "zh");
  });
}

// ===== 渲染 =====

export function 渲染指令面板(): void {
  const 容器 = document.getElementById("cmd-panel-list");
  if (!容器) return;
  容器.innerHTML = "";
  const 列表 = 排序后();
  if (列表.length === 0) {
    容器.innerHTML = '<div class="cmd-empty">（无匹配指令）</div>';
    return;
  }
  for (const 项 of 列表) {
    const 行 = document.createElement("div");
    行.className = "cmd-item" + (项.命令 === 持续前缀 ? " active" : "");
    行.dataset.cmd = 项.命令;
    行.title = `${项.命令}\n${项.说明}${项.模块 ? `\n模块：${项.模块}` : ""}\n单击：${项.免参 ? "直接调用" : "填入输入框"}｜双击：设为持续前缀`;

    const 主 = document.createElement("div");
    主.className = "cmd-item-main";
    const 词 = document.createElement("span");
    词.className = "cmd-item-cmd";
    词.textContent = 项.命令;
    主.appendChild(词);
    const 标 = document.createElement("span");
    标.className = "cmd-item-desc";
    标.textContent = 项.说明;
    主.appendChild(标);
    行.appendChild(主);

    if (项.模块) {
      const 模 = document.createElement("span");
      模.className = "cmd-item-mod";
      模.textContent = 项.模块;
      行.appendChild(模);
    }

    行.addEventListener("click", () => 单击指令(项));
    行.addEventListener("dblclick", () => 切换持续前缀(项.命令));
    容器.appendChild(行);
  }
}

// ===== 交互 =====

async function 单击指令(项: 指令面板项): Promise<void> {
  if (持续前缀) return; // 持续前缀激活时不再响应其他指令
  记录使用(项.命令);
  渲染指令面板();
  if (项.免参) {
    await 直接调用(项.命令);
    return;
  }
  输入框.value = 项.命令 + " ";
  输入框.focus();
  const n = 输入框.value.length;
  输入框.selectionStart = 输入框.selectionEnd = n;
  输入框.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 直接调用（无需额外参数）：优先走注册表，其次走本地路由 */
export async function 直接调用(命令: string): Promise<void> {
  添加消息(命令, "user");
  try {
    const 已处理 = await 尝试能力指令(命令);
    if (!已处理) {
      // 注册表未命中：回退到本地路由（如 统计 / 模块列表 等内置指令）
      await 处理输入(命令);
    }
  } catch (err) {
    添加回应(`指令调用失败：${String(err)}`, "指令", true);
  }
}

/** 双击：设置/取消持续前缀（互斥） */
export function 切换持续前缀(命令: string): void {
  持续前缀 = 持续前缀 === 命令 ? "" : 命令;
  记录使用(命令);
  刷新持续前缀提示();
  渲染指令面板();
}

export function 退出持续前缀(): void {
  持续前缀 = "";
  刷新持续前缀提示();
  渲染指令面板();
}

function 刷新持续前缀提示(): void {
  const 条 = document.getElementById("cmd-sticky-bar");
  if (!条) return;
  if (!持续前缀) {
    条.classList.add("hidden");
    条.innerHTML = "";
    输入框.placeholder = "输入指令，点击左侧指令列表可直接调用…（Enter 发送，Ctrl+Enter 换行）";
    return;
  }
  条.classList.remove("hidden");
  条.innerHTML = "";
  const 文 = document.createElement("span");
  文.className = "cmd-sticky-text";
  文.textContent = `🔒 对话模式：所有输入发送给「${持续前缀}」`;
  const 退 = document.createElement("button");
  退.id = "cmd-sticky-exit";
  退.className = "cmd-sticky-exit";
  退.textContent = "退出";
  退.addEventListener("click", 退出持续前缀);
  条.appendChild(文);
  条.appendChild(退);
  输入框.placeholder = `对话模式（${持续前缀}）：输入内容后回车发送…`;
}

/** 供 08-logs 在发送前判定：若处于持续前缀，返回 [命令, 参数文本] */
export function 应用持续前缀(文本: string): { 命令: string; 参数: string } | null {
  if (!持续前缀) return null;
  return { 命令: 持续前缀, 参数: 文本 };
}

// ===== 折叠 / 宽度 =====

function 应用折叠(折叠: boolean): void {
  const 面板 = document.getElementById("cmd-panel");
  if (!面板) return;
  面板.classList.toggle("collapsed", 折叠);
  写JSON(面板折叠键, 折叠);
  渲染指令面板();
}

export function 初始化指令面板(): void {
  最近使用 = 读JSON(最近键, {});
  const 宽度 = 读JSON<number>(面板宽度键, 240);
  const 面板 = document.getElementById("cmd-panel");
  if (面板) 面板.style.width = `${Math.min(Math.max(宽度, 160), 420)}px`;
  应用折叠(读JSON(面板折叠键, false));

  document.getElementById("cmd-panel-toggle")?.addEventListener("click", () => {
    const p = document.getElementById("cmd-panel");
    应用折叠(!p?.classList.contains("collapsed"));
  });
  const 搜索 = document.getElementById("cmd-panel-search") as HTMLInputElement | null;
  搜索?.addEventListener("input", () => {
    关键字 = 搜索.value.trim();
    渲染指令面板();
  });

  // 拖拽调宽
  const 拖条 = document.getElementById("cmd-panel-resize");
  const 面板2 = document.getElementById("cmd-panel");
  拖条?.addEventListener("mousedown", (e) => {
    if (!面板2) return;
    e.preventDefault();
    const 起X = (e as MouseEvent).clientX;
    const 起W = 面板2.getBoundingClientRect().width;
    const 移动 = (ev: MouseEvent): void => {
      const w = Math.min(Math.max(起W + (ev.clientX - 起X), 160), 420);
      面板2.style.width = `${w}px`;
      写JSON(面板宽度键, Math.round(w));
    };
    const 松开 = (): void => {
      document.removeEventListener("mousemove", 移动);
      document.removeEventListener("mouseup", 松开);
    };
    document.addEventListener("mousemove", 移动);
    document.addEventListener("mouseup", 松开);
  });

  void 加载指令面板数据();
  刷新持续前缀提示();
}

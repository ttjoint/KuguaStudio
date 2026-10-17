import { 刷新附件区, 同步能力指令库, 当前附件, 提示过滤列表, 提示选中索引, 设置提示选中索引, 更新指令提示, 渲染指令提示, 聊天日志, 输入框, 隐藏指令提示 } from "./02-chat-core";
import { 筛选聊天消息, 聊天搜索框 } from "./03-preview";
import { 处理输入 } from "./04-router";
import { 刷新本地插件, 刷新模块列表, 刷新统计 } from "./06-shell";
import { 初始化对话页 } from "./10-chat-page";
import { 加载插件页面 } from "./14-plugin-ui";
import { 应用持续前缀, 记录使用 } from "./16-cmd-panel";

// ===== 事件绑定 =====

export function 发送当前输入(): void {
  const 附件批次 = 当前附件.slice();
  当前附件.length = 0;
  刷新附件区();
  let 文本 = 输入框.value;
  // 持续前缀（对话模式）：自动为每一条输入加上前缀
  const 前缀 = 应用持续前缀(文本);
  if (前缀) {
    记录使用(前缀.命令);
    文本 = `${前缀.命令} ${前缀.参数}`.trim();
  }
  void 处理输入(文本, 附件批次);
  输入框.value = "";
  输入框.style.height = "auto";
}

document.getElementById("chat-send")?.addEventListener("click", 发送当前输入);

输入框.addEventListener("input", () => { 更新指令提示(); 自动调整输入框高度(); });
输入框.addEventListener("focus", () => 更新指令提示());
输入框.addEventListener("blur", () => { setTimeout(() => 隐藏指令提示(), 120); });

/** 输入框随内容自动增高（最多约 6 行） */
function 自动调整输入框高度(): void {
  输入框.style.height = "auto";
  输入框.style.height = Math.min(输入框.scrollHeight, 132) + "px";
}

/** 光标是否在内容末尾（允许末尾有换行） */
function 光标在末尾(): boolean {
  const pos = 输入框.selectionStart ?? 输入框.value.length;
  return 输入框.value.slice(pos).trim() === "";
}

/** 在光标处插入换行（无光标信息时追加到末尾） */
function 在光标处换行(): void {
  const 起 = 输入框.selectionStart ?? 输入框.value.length;
  const 止 = 输入框.selectionEnd ?? 起;
  输入框.value = 输入框.value.slice(0, 起) + "\n" + 输入框.value.slice(止);
  const 新位 = 起 + 1;
  输入框.selectionStart = 输入框.selectionEnd = 新位;
  自动调整输入框高度();
  更新指令提示();
}

输入框.addEventListener("keydown", (e) => {
  if (提示过滤列表.length > 0) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      设置提示选中索引((提示选中索引 + 1) % 提示过滤列表.length);
      渲染指令提示();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      设置提示选中索引((提示选中索引 - 1 + 提示过滤列表.length) % 提示过滤列表.length);
      渲染指令提示();
      return;
    }
    // 用 Tab 或 → 选取补全（不再用 Enter）
    if (e.key === "Tab" || e.key === "ArrowRight") {
      e.preventDefault();
      const 选中 = 提示过滤列表[提示选中索引];
      if (选中) {
        输入框.value = 选中;
        隐藏指令提示();
        自动调整输入框高度();
      }
      return;
    }
  }
  if (e.key === "Enter") {
    // Ctrl+Enter（或 Cmd+Enter）总是插入换行
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      在光标处换行();
      return;
    }
    // 光标在末尾：发送；在中间：插入换行
    if (光标在末尾()) {
      e.preventDefault();
      发送当前输入();
      自动调整输入框高度();
    } else {
      e.preventDefault();
      在光标处换行();
    }
  }
});

// ===== 聊天搜索与清除 =====
export const 聊天搜索清除 = document.getElementById("chat-search-clear") as HTMLButtonElement | null;
export function 应用聊天搜索(): void {
  const q = 聊天搜索框?.value.trim() ?? "";
  if (聊天搜索清除) 聊天搜索清除.classList.toggle("hidden", !q);
  聊天日志.querySelectorAll<HTMLElement>(".chat-msg, .chat-notice").forEach((m) => 筛选聊天消息(m));
}
聊天搜索框?.addEventListener("input", 应用聊天搜索);
聊天搜索清除?.addEventListener("click", () => {
  if (聊天搜索框) 聊天搜索框.value = "";
  应用聊天搜索();
});

document.getElementById("refresh-modules")?.addEventListener("click", () => void 刷新模块列表());
document.getElementById("refresh-stats")?.addEventListener("click", () => void 刷新统计());

// ===== Debug 面板 =====

export interface 日志条目 {
  时间: number;
  方向: "发送" | "接收" | "超时";
  类型: string;
  from: string;
  to?: string;
  action?: string;
  id: string;
  echo?: string;
  code?: number;
  message?: string;
  params?: unknown;
  data?: unknown;
}

export const debug日志 = document.getElementById("debug-log") as HTMLDivElement;
export const 日志缓存: 日志条目[] = [];
export const 最大缓存 = 500;

export function 格式化时间(时间戳: number): string {
  const d = new Date(时间戳);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function 日志方向键(方向: string): string {
  return 方向 === "发送" ? "send" : 方向 === "接收" ? "recv" : 方向 === "错误" ? "error" : "timeout";
}
export function 日志条目通过过滤(条目: 日志条目): boolean {
  const 过滤项 = document.getElementById(`filter-${日志方向键(条目.方向)}`) as HTMLInputElement | null;
  return !过滤项 || 过滤项.checked;
}

/** 已入缓存的去重键（同一条消息可能同时被客户端与主控记录） */
const 已见键 = new Set<string>();
function 去重键(条目: 日志条目): string {
  return `${条目.id ?? ""}|${条目.方向}|${条目.类型}|${条目.from}|${条目.to ?? ""}|${条目.action ?? ""}`;
}

/** 把任意值格式化为可读 JSON（过长时截断） */
function 美化值(v: unknown): string {
  if (v === undefined) return "（无）";
  let s: string;
  try {
    s = JSON.stringify(v, null, 2);
  } catch {
    s = String(v);
  }
  if (s === undefined) return "（无）";
  return s.length > 20000 ? s.slice(0, 20000) + "\n…（已截断）" : s;
}

/** 单行概要 */
export function 日志HTML(条目: 日志条目): string {
  const 方向 = 条目.方向;
  const 路由 = 条目.from + (条目.to ? ` → ${条目.to}` : "");
  const 详情 =
    条目.code !== undefined
      ? `[${条目.code}] ${条目.message ?? ""}`
      : 条目.message
        ? 条目.message
        : 条目.echo
          ? `echo=${条目.echo.slice(0, 8)}`
          : "";
  return `<span class="log-time">${格式化时间(条目.时间)}</span><span class="log-dir ${日志方向键(方向)}">${方向}</span><span class="log-type">${条目.类型}</span><span class="log-route">${转义HTML(路由)}</span>${条目.action ? `<span class="log-route">${转义HTML(条目.action)}</span>` : ""}${详情 ? `<span class="log-detail">${转义HTML(详情)}</span>` : ""}<span class="log-caret">&#x25B8;</span>`;
}

/** 展开后的详情面板（调用双方、信封字段与传参） */
function 日志详情HTML(条目: 日志条目): string {
  const 行 = (k: string, v: unknown) =>
    `<div class="log-kv"><span class="log-k">${k}</span><span class="log-v">${转义HTML(v === undefined || v === null || v === "" ? "（无）" : String(v))}</span></div>`;
  const 有参 = 条目.params !== undefined;
  const 有数 = 条目.data !== undefined;
  return `
    <div class="log-detail-panel">
      <div class="log-kv-list">
        ${行("时间", new Date(条目.时间).toLocaleString())}
        ${行("方向", 条目.方向)}
        ${行("调用方（from）", 条目.from)}
        ${行("目标（to）", 条目.to ?? "（广播/未知）")}
        ${行("类型", 条目.类型)}
        ${行("动作（action）", 条目.action ?? "（无）")}
        ${行("消息 id", 条目.id ?? "")}
        ${行("echo（关联请求）", 条目.echo ?? "（无）")}
        ${条目.code !== undefined ? 行("错误码", 条目.code) : ""}
        ${条目.message ? 行("消息", 条目.message) : ""}
      </div>
      ${有参 ? `<div class="log-payload"><div class="log-payload-title">参数（params）</div><pre class="log-json">${转义HTML(美化值(条目.params))}</pre></div>` : ""}
      ${有数 ? `<div class="log-payload"><div class="log-payload-title">返回（data）</div><pre class="log-json">${转义HTML(美化值(条目.data))}</pre></div>` : ""}
      ${!有参 && !有数 ? `<div class="log-payload"><div class="log-payload-empty">本条无参数/返回数据</div></div>` : ""}
    </div>`;
}

/** 构建一条可展开的日志节点 */
function 构建日志节点(条目: 日志条目): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "log-entry clickable";
  div.innerHTML = 日志HTML(条目);
  const 面板 = document.createElement("div");
  面板.className = "log-entry-detail hidden";
  面板.innerHTML = 日志详情HTML(条目);
  div.appendChild(面板);
  div.addEventListener("click", () => {
    const 展开 = 面板.classList.toggle("hidden") === false;
    div.classList.toggle("open", 展开);
  });
  return div;
}

export function 添加日志(条目: 日志条目): void {
  const 键 = 去重键(条目);
  if (已见键.has(键)) return;
  已见键.add(键);
  if (已见键.size > 最大缓存 * 2) {
    // 简单回收：清空重建（与缓存同步）
    已见键.clear();
    for (const e of 日志缓存) 已见键.add(去重键(e));
  }
  日志缓存.push(条目);
  if (日志缓存.length > 最大缓存) 日志缓存.shift();
  if (!日志条目通过过滤(条目)) return;
  const div = 构建日志节点(条目);
  debug日志.appendChild(div);
  debug日志.scrollTop = debug日志.scrollHeight;
  while (debug日志.children.length > 最大缓存) debug日志.removeChild(debug日志.firstChild!);
}

export function 重新渲染日志(): void {
  debug日志.innerHTML = "";
  for (const 条目 of 日志缓存) {
    if (!日志条目通过过滤(条目)) continue;
    debug日志.appendChild(构建日志节点(条目));
  }
  debug日志.scrollTop = debug日志.scrollHeight;
}

document.getElementById("debug-clear")?.addEventListener("click", () => {
  日志缓存.length = 0;
  已见键.clear();
  debug日志.innerHTML = "";
  系统日志缓存 = [];
  渲染系统日志();
});

document.querySelectorAll(".debug-filter input").forEach((cb) => {
  cb.addEventListener("change", 重新渲染日志);
});

// ===== 系统日志（主控 log.tail：各模块/插件调用细节与报错）=====
export let 系统日志缓存: Array<{ 时间: number; 模块: string; 级别: string; 消息: string }> = [];

export function 转义HTML(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

export function 渲染系统日志(): void {
  const 容器 = document.getElementById("syslog-list");
  if (!容器) return;
  容器.innerHTML = 系统日志缓存
    .map(
      (e) =>
        `<div class="log-entry syslog-entry"><span class="log-time">${格式化时间(e.时间)}</span><span class="log-dir ${e.级别 === "error" ? "error" : "recv"}">${e.级别}</span><span class="log-route">${转义HTML(e.模块)}</span><span class="log-detail">${转义HTML(e.消息 ?? "")}</span></div>`,
    )
    .join("");
  容器.scrollTop = 容器.scrollHeight;
}

export async function 刷新系统日志(): Promise<void> {
  try {
    const r = (await window.kugua.request("nigane", "log.tail", { limit: 300 })) as Array<{ 时间: number; 模块: string; 级别: string; 消息: string }>;
    系统日志缓存 = r ?? [];
    渲染系统日志();
  } catch {
    /* 主控未就绪时忽略 */
  }
}

document.getElementById("syslog-refresh")?.addEventListener("click", () => void 刷新系统日志());

// 监听主进程转发的通信日志
window.kugua.onLog((entry: unknown) => {
  添加日志(entry as 日志条目);
});

// 客户端连接成功后刷新侧边栏数据
// 注：知识库浏览器的 `Explorer.init()` 不在这里调用。
// 本文件属于「日志/侧边栏」，而 Explorer 又反过来依赖日志模块的纯工具函数，
// 两边互相 import 会形成循环依赖，打包后拿到的 Explorer 绑定可能尚未就绪。
// 故把 Explorer.init() 交给 09-init.ts 统一编排。
window.kugua.onReady(() => {
  void 刷新模块列表();
  void 刷新统计();
  void 刷新本地插件();
  void 同步能力指令库();
  void 加载插件页面();
  初始化对话页();
});


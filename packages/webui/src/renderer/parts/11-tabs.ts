import { 聊天日志 } from "./02-chat-core";
import { 刷新插件市场, 刷新本地插件, 刷新模块列表, 刷新统计 } from "./06-shell";
import { 刷新系统日志 } from "./08-logs";
import { 初始化对话页 } from "./10-chat-page";
import { 刷新作业列表 } from "./12-jobs";
import { 初始化工具页 } from "./13-tools";

// ===== 顶栏：知识库 / 作业 / 插件 / 设置 四视图切换 =====
export const 知识库视图 = document.getElementById("explorer-area") as HTMLElement;
export const 作业视图El = document.getElementById("jobs-view") as HTMLElement;
export const 插件视图El = document.getElementById("plugins-view") as HTMLElement;
export const 设置视图El = document.getElementById("settings-view") as HTMLElement;
export const 工具视图El = document.getElementById("tools-view") as HTMLElement;
export const 对话页视图El = document.getElementById("chat-page-view") as HTMLElement;
export const 日志视图El = document.getElementById("logs-view") as HTMLElement;
export const 视图映射: Record<string, { 视图: HTMLElement; 激活时?: () => void }> = {
  "tab-chat": {
    视图: 对话页视图El,
    激活时: () => {
      初始化对话页();
      聊天日志.scrollTop = 聊天日志.scrollHeight;
    },
  },
  "tab-kb": { 视图: 知识库视图 },
  "tab-jobs": {
    视图: 作业视图El,
    激活时: () => void 刷新作业列表(),
  },
  "tab-plugins": {
    视图: 插件视图El,
    激活时: async () => {
      await Promise.all([刷新模块列表(), 刷新统计(), 刷新本地插件()]);
      void 刷新插件市场();
    },
  },
  "tab-tools": {
    视图: 工具视图El,
    激活时: () => void 初始化工具页(),
  },
  "tab-logs": {
    视图: 日志视图El,
    激活时: () => void 刷新系统日志(),
  },
  "tab-settings": { 视图: 设置视图El },
};
export function 切换视图(tabId: string): void {
  for (const id of Object.keys(视图映射)) {
    const cfg = 视图映射[id];
    cfg.视图.classList.toggle("hidden", id !== tabId);
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) btn.classList.toggle("active", id === tabId);
  }
  const cfg = 视图映射[tabId];
  if (cfg?. 激活时) cfg.激活时();
}
document.getElementById("tab-kb")?.addEventListener("click", () => 切换视图("tab-kb"));
document.getElementById("tab-jobs")?.addEventListener("click", () => 切换视图("tab-jobs"));
document.getElementById("tab-plugins")?.addEventListener("click", () => 切换视图("tab-plugins"));
document.getElementById("tab-settings")?.addEventListener("click", () => 切换视图("tab-settings"));
document.getElementById("tab-tools")?.addEventListener("click", () => 切换视图("tab-tools"));
document.getElementById("tab-chat")?.addEventListener("click", () => 切换视图("tab-chat"));
document.getElementById("tab-logs")?.addEventListener("click", () => 切换视图("tab-logs"));


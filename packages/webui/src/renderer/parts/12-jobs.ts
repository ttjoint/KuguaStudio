import { 添加消息 } from "./03-preview";

// ===== 作业（长任务）面板（阶段 4）=====
export interface 作业记录UI {
  id: string;
  标题: string;
  命令: string;
  参数: string[];
  状态: "running" | "done" | "failed" | "cancelled" | "timeout";
  退出码: number | null;
  启动时间: number;
  耗时毫秒: number | null;
}
export let 当前作业ID: string | null = null;
export let 作业面板定时: number | null = null;

export function 作业状态文本(s: 作业记录UI["状态"]): string {
  return { running: "运行中", done: "完成", failed: "失败", cancelled: "已取消", timeout: "超时" }[s] ?? s;
}
export function 格式化耗时(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

export async function 刷新作业列表(): Promise<void> {
  const 列表 = document.getElementById("jobs-list");
  if (!列表) return;
  try {
    const 作业 = (await window.kugua.request("job", "job.list", { limit: 50 })) as 作业记录UI[];
    列表.innerHTML = "";
    if (!作业 || 作业.length === 0) {
      列表.innerHTML = '<li class="oc-module-item" style="opacity:0.6">（暂无作业）</li>';
      return;
    }
    for (const j of 作业) {
      const li = document.createElement("li");
      li.className = "oc-module-item job-item";
      if (当前作业ID === j.id) li.style.outline = "1px solid rgba(120,160,255,0.6)";
      const 状态 = document.createElement("span");
      状态.className = `job-status ${j.状态}`;
      状态.textContent = 作业状态文本(j.状态);
      li.appendChild(状态);
      const 标题 = document.createElement("span");
      标题.className = "job-title";
      标题.textContent = j.标题 || j.命令;
      标题.title = `${j.命令} ${(j.参数 || []).join(" ")}`;
      li.appendChild(标题);
      const 元 = document.createElement("span");
      元.className = "job-meta";
      元.textContent = `${new Date(j.启动时间).toLocaleTimeString()} ${格式化耗时(j.耗时毫秒)}`;
      li.appendChild(元);
      const 日志按钮 = document.createElement("button");
      日志按钮.className = "tb-btn small";
      日志按钮.textContent = "日志";
      日志按钮.addEventListener("click", (e) => {
        e.stopPropagation();
        void 查看作业日志(j.id);
      });
      li.appendChild(日志按钮);
      if (j.状态 === "running") {
        const 取消 = document.createElement("button");
        取消.className = "tb-btn small";
        取消.textContent = "取消";
        取消.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            await window.kugua.request("job", "job.cancel", { id: j.id });
          } catch {
            /* 忽略 */
          }
          void 刷新作业列表();
        });
        li.appendChild(取消);
      } else {
        const 删 = document.createElement("button");
        删.className = "tb-btn small";
        删.textContent = "删除";
        删.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!window.confirm("删除该作业记录与日志？")) return;
          try {
            await window.kugua.request("job", "job.remove", { id: j.id });
          } catch {
            /* 忽略 */
          }
          if (当前作业ID === j.id) 当前作业ID = null;
          void 刷新作业列表();
        });
        li.appendChild(删);
      }
      li.addEventListener("click", () => void 查看作业日志(j.id));
      列表.appendChild(li);
    }
  } catch (err) {
    列表.innerHTML = `<li class="oc-module-item" style="color:#e66">作业列表获取失败：${String(err)}</li>`;
  }
}

export async function 查看作业日志(id: string): Promise<void> {
  当前作业ID = id;
  const 框 = document.getElementById("jobs-log");
  const 标题 = document.getElementById("jobs-log-title");
  if (标题) 标题.textContent = `日志 · ${id}`;
  if (框) 框.textContent = "加载中…";
  try {
    const 行 = (await window.kugua.request("job", "job.logs", { id, 行数: 500 })) as Array<{
      时间: number;
      流: string;
      行: string;
    }>;
    if (框) {
      框.textContent = (行 ?? []).map((l) => `[${l.流}] ${l.行}`).join("\n") || "（无输出）";
      框.scrollTop = 框.scrollHeight;
    }
    void 刷新作业列表();
  } catch (err) {
    if (框) 框.textContent = `日志获取失败：${String(err)}`;
  }
}

export async function 从面板启动作业(): Promise<void> {
  const 命令 = (document.getElementById("job-cmd") as HTMLInputElement | null)?.value.trim();
  if (!命令) {
    添加消息("请输入要执行的命令", "error");
    return;
  }
  const 参数 = (document.getElementById("job-args") as HTMLInputElement | null)?.value.trim().split(/\s+/).filter(Boolean);
  const 工作目录 = (document.getElementById("job-cwd") as HTMLInputElement | null)?.value.trim() || undefined;
  const 标题 = (document.getElementById("job-title") as HTMLInputElement | null)?.value.trim() || undefined;
  try {
    const r = (await window.kugua.request("job", "job.start", { 命令, 参数, 工作目录, 标题 })) as 作业记录UI;
    添加消息(`已启动作业 ${r.id}：${r.标题}`, "system", "作业");
    当前作业ID = r.id;
    void 刷新作业列表();
    void 查看作业日志(r.id);
  } catch (err) {
    添加消息("启动作业失败：" + String(err), "error");
  }
}

document.getElementById("job-start")?.addEventListener("click", () => void 从面板启动作业());
document.getElementById("jobs-refresh")?.addEventListener("click", () => void 刷新作业列表());
document.getElementById("jobs-log-refresh")?.addEventListener("click", () => {
  if (当前作业ID) void 查看作业日志(当前作业ID);
});
// 作业视图激活时每 3 秒自动刷新列表与日志
if (作业面板定时 == null) {
  作业面板定时 = window.setInterval(() => {
    const 视图 = document.getElementById("jobs-view");
    if (视图 && !视图.classList.contains("hidden")) {
      void 刷新作业列表();
      if (当前作业ID) void 查看作业日志(当前作业ID);
    }
  }, 3000);
}


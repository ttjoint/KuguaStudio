// ===== AI 生成内容（aigc）查看/编辑对话框 =====
// aigc 节点正文存 aigc_contents 表（不落盘），用户视角通过 mkg.aigc.get/list/delete 访问。
import { Explorer } from "./07-explorer";
import { 添加消息 } from "./03-preview";
import { 显示确认对话框 } from "./06-shell";

export interface AIGC内容 {
  id: number;
  agentId: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

/** 当前编辑的 aigc（null = 只读查看） */
let 当前AIGC: AIGC内容 | null = null;

function 确保对话框(): {
  层: HTMLDivElement;
  标题: HTMLDivElement;
  元信息: HTMLDivElement;
  正文: HTMLTextAreaElement;
  保存: HTMLButtonElement;
  删除: HTMLButtonElement;
  关闭: HTMLButtonElement;
} {
  let 层 = document.getElementById("aigc-dialog") as HTMLDivElement | null;
  if (层) {
    return {
      层,
      标题: document.getElementById("aigc-title") as HTMLDivElement,
      元信息: document.getElementById("aigc-meta") as HTMLDivElement,
      正文: document.getElementById("aigc-content") as HTMLTextAreaElement,
      保存: document.getElementById("aigc-save") as HTMLButtonElement,
      删除: document.getElementById("aigc-delete") as HTMLButtonElement,
      关闭: document.getElementById("aigc-close") as HTMLButtonElement,
    };
  }

  层 = document.createElement("div");
  层.id = "aigc-dialog";
  层.className = "dialog-backdrop hidden";
  层.innerHTML = `
    <div class="dialog" style="width:min(760px,92vw)">
      <div class="dialog-header">
        <div id="aigc-title" style="font-weight:600">AI 生成内容</div>
        <button id="aigc-close" class="icon-btn" title="关闭">✕</button>
      </div>
      <div id="aigc-meta" class="hint" style="padding:0.35rem 0.75rem;font-size:0.75rem;opacity:0.75"></div>
      <div class="dialog-body" style="display:flex;flex-direction:column;gap:0.5rem">
        <textarea id="aigc-content" rows="16" style="width:100%;resize:vertical;font-family:inherit;line-height:1.6"></textarea>
        <div class="hint" style="font-size:0.72rem;opacity:0.7">
          AI 生成内容保存在知识库数据库内（不落盘）。可直接编辑后保存。</div>
      </div>
      <div class="dialog-footer">
        <button id="aigc-delete" class="btn danger">删除</button>
        <span style="flex:1"></span>
        <button id="aigc-close2" class="btn">关闭</button>
        <button id="aigc-save" class="btn primary">保存</button>
      </div>
    </div>`;
  document.body.appendChild(层);

  const 关闭按钮 = 层.querySelector("#aigc-close2") as HTMLButtonElement;
  const 关闭 = 层.querySelector("#aigc-close") as HTMLButtonElement;
  const 关闭两者 = () => 层!.classList.add("hidden");
  关闭.addEventListener("click", 关闭两者);
  关闭按钮.addEventListener("click", 关闭两者);
  层.addEventListener("click", (e) => {
    if (e.target === 层) 关闭两者();
  });

  return {
    层,
    标题: 层.querySelector("#aigc-title") as HTMLDivElement,
    元信息: 层.querySelector("#aigc-meta") as HTMLDivElement,
    正文: 层.querySelector("#aigc-content") as HTMLTextAreaElement,
    保存: 层.querySelector("#aigc-save") as HTMLButtonElement,
    删除: 层.querySelector("#aigc-delete") as HTMLButtonElement,
    关闭,
  };
}

function 格式化时间(秒: number): string {
  if (!秒) return "—";
  const d = new Date(秒 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 打开 aigc 查看/编辑对话框（供统一浏览双击调用） */
export async function 打开AIGC查看(item: Explorer.内容条目): Promise<void> {
  let 内容: AIGC内容 | null = null;
  try {
    内容 = (await window.kugua.request("mkg", "mkg.aigc.get", { id: item.id })) as AIGC内容 | null;
  } catch (err) {
    添加消息("读取 AI 生成内容失败：" + String(err), "error");
    return;
  }
  if (!内容) {
    添加消息("AI 生成内容不存在或已删除", "error");
    return;
  }
  当前AIGC = 内容;
  const ui = 确保对话框();
  ui.标题.textContent = 内容.title || "（无标题）";
  ui.元信息.textContent = `id ${内容.id} · 来源 ${内容.agentId || "未知"} · 创建 ${格式化时间(内容.createdAt)} · 更新 ${格式化时间(内容.updatedAt)}`;
  ui.正文.value = 内容.content;
  ui.正文.readOnly = false;

  ui.保存.onclick = async () => {
    if (!当前AIGC) return;
    try {
      await window.kugua.request("mkg", "mkg.ai.write", {
        agentId: 当前AIGC.agentId || "user-edit",
        id: 当前AIGC.id,
        content: ui.正文.value,
      });
      添加消息("已保存 AI 生成内容：" + (当前AIGC.title || 当前AIGC.id), "system");
      ui.层.classList.add("hidden");
      await Explorer.刷新();
    } catch (err) {
      添加消息("保存失败：" + String(err), "error");
    }
  };

  ui.删除.onclick = () => {
    if (!当前AIGC) return;
    const 目标 = 当前AIGC;
    显示确认对话框(`确定删除「${目标.title || 目标.id}」？此操作不可恢复。`, async (确认) => {
      if (!确认) return;
      try {
        await window.kugua.request("mkg", "mkg.aigc.delete", { id: 目标.id });
        添加消息("已删除 AI 生成内容：" + (目标.title || 目标.id), "system");
        当前AIGC = null;
        ui.层.classList.add("hidden");
        await Explorer.刷新();
      } catch (err) {
        添加消息("删除失败：" + String(err), "error");
      }
    });
  };

  ui.层.classList.remove("hidden");
}

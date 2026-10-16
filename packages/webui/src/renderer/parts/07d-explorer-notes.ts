// ===== 点子（笔记）=====
// 由 07-explorer.ts 拆分而来。
// 说明：点子已并入统一资料库（仅作类型筛选），故不再有独立的列表/详情面板；
//       本文件只保留「新建/编辑对话框」与其事件绑定，以及供统一列表双击调用的入口。
import { Explorer } from "./07-explorer";
import { 笔记 } from "./01-types";
import { 添加消息 } from "./03-preview";

// ---- 模块状态 ----
let 笔记编辑标签ID = new Set<number>();
let 笔记编辑目标: 笔记 | null = null;

/** 刷新统一资料库内容流（点子作为类型筛选条目，无需单独列表）。 */
export async function 加载笔记(): Promise<void> {
  await Explorer.加载所有内容().catch(() => undefined);
}

/** 供统一资料库双击时调用：按内容条目打开点子编辑对话框 */
export function 打开点子编辑(item: Explorer.内容条目): void {
  笔记编辑目标 = {
    id: item.id,
    title: item.name,
    content: item.content,
    tagIds: item.tagIds,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  打开笔记对话框(true);
}

function 打开笔记对话框(编辑: boolean): void {
  (document.getElementById("note-dialog-title") as HTMLDivElement).textContent = 编辑 ? "编辑点子" : "新建点子";
  const titleEl = document.getElementById("note-title") as HTMLInputElement;
  const contentEl = document.getElementById("note-content") as HTMLTextAreaElement;
  if (编辑 && 笔记编辑目标) {
    titleEl.value = 笔记编辑目标.title;
    contentEl.value = 笔记编辑目标.content;
    笔记编辑标签ID.clear();
    for (const tid of 笔记编辑目标.tagIds) 笔记编辑标签ID.add(tid);
  } else {
    笔记编辑目标 = null;
    titleEl.value = "";
    contentEl.value = "";
    笔记编辑标签ID.clear();
  }
  (document.getElementById("note-new-tag-path") as HTMLInputElement).value = "";
  渲染笔记对话框标签();
  Explorer.渲染可勾选标签树(Explorer.标签树, {
    containerId: "note-tag-tree",
    选中的标签ID: 笔记编辑标签ID,
    onToggle: () => 渲染笔记对话框标签(),
  });
  document.getElementById("note-dialog")?.classList.remove("hidden");
}

function 渲染笔记对话框标签(): void {
  const tagsEl = document.getElementById("note-tag-chips") as HTMLDivElement;
  if (!tagsEl) return;
  tagsEl.innerHTML = "";
  if (笔记编辑标签ID.size === 0) {
    tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(未选择标签，从下方标签树勾选)</span>';
    return;
  }
  笔记编辑标签ID.forEach((id) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = Explorer.标签ID转名称(id);
    const x = document.createElement("span");
    x.className = "tc-remove";
    x.textContent = "×";
    x.title = "移除";
    x.addEventListener("click", () => {
      笔记编辑标签ID.delete(id);
      渲染笔记对话框标签();
      Explorer.渲染可勾选标签树(Explorer.标签树, { containerId: "note-tag-tree", 选中的标签ID: 笔记编辑标签ID, onToggle: () => 渲染笔记对话框标签() });
    });
    chip.appendChild(x);
    tagsEl.appendChild(chip);
  });
}

async function 保存笔记(): Promise<void> {
  const title = (document.getElementById("note-title") as HTMLInputElement).value.trim();
  const content = (document.getElementById("note-content") as HTMLTextAreaElement).value;
  const tagIds = Array.from(笔记编辑标签ID);
  try {
    if (笔记编辑目标) {
      await window.kugua.request("mkg", "mkg.note.update", { id: 笔记编辑目标.id, patch: { title: title || "未命名", content, tagIds } });
      添加消息("已更新点子", "system");
    } else {
      await window.kugua.request("mkg", "mkg.note.create", { title: title || "未命名", content, tagIds });
      添加消息("已新建点子", "system");
    }
    document.getElementById("note-dialog")?.classList.add("hidden");
    await 加载笔记();
  } catch (err) {
    添加消息("保存点子失败：" + String(err), "error");
  }
}

async function 新建笔记标签(): Promise<void> {
  const input = document.getElementById("note-new-tag-path") as HTMLInputElement;
  const p = input.value.trim();
  if (!p) { 添加消息("请输入标签路径", "error"); return; }
  try {
    await window.kugua.request("mkg", "mkg.tag.createTree", { names: p.split("/").map((s) => s.trim()).filter(Boolean) });
    添加消息("已创建标签：" + p, "system");
    input.value = "";
    await Explorer.加载标签树();
    Explorer.渲染可勾选标签树(Explorer.标签树, { containerId: "note-tag-tree", 选中的标签ID: 笔记编辑标签ID, onToggle: () => 渲染笔记对话框标签() });
  } catch (err) {
    添加消息("创建标签失败：" + String(err), "error");
  }
}

/** 绑定事件（由 07-explorer 的 init 调用） */
export function 绑定笔记事件(): void {
  document.getElementById("ex-note-add")?.addEventListener("click", () => 打开笔记对话框(false));
  document.getElementById("note-cancel")?.addEventListener("click", () => document.getElementById("note-dialog")?.classList.add("hidden"));
  document.getElementById("note-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("note-dialog")?.classList.add("hidden"));
  document.getElementById("note-save")?.addEventListener("click", () => void 保存笔记());
  document.getElementById("note-btn-create-tag")?.addEventListener("click", () => void 新建笔记标签());
}

// ===== 点子视图（笔记）=====
// 由 07-explorer.ts 拆分而来。
import { Explorer } from "./07-explorer";
import { 笔记 } from "./01-types";
import { 添加消息 } from "./03-preview";

// ---- 模块状态 ----
let 所有笔记: 笔记[] = [];
let 选中笔记: 笔记 | null = null;
let 笔记搜索关键词 = "";
let 笔记编辑标签ID = new Set<number>();
let 笔记编辑目标: 笔记 | null = null;

// ===== 点子视图 =====
export async function 加载笔记(): Promise<void> {
  try {
    所有笔记 = (await window.kugua.request("mkg", "mkg.note.list", {})) as 笔记[];
  } catch {
    所有笔记 = [];
  }
  渲染笔记列表();
}

function 筛选后的笔记(): 笔记[] {
  const kw = 笔记搜索关键词.trim().toLowerCase();
  if (!kw) return 所有笔记;
  return 所有笔记.filter((n) => n.title.toLowerCase().includes(kw) || n.content.toLowerCase().includes(kw));
}

function 渲染笔记列表(): void {
  const list = document.getElementById("ex-note-list") as HTMLDivElement;
  if (!list) return;
  const notes = 筛选后的笔记();
  list.innerHTML = "";
  if (notes.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;padding:1rem;text-align:center">还没有点子，点击右上角「新建点子」开始记录。</div>';
    return;
  }
  for (const note of notes) {
    const tile = document.createElement("div");
    tile.className = "ex-note-tile";
    if (选中笔记?.id === note.id) tile.classList.add("selected");
    const title = document.createElement("div");
    title.className = "en-title";
    title.textContent = note.title || "(无标题)";
    tile.appendChild(title);
    const preview = document.createElement("div");
    preview.className = "en-preview";
    preview.textContent = note.content || "";
    tile.appendChild(preview);
    if (note.tagIds && note.tagIds.length > 0) {
      const tagWrap = document.createElement("div");
      tagWrap.className = "en-tags";
      for (const tid of note.tagIds) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = Explorer.标签ID转名称(tid);
        tagWrap.appendChild(chip);
      }
      tile.appendChild(tagWrap);
    }
    tile.addEventListener("click", (e) => {
      e.stopPropagation();
      选中笔记 = note;
      渲染笔记列表();
      渲染笔记详情();
    });
    list.appendChild(tile);
  }
}

function 渲染笔记详情(): void {
  const panel = document.getElementById("ex-note-detail") as HTMLDivElement;
  if (!panel) return;
  if (!选中笔记) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  (document.getElementById("ex-note-detail-title") as HTMLDivElement).textContent = 选中笔记.title || "(无标题)";
  (document.getElementById("ex-note-detail-time") as HTMLDivElement).textContent = "创建 " + Explorer.格式化笔记时间(选中笔记.createdAt) + " · 更新 " + Explorer.格式化笔记时间(选中笔记.updatedAt);
  (document.getElementById("ex-note-detail-content") as HTMLDivElement).textContent = 选中笔记.content || "(空内容)";
  const tagsEl = document.getElementById("ex-note-detail-tags") as HTMLDivElement;
  tagsEl.innerHTML = "";
  if (选中笔记.tagIds && 选中笔记.tagIds.length > 0) {
    for (const tid of 选中笔记.tagIds) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = Explorer.标签ID转名称(tid);
      tagsEl.appendChild(chip);
    }
  } else {
    tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(无标签)</span>';
  }
}

function 打开笔记对话框(编辑: boolean): void {
  (document.getElementById("note-dialog-title") as HTMLDivElement).textContent = 编辑 ? "编辑点子" : "新建点子";
  const titleEl = document.getElementById("note-title") as HTMLInputElement;
  const contentEl = document.getElementById("note-content") as HTMLTextAreaElement;
  if (编辑 && 选中笔记) {
    笔记编辑目标 = 选中笔记;
    titleEl.value = 选中笔记.title;
    contentEl.value = 选中笔记.content;
    笔记编辑标签ID.clear();
    for (const tid of 选中笔记.tagIds) 笔记编辑标签ID.add(tid);
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

async function 删除笔记(): Promise<void> {
  if (!选中笔记) return;
  if (!window.confirm("确定删除这个点子吗？")) return;
  try {
    await window.kugua.request("mkg", "mkg.note.delete", { id: 选中笔记.id });
    选中笔记 = null;
    添加消息("已删除点子", "system");
    await 加载笔记();
    (document.getElementById("ex-note-detail") as HTMLDivElement)?.classList.add("hidden");
  } catch (err) {
    添加消息("删除点子失败：" + String(err), "error");
  }
}

async function 新建笔记标签(): Promise<void> {
  const input = document.getElementById("note-new-tag-path") as HTMLInputElement;
  const p = input.value.trim();
  if (!p) { 添加消息("请输入标签路径", "error"); return; }
  try {
    await window.kugua.request("mkg", "mkg.tag.createTree", { path: p });
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
  document.getElementById("ex-note-refresh")?.addEventListener("click", () => void 加载笔记());
  document.getElementById("ex-note-edit")?.addEventListener("click", () => 打开笔记对话框(true));
  document.getElementById("ex-note-delete")?.addEventListener("click", () => void 删除笔记());
  const noteSearch = document.getElementById("ex-note-search") as HTMLInputElement;
  noteSearch?.addEventListener("input", () => {
    笔记搜索关键词 = noteSearch.value;
    渲染笔记列表();
  });

  document.getElementById("note-cancel")?.addEventListener("click", () => document.getElementById("note-dialog")?.classList.add("hidden"));
  document.getElementById("note-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("note-dialog")?.classList.add("hidden"));
  document.getElementById("note-save")?.addEventListener("click", () => void 保存笔记());
  document.getElementById("note-btn-create-tag")?.addEventListener("click", () => void 新建笔记标签());
}

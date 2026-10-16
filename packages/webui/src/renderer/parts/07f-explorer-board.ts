// ===== 看板视图 =====
// 由 07-explorer.ts 拆分而来。
import { Explorer } from "./07-explorer";
import { 卡片, 看板列 } from "./01-types";
import { 添加消息 } from "./03-preview";

// ---- 模块状态 ----
let 所有列: 看板列[] = [];
let 所有卡片: 卡片[] = [];
let 编辑中的列: 看板列 | null = null;
let 编辑中的卡片: 卡片 | null = null;
let 卡片编辑标签ID = new Set<number>();

// ===== 看板视图 =====
export async function 加载看板(): Promise<void> {
  await Promise.all([加载列(), 加载卡片()]);
  渲染看板();
}

async function 加载列(): Promise<void> {
  try {
    所有列 = (await window.kugua.request("mkg", "mkg.card.columnList", {})) as 看板列[];
  } catch {
    所有列 = [];
  }
}

async function 加载卡片(): Promise<void> {
  try {
    所有卡片 = (await window.kugua.request("mkg", "mkg.card.list", {})) as 卡片[];
  } catch {
    所有卡片 = [];
  }
}

function 渲染看板(): void {
  const board = document.getElementById("ex-board") as HTMLDivElement;
  if (!board) return;
  board.innerHTML = "";
  if (所有列.length === 0) {
    board.innerHTML = '<div class="ex-board-empty">还没有列，点击「新建列」创建看板。</div>';
    return;
  }
  for (const col of 所有列) {
    渲染列(board, col, 所有卡片.filter((c) => c.columnId === col.id));
  }
  const 未分列 = 所有卡片.filter((c) => c.columnId === null);
  if (未分列.length > 0) {
    渲染列(board, { id: -1, name: "未分列", sort: Number.MAX_SAFE_INTEGER, createdAt: 0 }, 未分列);
  }
}

function 渲染列(board: HTMLDivElement, col: 看板列, cards: 卡片[]): void {
  const colDiv = document.createElement("div");
  colDiv.className = "ex-board-col";
  colDiv.dataset.colId = String(col.id);

  const head = document.createElement("div");
  head.className = "ex-board-col-head";
  const name = document.createElement("span");
  name.className = "ex-board-col-name";
  name.textContent = col.name;
  const count = document.createElement("span");
  count.className = "ex-board-col-count";
  count.textContent = String(cards.length);
  head.appendChild(name);
  head.appendChild(count);
  if (col.id >= 0) {
    const del = document.createElement("button");
    del.className = "ex-board-col-del";
    del.textContent = "×";
    del.title = "删除列";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      void 删除列(col);
    });
    head.appendChild(del);
  }
  colDiv.appendChild(head);

  const cardsDiv = document.createElement("div");
  cardsDiv.className = "ex-board-col-cards";
  for (const card of cards) {
    const cardEl = document.createElement("div");
    cardEl.className = "ex-board-card";
    cardEl.draggable = true;
    cardEl.dataset.cardId = String(card.id);
    const t = document.createElement("div");
    t.className = "ebc-title";
    t.textContent = card.title || "(无标题)";
    cardEl.appendChild(t);
    if (card.content) {
      const p = document.createElement("div");
      p.className = "ebc-preview";
      p.textContent = card.content;
      cardEl.appendChild(p);
    }
    if (card.tagIds && card.tagIds.length > 0) {
      const tw = document.createElement("div");
      tw.className = "ebc-tags";
      for (const tid of card.tagIds) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = Explorer.标签ID转名称(tid);
        tw.appendChild(chip);
      }
      cardEl.appendChild(tw);
    }
    cardEl.addEventListener("click", (e) => {
      e.stopPropagation();
      编辑中的卡片 = card;
      打开卡片对话框(true);
    });
    cardEl.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", String(card.id));
    });
    cardsDiv.appendChild(cardEl);
  }
  const addBtn = document.createElement("button");
  addBtn.className = "ex-board-add-card";
  addBtn.textContent = "+ 添加卡片";
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    打开卡片对话框(false, col.id >= 0 ? col.id : null);
  });
  cardsDiv.appendChild(addBtn);

  cardsDiv.addEventListener("dragover", (e) => e.preventDefault());
  cardsDiv.addEventListener("drop", (e) => {
    e.preventDefault();
    const data = e.dataTransfer?.getData("text/plain");
    if (!data) return;
    const cardId = Number(data);
    const card = 所有卡片.find((c) => c.id === cardId);
    if (!card) return;
    const targetColumnId = col.id >= 0 ? col.id : null;
    if (card.columnId === targetColumnId) return;
    void (async () => {
      try {
        await window.kugua.request("mkg", "mkg.card.update", { id: card.id, patch: { columnId: targetColumnId } });
        await 加载看板();
      } catch (err) {
        添加消息("移动卡片失败：" + String(err), "error");
      }
    })();
  });

  colDiv.appendChild(cardsDiv);
  board.appendChild(colDiv);
}

function 打开列对话框(编辑: boolean): void {
  (document.getElementById("column-dialog-title") as HTMLDivElement).textContent = 编辑 ? "重命名列" : "新建列";
  const nameEl = document.getElementById("column-name") as HTMLInputElement;
  if (编辑 && 编辑中的列) {
    nameEl.value = 编辑中的列.name;
  } else {
    编辑中的列 = null;
    nameEl.value = "";
  }
  document.getElementById("column-dialog")?.classList.remove("hidden");
  nameEl.focus();
}

async function 保存列(): Promise<void> {
  const name = (document.getElementById("column-name") as HTMLInputElement).value.trim();
  if (!name) { 添加消息("请输入列名", "error"); return; }
  try {
    if (编辑中的列) {
      await window.kugua.request("mkg", "mkg.card.columnUpdate", { id: 编辑中的列.id, patch: { name } });
      添加消息("已更新列", "system");
    } else {
      await window.kugua.request("mkg", "mkg.card.columnCreate", { name });
      添加消息("已新建列", "system");
    }
    document.getElementById("column-dialog")?.classList.add("hidden");
    await 加载看板();
  } catch (err) {
    添加消息("保存列失败：" + String(err), "error");
  }
}

async function 删除列(col: 看板列): Promise<void> {
  if (!window.confirm("确定删除列「" + col.name + "」吗？列中的卡片会移到其他列。")) return;
  try {
    await window.kugua.request("mkg", "mkg.card.columnDelete", { id: col.id });
    添加消息("已删除列", "system");
    await 加载看板();
  } catch (err) {
    添加消息("删除列失败：" + String(err), "error");
  }
}

function 打开卡片对话框(编辑: boolean, 默认列ID?: number | null): void {
  (document.getElementById("card-dialog-title") as HTMLDivElement).textContent = 编辑 ? "编辑卡片" : "新建卡片";
  const titleEl = document.getElementById("card-title") as HTMLInputElement;
  const contentEl = document.getElementById("card-content") as HTMLTextAreaElement;
  const columnEl = document.getElementById("card-column") as HTMLSelectElement;
  columnEl.innerHTML = "";
  const 空选项 = document.createElement("option");
  空选项.value = "";
  空选项.textContent = "（未分列）";
  columnEl.appendChild(空选项);
  for (const col of 所有列) {
    const opt = document.createElement("option");
    opt.value = String(col.id);
    opt.textContent = col.name;
    columnEl.appendChild(opt);
  }
  if (编辑 && 编辑中的卡片) {
    titleEl.value = 编辑中的卡片.title;
    contentEl.value = 编辑中的卡片.content;
    columnEl.value = 编辑中的卡片.columnId != null ? String(编辑中的卡片.columnId) : "";
    卡片编辑标签ID.clear();
    for (const tid of 编辑中的卡片.tagIds) 卡片编辑标签ID.add(tid);
  } else {
    编辑中的卡片 = null;
    titleEl.value = "";
    contentEl.value = "";
    columnEl.value = 默认列ID != null ? String(默认列ID) : "";
    卡片编辑标签ID.clear();
  }
  (document.getElementById("card-new-tag-path") as HTMLInputElement).value = "";
  渲染卡片对话框标签();
  Explorer.渲染可勾选标签树(Explorer.标签树, {
    containerId: "card-tag-tree",
    选中的标签ID: 卡片编辑标签ID,
    onToggle: () => 渲染卡片对话框标签(),
  });
  document.getElementById("card-dialog")?.classList.remove("hidden");
}

function 渲染卡片对话框标签(): void {
  const tagsEl = document.getElementById("card-tag-chips") as HTMLDivElement;
  if (!tagsEl) return;
  tagsEl.innerHTML = "";
  if (卡片编辑标签ID.size === 0) {
    tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(未选择标签，从下方标签树勾选)</span>';
    return;
  }
  卡片编辑标签ID.forEach((id) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = Explorer.标签ID转名称(id);
    const x = document.createElement("span");
    x.className = "tc-remove";
    x.textContent = "×";
    x.title = "移除";
    x.addEventListener("click", () => {
      卡片编辑标签ID.delete(id);
      渲染卡片对话框标签();
      Explorer.渲染可勾选标签树(Explorer.标签树, { containerId: "card-tag-tree", 选中的标签ID: 卡片编辑标签ID, onToggle: () => 渲染卡片对话框标签() });
    });
    chip.appendChild(x);
    tagsEl.appendChild(chip);
  });
}

async function 保存卡片(): Promise<void> {
  const title = (document.getElementById("card-title") as HTMLInputElement).value.trim();
  const content = (document.getElementById("card-content") as HTMLTextAreaElement).value;
  const columnVal = (document.getElementById("card-column") as HTMLSelectElement).value;
  const columnId = columnVal === "" ? null : Number(columnVal);
  const tagIds = Array.from(卡片编辑标签ID);
  try {
    if (编辑中的卡片) {
      await window.kugua.request("mkg", "mkg.card.update", { id: 编辑中的卡片.id, patch: { title: title || "未命名", content, columnId, tagIds } });
      添加消息("已更新卡片", "system");
    } else {
      await window.kugua.request("mkg", "mkg.card.create", { title: title || "未命名", content, columnId, tagIds });
      添加消息("已新建卡片", "system");
    }
    document.getElementById("card-dialog")?.classList.add("hidden");
    await 加载看板();
  } catch (err) {
    添加消息("保存卡片失败：" + String(err), "error");
  }
}

async function 删除卡片(): Promise<void> {
  if (!编辑中的卡片) return;
  if (!window.confirm("确定删除这张卡片吗？")) return;
  try {
    await window.kugua.request("mkg", "mkg.card.delete", { id: 编辑中的卡片.id });
    编辑中的卡片 = null;
    添加消息("已删除卡片", "system");
    document.getElementById("card-dialog")?.classList.add("hidden");
    await 加载看板();
  } catch (err) {
    添加消息("删除卡片失败：" + String(err), "error");
  }
}

async function 新建卡片标签(): Promise<void> {
  const input = document.getElementById("card-new-tag-path") as HTMLInputElement;
  const p = input.value.trim();
  if (!p) { 添加消息("请输入标签路径", "error"); return; }
  try {
    await window.kugua.request("mkg", "mkg.tag.createTree", { names: p.split("/").map((s) => s.trim()).filter(Boolean) });
    添加消息("已创建标签：" + p, "system");
    input.value = "";
    await Explorer.加载标签树();
    Explorer.渲染可勾选标签树(Explorer.标签树, { containerId: "card-tag-tree", 选中的标签ID: 卡片编辑标签ID, onToggle: () => 渲染卡片对话框标签() });
  } catch (err) {
    添加消息("创建标签失败：" + String(err), "error");
  }
}


/** 绑定事件（由 07-explorer 的 init 调用） */
export function 绑定看板事件(): void {
  // ===== 看板视图操作 =====
  document.getElementById("ex-board-add-col")?.addEventListener("click", () => 打开列对话框(false));
  document.getElementById("ex-board-add-card")?.addEventListener("click", () => 打开卡片对话框(false));
  document.getElementById("ex-board-refresh")?.addEventListener("click", () => void 加载看板());

  document.getElementById("column-cancel")?.addEventListener("click", () => document.getElementById("column-dialog")?.classList.add("hidden"));
  document.getElementById("column-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("column-dialog")?.classList.add("hidden"));
  document.getElementById("column-save")?.addEventListener("click", () => void 保存列());

  document.getElementById("card-cancel")?.addEventListener("click", () => document.getElementById("card-dialog")?.classList.add("hidden"));
  document.getElementById("card-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("card-dialog")?.classList.add("hidden"));
  document.getElementById("card-save")?.addEventListener("click", () => void 保存卡片());
  document.getElementById("card-btn-create-tag")?.addEventListener("click", () => void 新建卡片标签());
  // 卡片编辑对话框中的删除按钮（动态注入）
  const cardDialogActions = document.querySelector("#card-dialog .modal-actions") as HTMLDivElement | null;
  if (cardDialogActions && !cardDialogActions.querySelector("#card-delete")) {
    const delBtn = document.createElement("button");
    delBtn.className = "modal-btn danger";
    delBtn.id = "card-delete";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => void 删除卡片());
    cardDialogActions.insertBefore(delBtn, cardDialogActions.firstChild);
  }
}

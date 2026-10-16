// ===== 看板视图 =====
// 由 07-explorer.ts 拆分而来。
import { Explorer } from "./07-explorer";
import { 卡片, 看板列 } from "./01-types";
import { 添加消息 } from "./03-preview";
import { 格式化时间 } from "./08-logs";

// ---- 模块状态 ----
let 所有列: 看板列[] = [];
let 所有卡片: 卡片[] = [];
let 编辑中的列: 看板列 | null = null;
let 编辑中的卡片: 卡片 | null = null;
let 卡片编辑标签ID = new Set<number>();
let 卡片选中颜色: string | null = null;

/** 卡片可用颜色 */
export const 卡片颜色 = ["", "#e05d5d", "#e8a33d", "#e3d34a", "#6fbf73", "#5aa9e6", "#a77bca", "#8a8f98"];

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
  if (col.id >= 0) {
    name.title = "双击重命名列";
    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      开始内联重命名列(name, col);
    });
  }
  const count = document.createElement("span");
  count.className = "ex-board-col-count";
  count.textContent = String(cards.length);
  head.appendChild(name);
  head.appendChild(count);
  if (col.id >= 0) {
    const addCard = document.createElement("button");
    addCard.className = "ex-board-col-del";
    addCard.textContent = "+";
    addCard.title = "在本列新建卡片";
    addCard.style.marginLeft = "auto";
    addCard.addEventListener("click", (e) => {
      e.stopPropagation();
      打开卡片对话框(false, col.id);
    });
    head.appendChild(addCard);
    // 右键列：重命名 / 删除
    head.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      显示简单菜单(e.clientX, e.clientY, [
        { label: "重命名列", onClick: () => 开始内联重命名列(name, col) },
        { label: "在本列新建卡片", onClick: () => 打开卡片对话框(false, col.id) },
        { label: "删除列", danger: true, onClick: () => void 删除列(col) },
      ]);
    });
  }
  colDiv.appendChild(head);

  const cardsDiv = document.createElement("div");
  cardsDiv.className = "ex-board-col-cards";
  for (const card of cards) {
    const cardEl = document.createElement("div");
    cardEl.className = "ex-board-card";
    if (card.color) {
      cardEl.style.borderLeft = `4px solid ${card.color}`;
    }
    cardEl.draggable = true;
    cardEl.dataset.cardId = String(card.id);
    // 顶部：时间 + 颜色点
    const meta = document.createElement("div");
    meta.className = "ebc-meta";
    const time = document.createElement("span");
    time.className = "ebc-time";
    time.textContent = 格式化时间(card.createdAt);
    meta.appendChild(time);
    if (card.color) {
      const dot = document.createElement("span");
      dot.className = "ebc-color-dot";
      dot.style.background = card.color;
      meta.appendChild(dot);
    }
    cardEl.appendChild(meta);
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
    cardEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      显示简单菜单(e.clientX, e.clientY, [
        { label: "编辑卡片", onClick: () => { 编辑中的卡片 = card; 打开卡片对话框(true); } },
        { label: "删除卡片", danger: true, onClick: () => void 删除卡片(card) },
      ]);
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

  cardsDiv.addEventListener("dragover", (e) => {
    e.preventDefault();
    cardsDiv.classList.add("drop-target");
  });
  cardsDiv.addEventListener("dragleave", () => cardsDiv.classList.remove("drop-target"));
  cardsDiv.addEventListener("drop", (e) => {
    e.preventDefault();
    cardsDiv.classList.remove("drop-target");
    const data = e.dataTransfer?.getData("text/plain");
    if (!data) return;
    const cardId = Number(data);
    const card = 所有卡片.find((c) => c.id === cardId);
    if (!card) return;
    const targetColumnId = col.id >= 0 ? col.id : null;
    const 同列卡片 = cards.filter((c) => c.id !== cardId);
    if (card.columnId === targetColumnId && 同列卡片.length === cards.length) return;
    void (async () => {
      try {
        // 放到列末尾：sort 取当前列最大 + 1
        const 最大 = 同列卡片.reduce((m, c) => Math.max(m, c.sort ?? 0), 0);
        await window.kugua.request("mkg", "mkg.card.update", {
          id: card.id,
          patch: { columnId: targetColumnId, sort: 最大 + 1 },
        });
        await 加载看板();
      } catch (err) {
        添加消息("移动卡片失败：" + String(err), "error");
      }
    })();
  });

  colDiv.appendChild(cardsDiv);
  board.appendChild(colDiv);
}

/** 内联重命名列：把列名 span 换成输入框，回车/失焦保存 */
function 开始内联重命名列(span: HTMLSpanElement, col: 看板列): void {
  if (span.dataset.editing === "1") return;
  span.dataset.editing = "1";
  const 原值 = col.name;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "ex-board-col-name-input";
  input.value = 原值;
  span.replaceWith(input);
  input.focus();
  input.select();
  let 已完成 = false;
  const 完成 = async (保存: boolean): Promise<void> => {
    if (已完成) return;
    已完成 = true;
    const 新值 = input.value.trim();
    if (!保存 || !新值 || 新值 === 原值) {
      await 加载看板();
      return;
    }
    try {
      await window.kugua.request("mkg", "mkg.card.columnUpdate", { id: col.id, patch: { name: 新值 } });
      添加消息("已重命名列：" + 新值, "system");
    } catch (err) {
      添加消息("重命名列失败：" + String(err), "error");
    }
    await 加载看板();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void 完成(true); }
    else if (e.key === "Escape") { e.preventDefault(); void 完成(false); }
  });
  input.addEventListener("blur", () => void 完成(true));
  input.addEventListener("click", (e) => e.stopPropagation());
}

/** 简易右键菜单（看板专用，不依赖 Explorer 的右键菜单 DOM） */
function 显示简单菜单(x: number, y: number, 项目: Array<{ label: string; danger?: boolean; onClick: () => void }>): void {
  document.querySelectorAll(".ebc-simple-menu").forEach((n) => n.remove());
  const menu = document.createElement("div");
  menu.className = "ebc-simple-menu";
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  for (const it of 项目) {
    const b = document.createElement("div");
    b.className = "ebc-simple-menu-item" + (it.danger ? " danger" : "");
    b.textContent = it.label;
    b.addEventListener("click", () => {
      menu.remove();
      it.onClick();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const 关闭 = (ev: MouseEvent): void => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener("mousedown", 关闭, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", 关闭, true), 0);
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
    卡片选中颜色 = 编辑中的卡片.color ?? null;
  } else {
    编辑中的卡片 = null;
    titleEl.value = "";
    contentEl.value = "";
    columnEl.value = 默认列ID != null ? String(默认列ID) : "";
    卡片编辑标签ID.clear();
    卡片选中颜色 = null;
  }
  渲染颜色选择();
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

function 渲染颜色选择(): void {
  const row = document.getElementById("card-color-row") as HTMLDivElement | null;
  if (!row) return;
  row.querySelectorAll<HTMLButtonElement>(".card-color-swatch").forEach((btn) => {
    const 色 = btn.dataset.color ?? "";
    const 选中 = (卡片选中颜色 ?? "") === 色;
    btn.classList.toggle("selected", 选中);
    btn.onclick = () => {
      卡片选中颜色 = 色 || null;
      渲染颜色选择();
    };
  });
}

async function 保存卡片(): Promise<void> {
  const title = (document.getElementById("card-title") as HTMLInputElement).value.trim();
  const content = (document.getElementById("card-content") as HTMLTextAreaElement).value;
  const columnVal = (document.getElementById("card-column") as HTMLSelectElement).value;
  const columnId = columnVal === "" ? null : Number(columnVal);
  const tagIds = Array.from(卡片编辑标签ID);
  const color = 卡片选中颜色;
  try {
    if (编辑中的卡片) {
      await window.kugua.request("mkg", "mkg.card.update", { id: 编辑中的卡片.id, patch: { title: title || "未命名", content, columnId, tagIds, color } });
      添加消息("已更新卡片", "system");
    } else {
      await window.kugua.request("mkg", "mkg.card.create", { title: title || "未命名", content, columnId, tagIds, color });
      添加消息("已新建卡片", "system");
    }
    document.getElementById("card-dialog")?.classList.add("hidden");
    await 加载看板();
  } catch (err) {
    添加消息("保存卡片失败：" + String(err), "error");
  }
}

async function 删除卡片(目标?: 卡片): Promise<void> {
  const card = 目标 ?? 编辑中的卡片;
  if (!card) return;
  if (!window.confirm("确定删除这张卡片吗？")) return;
  try {
    await window.kugua.request("mkg", "mkg.card.delete", { id: card.id });
    if (编辑中的卡片?.id === card.id) 编辑中的卡片 = null;
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

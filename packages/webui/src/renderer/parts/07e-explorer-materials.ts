// ===== 素材视图 =====
// 由 07-explorer.ts 拆分而来。
import { Explorer } from "./07-explorer";
import { 素材 } from "./01-types";
import { 添加消息 } from "./03-preview";

// ---- 模块状态 ----
let 所有素材: 素材[] = [];
let 选中素材: 素材 | null = null;
let 素材搜索关键词 = "";
let 素材编辑标签ID = new Set<number>();
let 素材编辑目标: 素材 | null = null;

// ===== 素材视图 =====
export async function 加载素材(): Promise<void> {
  try {
    所有素材 = (await window.kugua.request("mkg", "mkg.material.list", {})) as 素材[];
  } catch {
    所有素材 = [];
  }
  渲染素材列表();
  // 统一资料库视图需同步刷新（若已初始化）
  await Explorer.加载所有内容().catch(() => undefined);
}

function 筛选后的素材(): 素材[] {
  const kw = 素材搜索关键词.trim().toLowerCase();
  if (!kw) return 所有素材;
  return 所有素材.filter((m) => m.title.toLowerCase().includes(kw) || m.content.toLowerCase().includes(kw) || m.kind.toLowerCase().includes(kw));
}

function 渲染素材列表(): void {
  const list = document.getElementById("ex-mat-list") as HTMLDivElement;
  if (!list) return;
  const mats = 筛选后的素材();
  list.innerHTML = "";
  if (mats.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;padding:1rem;text-align:center">还没有素材，点击右上角「新建素材」开始收集。</div>';
    return;
  }
  for (const mat of mats) {
    const tile = document.createElement("div");
    tile.className = "ex-mat-tile";
    if (选中素材?.id === mat.id) tile.classList.add("selected");
    const title = document.createElement("div");
    title.className = "em-title";
    title.textContent = mat.title || "(无标题)";
    tile.appendChild(title);
    if (mat.kind) {
      const kind = document.createElement("div");
      kind.className = "em-kind";
      kind.textContent = mat.kind;
      tile.appendChild(kind);
    }
    const preview = document.createElement("div");
    preview.className = "em-preview";
    preview.textContent = mat.content || mat.sourceUrl || "";
    tile.appendChild(preview);
    if (mat.tagIds && mat.tagIds.length > 0) {
      const tagWrap = document.createElement("div");
      tagWrap.className = "em-tags";
      for (const tid of mat.tagIds) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = Explorer.标签ID转名称(tid);
        tagWrap.appendChild(chip);
      }
      tile.appendChild(tagWrap);
    }
    tile.addEventListener("click", (e) => {
      e.stopPropagation();
      选中素材 = mat;
      渲染素材列表();
      渲染素材详情();
    });
    list.appendChild(tile);
  }
}

function 渲染素材详情(): void {
  const panel = document.getElementById("ex-mat-detail") as HTMLDivElement;
  if (!panel) return;
  if (!选中素材) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  (document.getElementById("ex-mat-detail-title") as HTMLDivElement).textContent = 选中素材.title || "(无标题)";
  (document.getElementById("ex-mat-detail-time") as HTMLDivElement).textContent = "创建 " + Explorer.格式化笔记时间(选中素材.createdAt) + " · 更新 " + Explorer.格式化笔记时间(选中素材.updatedAt);
  (document.getElementById("ex-mat-detail-content") as HTMLDivElement).textContent = 选中素材.content || "(空内容)";
  const metaEl = document.getElementById("ex-mat-detail-meta") as HTMLDivElement;
  metaEl.innerHTML = "";
  if (选中素材.kind) {
    const k = document.createElement("div");
    k.textContent = "类型：" + 选中素材.kind;
    metaEl.appendChild(k);
  }
  if (选中素材.sourceUrl) {
    const s = document.createElement("div");
    s.innerHTML = "来源：<a href=\"" + 选中素材.sourceUrl + "\" target=\"_blank\">" + 选中素材.sourceUrl + "</a>";
    metaEl.appendChild(s);
  }
  if (选中素材.imageUrl) {
    const img = document.createElement("img");
    img.src = 选中素材.imageUrl;
    img.alt = "素材预览";
    img.onerror = () => { img.style.display = "none"; };
    metaEl.appendChild(img);
  }
  const tagsEl = document.getElementById("ex-mat-detail-tags") as HTMLDivElement;
  tagsEl.innerHTML = "";
  if (选中素材.tagIds && 选中素材.tagIds.length > 0) {
    for (const tid of 选中素材.tagIds) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = Explorer.标签ID转名称(tid);
      tagsEl.appendChild(chip);
    }
  } else {
    tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(无标签)</span>';
  }
}

/** 供统一资料库双击时调用：按内容条目打开素材编辑对话框 */
export function 打开素材编辑(item: Explorer.内容条目): void {
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  选中素材 = {
    id: item.id,
    title: item.name,
    content: item.content,
    kind: typeof meta.kind === "string" ? meta.kind : "",
    sourceUrl: typeof meta.sourceUrl === "string" ? meta.sourceUrl : "",
    imageUrl: typeof meta.imageUrl === "string" ? meta.imageUrl : "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    tagIds: item.tagIds,
  };
  打开素材对话框(true);
}

function 打开素材对话框(编辑: boolean): void {
  (document.getElementById("material-dialog-title") as HTMLDivElement).textContent = 编辑 ? "编辑素材" : "新建素材";
  const titleEl = document.getElementById("material-title") as HTMLInputElement;
  const contentEl = document.getElementById("material-content") as HTMLTextAreaElement;
  const kindEl = document.getElementById("material-kind") as HTMLInputElement;
  const sourceEl = document.getElementById("material-source") as HTMLInputElement;
  const imageEl = document.getElementById("material-image") as HTMLInputElement;
  if (编辑 && 选中素材) {
    素材编辑目标 = 选中素材;
    titleEl.value = 选中素材.title;
    contentEl.value = 选中素材.content;
    kindEl.value = 选中素材.kind;
    sourceEl.value = 选中素材.sourceUrl;
    imageEl.value = 选中素材.imageUrl;
    素材编辑标签ID.clear();
    for (const tid of 选中素材.tagIds) 素材编辑标签ID.add(tid);
  } else {
    素材编辑目标 = null;
    titleEl.value = "";
    contentEl.value = "";
    kindEl.value = "";
    sourceEl.value = "";
    imageEl.value = "";
    素材编辑标签ID.clear();
  }
  (document.getElementById("material-new-tag-path") as HTMLInputElement).value = "";
  渲染素材对话框标签();
  Explorer.渲染可勾选标签树(Explorer.标签树, {
    containerId: "material-tag-tree",
    选中的标签ID: 素材编辑标签ID,
    onToggle: () => 渲染素材对话框标签(),
  });
  document.getElementById("material-dialog")?.classList.remove("hidden");
}

function 渲染素材对话框标签(): void {
  const tagsEl = document.getElementById("material-tag-chips") as HTMLDivElement;
  if (!tagsEl) return;
  tagsEl.innerHTML = "";
  if (素材编辑标签ID.size === 0) {
    tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(未选择标签，从下方标签树勾选)</span>';
    return;
  }
  素材编辑标签ID.forEach((id) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = Explorer.标签ID转名称(id);
    const x = document.createElement("span");
    x.className = "tc-remove";
    x.textContent = "×";
    x.title = "移除";
    x.addEventListener("click", () => {
      素材编辑标签ID.delete(id);
      渲染素材对话框标签();
      Explorer.渲染可勾选标签树(Explorer.标签树, { containerId: "material-tag-tree", 选中的标签ID: 素材编辑标签ID, onToggle: () => 渲染素材对话框标签() });
    });
    chip.appendChild(x);
    tagsEl.appendChild(chip);
  });
}

async function 保存素材(): Promise<void> {
  const title = (document.getElementById("material-title") as HTMLInputElement).value.trim();
  const content = (document.getElementById("material-content") as HTMLTextAreaElement).value;
  const kind = (document.getElementById("material-kind") as HTMLInputElement).value.trim();
  const sourceUrl = (document.getElementById("material-source") as HTMLInputElement).value.trim();
  const imageUrl = (document.getElementById("material-image") as HTMLInputElement).value.trim();
  const tagIds = Array.from(素材编辑标签ID);
  try {
    if (素材编辑目标) {
      await window.kugua.request("mkg", "mkg.material.update", { id: 素材编辑目标.id, patch: { title: title || "未命名", content, kind, sourceUrl, imageUrl, tagIds } });
      添加消息("已更新素材", "system");
    } else {
      await window.kugua.request("mkg", "mkg.material.create", { title: title || "未命名", content, kind, sourceUrl, imageUrl, tagIds });
      添加消息("已新建素材", "system");
    }
    document.getElementById("material-dialog")?.classList.add("hidden");
    await 加载素材();
  } catch (err) {
    添加消息("保存素材失败：" + String(err), "error");
  }
}

async function 删除素材(): Promise<void> {
  if (!选中素材) return;
  if (!window.confirm("确定删除这个素材吗？")) return;
  try {
    await window.kugua.request("mkg", "mkg.material.delete", { id: 选中素材.id });
    选中素材 = null;
    添加消息("已删除素材", "system");
    await 加载素材();
    (document.getElementById("ex-mat-detail") as HTMLDivElement)?.classList.add("hidden");
  } catch (err) {
    添加消息("删除素材失败：" + String(err), "error");
  }
}

async function 新建素材标签(): Promise<void> {
  const input = document.getElementById("material-new-tag-path") as HTMLInputElement;
  const p = input.value.trim();
  if (!p) { 添加消息("请输入标签路径", "error"); return; }
  try {
    await window.kugua.request("mkg", "mkg.tag.createTree", { names: p.split("/").map((s) => s.trim()).filter(Boolean) });
    添加消息("已创建标签：" + p, "system");
    input.value = "";
    await Explorer.加载标签树();
    Explorer.渲染可勾选标签树(Explorer.标签树, { containerId: "material-tag-tree", 选中的标签ID: 素材编辑标签ID, onToggle: () => 渲染素材对话框标签() });
  } catch (err) {
    添加消息("创建标签失败：" + String(err), "error");
  }
}


/** 绑定事件（由 07-explorer 的 init 调用） */
export function 绑定素材事件(): void {
  // ===== 素材视图操作 =====
  document.getElementById("ex-mat-add")?.addEventListener("click", () => 打开素材对话框(false));
  document.getElementById("ex-mat-refresh")?.addEventListener("click", () => void 加载素材());
  document.getElementById("ex-mat-edit")?.addEventListener("click", () => 打开素材对话框(true));
  document.getElementById("ex-mat-delete")?.addEventListener("click", () => void 删除素材());
  const matSearch = document.getElementById("ex-mat-search") as HTMLInputElement;
  matSearch?.addEventListener("input", () => {
    素材搜索关键词 = matSearch.value;
    渲染素材列表();
  });

  document.getElementById("material-cancel")?.addEventListener("click", () => document.getElementById("material-dialog")?.classList.add("hidden"));
  document.getElementById("material-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("material-dialog")?.classList.add("hidden"));
  document.getElementById("material-save")?.addEventListener("click", () => void 保存素材());
  document.getElementById("material-btn-create-tag")?.addEventListener("click", () => void 新建素材标签());
}

// ===== 工作区视图 =====
// 工作区只保存「库内节点在画布上的摆放」（位置/尺寸/颜色/备注），
// 不存储任何资源数据本身。左侧列出各工作区（可增/改/删），右侧是可拖拽画布。
import { Explorer } from "./07-explorer";
import { 打开内容 } from "./07g-explorer-editor";
import { 添加消息 } from "./03-preview";
import { 显示菜单 } from "./21-context-menu";

// ---- 类型 ----
interface 工作区 {
  id: number;
  name: string;
  sort: number;
  createdAt: number;
  updatedAt: number;
}
interface 放置项 {
  id: number;
  workspaceId: number;
  nodeId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string | null;
  note: string | null;
  createdAt: number;
}

// ---- 状态 ----
let 工作区列表: 工作区[] = [];
let 当前工作区: 工作区 | null = null;
let 当前放置项: 放置项[] = [];			/** 节点 id -> 内容条目（用于渲染卡片标题/缩略图） */
let 节点信息表 = new Map<number, Explorer.内容条目>();

/** 加载工作区视图（切换 tab 时调用） */
export async function 加载工作区视图(): Promise<void> {
  await 加载工作区列表();
  if (!当前工作区 && 工作区列表.length > 0) 当前工作区 = 工作区列表[0];
  渲染工作区侧栏();
  await 加载当前工作区();
}

async function 加载工作区列表(): Promise<void> {
  try {
    工作区列表 = (await window.kugua.request("mkg", "mkg.workspace.list", {})) as 工作区[];
  } catch {
    工作区列表 = [];
  }
  if (当前工作区) {
    // 当前工作区可能已被删除/重命名，刷新引用
    当前工作区 = 工作区列表.find((w) => w.id === 当前工作区!.id) ?? null;
  }
}

function 渲染工作区侧栏(): void {
  const list = document.getElementById("ws-list") as HTMLDivElement | null;
  if (!list) return;
  list.innerHTML = "";
  if (工作区列表.length === 0) {
    list.innerHTML = '<div class="ws-empty-hint">还没有工作区，点击右上角 + 新建。</div>';
    return;
  }
  for (const ws of 工作区列表) {
    const item = document.createElement("div");
    item.className = "ws-item" + (当前工作区?.id === ws.id ? " active" : "");
    item.textContent = ws.name;
    item.title = ws.name + "（双击重命名，右键菜单）";
    item.addEventListener("click", () => {
      当前工作区 = ws;
      渲染工作区侧栏();
      void 加载当前工作区();
    });
    item.addEventListener("dblclick", () => void 重命名工作区(ws));
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      显示工作区菜单(e.clientX, e.clientY, ws);
    });
    list.appendChild(item);
  }
}

/** 工作区菜单：委托统一实现 */
function 显示工作区菜单(x: number, y: number, ws: 工作区): void {
  显示菜单(x, y, [
    { label: "重命名", icon: "✏️", onClick: () => void 重命名工作区(ws) },
    { label: "清空摆放", icon: "🧹", onClick: () => void 清空工作区(ws) },
    null,
    { label: "删除工作区", icon: "🗑️", danger: true, onClick: () => void 删除工作区(ws) },
  ]);
}

async function 新建工作区(): Promise<void> {
  const name = window.prompt("新建工作区名称：", "工作区 " + (工作区列表.length + 1));
  if (!name) return;
  try {
    const ws = (await window.kugua.request("mkg", "mkg.workspace.create", { name: name.trim() })) as 工作区;
    添加消息("已新建工作区：" + ws.name, "system");
    await 加载工作区列表();
    当前工作区 = 工作区列表.find((w) => w.id === ws.id) ?? 当前工作区;
    渲染工作区侧栏();
    await 加载当前工作区();
  } catch (err) {
    添加消息("新建工作区失败：" + String(err), "error");
  }
}

async function 重命名工作区(ws: 工作区): Promise<void> {
  const name = window.prompt("重命名工作区：", ws.name);
  if (!name || name.trim() === ws.name) return;
  try {
    await window.kugua.request("mkg", "mkg.workspace.update", { id: ws.id, patch: { name: name.trim() } });
    await 加载工作区列表();
    渲染工作区侧栏();
    更新标题();
  } catch (err) {
    添加消息("重命名工作区失败：" + String(err), "error");
  }
}

async function 删除工作区(ws: 工作区): Promise<void> {
  if (!window.confirm(`确定删除工作区「${ws.name}」吗？\n（仅删除该工作区的摆放，不会删除任何资源本身）`)) return;
  try {
    await window.kugua.request("mkg", "mkg.workspace.delete", { id: ws.id });
    添加消息("已删除工作区：" + ws.name, "system");
    if (当前工作区?.id === ws.id) 当前工作区 = null;
    await 加载工作区列表();
    if (!当前工作区 && 工作区列表.length > 0) 当前工作区 = 工作区列表[0];
    渲染工作区侧栏();
    await 加载当前工作区();
  } catch (err) {
    添加消息("删除工作区失败：" + String(err), "error");
  }
}

async function 清空工作区(ws: 工作区): Promise<void> {
  if (!window.confirm(`清空工作区「${ws.name}」的全部摆放？（不删除资源）`)) return;
  try {
    // 逐个删除放置项（无单独“清空”动作，用循环）
    const items = (await window.kugua.request("mkg", "mkg.workspace.items", { workspaceId: ws.id })) as 放置项[];
    for (const it of items) {
      await window.kugua.request("mkg", "mkg.workspace.itemRemove", { id: it.id });
    }
    添加消息("已清空工作区：" + ws.name, "system");
    if (当前工作区?.id === ws.id) await 加载当前工作区();
  } catch (err) {
    添加消息("清空工作区失败：" + String(err), "error");
  }
}

async function 加载当前工作区(): Promise<void> {
  const canvas = document.getElementById("ws-canvas") as HTMLDivElement | null;
  const empty = document.getElementById("ws-empty") as HTMLDivElement | null;
  if (!canvas) return;
  更新标题();
  canvas.innerHTML = "";
  if (!当前工作区) {
    empty && (empty.style.display = "flex");
    return;
  }
  try {
    当前放置项 = (await window.kugua.request("mkg", "mkg.workspace.items", {
      workspaceId: 当前工作区.id,
    })) as 放置项[];
  } catch {
    当前放置项 = [];
  }
  empty && (empty.style.display = 当前放置项.length === 0 ? "flex" : "none");
  // 需要节点信息来渲染标题/缩略图：复用 Explorer 已加载的内容列表，缺失的按需取
  await 补充节点信息();
  渲染画布();
}

/** 确保每个放置项引用的节点信息都在缓存里 */
async function 补充节点信息(): Promise<void> {
  const 缺 = 当前放置项.filter((it) => !节点信息表.has(it.nodeId)).map((it) => it.nodeId);
  for (const id of 缺) {
    try {
      const 节点 = (await window.kugua.request("mkg", "mkg.node.get", { id })) as {
        id: number;
        type: string;
        title: string;
        meta: Record<string, unknown>;
      } | null;
      if (节点) {
        节点信息表.set(id, {
          id: 节点.id,
          type: 节点.type,
          category: 推断分类(节点.type),
          name: 节点.title,
          content: "",
          tagIds: [],
          tagPaths: [],
          createdAt: 0,
          updatedAt: 0,
          resourceId: (节点.meta?.resourceId as number) ?? null,
          path: null,
          size: 0,
          modifiedTime: 0,
          indexedAt: 0,
          realName: null,
          extension: "",
          meta: 节点.meta ?? {},
        });
      }
    } catch {
      // 节点可能已被删除：占位
    }
  }
}

function 推断分类(type: string): string {
  switch (type) {
    case "note": return "点子";
    case "material": return "素材";
    case "snippet": return "文本段";
    case "card": return "记事";
    case "directory": return "目录";
    default: return "文件";
  }
}

/** 画布缩放/平移状态 */
let 缩放 = 1;
let 平移X = 0;
let 平移Y = 0;

function 渲染画布(): void {
  const canvas = document.getElementById("ws-canvas") as HTMLDivElement | null;
  if (!canvas) return;
  canvas.style.transform = `translate(${平移X}px, ${平移Y}px) scale(${缩放})`;
  for (const it of 当前放置项) {
    渲染放置卡(canvas, it);
  }
}

function 渲染放置卡(canvas: HTMLDivElement, it: 放置项): void {
  const 节点 = 节点信息表.get(it.nodeId);
  const el = document.createElement("div");
  el.className = "ws-card";
  el.dataset.itemId = String(it.id);
  el.style.left = it.x + "px";
  el.style.top = it.y + "px";
  el.style.width = it.width + "px";
  el.style.height = it.height + "px";
  if (it.color) el.style.borderColor = it.color;

  const head = document.createElement("div");
  head.className = "ws-card-head";
  head.textContent = 节点?.name ?? `#${it.nodeId}`;
  head.title = head.textContent;
  el.appendChild(head);

  const body = document.createElement("div");
  body.className = "ws-card-body";
  const 分类 = 节点?.category ?? "文件";
  body.innerHTML = `<span class="ws-card-badge">${分类}</span>`;
  if (it.note) {
    const n = document.createElement("div");
    n.className = "ws-card-note";
    n.textContent = it.note;
    body.appendChild(n);
  }
  el.appendChild(body);

  // 拖动移动
  head.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const 起X = e.clientX;
    const 起Y = e.clientY;
    const 原X = it.x;
    const 原Y = it.y;
    const 移动 = (ev: MouseEvent): void => {
      it.x = 原X + (ev.clientX - 起X) / 缩放;
      it.y = 原Y + (ev.clientY - 起Y) / 缩放;
      el.style.left = it.x + "px";
      el.style.top = it.y + "px";
    };
    const 结束 = (): void => {
      document.removeEventListener("mousemove", 移动);
      document.removeEventListener("mouseup", 结束);
      void window.kugua.request("mkg", "mkg.workspace.itemUpdate", {
        id: it.id,
        patch: { x: Math.round(it.x), y: Math.round(it.y) },
      }).catch(() => undefined);
    };
    document.addEventListener("mousemove", 移动);
    document.addEventListener("mouseup", 结束);
  });

  // 双击：打开对应资源的查看/编辑弹窗
  el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    const 内容 = 节点信息表.get(it.nodeId);
    if (内容) void 打开内容(内容);
  });

  // 右键：移除摆放 / 颜色 / 备注
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    显示放置项菜单(e.clientX, e.clientY, it);
  });

  canvas.appendChild(el);
}

/** 放置项菜单：委托统一实现（样式/边界保护/关闭行为与其他菜单一致） */
function 显示放置项菜单(x: number, y: number, it: 放置项): void {
  显示菜单(x, y, [
    { label: "打开", icon: "📂", onClick: () => { const c = 节点信息表.get(it.nodeId); if (c) void 打开内容(c); } },
    { label: "编辑备注", icon: "📝", onClick: () => void 编辑放置项备注(it) },
    { label: "设置颜色", icon: "🎨", onClick: () => void 设置放置项颜色(it) },
    null,
    { label: "移除摆放", icon: "➖", danger: true, onClick: () => void 移除放置项(it) },
  ]);
}

async function 编辑放置项备注(it: 放置项): Promise<void> {
  const note = window.prompt("备注（留空清除）：", it.note ?? "");
  if (note === null) return;
  try {
    await window.kugua.request("mkg", "mkg.workspace.itemUpdate", { id: it.id, patch: { note: note.trim() || null } });
    await 加载当前工作区();
  } catch (err) {
    添加消息("保存备注失败：" + String(err), "error");
  }
}

async function 设置放置项颜色(it: 放置项): Promise<void> {
  const 颜色 = ["", "#e05d5d", "#e8a33d", "#e3d34a", "#6fbf73", "#5aa9e6", "#a77bca", "#8a8f98"];
  const 输入 = window.prompt("输入颜色（如 #5aa9e6，留空清除）：\n可选：" + 颜色.filter(Boolean).join(" "), it.color ?? "");
  if (输入 === null) return;
  try {
    await window.kugua.request("mkg", "mkg.workspace.itemUpdate", { id: it.id, patch: { color: 输入.trim() || null } });
    await 加载当前工作区();
  } catch (err) {
    添加消息("设置颜色失败：" + String(err), "error");
  }
}

async function 移除放置项(it: 放置项): Promise<void> {
  try {
    await window.kugua.request("mkg", "mkg.workspace.itemRemove", { id: it.id });
    await 加载当前工作区();
  } catch (err) {
    添加消息("移除摆放失败：" + String(err), "error");
  }
}

function 更新标题(): void {
  const el = document.getElementById("ws-current-name") as HTMLSpanElement | null;
  if (el) el.textContent = 当前工作区 ? 当前工作区.name : "未选择工作区";
}

/** 切换左侧栏标签页（workspaces / palette） */
function 切换侧栏标签页(页: "workspaces" | "palette"): void {
  document.querySelectorAll<HTMLButtonElement>(".ws-side-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.wstab === 页);
  });
  document.querySelectorAll<HTMLElement>(".ws-side-page").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.wspage !== 页);
  });
}

/** 打开「库内资源」（切到资源标签页），便于拖入画布 */
async function 打开资源面板(): Promise<void> {
  切换侧栏标签页("palette");
  await 渲染资源面板((document.getElementById("ws-search") as HTMLInputElement | null)?.value ?? "");
}

async function 渲染资源面板(关键词: string): Promise<void> {
  const list = document.getElementById("ws-palette-list") as HTMLDivElement | null;
  if (!list) return;
  list.innerHTML = "";
  // 复用 Explorer 的统一内容列表（已含全部类型）；未加载时触发加载
  let 内容 = Explorer.所有内容;
  if (!内容 || 内容.length === 0) {
    await Explorer.加载所有内容();
    内容 = Explorer.所有内容;
  }
  const 关键字 = 关键词.trim().toLowerCase();
  const 过滤后 = (内容 ?? []).filter((c) => !关键字 || c.name.toLowerCase().includes(关键字)).slice(0, 300);
  for (const c of 过滤后) {
    节点信息表.set(c.id, c);
    const row = document.createElement("div");
    row.className = "ws-palette-item";
    row.draggable = true;
    row.title = c.name + "（拖到画布添加）";
    row.innerHTML = `<span class="ws-palette-badge">${c.category}</span><span class="ws-palette-name"></span>`;
    (row.querySelector(".ws-palette-name") as HTMLElement).textContent = c.name;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("application/x-kugua-node", String(c.id));
      e.dataTransfer?.setData("text/plain", String(c.id));
    });
    row.addEventListener("dblclick", () => void 添加节点到画布(c.id));
    list.appendChild(row);
  }
  if (过滤后.length === 0) {
    list.innerHTML = '<div class="ws-empty-hint">没有匹配的资源。</div>';
  }
}

/**
 * 确保有当前工作区；没有就自动新建一个。
 *
 * 使用者视角：双击/拖入 = 「我想把这块内容放进画布」。
 * 只报错的话，用户得自己想到「先切回工作区页 → 新建 → 再回来」，
 * 一条转瞬即逝的 toast 指引不了这个流程。直接带办。
 *
 * @returns 是否可用（false = 新建失败，调用方应中止）
 */
async function 确保有工作区(): Promise<boolean> {
  if (当前工作区) return true;
  const 名称 = "工作区 " + (工作区列表.length + 1);
  try {
    const ws = (await window.kugua.request("mkg", "mkg.workspace.create", { name: 名称 })) as 工作区;
    await 加载工作区列表();
    当前工作区 = 工作区列表.find((w) => w.id === ws.id) ?? 当前工作区;
    渲染工作区侧栏();
    await 加载当前工作区();
    添加消息("已自动新建工作区：" + ws.name, "system");
    return !!当前工作区;
  } catch (err) {
    添加消息("自动新建工作区失败，请先在左侧「工作区」页手动新建：" + String(err), "error");
    return false;
  }
}

async function 添加节点到画布(nodeId: number): Promise<void> {
  if (!(await 确保有工作区())) return;
  const 工作区ID = 当前工作区!.id;
  // 若已存在则不再重复添加
  if (当前放置项.some((it) => it.nodeId === nodeId)) {
    添加消息("该资源已在当前工作区中", "system");
    return;
  }
  try {
    const x = Math.round(-平移X / 缩放 + 40 + (当前放置项.length % 5) * 30);
    const y = Math.round(-平移Y / 缩放 + 40 + (当前放置项.length % 5) * 30);
    await window.kugua.request("mkg", "mkg.workspace.itemAdd", {
      workspaceId: 工作区ID,
      nodeId,
      x,
      y,
      width: 220,
      height: 160,
    });
    await 加载当前工作区();
  } catch (err) {
    添加消息("添加到工作区失败：" + String(err), "error");
  }
}

/** 绑定工作区相关事件（由 07-explorer 的 init 调用） */
export function 绑定工作区事件(): void {
  document.getElementById("ws-add")?.addEventListener("click", () => void 新建工作区());
  document.getElementById("ws-rename")?.addEventListener("click", () => {
    if (当前工作区) void 重命名工作区(当前工作区);
    else 添加消息("请先选择一个工作区", "error");
  });
  document.getElementById("ws-clear")?.addEventListener("click", () => {
    if (当前工作区) void 清空工作区(当前工作区);
  });
  document.getElementById("ws-delete")?.addEventListener("click", () => {
    if (当前工作区) void 删除工作区(当前工作区);
  });
  document.getElementById("ws-reset-view")?.addEventListener("click", () => {
    缩放 = 1;
    平移X = 0;
    平移Y = 0;
    渲染画布();
  });
  document.getElementById("ws-palette-close")?.addEventListener("click", () =>
    document.getElementById("ws-palette")?.classList.add("hidden"),
  );

  // 点击画布空白处打开资源面板
  const wrap = document.getElementById("ws-canvas-wrap") as HTMLDivElement | null;
  wrap?.addEventListener("click", (e) => {
    if (e.target === wrap || (e.target as HTMLElement).id === "ws-empty") void 打开资源面板();
  });

  // 搜索框：实时过滤资源面板
  document.getElementById("ws-search")?.addEventListener("input", (e) => {
    void 渲染资源面板((e.target as HTMLInputElement).value);
  });
  // 聚焦搜索框时自动切到资源页（搜索框就在资源页内，此处保证初始态正确）
  document.getElementById("ws-search")?.addEventListener("focus", () => 切换侧栏标签页("palette"));

  // 左侧栏标签切换
  document.querySelectorAll<HTMLButtonElement>(".ws-side-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const 页 = btn.dataset.wstab as "workspaces" | "palette" | undefined;
      if (!页) return;
      切换侧栏标签页(页);
      if (页 === "palette") void 渲染资源面板((document.getElementById("ws-search") as HTMLInputElement | null)?.value ?? "");
    });
  });

  // 画布接收拖拽
  wrap?.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  wrap?.addEventListener("drop", (e) => {
    e.preventDefault();
    const data = e.dataTransfer?.getData("application/x-kugua-node") || e.dataTransfer?.getData("text/plain");
    if (!data) return;
    const nodeId = Number(data);
    if (!Number.isFinite(nodeId) || nodeId <= 0) return;
    void (async () => {
      if (!(await 确保有工作区())) return;
      const 工作区ID = 当前工作区!.id;
      if (当前放置项.some((it) => it.nodeId === nodeId)) {
        添加消息("该资源已在当前工作区中", "system");
        return;
      }
      try {
        const rect = wrap.getBoundingClientRect();
        const x = Math.round((e.clientX - rect.left - 平移X) / 缩放);
        const y = Math.round((e.clientY - rect.top - 平移Y) / 缩放);
        await window.kugua.request("mkg", "mkg.workspace.itemAdd", {
          workspaceId: 工作区ID,
          nodeId,
          x,
          y,
          width: 220,
          height: 160,
        });
        await 加载当前工作区();
      } catch (err) {
        添加消息("添加到工作区失败：" + String(err), "error");
      }
    })();
  });

  // 滚轮缩放画布（Ctrl + 滚轮）
  wrap?.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      缩放 = Math.min(2.5, Math.max(0.3, 缩放 * (e.deltaY < 0 ? 1.1 : 0.9)));
      渲染画布();
    },
    { passive: false },
  );
}

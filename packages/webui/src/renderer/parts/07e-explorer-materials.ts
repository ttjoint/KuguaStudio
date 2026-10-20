// ===== 素材 =====
// 由 07-explorer.ts 拆分而来。
// 说明：素材已并入统一资料库（仅作类型筛选），故不再有独立的列表/详情面板；
//       本文件只保留「新建/编辑对话框」与其事件绑定，以及供统一列表双击调用的入口。
import { Explorer } from "./07-explorer";
import { 素材 } from "./01-types";
import { 添加消息 } from "./03-preview";

// ---- 模块状态 ----
let 素材编辑标签ID = new Set<number>();
let 素材编辑目标: 素材 | null = null;

/** 刷新统一资料库内容流（素材作为类型筛选条目，无需单独列表）。 */
export async function 加载素材(): Promise<void> {
  await Explorer.加载所有内容().catch(() => undefined);
}

/** 供统一资料库双击时调用：按内容条目打开素材编辑对话框 */
export async function 打开素材编辑(item: Explorer.内容条目): Promise<void> {
  // 走强类型接口拿素材，而不是从 listAllContent 的 meta 黑盒 JSON 里手翻 kind/sourceUrl/imageUrl。
  // 后端 mkg.material.get 已返回完整 素材（含这些字段），多一次本地往返代价可忽略，
  // 却让前端不再依赖 meta 的实现细节（字段改名/搬家不会再静默读到空值）。
  let 数据: 素材 | null = null;
  try {
    数据 = (await window.kugua.request("mkg", "mkg.material.get", { id: item.id })) as 素材 | null;
  } catch (err) {
    添加消息("读取素材失败：" + String(err), "error");
    return;
  }
  if (!数据) {
    添加消息("素材不存在或已删除", "error");
    return;
  }
  素材编辑目标 = {
    id: 数据.id,
    title: 数据.title,
    content: 数据.content,
    kind: 数据.kind,
    sourceUrl: 数据.sourceUrl,
    imageUrl: 数据.imageUrl,
    createdAt: 数据.createdAt,
    updatedAt: 数据.updatedAt,
    tagIds: 数据.tagIds,
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
  if (编辑 && 素材编辑目标) {
    titleEl.value = 素材编辑目标.title;
    contentEl.value = 素材编辑目标.content;
    kindEl.value = 素材编辑目标.kind;
    sourceEl.value = 素材编辑目标.sourceUrl;
    imageEl.value = 素材编辑目标.imageUrl;
    素材编辑标签ID.clear();
    for (const tid of 素材编辑目标.tagIds) 素材编辑标签ID.add(tid);
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
  document.getElementById("ex-mat-add")?.addEventListener("click", () => 打开素材对话框(false));
  document.getElementById("material-cancel")?.addEventListener("click", () => document.getElementById("material-dialog")?.classList.add("hidden"));
  document.getElementById("material-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("material-dialog")?.classList.add("hidden"));
  document.getElementById("material-save")?.addEventListener("click", () => void 保存素材());
  document.getElementById("material-btn-create-tag")?.addEventListener("click", () => void 新建素材标签());
}

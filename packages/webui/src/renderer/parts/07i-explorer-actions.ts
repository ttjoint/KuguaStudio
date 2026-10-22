// ===== 右键菜单 / 批量操作 / 内联编辑 / 框选 =====
// 由 07-explorer.ts 拆分而来。
//
// 注意：菜单的**渲染与全局接管**已统一到 21-context-menu.ts。
// 这里保留同名导出是为了不打断现有调用点（内容列表、标签树、看板等处）。
// 新代码请直接用 21-context-menu 的 显示菜单 / 注册右键菜单。
import { Explorer } from "./07-explorer";
import { 更新内容信息面板 } from "./07j-explorer-tags";
import { 添加消息 } from "./03-preview";
import { 刷新统计 } from "./06-shell";
import { 显示菜单, 隐藏菜单 } from "./21-context-menu";

export function 显示右键菜单(x: number, y: number): void {
  // 无菜单项的“空菜单”没意义；保留此函数仅为兼容旧调用
  Explorer.右键菜单.style.left = x + "px";
  Explorer.右键菜单.style.top = y + "px";
  Explorer.右键菜单.classList.remove("hidden");
}

export function 隐藏右键菜单(): void {
  隐藏菜单();
}

// ===== 动态右键菜单（委托给统一实现）=====
export function 显示上下文菜单(x: number, y: number, items: Array<Explorer.菜单项 | null>): void {
  显示菜单(x, y, items as Parameters<typeof 显示菜单>[2]);
}

/** 复制文本到剪贴板 */
export async function 复制文本(文本: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(文本);
    Explorer.状态栏计数.textContent = "已复制：" + (文本.length > 24 ? 文本.slice(0, 24) + "…" : 文本);
    setTimeout(() => { Explorer.状态栏计数.textContent = Explorer.筛选内容().length + " 个项目"; }, 2000);
  } catch (err) {
    添加消息("复制失败：" + String(err), "error");
  }
}

/** 更新批量删除按钮（选中数） */
export function 更新批量删除按钮(): void {
  const btn = document.getElementById("ex-btn-delete-selected") as HTMLButtonElement | null;
  if (!btn) return;
  const 计数 = document.getElementById("ex-delete-count") as HTMLSpanElement | null;
  const n = Explorer.选中节点ID.size;
  btn.classList.toggle("hidden", n === 0);
  if (计数) {
    计数.textContent = String(n);
    计数.classList.toggle("hidden", n === 0);
  }
  btn.title = n > 0 ? `删除选中的 ${n} 项（从知识库移除，不影响物理文件）` : "删除选中的内容";
}

/** 从知识库批量移除选中内容（物理文件不受影响） */
export async function 删除选中内容(): Promise<void> {
  const ids = [...Explorer.选中节点ID];
  if (ids.length === 0) return;
  // 直接处理，不弹确认框
  (document.activeElement as HTMLElement)?.blur?.();
  try {
    await window.kugua.request("mkg", "mkg.node.removeMany", { nodeIds: ids });
    添加消息(`已从知识库移除 ${ids.length} 项（物理文件未受影响）`, "system", "批量删除");
  } catch (err) {
    添加消息("批量移除失败：" + String(err), "error");
  } finally {
    Explorer.选中节点ID.clear();
    Explorer.选中内容 = null;
    Explorer.上次点击ID = null;
    更新内容信息面板();
    更新批量删除按钮();
    await Explorer.加载所有内容();
    void 刷新统计();
  }
}

/** 从知识库移除并把物理文件删除到系统回收站 */
export async function 删除到回收站(item: Explorer.内容条目): Promise<void> {
  if (item.resourceId == null) {
    添加消息("该内容不是文件，仅支持从知识库移除", "system");
    return;
  }
  // 直接处理，不弹确认框
  (document.activeElement as HTMLElement)?.blur?.();
  try {
    const r = (await window.kugua.request("mkg", "mkg.node.trash", { nodeId: item.id })) as {
      trashed: boolean;
      note?: string;
    };
    添加消息(r.trashed ? `已删除到回收站：${item.name}` : `已从知识库移除：${item.name}${r.note ? "（" + r.note + "）" : ""}`, "system", "删除到回收站");
  } catch (err) {
    添加消息("删除失败：" + String(err), "error");
  } finally {
    Explorer.选中节点ID.delete(item.id);
    if (Explorer.选中内容?.id === item.id) Explorer.选中内容 = null;
    更新内容信息面板();
    更新批量删除按钮();
    await Explorer.加载所有内容();
    void 刷新统计();
  }
}

// ===== 信息面板内联编辑（知识库名称 / 真实文件名） =====
export function 开始内联编辑(el: HTMLElement, 初始值: string, onSave: (v: string) => Promise<void>): void {
  if (el.querySelector(".ex-info-edit-input")) return;
  const input = document.createElement("input");
  input.className = "ex-info-edit-input";
  input.value = 初始值;
  el.textContent = "";
  el.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const 完成 = async (保存: boolean): Promise<void> => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (保存 && v && v !== 初始值) {
      try {
        await onSave(v);
      } catch (err) {
        添加消息(String(err), "error");
      }
    }
    更新内容信息面板();
    await Explorer.加载所有内容();
    // 重载后把信息面板同步到最新条目
    if (Explorer.选中内容) {
      const 最新 = Explorer.所有内容.find((x) => x.id === Explorer.选中内容!.id);
      if (最新) Explorer.选中内容 = 最新;
    }
    更新内容信息面板();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") void 完成(true);
    if (e.key === "Escape") void 完成(false);
  });
  input.addEventListener("blur", () => void 完成(true));
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("contextmenu", (e) => e.stopPropagation());
}

export function 开始内联编辑名称(): void {
  if (!Explorer.选中内容) return;
  const 目标 = Explorer.选中内容;
  const el = document.getElementById("ex-info-name") as HTMLElement;
  // 分离基础名和扩展名：后缀不可编辑
  const 真实扩展名 = 目标.realName?.includes(".") ? 目标.realName.slice(目标.realName.lastIndexOf(".")) : "";
  let 基础名 = 目标.name;
  if (真实扩展名 && 目标.name.endsWith(真实扩展名)) {
    基础名 = 目标.name.slice(0, -真实扩展名.length);
  }
  开始内联编辑(el, 基础名, async (v) => {
    const 最终名 = v + 真实扩展名;
    if (目标.resourceId != null) {
      await window.kugua.request("mkg", "mkg.alias.set", { resourceId: 目标.resourceId, alias: 最终名 });
    } else {
      await window.kugua.request("mkg", "mkg.node.renameTitle", { nodeId: 目标.id, title: 最终名 });
    }
  });
}

export function 开始内联编辑真实文件名(): void {
  if (!Explorer.选中内容?.resourceId || !Explorer.选中内容.realName) return;
  const el = document.getElementById("ex-info-realname") as HTMLElement;
  // 分离基础名和扩展名：后缀不可编辑
  const 真实扩展名 = Explorer.选中内容.realName.includes(".") ? Explorer.选中内容.realName.slice(Explorer.选中内容.realName.lastIndexOf(".")) : "";
  const 基础名 = 真实扩展名 ? Explorer.选中内容.realName.slice(0, -真实扩展名.length) : Explorer.选中内容.realName;
  开始内联编辑(el, 基础名, async (v) => {
    if (Explorer.选中内容?.resourceId == null) return;
    await window.kugua.request("mkg", "mkg.resource.renameFile", { resourceId: Explorer.选中内容.resourceId, newName: v + 真实扩展名 });
  });
}

// ===== 框选（拖拽矩形批量选择） =====
export function 绑定框选(容器: HTMLElement): void {
  容器.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-id]")) return;
    const 容器Rect = 容器.getBoundingClientRect();
    const 起始X = e.clientX - 容器Rect.left;
    const 起始Y = e.clientY - 容器Rect.top;
    const box = document.createElement("div");
    box.className = "ex-selection-box";
    容器.appendChild(box);
    const 初始选择 = new Set(Explorer.选中节点ID);
    const 增选 = e.ctrlKey || e.metaKey;
    const 命中ID = new Set<number>();
    const onMove = (ev: MouseEvent): void => {
      const left = Math.min(起始X, ev.clientX - 容器Rect.left);
      const top = Math.min(起始Y, ev.clientY - 容器Rect.top);
      const w = Math.abs(ev.clientX - 容器Rect.left - 起始X);
      const h = Math.abs(ev.clientY - 容器Rect.top - 起始Y);
      box.style.left = left + "px";
      box.style.top = top + "px";
      box.style.width = w + "px";
      box.style.height = h + "px";
      const 框 = { left, top, right: left + w, bottom: top + h };
      命中ID.clear();
      容器.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const rr = { left: r.left - 容器Rect.left, top: r.top - 容器Rect.top, right: r.right - 容器Rect.left, bottom: r.bottom - 容器Rect.top };
        const 命中 = !(rr.right < 框.left || rr.left > 框.right || rr.bottom < 框.top || rr.top > 框.bottom);
        el.classList.toggle("selected", 命中);
        if (命中) 命中ID.add(Number(el.dataset.id));
      });
    };
    const onUp = (): void => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      box.remove();
      if (增选) {
        for (const id of 命中ID) Explorer.选中节点ID.add(id);
      } else {
        Explorer.选中节点ID = 命中ID;
      }
      const 列表 = Explorer.筛选内容();
      Explorer.选中内容 = Explorer.选中节点ID.size > 0 ? 列表.find((x) => Explorer.选中节点ID.has(x.id)) ?? null : null;
      if (Explorer.选中节点ID.size > 0) Explorer.上次点击ID = [...Explorer.选中节点ID][Explorer.选中节点ID.size - 1];
      更新内容信息面板();
      更新批量删除按钮();
      Explorer.渲染内容列表();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ===== 标签树 / 关联标签 / 筛选摘要 =====
// 由 07-explorer.ts 拆分而来。
import { Explorer } from "./07-explorer";
import { 打开方式配置, 标签节点, 素材 } from "./01-types";
import { 渲染Markdown } from "./02-chat-core";
import { 添加消息 } from "./03-preview";
import { 渲染关联, 清空关联 } from "./07o-explorer-relations";
import { 渲染位置列表, 渲染保存视图 } from "./07h-explorer-views";
import { 复制文本, 开始内联编辑名称, 开始内联编辑真实文件名, 显示上下文菜单 } from "./07i-explorer-actions";
import { 转义HTML } from "./08-logs";

// ===== 标签导航与关联标签 =====
export function 找到标签名(tagId: number): string {
  const stack: 标签节点[] = [...Explorer.标签树];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === tagId) return n.name;
    if (n.children) stack.push(...n.children);
  }
  return "标签";
}

/** 在标签树中按名称模糊查找标签 */
export function 搜索标签节点(keyword: string): 标签节点[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  const 命中: 标签节点[] = [];
  const stack: 标签节点[] = [...Explorer.标签树];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.name.toLowerCase().includes(kw)) 命中.push(n);
    if (n.children) stack.push(...n.children);
  }
  return 命中;
}

/** 导航到某个标签：更新当前标签、刷新内容列表与标签树 */
export function 导航到标签(tagId: number): void {
  Explorer.当前标签ID = tagId;
  Explorer.选中内容 = null;
  Explorer.文件信息面板.classList.add("hidden");
  void Explorer.加载所有内容();
  void 渲染关联标签();
  渲染标签树();
}


export function 更新内容信息面板(): void {
  if (!Explorer.选中内容) {
    Explorer.文件信息面板.classList.add("hidden");
    清空关联();
    return;
  }
  Explorer.文件信息面板.classList.remove("hidden");

  const f = Explorer.选中内容;

  // 信息栏预览：图片/视频显示缩略图，文本类显示内容摘要
  const 预览元素 = document.getElementById("ex-info-preview") as HTMLDivElement;
  预览元素.innerHTML = "";
  预览元素.classList.remove("hidden");
  if (f.category === "图片" && f.path) {
    const 图 = document.createElement("img");
    图.className = "ex-info-preview-img";
    图.src = Explorer.转文件URL(f.path);
    图.alt = f.name;
    图.onerror = () => { 预览元素.classList.add("hidden"); };
    预览元素.appendChild(图);
  } else if (f.category === "视频" && f.path) {
    const 视 = document.createElement("video");
    视.className = "ex-info-preview-video";
    视.src = Explorer.转文件URL(f.path);
    视.muted = true;
    视.preload = "metadata";
    视.playsInline = true;
    视.controls = true;
    视.onerror = () => { 预览元素.classList.add("hidden"); };
    预览元素.appendChild(视);
  } else if (["文本", "文本段", "点子", "素材"].includes(f.category) && f.content) {
    const 摘要 = document.createElement("div");
    摘要.className = "ex-info-preview-text";
    摘要.innerHTML = 渲染Markdown(f.content.replace(/\s+/g, " ").trim() || "（无内容）");
    预览元素.appendChild(摘要);
  } else {
    预览元素.classList.add("hidden");
  }

  // 知识库名称（双击重命名，右键复制/重命名）- 扩展名独立显示不可编辑
  const nameEl = document.getElementById("ex-info-name") as HTMLDivElement;
  const 真实扩展名 = f.realName?.includes(".") ? f.realName.slice(f.realName.lastIndexOf(".")) : "";
  let 显示名Val = Explorer.显示名(f);
  if (真实扩展名 && 显示名Val.endsWith(真实扩展名)) {
    显示名Val = 显示名Val.slice(0, -真实扩展名.length);
  }
  nameEl.textContent = 显示名Val;
  // 扩展名追加显示
  const extEl = document.getElementById("ex-info-name-ext") as HTMLSpanElement | null;
  if (extEl) extEl.textContent = 真实扩展名;
  nameEl.title = "双击重命名（仅知识库内名称），右键复制名称";
  nameEl.ondblclick = () => 开始内联编辑名称();
  nameEl.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    显示上下文菜单(e.clientX, e.clientY, [
      { label: "复制知识库名称", icon: "📋", onClick: () => void 复制文本(Explorer.显示名(f)) },
      { label: "重命名知识库名称", icon: "✏️", onClick: () => 开始内联编辑名称() },
    ]);
  };

  document.getElementById("ex-info-size")!.textContent = Explorer.内容大小文本(f);

  // 真实文件名（双击重命名物理文件，右键复制）
  const realEl = document.getElementById("ex-info-realname") as HTMLSpanElement;
  const 是文件节点 = f.resourceId != null;
  realEl.textContent = f.realName ?? (是文件节点 ? "-" : "—");
  realEl.title = f.realName ? "双击重命名本地文件，右键复制真实文件名" : "非文件内容没有真实文件名";
  realEl.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const 项: Array<Explorer.菜单项 | null> = [];
    if (f.realName) 项.push({ label: "复制真实文件名", icon: "📋", onClick: () => void 复制文本(f.realName!) });
    if (f.realName) 项.push({ label: "重命名物理文件", icon: "📝", onClick: () => 开始内联编辑真实文件名() });
    if (项.length > 0) 显示上下文菜单(e.clientX, e.clientY, 项);
  };
  if (f.realName) {
    realEl.classList.add("editable");
    realEl.ondblclick = () => 开始内联编辑真实文件名();
  } else {
    realEl.classList.remove("editable");
    realEl.ondblclick = null;
  }

  // 路径（右键复制/在资源管理器中打开）
  const pathEl = document.getElementById("ex-info-path") as HTMLSpanElement;
  pathEl.textContent = f.path || (f.type === "resource" || f.type === "directory" ? "-" : "（" + Explorer.节点形式名(f.type) + "）");
  pathEl.title = "右键复制路径或在资源管理器中打开";
  pathEl.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const 项: Array<Explorer.菜单项 | null> = [];
    if (f.path) {
      项.push({ label: "复制路径", icon: "📋", onClick: () => void 复制文本(f.path!) });
      if (是文件节点) 项.push({ label: "在资源管理器中显示", icon: "🗂️", onClick: () => void 在资源管理器中显示(f) });
    }
    if (项.length > 0) 显示上下文菜单(e.clientX, e.clientY, 项);
  };

  // 修改时间（文件最后修改）与入库时间
  document.getElementById("ex-info-modified")!.textContent = Explorer.格式化时间(f.modifiedTime || f.updatedAt);
  document.getElementById("ex-info-indexed")!.textContent = Explorer.格式化时间(f.indexedAt || f.createdAt);

  // 内联标签：chips（点击整个 chip 可移除）+ 联想输入
  Explorer.内联标签编辑ID.clear();
  for (const tid of f.tagIds) Explorer.内联标签编辑ID.add(tid);
  渲染标签chips("ex-info-tags", Explorer.内联标签编辑ID, (tid) => {
    Explorer.内联标签编辑ID.delete(tid);
    void 内联保存标签();
  });
  // 渲染可勾选标签树（信息面板内）
  Explorer.渲染可勾选标签树(Explorer.标签树, {
    containerId: "ex-info-tag-tree",
    选中的标签ID: Explorer.内联标签编辑ID,
    onToggle: () => {
      渲染标签chips("ex-info-tags", Explorer.内联标签编辑ID, (tid) => {
        Explorer.内联标签编辑ID.delete(tid);
        void 内联保存标签();
      });
      void 内联保存标签();
    },
  });

  // 关联区块：知识库的核心价值不只是「找得到」，更是「连得上」
  void 渲染关联(f.id);
}

/** 渲染本标签及一串关联标签（基于共现频率） */
export async function 渲染关联标签(): Promise<void> {
  const 容器 = document.getElementById("ex-related-tags") as HTMLDivElement | null;
  if (!容器) return;
  容器.innerHTML = "";
  // 搜索时：若关键词匹配到标签，展示匹配标签供跳转
  if (Explorer.当前标签ID === "all") {
    const 匹配 = 搜索标签节点(Explorer.搜索关键词);
    if (匹配.length === 0) { 容器.classList.add("hidden"); return; }
    容器.classList.remove("hidden");
    const 标签 = document.createElement("span");
    标签.className = "ex-rel-label";
    标签.textContent = "匹配的标签";
    容器.appendChild(标签);
    for (const m of 匹配.slice(0, 12)) {
      const chip = document.createElement("button");
      chip.className = "ex-rel-tag";
      chip.textContent = m.name;
      chip.addEventListener("click", () => 导航到标签(m.id));
      容器.appendChild(chip);
    }
    return;
  }
  try {
    const 结果 = (await window.kugua.request("mkg", "mkg.tag.related", { tagId: Explorer.当前标签ID, limit: 12 })) as Array<{
      tag: { id: number; name: string }; 共现: number;
    }>;
    容器.classList.remove("hidden");
    容器.innerHTML = "";
    const 标签 = document.createElement("span");
    标签.className = "ex-rel-label";
    标签.textContent = "关联标签";
    容器.appendChild(标签);
    const 当前chip = document.createElement("button");
    当前chip.className = "ex-rel-tag current";
    当前chip.textContent = 找到标签名(Explorer.当前标签ID as number);
    容器.appendChild(当前chip);
    for (const r of 结果) {
      const chip = document.createElement("button");
      chip.className = "ex-rel-tag";
      chip.title = "与当前标签共现 " + r.共现 + " 次";
      chip.innerHTML = `<span>${r.tag.name}</span><span class="ex-rel-co">${r.共现}</span>`;
      chip.addEventListener("click", () => 导航到标签(r.tag.id));
      容器.appendChild(chip);
    }
  } catch {
    容器.classList.add("hidden");
  }
}

/** 切换标签的 AI 可读 opt-in（后端 mkg.tag.setAiPublic） */
export async function 切换标签AIPublic(tagId: number, aiPublic: boolean): Promise<void> {
  try {
    await window.kugua.request("mkg", "mkg.tag.setAiPublic", { tagId, aiPublic });
    // 更新本地标签树状态
    const stack: 标签节点[] = [...Explorer.标签树];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === tagId) n.aiPublic = aiPublic;
      if (n.children) stack.push(...n.children);
    }
    渲染标签树();
    添加消息(aiPublic ? "已开启 AI 可读：" + 找到标签名(tagId) : "已关闭 AI 可读：" + 找到标签名(tagId), "system");
  } catch (err) {
    添加消息("切换 AI 可读失败：" + String(err), "error");
  }
}

export function 渲染标签树(): void {
  Explorer.标签树容器.innerHTML = "";

  const allItem = document.createElement("div");
  allItem.className = "ex-tag-all";
  if (Explorer.当前标签ID === "all") allItem.classList.add("active");
  allItem.innerHTML = '<span class="ex-tag-icon">🗂️</span> 所有内容';
  allItem.addEventListener("click", () => {
    Explorer.当前标签ID = "all";
    Explorer.选中内容 = null;
    Explorer.文件信息面板.classList.add("hidden");
    void 渲染关联标签();
    void Explorer.加载所有内容();
    渲染标签树();
  });
  Explorer.标签树容器.appendChild(allItem);

  function renderNode(node: 标签节点, depth: number, parent: HTMLElement): void {
    const hasChildren = node.children.length > 0;
    const item = document.createElement("div");
    item.className = "ex-tag-item";
    item.style.paddingLeft = (0.5 + depth * 14) + "px";
    if (Explorer.当前标签ID === node.id) item.classList.add("active");
    const expand = document.createElement("span");
    expand.className = "ex-tag-expand";
    if (!hasChildren) expand.classList.add("empty");
    expand.textContent = "▼";
    item.appendChild(expand);
    const icon = document.createElement("span");
    icon.className = "ex-tag-icon";
    icon.textContent = depth === 0 ? "📁" : "🏷️";
    icon.style.fontSize = "0.75rem";
    item.appendChild(icon);
    const nameText = document.createElement("span");
    nameText.textContent = node.name;
    nameText.style.overflow = "hidden";
    nameText.style.textOverflow = "ellipsis";
    item.appendChild(nameText);

    // AI 可读开关：点击切换 opt-in（后端 mkg.tag.setAiPublic）
    const aiBtn = document.createElement("span");
    aiBtn.className = "ex-tag-ai" + (node.aiPublic ? " on" : "");
    aiBtn.textContent = "🤖";
    aiBtn.title = node.aiPublic
      ? "AI 可读（点击关闭）——该标签下内容允许 AI 读取"
      : "AI 不可读（点击开启）——开启后该标签下内容允许 AI 读取";
    aiBtn.style.fontSize = "0.7rem";
    aiBtn.style.opacity = node.aiPublic ? "1" : "0.35";
    aiBtn.style.cursor = "pointer";
    aiBtn.style.marginLeft = "auto";
    aiBtn.style.flexShrink = "0";
    aiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void 切换标签AIPublic(node.id, !node.aiPublic);
    });
    item.appendChild(aiBtn);

    const childrenDiv = document.createElement("div");
    childrenDiv.className = "ex-tag-children";

    let expanded = true;
    expand.addEventListener("click", (e) => {
      e.stopPropagation();
      expanded = !expanded;
      if (expanded) {
        expand.textContent = "▼";
        expand.classList.remove("collapsed");
        childrenDiv.classList.remove("collapsed");
      } else {
        expand.textContent = "▶";
        expand.classList.add("collapsed");
        childrenDiv.classList.add("collapsed");
      }
    });

    item.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("ex-tag-expand")) return;
      导航到标签(node.id);
    });

    parent.appendChild(item);
    if (hasChildren) {
      parent.appendChild(childrenDiv);
      for (const child of node.children) {
        renderNode(child, depth + 1, childrenDiv);
      }
    }
  }

  for (const root of Explorer.标签树) {
    renderNode(root, 0, Explorer.标签树容器);
  }
}

  /** 渲染标签 chips（点击整个 chip 可移除） */
export function 渲染标签chips(容器ID: string, 已选: Set<number>, onRemove: (id: number) => void): void {
  const 容器 = document.getElementById(容器ID) as HTMLDivElement | null;
  if (!容器) return;
  容器.innerHTML = "";
  if (已选.size === 0) {
    容器.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(无标签)</span>';
    return;
  }
  const idToPath = new Map<number, string>();
  const walk = (nodes: 标签节点[], trail: string[]): void => {
    for (const n of nodes) {
      const pp = [...trail, n.name];
      idToPath.set(n.id, pp.join(" / "));
      if (n.children) walk(n.children, pp);
    }
  };
  walk(Explorer.标签树, []);
  for (const tid of 已选) {
    const chip = document.createElement("span");
    chip.className = "tag-chip removable";
    chip.title = idToPath.get(tid) || ("标签ID:" + tid) + "（点击移除）";
    chip.textContent = (idToPath.get(tid) ?? "ID:" + tid) + " ×";
    chip.addEventListener("click", () => onRemove(tid));
    容器.appendChild(chip);
  }
}

/**
 * 标签联想输入（共享：新建片段对话框与文件详情页）
 * - 输入后下拉联想（默认高亮首个）
 * - ↑/↓ 移动高亮，Tab 采纳当前高亮项，鼠标点击直接采纳
 * - 回车：把输入文字作为标签加入（不存在则创建）
 */
export function 绑定标签联想输入(input: HTMLInputElement, 已选: Set<number>, onChanged: () => void): void {
  let 过滤列表: Array<{ id: number; name: string; path: string }> = [];
  let 高亮 = 0;
  const 下拉 = document.createElement("div");
  下拉.className = "tag-suggest hidden";
  (input.parentElement as HTMLElement).appendChild(下拉);

  const 全部标签 = (): Array<{ id: number; name: string; path: string }> => {
    const 结果: Array<{ id: number; name: string; path: string }> = [];
    const walk = (nodes: 标签节点[], trail: string[]): void => {
      for (const n of nodes) {
        const pp = [...trail, n.name];
        结果.push({ id: n.id, name: n.name, path: pp.join("/") });
        if (n.children) walk(n.children, pp);
      }
    };
    walk(Explorer.标签树, []);
    return 结果;
  };
  const 采纳 = (t: { id: number; name: string; path: string }): void => {
    已选.add(t.id);
    input.value = "";
    下拉.classList.add("hidden");
    onChanged();
  };

  const 添加输入 = async (): Promise<void> => {
    const v = input.value.trim();
    if (!v) return;
    try {
      // 逗号分隔的是多个并列标签；createTree 的 names 是单条路径，
      // 所以每一项单独创建，并把所有创建出的标签都加入已选
      const 名称列表 = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      for (const 名称 of 名称列表) {
        const 标签 = (await window.kugua.request("mkg", "mkg.tag.createTree", {
          names: [名称],
        })) as { id: number };
        已选.add(标签.id);
      }
      input.value = "";
      下拉.classList.add("hidden");
      await Explorer.加载标签树();
      onChanged();
    } catch (err) {
      添加消息("添加标签失败：" + String(err), "error");
    }
  };

  const 渲染 = (): void => {
    const q = input.value.trim().toLowerCase();
    下拉.innerHTML = "";
    if (!q) {
      下拉.classList.add("hidden");
      return;
    }
    过滤列表 = 全部标签()
      .filter((t) => t.name.toLowerCase().includes(q) || t.path.toLowerCase().includes(q))
      .slice(0, 8);
    if (过滤列表.length === 0) {
      下拉.classList.add("hidden");
      return;
    }
    高亮 = 0;
    过滤列表.forEach((t, i) => {
      const 项 = document.createElement("div");
      项.className = "tag-suggest-item" + (i === 高亮 ? " active" : "");
      项.textContent = t.path;
      项.addEventListener("mousedown", (e) => {
        e.preventDefault();
        采纳(t);
      });
      下拉.appendChild(项);
    });
    下拉.classList.remove("hidden");
  };

  const 更新高亮 = (): void => {
    下拉.querySelectorAll<HTMLElement>(".tag-suggest-item").forEach((el, i) => {
      el.classList.toggle("active", i === 高亮);
    });
  };

  input.addEventListener("input", 渲染);
  input.addEventListener("focus", 渲染);
  input.addEventListener("keydown", (e) => {
    const 开 = !下拉.classList.contains("hidden");
    if (e.key === "ArrowDown" && 开) {
      e.preventDefault();
      高亮 = (高亮 + 1) % 过滤列表.length;
      更新高亮();
      return;
    }
    if (e.key === "ArrowUp" && 开) {
      e.preventDefault();
      高亮 = (高亮 - 1 + 过滤列表.length) % 过滤列表.length;
      更新高亮();
      return;
    }
    if (e.key === "Tab" && 开) {
      e.preventDefault();
      const t = 过滤列表[高亮];
      if (t) 采纳(t);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void 添加输入();
      return;
    }
    if (e.key === "Escape") 下拉.classList.add("hidden");
  });
  input.addEventListener("blur", () => setTimeout(() => 下拉.classList.add("hidden"), 120));
}

/** 保存内联标签（详情栏） */
export async function 内联保存标签(): Promise<void> {
  if (!Explorer.选中内容) return;
  try {
    await window.kugua.request("mkg", "mkg.node.setTags", { nodeId: Explorer.选中内容.id, tagIds: Array.from(Explorer.内联标签编辑ID) });
    Explorer.选中内容 = { ...Explorer.选中内容, tagIds: Array.from(Explorer.内联标签编辑ID) };
    更新内容信息面板();
  } catch (err) {
    添加消息("保存标签失败：" + String(err), "error");
  }
}

export async function 在资源管理器中显示(item: Explorer.内容条目): Promise<void> {
  if (item.resourceId == null) { 添加消息("该内容不是文件，无法显示", "system"); return; }
  try {
    await window.kugua.request("mkg", "mkg.file.explorer", { resourceId: item.resourceId });
  } catch (err) {
    添加消息("打开资源管理器失败：" + String(err), "error");
  }
}

export async function 复制物理路径(item: Explorer.内容条目): Promise<void> {
  if (item.resourceId == null) { 添加消息("该内容不是文件，无法复制路径", "system"); return; }
  try {
    const result = (await window.kugua.request("mkg", "mkg.file.physicalPath", { resourceId: item.resourceId })) as string;
    await navigator.clipboard.writeText(result);
    Explorer.状态栏计数.textContent = "已复制路径：" + result;
    setTimeout(() => { Explorer.状态栏计数.textContent = Explorer.筛选内容().length + " 个项目"; }, 2000);
  } catch (err) {
    添加消息("复制路径失败：" + String(err), "error");
  }
}

export async function 设置别名(item: Explorer.内容条目, alias: string): Promise<void> {
  if (item.resourceId == null) { 添加消息("该内容不是文件，无法重命名", "system"); return; }
  try {
    await window.kugua.request("mkg", "mkg.alias.set", { resourceId: item.resourceId, alias });
    await Explorer.加载所有内容();
    添加消息("已设置别名：" + alias, "system");
  } catch (err) {
    添加消息("设置别名失败：" + String(err), "error");
  }
}

export async function 加载打开方式列表(extension?: string): Promise<void> {
  try {
    Explorer.打开方式列表 = (await window.kugua.request("mkg", "mkg.openwith.list", { extension })) as 打开方式配置[];
  } catch {
    Explorer.打开方式列表 = [];
  }
}

/** 当前筛选摘要（位置/标签/类型/关键词） */
export function 渲染筛选摘要(): void {
  const 容器 = document.getElementById("ex-filter-summary");
  if (!容器) return;
  const 项: string[] = [];
  if (Explorer.当前位置ID != null) {
    const loc = Explorer.受管位置列表.find((l) => l.id === Explorer.当前位置ID);
    if (loc) 项.push("位置：" + (loc.name || loc.path));
  }
  if (typeof Explorer.当前标签ID === "number") 项.push("标签：" + 找到标签名(Explorer.当前标签ID));
  if (Explorer.类型筛选 !== "all") 项.push("类型：" + Explorer.类型筛选);
  if (Explorer.搜索关键词.trim()) 项.push("搜索：" + Explorer.搜索关键词.trim());
  if (Explorer.当前视图ID != null) {
    const v = Explorer.保存视图列表.find((x) => x.id === Explorer.当前视图ID);
    if (v) 项.push("视图：" + v.name);
  }
  if (项.length === 0) {
    容器.classList.add("hidden");
    容器.innerHTML = "";
    return;
  }
  容器.classList.remove("hidden");
  容器.innerHTML =
    '<span class="efs-label">当前筛选</span>' +
    项.map((t) => `<span class="efs-chip">${转义HTML(t)}</span>`).join("") +
    '<button id="efs-clear" class="efs-clear">清除</button>';
  document.getElementById("efs-clear")?.addEventListener("click", () => {
    Explorer.当前标签ID = "all";
    Explorer.当前位置ID = null;
    Explorer.类型筛选 = "all";
    Explorer.搜索关键词 = "";
    Explorer.当前视图ID = null;
    const 搜 = document.getElementById("ex-search") as HTMLInputElement | null;
    if (搜) 搜.value = "";
    const 类 = document.getElementById("ex-type-filter") as HTMLSelectElement | null;
    if (类) 类.value = "all";
    void Explorer.加载所有内容();
    渲染标签树();
    渲染位置列表();
    渲染保存视图();
  });
}

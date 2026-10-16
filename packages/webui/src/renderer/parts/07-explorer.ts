import { 卡片, 打开方式配置, 标签节点, 看板列, 笔记, 素材 } from "./01-types";
import { 渲染Markdown } from "./02-chat-core";
import { base64转字节, 取媒体编解码, 打开图片预览弹窗, 添加消息, 清理图片预览 } from "./03-preview";
import { 关闭确认对话框, 刷新统计, 显示确认对话框 } from "./06-shell";
import { 格式化时间, 转义HTML } from "./08-logs";
import { 切换视图 } from "./11-tabs";
import { 找到标签名, 搜索标签节点, 导航到标签, 更新内容信息面板, 渲染关联标签, 渲染标签树, 渲染标签chips, 绑定标签联想输入, 内联保存标签, 在资源管理器中显示, 复制物理路径, 设置别名, 加载打开方式列表, 渲染筛选摘要 } from "./07j-explorer-tags";
import { 显示右键菜单, 隐藏右键菜单, 显示上下文菜单, 复制文本, 更新批量删除按钮, 删除选中内容, 删除到回收站, 开始内联编辑名称, 开始内联编辑真实文件名, 绑定框选 } from "./07i-explorer-actions";
import { 绑定智能视图与位置事件, 导出侧车, 渲染保存视图, 渲染位置列表, 加载保存视图, 加载位置 } from "./07h-explorer-views";
import { 打开内容, 系统默认打开, 关闭内置编辑器, 打开新建片段对话框, 绑定编辑器事件 } from "./07g-explorer-editor";
import { 加载看板, 绑定看板事件 } from "./07f-explorer-board";
import { 绑定笔记事件 } from "./07d-explorer-notes";
import { 绑定素材事件 } from "./07e-explorer-materials";
import { 加载工作区视图, 绑定工作区事件 } from "./07k-explorer-workspace";

// ===== 资源管理器 =====

export namespace Explorer {
  /** 统一内容对象：名称 + 内容 + 一系列标签 */
  export interface 内容条目 {
    id: number;
    type: string;
    category: string;
    name: string;
    content: string;
    tagIds: number[];
    tagPaths: string[][];
    createdAt: number;
    updatedAt: number;
    resourceId: number | null;
    path: string | null;
    size: number;
    modifiedTime: number;
    indexedAt: number;
    realName: string | null;
    extension: string;
    meta: Record<string, unknown>;
  }

  /** 组合查询条件（对应 mkg 执行查询） */
  export interface 查询条件 {
    tags?: number[];
    notTags?: number[];
    type?: string;
    text?: string;
    locations?: number[];
    sort?: "import" | "name" | "updated";
  }
  export interface 保存视图 {
    id: number;
    name: string;
    query: 查询条件;
    icon: string | null;
    sort: number;
    createdAt: number;
  }
  export interface 位置 {
    id: number;
    path: string;
    name: string | null;
    mode: "watch" | "manual";
    excludes: string[];
    createdAt: number;
  }

  let 当前视图模式: "large" | "list" | "details" = "large";
  export let 当前标签ID: number | "all" = "all";
  export let 搜索关键词 = "";
  export let 类型筛选: string = "all";
  export let 排序方式: "import" | "name" | "updated" = "import";
  /** 当前智能视图 / 位置筛选（阶段 2） */
  export let 当前视图ID: number | null = null;
  export let 当前位置ID: number | null = null;
  export let 保存视图列表: 保存视图[] = [];
  export let 受管位置列表: 位置[] = [];
    export let 所有内容: 内容条目[] = [];
  export let 标签树: 标签节点[] = [];
  export let 选中内容: 内容条目 | null = null;
  /** 批量选中（节点 id 集合）：支持框选 / Ctrl 多选 / Shift 范围选择 */
  export let 选中节点ID = new Set<number>();
  export let 上次点击ID: number | null = null;
  export let 打开方式列表: 打开方式配置[] = [];
  /** 打开方式对话框（由下方事件初始化区块赋值；命名空间级声明便于右键菜单引用） */
  let 显示打开方式对话框: (file: 内容条目) => void = () => {};
  let 搜索防抖: number | null = null;
  let 大图标列数 = 6;
  // 内联标签编辑（详情栏）
  export let 内联标签编辑ID = new Set<number>();

  export const 大图标容器 = document.getElementById("ex-items-large") as HTMLDivElement;
  export const 列表容器 = document.getElementById("ex-items-list") as HTMLDivElement;
  export const 详情容器 = document.getElementById("ex-details-body") as HTMLDivElement;
  export const 标签树容器 = document.getElementById("ex-tag-tree") as HTMLDivElement;
  export const 文件信息面板 = document.getElementById("ex-file-info") as HTMLDivElement;
  // ===== 分类栏折叠/展开 =====
  const 分类栏 = document.getElementById("ex-cat-sidebar") as HTMLElement;
  const 分类切换按钮 = document.getElementById("ex-cat-toggle") as HTMLButtonElement | null;
  function 应用分类折叠状态(): void {
    const 折叠 = 分类栏.classList.contains("collapsed");
    if (分类切换按钮) {
      分类切换按钮.innerHTML = 折叠 ? "&#x25B6;" : "&#x25C0;";
      分类切换按钮.title = 折叠 ? "展开分类栏" : "折叠分类栏";
    }
  }
  分类切换按钮?.addEventListener("click", () => {
    分类栏.classList.toggle("collapsed");
    应用分类折叠状态();
  });
  应用分类折叠状态();

  export const 右键菜单 = document.getElementById("context-menu") as HTMLDivElement;
  export const 状态栏计数 = document.getElementById("ex-status-count") as HTMLSpanElement;
  const 搜索框 = document.getElementById("ex-search") as HTMLInputElement;

  function 获取文件图标类(name: string, kind: string): string {
    if (kind === "directory") return "fi-folder";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (["txt", "md", "rtf", "log", "csv"].includes(ext)) return "fi-text";
    if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "ico"].includes(ext)) return "fi-image";
    if (["ts", "tsx", "js", "jsx", "py", "java", "c", "cpp", "cs", "go", "rs", "rb", "php", "html", "css", "json", "xml", "yaml", "yml", "sh", "bat", "ps1", "sql"].includes(ext)) return "fi-code";
    if (["db", "sqlite", "sqlite3", "dat", "bin"].includes(ext)) return "fi-data";
    if (["exe", "msi", "dll", "com", "bat", "cmd"].includes(ext)) return "fi-exec";
    if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) return "fi-archive";
    if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt"].includes(ext)) return "fi-doc";
    return "fi-other";
  }

  function 获取文件类型描述(name: string, kind: string): string {
    if (kind === "directory") return "文件夹";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    const 映射: Record<string, string> = {
      txt: "文本文件", md: "Markdown文档", json: "JSON数据", js: "JavaScript脚本", ts: "TypeScript脚本",
      py: "Python脚本", html: "HTML文档", css: "CSS样式表", png: "PNG图片", jpg: "JPEG图片",
      jpeg: "JPEG图片", gif: "GIF图片", svg: "SVG矢量图", pdf: "PDF文档", exe: "可执行文件",
      zip: "ZIP压缩包", rar: "RAR压缩包", "7z": "7z压缩包", bat: "批处理文件", ps1: "PowerShell脚本",
      csv: "CSV表格", xml: "XML文档", yaml: "YAML配置", yml: "YAML配置", log: "日志文件",
      c: "C源码", cpp: "C++源码", cs: "C#源码", java: "Java源码", go: "Go源码", rs: "Rust源码",
      db: "数据库文件", sqlite: "SQLite数据库",
    };
    return 映射[ext] || (ext ? ext.toUpperCase() + " 文件" : "文件");
  }

  function 获取扩展名(name: string): string {
    if (!name.includes(".")) return "";
    return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  }

  function 格式化大小(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return size.toFixed(i === 0 ? 0 : 1) + " " + units[i];
  }

  function 中文字符数(str: string): number {
    if (!str) return 0;
    let n = 0;
    for (const ch of str) if (/[\u4e00-\u9fff]/.test(ch)) n++;
    return n;
  }

  /** 内容大小文本：目录为空；文本类包含文件大小与中文字数 */
  export function 内容大小文本(file: 内容条目): string {
    if (file.category === "目录") return "";
    const 字节 = file.size ? 格式化大小(file.size) : "";
    const 文本类 = file.category === "文本" || file.category === "文本段" || file.category === "点子" || file.category === "素材";
    if (!文本类) return 字节;
    const 字数 = 中文字符数(file.content);
    return [字节, 字数 > 0 ? 字数 + " 字" : ""].filter(Boolean).join(" · ");
  }

  export function 格式化时间(秒: number): string {
    if (!秒) return "-";
    const d = new Date(秒 * 1000);
    return d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  export function 显示名(r: 内容条目): string {
    return r.name;
  }

  /** 节点底层形式（resource/snippet/note/material/directory）的中文名 */
  export function 节点形式名(type: string): string {
    switch (type) {
      case "resource": return "资源";
      case "snippet": return "文本段";
      case "note": return "点子";
      case "material": return "素材";
      case "directory": return "目录";
      case "card": return "卡片";
      default: return type || "-";
    }
  }

  /** 根据内容分类返回图标类 */
  function 获取内容图标类(category: string): string {
    if (category === "目录") return "fi-folder";
    if (category === "图片") return "fi-image";
    if (category === "音乐") return "fi-audio";
    if (category === "视频") return "fi-video";
    if (category === "文本") return "fi-text";
    if (category === "文本段") return "fi-snippet";
    if (category === "点子") return "fi-note";
    if (category === "素材") return "fi-material";
    return "fi-file";
  }

  function 创建文件图标(item: 内容条目, size: "large" | "small" = "large"): HTMLDivElement {
    const icon = document.createElement("div");
    const cls = 获取内容图标类(item.category);
    icon.className = "ex-file-icon " + cls;
    if (item.category === "目录") {
      icon.textContent = "📁";
      icon.style.fontSize = size === "large" ? "2rem" : "0.8rem";
      icon.style.background = "";
    } else if (item.category === "点子") {
      icon.textContent = "💡";
      icon.style.fontSize = size === "large" ? "2rem" : "0.8rem";
      icon.style.background = "";
    } else if (item.category === "素材") {
      icon.textContent = "🖼️";
      icon.style.fontSize = size === "large" ? "2rem" : "0.8rem";
      icon.style.background = "";
    } else if (item.category === "文本段") {
      icon.textContent = "📝";
      icon.style.fontSize = size === "large" ? "2rem" : "0.8rem";
      icon.style.background = "";
    } else {
      const ext = item.extension || 获取扩展名(item.name);
      icon.textContent = ext ? ext.slice(0, 3) : "…";
      if (size === "small") {
        icon.style.fontSize = "0.55rem";
      }
      const extBadge = document.createElement("span");
      extBadge.className = "fi-ext";
      extBadge.textContent = (ext || "文件").toUpperCase();
      if (size === "small") extBadge.style.display = "none";
      icon.appendChild(extBadge);
    }
    return icon;
  }


  /** 把本地物理路径转成 file:// URL */
  export function 转文件URL(路径: string | null | undefined): string {
    if (!路径) return "";
    let p = 路径.replace(/\\/g, "/");
    if (!p.startsWith("/")) p = "/" + p;
    return "file://" + encodeURI(p);
  }

  /** 大图标(缩略图)视图的内容呈现：图片/视频显示缩略图，文本/文本段/点子/素材显示开头一段，其余用图标 */
  function 创建大图标内容(item: 内容条目): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ex-thumb";
    if (item.category === "图片" && item.path) {
      const img = document.createElement("img");
      img.className = "ex-thumb-img";
      img.src = 转文件URL(item.path);
      img.alt = item.name;
      img.draggable = false;
      img.onerror = () => {
        // 缩略图加载失败时回退为图标
        wrap.replaceWith(创建文件图标(item, "large"));
      };
      wrap.appendChild(img);
      return wrap;
    }
    if (item.category === "视频" && item.path) {
      const video = document.createElement("video");
      video.className = "ex-thumb-video";
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = 转文件URL(item.path);
      video.addEventListener("loadedmetadata", () => {
        try {
          // 跳到视频前段附近，展示较可能是有效画面的帧
          video.currentTime = Math.min(1, (video.duration || 0) * 0.1);
        } catch { /* 忽略 */ }
      });
      video.addEventListener("error", () => {
        wrap.replaceWith(创建文件图标(item, "large"));
      });
      wrap.appendChild(video);
      return wrap;
    }
    if (["文本", "文本段", "点子", "素材"].includes(item.category)) {
      const 片段 = (item.content || "").trim().replace(/\s+/g, " ") || "（无内容）";
      const pre = document.createElement("div");
      pre.className = "ex-thumb-text";
      pre.innerHTML = 渲染Markdown(片段.slice(0, 300));
      wrap.appendChild(pre);
      return wrap;
    }
    // 目录/文件/音乐等：保留原有图标
    return 创建文件图标(item, "large");
  }

  export function 筛选内容(): 内容条目[] {
    let items = [...所有内容];
    const kw = 搜索关键词.trim().toLowerCase();
    if (kw) {
      items = items.filter((it) =>
        it.name.toLowerCase().includes(kw) ||
        it.content.toLowerCase().includes(kw) ||
        (it.path ? it.path.toLowerCase().includes(kw) : false),
      );
    }
    if (类型筛选 !== "all") {
      items = items.filter((it) => it.category === 类型筛选);
    }
    const 标签筛选ID = 当前标签ID;
    // 按具体标签筛选已在服务端（含后代标签展开）完成，此处无需再次精确过滤
    if (排序方式 === "name") {
      items.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    } else if (排序方式 === "updated") {
      items.sort((a, b) => b.updatedAt - a.updatedAt);
    } else {
      items.sort((a, b) => a.createdAt - b.createdAt); // 导入顺序（旧→新）
    }
    return items;
  }

  export function 渲染内容列表(): void {
    const files = 筛选内容();
    状态栏计数.textContent = files.length + " 个项目";

    大图标容器.innerHTML = "";
    for (const file of files) {
      const tile = document.createElement("div");
      tile.className = "ex-file-tile";
      if (选中节点ID.has(file.id)) tile.classList.add("selected");
      tile.dataset.id = String(file.id);
      const icon = 创建大图标内容(file);
      const name = document.createElement("div");
      name.className = "ex-file-name";
      name.textContent = 显示名(file);
      tile.appendChild(icon);
      tile.appendChild(name);
      绑定内容项事件(tile, file);
      大图标容器.appendChild(tile);
    }

    列表容器.innerHTML = "";
    for (const file of files) {
      const item = document.createElement("div");
      item.className = "ex-list-item";
      if (选中节点ID.has(file.id)) item.classList.add("selected");
      item.dataset.id = String(file.id);
      const icon = 创建文件图标(file, "small");
      const name = document.createElement("div");
      name.className = "ex-file-name";
      name.textContent = 显示名(file);
      item.appendChild(icon);
      item.appendChild(name);
      if (file.tagPaths && file.tagPaths.length > 0) {
        const 标签条 = document.createElement("div");
        标签条.className = "ex-list-tags";
        标签条.textContent = file.tagPaths.map((p) => p[p.length - 1]).slice(0, 6).join(" · ");
        item.appendChild(标签条);
      }
      绑定内容项事件(item, file);
      列表容器.appendChild(item);
    }

    详情容器.innerHTML = "";
    for (const file of files) {
      const row = document.createElement("div");
      row.className = "ex-detail-row";
      if (选中节点ID.has(file.id)) row.classList.add("selected");
      row.dataset.id = String(file.id);
      const nameCell = document.createElement("div");
      nameCell.className = "dr-name";
      const icon = 创建文件图标(file, "small");
      const nameText = document.createElement("span");
      nameText.textContent = 显示名(file);
      nameCell.appendChild(icon);
      nameCell.appendChild(nameText);
      const typeCell = document.createElement("div");
      typeCell.className = "dr-type";
      typeCell.textContent = file.category;
      const sizeCell = document.createElement("div");
      sizeCell.className = "dr-size";
      sizeCell.textContent = 内容大小文本(file);
      const pathCell = document.createElement("div");
      pathCell.className = "dr-path";
      pathCell.textContent = file.path || "";
      pathCell.title = file.path || "";
      row.appendChild(nameCell);
      row.appendChild(typeCell);
      row.appendChild(sizeCell);
      row.appendChild(pathCell);
      绑定内容项事件(row, file);
      详情容器.appendChild(row);
    }
  }

  function 绑定内容项事件(el: HTMLElement, item: 内容条目): void {
    // 知识库条目可拖拽到聊天侧边栏（附资源路径引用）
    el.draggable = true;
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/kugua-resource", JSON.stringify({ id: item.id, name: item.name, path: item.path ?? null }));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.shiftKey) {
        // Shift：以「上次点击」为锚点做范围选择
        const 列表 = 筛选内容();
        const 锚 = 上次点击ID != null ? 列表.findIndex((x) => x.id === 上次点击ID) : -1;
        const 当前 = 列表.findIndex((x) => x.id === item.id);
        if (锚 >= 0 && 当前 >= 0) {
          const [起, 止] = 锚 <= 当前 ? [锚, 当前] : [当前, 锚];
          for (let i = 起; i <= 止; i++) 选中节点ID.add(列表[i].id);
        } else {
          选中节点ID.add(item.id);
        }
        选中内容 = item;
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl：从已选中集合增删特定项
        if (选中节点ID.has(item.id)) {
          选中节点ID.delete(item.id);
          const 余 = 筛选内容().filter((x) => 选中节点ID.has(x.id));
          选中内容 = 余.length > 0 ? 余[余.length - 1] : null;
        } else {
          选中节点ID.add(item.id);
          选中内容 = item;
        }
      } else {
        选中节点ID = new Set([item.id]);
        选中内容 = item;
      }
      上次点击ID = item.id;
      更新内容信息面板();
      更新批量删除按钮();
      渲染内容列表();
      隐藏右键菜单();
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      void 打开内容(item);
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 右键未选中项时先单选；右键已选中项时保持多选（菜单作用于整个选择集）
      if (!选中节点ID.has(item.id)) {
        选中节点ID = new Set([item.id]);
        选中内容 = item;
        上次点击ID = item.id;
      }
      更新内容信息面板();
      更新批量删除按钮();
      渲染内容列表();
      const 是文件 = item.resourceId != null && item.category !== "目录";
      const 是目录 = item.category === "目录";
      const 可物理操作 = 是文件 || 是目录;
      显示上下文菜单(e.clientX, e.clientY, [
        { label: "打开", icon: "📂", onClick: () => void 打开内容(item) },
        { label: "选择打开方式...", icon: "➕", onClick: () => { void 加载打开方式列表(item.extension); 显示打开方式对话框(item); } },
        ...(是文件 ? [{ label: "以系统默认方式打开", icon: "🖥️", onClick: () => void 系统默认打开(item) }] : []),
        null,
        { label: "重命名知识库名称", icon: "✏️", onClick: () => 开始内联编辑名称() },
        ...(是文件 ? [{ label: "重命名物理文件", icon: "📝", onClick: () => 开始内联编辑真实文件名() }] : []),
        ...(是文件 ? [{ label: "导出侧车（标签随文件）", icon: "🧷", onClick: () => void 导出侧车(item) }] : []),
        ...(可物理操作
          ? [
              null,
              { label: "在资源管理器中显示", icon: "🗂️", onClick: () => void 在资源管理器中显示(item) },
              { label: "复制路径", icon: "📋", onClick: () => void 复制物理路径(item) },
            ]
          : []),
        { label: "复制知识库名称", icon: "📋", onClick: () => void 复制文本(item.name) },
        ...(item.realName ? [{ label: "复制真实文件名", icon: "📋", onClick: () => void 复制文本(item.realName!) }] : []),
        null,
        { label: 选中节点ID.size > 1 ? `从知识库移除选中（${选中节点ID.size} 项）` : "从知识库移除", icon: "🗑️", danger: true, onClick: () => void 删除选中内容() },
        ...(可物理操作 ? [{ label: "删除到回收站", icon: "⚠️", danger: true, onClick: () => void 删除到回收站(item) }] : []),
      ]);
    });
  }


  export async function 加载所有内容(重试次数 = 0): Promise<void> {
    try {
      const condition: 查询条件 = {
        tags: typeof 当前标签ID === "number" ? [当前标签ID] : undefined,
        type: 类型筛选 === "all" ? undefined : 类型筛选,
        text: 搜索关键词 || undefined,
        locations: 当前位置ID != null ? [当前位置ID] : undefined,
        sort: 排序方式,
      };
      const result = (await window.kugua.request("mkg", "mkg.query", {
        condition,
        limit: 1000,
      })) as 内容条目[];
      所有内容 = result;
      渲染内容列表();
      渲染筛选摘要();
      void 渲染关联标签();
    } catch {
      if (重试次数 < 5) {
        setTimeout(() => void 加载所有内容(重试次数 + 1), 800);
        return;
      }
      所有内容 = [];
      渲染内容列表();
    }
  }

  export async function 加载标签树(重试次数 = 0): Promise<void> {
    try {
      标签树 = (await window.kugua.request("mkg", "mkg.tag.tree", {})) as 标签节点[];
      渲染标签树();
    } catch {
      // 首次启动时 mkg 模块可能尚未就绪，最多重试 5 次
      if (重试次数 < 5) {
        setTimeout(() => void 加载标签树(重试次数 + 1), 800);
        return;
      }
      标签树 = [];
      渲染标签树();
    }
  }

  export interface 菜单项 {
    label: string;
    icon?: string;
    danger?: boolean;
    onClick: () => void;
  }

  function 切换视图(mode: "large" | "list" | "details"): void {
    当前视图模式 = mode;
    大图标容器.classList.toggle("hidden", mode !== "large");
    列表容器.classList.toggle("hidden", mode !== "list");
    document.getElementById("ex-items-details")!.classList.toggle("hidden", mode !== "details");
    document.querySelectorAll(".ex-view-btn").forEach((btn) => {
      btn.classList.toggle("active", (btn as HTMLElement).dataset.viewmode === mode);
    });
  }
  // ========== 可勾选标签树 ==========
  interface 可勾选标签树选项 {
    containerId: string;
    选中的标签ID: Set<number>;
    onToggle?: (tagId: number, checked: boolean) => void;
  }

  export function 渲染可勾选标签树(tree: 标签节点[], opts: 可勾选标签树选项): void {
    const container = document.getElementById(opts.containerId) as HTMLDivElement | null;
    if (!container) return;
    container.innerHTML = "";
    if (!tree || tree.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;padding:0.5rem">还没有标签，先在上方输入路径新建一个吧。</div>';
      return;
    }

    function render(nodes: 标签节点[], parent: HTMLDivElement, depth: number): void {
      for (const node of nodes) {
        const nodeDiv = document.createElement("div");
        nodeDiv.className = "tt-node";

        const row = document.createElement("div");
        row.className = "tt-row";
        row.style.paddingLeft = depth * 0.2 + "rem";

        const hasChildren = node.children && node.children.length > 0;
        const toggle = document.createElement("span");
        toggle.className = "tt-toggle" + (hasChildren ? "" : " empty");
        toggle.textContent = "▼";
        row.appendChild(toggle);

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "tt-check";
        cb.checked = opts.选中的标签ID.has(node.id);
        cb.addEventListener("change", () => {
          if (cb.checked) opts.选中的标签ID.add(node.id); else opts.选中的标签ID.delete(node.id);
          opts.onToggle?.(node.id, cb.checked);
        });
        row.appendChild(cb);

        const name = document.createElement("span");
        name.className = "tt-name";
        name.textContent = node.name;
        row.appendChild(name);
        nodeDiv.appendChild(row);

        let childrenDiv: HTMLDivElement | null = null;
        if (hasChildren) {
          childrenDiv = document.createElement("div");
          childrenDiv.className = "tt-children";
          render(node.children, childrenDiv, depth + 1);
          nodeDiv.appendChild(childrenDiv);

          toggle.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            if (!childrenDiv) return;
            const collapsed = childrenDiv.classList.toggle("collapsed");
            toggle.textContent = collapsed ? "▶" : "▼";
          });
        }
        parent.appendChild(nodeDiv);
      }
    }
    render(tree, container, 0);
  }

  // ===== 文件/图片统一直导导入（不弹窗、不预填名称和标签） =====
  async function 直接导入(): Promise<void> {
    let paths: string[] = [];
    try {
      paths = (await (window.kugua as any).dialog.openFiles({ title: "选择文件或图片导入到知识库", multi: true })) as string[];
    } catch (err) {
      添加消息("选择文件失败：" + String(err), "error");
      return;
    }
    if (!paths || paths.length === 0) return;
    try {
      const items = paths.map((p) => ({ sourcePath: p }));
      const r = (await window.kugua.request("mkg", "mkg.resource.importFiles", { items })) as Array<{
        duplicate?: boolean;
        name?: string;
      }>;
      const 重复数 = r.filter((x) => x && (x as { duplicate?: boolean }).duplicate).length;
      添加消息(
        `成功导入 ${r.length - 重复数} 个内容${重复数 > 0 ? `，跳过 ${重复数} 个已存在的重复文件` : ""}`,
        "system",
      );
      await 加载所有内容();
    } catch (err) {
      添加消息("导入失败：" + String(err), "error");
    }
  }

  export function 格式化笔记时间(秒: number): string {
    if (!秒) return "-";
    const d = new Date(秒 * 1000);
    return d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  export function 标签ID转名称(id: number): string {
    let name = "ID:" + id;
    function walk(nodes: 标签节点[], trail: string[]): void {
      for (const n of nodes) {
        if (n.id === id) { name = n.name; return; }
        if (n.children) walk(n.children, [...trail, n.name]);
      }
    }
    walk(标签树, []);
    return name;
  }

  export async function 刷新(): Promise<void> {
    await 加载标签树();
    await 加载所有内容();
  }

  /** 绑定搜索与视图事件（由 init 调用） */
  function 绑定搜索与视图事件(): void {
    搜索框.addEventListener("input", () => {
      搜索关键词 = 搜索框.value;
      if (搜索防抖) clearTimeout(搜索防抖);
      搜索防抖 = window.setTimeout(() => {
        渲染内容列表();
      }, 200);
    });

    document.querySelectorAll<HTMLButtonElement>(".ex-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.viewmode as "large" | "list" | "details";
        if (mode) 切换视图(mode);
      });
    });

    document.getElementById("ex-nav-refresh")?.addEventListener("click", async () => {
      await 加载标签树();
      await 加载保存视图();
      await 加载位置();
      await 加载所有内容();
    });
  }

  /** 绑定智能视图与位置事件（由 init 调用） */

  /** 绑定内容操作事件（由 init 调用） */
  function 绑定内容操作事件(): void {
    document.addEventListener("click", () => 隐藏右键菜单());

    // ========== 统一导入 + 新建片段 ==========
    document.getElementById("ex-btn-import")?.addEventListener("click", () => void 直接导入());
    document.getElementById("ex-btn-new-snippet")?.addEventListener("click", () => 打开新建片段对话框());
    document.getElementById("ex-btn-delete-selected")?.addEventListener("click", () => void 删除选中内容());

    // 框选绑定（三种视图）
    [大图标容器, 列表容器, 详情容器].forEach((容器) => 绑定框选(容器));

    // 键盘删除（Delete/Backspace，输入框聚焦时不触发）
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && 选中节点ID.size > 0) {
        e.preventDefault();
        void 删除选中内容();
      }
    });

    // 类型筛选 / 排序 / 无分类
    const 类型筛选框 = document.getElementById("ex-type-filter") as HTMLSelectElement;
    类型筛选框?.addEventListener("change", () => {
      类型筛选 = 类型筛选框.value;
      void 加载所有内容();
    });
    const 排序框 = document.getElementById("ex-sort") as HTMLSelectElement;
    排序框?.addEventListener("change", () => {
      排序方式 = 排序框.value as "import" | "name" | "updated";
      void 加载所有内容();
    });
  }

  /** 绑定详情标签事件（由 init 调用） */
  function 绑定详情标签事件(): void {
    // 详情栏内联标签：联想输入（回车添加、↑/↓ 联想、Tab 采纳、点击 chip 移除）
    const 详情标签输入 = document.getElementById("ex-info-tag-input") as HTMLInputElement | null;
    if (详情标签输入) {
      绑定标签联想输入(详情标签输入, 内联标签编辑ID, () => void 内联保存标签());
    }
    // "添加" 按钮：把输入文字作为标签路径加入
    const 详情标签添加按钮 = document.getElementById("ex-info-tag-add-btn") as HTMLButtonElement | null;
    详情标签添加按钮?.addEventListener("click", async () => {
      const v = 详情标签输入?.value.trim();
      if (!v) return;
      try {
        // 逗号分隔的是多个并列标签，每一项单独创建并全部选中
        const 名称列表 = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        for (const 名称 of 名称列表) {
          const 标签 = (await window.kugua.request("mkg", "mkg.tag.createTree", {
            names: [名称],
          })) as { id: number };
          内联标签编辑ID.add(标签.id);
        }
        await 加载标签树();
        if (详情标签输入) 详情标签输入.value = "";
        渲染标签chips("ex-info-tags", 内联标签编辑ID, (tid) => {
          内联标签编辑ID.delete(tid);
          void 内联保存标签();
        });
        void 内联保存标签();
      } catch (err) {
        添加消息("添加标签失败：" + String(err), "error");
      }
    });
  }

  /** 绑定对话框事件（由 init 调用） */
  function 绑定对话框事件(): void {
    // 通用确认对话框
    document.getElementById("confirm-ok")?.addEventListener("click", () => 关闭确认对话框(true));
    document.getElementById("confirm-cancel")?.addEventListener("click", () => 关闭确认对话框(false));
    document.getElementById("confirm-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => 关闭确认对话框(false));
    document.getElementById("confirm-dialog")?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        关闭确认对话框(false);
      } else if (e.key === "Enter") {
        e.stopPropagation();
        关闭确认对话框(true);
      }
    });

    // 全局 ESC 关闭所有浮动层
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      // 确认框打开时由它自己处理 ESC
      const 确认框 = document.getElementById("confirm-dialog");
      if (确认框 && !确认框.classList.contains("hidden")) return;
      // 预览框打开时走统一关闭流程（含未保存确认与焦点清理）
      const 预览框 = document.getElementById("preview-dialog");
      if (预览框 && !预览框.classList.contains("hidden")) {
        void 关闭内置编辑器();
        return;
      }
      隐藏右键菜单();
      document.getElementById("openwith-dialog")?.classList.add("hidden");
      document.getElementById("rename-dialog")?.classList.add("hidden");
      document.getElementById("snippet-dialog")?.classList.add("hidden");
      document.getElementById("note-dialog")?.classList.add("hidden");
      document.getElementById("material-dialog")?.classList.add("hidden");
    });

    const owDialog = document.getElementById("openwith-dialog") as HTMLDivElement;
    const owList = document.getElementById("ow-list") as HTMLDivElement;
    const owProgram = document.getElementById("ow-program") as HTMLInputElement;
    const owArgs = document.getElementById("ow-args") as HTMLInputElement;
    const owLabel = document.getElementById("ow-label") as HTMLInputElement;
    const owSetDefault = document.getElementById("ow-set-default") as HTMLInputElement;

    显示打开方式对话框 = (file: 内容条目): void => {
      owList.innerHTML = "";
      for (const ow of 打开方式列表) {
        const item = document.createElement("div");
        item.className = "ow-item";
        item.innerHTML = "<strong>" + (ow.label || ow.programPath) + "</strong><br><span style=\"color:var(--text-dim);font-size:0.8rem\">" + ow.programPath + "</span>";
        item.addEventListener("click", async () => {
          await 打开内容(file, ow.programPath);
          owDialog.classList.add("hidden");
        });
        owList.appendChild(item);
      }
      owProgram.value = "";
      owArgs.value = '"{0}"';
      owLabel.value = "";
      owSetDefault.checked = false;
      owDialog.classList.remove("hidden");
    };

    document.getElementById("ow-cancel")?.addEventListener("click", () => {
      owDialog.classList.add("hidden");
    });
    document.getElementById("ow-confirm")?.addEventListener("click", async () => {
      if (!选中内容) return;
      const programPath = owProgram.value.trim();
      if (!programPath) {
        添加消息("请指定程序路径", "error");
        return;
      }
      await 打开内容(选中内容, programPath);
      if (owSetDefault.checked) {
        try {
          await window.kugua.request("mkg", "mkg.openwith.set", {
            extension: 选中内容.extension,
            programPath,
            arguments: owArgs.value,
            label: owLabel.value || null,
          });
          添加消息("已添加默认打开方式", "system");
        } catch (err) {
          添加消息("添加打开方式失败：" + String(err), "error");
        }
      }
      owDialog.classList.add("hidden");
    });
    owDialog.querySelector(".modal-backdrop")?.addEventListener("click", () => {
      owDialog.classList.add("hidden");
    });

    const renameDialog = document.getElementById("rename-dialog") as HTMLDivElement;
    const renameInput = document.getElementById("rename-input") as HTMLInputElement;
    const renameHint = document.getElementById("rename-hint") as HTMLDivElement;
    let 重命名目标: 内容条目 | null = null;

    function 显示重命名对话框(file: 内容条目): void {
      重命名目标 = file;
      renameHint.textContent = "原名称：" + 显示名(file) + "（" + file.name + "）";
      // 分离基础名和扩展名：后缀不可编辑
      const 真实扩展名 = file.realName?.includes(".") ? file.realName.slice(file.realName.lastIndexOf(".")) : "";
      let 基础名 = file.name;
      if (真实扩展名 && file.name.endsWith(真实扩展名)) {
        基础名 = file.name.slice(0, -真实扩展名.length);
      }
      renameInput.value = 基础名;
      renameDialog.classList.remove("hidden");
      renameInput.focus();
      renameInput.select();
    }

    document.getElementById("rename-cancel")?.addEventListener("click", () => {
      renameDialog.classList.add("hidden");
      重命名目标 = null;
    });
    document.getElementById("rename-confirm")?.addEventListener("click", async () => {
      if (!重命名目标) return;
      let newName = renameInput.value.trim();
      if (!newName) {
        添加消息("名称不能为空", "error");
        return;
      }
      // 拼接回扩展名
      const 真实扩展名 = 重命名目标.realName?.includes(".") ? 重命名目标.realName.slice(重命名目标.realName.lastIndexOf(".")) : "";
      if (真实扩展名 && !newName.endsWith(真实扩展名)) {
        newName = newName + 真实扩展名;
      }
      await 设置别名(重命名目标, newName);
      renameDialog.classList.add("hidden");
      重命名目标 = null;
    });
    renameDialog.querySelector(".modal-backdrop")?.addEventListener("click", () => {
      renameDialog.classList.add("hidden");
      重命名目标 = null;
    });
    renameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        document.getElementById("rename-confirm")?.click();
      }
    });
  }

  /** 绑定页面切换事件（由 init 调用） */
  function 绑定页面切换事件(): void {
    document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        if (!view) return;
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".view-panel").forEach((p) => p.classList.remove("active"));
        document.getElementById(view + "-view")?.classList.add("active");
      });
    });

    // ===== 知识库视图切换：资料库 / 记事 / 工作区 =====
    document.querySelectorAll<HTMLButtonElement>(".ex-sub-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        if (!mode) return;
        document.querySelectorAll(".ex-sub-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        (document.querySelector(".ex-pane-files") as HTMLDivElement)?.classList.toggle("hidden", mode !== "files");
        (document.querySelector(".ex-pane-boards") as HTMLDivElement)?.classList.toggle("hidden", mode !== "board");
        (document.querySelector(".ex-pane-workspace") as HTMLDivElement)?.classList.toggle("hidden", mode !== "workspace");
        if (mode === "board") void 加载看板();
        if (mode === "workspace") void 加载工作区视图();
      });
    });

    绑定看板事件();
    绑定笔记事件();
    绑定素材事件();
    绑定工作区事件();
  }

  /** 绑定容器交互事件（由 init 调用） */
  function 绑定容器交互事件(): void {
    大图标容器.addEventListener("click", () => {
      选中内容 = null;
      文件信息面板.classList.add("hidden");
      渲染内容列表();
    });
    列表容器.addEventListener("click", () => {
      选中内容 = null;
      文件信息面板.classList.add("hidden");
      渲染内容列表();
    });
    详情容器.addEventListener("click", () => {
      选中内容 = null;
      文件信息面板.classList.add("hidden");
      渲染内容列表();
    });

    document.querySelectorAll<HTMLElement>(".ex-section-title").forEach((title) => {
      title.addEventListener("click", () => {
        const content = title.nextElementSibling as HTMLElement;
        const toggle = title.querySelector(".ex-toggle") as HTMLElement;
        if (content) {
          content.classList.toggle("hidden");
          if (toggle) {
            toggle.textContent = content.classList.contains("hidden") ? "▶" : "▼";
          }
        }
      });
    });

    // 大图标视图滚轮缩放（1~10 列）
    大图标容器.addEventListener("wheel", (e) => {
      if (当前视图模式 !== "large") return;
      // 仅 Ctrl+滚轮缩放网格列数；普通滚轮交给列表自然滚动
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      大图标列数 = Math.max(1, Math.min(10, 大图标列数 + (e.deltaY > 0 ? 1 : -1)));
      大图标容器.style.setProperty("--ex-cols", String(大图标列数));
    }, { passive: false });
  }

  export async function init(): Promise<void> {
    绑定搜索与视图事件();
    await 绑定智能视图与位置事件();
    绑定内容操作事件();
    绑定详情标签事件();
    绑定编辑器事件();
    绑定对话框事件();
    绑定页面切换事件();
    绑定容器交互事件();

    await 加载标签树();
    await 加载所有内容();
    切换视图("large");
  }
}


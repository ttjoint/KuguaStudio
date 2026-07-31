const fs = require('fs');
const path = require('path');

let content = fs.readFileSync('packages/gui/src/renderer/index.ts', 'utf8');

// Explorer namespace code
const explorerCode = `
// ===== 资源管理器 =====

namespace Explorer {
  let 当前视图模式: "large" | "list" | "details" = "large";
  let 当前标签ID: number | "all" = "all";
  let 搜索关键词 = "";
  let 所有文件: 资源详情[] = [];
  let 标签树: 标签节点[] = [];
  let 选中文件: 资源详情 | null = null;
  let 打开方式列表: 打开方式配置[] = [];
  let 搜索防抖: number | null = null;

  const 大图标容器 = document.getElementById("ex-items-large") as HTMLDivElement;
  const 列表容器 = document.getElementById("ex-items-list") as HTMLDivElement;
  const 详情容器 = document.getElementById("ex-details-body") as HTMLDivElement;
  const 标签树容器 = document.getElementById("ex-tag-tree") as HTMLDivElement;
  const 文件信息面板 = document.getElementById("ex-file-info") as HTMLDivElement;
  const 右键菜单 = document.getElementById("context-menu") as HTMLDivElement;
  const 状态栏计数 = document.getElementById("ex-status-count") as HTMLSpanElement;
  const 面包屑 = document.getElementById("ex-breadcrumb") as HTMLDivElement;
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
      zip: "ZIP压缩包", rar: "RAR压缩包", 7z: "7z压缩包", bat: "批处理文件", ps1: "PowerShell脚本",
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

  function 格式化时间(秒: number): string {
    if (!秒) return "-";
    const d = new Date(秒 * 1000);
    return d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function 显示名(r: 资源详情): string {
    return r.alias || r.name;
  }

  function 创建文件图标(file: 资源详情, size: "large" | "small" = "large"): HTMLDivElement {
    const icon = document.createElement("div");
    const cls = 获取文件图标类(file.name, file.kind);
    icon.className = "ex-file-icon " + cls;
    if (file.kind === "directory") {
      icon.textContent = "📁";
      icon.style.fontSize = size === "large" ? "2rem" : "0.8rem";
      icon.style.background = "";
    } else {
      const ext = 获取扩展名(file.name);
      icon.textContent = ext.slice(0, 3);
      if (size === "small") {
        icon.style.fontSize = "0.55rem";
      }
      const extBadge = document.createElement("span");
      extBadge.className = "fi-ext";
      extBadge.textContent = ext.toUpperCase();
      if (size === "small") extBadge.style.display = "none";
      icon.appendChild(extBadge);
    }
    return icon;
  }

  function 筛选后的文件(): 资源详情[] {
    let files = 所有文件.filter((f) => f.kind === "file");
    if (搜索关键词.trim()) {
      const kw = 搜索关键词.trim().toLowerCase();
      files = files.filter((f) => 显示名(f).toLowerCase().includes(kw) || f.path.toLowerCase().includes(kw) || f.name.toLowerCase().includes(kw));
    }
    return files;
  }
`;

// Find insert point (before 事件绑定)
const insertPoint = content.indexOf('// ===== 事件绑定 =====');
if (insertPoint === -1) {
  console.log('ERROR: Could not find 事件绑定 marker');
  process.exit(1);
}

content = content.slice(0, insertPoint) + explorerCode + content.slice(insertPoint);

// Now we need to add the rest of Explorer functions and close namespace, then add event bindings
// For now, let's add the remaining Explorer code after 筛选后的文件
const remainingExplorer = `
  function 渲染文件列表(): void {
    const files = 筛选后的文件();
    状态栏计数.textContent = files.length + " 个项目";

    大图标容器.innerHTML = "";
    for (const file of files) {
      const tile = document.createElement("div");
      tile.className = "ex-file-tile";
      if (选中文件?.id === file.id) tile.classList.add("selected");
      tile.dataset.id = String(file.id);
      const icon = 创建文件图标(file, "large");
      const name = document.createElement("div");
      name.className = "ex-file-name";
      name.textContent = 显示名(file);
      tile.appendChild(icon);
      tile.appendChild(name);
      绑定文件项事件(tile, file);
      大图标容器.appendChild(tile);
    }

    列表容器.innerHTML = "";
    for (const file of files) {
      const item = document.createElement("div");
      item.className = "ex-list-item";
      if (选中文件?.id === file.id) item.classList.add("selected");
      item.dataset.id = String(file.id);
      const icon = 创建文件图标(file, "small");
      const name = document.createElement("div");
      name.className = "ex-file-name";
      name.textContent = 显示名(file);
      item.appendChild(icon);
      item.appendChild(name);
      绑定文件项事件(item, file);
      列表容器.appendChild(item);
    }

    详情容器.innerHTML = "";
    for (const file of files) {
      const row = document.createElement("div");
      row.className = "ex-detail-row";
      if (选中文件?.id === file.id) row.classList.add("selected");
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
      typeCell.textContent = 获取文件类型描述(file.name, file.kind);
      const sizeCell = document.createElement("div");
      sizeCell.className = "dr-size";
      sizeCell.textContent = file.kind === "directory" ? "" : 格式化大小(file.size);
      const pathCell = document.createElement("div");
      pathCell.className = "dr-path";
      pathCell.textContent = file.path;
      pathCell.title = file.path;
      row.appendChild(nameCell);
      row.appendChild(typeCell);
      row.appendChild(sizeCell);
      row.appendChild(pathCell);
      绑定文件项事件(row, file);
      详情容器.appendChild(row);
    }
  }

  function 绑定文件项事件(el: HTMLElement, file: 资源详情): void {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      选中文件 = file;
      更新文件信息面板();
      渲染文件列表();
      隐藏右键菜单();
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      void 打开文件(file);
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      选中文件 = file;
      更新文件信息面板();
      渲染文件列表();
      显示右键菜单(e.clientX, e.clientY);
    });
  }

  function 渲染标签树(): void {
    标签树容器.innerHTML = "";

    const allItem = document.createElement("div");
    allItem.className = "ex-tag-all";
    if (当前标签ID === "all") allItem.classList.add("active");
    allItem.innerHTML = '<span class="ex-tag-icon">🗂️</span> 所有文件';
    allItem.addEventListener("click", async () => {
      当前标签ID = "all";
      选中文件 = null;
      更新面包屑([{ name: "所有文件", id: "all" }]);
      文件信息面板.classList.add("hidden");
      await 加载文件列表();
      渲染标签树();
    });
    标签树容器.appendChild(allItem);

    function renderNode(node: 标签节点, depth: number, parent: HTMLElement): void {
      const hasChildren = node.children.length > 0;
      const item = document.createElement("div");
      item.className = "ex-tag-item";
      item.style.paddingLeft = (0.5 + depth * 14) + "px";
      if (当前标签ID === node.id) item.classList.add("active");
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

      item.addEventListener("click", async (e) => {
        if ((e.target as HTMLElement).classList.contains("ex-tag-expand")) return;
        当前标签ID = node.id;
        选中文件 = null;
        const path: { name: string; id: number | "all" }[] = [{ name: "所有文件", id: "all" }];
        const buildPath = (nodes: 标签节点[], targetId: number, crumbs: { name: string; id: number }[]): boolean => {
          for (const n of nodes) {
            if (n.id === targetId) { crumbs.push({ name: n.name, id: n.id }); return true; }
            if (buildPath(n.children, targetId, crumbs)) { crumbs.unshift({ name: n.name, id: n.id }); return true; }
          }
          return false;
        };
        const crumbs: { name: string; id: number }[] = [];
        buildPath(标签树, node.id, crumbs);
        path.push(...crumbs.map((c) => ({ name: c.name, id: c.id as number | "all" })));
        更新面包屑(path);
        文件信息面板.classList.add("hidden");
        await 加载文件列表();
        渲染标签树();
      });

      parent.appendChild(item);
      if (hasChildren) {
        parent.appendChild(childrenDiv);
        for (const child of node.children) {
          renderNode(child, depth + 1, childrenDiv);
        }
      }
    }

    for (const root of 标签树) {
      renderNode(root, 0, 标签树容器);
    }
  }

  function 更新面包屑(path: { name: string; id: number | "all" }[]): void {
    面包屑.innerHTML = "";
    path.forEach((p, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "ex-bc-sep";
        sep.textContent = "›";
        面包屑.appendChild(sep);
      }
      const item = document.createElement("span");
      item.className = "ex-bc-item";
      if (i === path.length - 1) item.classList.add("current");
      item.textContent = p.name;
      item.dataset.tagId = String(p.id);
      item.addEventListener("click", async () => {
        if (p.id === "all") {
          当前标签ID = "all";
        } else {
          当前标签ID = p.id as number;
        }
        选中文件 = null;
        文件信息面板.classList.add("hidden");
        更新面包屑(path.slice(0, i + 1));
        await 加载文件列表();
        渲染标签树();
      });
      面包屑.appendChild(item);
    });
  }
`;

// Find the end of 筛选后的文件 and insert the rest
const searchFuncEnd = content.indexOf('  function 筛选后的文件(): 资源详情[] {');
if (searchFuncEnd === -1) {
  console.log('ERROR: Could not find 筛选后的文件');
  process.exit(1);
}
// Find closing brace of 筛选后的文件
let braceCount = 0;
let funcStart = content.indexOf('{', searchFuncEnd);
let insertAfter = funcStart;
for (let i = funcStart; i < content.length; i++) {
  if (content[i] === '{') braceCount++;
  if (content[i] === '}') braceCount--;
  if (braceCount === 0) {
    insertAfter = i + 1;
    break;
  }
}

content = content.slice(0, insertAfter) + remainingExplorer + content.slice(insertAfter);

console.log('Phase 1 complete');
fs.writeFileSync('packages/gui/src/renderer/index.ts', content, 'utf8');

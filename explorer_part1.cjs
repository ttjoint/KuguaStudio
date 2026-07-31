// ===== 资源管理器 =====

namespace Explorer {
  // 状态
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
    return 映射[ext] || (ext ? `${ext.toUpperCase()} 文件` : "文件");
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
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function 格式化时间(秒: number): string {
    if (!秒) return "-";
    const d = new Date(秒 * 1000);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function 显示名(r: 资源详情): string {
    return r.alias || r.name;
  }

  function 创建文件图标(file: 资源详情, size: "large" | "small" = "large"): HTMLDivElement {
    const icon = document.createElement("div");
    const cls = 获取文件图标类(file.name, file.kind);
    icon.className = `ex-file-icon ${cls}`;
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

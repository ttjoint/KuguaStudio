/**
 * 苦瓜工作室 GUI 渲染器
 * 对话式 Agent 终端：用户输入 → 命令路由 → 模块调用 → 结果展示
 */

// ===== 类型定义 =====

type 模块类型 = "process" | "library";

interface 模块信息 {
  name: string;
  version?: string;
  capabilities?: string[];
}

interface 模块详情 extends 模块信息 {
  type?: 模块类型;
  online?: boolean;
  pid?: number;
  fileExists?: boolean;
  autoStart?: boolean;
  description?: string;
  entry?: string;
  file?: string;
}

interface 知识库统计 {
  资源总数: number;
  文件数: number;
  目录数: number;
  标签数: number;
  关联数: number;
  文本内容数: number;
  数据库大小: number;
}

interface 资源 {
  id: number;
  path: string;
  name: string;
  size: number;
  kind: "file" | "directory";
  modifiedTime: number;
  snippet?: string;
}

interface 资源详情 {
  id: number;
  path: string;
  name: string;
  size: number;
  kind: "file" | "directory";
  modifiedTime: number;
  alias: string | null;
  extension: string;
  mimeType: string;
  tagPaths: string[][];
}

interface 标签节点 {
  id: number;
  name: string;
  parentId: number | null;
  description?: string;
  children: 标签节点[];
}

interface 打开方式配置 {
  id: number;
  extension: string;
  programPath: string;
  arguments: string;
  label: string | null;
}

interface Window {
  kugua: {
    request: (target: string, action: string, params?: unknown) => Promise<unknown>;
    broadcast: (action: string, params?: unknown) => Promise<unknown>;
    onLog: (callback: (entry: unknown) => void) => void;
    onReady: (callback: () => void) => void;
  };
}

// ===== 对话终端 =====

const 聊天日志 = document.getElementById("chat-log") as HTMLDivElement;
const 输入框 = document.getElementById("chat-input") as HTMLInputElement;

function 添加消息(内容: string, 类型: "user" | "system" | "error" = "system", 发送者?: string): void {
  const div = document.createElement("div");
  div.className = `chat-msg ${类型}`;
  if (发送者) {
    div.innerHTML = `<div class="msg-sender">${发送者}</div><div class="msg-content">${内容}</div>`;
  } else {
    div.innerHTML = `<div class="msg-content">${内容}</div>`;
  }
  聊天日志.appendChild(div);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}

function 添加HTML(html: string, 类型: "system" | "error" = "system"): void {
  const div = document.createElement("div");
  div.className = `chat-msg ${类型}`;
  div.innerHTML = html;
  聊天日志.appendChild(div);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}

// ===== 命令路由器 =====

/** 分析用户输入，路由到对应模块 */
async function 处理输入(原文: string): Promise<void> {
  const 文本 = 原文.trim();
  if (!文本) return;

  添加消息(文本, "user");

  try {
    const 路由 = 路由指令(文本);
    if (路由) {
      await 执行路由(路由);
    } else {
      添加消息(`未知指令：「${文本}」\n可用的指令：\n- 占卜 [问题]\n- 运势\n- 今天吃什么 / [时间]吃什么\n- 搜索 [关键词]\n- 搜索内容 [关键词]\n- 导入 [路径]\n- 资源列表\n- 标签列表\n- 统计\n- 模块列表\n- 帮助`, "system");
    }
  } catch (err) {
    添加消息(`执行失败：${String(err)}`, "error");
  }
}

interface 路由结果 {
  目标: string;
  动作: string;
  参数?: unknown;
  描述: string;
}

function 路由指令(文本: string): 路由结果 | null {
  // 占卜
  if (/^占卜/.test(文本)) {
    const 问题 = 文本.slice(2).trim() || undefined;
    return { 目标: "divination", 动作: "divination.zhouyi", 参数: { question: 问题 }, 描述: "周易占卜" };
  }

  // 运势
  if (文本 === "运势" || 文本 === "今日运势" || 文本 === "每日运势") {
    return { 目标: "divination", 动作: "divination.fortune", 描述: "每日运势" };
  }

  // 吃什么
  const 吃匹配 = 文本.match(/^(.+)?(.{1})什么$/);
  if (吃匹配 && (吃匹配[2] === "吃" || 吃匹配[2] === "喝" || 吃匹配[2] === "玩")) {
    const 时间 = 吃匹配[1] || "今天";
    const 动词 = 吃匹配[2];
    return { 目标: "food", 动作: "food.recommend", 参数: { time: 时间, verb: 动词 }, 描述: "今天吃什么" };
  }
  if (文本 === "吃什么" || 文本 === "今天吃什么") {
    return { 目标: "food", 动作: "food.recommend", 参数: { time: "今天", verb: "吃" }, 描述: "今天吃什么" };
  }

  // 搜索（路径/文件名）
  const 搜索匹配 = 文本.match(/^搜索\s+(.+)$/);
  if (搜索匹配) {
    return { 目标: "mkg", 动作: "mkg.search", 参数: { type: "path", query: 搜索匹配[1], options: { limit: 20 } }, 描述: `搜索：${搜索匹配[1]}` };
  }

  // 搜索内容
  const 内容匹配 = 文本.match(/^搜索内容\s+(.+)$/);
  if (内容匹配) {
    return { 目标: "mkg", 动作: "mkg.search", 参数: { type: "content", query: 内容匹配[1], options: { limit: 20 } }, 描述: `搜索内容：${内容匹配[1]}` };
  }

  // 导入
  const 导入匹配 = 文本.match(/^导入\s+(.+)$/);
  if (导入匹配) {
    return { 目标: "mkg", 动作: "mkg.resource.import", 参数: { path: 导入匹配[1] }, 描述: `导入路径` };
  }

  // 资源列表
  if (文本 === "资源列表" || 文本 === "列表") {
    return { 目标: "mkg", 动作: "mkg.resource.list", 参数: { options: { limit: 50 } }, 描述: "资源列表" };
  }

  // 标签列表
  if (文本 === "标签列表" || 文本 === "标签") {
    return { 目标: "mkg", 动作: "mkg.tag.list", 描述: "标签列表" };
  }

  // 统计
  if (文本 === "统计" || 文本 === "知识库统计") {
    return { 目标: "mkg", 动作: "mkg.stats", 描述: "知识库统计" };
  }

  // 模块列表/详情
  if (文本 === "模块列表" || 文本 === "模块" || 文本 === "节点" || 文本 === "模块详情") {
    return { 目标: "nigane", 动作: "nigane.registry.details", 描述: "模块详情" };
  }
  // 启动模块
  const 启动匹配 = 文本.match(/^启动\s+(.+)$/);
  if (启动匹配) {
    return { 目标: "nigane", 动作: "nigane.registry.start", 参数: { name: 启动匹配[1].trim() }, 描述: `启动模块 ${启动匹配[1].trim()}` };
  }
  // 停止模块
  const 停止匹配 = 文本.match(/^停止\s+(.+)$/);
  if (停止匹配) {
    return { 目标: "nigane", 动作: "nigane.registry.stop", 参数: { name: 停止匹配[1].trim() }, 描述: `停止模块 ${停止匹配[1].trim()}` };
  }

  // 帮助
  if (文本 === "帮助" || 文本 === "help" || 文本 === "?") {
    添加消息(帮助文本(), "system");
    return null;
  }

  return null;
}

async function 执行路由(路由: 路由结果): Promise<void> {
  try {
    const 结果 = await window.kugua.request(路由.目标, 路由.动作, 路由.参数);
    格式化输出(路由, 结果);
  } catch (err) {
    添加消息(`【${路由.描述}】失败：${String(err)}`, "error");
  }
}

// ===== 结果格式化 =====

function 格式化输出(路由: 路由结果, 结果: unknown): void {
  const r = 结果 as Record<string, unknown>;

  switch (路由.动作) {
    case "divination.zhouyi": {
      const 解读 = r.解读 as string;
      添加消息(解读, "system", "占卜结果");
      break;
    }
    case "divination.fortune": {
      添加消息(`今日运势：${r.等级}\n${r.内容}`, "system", "运势");
      break;
    }
    case "food.recommend": {
      添加消息(r.推荐 as string, "system", "推荐");
      break;
    }
    case "mkg.search": {
      const total = r.total as number;
      const items = r.items as 资源[];
      if (items.length === 0) {
        添加消息("未找到匹配结果", "system", "搜索结果");
        return;
      }
      let html = `<div class="msg-sender">搜索结果（共 ${total} 条，显示 ${items.length} 条）</div>`;
      for (const item of items) {
        const 摘要 = item.snippet ? `：<br>&nbsp;&nbsp;${item.snippet.slice(0, 100)}…` : "";
        html += `<div class="resource-link">${item.path}${摘要}</div>`;
      }
      添加HTML(html);
      break;
    }
    case "mkg.resource.import": {
      添加消息(`导入完成：新增 ${r.added}，更新 ${r.updated}，移除 ${r.removed}`, "system", "导入结果");
      void 刷新统计();
      break;
    }
    case "mkg.resource.list": {
      const items = r.items as 资源[];
      if (items.length === 0) {
        添加消息("知识库为空", "system");
        return;
      }
      let html = `<div class="msg-sender">资源列表（共 ${r.total} 条）</div>`;
      for (const item of items.slice(0, 20)) {
        html += `<div>${item.kind === "file" ? "📄" : "📁"} ${item.path} <span style="color:var(--text-dim)">(${item.size}B)</span></div>`;
      }
      if (items.length > 20) html += `<div style="color:var(--text-dim)">…还有 ${items.length - 20} 条</div>`;
      添加HTML(html);
      break;
    }
    case "mkg.tag.list": {
      const tags = 结果 as { id: number; name: string }[];
      if (tags.length === 0) {
        添加消息("暂无标签", "system");
        return;
      }
      const 列表 = tags.map((t) => `[${t.id}] ${t.name}`).join("、");
      添加消息(`标签（${tags.length} 个）：${列表}`, "system");
      break;
    }
    case "mkg.stats": {
      const s = 结果 as 知识库统计;
      添加消息(
        `资源总数：${s.资源总数}（文件 ${s.文件数} / 目录 ${s.目录数}）\n标签：${s.标签数}\n关联：${s.关联数}\n文本索引：${s.文本内容数}`,
        "system",
        "知识库统计",
      );
      void 刷新统计();
      break;
    }
    case "nigane.registry.details": {
      const modules = 结果 as 模块详情[];
      if (modules.length === 0) {
        添加消息("当前无模块注册", "system");
        return;
      }
      let html = `<div class="msg-sender">模块注册（${modules.length} 个）</div>`;
      for (const m of modules) {
        const caps = (m.capabilities ?? []).join("、") || "无能力";
        const online = Boolean(m.online);
        const 类型 = m.type === "library" ? "库" : m.type === "process" ? "进程" : "未知";
        const 状态 = online
          ? m.type === "process"
            ? `运行中 (pid=${m.pid ?? "?"})`
            : "就绪"
          : m.type === "library" && m.fileExists === false
            ? "文件缺失"
            : "离线";
        const autoText = m.autoStart ? " · <span style=\"color:var(--accent)\">[自启]</span>" : "";
        const descText = m.description ? `<div style="color:var(--text-dim);font-size:0.85rem;padding-left:1.2rem">${m.description}</div>` : "";
        html += `<div><span style="color:${online ? "var(--green)" : "var(--text-dim)"}">●</span> <b>${m.name}</b> v${m.version ?? "?"} · [${类型}] ${状态}${autoText}<br><span style="color:var(--text-dim);padding-left:1.2rem">${caps}</span>${descText}</div>`;
      }
      添加HTML(html);
      void 刷新模块列表();
      break;
    }
    case "nigane.registry.start": {
      const r = 结果 as { started: boolean; reason?: string; pid?: number | null };
      if (r.started || r.reason === "already") {
        添加消息(r.reason === "already" ? "模块已在运行" : `启动成功，pid=${r.pid ?? "?"}`, "system", "启动结果");
      } else {
        添加消息(`启动失败：${r.reason ?? "未知"}`, "error");
      }
      void 刷新模块列表();
      break;
    }
    case "nigane.registry.stop": {
      const r = 结果 as { stopped: boolean; reason?: string };
      if (r.stopped || r.reason === "not_running") {
        添加消息(r.reason === "not_running" ? "模块本就未运行" : "已停止", "system", "停止结果");
      } else {
        添加消息(`停止失败：${r.reason ?? "未知"}`, "error");
      }
      void 刷新模块列表();
      break;
    }
    default:
      添加消息(JSON.stringify(结果, null, 2), "system");
  }
}

function 帮助文本(): string {
  return `可用指令：
【生成类】
  占卜 [问题]      — 周易蓍草占卜
  运势             — 每日运势
  今天吃什么       — 随机推荐食物
  [时间][动词]什么  — 如"晚上喝什么"

【知识库】
  搜索 [关键词]     — 按路径/文件名搜索
  搜索内容 [关键词] — 按文本内容搜索
  导入 [路径]       — 导入文件或目录
  资源列表          — 列出已索引资源
  标签列表          — 列出所有标签
  统计              — 知识库统计信息

【系统】
  模块列表 / 模块详情 — 查看所有模块（含运行状态、类型、PID）
  启动 <模块名>       — 手动启动进程型模块
  停止 <模块名>       — 手动停止进程型模块
  帮助                — 显示本帮助`;
}

// ===== 侧边栏 =====

async function 启动模块(名: string): Promise<boolean> {
  try {
    const r = (await window.kugua.request("nigane", "nigane.registry.start", { name: 名 })) as {
      started: boolean;
      pid?: number | null;
      reason?: string;
    };
    if (!r.started && r.reason === "already") return true;
    if (r.started) return true;
    添加消息(`启动模块 ${名} 失败：${r.reason ?? "未知"}`, "error");
    return false;
  } catch (err) {
    添加消息(`启动模块 ${名} 失败：${String(err)}`, "error");
    return false;
  }
}

async function 停止模块(名: string): Promise<boolean> {
  try {
    const r = (await window.kugua.request("nigane", "nigane.registry.stop", { name: 名 })) as {
      stopped: boolean;
      reason?: string;
    };
    if (r.stopped || r.reason === "not_running") return true;
    添加消息(`停止模块 ${名} 失败：${r.reason ?? "未知"}`, "error");
    return false;
  } catch (err) {
    添加消息(`停止模块 ${名} 失败：${String(err)}`, "error");
    return false;
  }
}

async function 刷新模块列表(): Promise<void> {
  const list = document.getElementById("module-list") as HTMLUListElement;
  try {
    const modules = (await window.kugua.request("nigane", "nigane.registry.details", {})) as 模块详情[];
    list.innerHTML = "";
    if (modules.length === 0) {
      list.innerHTML = '<li style="color:var(--text-dim)">暂无节点注册</li>';
      return;
    }
    for (const m of modules) {
      const li = document.createElement("li");
      const caps = (m.capabilities ?? []).join("、") || "无能力";
      const online = Boolean(m.online);
      const dotColor = online ? "var(--green)" : "var(--text-dim)";
      const 类型标签 = m.type === "library" ? "库" : m.type === "process" ? "进程" : "?";
      const 状态 = online
        ? m.type === "process"
          ? `运行中 (pid=${m.pid ?? "?"})`
          : m.type === "library"
            ? "就绪"
            : "在线"
        : m.type === "library" && m.fileExists === false
          ? "文件缺失"
          : "离线";
      const autoBadge = m.autoStart ? '<span class="badge" style="background:var(--accent);margin-left:4px">自启</span>' : "";
      const desc = m.description ? `<div class="module-desc" style="margin-top:2px">${m.description}</div>` : "";
      // 启停按钮：仅 process 型支持
      const can启停 = m.type === "process";
      const startBtn = can启停
        ? `<button class="mini-btn start-btn" data-name="${m.name}" title="启动" ${online ? "disabled" : ""}>▶</button>`
        : "";
      const stopBtn = can启停
        ? `<button class="mini-btn stop-btn" data-name="${m.name}" title="停止" ${online ? "" : "disabled"}>■</button>`
        : "";
      li.innerHTML = `
        <span class="module-dot" style="background:${dotColor}"></span>
        <div class="module-info" style="flex:1">
          <div class="module-name">
            ${m.name}${autoBadge}
            <span style="font-weight:normal;color:var(--text-dim);font-size:0.75rem;margin-left:6px">[${类型标签}] ${状态}</span>
          </div>
          <div class="module-desc">v${m.version ?? "?"} · ${caps}</div>
          ${desc}
        </div>
        <div style="display:flex;gap:4px">${startBtn}${stopBtn}</div>
      `;
      list.appendChild(li);
    }
    // 绑定按钮
    list.querySelectorAll<HTMLButtonElement>(".start-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-name")!;
        void (async () => {
          if (await 启动模块(name)) setTimeout(() => void 刷新模块列表(), 600);
        })();
      });
    });
    list.querySelectorAll<HTMLButtonElement>(".stop-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-name")!;
        void (async () => {
          if (await 停止模块(name)) setTimeout(() => void 刷新模块列表(), 600);
        })();
      });
    });
  } catch (err) {
    list.innerHTML = `<li style="color:var(--red)">加载失败：${String(err)}</li>`;
  }
}

async function 刷新统计(): Promise<void> {
  try {
    const s = (await window.kugua.request("mkg", "mkg.stats", {})) as 知识库统计;
    document.getElementById("stat-total")!.textContent = String(s.资源总数);
    document.getElementById("stat-files")!.textContent = String(s.文件数);
    document.getElementById("stat-dirs")!.textContent = String(s.目录数);
    document.getElementById("stat-tags")!.textContent = String(s.标签数);
    document.getElementById("stat-links")!.textContent = String(s.关联数);
    document.getElementById("stat-texts")!.textContent = String(s.文本内容数);
  } catch {
    // 统计不可用时静默
  }
}


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

  function 更新文件信息面板(): void {
    if (!选中文件) {
      文件信息面板.classList.add("hidden");
      return;
    }
    文件信息面板.classList.remove("hidden");

    const f = 选中文件;
    const iconEl = document.getElementById("ex-info-icon") as HTMLDivElement;
    iconEl.className = "ex-info-icon " + 获取文件图标类(f.name, f.kind);
    if (f.kind === "directory") {
      iconEl.textContent = "📁";
      iconEl.style.background = "";
      iconEl.style.fontSize = "2rem";
    } else {
      iconEl.textContent = 获取扩展名(f.name).slice(0, 3);
    }

    document.getElementById("ex-info-name")!.textContent = 显示名(f);
    const aliasEl = document.getElementById("ex-info-alias")!;
    aliasEl.textContent = f.alias || "(无)";
    document.getElementById("ex-info-type")!.textContent = 获取文件类型描述(f.name, f.kind);
    document.getElementById("ex-info-size")!.textContent = f.kind === "directory" ? "-" : 格式化大小(f.size);
    const pathEl = document.getElementById("ex-info-path") as HTMLSpanElement;
    pathEl.textContent = f.path;
    pathEl.title = "点击复制路径: " + f.path;
    document.getElementById("ex-info-modified")!.textContent = 格式化时间(f.modifiedTime);

    const tagsEl = document.getElementById("ex-info-tags") as HTMLDivElement;
    tagsEl.innerHTML = "";
    if (f.tagPaths.length === 0) {
      tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(无标签)</span>';
    } else {
      for (const tp of f.tagPaths) {
        const pathDiv = document.createElement("div");
        pathDiv.className = "ex-info-tag-path";
        pathDiv.innerHTML = tp.map((name, i) => (i > 0 ? '<span class="sep">/</span>' : "") + name).join("");
        tagsEl.appendChild(pathDiv);
      }
    }
  }

  async function 打开文件(file: 资源详情, programPath?: string): Promise<void> {
    try {
      if (programPath) {
        await window.kugua.request("mkg", "mkg.file.openWith", { resourceId: file.id, programPath });
      } else {
        await window.kugua.request("mkg", "mkg.file.open", { resourceId: file.id });
      }
    } catch (err) {
      添加消息("打开文件失败：" + String(err), "error");
    }
  }

  async function 在资源管理器中显示(file: 资源详情): Promise<void> {
    try {
      await window.kugua.request("mkg", "mkg.file.explorer", { resourceId: file.id });
    } catch (err) {
      添加消息("打开资源管理器失败：" + String(err), "error");
    }
  }

  async function 复制物理路径(file: 资源详情): Promise<void> {
    try {
      const result = (await window.kugua.request("mkg", "mkg.file.physicalPath", { resourceId: file.id })) as { path: string };
      await navigator.clipboard.writeText(result.path);
      状态栏计数.textContent = "已复制路径：" + result.path;
      setTimeout(() => { 状态栏计数.textContent = 筛选后的文件().length + " 个项目"; }, 2000);
    } catch (err) {
      添加消息("复制路径失败：" + String(err), "error");
    }
  }

  async function 设置别名(file: 资源详情, alias: string): Promise<void> {
    try {
      await window.kugua.request("mkg", "mkg.alias.set", { resourceId: file.id, alias });
      await 加载文件列表();
      添加消息("已设置别名：" + alias, "system");
    } catch (err) {
      添加消息("设置别名失败：" + String(err), "error");
    }
  }

  async function 加载打开方式列表(extension?: string): Promise<void> {
    try {
      打开方式列表 = (await window.kugua.request("mkg", "mkg.openwith.list", { extension })) as 打开方式配置[];
    } catch {
      打开方式列表 = [];
    }
  }

  async function 加载文件列表(): Promise<void> {
    try {
      let result: { items: 资源详情[]; total: number };
      if (当前标签ID === "all") {
        result = (await window.kugua.request("mkg", "mkg.resource.listDetail", { options: { limit: 1000 } })) as { items: 资源详情[]; total: number };
      } else {
        result = (await window.kugua.request("mkg", "mkg.resource.listByTagDetail", { tagId: 当前标签ID, options: { limit: 1000 } })) as { items: 资源详情[]; total: number };
      }
      所有文件 = result.items;
      渲染文件列表();
    } catch {
      所有文件 = [];
      渲染文件列表();
    }
  }

  async function 加载标签树(): Promise<void> {
    try {
      标签树 = (await window.kugua.request("mkg", "mkg.tag.tree", {})) as 标签节点[];
      渲染标签树();
    } catch {
      标签树 = [];
      渲染标签树();
    }
  }

  function 显示右键菜单(x: number, y: number): void {
    右键菜单.style.left = x + "px";
    右键菜单.style.top = y + "px";
    右键菜单.classList.remove("hidden");
  }

  function 隐藏右键菜单(): void {
    右键菜单.classList.add("hidden");
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
  export async function init(): Promise<void> {
    搜索框.addEventListener("input", () => {
      搜索关键词 = 搜索框.value;
      if (搜索防抖) clearTimeout(搜索防抖);
      搜索防抖 = window.setTimeout(() => {
        渲染文件列表();
      }, 200);
    });

    document.querySelectorAll<HTMLButtonElement>(".ex-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.viewmode as "large" | "list" | "details";
        if (mode) 切换视图(mode);
      });
    });

    document.getElementById("ex-nav-up")?.addEventListener("click", async () => {
      当前标签ID = "all";
      选中文件 = null;
      更新面包屑([{ name: "所有文件", id: "all" }]);
      文件信息面板.classList.add("hidden");
      await 加载文件列表();
      渲染标签树();
    });

    document.getElementById("ex-nav-refresh")?.addEventListener("click", async () => {
      await 加载标签树();
      await 加载文件列表();
    });

    document.addEventListener("click", () => 隐藏右键菜单());
    右键菜单.addEventListener("click", async (e) => {
      const action = (e.target as HTMLElement).dataset.action;
      if (!action || !选中文件) return;
      switch (action) {
        case "open":
          await 打开文件(选中文件);
          break;
        case "explorer":
          await 在资源管理器中显示(选中文件);
          break;
        case "copyPath":
          await 复制物理路径(选中文件);
          break;
        case "rename":
          显示重命名对话框(选中文件);
          break;
        case "openWith":
          await 加载打开方式列表(选中文件.extension);
          显示打开方式对话框(选中文件);
          break;
      }
      隐藏右键菜单();
    });

    document.getElementById("ex-btn-open")?.addEventListener("click", () => {
      if (选中文件) void 打开文件(选中文件);
    });
    document.getElementById("ex-btn-explorer")?.addEventListener("click", () => {
      if (选中文件) void 在资源管理器中显示(选中文件);
    });
    document.getElementById("ex-info-path")?.addEventListener("click", () => {
      if (选中文件) void 复制物理路径(选中文件);
    });

    const owDialog = document.getElementById("openwith-dialog") as HTMLDivElement;
    const owList = document.getElementById("ow-list") as HTMLDivElement;
    const owProgram = document.getElementById("ow-program") as HTMLInputElement;
    const owArgs = document.getElementById("ow-args") as HTMLInputElement;
    const owLabel = document.getElementById("ow-label") as HTMLInputElement;
    const owSetDefault = document.getElementById("ow-set-default") as HTMLInputElement;

    function 显示打开方式对话框(file: 资源详情): void {
      owList.innerHTML = "";
      for (const ow of 打开方式列表) {
        const item = document.createElement("div");
        item.className = "ow-item";
        item.innerHTML = "<strong>" + (ow.label || ow.programPath) + "</strong><br><span style=\"color:var(--text-dim);font-size:0.8rem\">" + ow.programPath + "</span>";
        item.addEventListener("click", async () => {
          await 打开文件(file, ow.programPath);
          owDialog.classList.add("hidden");
        });
        owList.appendChild(item);
      }
      owProgram.value = "";
      owArgs.value = '"{0}"';
      owLabel.value = "";
      owSetDefault.checked = false;
      owDialog.classList.remove("hidden");
    }

    document.getElementById("ow-cancel")?.addEventListener("click", () => {
      owDialog.classList.add("hidden");
    });
    document.getElementById("ow-confirm")?.addEventListener("click", async () => {
      if (!选中文件) return;
      const programPath = owProgram.value.trim();
      if (!programPath) {
        添加消息("请指定程序路径", "error");
        return;
      }
      await 打开文件(选中文件, programPath);
      if (owSetDefault.checked) {
        try {
          await window.kugua.request("mkg", "mkg.openwith.add", {
            extension: 选中文件.extension,
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
    let 重命名目标: 资源详情 | null = null;

    function 显示重命名对话框(file: 资源详情): void {
      重命名目标 = file;
      renameHint.textContent = "原名称：" + 显示名(file) + "（" + file.name + "）";
      renameInput.value = file.alias || file.name;
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
      const newName = renameInput.value.trim();
      if (!newName) {
        添加消息("名称不能为空", "error");
        return;
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

    大图标容器.addEventListener("click", () => {
      选中文件 = null;
      文件信息面板.classList.add("hidden");
      渲染文件列表();
    });
    列表容器.addEventListener("click", () => {
      选中文件 = null;
      文件信息面板.classList.add("hidden");
      渲染文件列表();
    });
    详情容器.addEventListener("click", () => {
      选中文件 = null;
      文件信息面板.classList.add("hidden");
      渲染文件列表();
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

    更新面包屑([{ name: "所有文件", id: "all" }]);
    await 加载标签树();
    await 加载文件列表();
    切换视图("large");
  }
}

// ===== 事件绑定 =====

document.getElementById("chat-send")?.addEventListener("click", () => {
  void 处理输入(输入框.value);
  输入框.value = "";
});

输入框.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    void 处理输入(输入框.value);
    输入框.value = "";
  }
});

document.getElementById("refresh-modules")?.addEventListener("click", () => void 刷新模块列表());
document.getElementById("refresh-stats")?.addEventListener("click", () => void 刷新统计());

// ===== Debug 面板 =====

interface 日志条目 {
  时间: number;
  方向: "发送" | "接收" | "超时";
  类型: string;
  from: string;
  to?: string;
  action?: string;
  id: string;
  echo?: string;
  code?: number;
  message?: string;
}

const debug面板 = document.getElementById("debug-panel") as HTMLDivElement;
const debug日志 = document.getElementById("debug-log") as HTMLDivElement;
const debug按钮 = document.getElementById("debug-toggle") as HTMLButtonElement;
const 日志缓存: 日志条目[] = [];
const 最大缓存 = 500;

function 格式化时间(时间戳: number): string {
  const d = new Date(时间戳);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function 添加日志(条目: 日志条目): void {
  日志缓存.push(条目);
  if (日志缓存.length > 最大缓存) 日志缓存.shift();

  // 检查过滤器
  const 方向 = 条目.方向;
  const 过滤项 = document.getElementById(`filter-${方向 === "发送" ? "send" : 方向 === "接收" ? "recv" : "timeout"}`) as HTMLInputElement;
  if (过滤项 && !过滤项.checked) return;

  const div = document.createElement("div");
  div.className = "log-entry";
  const 方向类 = 方向 === "发送" ? "send" : 方向 === "接收" ? "recv" : "timeout";
  const 路由 = 条目.from + (条目.to ? ` → ${条目.to}` : "");
  const 动作 = 条目.action ?? "";
  const 详情 = 条目.code !== undefined ? `[${条目.code}] ${条目.message ?? ""}` : (条目.echo ? `echo=${条目.echo.slice(0, 8)}` : "");
  div.innerHTML = `<span class="log-time">${格式化时间(条目.时间)}</span><span class="log-dir ${方向类}">${方向}</span><span class="log-type">${条目.类型}</span><span class="log-route">${路由}</span>${动作 ? `<span class="log-route">${动作}</span>` : ""}${详情 ? `<span class="log-detail">${详情}</span>` : ""}`;
  debug日志.appendChild(div);
  debug日志.scrollTop = debug日志.scrollHeight;

  // 限制 DOM 条目数
  while (debug日志.children.length > 最大缓存) {
    debug日志.removeChild(debug日志.firstChild!);
  }
}

function 重新渲染日志(): void {
  debug日志.innerHTML = "";
  for (const 条目 of 日志缓存) {
    const 方向 = 条目.方向;
    const 过滤项 = document.getElementById(`filter-${方向 === "发送" ? "send" : 方向 === "接收" ? "recv" : "timeout"}`) as HTMLInputElement;
    if (过滤项 && !过滤项.checked) continue;

    const div = document.createElement("div");
    div.className = "log-entry";
    const 方向类 = 方向 === "发送" ? "send" : 方向 === "接收" ? "recv" : "timeout";
    const 路由 = 条目.from + (条目.to ? ` → ${条目.to}` : "");
    const 动作 = 条目.action ?? "";
    const 详情 = 条目.code !== undefined ? `[${条目.code}] ${条目.message ?? ""}` : (条目.echo ? `echo=${条目.echo.slice(0, 8)}` : "");
    div.innerHTML = `<span class="log-time">${格式化时间(条目.时间)}</span><span class="log-dir ${方向类}">${方向}</span><span class="log-type">${条目.类型}</span><span class="log-route">${路由}</span>${动作 ? `<span class="log-route">${动作}</span>` : ""}${详情 ? `<span class="log-detail">${详情}</span>` : ""}`;
    debug日志.appendChild(div);
  }
  debug日志.scrollTop = debug日志.scrollHeight;
}

debug按钮.addEventListener("click", () => {
  debug面板.classList.toggle("hidden");
  debug按钮.classList.toggle("active");
});

document.getElementById("debug-close")?.addEventListener("click", () => {
  debug面板.classList.add("hidden");
  debug按钮.classList.remove("active");
});

document.getElementById("debug-clear")?.addEventListener("click", () => {
  日志缓存.length = 0;
  debug日志.innerHTML = "";
});

document.querySelectorAll(".debug-filter input").forEach((cb) => {
  cb.addEventListener("change", 重新渲染日志);
});

// 监听主进程转发的通信日志
window.kugua.onLog((entry: unknown) => {
  添加日志(entry as 日志条目);
});

// 客户端连接成功后刷新侧边栏数据
window.kugua.onReady(() => {
  void 刷新模块列表();
  void 刷新统计();
  void Explorer.init();
});

// ===== 初始化 =====

添加消息("苦瓜工作室已启动。输入「帮助」查看可用指令。", "system");

// 定时刷新模块列表
setInterval(() => void 刷新模块列表(), 10000);

/**
 * 苦瓜工作室 本地 Web UI 服务端
 *
 * 职责：
 *  - 托管主控进程，并作为苦音客户端（webui）接入总线；
 *  - 以 HTTP 提供静态页面与 API（代理苦音请求/广播、本地文件、剪贴板、原生对话框）；
 *  - 以 WebSocket 向前端推送通信日志与就绪事件。
 *
 * 浏览器端通过 `kugua-shim.js` 注入与旧 Electron 版一致的 `window.kugua` 接口，
 * 因此渲染层代码无需大改。详见 docs/架构设计.md。
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as 创建探测服务器 } from "node:net";
import { spawn, exec, execFile, type ChildProcess } from "node:child_process";
import { resolve, join, extname } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  statSync,
  createReadStream,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import { NiganeClient } from "@kugua/nigane";
import { MCP服务器 } from "@kugua/mcp";
import type { 能力声明 } from "@kugua/capability";
import { 获取单实例锁, 读取单实例锁, 数据根 } from "@kugua/paths";

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const 渲染根 = resolve(__dirname, "renderer");

// ===== 配置 =====

interface 配置 {
  host?: string;
  port?: number;
  token?: string;
  webui?: {
    /** Web UI 监听端口，默认 24600 */
    port?: number;
    /** 启动后是否自动打开浏览器，默认 true */
    open?: boolean;
    /** 是否显示系统托盘图标（仅 Windows），默认 true */
    tray?: boolean;
  };
  plugins?: {
    /** 插件目录，默认 plugins */
    dir?: string;
  };
}

function 加载配置(): 配置 {
  const 路径 = process.env.KUGUA_CONFIG
    ? resolve(process.cwd(), process.env.KUGUA_CONFIG)
    : resolve(process.cwd(), "kugua.config.json");
  if (!existsSync(路径)) return {};
  try {
    return JSON.parse(readFileSync(路径, "utf-8")) as 配置;
  } catch {
    return {};
  }
}

const 配置 = 加载配置();
const 主控host = 配置.host ?? "127.0.0.1";
const 主控port = 配置.port ?? 24601;
const WebUI端口 = Number(process.env.KUGUA_WEBUI_PORT ?? 配置.webui?.port ?? 24600);
const 自动打开 = process.argv.includes("--no-open") ? false : 配置.webui?.open !== false;

let 主控进程: ChildProcess | null = null;
let 苦音客户端: NiganeClient | null = null;
let 已就绪 = false;
/** 平台实例锁（单实例守卫） */
const 实例锁路径 = resolve(数据根(), "webui.lock");
/** 释放当前实例锁（由 主流程 注入） */
let 释放实例锁: () => void = () => undefined;

/** 已连接的浏览器 WebSocket 客户端 */
const 订阅者 = new Set<WebSocket>();

type MCP请求 = Parameters<MCP服务器["处理"]>[0];

/** MCP server：通过 /mcp 暴露平台能力（Streamable HTTP，JSON-RPC） */
const mcp服务器 = new MCP服务器({
  名称: "kugua-studio",
  版本: "0.1.0",
  能力: async () => {
    if (!苦音客户端) return [];
    return (await 苦音客户端.request("nigane", "capability.list", {
      入口: "MCP",
      允许危险: false,
    })) as 能力声明[];
  },
  调用: async (名称, 参数) => {
    if (!苦音客户端) throw new Error("主控未就绪");
    return 苦音客户端.request("nigane", "capability.call", { 名称, 参数 }, 600000);
  },
  列出资源: async () => {
    if (!苦音客户端) return [];
    try {
      const items = (await 苦音客户端.request("mkg", "mkg.node.listAll", { limit: 50 })) as Array<{
        id: number;
        name: string;
        category: string;
      }>;
      return (items ?? []).map((n) => ({ uri: `mkg://node/${n.id}`, name: n.name, description: n.category }));
    } catch {
      return [];
    }
  },
  读取资源: async (uri) => {
    const m = /^mkg:\/\/node\/(\d+)$/.exec(uri);
    if (!m) throw new Error(`未知资源 URI：${uri}`);
    if (!苦音客户端) throw new Error("主控未就绪");
    return 苦音客户端.request("mkg", "mkg.node.get", { id: Number(m[1]) });
  },
  日志: (消息) => console.log(`[mcp] ${消息}`),
});

// ===== 主控进程 =====

/**
 * 单实例守卫：若已有平台实例在运行，返回其实例信息；否则获取锁。
 * 注意：本函数**不会**结束任何进程（不按端口/进程名误杀）；
 * 这修掉了旧实现「启动 WebUI 就把在跑的主控 kill 掉」的危险行为。
 */
function 单实例守卫(): { 已有: boolean; 信息?: { pid: number; 附加?: Record<string, unknown> } } {
  const 已有 = 读取单实例锁(实例锁路径);
  if (已有) return { 已有: true, 信息: { pid: 已有.pid, 附加: 已有.附加 } };
  return { 已有: false };
}

/** 探测主控端口是否已被占用（仅探测，不杀进程） */
function 主控端口被占用(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const 探测 = 创建探测服务器();
    探测.once("error", (err: NodeJS.ErrnoException) => resolve(err.code === "EADDRINUSE"));
    探测.once("listening", () => 探测.close(() => resolve(false)));
    探测.listen(port, 主控host);
  });
}


function 启动主控(): Promise<void> {
  return new Promise((res) => {
    const 主控脚本 = resolve(process.cwd(), "packages/main/dist/index.js");
    if (!existsSync(主控脚本)) {
      console.error(`[WebUI] 未找到主控脚本：${主控脚本}，请先 npm run build`);
      res();
      return;
    }
    const proc = spawn("node", [主控脚本], { stdio: "pipe", cwd: process.cwd() });
    主控进程 = proc;
    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      console.log("[主控]", text.trim());
      if (text.includes("苦音服务端已启动")) res();
    });
    proc.stderr?.on("data", (data: Buffer) => console.error("[主控]", data.toString().trim()));
    proc.on("error", () => res());
    setTimeout(res, 3000);
  });
}

// ===== 苦音连接 =====

function 推送(消息: unknown): void {
  const 文本 = JSON.stringify(消息);
  for (const 端 of 订阅者) {
    if (端.readyState === WebSocket.OPEN) 端.send(文本);
  }
}

async function 连接苦音(): Promise<void> {
  苦音客户端 = new NiganeClient({
    name: "webui",
    url: `ws://${主控host}:${主控port}`,
    token: 配置.token ?? "",
    version: "0.1.0",
    capabilities: ["webui"],
  });
  苦音客户端.on("log", (条目: unknown) => 推送({ type: "log", entry: 条目 }));
  // 主控转发的全局总线流量（含其他模块间调用，带双方与传参）
  苦音客户端.onEvent("nigane.traffic", (条目: unknown) => 推送({ type: "log", entry: 条目 }));
  // 注册表/能力/插件变更事件 → 转发给浏览器（前端据此事件驱动刷新，无需轮询）
  for (const 动作 of ["capability.changed", "registry.changed", "plugins.changed"]) {
    苦音客户端.onEvent(动作, (数据: unknown) => 推送({ type: "bus", action: 动作, params: 数据 }));
  }
  try {
    await 苦音客户端.connect();
    已就绪 = true;
    推送({ type: "ready" });
    console.log(`[WebUI] 已接入苦音主控 ws://${主控host}:${主控port}`);
  } catch (err) {
    推送({ type: "log", entry: { 时间: Date.now(), 方向: "超时", from: "webui", message: `连接主控失败：${String(err)}` } });
  }
}

/** 插件根目录 */
function 插件根(): string {
  return resolve(process.cwd(), 配置.plugins?.dir ?? "plugins");
}

/** 读取插件 manifest 中的 ui 声明 */
interface 插件页 {
  name: string;
  title: string;
  entry: string;
}

function 读取插件UI(目录: string, 目录名: string): 插件页 | null {
  for (const 文件名 of ["kugua-plugin.json", "package.json"]) {
    const p = join(目录, 文件名);
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
      const 插件段 = (文件名 === "package.json" ? (j["kugua-plugin"] as Record<string, unknown> | undefined) : j) ?? {};
      const ui = 插件段["ui"];
      if (!ui) continue;
      const 名 = String(j["name"] ?? 目录名);
      if (typeof ui === "string") return { name: 名, title: 名, entry: ui };
      const u = ui as { title?: string; entry?: string };
      return { name: 名, title: u.title ?? 名, entry: u.entry ?? "index.html" };
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

/** 扫描所有带 UI 的插件页 */
function 列出插件页面(): 插件页[] {
  const 根 = 插件根();
  if (!existsSync(根)) return [];
  const 结果: 插件页[] = [];
  for (const 项 of readdirSync(根, { withFileTypes: true })) {
    if (!项.isDirectory()) continue;
    const ui = 读取插件UI(join(根, 项.name), 项.name);
    if (ui) 结果.push(ui);
  }
  return 结果;
}

/** 读取单个插件的 UI 信息 */
function 取插件页(名: string): 插件页 | null {
  const 目录 = join(插件根(), 名);
  if (!existsSync(目录)) return null;
  return 读取插件UI(目录, 名);
}

/** 发送插件 UI 文件（防目录穿越） */
async function 发送插件UI(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const 路径 = decodeURIComponent(url.pathname).replace(/^\/plugin-ui\//, "");
  const 斜 = 路径.indexOf("/");
  const 名 = 斜 === -1 ? 路径 : 路径.slice(0, 斜);
  let 相对 = 斜 === -1 ? "" : 路径.slice(斜 + 1);
  if (!名) {
    res.writeHead(404).end("Not Found");
    return;
  }
  const 页 = 取插件页(名);
  if (!相对) 相对 = 页?.entry ?? "index.html";
  const 根 = join(插件根(), 名);
  const 目标 = resolve(根, 相对);
  if (!目标.startsWith(根) || !existsSync(目标) || !statSync(目标).isFile()) {
    res.writeHead(404).end("Not Found");
    return;
  }
  发送文件(req, res, 目标);
}

// ===== HTTP 工具 =====

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

function 发送JSON(res: ServerResponse, code: number, 数据: unknown): void {
  const 体 = JSON.stringify(数据 ?? null);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(体);
}

function 读JSON(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((res) => {
    let 缓冲 = "";
    req.on("data", (块) => {
      缓冲 += 块;
      if (缓冲.length > 64 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        res(缓冲 ? (JSON.parse(缓冲) as Record<string, unknown>) : {});
      } catch {
        res({});
      }
    });
  });
}

/** 读取原始请求体文本（用于 MCP，可能是单对象或批量数组） */
function 读文本(req: IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let 缓冲 = "";
    req.on("data", (块) => {
      缓冲 += 块;
      if (缓冲.length > 16 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => res(缓冲));
  });
}

/** 处理 MCP（Streamable HTTP，JSON-RPC）：POST /mcp */
async function 处理MCP(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    发送JSON(res, 405, { error: "MCP 需要 POST 请求" });
    return;
  }
  const 体 = await 读文本(req);
  let 载荷: unknown;
  try {
    载荷 = JSON.parse(体);
  } catch {
    发送JSON(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (Array.isArray(载荷)) {
    const 响应: unknown[] = [];
    for (const 请求 of 载荷) {
      const x = await mcp服务器.处理(请求 as MCP请求);
      if (x) 响应.push(x);
    }
    if (响应.length === 0) {
      res.writeHead(202).end();
      return;
    }
    发送JSON(res, 200, 响应);
    return;
  }
  const 响应 = await mcp服务器.处理(载荷 as MCP请求);
  if (!响应) {
    res.writeHead(202).end();
    return;
  }
  发送JSON(res, 200, 响应);
}

/** 从 渲染根 安全解析静态文件路径，阻止目录穿越 */
function 解析静态路径(pathname: string): string | null {
  const 相对 = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const 目标 = resolve(渲染根, 相对);
  if (!目标.startsWith(渲染根)) return null;
  return 目标;
}

function 发送文件(req: IncomingMessage, res: ServerResponse, 文件路径: string): void {
  if (!existsSync(文件路径) || !statSync(文件路径).isFile()) {
    res.writeHead(404).end("Not Found");
    return;
  }
  const st = statSync(文件路径);
  const mime = MIME[extname(文件路径).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (start >= st.size || end >= st.size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
      return;
    }
    res.writeHead(206, {
      "Content-Type": mime,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${st.size}`,
      "Accept-Ranges": "bytes",
    });
    createReadStream(文件路径, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": mime, "Content-Length": st.size, "Accept-Ranges": "bytes" });
  createReadStream(文件路径).pipe(res);
}

// ===== 原生能力（Windows） =====

/** 弹出系统文件选择对话框，返回所选路径 */
async function 选择文件(标题: string, 多选: boolean, 过滤器?: Array<{ name: string; extensions: string[] }>): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const 过滤串 = (过滤器 ?? [])
    .map((f) => `${f.name}|${f.extensions.map((e) => `*.${e}`).join(";")}`)
    .join("|");
  const 脚本 = [
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
    "$d = New-Object System.Windows.Forms.OpenFileDialog",
    `$d.Title = '${标题.replace(/'/g, "''")}'`,
    `$d.Multiselect = $${多选 ? "true" : "false"}`,
    过滤串 ? `$d.Filter = '${过滤串.replace(/'/g, "''")}'` : "",
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileNames | ForEach-Object { Write-Output $_ } }",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-STA", "-Command", 脚本], {
      windowsHide: true,
      timeout: 300000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** 将 PNG dataURL 写入系统剪贴板（Windows） */
async function 写入剪贴板图片(dataUrl: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const m = /^data:image\/[^;]+;base64,(.+)$/.exec(dataUrl);
  if (!m) return false;
  const 目录 = join(tmpdir(), "kugua-clip");
  mkdirSync(目录, { recursive: true });
  const 文件 = join(目录, `clip-${Date.now()}.png`);
  writeFileSync(文件, Buffer.from(m[1], "base64"));
  const 脚本 = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    `$img = [System.Drawing.Image]::FromFile('${文件.replace(/'/g, "''")}')`,
    "[System.Windows.Forms.Clipboard]::SetImage($img)",
    "$img.Dispose()",
  ].join("\n");
  try {
    await execFileAsync("powershell", ["-NoProfile", "-STA", "-Command", 脚本], { windowsHide: true, timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

// ===== API 分派 =====

async function 处理API(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const 路径 = url.pathname;
  if (!苦音客户端) {
    发送JSON(res, 503, { error: "苦音客户端未就绪" });
    return;
  }
  try {
    if (req.method === "POST" && 路径 === "/api/request") {
      const p = await 读JSON(req);
      const target = String(p.target ?? "");
      const action = String(p.action ?? "");
      const 指定超时 = typeof p.timeoutMs === "number" ? Math.min(Math.max(p.timeoutMs, 1000), 600000) : undefined;
      const 长任务目标 = target === "image" || target === "avatar" || target === "av" || target === "music";
      const 超时毫秒 = 指定超时 ?? (长任务目标 ? 120000 : 10000);
      const 结果 = await 苦音客户端.request(target, action, p.params, 超时毫秒);
      发送JSON(res, 200, 结果);
      return;
    }
    if (req.method === "POST" && 路径 === "/api/broadcast") {
      const p = await 读JSON(req);
      苦音客户端.sendEvent(String(p.action ?? ""), p.params);
      发送JSON(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && 路径 === "/api/writeTempFile") {
      const { base64 = "", name = "", ext = "" } = (await 读JSON(req)) as { base64?: string; name?: string; ext?: string };
      if (!base64) throw new Error("缺少 base64 内容");
      const 目录 = join(tmpdir(), "kugua-drop");
      mkdirSync(目录, { recursive: true });
      const 清理名 = name.replace(/[\\/:*?"<>|]/g, "_").trim() || `未命名_${Date.now()}`;
      const 文件名 = 清理名 + (清理名.endsWith(ext) ? "" : ext);
      const 文件 = join(目录, 文件名);
      writeFileSync(文件, Buffer.from(base64, "base64"));
      发送JSON(res, 200, 文件);
      return;
    }
    if (req.method === "POST" && 路径 === "/api/media/read") {
      const { path: 文件 } = (await 读JSON(req)) as { path?: string };
      if (!文件 || !existsSync(文件)) {
        发送JSON(res, 200, null);
        return;
      }
      const st = statSync(文件);
      if (!st.isFile()) {
        发送JSON(res, 200, null);
        return;
      }
      if (st.size > 64 * 1024 * 1024) {
        发送JSON(res, 200, { base64: "", size: st.size, modified: st.mtimeMs, tooLarge: true });
        return;
      }
      发送JSON(res, 200, { base64: readFileSync(文件).toString("base64"), size: st.size, modified: st.mtimeMs });
      return;
    }
    if (req.method === "POST" && 路径 === "/api/clipboard/image") {
      const { dataUrl } = (await 读JSON(req)) as { dataUrl?: string };
      发送JSON(res, 200, await 写入剪贴板图片(String(dataUrl ?? "")));
      return;
    }
    if (req.method === "POST" && 路径 === "/api/dialog/openFiles") {
      const p = (await 读JSON(req)) as { title?: string; multi?: boolean; filters?: Array<{ name: string; extensions: string[] }> };
      发送JSON(res, 200, await 选择文件(p.title ?? "选择文件", p.multi !== false, p.filters));
      return;
    }
    if (req.method === "POST" && 路径 === "/api/dialog/openImages") {
      发送JSON(
        res,
        200,
        await 选择文件("选择图片导入", true, [
          { name: "图片文件", extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "tiff", "ico"] },
        ]),
      );
      return;
    }
    if (req.method === "POST" && 路径 === "/api/restart") {
      // 重启平台：先把响应发回去，再异步重启自己（子进程/模块随主控一起重启）
      发送JSON(res, 200, { restarting: true });
      setTimeout(() => 重启平台().catch((e) => console.error("[WebUI] 重启失败：", e)), 300);
      return;
    }
    if (req.method === "POST" && 路径 === "/api/shutdown") {
      发送JSON(res, 200, { shuttingDown: true });
      setTimeout(() => {
        苦音客户端?.close();
        主控进程?.kill();
        process.exit(0);
      }, 300);
      return;
    }
    if (req.method === "GET" && 路径 === "/api/status") {
      发送JSON(res, 200, { ready: 已就绪, main: `ws://${主控host}:${主控port}`, webui: WebUI端口, pid: process.pid });
      return;
    }
    发送JSON(res, 404, { error: "未知接口" });
  } catch (err) {
    发送JSON(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

// ===== 启动 =====

async function 主流程(): Promise<void> {
  // —— 单实例守卫：已有平台实例则直接退出，不重复启动，也绝不杀已有实例 ——
  const 守卫 = 单实例守卫();
  if (守卫.已有) {
    console.log(
      `[WebUI] 检测到已有苦瓜工作室实例在运行（pid=${守卫.信息?.pid}），本实例退出。\n` +
        `        若要访问已运行的实例，请打开：http://127.0.0.1:${WebUI端口}`,
    );
    process.exit(0);
  }
  // 额外保险：主控端口已被占用（且不是本实例）也视为已有实例
  if (await 主控端口被占用(主控port)) {
    console.log(`[WebUI] 检测到主控端口 ${主控host}:${主控port} 已被占用，视为已有实例在运行，本实例退出。`);
    process.exit(0);
  }
  // 获取实例锁（含退出时释放）
  const 锁 = 获取单实例锁(实例锁路径, "webui", {
    端口: WebUI端口,
    主控端口: 主控port,
    地址: `http://127.0.0.1:${WebUI端口}`,
  });
  if (!锁.获得) {
    console.log(`[WebUI] 已有实例在运行（pid=${锁.已有?.pid}），本实例退出。`);
    process.exit(0);
  }
  const 释放锁 = (): void => 锁.释放();
  释放实例锁 = 释放锁;
  process.on("exit", 释放锁);

  await 启动主控();
  await 连接苦音();

  const 服务 = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    // MCP（Streamable HTTP）
    if (url.pathname === "/mcp") {
      void 处理MCP(req, res);
      return;
    }

    // 插件 UI 静态资源
    if (url.pathname.startsWith("/plugin-ui/")) {
      void 发送插件UI(req, res, url);
      return;
    }

    // 插件页面列表
    if (req.method === "GET" && url.pathname === "/api/plugin-pages") {
      发送JSON(res, 200, 列出插件页面());
      return;
    }

    // 本地文件读取（支持 Range，用于图片/音视频预览）
    if (req.method === "GET" && url.pathname === "/api/file") {
      const 文件 = url.searchParams.get("path");
      if (!文件 || !existsSync(文件)) {
        res.writeHead(404).end("Not Found");
        return;
      }
      发送文件(req, res, 文件);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      void 处理API(req, res, url);
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405).end("Method Not Allowed");
      return;
    }
    if (url.pathname === "/favicon.ico") {
      发送文件(req, res, resolve(__dirname, "assets", "icon.jpg"));
      return;
    }
    const 目标 = 解析静态路径(url.pathname);
    if (!目标) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    发送文件(req, res, 目标);
  });

  const wss = new WebSocketServer({ server: 服务, path: "/ws" });
  wss.on("connection", (端) => {
    订阅者.add(端);
    端.on("close", () => 订阅者.delete(端));
    端.on("error", () => 订阅者.delete(端));
    if (已就绪) 端.send(JSON.stringify({ type: "ready" }));
  });

  服务.listen(WebUI端口, "127.0.0.1", () => {
    const 地址 = `http://127.0.0.1:${WebUI端口}`;
    console.log(`[WebUI] 苦瓜工作室已启动：${地址}`);
    启动托盘(地址);
    if (自动打开) 打开浏览器(地址);
  });
}

function 打开浏览器(url: string): void {
  try {
    if (process.platform === "win32") exec(`start "" "${url}"`);
    else if (process.platform === "darwin") exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
  } catch {
    /* 忽略 */
  }
}

/** Windows 系统托盘（PowerShell NotifyIcon）：打开 / 开机启动 / 退出 */
function 启动托盘(url: string): void {
  if (process.platform !== "win32") return;
  if (配置.webui?.tray === false) return;
  const 脚本 = resolve(__dirname, "..", "tray.ps1");
  if (!existsSync(脚本)) return;
  const 图标 = resolve(__dirname, "assets", "icon.jpg");
  const 数据目录 = process.env.KUGUA_DATA_DIR || join(process.cwd(), "data");
  const 日志 = join(数据目录, "tray.log");
  try {
    mkdirSync(数据目录, { recursive: true });
    const fd = openSync(日志, "a");
    const p = spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        脚本,
        "-Url",
        url,
        "-ServerPid",
        String(process.pid),
        "-Root",
        process.cwd(),
        "-IconPath",
        图标,
        "-LogPath",
        日志,
      ],
      { stdio: ["ignore", fd, fd], windowsHide: true },
    );
    p.unref();
  } catch {
    /* 托盘启动失败不影响服务 */
  }
}

/**
 * 重启平台：
 *   1) 先关闭子模块与主控（避免端口占用/孤儿进程）；
 *   2) 以 detached 方式重新启动本 WebUI 脚本（同一 cwd / 环境变量 / 参数）；
 *   3) 退出当前进程。
 * 新实例会通过单实例守卫确认旧实例已退出后再接管。
 */
async function 重启平台(): Promise<void> {
  console.log("[WebUI] 正在重启平台……");
  const 入口 = process.argv[1];
  const 参数 = process.argv.slice(2);
  // 关闭主控（主控会广播 system.shutdown 并结束所有子模块）
  try {
    苦音客户端?.close();
  } catch {
    /* 忽略 */
  }
  const 主控 = 主控进程;
  if (主控 && !主控.killed) {
    await new Promise<void>((resolve) => {
      const 完成 = (): void => resolve();
      主控.once("exit", 完成);
      主控.kill("SIGTERM");
      setTimeout(完成, 3000);
    });
  }
  if (入口) {
    try {
      const 子 = spawn(process.execPath, [入口, ...参数], {
        cwd: process.cwd(),
        env: process.env,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      子.unref();
    } catch (err) {
      console.error("[WebUI] 重启时启动新实例失败：", err);
    }
  }
  // 释放实例锁后退出（新实例才能接管）
  释放实例锁();
  process.exit(0);
}

/** 退出清理 */
function 注册退出(): void {
  const 清理 = (): void => {
    苦音客户端?.close();
    主控进程?.kill();
  };
  process.on("SIGINT", () => {
    清理();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    清理();
    process.exit(0);
  });
}

注册退出();
主流程().catch((err) => {
  console.error("[WebUI] 启动失败：", err);
  process.exit(1);
});

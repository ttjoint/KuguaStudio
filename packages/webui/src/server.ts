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
import { resolve, join, extname, dirname, sep } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  statSync,
  createReadStream,
  readdirSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import { NiganeClient } from "@kugua/nigane";
import { 每秒推送上限 } from "@kugua/nigane";
import { 推送限流 } from "./widget-throttle.js";
import { MCP服务器 } from "@kugua/mcp";
import type { 能力声明 } from "@kugua/capability";
import { 获取单实例锁, 读取单实例锁, 抢占全局单例锁, 全局单例锁路径, 数据根 } from "@kugua/paths";

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
    /**
     * 启动 GUI 用哪种方式：
     *   "desktop" 桌面壳（Tauri，独立窗口，不依赖浏览器）
     *   "browser" 浏览器版（默认浏览器打开 http://127.0.0.1:<port>）
     *
     * 由 start.bat 读取；桌面壳模式下若已有实例在跑，只是把已有窗口唤到前台。
     */
    gui?: "desktop" | "browser";
  };
  plugins?: {
    /** 插件目录，默认 plugins */
    dir?: string;
  };
}

/**
 * 仓库根：server.js 在 packages/webui/dist/，上溯三级即仓库根。
 *
 * 用 __dirname 而不是 process.cwd()——WebUI 也可能被从任意目录拉起
 * （脚本、快捷方式、开机任务），cwd 一旦不是仓库根，配置、插件目录、
 * 桌面端 exe、数据目录、托盘 -Root **全部**指错地方，而且大多是静默降级：
 * 插件"消失"、模块页打不开、莫名回落浏览器模式、托盘不出现。
 */
const 仓库根 = resolve(__dirname, "..", "..", "..");
function 加载配置(): 配置 {
  // 相对路径按「调用者的 cwd」解析（那是用户意图），没给就找仓库根下的配置。
  const 路径 = process.env.KUGUA_CONFIG
    ? resolve(process.cwd(), process.env.KUGUA_CONFIG)
    : join(仓库根, "kugua.config.json");
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
/**
 * 读取 `--port 8080` / `--port=8080` 形式的命令行端口。
 *
 * 为什么需要它：登录计划任务里的参数是本脚本写死进任务定义的，
 * 用环境变量传不进任务（那只是安装脚本自己进程的环境）。命令行参数
 * 能在 `schtasks /Query` 里直接看到，出问题好排查。
 */
function 命令行端口(): number | undefined {
  const 参数 = process.argv.slice(2);
  for (let i = 0; i < 参数.length; i++) {
    const a = 参数[i];
    let 值: string | undefined;
    if (a === "--port") 值 = 参数[i + 1];
    else if (a.startsWith("--port=")) 值 = a.slice("--port=".length);
    if (值 !== undefined) {
      const n = Number(值);
      // 非法端口直接忽略而不是静默用 0（0 会让系统随便分一个，更难察觉）
      if (Number.isInteger(n) && n > 0 && n < 65536) return n;
      console.warn(`[WebUI] 忽略无效的 --port 值：${值}`);
      return undefined;
    }
  }
  return undefined;
}
const 端口覆盖 = 命令行端口();
const WebUI端口 = Number(端口覆盖 ?? process.env.KUGUA_WEBUI_PORT ?? 配置.webui?.port ?? 24600);
const 自动打开 = process.argv.includes("--no-open") ? false : 配置.webui?.open !== false;

let 主控进程: ChildProcess | null = null;
let 苦音客户端: NiganeClient | null = null;
let 已就绪 = false;
/** 平台实例锁（全系统单例，与 cwd / 配置 / KUGUA_DATA_DIR 无关） */
const 实例锁路径 = 全局单例锁路径();
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


/**
 * 仓库根目录：从本文件位置推，**不依赖 cwd**。
 *
 * 原来用 process.cwd() 定位主控脚本，导致从子目录或任意目录启动时拼出
 * 不存在的路径。更糟的是它只打一行警告就继续——用户得到一个能打开但
 * 什么都不能做的界面，而且它已经把全局锁抢走了，正常启动反而被拒。
 *
 * dist/server.js → packages/webui/dist → packages/webui → packages → 仓库根
 */
/* 仓库根的定义已提前到文件前部（加载配置要用） */

/**
 * 启动主控子进程。resolve(true) = 主控确实就绪；resolve(false) = 没起来。
 *
 * 后者必须让调用方看清楚：以前无论成败都 resolve，WebUI 照常对外服务，
 * 用户打开界面能看到一切，只是所有操作都失败。**半启动比不启动更难查**。
 */
function 启动主控(): Promise<boolean> {
  return new Promise((res) => {
    const 主控脚本 = join(仓库根, "packages", "main", "dist", "index.js");
    if (!existsSync(主控脚本)) {
      console.error(`[WebUI] 未找到主控脚本：${主控脚本}，请先运行 npm run build`);
      // 主控脚本都没有，界面起来也没意义——不要占着锁装成启动成功
      res(false);
      return;
    }
    // KUGUA_LOCK_HELD=1：告诉子主控「锁已由本 WebUI 持有」，同一实例不重复抢锁
    //
    // windowsHide: true 是必须的。Windows 上 spawn 默认会给子进程分配一个新的
    // 控制台窗口——主控会一直运行，那个黑框也就一直挂在桌面上（表现为"点重启
    // 之后多了个关不掉的黑窗口"）。stdio 用 pipe 而不是 ignore，是因为下面要
    // 读它的输出判断就绪，所以隐藏窗口只能靠这个标志，不能靠 detach。
    // 用 process.execPath 而不是 "node"：开机计划任务、托盘拉起、从 IDE
    // 启动等场景下 PATH 未必包含 node，或者 "node" 指向一个 shim。
    // 当前进程能跑，说明这个绝对路径一定可用。
    const proc = spawn(process.execPath, [主控脚本], {
      stdio: "pipe",
      cwd: 仓库根,
      env: { ...process.env, KUGUA_LOCK_HELD: "1" },
      windowsHide: true,
    });
    主控进程 = proc;
    let 已就绪 = false;
    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      console.log("[主控]", text.trim());
      if (!已就绪 && text.includes("苦音服务端已启动")) {
        已就绪 = true;
        res(true);
      }
    });
    proc.stderr?.on("data", (data: Buffer) => console.error("[主控]", data.toString().trim()));
    proc.on("error", (err) => {
      console.error(`[主控] 无法启动：${err.message}`);
      主控进程 = null;
      res(false);
    });
    // 主控启动失败（如端口被其他程序占用）→ 不要假装成功，直接退出并释放锁
    proc.on("exit", (码) => {
      主控进程 = null;
      if (码 !== 0 && 码 !== null) {
        console.error(`[主控] 启动失败（退出码 ${码}），WebUI 一并退出。`);
        释放实例锁();
        process.exit(码);
      }
      // 主控**主动退出**且非 0：已经 process.exit，走不到这里
      res(false);
    });
    // 3 秒兜底：主控没打印就绪标识但进程还活着（输出被缓冲、启动慢）。
    // 这种情况按「没就绪」处理——宁可报错让用户重试，也不要放一个空壳出去。
    setTimeout(() => {
      if (!已就绪) res(false);
    }, 3000);
  });
}

/** 小组件推送限流器（每个来源独立计数） */
const 小组件限流 = new 推送限流(每秒推送上限);

/**
 * 是否允许本次小组件推送通过。
 *
 * 高频推送是必然的（有人会每 100ms 推一次），而界面根本画不了那么快。
 * 超出**丢弃而不排队**——旧数据没有价值，排队只会让显示越来越滞后。
 */
function 允许推送(来源: string): boolean {
  return 小组件限流.通过(来源);
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
  for (const 动作 of ["capability.changed", "registry.changed", "plugins.changed", "widgets.changed"]) {
    苦音客户端.onEvent(动作, (数据: unknown) => 推送({ type: "bus", action: 动作, params: 数据 }));
  }
  // 小组件数据推送。
  // 来源取自**载荷**而非信封：插件与 plugins 模块共用一个连接，
  // 信封的 from 永远是 `plugins`，区分不出具体插件。载荷里的 `来源`
  // 由 plugins 模块在转发时写入并覆盖插件的同名字段，插件无法伪造。
  苦音客户端.onEvent("widget.data", (数据) => {
    const p = (数据 ?? {}) as Record<string, unknown>;
    const 来源 = String(p.来源 ?? "");
    if (!来源) return;
    if (!允许推送(来源)) return;
    推送({
      type: "bus",
      action: "widget.data",
      params: { 来源, id: p.id, 值: p.值 ?? p.value, 副标题: p.副标题 ?? p.subtitle },
    });
  });
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
  return resolve(仓库根, 配置.plugins?.dir ?? "plugins");
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
  const 路径 = 安全解码路径(url.pathname).replace(/^\/plugin-ui\//, "");
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


/** 模块页声明（来自模块握手时的 `ui` 字段） */
interface 模块页 {
  name: string;
  title: string;
  entry: string;
}

/** 模块 UI 根目录缓存：模块名 → 物理根目录（由模块入口路径推断） */
const 模块UI根缓存 = new Map<string, string>();

/**
 * 取得模块 UI 的物理根目录。
 *
 * 模块可能在任意位置，平台只知道它的入口文件路径（`entry`），
 * 因此约定 UI 目录**相对于入口文件所在目录**。
 */
async function 解析模块UI根(名: string): Promise<string | null> {
  const 缓存 = 模块UI根缓存.get(名);
  if (缓存 && existsSync(缓存)) return 缓存;

  if (!苦音客户端) return null;
  try {
    const 详情 = (await 苦音客户端.request("nigane", "nigane.registry.details", {}, 3000)) as Array<{
      name: string;
      entry?: string;
    }>;
    const 项 = 详情.find((d) => d.name === 名);
    if (!项?.entry) return null;
    const 根 = dirname(resolve(仓库根, 项.entry));
    if (!existsSync(根)) return null;
    模块UI根缓存.set(名, 根);
    return 根;
  } catch {
    return null;
  }
}

/** 列出所有带 UI 声明的模块 */
async function 列出模块页面(): Promise<模块页[]> {
  if (!苦音客户端) return [];
  try {
    const 详情 = (await 苦音客户端.request("nigane", "nigane.registry.details", {}, 3000)) as Array<{
      name: string;
      ui?: { title?: string; entry?: string };
    }>;
    return (详情 ?? [])
      .filter((d) => d.ui)
      .map((d) => ({
        name: d.name,
        title: d.ui?.title ?? d.name,
        entry: d.ui?.entry ?? "index.html",
      }));
  } catch {
    return [];
  }
}

/** 发送模块 UI 文件（防目录穿越） */
async function 发送模块UI(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const 路径 = 安全解码路径(url.pathname).replace(/^\/module-ui\//, "");
  const 斜 = 路径.indexOf("/");
  const 名 = 斜 === -1 ? 路径 : 路径.slice(0, 斜);
  let 相对 = 斜 === -1 ? "" : 路径.slice(斜 + 1);
  if (!名) {
    res.writeHead(404).end("Not Found");
    return;
  }
  const 根 = await 解析模块UI根(名);
  if (!根) {
    res.writeHead(404).end("Not Found");
    return;
  }
  if (!相对) {
    const 页 = (await 列出模块页面()).find((p) => p.name === 名);
    相对 = 页?.entry ?? "index.html";
  }
  const 目标 = resolve(根, 相对);
  // 防目录穿越：解析后必须仍在根目录内
  if (!目标.startsWith(根 + sep) && 目标 !== 根) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(目标) || !statSync(目标).isFile()) {
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

/**
 * 安全解码 URL 路径。
 *
 * `decodeURIComponent` 遇到裸 `%`（或截断的 `%E4`）会抛 `URIError`。
 * 这个异常发生在 `createServer` 回调里，**没人接**，于是整个 WebUI 进程直接
 * 以 code=1 退出——一个不需要认证的请求就能把平台打掉。而请求方完全不需要
 * 恶意：旧书签、截断的分享链接、剪贴板里一个半截的中文链接都会变成裸 `%`。
 *
 * 所以解码失败时退回去用**原始路径**：它已经过 `new URL()` 处理，不会抛错，
 * 拿它继续去找文件，找不到就是正常的 404。宁可 404，不能崩。
 */
function 安全解码路径(值: string): string {
  try {
    return decodeURIComponent(值);
  } catch {
    return 值;
  }
}

/** 从 渲染根 安全解析静态文件路径，阻止目录穿越 */
function 解析静态路径(pathname: string): string | null {
  const 相对 = pathname === "/" ? "index.html" : 安全解码路径(pathname).replace(/^\/+/, "");
  const 目标 = resolve(渲染根, 相对);
  if (!目标.startsWith(渲染根)) return null;
  return 目标;
}

/**
 * `/api/file` 的白名单。
 *
 * ## 为什么必须加
 *
 * 改造前这个接口是 `anyPath => 发送文件(...)`，实测
 * `GET /api/file?path=D:/Projects/KuguaStudio/package.json` 直接返回 200
 * 和文件内容。也就是说**本机任何进程、以及任何能向本机发请求的网页**
 * （CSRF）都能读整个磁盘。
 *
 * ## 为什么不能只做 `startsWith(tmpdir())`
 *
 * 那样仍然能读 `%TEMP%` 下任意程序的临时文件——别的软件的私有数据、
 * 甚至凭据。真正该放行的只有「平台自己写的、且本来就会展示给前端的」目录：
 *
 * - `kugua-drop/` —— 拖拽上传的落地目录（`/api/writeTempFile` 产出的路径
 *   会被前端原样发回来取图）
 * - `kugua-clip/` —— 剪贴板图片
 * - `kugua-image-<id>/` —— 图片模块的会话目录（编辑页用）
 *
 * 目录名里的 id 段按图片模块的规则校验（`[A-Za-z0-9_-]{1,64}`），
 * 防止 `kugua-image-abc/../../..` 这种用前缀骗取信任。
 */
const 可读临时目录 = /^(kugua-drop|kugua-clip|kugua-image-[A-Za-z0-9_-]{1,64})$/;

export function 允许读取的路径(文件路径: string): boolean {
  if (typeof 文件路径 !== "string" || !文件路径) return false;
  let 绝对: string;
  try {
    // realpath 解析符号链接与 `..`，避免 `kugua-drop/../../secret` 绕过
    绝对 = realpathSync(resolve(文件路径));
  } catch {
    return false;
  }
  let 根: string;
  try {
    根 = realpathSync(resolve(tmpdir()));
  } catch {
    根 = resolve(tmpdir());
  }
  const 前缀 = 根 + sep;
  if (!绝对.startsWith(前缀)) return false;
  const 相对 = 绝对.slice(前缀.length);
  const 首段 = 相对.split(sep)[0] ?? "";
  return 可读临时目录.test(首段);
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
      try {
        const 结果 = await 苦音客户端.request(target, action, p.params, 超时毫秒);
        发送JSON(res, 200, 结果);
      } catch (err) {
        // 业务失败（模块未启动、未配置、下游报错）不是传输层故障，用 200 表达。
        // 用 5xx 的话浏览器会把每一条都当控制台错误，而「没配 OpenWebUI」
        // 这样的正常状态会把真正的问题埋在红字里。客户端看到 __kuguaError 会抛错，
        // 行为与真错误完全一致。
        发送JSON(res, 200, { __kuguaError: err instanceof Error ? err.message : String(err) });
      }
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
      setTimeout(() => void 关闭平台(0), 300);
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
  // —— 单实例守卫（只看全局锁，与端口无关）：已有实例则直接退出，绝不杀已有实例 ——
  //
  // 唯一的例外是「重启」：/api/restart 会先 spawn 新实例、再释放锁、最后才 exit。
  // 新实例若抢在旧实例退出前跑到这里，就会读到「旧实例还活着」而自己退出——
  // 结果是一次重启把平台彻底搞没了，用户只看到页面断开、毫无提示。
  // 所以重启出来的实例要短暂等待锁，而不是立刻放弃。
  const 重启接管 = process.env.KUGUA_RESTART_TAKEOVER === "1";
  let 守卫 = 单实例守卫();
  if (守卫.已有 && 重启接管) {
    for (let 第 = 0; 第 < 40 && 守卫.已有; 第++) {
      await new Promise<void>((r) => setTimeout(r, 250));
      守卫 = 单实例守卫();
    }
    if (!守卫.已有) console.log("[WebUI] 已接管上一个实例，继续启动。");
  }
  if (守卫.已有) {
    console.log(
      `[WebUI] 检测到已有苦瓜工作室实例在运行（pid=${守卫.信息?.pid}），本实例退出。\n` +
        `        若要访问已运行的实例，请打开：http://127.0.0.1:${WebUI端口}`,
    );
    process.exit(0);
  }
  // —— 端口冲突检查（与单例无关，只报“端口被占”，绝不当作已有实例）——
  if (await 主控端口被占用(主控port)) {
    console.error(
      `[WebUI] 启动失败：主控端口 ${主控host}:${主控port} 已被其他程序占用。\n` +
        `        请在 kugua.config.json 中修改 port 后重试。`,
    );
    process.exit(1);
  }
  if (await 主控端口被占用(WebUI端口)) {
    console.error(
      `[WebUI] 启动失败：WebUI 端口 127.0.0.1:${WebUI端口} 已被其他程序占用。\n` +
        `        请在 kugua.config.json 中修改 webui.port 后重试。`,
    );
    process.exit(1);
  }
  // 获取实例锁（含退出时释放）——用原子抢占，避免两个实例同时启动的竞态
  const 锁 = 抢占全局单例锁(实例锁路径, "studio", {
    入口: "webui",
    pid: process.pid,
    端口: WebUI端口,
    主控端口: 主控port,
    地址: `http://127.0.0.1:${WebUI端口}`,
  });
  if (!锁.获得) {
    console.log(`[WebUI] 已有工作室实例在运行（pid=${锁.已有?.pid}），本实例退出。`);
    process.exit(0);
  }
  const 释放锁 = (): void => 锁.释放();
  释放实例锁 = 释放锁;
  process.on("exit", 释放锁);

  // 主控没起来就不要继续：界面能打开、按钮全失灵，而且锁已被占住，
  // 用户再启动一次只会被告知「已有实例在运行」——彻底卡死。
  if (!(await 启动主控())) {
    console.error(
      '[WebUI] 主控未能启动，平台不可用，已释放实例锁。\n' +
        '        常见原因：packages/main/dist/index.js 不存在（请运行 npm run build）、' +
        '主控端口被占用（kugua.config.json 的 port）。',
    );
    释放锁();
    process.exit(1);
  }
  await 连接苦音();

  const 服务 = createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    } catch {
      // Host 头畸形（"a b"、空串、"[[" 之类）时 new URL 会抛 TypeError。
      // 这个回调里没人接异常 → 进程直接退出，同样是一个请求就打掉整个平台。
      // 伪装成 Host 极其容易，所以这里必须自己收掉。
      res.writeHead(400).end("Bad Request");
      return;
    }

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

    // 模块 UI 静态资源（模块自己声明的 iframe 页面）
    if (url.pathname.startsWith("/module-ui/")) {
      void 发送模块UI(req, res, url);
      return;
    }

    // 插件页面列表
    if (req.method === "GET" && url.pathname === "/api/plugin-pages") {
      发送JSON(res, 200, 列出插件页面());
      return;
    }

    // 模块页面列表
    if (req.method === "GET" && url.pathname === "/api/module-pages") {
      void 列出模块页面().then((页) => 发送JSON(res, 200, 页));
      return;
    }

    // 本地文件读取（支持 Range，用于图片/音视频预览）
    if (req.method === "GET" && url.pathname === "/api/file") {
      const 文件 = url.searchParams.get("path");
      // 403 而非 404：路径存在但不在白名单里，用户需要知道是「拒绝」而不是
      // 「文件没了」——后者会让人以为自己路径写错了，往反方向排查。
      if (!文件 || !允许读取的路径(文件)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      if (!existsSync(文件)) {
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

/**
 * 定位桌面端可执行文件（Tauri 壳）。
 *
 * 托盘右键菜单要能分别打开「网页端」和「桌面端」，所以后端得知道壳在哪。
 * 找不到时返回空串，托盘那边会把「打开桌面端」置灰并提示如何构建，
 * 而不是让用户点了没反应。
 */
function 桌面端路径(): string {
  const 候选 = [
    join(仓库根, "packages", "desktop", "src-tauri", "target", "release", "kugua-desktop.exe"),
    join(仓库根, "packages", "desktop", "src-tauri", "target", "debug", "kugua-desktop.exe"),
  ];
  for (const 路径 of 候选) if (existsSync(路径)) return 路径;
  return "";
}

/** Windows 系统托盘（PowerShell NotifyIcon）：打开（桌面端/网页端） / 开机启动 / 退出 */
function 启动托盘(url: string): void {
  if (process.platform !== "win32") return;
  if (配置.webui?.tray === false) return;
  const 脚本 = resolve(__dirname, "..", "tray.ps1");
  if (!existsSync(脚本)) return;
  const 图标 = resolve(__dirname, "assets", "icon.jpg");
  const 数据目录 = process.env.KUGUA_DATA_DIR || join(仓库根, "data");
  const 日志 = join(数据目录, "tray.log");
  try {
    mkdirSync(数据目录, { recursive: true });
    const fd = openSync(日志, "a");
    // 用 RemoteSigned 而非 Bypass：本地脚本在 RemoteSigned 下本来就允许执行，
    // 而 Bypass 是恶意脚本绕策略的典型特征，会显著提高杀软误报率
    // （本项目的"托盘 + 开机启动计划任务 + 强制结束进程"组合本身已经很像木马）。
    const p = spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "RemoteSigned",
        "-WindowStyle",
        "Hidden",
        "-File",
        脚本,
        "-Url",
        url,
        "-ServerPid",
        String(process.pid),
        "-Root",
        仓库根,
        "-IconPath",
        图标,
        "-LogPath",
        日志,
        "-DesktopExe",
        桌面端路径(),
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
/**
 * 请求主控优雅关闭。
 *
 * 不能直接用 `主控进程.kill("SIGTERM")`：Windows 上它实际上是 `TerminateProcess` 硬杀，
 * 主控的 `process.on("SIGTERM")` 不会执行，`system.shutdown` 广播就发不出去，
 * 运行中接入的外部程序收不到退出信号。
 * 所以走主控内置动作 `nigane.shutdown`。失败时才回退到 kill。
 */
async function 请求主控关闭(): Promise<void> {
  try {
    await 苦音客户端?.request("kugua-main", "nigane.shutdown", {}, 3000);
    console.log("[WebUI] 已请求主控优雅关闭（system.shutdown 已广播）");
  } catch (err) {
    console.warn(`[WebUI] 请求主控优雅关闭失败，回退到 kill：${String(err)}`);
    try {
      主控进程?.kill("SIGTERM");
    } catch {
      /* 忽略 */
    }
  }
}

/** 平台整体退出：先让主控优雅关闭（广播 system.shutdown），再退出自身 */
/**
 * 广播「平台正在主动退出」给所有已连接的页面。
 *
 * 为什么要主动发：桌面端（Tauri 壳）在页面之外还有个进程监护逻辑，
 * 它只能通过探测端口发现后端没了——那意味着用户点了「退出平台」之后，
 * 桌面窗口还要**空等十来秒**才自己关掉，期间界面已经连不上了，
 * 看起来就是"点了退出，然后卡住失联"。
 *
 * 主动推一条消息，桌面端就能立刻收工。Web 网页端收到这个也一样处理
 * （显示"平台已退出"），比干等超时体验好。
 *
 * 注意：必须是**尽力而为**——发不出去（页面已断、缓冲满）不能阻塞退出流程，
 * 所以整段包在 try 里，且不等回执。
 */
function 广播平台退出(原因: "shutdown" | "restart"): void {
  const 消息 = JSON.stringify({ type: "platform_exit", reason: 原因 });
  for (const 端 of 订阅者) {
    try {
      if (端.readyState === 1) 端.send(消息);
    } catch {
      /* 单个连接失败不影响其它连接，也不影响退出 */
    }
  }
}

async function 关闭平台(码: number): Promise<void> {
  // 先通知页面再收东西：此刻连接都还活着，消息能立刻发出
  广播平台退出("shutdown");
  await 请求主控关闭();
  // 给主控一点时间结束托管子进程并关闭 WebSocket
  await new Promise<void>((resolve) => setTimeout(resolve, 1200));
  try {
    苦音客户端?.close();
  } catch {
    /* 忽略 */
  }
  process.exit(码);
}

async function 重启平台(): Promise<void> {
  console.log("[WebUI] 正在重启平台……");
  // 重启也告知一声：桌面端据此**不要**退出（只是短暂失联），
  // 从而和"退出平台"明确区分开
  广播平台退出("restart");
  const 入口 = process.argv[1];
  const 参数 = process.argv.slice(2);
  // 关闭主控（主控会广播 system.shutdown 并结束所有子模块）
  await 请求主控关闭();
  const 主控 = 主控进程;
  if (主控 && !主控.killed) {
    await new Promise<void>((resolve) => {
      const 完成 = (): void => resolve();
      主控.once("exit", 完成);
      // Windows 上 kill("SIGTERM") 实际是硬杀，仅在请求关闭失败时兜底
      主控.kill("SIGTERM");
      setTimeout(完成, 3000);
    });
  }
  if (入口) {
    try {
      const 子 = spawn(process.execPath, [入口, ...参数], {
        // 重启用的 cwd 也要跟着文件位置走，不能依赖当前 cwd
        cwd: 仓库根,
        // KUGUA_RESTART_TAKEOVER：新实例允许短暂等待旧实例释放锁。
        // 旧实例退出与锁释放之间必然有窗口期，不等就可能自己放弃。
        env: { ...process.env, KUGUA_RESTART_TAKEOVER: "1" },
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      子.unref();
    } catch (err) {
      console.error("[WebUI] 重启时启动新实例失败：", err);
      // 新实例没起来就别走了，否则平台直接消失
      return;
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

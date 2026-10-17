// 前端门禁：启动 WebUI（含主控与模块），用无头 Chrome 跑 UI 回归，然后清理进程树。
// 用法：node packages/webui/scripts/ui-gate.mjs
// 退出码：0 通过（或未找到浏览器而跳过）；1 回归失败；2 环境异常。
//
// 安全约定：本脚本使用**动态空闲端口 + 独立配置**启动自己的实例，
// 并在结束时只结束自己启动的进程树；不会去结束占用 24600/24601 的进程，
// 因此可以放心地在用户已开着平台实例时运行。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 包根 = join(dirname(fileURLToPath(import.meta.url)), "..");
const 仓库根 = resolve(包根, "..", "..");

const 浏览器 = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));

if (!浏览器) {
  console.log("[ui-gate] 未找到 Chrome/Edge，跳过 UI 回归（前端门禁需要浏览器）。");
  process.exit(0);
}

const 服务脚本 = join(包根, "dist", "server.js");
if (!existsSync(服务脚本)) {
  console.error("[ui-gate] 未找到 " + 服务脚本 + "，请先执行 npm run build -w @kugua/webui");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 取一个当前空闲的 TCP 端口 */
function 取空闲端口() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const 端口 = await 取空闲端口();
const 同步端口 = await 取空闲端口();
const 数据目录 = mkdtempSync(join(tmpdir(), "kugua-uigate-"));
const 配置路径 = join(数据目录, "kugua.config.json");
const 地址 = `http://127.0.0.1:${端口}/`;

// 以仓库配置为模板，覆写端口与模块入口（保持模块表不变），写入独立临时配置。
// 同时把知识库/审计库指向临时目录，避免 UI 回归写入用户的真实数据。
{
  const 模板 = JSON.parse(readFileSync(join(仓库根, "kugua.config.json"), "utf-8"));
  模板.port = 同步端口;
  模板.webui = { ...(模板.webui ?? {}), port: 端口, open: false };
  模板.mkg = { ...(模板.mkg ?? {}), dbPath: join(数据目录, "data", "mkg.db") };
  模板.audit = { ...(模板.audit ?? {}), dbPath: join(数据目录, "data", "audit.db") };
  writeFileSync(配置路径, JSON.stringify(模板, null, 2), "utf-8");
}

const 服务 = spawn(process.execPath, [服务脚本, "--no-open"], {
  cwd: 仓库根,
  env: {
    ...process.env,
    KUGUA_CONFIG: 配置路径,
    KUGUA_WEBUI_PORT: String(端口),
    KUGUA_DATA_DIR: join(数据目录, "data"),
    // 隔离实例使用独立的全局单例锁，避免与用户正在运行的 Studio 抢锁
    KUGUA_GLOBAL_LOCK: join(数据目录, "studio.lock"),
    KUGUA_AUDIT_DB: join(数据目录, "data", "audit.db"),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let 服务输出 = "";
服务.stdout.on("data", (d) => (服务输出 += d.toString()));
服务.stderr.on("data", (d) => (服务输出 += d.toString()));

function 结束服务() {
  // 只结束本脚本启动的进程树（含其拉起的主控与模块），绝不按端口/进程名误杀用户实例
  try {
    if (服务.pid) spawnSync("taskkill", ["/PID", String(服务.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {}
  try {
    服务.kill();
  } catch {}
  try {
    rmSync(数据目录, { recursive: true, force: true });
  } catch {}
}

let 就绪 = false;
for (let i = 0; i < 120; i++) {
  try {
    const r = await fetch(地址);
    if (r.status === 200) {
      就绪 = true;
      break;
    }
  } catch {}
  await sleep(1000);
}
if (!就绪) {
  console.error("[ui-gate] WebUI 未在 120 秒内就绪。服务输出：\n" + 服务输出.slice(-3000));
  结束服务();
  process.exit(2);
}
console.log("[ui-gate] WebUI 就绪（隔离实例），" + 地址);

// 静态资源与桥接脚本自检（语法解析，不执行）
{
  const { Script } = await import("node:vm");
  for (const 路径 of ["/index.js", "/kugua-shim.js", "/plugin-sdk.js", "/style.css"]) {
    const 响应 = await fetch(地址.replace(/\/$/, "") + 路径);
    const 文本 = await 响应.text();
    if (响应.status !== 200 || !文本.trim()) {
      console.error(`[ui-gate] 资源异常：${路径} status=${响应.status} 空=${!文本.trim()}`);
      结束服务();
      process.exit(2);
    }
    if (路径.endsWith(".js")) {
      try {
        new Script(文本, { filename: 路径 });
      } catch (e) {
        console.error(`[ui-gate] 脚本语法错误：${路径} -> ${e.message}`);
        结束服务();
        process.exit(2);
      }
      if (路径.includes("kugua-shim") || 路径.includes("plugin-sdk")) {
        if (!文本.includes("kugua")) {
          console.error(`[ui-gate] ${路径} 未包含 kugua 桥接。`);
          结束服务();
          process.exit(2);
        }
      }
    }
  }
  console.log("[ui-gate] 静态资源与桥接脚本自检通过。");
}

const 检查 = spawn(process.execPath, [join(包根, "scripts", "ui-check.mjs"), 地址], {
  cwd: 仓库根,
  stdio: "inherit",
  windowsHide: true,
});
const 码 = await new Promise((r) => 检查.on("exit", (c) => r(c ?? 0)));

结束服务();
await sleep(500);
console.log(码 === 0 ? "[ui-gate] UI 回归通过。" : "[ui-gate] UI 回归失败。");
process.exit(码 === 0 ? 0 : 1);

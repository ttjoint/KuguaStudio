// 前端门禁：启动 WebUI（含主控与模块），用无头 Chrome 跑 UI 回归，然后清理进程树。
// 用法：node packages/webui/scripts/ui-gate.mjs
// 退出码：0 通过（或未找到浏览器而跳过）；1 回归失败；2 环境异常。
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 包根 = join(dirname(fileURLToPath(import.meta.url)), "..");
const 仓库根 = resolve(包根, "..", "..");
const 端口 = 24600;
const 同步端口 = 24601;
const 地址 = `http://127.0.0.1:${端口}/`;

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

/** 结束占用指定端口的进程（仅本项目的 node/powershell，避免误杀） */
function 释放端口(端口号) {
  try {
    const 输出 = spawnSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true }).stdout || "";
    const 行s = 输出.split(/\r?\n/).filter((l) => l.includes(`:${端口号}`) && /LISTENING/i.test(l));
    const pid集 = new Set(行s.map((l) => l.trim().split(/\s+/).pop()).filter((p) => p && /^\d+$/.test(p)));
    for (const pid of pid集) {
      spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore", windowsHide: true });
      console.log(`[ui-gate] 已结束占用端口 ${端口号} 的进程 ${pid}`);
    }
  } catch {}
}

释放端口(端口);
释放端口(同步端口);
await sleep(800);

const 服务 = spawn(process.execPath, [服务脚本, "--no-open"], {
  cwd: 仓库根,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let 服务输出 = "";
服务.stdout.on("data", (d) => (服务输出 += d.toString()));
服务.stderr.on("data", (d) => (服务输出 += d.toString()));

function 结束服务() {
  try {
    if (服务.pid) spawnSync("taskkill", ["/PID", String(服务.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {}
  try {
    服务.kill();
  } catch {}
}

let 就绪 = false;
for (let i = 0; i < 90; i++) {
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
  console.error("[ui-gate] WebUI 未在 90 秒内就绪。服务输出：\n" + 服务输出.slice(-3000));
  结束服务();
  process.exit(2);
}
console.log("[ui-gate] WebUI 就绪，" + 地址);

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
释放端口(端口);
释放端口(同步端口);
console.log(码 === 0 ? "[ui-gate] UI 回归通过。" : "[ui-gate] UI 回归失败。");
process.exit(码 === 0 ? 0 : 1);

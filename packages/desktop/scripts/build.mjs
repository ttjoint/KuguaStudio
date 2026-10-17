// 桌面壳构建脚本
//
// 直接调用 cargo，不强依赖 `cargo tauri` CLI：
//   - tauri-build 会在编译期读取 tauri.conf.json 并生成 context
//   - 只有「打安装包」（NSIS/MSI）才需要 Tauri CLI 的 bundler
//
// 用法：
//   node scripts/build.mjs           # release 构建（仅可执行文件）
//   node scripts/build.mjs --debug   # debug 构建
//   node scripts/build.mjs --bundle  # 额外尝试打安装包（需要 tauri CLI）
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 包根 = dirname(fileURLToPath(import.meta.url));
const 仓库根 = resolve(包根, "..", "..", "..");
const 壳目录 = join(仓库根, "packages", "desktop", "src-tauri");

const 参数 = process.argv.slice(2);
const 调试 = 参数.includes("--debug");
const 打包 = 参数.includes("--bundle");

// 前置检查：桌面壳加载的是 WebUI 服务端，必须先构建它
const 服务端 = join(仓库根, "packages", "webui", "dist", "server.js");
if (!existsSync(服务端)) {
  console.error("[desktop] 缺少 WebUI 构建产物，请先在仓库根执行：npm run build");
  process.exit(1);
}

const 跑 = (命令, 参数表, 目录) => {
  const 结果 = spawnSync(命令, 参数表, { stdio: "inherit", cwd: 目录, shell: process.platform === "win32" });
  if (结果.status !== 0) process.exit(结果.status ?? 1);
};

console.log("[desktop] 编译 Tauri 壳…");
跑("cargo", ["build", ...(调试 ? [] : ["--release"])], 壳目录);

if (打包) {
  console.log("[desktop] 打安装包（需要 cargo-tauri）…");
  const 检查 = spawnSync("cargo", ["tauri", "--version"], { stdio: "ignore", shell: process.platform === "win32" });
  if (检查.status !== 0) {
    console.error("[desktop] 未安装 Tauri CLI，跳过打包。安装方式：cargo install tauri-cli --version '^2'");
    process.exit(0);
  }
  跑("cargo", ["tauri", "build", ...(调试 ? ["--debug"] : [])], 壳目录);
}

const 产物 = join(壳目录, "target", 调试 ? "debug" : "release", "kugua-desktop.exe");
if (existsSync(产物)) console.log(`[desktop] 完成：${产物}`);
else console.log("[desktop] 编译完成，但未找到预期产物（请检查 cargo 输出）");

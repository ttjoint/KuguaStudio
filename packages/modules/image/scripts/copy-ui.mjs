/**
 * 把 `src/ui/` 的静态资源拷到 `dist/ui/`。
 *
 * 为什么不交给 tsc：tsc 只处理 .ts 文件，html/css/js 它看都不看。
 * 不拷的话 `界面` 声明的 entry 在 dist 里根本不存在，WebUI 拉
 * `/module-ui/image/` 会 404——而模块本身照常启动，看起来一切正常。
 *
 * 也不用 `cp -r`：Windows 上 `cp` 不一定有（Git Bash 之外就没有），
 * 而 Node 到处都能跑。
 */

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 此地 = dirname(fileURLToPath(import.meta.url));
const 根 = resolve(此地, "..");
const 源 = resolve(根, "src", "ui");
const 目标 = resolve(根, "dist", "ui");

if (!existsSync(源)) {
  console.log("[copy-ui] 没有 src/ui/，跳过");
  process.exit(0);
}

// 先删再拷：只覆盖的话，删掉的旧文件会永远留在 dist 里，
// 前端可能还在引用它们（而源码里早就不存在了）
rmSync(目标, { recursive: true, force: true });
cpSync(源, 目标, { recursive: true });
console.log(`[copy-ui] ${源} -> ${目标}`);

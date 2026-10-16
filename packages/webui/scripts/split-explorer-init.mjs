// [一次性迁移脚本] 仅用于当时的拆分；parts/ 为唯一真源，请勿重复运行（行号已失效）。
// 把 07-explorer.ts 的 init 内联绑定拆为若干命名函数，init 只做编排。
// 用法：node scripts/split-explorer-init.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const 根 = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "renderer", "parts");
const 源文件 = join(根, "07-explorer.ts");
const 原 = readFileSync(源文件, "utf8").split(/\r?\n/);

const 取块 = (a, b) => 原.slice(a - 1, b).join("\n");
const 清尾 = (s) => s.replace(/\s+$/, "");

// 各绑定函数：名称 / 异步 / 组成区块 / init 中的替换文本
const 绑定组 = [
  { 名: "绑定搜索与视图事件", 块: [[1621, 1641]], 调用: "    绑定搜索与视图事件();" },
  { 名: "绑定智能视图与位置事件", 异步: true, 块: [[1643, 1658]], 调用: "    await 绑定智能视图与位置事件();" },
  { 名: "绑定内容操作事件", 块: [[1660, 1692]], 调用: "    绑定内容操作事件();" },
  { 名: "绑定详情标签事件", 块: [[1694, 1723]], 调用: "    绑定详情标签事件();" },
  { 名: "绑定对话框事件", 块: [[1729, 1867]], 调用: "    绑定对话框事件();" },
  { 名: "绑定页面切换事件", 块: [[1869, 1902]], 调用: "    绑定页面切换事件();" },
  { 名: "绑定容器交互事件", 块: [[1903, 1930], [1936, 1945]], 调用: "    绑定容器交互事件();" },
];

const 替换行 = new Map();
const 删除 = new Set();
const 函数文本 = [];
for (const g of 绑定组) {
  const 体 = g.块.map(([a, b]) => 清尾(取块(a, b))).join("\n\n");
  函数文本.push(`  /** ${g.名}（由 init 调用） */\n  ${g.异步 ? "async " : ""}function ${g.名}(): ${g.异步 ? "Promise<void>" : "void"} {\n${体}\n  }\n`);
}

// init 内：首块替换为调用，其余行删除
for (const g of 绑定组) {
  替换行.set(g.块[0][0], g.调用);
  for (const [a, b] of g.块) {
    for (let i = a; i <= b; i++) if (i !== g.块[0][0]) 删除.add(i);
  }
}

let 结果 = [];
for (let i = 1; i <= 原.length; i++) {
  if (替换行.has(i)) { 结果.push(替换行.get(i)); continue; }
  if (删除.has(i)) continue;
  结果.push(原[i - 1]);
}
let 文本 = 结果.join("\n");

// init 前插入绑定函数
const 锚 = "  export async function init(): Promise<void> {";
if (!文本.includes(锚)) throw new Error("未找到 init 锚点");
文本 = 文本.replace(锚, 函数文本.join("\n") + "\n" + 锚);

writeFileSync(源文件, 文本, "utf8");
console.log("已拆分 init，新增绑定函数：" + 绑定组.map((g) => g.名).join("、"));

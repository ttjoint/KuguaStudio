// [一次性迁移脚本] 仅用于当时的拆分；parts/ 为唯一真源，请勿重复运行（行号已失效）。
// 从 07-explorer.ts 抽出「智能视图 / 受管位置」为独立 ES 模块。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const 根 = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "renderer", "parts");
const 源文件 = join(根, "07-explorer.ts");
const 原 = readFileSync(源文件, "utf8").split(/\r?\n/);

const 归属 = new Map();
for (const f of readdirSync(根).filter((x) => x.endsWith(".ts"))) {
  const 码 = readFileSync(join(根, f), "utf8");
  for (const 行 of 码.split(/\r?\n/)) {
    const m = 行.match(/^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(function|const|let|interface|type|class|enum)\s+([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)/);
    if (m && !归属.has(m[2])) 归属.set(m[2], f);
    const n = 行.match(/^export\s+namespace\s+([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)/);
    if (n) 归属.set(n[1], f);
  }
}

function 替换标识符(文本, 名s) {
  const 集 = new Set(名s);
  let 出 = "";
  let i = 0;
  const n = 文本.length;
  const 是id = (c) => /[A-Za-z0-9_$\u4e00-\u9fff]/.test(c);
  while (i < n) {
    const c = 文本[i], c2 = 文本[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && 文本[i] !== "\n") 出 += 文本[i++]; continue; }
    if (c === "/" && c2 === "*") { while (i < n && !(文本[i] === "*" && 文本[i + 1] === "/")) 出 += 文本[i++]; 出 += 文本[i++] ?? ""; 出 += 文本[i++] ?? ""; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; 出 += 文本[i++];
      while (i < n && 文本[i] !== q) { if (文本[i] === "\\") 出 += 文本[i++]; 出 += 文本[i++]; }
      出 += 文本[i++] ?? ""; continue;
    }
    if (/[A-Za-z_$\u4e00-\u9fff]/.test(c)) {
      let j = i; while (j < n && 是id(文本[j])) j++;
      const 词 = 文本.slice(i, j);
      const 前 = 出[出.length - 1] ?? "";
      出 += 集.has(词) && 前 !== "." ? "Explorer." + 词 : 词;
      i = j; continue;
    }
    出 += 文本[i++];
  }
  return 出;
}

const 取块 = (a, b) => 原.slice(a - 1, b);
const 去缩进 = (行s, 空格) => 行s.map((l) => (l.startsWith(" ".repeat(空格)) ? l.slice(空格) : l));
const 加导出 = (s, 名) => s.replace(new RegExp("^(?:export\\s+)?(?:async\\s+)?function " + 名 + "\\(", "m"), (m0) => (m0.startsWith("export") ? m0 : "export " + m0));

const 前缀 = [
  "内容条目", "查询条件", "保存视图", "位置",
  "当前标签ID", "类型筛选", "搜索关键词", "排序方式",
  "当前视图ID", "当前位置ID", "保存视图列表", "受管位置列表", "所有内容",
  "渲染内容列表", "渲染标签树", "加载所有内容",
];

// 1) 功能块：加载保存视图 ~ 导出侧车
let 体 = 替换标识符(去缩进(取块(1053, 1250), 2).join("\n"), 前缀);
for (const 名 of ["渲染保存视图", "渲染位置列表", "导出侧车", "加载保存视图", "加载位置"]) 体 = 加导出(体, 名);

// 2) 事件绑定块
let 绑定体 = 替换标识符(去缩进(取块(1646, 1663), 2).join("\n"), 前缀);
绑定体 = 绑定体.replace("async function 绑定智能视图与位置事件(", "export async function 绑定智能视图与位置事件(");

const 合并 = 体 + "\n\n" + 绑定体;
const 自身 = new Set(["Explorer"]);
for (const m of 合并.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|interface|type|class)\s+([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)/gm)) 自身.add(m[1]);

const 需要 = new Map();
{
  const 净 = 替换标识符(合并, []);
  const re = /[A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*/g;
  let m;
  while ((m = re.exec(净))) {
    const 名 = m[0];
    if (自身.has(名) || 净[m.index - 1] === ".") continue;
    const f = 归属.get(名);
    if (!f || f === "07-explorer.ts") continue;
    if (!需要.has(f)) 需要.set(f, new Set());
    需要.get(f).add(名);
  }
}
const 导入 = ['import { Explorer } from "./07-explorer";'];
for (const [f, 集] of [...需要.entries()].sort()) 导入.push(`import { ${[...集].sort().join(", ")} } from "./${f.replace(/\.ts$/, "")}";`);

const 内容 = `// ===== 智能视图 / 受管位置 =====\n// 由 07-explorer.ts 拆分而来。\n${导入.join("\n")}\n\n${合并}\n`;
writeFileSync(join(根, "07h-explorer-views.ts"), 内容, "utf8");
console.log(`已生成 07h-explorer-views.ts（${内容.split("\n").length} 行）`);

// 3) 改写 07-explorer.ts
const 删除 = new Set();
for (let i = 1053; i <= 1250; i++) 删除.add(i);
for (let i = 1646; i <= 1663; i++) 删除.add(i);
let 结果 = [];
for (let i = 1; i <= 原.length; i++) {
  if (删除.has(i)) continue;
  结果.push(原[i - 1]);
}
let 文本 = 结果.join("\n");

for (const t of [
  "  interface 查询条件 {",
  "  interface 保存视图 {",
  "  interface 位置 {",
  '  let 当前标签ID: number | "all" = "all";',
  '  let 搜索关键词 = "";',
  '  let 类型筛选: string = "all";',
  '  let 排序方式: "import" | "name" | "updated" = "import";',
  "  let 当前视图ID: number | null = null;",
  "  let 当前位置ID: number | null = null;",
  "  let 保存视图列表: 保存视图[] = [];",
  "  let 受管位置列表: 位置[] = [];",
  "  function 渲染内容列表(): void {",
  "  function 渲染标签树(): void {",
]) {
  if (!文本.includes(t)) { console.log("警告：未找到导出目标 -> " + t.trim()); continue; }
  文本 = 文本.replace(t, t.replace(/^ {2}/, "  export "));
}

文本 = 文本.replace(/^(\s*)let 所有内容: 内容条目\[\] = \[\];/m, "$1export let 所有内容: 内容条目[] = [];");

文本 = 文本.replace(
  'import { 切换视图 } from "./11-tabs";',
  'import { 切换视图 } from "./11-tabs";\nimport { 绑定智能视图与位置事件, 导出侧车, 渲染保存视图, 渲染位置列表, 加载保存视图, 加载位置 } from "./07h-explorer-views";',
);

writeFileSync(源文件, 文本, "utf8");
console.log(`已改写 07-explorer.ts（${结果.length} 行）`);

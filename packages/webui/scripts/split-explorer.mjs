// [一次性迁移脚本] 仅用于当时的拆分；parts/ 为唯一真源，请勿重复运行（行号已失效）。
// 从 07-explorer.ts 抽出三个自洽子视图（笔记 / 素材 / 看板）为独立 ES 模块。
// 用法：node scripts/split-explorer.mjs   （需先还原 07-explorer.ts 为拆分前版本）
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const 根 = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "renderer", "parts");
const 源文件 = join(根, "07-explorer.ts");
const 原 = readFileSync(源文件, "utf8").split(/\r?\n/);

// ---------- 声明归属表（用于自动生成 import） ----------
const 归属 = new Map();
for (const f of readdirSync(根).filter((x) => x.endsWith(".ts"))) {
  const 码 = readFileSync(join(根, f), "utf8");
  for (const 行 of 码.split(/\r?\n/)) {
    // 只认模块顶层声明（不含 namespace 内成员——那些通过 Explorer. 访问）
    const m = 行.match(/^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(function|const|let|interface|type|class|enum)\s+([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)/);
    if (m && !归属.has(m[2])) 归属.set(m[2], f);
    const n = 行.match(/^export\s+namespace\s+([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)/);
    if (n) 归属.set(n[1], f);
  }
}

/** 只替换代码上下文（跳过注释与字符串）中的标识符 */
function 替换标识符(文本, 名s) {
  const 集 = new Set(名s);
  let 出 = "";
  let i = 0;
  const n = 文本.length;
  const 是id = (c) => /[A-Za-z0-9_$\u4e00-\u9fff]/.test(c);
  while (i < n) {
    const c = 文本[i], c2 = 文本[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && 文本[i] !== "\n") 出 += 文本[i++]; continue; }
    if (c === "/" && c2 === "*") {
      while (i < n && !(文本[i] === "*" && 文本[i + 1] === "/")) 出 += 文本[i++];
      出 += 文本[i++] ?? ""; 出 += 文本[i++] ?? ""; continue;
    }
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

/** 去掉注释/字符串后扫描标识符 */
function 扫描(文本) {
  const 净 = 替换标识符(文本, []); // 仅用于净化
  const 集 = new Set();
  const re = /[A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*/g;
  let m;
  while ((m = re.exec(净))) {
    const 前 = 净[m.index - 1];
    if (前 !== ".") 集.add(m[0]);
  }
  return 集;
}

const 取块 = (a, b) => 原.slice(a - 1, b);
const 去缩进 = (行s, 空格) => 行s.map((l) => (l.startsWith(" ".repeat(空格)) ? l.slice(空格) : l));

const 分组 = [
  {
    文件: "07d-explorer-notes.ts",
    头: "// ===== 点子视图（笔记）=====",
    状态: [82, 86],
    块: [[1916, 1916], [1935, 2113]],
    前缀: ["标签树", "渲染可勾选标签树", "加载标签树", "标签ID转名称", "格式化笔记时间"],
    导出: ["加载笔记"],
    绑定: { 起: 2931, 止: 2944, 名: "绑定笔记事件" },
  },
  {
    文件: "07e-explorer-materials.ts",
    头: "// ===== 素材视图 =====",
    状态: [87, 91],
    块: [[2114, 2330]],
    前缀: ["标签树", "渲染可勾选标签树", "加载标签树", "标签ID转名称", "格式化笔记时间"],
    导出: ["加载素材"],
    绑定: { 起: 2946, 止: 2960, 名: "绑定素材事件" },
  },
  {
    文件: "07f-explorer-board.ts",
    头: "// ===== 看板视图 =====",
    状态: [93, 97],
    块: [[2331, 2625]],
    前缀: ["标签树", "渲染可勾选标签树", "加载标签树", "标签ID转名称"],
    导出: ["加载看板"],
    绑定: { 起: 2962, 止: 2984, 名: "绑定看板事件" },
  },
];

const 生成 = [];
for (const g of 分组) {
  let 体行s = [];
  for (const [a, b] of g.块) 体行s = 体行s.concat(取块(a, b));
  体行s = 去缩进(体行s, 2);
  let 体 = 替换标识符(体行s.join("\n"), g.前缀);

  // 给入口函数加 export
  for (const 名 of g.导出) {
    体 = 体.replace(new RegExp(`^async function ${名}\\(`, "m"), `export async function ${名}(`);
  }

  const 状态 = 去缩进(取块(g.状态[0], g.状态[1]), 2).join("\n");
  const 绑定行s = 去缩进(取块(g.绑定.起, g.绑定.止), 4);
  const 绑定 = `\n/** 绑定事件（由 07-explorer 的 init 调用） */\nexport function ${g.绑定.名}(): void {\n${绑定行s.map((l) => (l ? "  " + l : l)).join("\n")}\n}\n`;

  // 自身声明集合
  const 自身 = new Set(["Explorer"]);
  for (const m of (状态 + "\n" + 体 + "\n" + 绑定).matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|interface|type|class)\s+([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)/gm)) 自身.add(m[1]);

  // 引用到的外部符号
  const 引用 = 扫描(状态 + "\n" + 体 + "\n" + 绑定);
  const 需要 = new Map();
  for (const 名 of 引用) {
    if (自身.has(名)) continue;
    const f = 归属.get(名);
    if (!f || f === g.文件 || f === "07-explorer.ts") continue;
    if (!需要.has(f)) 需要.set(f, new Set());
    需要.get(f).add(名);
  }
  const 导入 = ['import { Explorer } from "./07-explorer";'];
  for (const [f, 名集] of [...需要.entries()].sort()) {
    导入.push(`import { ${[...名集].sort().join(", ")} } from "./${f.replace(/\.ts$/, "")}";`);
  }

  const 内容 = `${g.头}\n// 由 07-explorer.ts 拆分而来。\n${导入.join("\n")}\n\n// ---- 模块状态 ----\n${状态}\n\n${体}\n${绑定}`;
  生成.push({ ...g, 内容 });
  writeFileSync(join(根, g.文件), 内容, "utf8");
  console.log(`已生成 ${g.文件}（${内容.split("\n").length} 行，导入 ${导入.length - 1} 组）`);
}

// ---------- 改写 07-explorer.ts ----------
const 删除 = new Set();
for (let i = 81; i <= 97; i++) 删除.add(i);
删除.add(1916);
for (let i = 1935; i <= 2625; i++) 删除.add(i);
const 替换行 = new Map();
for (const g of 分组) {
  替换行.set(g.绑定.起, `    ${g.绑定.名}();`);
  for (let i = g.绑定.起 + 1; i <= g.绑定.止; i++) 删除.add(i);
}
let 结果 = [];
for (let i = 1; i <= 原.length; i++) {
  if (替换行.has(i)) { 结果.push(替换行.get(i)); continue; }
  if (删除.has(i)) continue;
  结果.push(原[i - 1]);
}
let 文本 = 结果.join("\n");

for (const t of [
  "  let 标签树: 标签节点[] = [];",
  "  async function 加载标签树(重试次数 = 0): Promise<void> {",
  "  function 渲染可勾选标签树(tree: 标签节点[], opts: 可勾选标签树选项): void {",
  "  function 标签ID转名称(id: number): string {",
  "  function 格式化笔记时间(秒: number): string {",
]) {
  if (!文本.includes(t)) { console.log("警告：未找到导出目标 -> " + t.trim()); continue; }
  文本 = 文本.replace(t, t.replace(/^  /, "  export "));
}

const 导入行 = 分组.map((g) => `import { ${g.导出[0]}, ${g.绑定.名} } from "./${g.文件.replace(/\.ts$/, "")}";`).join("\n");
文本 = 文本.replace('import { 切换视图 } from "./11-tabs";', 'import { 切换视图 } from "./11-tabs";\n' + 导入行);

writeFileSync(源文件, 文本, "utf8");
console.log(`已改写 07-explorer.ts（${结果.length} 行）`);

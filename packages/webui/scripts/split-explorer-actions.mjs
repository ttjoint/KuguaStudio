// [一次性迁移脚本] 仅用于当时的拆分；parts/ 为唯一真源，请勿重复运行（行号已失效）。
// 从 07-explorer.ts 抽出「右键菜单 / 批量操作 / 内联编辑 / 框选」为独立 ES 模块。
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
      const 前2 = 出[出.length - 2] ?? "";
      // 属性访问（前面是 .）跳过；但展开运算符 ... 不算
      const 是属性 = 前 === "." && 前2 !== ".";
      出 += 集.has(词) && !是属性 ? "Explorer." + 词 : 词;
      i = j; continue;
    }
    出 += 文本[i++];
  }
  return 出;
}

const 取块 = (a, b) => 原.slice(a - 1, b);
const 去缩进 = (行s, 空格) => 行s.map((l) => (l.startsWith(" ".repeat(空格)) ? l.slice(空格) : l));
const 加导出 = (s, 名) => s.replace(new RegExp("^(?:export\\s+)?(?:async\\s+)?function " + 名 + "\\(", "m"), (m0) => (m0.startsWith("export") ? m0 : "export " + m0));

const 移动函数 = ["显示右键菜单", "隐藏右键菜单", "显示上下文菜单", "复制文本", "更新批量删除按钮", "删除选中内容", "删除到回收站", "开始内联编辑", "开始内联编辑名称", "开始内联编辑真实文件名", "绑定框选"];

const 前缀 = [
  "内容条目", "菜单项", "选中节点ID", "选中内容", "上次点击ID",
  "右键菜单", "状态栏计数", "筛选内容", "更新内容信息面板",
  "加载所有内容", "渲染内容列表", "大图标容器", "列表容器", "详情容器", "所有内容", "显示名",
];

// 1065-1070 为 interface 菜单项：保留在核心并以 Explorer.菜单项 访问
let 体 = 替换标识符(去缩进(取块(1054, 1064).concat(取块(1071, 1295)), 2).join("\n"), 前缀);
for (const 名 of 移动函数) 体 = 加导出(体, 名);

const 自身 = new Set(["Explorer"]);
for (const m of 体.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|interface|type|class)\s+([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)/gm)) 自身.add(m[1]);

const 需要 = new Map();
{
  const 净 = 替换标识符(体, []);
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

const 内容 = `// ===== 右键菜单 / 批量操作 / 内联编辑 / 框选 =====\n// 由 07-explorer.ts 拆分而来。\n${导入.join("\n")}\n\n${体}\n`;
writeFileSync(join(根, "07i-explorer-actions.ts"), 内容, "utf8");
console.log(`已生成 07i-explorer-actions.ts（${内容.split("\n").length} 行）`);

// 改写 07-explorer.ts
const 删除 = new Set();
for (let i = 1054; i <= 1295; i++) if (i < 1065 || i > 1070) 删除.add(i);
let 结果 = [];
for (let i = 1; i <= 原.length; i++) {
  if (删除.has(i)) continue;
  结果.push(原[i - 1]);
}
let 文本 = 结果.join("\n");

for (const t of [
  "  interface 菜单项 {",
  "  let 选中节点ID = new Set<number>();",
  "  let 上次点击ID: number | null = null;",
  '  const 右键菜单 = document.getElementById("context-menu") as HTMLDivElement;',
  '  const 状态栏计数 = document.getElementById("ex-status-count") as HTMLSpanElement;',
  '  const 大图标容器 = document.getElementById("ex-items-large") as HTMLDivElement;',
  '  const 列表容器 = document.getElementById("ex-items-list") as HTMLDivElement;',
  '  const 详情容器 = document.getElementById("ex-details-body") as HTMLDivElement;',
  "  function 筛选内容(): 内容条目[] {",
]) {
  if (!文本.includes(t)) { console.log("警告：未找到导出目标 -> " + t.trim()); continue; }
  文本 = 文本.replace(t, t.replace(/^ {2}/, "  export "));
}

文本 = 文本.replace(
  'import { 切换视图 } from "./11-tabs";',
  'import { 切换视图 } from "./11-tabs";\nimport { 显示右键菜单, 隐藏右键菜单, 显示上下文菜单, 复制文本, 更新批量删除按钮, 删除选中内容, 删除到回收站, 开始内联编辑名称, 开始内联编辑真实文件名, 绑定框选 } from "./07i-explorer-actions";',
);

writeFileSync(源文件, 文本, "utf8");
console.log(`已改写 07-explorer.ts（${结果.length} 行）`);

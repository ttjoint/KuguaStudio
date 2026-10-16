// [一次性迁移脚本] 仅用于当时的拆分；parts/ 为唯一真源，请勿重复运行（行号已失效）。
// 从 07-explorer.ts 抽出「标签树 / 关联标签 / 筛选摘要」为 07j，并同步 07g/07h/07i 的 Explorer.* 引用。
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

const 移动函数 = ["找到标签名", "搜索标签节点", "导航到标签", "更新内容信息面板", "渲染关联标签", "渲染标签树", "渲染标签chips", "绑定标签联想输入", "内联保存标签", "在资源管理器中显示", "复制物理路径", "设置别名", "加载打开方式列表", "渲染筛选摘要"];

const 前缀 = [
  "内容条目", "菜单项", "标签树", "当前标签ID", "选中内容", "文件信息面板", "加载所有内容",
  "转文件URL", "显示名", "内容大小文本", "节点形式名", "格式化时间", "内联标签编辑ID",
  "渲染可勾选标签树", "搜索关键词", "标签树容器", "加载标签树", "状态栏计数", "筛选内容",
  "打开方式列表", "当前位置ID", "受管位置列表", "类型筛选", "当前视图ID", "保存视图列表",
];

let 体 = 替换标识符(去缩进(取块(484, 1011), 2).join("\n"), 前缀);
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

const 内容 = `// ===== 标签树 / 关联标签 / 筛选摘要 =====\n// 由 07-explorer.ts 拆分而来。\n${导入.join("\n")}\n\n${体}\n`;
writeFileSync(join(根, "07j-explorer-tags.ts"), 内容, "utf8");
console.log(`已生成 07j-explorer-tags.ts（${内容.split("\n").length} 行）`);

// 改写 07-explorer.ts
const 删除 = new Set();
for (let i = 484; i <= 1011; i++) 删除.add(i);
let 结果 = [];
for (let i = 1; i <= 原.length; i++) {
  if (删除.has(i)) continue;
  结果.push(原[i - 1]);
}
let 文本 = 结果.join("\n");
文本 = 文本.replace(
  'import { 切换视图 } from "./11-tabs";',
  'import { 切换视图 } from "./11-tabs";\nimport { 找到标签名, 搜索标签节点, 导航到标签, 更新内容信息面板, 渲染关联标签, 渲染标签树, 渲染标签chips, 绑定标签联想输入, 内联保存标签, 在资源管理器中显示, 复制物理路径, 设置别名, 加载打开方式列表, 渲染筛选摘要 } from "./07j-explorer-tags";',
);
writeFileSync(源文件, 文本, "utf8");
console.log(`已改写 07-explorer.ts（${结果.length} 行）`);

// 同步其它模块对 Explorer.<已移出成员> 的引用
const 迁移 = {
  "07g-explorer-editor.ts": ["更新内容信息面板", "渲染标签chips", "绑定标签联想输入"],
  "07h-explorer-views.ts": ["渲染标签树"],
  "07i-explorer-actions.ts": ["更新内容信息面板"],
};
for (const [f, 名s] of Object.entries(迁移)) {
  const p = join(根, f);
  let s = readFileSync(p, "utf8");
  for (const 名 of 名s) s = s.split("Explorer." + 名).join(名);
  const 导入行 = `import { ${名s.join(", ")} } from "./07j-explorer-tags";`;
  s = s.replace('import { Explorer } from "./07-explorer";', 'import { Explorer } from "./07-explorer";\n' + 导入行);
  writeFileSync(p, s, "utf8");
  console.log(`已同步 ${f}：${名s.join("、")}`);
}

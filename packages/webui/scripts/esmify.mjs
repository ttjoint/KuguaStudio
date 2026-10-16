// [一次性迁移脚本] 仅用于当时的拆分；parts/ 为唯一真源，请勿重复运行（行号已失效）。
// 把经典脚本分区（parts.bak）转成 ES 模块（parts/）：
//  1) 顶层声明加 export
//  2) 跨文件引用自动生成 import
// 用法：node scripts/esmify.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const 根 = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "renderer");
const 源 = join(根, "parts.bak");
const 目标 = join(根, "parts");

const 声明正则 =
  /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(function|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)/;

/** 去掉注释与字符串字面量，保留结构以便扫描标识符 */
function 去注释去字符串(码) {
  let 出 = "";
  let i = 0;
  const n = 码.length;
  while (i < n) {
    const c = 码[i];
    const c2 = 码[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && 码[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(码[i] === "*" && 码[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n && 码[i] !== q) {
        if (码[i] === "\\") i++;
        i++;
      }
      i++;
      出 += " ";
      continue;
    }
    if (c === "/" && /\s|^/.test(码[i - 1] ?? " ")) {
      // 可能是正则字面量：跳过简单情形
      const rest = 码.slice(i);
      const m = rest.match(/^\/(?:\\.|[^/\\\n])+\/[gimsuy]*/);
      if (m) {
        i += m[0].length;
        出 += " ";
        continue;
      }
    }
    出 += c;
    i++;
  }
  return 出;
}

const 文件列表 = readdirSync(源)
  .filter((f) => f.endsWith(".ts"))
  .sort();

// 1) 收集每个文件的顶层声明
const 声明归属 = new Map();
const 文件声明 = new Map();
for (const f of 文件列表) {
  const 码 = readFileSync(join(源, f), "utf8");
  const 名集 = new Set();
  for (const 行 of 码.split(/\r?\n/)) {
    const m = 行.match(声明正则);
    if (m && 行 === 行.trimStart()) {
      const 名 = m[2];
      if (名 === "Window") continue; // 单独处理
      名集.add(名);
      if (!声明归属.has(名)) 声明归属.set(名, f);
    }
  }
  文件声明.set(f, 名集);
}

// 2) 生成
rmSync(目标, { recursive: true, force: true });
mkdirSync(目标, { recursive: true });
let 导入总数 = 0;
for (const f of 文件列表) {
  let 码 = readFileSync(join(源, f), "utf8");
  const 本地 = 文件声明.get(f);

  // 引用扫描
  const 净 = 去注释去字符串(码);
  const 需要 = new Map(); // 目标文件 -> Set<名>
  const re = /[A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*/g;
  let m;
  while ((m = re.exec(净))) {
    const 名 = m[0];
    if (本地.has(名)) continue;
    const 归属 = 声明归属.get(名);
    if (!归属 || 归属 === f) continue;
    if (!需要.has(归属)) 需要.set(归属, new Set());
    需要.get(归属).add(名);
  }

  // 顶层声明加 export
  码 = 码
    .split(/\r?\n/)
    .map((行) => {
      const mm = 行.match(声明正则);
      if (!mm || 行 !== 行.trimStart()) return 行;
      if (行.startsWith("export ")) return 行;
      if (mm[2] === "Window") return 行;
      return "export " + 行;
    })
    .join("\n");

  // Window 全局扩展
  if (f === "01-types.ts") {
    码 = 码.replace(/^interface Window \{/m, "declare global {\n  interface Window {");
    // 找到该 interface 的结尾（最后一个顶层 "}"）
    const 行s = 码.split("\n");
    for (let i = 行s.length - 1; i >= 0; i--) {
      if (行s[i] === "}") {
        行s[i] = "  }\n}";
        break;
      }
    }
    码 = 行s.join("\n");
  }

  // 生成 import
  const 导入行 = [];
  for (const [归属, 名集] of [...需要.entries()].sort()) {
    const 名 = [...名集].sort();
    导入总数 += 名.length;
    导入行.push(`import { ${名.join(", ")} } from "./${归属.replace(/\.ts$/, "")}";`);
  }
  if (导入行.length) 码 = 导入行.join("\n") + "\n\n" + 码;

  writeFileSync(join(目标, f), 码, "utf8");
}

// 3) 入口
const 入口 =
  "// 入口：按序号导入各分区，保证副作用初始化顺序与拆分前一致。\n" +
  文件列表.map((f) => `import "./${f.replace(/\.ts$/, "")}";`).join("\n") +
  "\n";
writeFileSync(join(目标, "main.ts"), 入口, "utf8");

console.log(`已转换 ${文件列表.length} 个分区，生成 ${导入总数} 条导入。`);

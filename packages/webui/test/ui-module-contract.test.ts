/**
 * WebUI ↔ 模块契约测试
 *
 * 静态扫描 WebUI 渲染层中所有 `request("模块", "动作", { 参数 })` 调用，
 * 与各模块 `客户端.onRequest("动作", (params) => ...)` 的注册表比对：
 *
 * 1. **动作存在性**：UI 调用的动作确实在模块中注册
 *    （历史上 mkg 的 `mkg.openwith.add` 就因为模块只有 `.set` 而长期静默失败）。
 * 2. **参数名约定**：UI 传入的对象字面量键名，应当是模块处理器实际读取的键名之一
 *    （历史上 `mkg.tag.createTree` 被 UI 以 `{ path }` 调用，而模块只认 `{ names }`；
 *      `mkg.file.physicalPath` 返回裸字符串却被 UI 当作 `{ path }` 解构）。
 *
 * 仅做「字面量键名」级别的保守校验：动态展开（`...`）、变量、模板拼接一律跳过。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const 仓库根 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 读取 WebUI 渲染层源码（parts/*.ts + index.html） */
function 读取UI源码(): string {
  const 目录 = join(仓库根, "packages", "webui", "src", "renderer");
  const 片段: string[] = [];
  const parts目录 = join(目录, "parts");
  if (existsSync(parts目录)) {
    for (const f of readdirSync(parts目录)) {
      if (f.endsWith(".ts")) 片段.push(readFileSync(join(parts目录, f), "utf-8"));
    }
  }
  const html = join(目录, "index.html");
  if (existsSync(html)) 片段.push(readFileSync(html, "utf-8"));
  return 片段.join("\n");
}

/** 提取 UI 中的 request("目标","动作") 调用（只要动作名） */
function 提取UI调用(): Set<string> {
  const src = 读取UI源码();
  const 结果 = new Set<string>();
  for (const m of src.matchAll(/request\(\s*["'`]([a-zA-Z0-9_-]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g)) {
    结果.add(`${m[1]}::${m[2]}`);
  }
  return 结果;
}

/**
 * 提取 UI 中带字面量参数对象的调用：`request("模块","动作", { k1: v, k2: v })`
 * 返回 Map<"模块::动作", Set<键名>>。
 * 只有当第三个参数以 `{` 开头、且不包含 `...` 展开时才收集；
 * 遇到嵌套对象/数组/模板串会保守地放弃该次调用的参数收集（避免误报）。
 */
function 提取UI调用参数(): Map<string, Set<string>> {
  const src = 读取UI源码();
  const 结果 = new Map<string, Set<string>>();
  const 正则 = /request\(\s*["'`]([a-zA-Z0-9_-]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]\s*,\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = 正则.exec(src)) !== null) {
    const key = `${m[1]}::${m[2]}`;
    // 从 { 开始做括号配平，取出对象字面量体（截断到合理长度）
    let i = 正则.lastIndex - 1;
    let depth = 0;
    let body = "";
    for (; i < src.length && i < 正则.lastIndex + 2000; i++) {
      const c = src[i];
      if (c === "{") { depth++; if (depth === 1) continue; }
      if (c === "}") { depth--; if (depth === 0) break; }
      body += c;
    }
    if (body.includes("...")) continue; // 展开，跳过
    // 顶层键名：形如 ` xx:`（在 depth 0 处）
    const 键 = new Set<string>();
    let d = 0;
    let token = "";
    const 候选: string[] = [];
    for (const c of body) {
      if (c === "{" || c === "[" || c === "(") d++;
      else if (c === "}" || c === "]" || c === ")") d--;
      if (d === 0 && c === ",") { 候选.push(token); token = ""; continue; }
      token += c;
    }
    候选.push(token);
    for (const seg of 候选) {
      const km = seg.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
      if (km) 键.add(km[1]);
    }
    if (键.size > 0) {
      const 现有 = 结果.get(key);
      if (现有) for (const k of 键) 现有.add(k);
      else 结果.set(key, 键);
    }
  }
  return 结果;
}

/** 读取某模块注册的所有 onRequest 动作 */
function 读取模块动作(模块名: string): Set<string> {
  const 文件 = join(仓库根, "packages", "modules", 模块名, "src", "index.ts");
  if (!existsSync(文件)) return new Set();
  const src = readFileSync(文件, "utf-8");
  const 动作 = new Set<string>();
  for (const m of src.matchAll(/onRequest\(\s*["'`]([^"'`]+)["'`]/g)) 动作.add(m[1]);
  return 动作;
}

/**
 * 读取某模块各动作处理器「实际读取的参数键名」。
 * 采集处理体内 `{ a, b } = (params ?? {})` 解构出的键名，
 * 以及 `params.xxx` / `p.xxx` 成员访问的键名。
 */
function 读取模块参数键(模块名: string): Map<string, Set<string>> {
  const 结果 = new Map<string, Set<string>>();
  const 文件 = join(仓库根, "packages", "modules", 模块名, "src", "index.ts");
  if (!existsSync(文件)) return 结果;
  const src = readFileSync(文件, "utf-8");
  // 以 onRequest("动作", ... 为切分点，取到下一个 onRequest 为止
  const 正则 = /onRequest\(\s*["'`]([^"'`]+)["'`]\s*,/g;
  const 位置: Array<{ 动作: string; 起: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = 正则.exec(src)) !== null) 位置.push({ 动作: m[1], 起: 正则.lastIndex });
  for (let i = 0; i < 位置.length; i++) {
    const 起 = 位置[i].起;
    const 止 = i + 1 < 位置.length ? 位置[i + 1].起 : src.length;
    const 体 = src.slice(起, 止).slice(0, 4000);
    const 键 = new Set<string>();
    // 解构：const { a, b: c } = (params ?? {}) / (p ?? {})
    // 先找 `(params ?? {})` / `(p ?? {})`，再向前回溯到最近的 `{ ... } =`
    for (const anchor of 体.matchAll(/\(\s*(?:params|p)\s*\?\?\s*\{\s*\}\s*\)/g)) {
      const 前 = 体.slice(0, anchor.index);
      const dm = 前.match(/\{([^{}]*)\}\s*=\s*$/);
      if (!dm) continue;
      for (const part of dm[1].split(",")) {
        const km = part.match(/^\s*([A-Za-z_$][\w$]*)/);
        if (km) 键.add(km[1]);
      }
    }
    // 成员访问：params.xxx / p.xxx
    for (const d of 体.matchAll(/\b(?:params|p)\??\.([A-Za-z_$][\w$]*)/g)) 键.add(d[1]);
    结果.set(位置[i].动作, 键);
  }
  return 结果;
}

/** WebUI 以 request 方式直接调用的「进程模块」白名单 */
const 相关模块 = ["mkg", "plugins", "scheduler", "monitor", "translator", "translate"];

describe("WebUI ↔ 模块动作契约", () => {
  const ui调用 = 提取UI调用();

  it("WebUI 至少应识别到若干模块调用（防止扫描失效）", () => {
    expect(ui调用.size).toBeGreaterThan(10);
  });

  for (const 模块 of 相关模块) {
    it(`UI 调用的 ${模块} 动作均已注册`, () => {
      const 已注册 = 读取模块动作(模块);
      if (已注册.size === 0) return; // 模块不存在则跳过
      const 缺失 = [...ui调用]
        .filter((x) => x.startsWith(`${模块}::`))
        .map((x) => x.split("::")[1])
        // 跳过动态拼接的动作名（如 plugins.${动作}）
        .filter((a) => !/\$\{|\+/.test(a))
        .filter((a) => !已注册.has(a))
        .sort();
      expect(缺失, `${模块} 缺失动作：${缺失.join(", ")}`).toEqual([]);
    });
  }
});

describe("WebUI ↔ 模块参数契约", () => {
  const ui参数 = 提取UI调用参数();

  it("参数扫描应识别到若干调用（防止扫描失效）", () => {
    expect(ui参数.size).toBeGreaterThan(5);
  });

  for (const 模块 of 相关模块) {
    const 模块键 = 读取模块参数键(模块);
    if (模块键.size === 0) continue;
    it(`UI 传给 ${模块} 的参数名与模块读取一致（无未知键）`, () => {
      const 违规: string[] = [];
      for (const [key, 键集] of ui参数) {
        if (!key.startsWith(`${模块}::`)) continue;
        const 动作 = key.split("::")[1];
        const 允许 = 模块键.get(动作);
        if (!允许 || 允许.size === 0) continue; // 该动作未采集到参数，跳过
        for (const k of 键集) {
          if (!允许.has(k)) 违规.push(`${动作} 传入未知参数 "${k}"（模块读取：${[...允许].join(", ")}）`);
        }
      }
      expect(违规, `\n${违规.join("\n")}`).toEqual([]);
    });
  }
});

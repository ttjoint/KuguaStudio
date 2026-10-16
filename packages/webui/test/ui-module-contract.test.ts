/**
 * WebUI ↔ 模块契约测试
 *
 * 静态扫描 WebUI 渲染层中所有 `request("模块", "动作")` 调用，
 * 与各模块 `客户端.onRequest("动作")` 的注册表比对，确保 UI 调用的动作确实存在。
 *
 * 目的：防止「UI 调用了不存在/改名后的动作」这类只能在运行时暴露的缺陷
 * （历史上 mkg 的 `mkg.openwith.add` 就因为模块只有 `.set` 而长期静默失败）。
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

/** 提取 UI 中的 request("目标","动作") 调用 */
function 提取UI调用(): Set<string> {
  const src = 读取UI源码();
  const 结果 = new Set<string>();
  for (const m of src.matchAll(/request\(\s*["'`]([a-zA-Z0-9_-]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g)) {
    结果.add(`${m[1]}::${m[2]}`);
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

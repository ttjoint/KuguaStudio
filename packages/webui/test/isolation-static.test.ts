/**
 * 第一层：**静态解耦**。
 *
 * 架构承诺「模块之间只通过消息互通，不直接 import」。这一层不需要起
 * 任何进程，直接扫源码把它们之间的依赖关系画出来，然后断言：
 *
 * 1. 模块之间零 import（共享库除外）
 * 2. 模块不 import 主控、不 import WebUI 的源码
 * 3. 每个模块的自有依赖里没有别的模块
 *
 * ## 为什么先做这一层
 *
 * 一一跑起来测「装了 A 和 B 会不会互相影响」成本很高（每个用例几秒到几十秒），
 * 而且一旦真出现耦合，端到端只会告诉你「行为变了」，查不出**耦合在哪**。
 *
 * 静态扫描则能直接指出「dice 模块 import 了 text 模块的源码」这种问题，
 * 是根因而非症状。所以这一层先跑、跑得快、失败时说人话。
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const 仓库根 = resolve(__dirname, "..", "..", "..");
const 模块根 = join(仓库根, "packages", "modules");

/** 允许被任何模块依赖的共享库。**不在这里的都是耦合** */
const 允许的共享库 = new Set([
  "@kugua/module-kit", // 模块启动/进程兜底的统一入口
  "@kugua/nigane", // 消息总线客户端——这正是「只通过消息互通」的载体
  "@kugua/capability", // 能力清单类型
  "@kugua/paths", // 路径解析
  "@kugua/random", // 随机源（测试可 mock）
  "@kugua/logger", // 日志
  "@kugua/onebot11", // OneBot11 消息段类型
  "@kugua/plugin-sdk", // 插件契约
  "@kugua/dscript", // 脚本引擎
  "@kugua/mcp", // MCP 协议
  "@kugua/mkg", // MKG 数据层
]);

function 模块目录们(): string[] {
  if (!existsSync(模块根)) return [];
  return readdirSync(模块根, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(模块根, d.name, "package.json")))
    .map((d) => d.name)
    .sort();
}

/** 取某目录下所有 .ts 文件（递归） */
function 所有源文件(目录: string): string[] {
  if (!existsSync(目录)) return [];
  const 出: string[] = [];
  for (const 项 of readdirSync(目录, { withFileTypes: true })) {
    const 全 = join(目录, 项.name);
    if (项.isDirectory()) {
      if (项.name === "node_modules" || 项.name === "dist") continue;
      出.push(...所有源文件(全));
    } else if (项.name.endsWith(".ts") && !项.name.endsWith(".d.ts")) {
      出.push(全);
    }
  }
  return 出;
}

/** 抽出文件里所有 import/export-from 的模块说明符 */
function 模块说明符(内容: string): string[] {
  const 出: string[] = [];
  // import ... from "x" / import "x" / export ... from "x"
  const 正则 = /(?:^|\n)\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = 正则.exec(内容))) 出.push(m[1] ?? m[2]);
  return 出;
}

describe("静态解耦：模块之间零直接依赖", () => {
  const 模块们 = 模块目录们();

  it("模块目录能被发现（否则下面全是空跑）", () => {
    expect(模块们.length).toBeGreaterThan(10);
  });

  it("没有任何模块 import 另一个模块的包名", () => {
    // 包名 → 模块名。`@kugua/module-dice` 等
    const 包名到模块 = new Map<string, string>();
    for (const 名 of 模块们) {
      const 包 = JSON.parse(readFileSync(join(模块根, 名, "package.json"), "utf8")) as { name?: string };
      if (包.name) 包名到模块.set(包.name, 名);
    }

    const 违规: string[] = [];
    for (const 名 of 模块们) {
      for (const 文件 of 所有源文件(join(模块根, 名, "src"))) {
        for (const 说明符 of 模块说明符(readFileSync(文件, "utf8"))) {
          if (!允许的共享库.has(说明符)) {
            const 对方 = 包名到模块.get(说明符);
            if (对方 && 对方 !== 名) {
              违规.push(`${名} → ${对方}（${文件.slice(仓库根.length + 1)}）`);
            }
          }
        }
      }
    }
    expect(违规, `模块之间不允许直接 import：\n${违规.join("\n")}`).toEqual([]);
  });

  it("没有模块跨包引用别的模块的相对路径（../../text/src 这类）", () => {
    // 包名依赖容易看出来，相对路径穿越更容易漏。
    //
    // 注意用**按路径段比较**而不是 `includes("modules/av/")`：
    // `...\modules\avatar\src\parse.ts` 里包含 `modules\av`，
    // 裸 includes 会把 avatar 自己目录里的文件误判成「引用了 av 模块」。
    // 曾经就是这么误报的。
    const 模块目录 = new Map(
      模块们.map((名) => [名, resolve(模块根, 名) + sep]),
    );
    const 违规: string[] = [];
    for (const 名 of 模块们) {
      for (const 文件 of 所有源文件(join(模块根, 名, "src"))) {
        for (const 说明符 of 模块说明符(readFileSync(文件, "utf8"))) {
          if (!说明符.startsWith(".")) continue;
          const 目标 = resolve(文件, "..", 说明符);
          for (const [别的名, 别的目录] of 模块目录) {
            if (别的名 === 名) continue;
            if (目标.startsWith(别的目录)) {
              违规.push(`${名} → ${别的名}（${说明符}）`);
            }
          }
        }
      }
    }
    expect(违规, `模块之间不允许跨目录 import：\n${违规.join("\n")}`).toEqual([]);
  });

  it("没有模块 import 主控或 WebUI 的源码", () => {
    const 违规: string[] = [];
    for (const 名 of 模块们) {
      for (const 文件 of 所有源文件(join(模块根, 名, "src"))) {
        for (const 说明符 of 模块说明符(readFileSync(文件, "utf8"))) {
          if (说明符.includes("@kugua/main") || 说明符.includes("@kugua/webui")) {
            违规.push(`${名} → ${说明符}`);
          }
          // 相对路径跑到 packages/main 或 packages/webui
          if (说明符.startsWith(".")) {
            const 目标 = resolve(文件, "..", 说明符);
            if (目标.includes(join("packages", "main", "")) || 目标.includes(join("packages", "webui", ""))) {
              违规.push(`${名} → ${说明符}`);
            }
          }
        }
      }
    }
    expect(违规, `模块不允许依赖主控/WebUI：\n${违规.join("\n")}`).toEqual([]);
  });

  it("主控不 import 任何具体模块的源码（它只该知道协议）", () => {
    const 违规: string[] = [];
    for (const 文件 of 所有源文件(join(仓库根, "packages", "main", "src"))) {
      for (const 说明符 of 模块说明符(readFileSync(文件, "utf8"))) {
        if (说明符.includes("@kugua/module-")) 违规.push(`main → ${说明符}`);
        if (说明符.startsWith(".")) {
          const 目标 = resolve(文件, "..", 说明符);
          if (目标.includes(join("packages", "modules", ""))) 违规.push(`main → ${说明符}`);
        }
      }
    }
    expect(违规, `主控不允许依赖具体模块：\n${违规.join("\n")}`).toEqual([]);
  });
});

describe("静态解耦：每个模块的 package.json 依赖面", () => {
  const 模块们 = 模块目录们();

  it("dependencies 里没有别的模块包", () => {
    const 包名们 = new Set<string>();
    for (const 名 of 模块们) {
      const 包 = JSON.parse(readFileSync(join(模块根, 名, "package.json"), "utf8")) as { name?: string };
      if (包.name) 包名们.add(包.name);
    }

    const 违规: string[] = [];
    for (const 名 of 模块们) {
      const 包 = JSON.parse(readFileSync(join(模块根, 名, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const 依赖 of Object.keys(包.dependencies ?? {})) {
        if (包名们.has(依赖)) 违规.push(`${名} 依赖 ${依赖}`);
      }
      // devDependencies 里出现别的模块也不行：测试可以 import 别的模块的源码，
      // 那就等于允许「顺便依赖一下」
      for (const 依赖 of Object.keys(包.devDependencies ?? {})) {
        if (包名们.has(依赖)) 违规.push(`${名} 开发依赖 ${依赖}`);
      }
    }
    expect(违规, `模块的包依赖里不允许出现别的模块：\n${违规.join("\n")}`).toEqual([]);
  });
});

describe("静态解耦：模块自己声明了入口且产物路径一致", () => {
  const 模块们 = 模块目录们();

  it("每个模块的 package.json 有 name 和 main", () => {
    const 缺: string[] = [];
    for (const 名 of 模块们) {
      const 包 = JSON.parse(readFileSync(join(模块根, 名, "package.json"), "utf8")) as {
        name?: string;
        main?: string;
      };
      if (!包.name) 缺.push(`${名}: 缺 name`);
      if (!包.main) 缺.push(`${名}: 缺 main`);
    }
    expect(缺, `模块清单不完整：\n${缺.join("\n")}`).toEqual([]);
  });
});

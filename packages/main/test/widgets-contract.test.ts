/**
 * 前后端契约测试：小组件配置接口的参数名
 *
 * 为什么单独测这个：真实调试时踩过一次——渲染层发的是 `{ config }`，
 * 主控读的是 `{ 配置 }`，结果**没有任何报错**，`config.set` 拿到 undefined，
 * 归一出一套默认方案照常写盘返回 200，界面刷新后设置全没了。
 *
 * 这类「字段名对不上」的 bug 单看任何一边都发现不了，必须把两边的字面量
 * 放在一起比对。所以这里不做集成测试（那样要起进程、跑得慢还容易偶发），
 * 而是直接读源码把两边用的键名抠出来断言相等——快，且改名时立刻红。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const 仓根 = join(fileURLToPath(import.meta.url), "../../../..");

/** 读一个源文件 */
function 读(相对: string): string {
  return readFileSync(join(仓根, 相对), "utf8");
}

/**
 * 从渲染层源码里抠出调用 `nigane.widgets.config.set` 时传的键名。
 *
 * 不解析 AST 是因为这行永远是 `{ 键: … }` 的形式，正则足够；
 * 抠不到就抛错，免得以后改写时这条测试偷偷变成永远通过。
 */
function 渲染层传的键(源码: string): string[] {
  const 键集 = new Set<string>();
  const 正则 = /nigane\.widgets\.config\.set"[^)]*?\{([^:}]+):/g;
  let m: RegExpExecArray | null;
  while ((m = 正则.exec(源码)) !== null) 键集.add(m[1].trim());
  return [...键集];
}

/** 从主控源码里抠出 handler 读的键名 */
function 主控读的键(源码: string): string {
  const 位置 = 源码.indexOf('handle("nigane.widgets.config.set"');
  expect(位置, "主控里找不到 config.set 的 handler").toBeGreaterThan(0);
  const 段 = 源码.slice(位置, 位置 + 400);
  // 形如：const p = (params ?? {}) as { 配置?: unknown };
  const 起 = 段.indexOf("as {");
  if (起 < 0) throw new Error("main 里读不出 config.set 的参数类型");
  const 冒号 = 段.indexOf("?:", 起);
  if (冒号 < 0) throw new Error("main 里读不出 config.set 的参数名");
  return 段.slice(起 + "as {".length, 冒号).trim();
}

describe("widgets.config.set 的前后端参数名必须一致", () => {
  const 渲染层文件 = [
    "packages/webui/src/renderer/parts/19-widgets.ts",
    "packages/webui/src/renderer/parts/19b-widget-settings.ts",
  ];

  it("渲染层所有调用点用的都是主控读的那个键", () => {
    const 期望 = 主控读的键(读("packages/main/src/index.ts"));
    expect(期望).toBe("配置");

    for (const 文件 of 渲染层文件) {
      const 键们 = 渲染层传的键(读(文件));
      expect(键们.length, `${文件} 里找不到 config.set 调用`).toBeGreaterThan(0);
      // 逐个查而不是只查第一个：一个文件里可能有多个调用点，
      // 正是「改了一处以为改完了」的高发位置
      for (const 键 of 键们) expect(`${文件}: ${键}`).toBe(`${文件}: ${期望}`);
    }
  });

  it("抠键的正则本身是有效的（防测试假通过）", () => {
    // 故意喂一段正确写法，确认能被抠出来；
    // 否则正则写错时上面那条会因为「键们为空」直接失败，但失败原因会误导人
    const 样例 = 'window.kugua.request("nigane", "nigane.widgets.config.set", { 配置: 节 });';
    expect(渲染层传的键(样例)).toEqual(["配置"]);
  });
});

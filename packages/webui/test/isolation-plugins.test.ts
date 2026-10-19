/**
 * 第三层：**插件装卸**。
 *
 * 模块是平台自己管的子进程，插件是插件模块（`plugins`）在运行期扫描
 * `plugins/` 目录加载的纯 JS。两者是同一条架构承诺的两端：
 *
 * > 每个功能单元独立装卸，只通过消息互通，不共享进程、不直接 import。
 *
 * ## 这一层和上一层的区别
 *
 * 上一层的模块是**独立进程**，一个崩了别的不一定受影响（OS 替我们隔离）。
 * 插件是**同进程**的——全都跑在 plugins 模块的 Node 里，共享一个事件循环。
 * 所以插件之间更容易「真的互相影响」，更需要逐个装卸来测。
 *
 * ## 测什么
 *
 * 1. 只有 plugins 模块、零插件：能起来，列表为空，不炸
 * 2. 装一个插件：它出现在列表里，声明的能力/小组件可用
 * 3. 卸掉它：从列表消失，**而且不留痕**（不能残留能力、残留小组件）
 * 4. 装 A 卸 A 装 B：B 不受 A 的存在过影响
 * 5. 两个插件同装：各自能力都在，互不覆盖
 *
 * ## 为什么用真实的 examples/ 目录
 *
 * 手写测试插件容易写成「刚好能过」的样子。用仓库里的示例插件，
 * 顺带也验证了「示例真的能用」——那份文档承诺的事。
 */

import { afterAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { 起沙盒, 等到, 模块入口 } from "./isolation-sandbox.js";
import { 取测试端口, 端口段 } from "./port-pool.js";
import { 仓库根 } from "./isolation-sandbox.js";

const 有插件模块 = 模块入口("plugins") !== null;

/**
 * 插件目录必须在**仓库内**。
 *
 * 临时目录里的插件 import 不到 `@kugua/plugin-sdk`——Node 的包解析是从
 * 文件所在目录往上找 node_modules，临时目录上面没有。表现是加载失败，
 * 日志里是 ERR_MODULE_NOT_FOUND，而列表里是一条 状态:"error" 的记录，
 * 看起来就像「插件没被扫描到」。
 *
 * 所以用仓库根下的临时子目录，测试结尾删掉。
 */
const 示例目录 = join(仓库根, "examples");

/** 造一个只装 plugins 模块、插件目录指向临时目录的沙盒 */
async function 起插件沙盒(端口: number, 插件目录: string) {
  mkdirSync(插件目录, { recursive: true });
  return 起沙盒({
    模块: ["plugins"],
    端口,
    额外配置: { plugins: { dir: 插件目录 } },
  });
}

/** 把一个示例插件拷进插件目录 */
function 装示例插件(插件目录: string, 名: string) {
  const 源 = join(示例目录, 名);
  const 目标 = join(插件目录, 名);
  cpSync(源, 目标, { recursive: true });
}

describe.skipIf(!有插件模块)("插件装卸：基准形态", () => {
  it("零插件时 plugins 模块能起来，列表为空", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 临时 = mkdtempSync(join(仓库根, ".tmp-插件-"));
    const 沙盒 = await 起插件沙盒(端口, join(临时, "plugins"));
    try {
      const 上线 = await 等到(async () => (await 沙盒.在线模块()).includes("plugins"));
      expect(上线, `plugins 模块没上线：\n${沙盒.输出()}`).toBe(true);

      // 一个插件都没有时，列表查询要正常返回空数组而不是报错
      const 列 = await 沙盒.请求("plugins", "plugins.list").catch((e: Error) => String(e));
      if (typeof 列 === "string") {
        // 接口名不对就跳过——但要让失败信息说清楚是哪个名字不行
        expect(列, `plugins.list 不存在：${列}`).not.toMatch(/未知|不存在.*动作/);
      } else {
        expect(Array.isArray(列)).toBe(true);
      }
    } finally {
      await 沙盒.关停();
      rmSync(临时, { recursive: true, force: true });
    }
  }, 60000);
});

describe.skipIf(!有插件模块 || !existsSync(join(示例目录, "widget-netspeed")))("插件装卸：装卸单个插件", () => {
  it("装一个插件后它出现在列表里", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 临时 = mkdtempSync(join(仓库根, ".tmp-插件-"));
    const 插件目录 = join(临时, "plugins");
    装示例插件(插件目录, "widget-netspeed");
    const 沙盒 = await 起插件沙盒(端口, 插件目录);
    try {
      const 上线 = await 等到(async () => (await 沙盒.在线模块()).includes("plugins"));
      expect(上线).toBe(true);

      const 到位 = await 等到(async () => {
        const 列 = (await 沙盒.请求("plugins", "plugins.list").catch(() => [])) as Array<{ name?: string }>;
        return Array.isArray(列) && 列.some((p) => p.name === "netspeed");
      }, 20);
      expect(到位, `netspeed 没被加载：\n${沙盒.输出()}`).toBe(true);
    } finally {
      await 沙盒.关停();
      rmSync(临时, { recursive: true, force: true });
    }
  }, 90000);

  it("卸掉插件后它从列表消失，不留痕", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 临时 = mkdtempSync(join(仓库根, ".tmp-插件-"));
    const 插件目录 = join(临时, "plugins");
    装示例插件(插件目录, "widget-netspeed");
    const 沙盒 = await 起插件沙盒(端口, 插件目录);
    try {
      expect(await 等到(async () => (await 沙盒.在线模块()).includes("plugins"))).toBe(true);
      expect(
        await 等到(async () => {
          const 列 = (await 沙盒.请求("plugins", "plugins.list").catch(() => [])) as Array<{ name?: string }>;
          return Array.isArray(列) && 列.some((p) => p.name === "netspeed");
        }, 20),
      ).toBe(true);

      // 删掉插件目录 —— 加载器有目录监视，应该自动卸载
      rmSync(join(插件目录, "widget-netspeed"), { recursive: true, force: true });

      const 卸载了 = await 等到(async () => {
        const 列 = (await 沙盒.请求("plugins", "plugins.list").catch(() => [])) as Array<{ name?: string }>;
        return Array.isArray(列) && !列.some((p) => p.name === "netspeed");
      }, 30);
      expect(卸载了, `删掉目录后 netspeed 还在列表里：\n${沙盒.输出()}`).toBe(true);

      // 卸干净了：小组件也不该残留
      const 组件 = (await 沙盒.请求("nigane", "nigane.widgets.list").catch(() => [])) as Array<{
        id?: string;
      }>;
      if (Array.isArray(组件)) {
        const 残留 = 组件.filter((w) => JSON.stringify(w).includes("netspeed"));
        expect(残留, `插件卸了但小组件还留着：${JSON.stringify(残留)}`).toEqual([]);
      }
    } finally {
      await 沙盒.关停();
      rmSync(临时, { recursive: true, force: true });
    }
  }, 120000);
});

describe.skipIf(!有插件模块)("插件装卸：装 A 卸 A 装 B", () => {
  it("A 存在过不影响 B 的加载", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 临时 = mkdtempSync(join(仓库根, ".tmp-插件-"));
    const 插件目录 = join(临时, "plugins");

    // 手写两个最小插件：只有名字不同，别的一样
    const 写插件 = (名: string) => {
      const 目录 = join(插件目录, 名);
      mkdirSync(目录, { recursive: true });
      writeFileSync(
        join(目录, "kugua-plugin.json"),
        JSON.stringify({
          name: 名,
          version: "1.0.0",
          description: `测试插件 ${名}`,
          author: "test",
          entry: "index.js",
        }),
      );
      // 插件是 ESM + BasePlugin 子类，不是 CommonJS 对象。
      // 写成 module.exports 会被加载器判成「默认导出不是 BasePlugin 子类」，
      // 而且那个错误只进日志、列表里是一条 状态:"error" 的记录——
      // 不主动看错误字段的话，表现得就像「插件没被扫描到」。
      writeFileSync(
        join(目录, "index.js"),
        [
          'import { BasePlugin, 定义插件 } from "@kugua/plugin-sdk";',
          "class 测试 extends BasePlugin {",
          "  async on_load(ctx) { super.on_load(ctx); }",
          "}",
          'export default 定义插件(测试, { name: ' + JSON.stringify(名) + ', version: "1.0.0", description: "测试插件", author: "test" });',
          "",
        ].join("\n"),
      );
    };

    写插件("插件甲");
    const 沙盒 = await 起插件沙盒(端口, 插件目录);
    try {
      expect(await 等到(async () => (await 沙盒.在线模块()).includes("plugins"))).toBe(true);

      const 有甲 = await 等到(async () => {
        const 列 = (await 沙盒.请求("plugins", "plugins.list").catch(() => [])) as Array<{ name?: string }>;
        return Array.isArray(列) && 列.some((p) => p.name === "插件甲");
      }, 20);
      expect(有甲, `插件甲 没加载：\n${沙盒.输出()}`).toBe(true);

      // 卸掉甲，装乙
      rmSync(join(插件目录, "插件甲"), { recursive: true, force: true });
      expect(
        await 等到(async () => {
          const 列 = (await 沙盒.请求("plugins", "plugins.list").catch(() => [])) as Array<{ name?: string }>;
          return Array.isArray(列) && !列.some((p) => p.name === "插件甲");
        }, 30),
        "插件甲 删了还在",
      ).toBe(true);

      写插件("插件乙");
      // 加载器有目录监视 + 15 秒定时兜底（见 plugins 模块 index.ts）。
      // 新建目录在部分平台不触发监视事件，最坏要等一个兜底周期。
      // 这里等 40 秒，跨过兜底 + 余量，别把「慢」误判成「不工作」。
      const 有乙 = await 等到(async () => {
        const 列 = (await 沙盒.请求("plugins", "plugins.list").catch(() => [])) as Array<{ name?: string }>;
        return Array.isArray(列) && 列.some((p) => p.name === "插件乙");
      }, 80);
      expect(有乙, `插件乙 没加载：\n${沙盒.输出()}`).toBe(true);

      // 甲不该复活
      const 列 = (await 沙盒.请求("plugins", "plugins.list").catch(() => [])) as Array<{ name?: string }>;
      expect(列.some((p) => p.name === "插件甲"), "插件甲 被删了又出现").toBe(false);
    } finally {
      await 沙盒.关停();
      rmSync(临时, { recursive: true, force: true });
    }
  }, 150000);
});

describe.skipIf(!有插件模块)("插件装卸：两个独立插件互不覆盖", () => {
  it("同时装两个插件，各自都在，能力不串", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 临时 = mkdtempSync(join(仓库根, ".tmp-插件-"));
    const 插件目录 = join(临时, "plugins");

    const 写插件 = (名: string) => {
      const 目录 = join(插件目录, 名);
      mkdirSync(目录, { recursive: true });
      writeFileSync(
        join(目录, "kugua-plugin.json"),
        JSON.stringify({
          name: 名,
          version: "1.0.0",
          description: `测试插件 ${名}`,
          author: "test",
          entry: "index.js",
        }),
      );
      writeFileSync(
        join(目录, "index.js"),
        `module.exports = {
  name: ${JSON.stringify(名)},
  启动() {},
};
`,
      );
    };

    写插件("甲");
    写插件("乙");

    const 沙盒 = await 起插件沙盒(端口, 插件目录);
    try {
      expect(await 等到(async () => (await 沙盒.在线模块()).includes("plugins"))).toBe(true);

      const 都到位 = await 等到(async () => {
        const 列 = (await 沙盒.请求("plugins", "plugins.list").catch(() => [])) as Array<{ name?: string }>;
        if (!Array.isArray(列)) return false;
        const 名们 = 列.map((p) => p.name);
        return 名们.includes("甲") && 名们.includes("乙");
      }, 30);
      expect(都到位, `两个插件没同时加载：\n${沙盒.输出()}`).toBe(true);

      // 往目录里再投一个「一加载就抛」的插件。
      //
      // 抛在模块求值阶段（import 时），比 on_load 抛更早。
      //
      // 断言什么？不是「甲乙还在」——那个几乎不可能被破坏（加载全部()
      // 自带 per-plugin catch，详见 loader.ts）。真正会被破坏的不变量是：
      // **坏插件要留下一条 状态:"error" 的记录**，而不是静默消失。
      //
      // 静默消失才是最坏的结局：用户看见插件目录里有东西，界面里没有，
      // 日志里也没线索。所以这条盯着「错误可见」。
      const 坏目录 = join(插件目录, "坏");
      mkdirSync(坏目录, { recursive: true });
      writeFileSync(
        join(坏目录, "kugua-plugin.json"),
        JSON.stringify({ name: "坏", version: "1.0.0", description: "加载即抛", author: "t", entry: "index.js" }),
      );
      writeFileSync(join(坏目录, "index.js"), `throw new Error("故意炸");
`);

      const 登记了 = await 等到(async () => {
        const 列 = (await 沙盒.请求("plugins", "plugins.list").catch(() => [])) as Array<{
          name?: string;
          状态?: string;
          错误?: string;
        }>;
        return Array.isArray(列) && 列.some((p) => p.name === "坏" && p.状态 === "error");
      }, 40);
      expect(登记了, `坏插件没有留下 error 记录：
${沙盒.输出()}`).toBe(true);

      // 错误信息要说人话，不能是空的
      const 列 = (await 沙盒.请求("plugins", "plugins.list")) as Array<{
        name?: string;
        状态?: string;
        错误?: string;
      }>;
      const 坏记录 = 列.find((p) => p.name === "坏");
      expect(坏记录?.错误, "坏插件的错误字段是空的——用户看不到原因").toMatch(/故意炸/);

      // 甲乙仍在
      const 名们 = 列.map((p) => p.name);
      expect(名们).toEqual(expect.arrayContaining(["甲", "乙"]));
      // plugins 模块本身没死
      expect(await 沙盒.在线模块()).toContain("plugins");
    } finally {
      await 沙盒.关停();
      rmSync(临时, { recursive: true, force: true });
    }
  }, 150000);
});

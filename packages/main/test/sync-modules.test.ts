/**
 * sync-modules 纯函数测试
 *
 * 为什么值得单独测：这个脚本**每次 `npm run build` 都会跑**，而且会重写
 * `kugua.config.json` 的 modules[] 和根 `package.json` 的 start 脚本。
 * 它写错一次就是 26 个模块一起出问题，而且症状很隐蔽：
 *
 *   - 运行时字段被抹掉 → 身份门禁**静默失效**，不报错，只是再也不拦任何东西
 *   - 行尾风格被改 → `--check` 永远报不一致，跑一次同步又没实质变更，
 *     于是这条 CI 门禁被当成噪声，最后没人看
 *
 * 这两条都是历史上真实踩过的。纯函数给了确定的复现条件，不用靠"再跑一遍"。
 */
import { describe, expect, it } from "vitest";
import {
  构造描述,
  收集描述,
  合并手工条目,
  生成配置,
  生成启动脚本,
  保持行尾,
  运行时字段,
} from "../../../scripts/sync-modules-core.mjs";

/** 造一个 workspace 包条目 */
const 包 = (相对目录: string, kugua: Record<string, unknown> | undefined) => ({
  目录: `/repo/${相对目录}`,
  相对目录,
  包: kugua === undefined ? { name: "x" } : { name: "x", kugua },
});

describe("构造描述", () => {
  it("没有 kugua 字段 → 不是模块", () => {
    expect(构造描述(包("packages/modules/a", undefined))).toBeNull();
  });

  it("kugua.module 不是 true → 不是模块", () => {
    expect(构造描述(包("packages/modules/a", { module: false }))).toBeNull();
    expect(构造描述(包("packages/modules/a", {}))).toBeNull();
  });

  it("process 模块默认 entry 是 dist/index.js，autoStart 默认 true", () => {
    const 描述 = 构造描述(包("packages/modules/a", { module: true }));
    expect(描述).toEqual({
      name: "a",
      type: "process",
      entry: "packages/modules/a/dist/index.js",
      autoStart: true,
    });
  });

  it("autoStart: false 会被保留（别一律当成 true）", () => {
    // 少一个模块开机自启没人会发现，直到某天需要它自动跑
    const 描述 = 构造描述(包("packages/modules/a", { module: true, autoStart: false }));
    expect(描述?.autoStart).toBe(false);
  });

  it("library 模块带 file，不带 entry/autoStart", () => {
    const 描述 = 构造描述(
      包("packages/modules/math", { module: true, type: "library", file: "bin/math.dll" }),
    );
    expect(描述).toEqual({ name: "math", type: "library", file: "bin/math.dll" });
    expect(描述).not.toHaveProperty("entry");
    expect(描述).not.toHaveProperty("autoStart");
  });

  it("kugua.name 优先于目录名", () => {
    const 描述 = 构造描述(包("packages/modules/dir-name", { module: true, name: "真名" }));
    expect(描述?.name).toBe("真名");
  });
});

describe("收集描述排序稳定", () => {
  it("process 在前、按名字排序——顺序抖动会让 --check 假报不一致", () => {
    const 列表 = 收集描述([
      包("packages/modules/zeta", { module: true }),
      包("packages/modules/alpha", { module: true }),
      包("packages/modules/math", { module: true, type: "library", file: "a.dll" }),
      包("packages/modules/beta", { module: true }),
    ]);
    expect(列表.map((m: { name: string }) => m.name)).toEqual(["alpha", "beta", "zeta", "math"]);
  });
});

describe("合并手工条目", () => {
  it("保留未由包发现的手工 library 条目", () => {
    const 结果 = 合并手工条目(
      { modules: [{ name: "手工库", type: "library", file: "x.dll" }] },
      [{ name: "a", type: "process" }],
    );
    expect(结果.map((m) => m.name)).toEqual(["a", "手工库"]);
  });

  it("已消失的 process 模块被移除（不留孤儿）", () => {
    const 结果 = 合并手工条目(
      { modules: [{ name: "已删除", type: "process", entry: "x" }] },
      [{ name: "a", type: "process" }],
    );
    expect(结果.map((m) => m.name)).toEqual(["a"]);
  });

  it("同名时以发现结果为准，不保留手工副本", () => {
    const 结果 = 合并手工条目(
      { modules: [{ name: "a", type: "library", file: "旧.dll" }] },
      [{ name: "a", type: "process", entry: "新" }],
    );
    expect(结果).toHaveLength(1);
    expect(结果[0].type).toBe("process");
  });
});

describe("运行时字段必须存活（静默失效的那一类）", () => {
  it("version / capabilityHash 会被保留", () => {
    const 原 = JSON.stringify({
      modules: [{ name: "a", type: "process", entry: "old", version: "1.2.3", capabilityHash: "abc" }],
    });
    const 新文本 = 生成配置(原, [{ name: "a", type: "process", entry: "new", autoStart: true }]);
    const 结果 = JSON.parse(新文本).modules[0];

    expect(结果.version).toBe("1.2.3");
    expect(结果.capabilityHash).toBe("abc");
    // 同时包声明字段仍然以新值为准
    expect(结果.entry).toBe("new");
  });

  it("旧条目没有运行时字段时不会凭空造出来", () => {
    const 原 = JSON.stringify({ modules: [{ name: "a", type: "process", entry: "old" }] });
    const 结果 = JSON.parse(生成配置(原, [{ name: "a", type: "process", entry: "new" }])).modules[0];
    for (const 字段 of 运行时字段) expect(结果).not.toHaveProperty(字段);
  });

  it("新模块没有旧记录 → 原样输出，不报错", () => {
    const 原 = JSON.stringify({ modules: [] });
    const 结果 = JSON.parse(
      生成配置(原, [{ name: "全新", type: "process", entry: "e", autoStart: true }]),
    ).modules[0];
    expect(结果.name).toBe("全新");
  });

  it("未知顶层节原样透传（配置写回不能吃掉别人的设置）", () => {
    const 原 = JSON.stringify({
      webui: { port: 1234 },
      widgets: { layouts: [{ name: "默认" }] },
      modules: [],
    });
    const 结果 = JSON.parse(生成配置(原, []));
    expect(结果.webui).toEqual({ port: 1234 });
    expect(结果.widgets).toEqual({ layouts: [{ name: "默认" }] });
  });
});

describe("幂等性", () => {
  it("同样输入跑两次，第二次不再产生变化（否则 --check 永远失败）", () => {
    const 原 = JSON.stringify({
      modules: [{ name: "a", type: "process", entry: "packages/modules/a/dist/index.js", autoStart: true, version: "1.0.0" }],
    });
    const 列表 = [{ name: "a", type: "process", entry: "packages/modules/a/dist/index.js", autoStart: true }];

    const 第一次 = 生成配置(原, 列表);
    const 第二次 = 生成配置(第一次, 列表);
    expect(第二次).toBe(第一次);
  });

  it("start 脚本也幂等", () => {
    const 原包 = { scripts: { build: "tsc" } };
    const 文本 = JSON.stringify(原包, null, 2) + "\n";
    const 列表 = [{ name: "a", type: "process", entry: "packages/modules/a/dist/index.js" }];

    const 第一次 = 生成启动脚本(原包, 文本, 列表);
    const 第二次 = 生成启动脚本(JSON.parse(第一次), 第一次, 列表);
    expect(第二次).toBe(第一次);
  });
});

describe("行尾保持", () => {
  it("原文件是 CRLF → 输出 CRLF", () => {
    // 仓库在 Windows 下检出为 CRLF，而 JSON.stringify 只产 LF。
    // 早期这里直接拼 "\n"，导致「内容相同但字节不同」，
    // --check 永远报不一致，最后这条门禁被当成噪声没人看。
    const 输出 = 保持行尾("a\nb\n", "x\r\ny\r\n");
    expect(输出).toBe("a\r\nb\r\n");
  });

  it("原文件是 LF → 输出 LF（不许自作主张加 CR）", () => {
    expect(保持行尾("a\nb\n", "x\ny\n")).toBe("a\nb\n");
  });

  it("生成配置在 CRLF 原文件上不产生混合行尾", () => {
    const 原 = JSON.stringify({ modules: [] }).replace(/\n/g, "\r\n") + "\r\n";
    const 输出 = 生成配置(原, []);
    // 不能出现「单独的 \n」（即前面不是 \r 的 \n）
    expect(/[^\r]\n/.test(输出)).toBe(false);
  });
});

describe("启动脚本生成", () => {
  it("为每个 process 模块生成 <名>: node <entry>", () => {
    const 结果 = JSON.parse(
      生成启动脚本(
        { scripts: { build: "tsc" } },
        JSON.stringify({ scripts: { build: "tsc" } }),
        [
          { name: "a", type: "process", entry: "packages/modules/a/dist/index.js" },
          { name: "b", type: "process", entry: "packages/modules/b/dist/index.js" },
        ],
      ),
    );
    expect(结果.scripts.a).toBe("node packages/modules/a/dist/index.js");
    expect(结果.scripts.b).toBe("node packages/modules/b/dist/index.js");
    expect(结果.scripts.build).toBe("tsc");
  });

  it("已删除模块的旧脚本会被清掉（别留指向不存在文件的脚本）", () => {
    const 原包 = {
      scripts: {
        build: "tsc",
        已删除: "node packages/modules/已删除/dist/index.js",
      },
    };
    const 结果 = JSON.parse(生成启动脚本(原包, JSON.stringify(原包), []));
    expect(结果.scripts).not.toHaveProperty("已删除");
    expect(结果.scripts.build).toBe("tsc");
  });

  it("不动用户自己的脚本（哪怕值长得像 node 命令）", () => {
    const 原包 = { scripts: { 我的调试: "node packages/webui/dist/server.js" } };
    const 结果 = JSON.parse(生成启动脚本(原包, JSON.stringify(原包), []));
    expect(结果.scripts.我的调试).toBe("node packages/webui/dist/server.js");
  });

  it("library 模块不生成 start 脚本", () => {
    const 原包 = { scripts: {} };
    const 结果 = JSON.parse(
      生成启动脚本(原包, JSON.stringify(原包), [{ name: "math", type: "library", file: "m.dll" }]),
    );
    expect(结果.scripts).not.toHaveProperty("math");
  });
});

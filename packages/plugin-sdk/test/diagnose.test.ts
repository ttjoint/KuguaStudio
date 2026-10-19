/**
 * 插件契约失败的诊断信息测试。
 *
 * ## 为什么要测「错误信息」
 *
 * 写插件的三类错误原来全都只有一句话，而且**指不到原因**：
 *
 * | 写法 | 原来的错误 |
 * |---|---|
 * | CJS `module.exports = class` | `插件 x 默认导出不是 BasePlugin 子类` |
 * | `定义插件` 少 `description` | `Cannot read properties of undefined (reading 'trim')` |
 * | 目录不在仓库内 | `ERR_MODULE_NOT_FOUND` |
 *
 * 第一条至少说出了「不是子类」；第二条只说 `trim`——**既不说哪个字段，
 * 也不说发生在 `定义插件` 这一层**；第三条最远，完全指向 Node 的模块解析。
 *
 * 用户看到这些只会去猜。而猜错一次要重启一次平台，成本很高。
 * 所以诊断信息本身值得单测：断言它**必须提到那个真正的原因**。
 *
 * 这类测试的特点：不测返回值精确匹配（措辞会改），
 * 只测「关键信息在不在」。措辞变了不该红，关键信息丢了必须红。
 */

import { describe, expect, it } from "vitest";
import {
  像插件类,
  描述导出,
  诊断加载错误,
  诊断元数据缺失,
  诊断模块找不到,
  诊断非插件类,
} from "../src/diagnose.js";
import { BasePlugin, 定义插件 } from "../src/index.js";

/** 造一个真插件类 */
class 测试插件 extends BasePlugin {
  on_load(): void {
    /* 无操作 */
  }
}

describe("像插件类", () => {
  it("有 on_load 的方法算插件类", () => {
    expect(像插件类(测试插件)).toBe(true);
  });

  it("有静态 插件元数据 也算（没重写 on_load 时）", () => {
    class 只有元数据 {}
    (只有元数据 as unknown as { 插件元数据: unknown }).插件元数据 = { name: "x" };
    expect(像插件类(只有元数据)).toBe(true);
  });

  it("普通函数不算", () => {
    expect(像插件类(function 普通() {})).toBe(false);
    expect(像插件类(() => {})).toBe(false);
  });

  it("普通类不算（没有 on_load 也没有元数据）", () => {
    class 空类 {}
    expect(像插件类(空类)).toBe(false);
  });

  it("非函数一律不算", () => {
    for (const 值 of [null, undefined, 0, "x", {}, []]) {
      expect(像插件类(值), String(值)).toBe(false);
    }
  });
});

describe("描述导出：说清实际导出了什么", () => {
  it("模块是函数时点明「整个模块是函数」（不是插件类）", () => {
    const 说明 = 描述导出(function 随便() {});
    expect(说明).toContain("整个模块是一个函数");
    expect(说明).toContain("不是 BasePlugin 子类");
  });

  it("空导出", () => {
    expect(描述导出(null)).toContain("空导出");
    expect(描述导出(undefined)).toContain("空导出");
  });

  it("空对象 → 点明可能写成了 CJS module.exports", () => {
    // 这是「写了 module.exports = {...} 但里面没有类」的情形
    const 说明 = 描述导出({});
    expect(说明).toContain("没有具名导出");
    expect(说明).toContain("module.exports");
  });

  it("有键但没 default → 点明「没有 default 导出」", () => {
    // 忘记 `export default` 只写了 `class Xxx extends BasePlugin {}`
    const 说明 = 描述导出({ 测试插件 });
    expect(说明).toContain("没有 default 导出");
    expect(说明).toContain("测试插件"); // 列出实际键名
  });

  it("default 是函数但不像插件类 → 说清「缺 on_load 与元数据」", () => {
    const 说明 = 描述导出({ default: function 不是插件() {} });
    expect(说明).toContain("default 是函数");
    expect(说明).toContain("缺 on_load");
  });

  it("default 是对象 → 报出类型", () => {
    const 说明 = 描述导出({ default: { hello: 1 } });
    expect(说明).toContain("default 是 object");
  });

  it("列出全部导出键（帮用户判断自己导出了什么）", () => {
    const 说明 = 描述导出({ a: 1, b: 2, default: 3 });
    expect(说明).toContain("a");
    expect(说明).toContain("b");
    expect(说明).toContain("default");
  });
});

describe("诊断非插件类：三类成因都要提到", () => {
  const 说明 = 诊断非插件类("my-plugin", {});

  it("带上插件名", () => {
    expect(说明).toContain("my-plugin");
  });

  it("提到 CommonJS 写法（第一种成因）", () => {
    // 用户写 module.exports 时最需要看到这条
    expect(说明).toContain("CommonJS");
    expect(说明).toContain("module.exports");
    expect(说明).toContain("ESM");
  });

  it("提到忘记 export default（第二种成因）", () => {
    expect(说明).toContain("export default");
  });

  it("提到继承的可能是别的包里的同名类（第三种成因）", () => {
    // 版本不一致时最容易踩：继承看着没问题但 instanceof 不成立
    expect(说明).toContain("继承");
  });

  it("包含实际导出形状（用户据此判断该改哪里）", () => {
    expect(诊断非插件类("x", {})).toContain("没有具名导出");
    expect(诊断非插件类("x", { a: 1 })).toContain("没有 default 导出");
  });
});

describe("诊断元数据缺失", () => {
  const 真错 = new TypeError("Cannot read properties of undefined (reading 'trim')");

  it("识别 trim 错误并点出缺少的字段", () => {
    const 说明 = 诊断元数据缺失(真错, { name: "x", version: "1.0.0", author: "a" });
    expect(说明).toContain("`description`");
  });

  it("缺少 description 时明确说这是最常见原因", () => {
    // 原错误只说 trim，完全指不到 description
    const 说明 = 诊断元数据缺失(真错, { name: "x", version: "1", author: "a" })!;
    expect(说明).toContain("description");
    expect(说明).toContain("最常见");
  });

  it("多个字段缺失时全部列出", () => {
    const 说明 = 诊断元数据缺失(真错, {})!;
    for (const k of ["name", "version", "description", "author"]) {
      expect(说明, k).toContain(`\`${k}\``);
    }
  });

  it("空白串算缺失（trim 后为空同样抛错）", () => {
    const 说明 = 诊断元数据缺失(真错, {
      name: "x",
      version: "1",
      description: "   ",
      author: "a",
    })!;
    expect(说明).toContain("`description`");
  });

  it("非字符串算缺失", () => {
    const 说明 = 诊断元数据缺失(真错, {
      name: "x",
      version: 1,
      description: "d",
      author: "a",
    })!;
    expect(说明).toContain("`version`");
  });

  it("元数据整个是 undefined 时全部列为缺失", () => {
    const 说明 = 诊断元数据缺失(真错, undefined)!;
    expect(说明).toContain("`name`");
    expect(说明).toContain("`description`");
  });

  it("带上调用位置（帮助定位到具体文件）", () => {
    const 说明 = 诊断元数据缺失(真错, {}, "/repo/plugins/x/index.js")!;
    expect(说明).toContain("/repo/plugins/x/index.js");
  });

  it("非 trim 错误返回 null（不误诊）", () => {
    expect(诊断元数据缺失(new Error("别的问题"), {})).toBeNull();
    expect(诊断元数据缺失("随便什么", {})).toBeNull();
  });

  it("四种引号/格式的 trim 错误都能认（不同 Node 措辞不同）", () => {
    const 变体 = [
      "Cannot read properties of undefined (reading 'trim')",
      'Cannot read properties of undefined (reading "trim")',
    ];
    for (const 文 of 变体) {
      expect(诊断元数据缺失(new TypeError(文), {}), 文).not.toBeNull();
    }
  });
});

describe("诊断模块找不到", () => {
  it("ERR_MODULE_NOT_FOUND 时点明「目录不在仓库内」", () => {
    const 说明 = 诊断模块找不到(
      new Error("Cannot find package '@kugua/plugin-sdk' imported from /tmp/x/index.js"),
      "/tmp/x",
    )!;
    expect(说明).toContain("/tmp/x");
    expect(说明).toContain("不在仓库内");
    expect(说明).toContain("plugin-sdk");
  });

  it("ERR_MODULE_NOT_FOUND 代码也能认", () => {
    const 说明 = 诊断模块找不到(
      new Error("ERR_MODULE_NOT_FOUND: x"),
      "/tmp/x",
    );
    expect(说明).not.toBeNull();
  });

  it("Cannot find module 也能认（CJS 风格措辞）", () => {
    expect(诊断模块找不到(new Error("Cannot find module 'x'"), "/a")).not.toBeNull();
  });

  it("顺带给出「放在仓库内 plugins/ 下」的建议", () => {
    const 说明 = 诊断模块找不到(new Error("Cannot find package 'x'"), "/a")!;
    expect(说明).toContain("plugins/");
  });

  it("保留原始错误（排查时仍需原文）", () => {
    const 说明 = 诊断模块找不到(new Error("Cannot find package 'y'"), "/a")!;
    expect(说明).toContain("Cannot find package 'y'");
  });

  it("其他错误返回 null（不误诊）", () => {
    expect(诊断模块找不到(new Error("语法错误"), "/a")).toBeNull();
  });
});

describe("诊断加载错误：优先级与回退", () => {
  const trim错 = new TypeError("Cannot read properties of undefined (reading 'trim')");

  it("元数据缺失优先（错误信息最没用，优先级最高）", () => {
    // 同时给了模块与目录，也应当报元数据问题
    const 说明 = 诊断加载错误("x", trim错, {
      模块: {},
      目录: "/tmp/x",
      元数据: {},
    });
    expect(说明).toContain("元数据不完整");
  });

  it("模块找不到优先于「非插件类」", () => {
    const 说明 = 诊断加载错误("x", new Error("Cannot find package 'y'"), {
      目录: "/tmp/x",
    });
    expect(说明).toContain("不在仓库内");
  });

  it("有模块导出物时报「非插件类」并带形状", () => {
    const 说明 = 诊断加载错误("x", new Error("插件 x 默认导出不是 BasePlugin 子类"), {
      模块: {},
      目录: "/repo/plugins/x",
    });
    expect(说明).toContain("默认导出不是 BasePlugin 子类");
    expect(说明).toContain("没有具名导出");
  });

  it("什么上下文都没有时原样返回错误文本（不吞信息）", () => {
    expect(诊断加载错误("x", new Error("别的错误"), {})).toBe("Error: 别的错误");
  });

  it("全部上下文齐全但错误无关时仍原样返回", () => {
    const 说明 = 诊断加载错误("x", new Error("语法错误"), {
      模块: {},
      目录: "/a",
      元数据: {},
    });
    expect(说明).toContain("语法错误");
  });
});

describe("定义插件 的字段校验（契约守门人）", () => {
  it("少 name 直接点名 name（不再是 trim 错）", () => {
    let 捕获: unknown;
    try {
      // @ts-expect-error 故意不传 name
      定义插件(测试插件, { version: "1.0.0", description: "d", author: "t" });
    } catch (e) {
      捕获 = e;
    }
    expect(String(捕获)).toContain("缺少必填字段");
    expect(String(捕获)).toContain("name");
    // 关键：不再是那句指不到原因的 trim 错
    expect(String(捕获)).not.toMatch(/reading 'trim'/);
  });

  it("少 version 直接点名 version", () => {
    let 捕获: unknown;
    try {
      // @ts-expect-error 故意不传 version
      定义插件(测试插件, { name: "x", description: "d", author: "t" });
    } catch (e) {
      捕获 = e;
    }
    expect(String(捕获)).toContain("version");
    expect(String(捕获)).not.toMatch(/reading 'trim'/);
  });

  it("少 description **也抛错**（原来会静默写入 undefined）", () => {
    // 这是本轮修的：原实现对 description / author 不做校验，
    // 缺了直接以 undefined 展开进元数据，要等清单校验或界面渲染才暴露
    expect(() =>
      // @ts-expect-error 故意不传 description
      定义插件(测试插件, { name: "静默", version: "1.0.0", author: "t" }),
    ).toThrow(/description/);
  });

  it("少 author 也抛错", () => {
    expect(() =>
      // @ts-expect-error 故意不传 author
      定义插件(测试插件, { name: "静默", version: "1.0.0", description: "d" }),
    ).toThrow(/author/);
  });

  it("多个字段同时缺时全部列出", () => {
    expect(() =>
      // @ts-expect-error 故意传空
      定义插件(测试插件, {}),
    ).toThrow(/name.*version.*description.*author|name、version、description、author/);
  });

  it("空白串算缺失（trim 后为空）", () => {
    expect(() =>
      定义插件(测试插件, { name: "  ", version: "1.0.0", description: "d", author: "t" }),
    ).toThrow(/name/);
  });

  it("非字符串算缺失", () => {
    expect(() =>
      // @ts-expect-error 故意传数字
      定义插件(测试插件, { name: "x", version: 1, description: "d", author: "t" }),
    ).toThrow(/version/);
  });

  it("错误信息列出四个必填字段名（用户照着改）", () => {
    try {
      // @ts-expect-error 故意传空
      定义插件(测试插件, {});
    } catch (e) {
      const 文 = String(e);
      for (const k of ["name", "version", "description", "author"]) {
        expect(文, k).toContain(k);
      }
    }
  });

  it("name 会被 trim 并转小写，version 会被 trim", () => {
    class X extends BasePlugin {}
    定义插件(X, { name: "  My-Plugin  ", version: "  1.2.3  ", description: "d", author: "a" });
    expect(X.插件元数据!.name).toBe("my-plugin");
    expect(X.插件元数据!.version).toBe("1.2.3");
  });

  it("字段齐全时正常返回类（对照）", () => {
    expect(() =>
      定义插件(测试插件, {
        name: "完整测试",
        version: "1.0.0",
        description: "描述",
        author: "t",
      }),
    ).not.toThrow();
  });
});

/**
 * 小组件协议单测：归一、截断、primary 上限、id 合法性
 *
 * 这些规则是「插件不得越界」的守门员，被破坏不一定会崩，
 * 而是悄悄变成界面上的怪东西——所以必须钉住。
 */
import { describe, it, expect } from "vitest";
import {
  归一小部件声明,
  归一小部件列表,
  合法小组件id,
  最多小组件数,
  最多曲线点数,
} from "@kugua/nigane";

const 来源 = "sysmon";

describe("小组件 id 合法性", () => {
  it("接受正常 id", () => {
    expect(合法小组件id("cpu")).toBe(true);
    expect(合法小组件id("net.down_1-a")).toBe(true);
  });

  it("拒绝空、超长、大写、空格、路径穿越", () => {
    expect(合法小组件id("")).toBe(false);
    expect(合法小组件id("x".repeat(65))).toBe(false);
    expect(合法小组件id("CPU")).toBe(false);
    expect(合法小组件id("net down")).toBe(false);
    expect(合法小组件id("../etc")).toBe(false);
    expect(合法小组件id(123)).toBe(false);
  });

  it("拒绝 HTML 片段——标题渲染用 textContent，但 id 也不该放行", () => {
    expect(合法小组件id("<script>")).toBe(false);
  });
});

describe("单条声明归一", () => {
  it("最小声明只有 id/类型/标题", () => {
    const r = 归一小部件声明({ id: "cpu", 类型: "sparkline", 标题: "CPU" }, 来源);
    expect("声明" in r).toBe(true);
    if (!("声明" in r)) return;
    expect(r.声明.id).toBe("cpu");
    expect(r.声明.类型).toBe("sparkline");
    expect(r.声明.显著度).toBe("normal");
    // 不填分组时默认等于来源，这样一个插件的组件天然成组
    expect(r.声明.分组).toBe(来源);
  });

  it("接受英文键（清单文件用英文）", () => {
    const r = 归一小部件声明(
      { id: "cpu", type: "gauge", title: "CPU", prominence: "primary", unit: "%", max: 50 },
      来源,
    );
    expect("声明" in r).toBe(true);
    if (!("声明" in r)) return;
    expect(r.声明.类型).toBe("gauge");
    expect(r.声明.显著度).toBe("primary");
    expect(r.声明.单位).toBe("%");
    expect(r.声明.最大).toBe(50);
  });

  it("未知类型整条拒绝，不降级成 number", () => {
    const r = 归一小部件声明({ id: "x", 类型: "pie", 标题: "X" }, 来源);
    expect("原因" in r).toBe(true);
  });

  it("未知的显著度当 normal，不拒绝", () => {
    const r = 归一小部件声明({ id: "x", 类型: "number", 标题: "X", 显著度: "huge" }, 来源);
    expect("声明" in r).toBe(true);
    if (!("声明" in r)) return;
    expect(r.声明.显著度).toBe("normal");
  });

  it("缺少标题则拒绝", () => {
    expect("原因" in 归一小部件声明({ id: "x", 类型: "number" }, 来源)).toBe(true);
    expect("原因" in 归一小部件声明({ id: "x", 类型: "number", 标题: "   " }, 来源)).toBe(true);
  });

  it("点数与过期被夹到合理范围", () => {
    const r = 归一小部件声明({ id: "x", 类型: "sparkline", 标题: "X", 点数: 9999, 过期: 1 }, 来源);
    if (!("声明" in r)) throw new Error("应通过");
    expect(r.声明.点数).toBe(最多曲线点数);
    expect(r.声明.过期).toBe(5);
  });

  it("小数位夹在 0..6 并取整", () => {
    const r = 归一小部件声明({ id: "x", 类型: "number", 标题: "X", 小数位: 9.7 }, 来源);
    if (!("声明" in r)) throw new Error("应通过");
    expect(r.声明.小数位).toBe(6);
  });

  it("非法的外观值被丢弃而不是报错", () => {
    const r = 归一小部件声明({ id: "x", 类型: "gauge", 标题: "X", 外观: "triangle" }, 来源);
    if (!("声明" in r)) throw new Error("应通过");
    expect(r.声明.外观).toBeUndefined();
  });
});

describe("列表归一的限制", () => {
  it("超过上限截断并给出警告", () => {
    const 列 = Array.from({ length: 最多小组件数 + 3 }, (_, i) => ({
      id: `w${i}`,
      类型: "number",
      标题: `W${i}`,
    }));
    const r = 归一小部件列表(列, 来源);
    expect(r.声明.length).toBe(最多小组件数);
    expect(r.警告.some((w) => w.includes("超过"))).toBe(true);
  });

  it("primary 超过 2 个时降级并警告", () => {
    const r = 归一小部件列表(
      [
        { id: "a", 类型: "number", 标题: "A", 显著度: "primary" },
        { id: "b", 类型: "number", 标题: "B", 显著度: "primary" },
        { id: "c", 类型: "number", 标题: "C", 显著度: "primary" },
      ],
      来源,
    );
    expect(r.声明.map((x) => x.显著度)).toEqual(["primary", "primary", "normal"]);
    expect(r.警告.some((w) => w.includes("primary"))).toBe(true);
  });

  it("重复 id 只保留第一个", () => {
    const r = 归一小部件列表(
      [
        { id: "x", 类型: "number", 标题: "第一" },
        { id: "x", 类型: "gauge", 标题: "第二" },
      ],
      来源,
    );
    expect(r.声明.length).toBe(1);
    expect(r.声明[0].标题).toBe("第一");
  });

  it("坏项跳过，好项照常保留", () => {
    const r = 归一小部件列表(
      [
        { id: "ok1", 类型: "number", 标题: "OK1" },
        { id: "bad", 类型: "unknown", 标题: "坏" },
        { id: "ok2", 类型: "gauge", 标题: "OK2" },
      ],
      来源,
    );
    expect(r.声明.map((x) => x.id)).toEqual(["ok1", "ok2"]);
    expect(r.警告.length).toBe(1);
  });

  it("非数组返回空，不抛错", () => {
    expect(归一小部件列表(undefined, 来源).声明).toEqual([]);
    expect(归一小部件列表(null, 来源).声明).toEqual([]);
    expect(归一小部件列表({}, 来源).声明).toEqual([]);
  });

  it("跨插件分组：显式分组覆盖默认", () => {
    const r = 归一小部件列表([{ id: "gpu", 类型: "number", 标题: "GPU", 分组: "sysmon.系统" }], "other");
    expect(r.声明[0].分组).toBe("sysmon.系统");
  });
});

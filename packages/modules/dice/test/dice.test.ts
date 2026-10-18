/**
 * `dice` 模块的确定性测试。
 *
 * 这类「严格复刻参考项目」的模块最怕**静默偏差**：改了重构、结构照旧，
 * 但边界条件悄悄变了，而界面上只会显示一个看起来正常的骰子点数。
 *
 * 所以这些模块必须能测。原来的问题是逻辑全埋在 `启动模块()` 的处理器闭包里
 * ——闭包一建就要连主控，测试根本够不着——于是它们长期一条测试都没有。
 * 现在纯逻辑抽成 `解析参数` / `掷骰` / `掷骰结果` 导出，随机源用固定序列替换。
 *
 * 随机序列的替换点选 `@kugua/random` 的 `NextInt`：它是全平台统一随机源，
 * mock 掉它比 mock `node:crypto` 更贴近真实调用路径。
 */

import { describe, expect, it, vi } from "vitest";

const 序列: number[] = [];
vi.mock("@kugua/random", () => ({
  // NextInt(max) 语义是 [0, max)，测试里按预设序列依次返回
  NextInt: (max?: number) => {
    const v = 序列.shift();
    if (v === undefined) throw new Error("随机序列用完了");
    // 顺手守住契约：返回必须落在 [0, max)
    if (max !== undefined && (v < 0 || v >= max)) {
      throw new Error(`NextInt(${max}) 返回了越界值 ${v}`);
    }
    return v;
  },
}));

const { 解析参数, 掷骰, 掷骰结果, 个数上限, 默认面数 } = await import(
  "../src/index.js"
);

/** 用给定序列跑一次，返回结果 */
function 用序列(序列值: number[], 参数: unknown) {
  序列.length = 0;
  序列.push(...序列值);
  return 掷骰结果(参数);
}

describe("dice 解析参数", () => {
  it("r3d6 解出 3 个 6 面", () => {
    expect(解析参数({ 原文: "r3d6" })).toEqual({ 个数: 3, 面数: 6, 缘由: "" });
  });

  it("rd50 省略个数时按 1 个算", () => {
    expect(解析参数({ 原文: "rd50" })).toEqual({ 个数: 1, 面数: 50, 缘由: "" });
  });

  it("r3d 省略面数时按 100 算", () => {
    expect(解析参数({ 原文: "r3d" })).toEqual({ 个数: 3, 面数: 默认面数, 缘由: "" });
  });

  it("rd 两者都省略：1d100", () => {
    expect(解析参数({ 原文: "rd" })).toEqual({ 个数: 1, 面数: 默认面数, 缘由: "" });
  });

  it("原文后面的部分是缘由，且去掉首尾空白", () => {
    expect(解析参数({ 原文: "r3d6 看看运气" })).toEqual({
      个数: 3,
      面数: 6,
      缘由: "看看运气",
    });
  });

  it("大小写不敏感（复刻 /i）", () => {
    expect(解析参数({ 原文: "R3D6" })).toMatchObject({ 个数: 3, 面数: 6 });
  });

  it("优先用原文，原文解析不出才用显式字段", () => {
    // 原文能匹配 → 覆盖显式字段
    expect(解析参数({ 原文: "r2d8", 个数: 9, 面数: 9 })).toMatchObject({ 个数: 2, 面数: 8 });
    // 原文匹配不上 → 用显式字段
    expect(解析参数({ 原文: "随便打的", 个数: 2, 面数: 8 })).toMatchObject({ 个数: 2, 面数: 8 });
  });

  it("没有原文时从 参数文本 / 文本 依次回退", () => {
    expect(解析参数({ 参数文本: "r2d4" })).toMatchObject({ 个数: 2, 面数: 4 });
    expect(解析参数({ 文本: "r2d4" })).toMatchObject({ 个数: 2, 面数: 4 });
  });

  it("个数超过上限按上限算", () => {
    expect(解析参数({ 原文: `r${个数上限 + 50}d6` }).个数).toBe(个数上限);
  });

  it("个数为 0 或负数回落 1", () => {
    expect(解析参数({ 个数: 0 }).个数).toBe(1);
    expect(解析参数({ 个数: -5 }).个数).toBe(1);
  });

  it("面数为 0 或负数回落默认面数", () => {
    expect(解析参数({ 面数: 0 }).面数).toBe(默认面数);
    expect(解析参数({ 面数: -3 }).面数).toBe(默认面数);
  });
});

describe("dice 掷骰", () => {
  it("面数为 1 时恒为 1，且不消耗随机数", () => {
    序列.length = 0;
    const 结果 = 掷骰(1, 3);
    expect(结果.明细).toEqual([1, 1, 1]);
    expect(结果.总和).toBe(3);
    // 随机序列没被动过：这里若消耗了随机数，说明面数判断写错了
    expect(序列.length).toBe(0);
  });

  it("面数 ≤ 0 时也恒为 1（复刻 面数 > 1 的判断）", () => {
    序列.length = 0;
    expect(掷骰(0, 2).明细).toEqual([1, 1]);
    expect(掷骰(-7, 2).明细).toEqual([1, 1]);
  });

  it("面数 > 1 时取 [1, 面数]（NextInt 返回 0 得 1，返回 max-1 得 max）", () => {
    // NextInt(6) 返回 0 → 点数 1；返回 5 → 点数 6
    const 低 = 用序列([0, 5], { 原文: "r2d6" });
    expect(低.明细).toEqual([1, 6]);
    expect(低.总和).toBe(7);
  });

  it("单个数时不显示明细，描述就是总和", () => {
    const 结果 = 用序列([2], { 原文: "rd6" });
    expect(结果.明细).toEqual([3]);
    expect(结果.描述).toBe("3");
  });

  it("多个数时描述是「明细 = 总和」", () => {
    const 结果 = 用序列([0, 1, 2], { 原文: "r3d6" });
    expect(结果.明细).toEqual([1, 2, 3]);
    expect(结果.描述).toBe("1+2+3 = 6");
  });
});

describe("dice 掷骰结果", () => {
  it("有缘由时拼进文本", () => {
    const 结果 = 用序列([0], { 原文: "r1d6 试试手气" });
    expect(结果.缘由).toBe("试试手气");
    expect(结果.文本).toBe("试试手气 1d6 = 1");
  });

  it("没缘由时文本不留前导空格", () => {
    const 结果 = 用序列([0], { 原文: "r1d6" });
    expect(结果.文本).toBe("1d6 = 1");
    expect(结果.文本.startsWith(" ")).toBe(false);
  });

  it("文本里的个数与面数是**夹取后**的值，不是用户原样输入", () => {
    // 用户填 1000 个，实际按上限掷；文本必须说 100 而不是 1000，
    // 否则用户看到的和实际掷的对不上。
    序列.length = 0;
    序列.push(...Array(个数上限).fill(0));
    const 结果 = 掷骰结果({ 原文: "r1000d6" });
    expect(结果.个数).toBe(个数上限);
    expect(结果.文本).toContain(`${个数上限}d6`);
    expect(结果.明细.length).toBe(个数上限);
  });

  it("空参数：1d100，且只消耗一个随机数", () => {
    const 结果 = 用序列([0], {});
    expect(结果.个数).toBe(1);
    expect(结果.面数).toBe(默认面数);
    expect(结果.总和).toBe(1);
    expect(序列.length).toBe(0);
  });
});

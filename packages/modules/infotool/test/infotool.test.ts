/**
 * 信息工具单元测试：表达式求值（复刻 Calculator.cs）与大整数除法（复刻 BigUtil.cs）。
 *
 * BigUtil 期望值用 .NET 实测 C# 原实现得到（见下方用例注释）。
 */
import { describe, expect, it } from "vitest";
import { Calculator } from "../src/calculator";
import { 大整数除法, 大整数除法转字符串 } from "../src/bigutil";

const 算 = (表达式: string): number => new Calculator(表达式).Evaluate();

describe("Calculator（复刻 Algorithms/Calculator.cs）", () => {
  it("基本四则与优先级", () => {
    expect(算("1+2*3")).toBe(7);
    expect(算("(1+2)*3")).toBe(9);
    expect(算("1-2-3")).toBe(-4);
    expect(算("10/4")).toBe(2.5);
    expect(算("10%3")).toBe(1);
  });

  it("乘方 / 开方 / 常量", () => {
    expect(算("2^10")).toBe(1024);
    expect(算("9√")).toBe(3);
    expect(算("pi")).toBeCloseTo(Math.PI, 12);
    expect(算("e")).toBeCloseTo(Math.E, 12);
  });

  it("一元负号优先级与 C# 一致：-2^2 = 4（负号先结合）", () => {
    expect(算("-2^2")).toBe(4);
    expect(算("-5")).toBe(-5);
  });

  it("支持全角括号", () => {
    expect(算("（1+2）")).toBe(3);
  });
});

describe("BigUtil 大整数除法（复刻 Algorithms/BigUtil.cs）", () => {
  it("Div 返回 整数/小数/分母", () => {
    // C#: Div(100, 3, 2) = (33, 3, 10)
    expect(大整数除法(100n, 3n, 2)).toEqual({ intPart: 33n, decPart: 3n, decUnit: 10n });
  });

  it("DivToString 与 C# 输出逐字一致", () => {
    // 以下四项均用 .NET 运行原实现核对（数值见注释）
    expect(大整数除法转字符串(100n, 3n, 2)).toBe("33.03"); // C#: 33.03
    expect(大整数除法转字符串(1n, 3n, 2)).toBe("0.03"); // C#: 0.03
    // C# 的 Log10(1000) 有浮点尾差（2.9999999999999996）→ 补零位数 3 → "3.141"
    expect(大整数除法转字符串(355n, 113n, 4)).toBe("3.141");
    expect(大整数除法转字符串(314159n, 100n, 3)).toBe("3141.590");
  });

  it("keepN 上限生效（分母位数取较小者）", () => {
    // C#: S(12345,100,2) = 123.045（分母 3 位，keepN=2 → 保留 2 位小数，且沿用上面的补零约定）
    expect(大整数除法转字符串(12345n, 100n, 2)).toBe("123.045");
  });
});

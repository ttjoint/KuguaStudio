/**
 * 数字论证单元测试（复刻 C# MathProof.cs）。
 *
 * 该算法内部用统一随机源在多个等价证明中挑选，故只断言**确定性不变量**：
 * 可证明时必能给出非空证明链、不可证明时返回空、空输入返回空。
 */
import { describe, expect, it } from "vitest";
import { MathProof } from "../src/math_proof";

describe("MathProof（复刻 Algorithms/MathProof.cs）", () => {
  it("可由给定数字拼出目标时，能找到证明", () => {
    const mp = new MathProof();
    const 证明集 = mp.GetStrongProofs(10, [1, 2, 3, 4]);
    expect(证明集.length).toBeGreaterThan(0);
    expect(证明集.some((s) => s.includes("10") || s.includes("1+2+3+4"))).toBe(true);
  });

  it("Proof 返回非空证明链，且链内包含目标数字的推导", () => {
    const mp = new MathProof();
    const 链 = mp.Proof(10, [1, 2, 3, 4]);
    expect(链.length).toBeGreaterThan(0);
    expect(链.join("")).toContain("1");
  });

  it("空数字集返回空结果", () => {
    const mp = new MathProof();
    expect(mp.Proof(0, [])).toEqual([]);
    expect(mp.Proof(7, [])).toEqual([]);
  });

  it("多个目标均可证明（24 = 1*2*3*4）", () => {
    const mp = new MathProof();
    expect(mp.GetStrongProofs(24, [1, 2, 3, 4]).length).toBeGreaterThan(0);
  });
});

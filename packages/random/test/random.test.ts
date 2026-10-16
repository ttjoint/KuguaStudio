/**
 * 统一随机源单元测试（@kugua/random）。
 *
 * 随机值本身不可预测，故只断言**区间/边界/置换等不变量**。
 */
import { describe, expect, it } from "vitest";
import { NextInt, NextUInt, NextULong, NextDouble, NextString, Pick, Shuffle } from "../src/index";

describe("NextInt 区间语义", () => {
  it("NextInt(max) 返回 [0, max)", () => {
    for (let i = 0; i < 200; i++) {
      const v = NextInt(5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });

  it("NextInt(min, max) 返回 [min, max)", () => {
    for (let i = 0; i < 200; i++) {
      const v = NextInt(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
    }
  });

  it("min == max 返回该值；min > max 自动交换", () => {
    expect(NextInt(5, 5)).toBe(5);
    for (let i = 0; i < 50; i++) {
      const v = NextInt(7, 3);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
    }
  });
});

describe("其他随机源", () => {
  it("NextUInt 落在 [0, 2^32)", () => {
    for (let i = 0; i < 50; i++) {
      const v = NextUInt();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it("NextULong 落在 [0, 2^64)", () => {
    for (let i = 0; i < 50; i++) {
      const v = NextULong();
      expect(v).toBeGreaterThanOrEqual(0n);
      expect(v).toBeLessThan(2n ** 64n);
    }
  });

  it("NextDouble 落在 [0, 1)", () => {
    for (let i = 0; i < 50; i++) {
      const v = NextDouble();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("NextString / Pick / Shuffle", () => {
  it("NextString 长度正确且只用安全字符集", () => {
    const 允许 = /^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]*$/;
    for (const 长度 of [0, 1, 8, 32]) {
      const s = NextString(长度);
      expect(s.length).toBe(长度);
      expect(允许.test(s)).toBe(true);
    }
  });

  it("Pick 取到集合内元素，空集合抛错", () => {
    const 集 = ["a", "b", "c"];
    for (let i = 0; i < 30; i++) expect(集).toContain(Pick(集));
    expect(() => Pick([])).toThrow();
  });

  it("Shuffle 保元素、不改原数组", () => {
    const 原 = [1, 2, 3, 4, 5, 6, 7, 8];
    const 快照 = [...原];
    for (let i = 0; i < 20; i++) {
      const 洗 = Shuffle(原);
      expect(洗).toHaveLength(原.length);
      expect([...洗].sort((a, b) => a - b)).toEqual(快照);
    }
    expect(原).toEqual(快照);
  });
});

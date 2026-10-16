/**
 * 万年历核心库单元测试。
 *
 * 期望值来源：
 *  - 农历/干支/节气/节日：公开历法常识（春节日期、立春/冬至、甲辰年等）
 *  - 儒略日 / 回历：用 .NET 实测参考项目依赖的 `Prophecy.JDateTime` 得到（40 例抽样）
 */
import { describe, expect, it } from "vitest";
import {
  公历转农历,
  公历转回历,
  干支,
  生肖,
  年干支序号,
  日干支序号,
  星期,
  当日节日,
  节气日,
  儒略日,
  四柱查询,
  朝代,
  星座,
  农历月名串,
  农历日名串,
  农历月大小,
} from "../src/lunar";

describe("公历转农历", () => {
  it("春节（正月初一）", () => {
    expect(公历转农历(2024, 2, 10)).toEqual({ year: 2024, month: 1, day: 1, isLeap: false });
    expect(公历转农历(2025, 1, 29)).toEqual({ year: 2025, month: 1, day: 1, isLeap: false });
    expect(公历转农历(2026, 2, 17)).toEqual({ year: 2026, month: 1, day: 1, isLeap: false });
    expect(公历转农历(2023, 1, 22)).toEqual({ year: 2023, month: 1, day: 1, isLeap: false });
  });

  it("中秋（八月十五）", () => {
    expect(公历转农历(2024, 9, 17)).toEqual({ year: 2024, month: 8, day: 15, isLeap: false });
  });

  it("立春当日（2024-02-04 = 癸卯年腊月廿五）", () => {
    expect(公历转农历(2024, 2, 4)).toEqual({ year: 2023, month: 12, day: 25, isLeap: false });
  });
});

describe("闰月编号（与 Prophecy 对齐）", () => {
  it("闰月保持与前置月同号（闰二月 → month=2，而非 3）", () => {
    // 2023 年闰二月：2023-03-22 为闰二月初一，2023-04-19 为闰二月廿九
    expect(公历转农历(2023, 3, 22)).toEqual({ year: 2023, month: 2, day: 1, isLeap: true });
    expect(公历转农历(2023, 4, 19)).toEqual({ year: 2023, month: 2, day: 29, isLeap: true });
    // 2025 年闰六月
    expect(公历转农历(2025, 7, 25)).toEqual({ year: 2025, month: 6, day: 1, isLeap: true });
    // 闰月前后为正常月序
    expect(公历转农历(2023, 3, 21)).toEqual({ year: 2023, month: 2, day: 30, isLeap: false });
    expect(公历转农历(2023, 4, 20)).toEqual({ year: 2023, month: 3, day: 1, isLeap: false });
  });

  it("闰月名称正确", () => {
    expect(农历月名串(2023, 2, true)).toBe("闰二月");
    expect(农历月名串(2025, 6, true)).toBe("闰六月");
    expect(农历月名串(2024, 1, false)).toBe("正月");
  });
});

describe("干支 / 生肖 / 星期", () => {
  it("年干支与生肖", () => {
    expect(年干支序号(2024)).toBe(40);
    expect(干支(40)).toBe("甲辰");
    expect(生肖(2024)).toBe("龙");
    expect(干支(年干支序号(2025))).toBe("乙巳");
  });

  it("日干支以 2000-01-01 戊午（序数 54）为基准", () => {
    expect(日干支序号(2000, 1, 1)).toBe(54);
    expect(干支(54)).toBe("戊午");
  });

  it("星期名", () => {
    expect(星期(2024, 2, 10)).toBe("六");
    expect(星期(2026, 2, 17)).toBe("二");
  });
});

describe("四柱（与 Prophecy.JDateTime.LunarFourPillars 对齐）", () => {
  const 四柱 = (y: number, m: number, d: number, h: number): string => {
    const n = 公历转农历(y, m, d);
    const fp = 四柱查询(y, m, d, n.year, n.month, h);
    return `${fp.年} ${fp.月} ${fp.日} ${fp.时}`;
  };

  it("已核对 .NET 实测值", () => {
    expect(四柱(2024, 2, 10, 0)).toBe("甲辰 丙寅 甲辰 甲子");
    expect(四柱(2024, 2, 10, 10)).toBe("甲辰 丙寅 甲辰 己巳");
    expect(四柱(2024, 2, 4, 0)).toBe("癸卯 乙丑 戊戌 壬子");
    expect(四柱(2000, 1, 1, 0)).toBe("己卯 丙子 戊午 壬子");
    expect(四柱(2026, 2, 17, 0)).toBe("丙午 庚寅 壬戌 庚子");
    expect(四柱(1984, 2, 2, 0)).toBe("甲子 丙寅 丙寅 戊子");
    expect(四柱(2025, 1, 29, 12)).toBe("乙巳 戊寅 戊戌 戊午");
    expect(四柱(1990, 6, 15, 8)).toBe("庚午 壬午 辛亥 壬辰");
  });

  it("闰月日期的月柱沿用前置月（C# 实测 2023-03-22 = 乙卯）", () => {
    expect(四柱(2023, 3, 22, 0)).toBe("癸卯 乙卯 己卯 甲子");
    expect(四柱(2025, 7, 25, 0)).toBe("乙巳 癸未 乙未 丙子");
  });
});

describe("节气与节日", () => {
  it("节气日（天文算法）：已对 Prophecy 660 个节气日全部核对", () => {
    expect(节气日(2024, 2)).toBe(4); // 立春
    expect(节气日(2024, 23)).toBe(21); // 冬至
    // 旧固定偏移表会算成 23（相差 1 天），天文算法为 22
    expect(节气日(2024, 15)).toBe(22); // 处暑
    // 距东八区午夜仅 51 秒的边界例，需 ΔT 修正才与参考实现一致
    expect(节气日(2045, 12)).toBe(7); // 小暑
  });

  it("当日节日", () => {
    expect(当日节日(2024, 2, 10)).toBe("春节");
    expect(当日节日(2024, 9, 17)).toBe("中秋节");
    expect(当日节日(2024, 10, 1)).toBe("国庆节");
  });
});

describe("儒略日（与 Prophecy.JDateTime.JulianDate 对齐）", () => {
  it("已核对 .NET 实测值", () => {
    expect(儒略日(2000, 1, 1)).toBe(2451544.5);
    expect(儒略日(2024, 2, 10)).toBe(2460350.5);
    expect(儒略日(1900, 1, 1)).toBe(2415020.5);
    expect(儒略日(2026, 2, 17)).toBe(2461088.5);
    expect(儒略日(2024, 1, 1)).toBe(2460310.5);
  });
});

describe("公历转回历（表格算法）", () => {
  it("返回绝对回历年（非 30 年周期序号），并与 Prophecy 对齐", () => {
    expect(公历转回历(2000, 1, 1)).toEqual({ 年: 1420, 月: 9, 日: 23 });
    expect(公历转回历(2024, 1, 1)).toEqual({ 年: 1445, 月: 6, 日: 18 });
    expect(公历转回历(2024, 2, 10)).toEqual({ 年: 1445, 月: 7, 日: 29 });
    expect(公历转回历(1900, 1, 1)).toEqual({ 年: 1317, 月: 8, 日: 27 });
    expect(公历转回历(2026, 2, 17)).toEqual({ 年: 1447, 月: 8, 日: 28 });
  });
});

describe("其他展示辅助", () => {
  it("朝代 / 星座 / 农历名称", () => {
    expect(朝代(2024)).toBe("中华人民共和国");
    expect(朝代(618)).toBe("唐朝");
    expect(星座(3, 21)).toBe("白羊");
    expect(星座(12, 25)).toBe("摩羯");
    expect(农历月名串(2024, 1, false)).toBe("正月");
    expect(农历日名串(1)).toBe("初一");
    expect(["大", "小"]).toContain(农历月大小(2024, 1, false));
  });
});

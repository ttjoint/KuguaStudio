/**
 * `divination` 模块的确定性测试。
 *
 * 大衍筮法是这个仓里**最容易悄悄算错**的一段：50 根蓍草分二、挂一、揲四、归奇，
 * 三轮才得一爻。任何一步写错，结果仍然是 6/7/8/9 之一——界面上看不出异常，
 * 只是卦象变得不再是「大衍」了。
 *
 * 所以这里测的是**不变量**而不是具体数值：单次摇卦由随机数决定，无法逐位对齐，
 * 但「只出现 6/7/8/9」「阴阳分布符合经典比例」这些条件只要算错就一定破。
 *
 * 变爻解读规则是确定性的：给定爻位序列，变爻个数直接决定用卦辞还是爻辞、
 * 以及取本卦还是之卦。这部分逐字对齐。
 */

import { describe, expect, it, vi } from "vitest";

// 蓍草卜筮 每次都要随机分二。测「不变量」时用真随机（数量足够即验证分布），
// 测「解读规则」时换成固定序列。
const 序列: number[] = [];
let 用序列 = false;
vi.mock("@kugua/random", () => ({
  NextInt: (max?: number) => {
    if (用序列) {
      const v = 序列.shift();
      if (v === undefined) throw new Error("随机序列用完了");
      return v % (max ?? 1);
    }
    // 真随机：NextInt(max) 语义是 [0, max)
    return Math.floor(Math.random() * (max ?? 1));
  },
}));

const { 蓍草卜筮, 周易占卜, 文王卦序 } = await import("../src/index.js");

/** 让占卜器摇出指定的六爻（不走蓍草，直接给结果） */
function 给定爻位(占卜: 周易占卜, 爻: number[]): void {
  (占卜 as unknown as { 卜者: { 卜卦: () => number[] } }).卜者 = { 卜卦: () => 爻 };
}

/** 全阳（老阳 9，六爻皆变） */
function 全阳(占卜: 周易占卜): void {
  给定爻位(占卜, [9, 9, 9, 9, 9, 9]);
}

describe("divination 大衍筮法", () => {
  it("每次卜卦得 6 爻", () => {
    const 爻 = new 蓍草卜筮().卜卦();
    expect(爻.length).toBe(6);
  });

  it("爻值只能是 6/7/8/9（老阴/少阳/少阴/老阳）", () => {
    const 出现 = new Set<number>();
    for (let i = 0; i < 300; i++) {
      for (const 爻 of new 蓍草卜筮().卜卦()) 出现.add(爻);
    }
    // 不在这个集合里就说明蓍草总数算错了
    expect([...出现].sort()).toEqual([6, 7, 8, 9]);
  });

  it("四个爻值都会出现（漏掉某个说明某条分支走不到）", () => {
    const 出现 = new Set<number>();
    for (let i = 0; i < 500; i++) {
      for (const 爻 of new 蓍草卜筮().卜卦()) 出现.add(爻);
    }
    for (const 期望 of [6, 7, 8, 9]) expect(出现.has(期望)).toBe(true);
  });

  it("阴阳比例符合大衍筮法：少阴 8 最多、少阳 7 次之、老阴 6 与老阳 9 最少", () => {
    // 经典概率约为 6:7:8:9 = 2:5:7:2（每爻）。这里只要求大小顺序，
    // 具体比例依赖取整实现，不逐位对齐。
    const 计数 = new Map<number, number>([
      [6, 0],
      [7, 0],
      [8, 0],
      [9, 0],
    ]);
    for (let i = 0; i < 4000; i++) {
      for (const 爻 of new 蓍草卜筮().卜卦()) 计数.set(爻, (计数.get(爻) ?? 0) + 1);
    }
    const 六 = 计数.get(6)!;
    const 七 = 计数.get(7)!;
    const 八 = 计数.get(8)!;
    const 九 = 计数.get(9)!;

    expect(八).toBeGreaterThan(七);
    expect(七).toBeGreaterThan(六);
    expect(七).toBeGreaterThan(九);
    // 老阴与老阳都很少：各自不到总数的 1/4
    const 总 = 六 + 七 + 八 + 九;
    expect(六 / 总).toBeLessThan(0.25);
    expect(九 / 总).toBeLessThan(0.25);
  });

  it("同一个实例连续卜卦，状态不会串到下一卦", () => {
    // 每爻开头都会把蓍草重置回 50；忘了重置就会越摇越少，最后算出负数或 NaN。
    // 连续摇 20 次，每次都必须仍然是 6/7/8/9。
    const 卜者 = new 蓍草卜筮();
    for (let i = 0; i < 20; i++) {
      for (const 爻 of 卜者.卜卦()) {
        expect([6, 7, 8, 9].includes(爻)).toBe(true);
      }
    }
  });
});

describe("divination 卦名与卦序", () => {
  it("文王卦序是 64 卦", () => {
    expect(文王卦序.length).toBe(64);
  });

  it("卦序无重复（重复会让 Unicode 卦象字符错位）", () => {
    expect(new Set(文王卦序).size).toBe(64);
  });

  it("卦序首尾是 乾 / 未济", () => {
    expect(文王卦序[0]).toBe("乾");
    expect(文王卦序[63]).toBe("未济");
  });
});

describe("divination 变爻解读规则", () => {
  /**
   * 造一个假占卜器：忽略蓍草，直接给定六爻。
   *
   * 解读规则是确定性的，而摇卦是随机的——把两者分开才能逐字对齐规则。
   * 这里直接替换私有字段（JS 里没有真私有），比 mock 随机序列更好读：
   * 序列要凑出「恰好 2 个变爻」得试很久，指定爻位一眼就明白。
   */
  function 给定爻(爻: number[]): 周易占卜 {
    const 占卜 = new 周易占卜();
    // 不初始化数据也能测规则本身：取卦名/取卦辞 在缺数据时返回空串，
    // 但「用几个变爻、取本卦还是之卦」的结构仍然可断言。
    (占卜 as unknown as { 卜者: { 卜卦: () => number[] } }).卜者 = { 卜卦: () => 爻 };
    return 占卜;
  }

  it("无变爻：不说「之」，爻位即本卦", () => {
    const 结果 = 给定爻([7, 8, 7, 8, 7, 8]).解读卦象(null);
    expect(结果.变卦).toBe(null);
    expect(结果.解读).toContain("卦不变");
    expect(结果.解读).not.toContain("之");
  });

  it("1 个变爻：说「之」，并列出该变爻", () => {
    // 第 3 爻（下标 2）是老阳 9 → 变
    const 结果 = 给定爻([7, 8, 9, 8, 7, 8]).解读卦象(null);
    expect(结果.变卦).not.toBe(null);
    expect(结果.解读).toContain("之");
    expect(结果.解读).toContain("变爻：");
    expect(结果.解读).toContain("九三");
  });

  it("2 个变爻：提示「变爻有二」并列出两个", () => {
    const 结果 = 给定爻([9, 8, 7, 8, 9, 8]).解读卦象(null);
    expect(结果.解读).toContain("变爻有二：");
    expect(结果.解读).toContain("初九");
    expect(结果.解读).toContain("九五");
  });

  it("3 个变爻：提示「变爻有三」", () => {
    const 结果 = 给定爻([9, 8, 9, 8, 9, 8]).解读卦象(null);
    expect(结果.解读).toContain("变爻有三：");
  });

  it("4 个变爻：提示「变爻有四」", () => {
    const 结果 = 给定爻([9, 9, 9, 9, 7, 8]).解读卦象(null);
    expect(结果.解读).toContain("变爻有四：");
  });

  it("5 个变爻：提示「变爻有五」", () => {
    const 结果 = 给定爻([9, 9, 9, 9, 9, 8]).解读卦象(null);
    expect(结果.解读).toContain("变爻有五：");
  });

  it("6 个变爻：提示「六爻皆变」", () => {
    const 结果 = 给定爻([9, 9, 9, 9, 9, 9]).解读卦象(null);
    expect(结果.解读).toContain("六爻皆变");
  });

  it("爻位原样返回（6 老阴、9 老阳都保留，不被归一成阴阳）", () => {
    const 输入 = [6, 7, 8, 9, 6, 7];
    expect(给定爻(输入).解读卦象(null).爻位).toEqual(输入);
  });

  it("阴爻的爻名是初六/六二…，阳爻是初九/九二…", () => {
    // 用「只有 1 个变爻」的数据：变爻有 3 个时走的是另一条分支
    // （只列卦辞、不列单个爻名），拿 3 变爻的数据断言爻名会误判。
    // 第 1 爻老阴 6 → 初六；第 2 爻老阳 9 → 九二
    expect(给定爻([6, 7, 7, 7, 7, 7]).解读卦象(null).解读).toContain("初六");
    expect(给定爻([7, 9, 7, 7, 7, 7]).解读卦象(null).解读).toContain("九二");
  });

  it("有缘由时解读以「问：…」开头，无缘由则不带", () => {
    expect(给定爻([7, 8, 7, 8, 7, 8]).解读卦象("今天运气如何").解读).toMatch(
      /^问：今天运气如何\n/,
    );
    expect(给定爻([7, 8, 7, 8, 7, 8]).解读卦象(null).解读.startsWith("问：")).toBe(false);
  });

  it("question 字段原样回传（null 时结果里也是 null）", () => {
    expect(给定爻([7, 8, 7, 8, 7, 8]).解读卦象(null).question).toBe(null);
    expect(给定爻([7, 8, 7, 8, 7, 8]).解读卦象("问个事").question).toBe("问个事");
  });
});

describe("divination 初始化数据", () => {
  it("加载真实数据后能取到卦名（含 Unicode 卦象字符）", async () => {
    const { 读模块资源 } = await import("@kugua/paths");
    const 占卜 = new 周易占卜();
    占卜.初始化(
      读模块资源(
        "file:///D:/Projects/KuguaStudio/packages/modules/divination/dist/index.js",
        "data_zhouyi.txt",
      ),
    );

    // 必须指定爻位：解读卦象 内部会摇卦，不指定就是随机的，
    // 上面那版写成「期望摇出乾」是错的（实测摇出过 既济、坎）。
    全阳(占卜);
    const 结果 = 占卜.解读卦象(null);
    // 全阳 = 乾（卦序第 1），Unicode 是 U+4DC0 ䷀
    expect(结果.本卦).toContain("䷀");
    expect(结果.本卦).toContain("乾");

    // 六爻全变后是 坤
    全阳(占卜);
    expect(占卜.解读卦象(null).变卦).toContain("坤");
  });

  it("取不到数据时不抛错，只是卦名为空", () => {
    const 占卜 = new 周易占卜();
    占卜.初始化("");
    全阳(占卜);
    const 结果 = 占卜.解读卦象(null);
    // 空数据下 取卦名 返回空串；不能因为缺数据就崩
    expect(结果.本卦).toBe("");
    expect(typeof 结果.解读).toBe("string");
  });
});

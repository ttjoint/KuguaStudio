/**
 * chatmode 生成算法测试。
 *
 * ## 为什么值得测
 *
 * 这些算法是从原项目（KuguaNT）逐行复刻的，里面有很多「看着像 bug」的写法：
 * `slice(0, -1)` 替换标点、`NextInt(0, n)` 闭区间、空结果兜底成 `" "`……
 * 那些都是**原作者的本意**。复刻类代码最怕的不是写错，而是「顺手修一修」——
 * 一修就跟原版不一样了。所以测试要把这些行为钉死，
 * 每条这类断言的注释里都写明「原版行为，不要改」。
 *
 * ## 随机源怎么打桩
 *
 * `NextInt(下, 上)` 双参是**闭区间** `[下, 上]`；`NextInt(n)` 单参是 `0..n-1`。
 * 打桩后：队列有值按顺序吐，队列空了回落到 0（两种形式下都合法）。
 * 每次调用记录 `[下, 上]`，用 `上 === undefined` 区分单参形式。
 *
 * 断言**调用形状**（而不是「喂第 5 个数得到什么」）是刻意的：
 * 后者改一行实现就全红，维护成本极高；前者只钉真正要保证的东西，
 * 比如「标点池用的是 13 项的 sgn3，而不是 8 项的 sgn2」。
 *
 * ## 三个必须记住的前提（写用例时最容易搞错）
 *
 * 1. 取词循环是 `while (thissentence.length < thislen && wordnum < maxwordnum)`。
 *    单字语料「甲」时，`thislen` 给 1 **会**进循环（`0 < 1`）；给 0 才不进。
 *    但 `thislen` 来自 `NextInt(1, maxslen)`，最小值是 1，所以永远至少进一次。
 * 2. 标点替换是**串行的两次**：先 `+= sgn1[NextInt(4)]`，
 *    再用 `slice(0,-1)` 砍掉它换成 `sgn2[NextInt(8)]`（或 sgn3）。
 *    所以一次「补标点」会消耗**两个**随机数。
 * 3. 只有「有新内容且末字不是标点」才走这条替换链；否则原样拼接。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

let 队列: number[] = [];
let 调用记录: Array<[number, number | undefined]> = [];

vi.mock("@kugua/random", () => ({
  NextInt: (下: number, 上?: number) => {
    调用记录.push([下, 上]);
    return 队列.length > 0 ? 队列.shift()! : 0;
  },
}));

const { 随机句, 混沌句, 情绪括弧, 小万邦句, 西医句, 喷人句, 生成 } = await import(
  "../src/generate.js"
);
import type { 模式, 语料 } from "../src/generate.js";

const CRLF = String.fromCharCode(13) + String.fromCharCode(10);

const 喂 = (...值: number[]): void => {
  队列 = 值;
};

beforeEach(() => {
  队列 = [];
  调用记录 = [];
});

const 空语料 = (): 语料 => ({
  chaosWord: [],
  chaosMotion: [],
  chaosXwb: [],
  bencao: [],
  xyDisease: [],
  xyDrugs: [],
  xyTreatment: [],
  penlist: [],
});

const 模式条 = (name: string, config: string[], sentences: string[]): 模式 => ({
  name,
  config,
  sentences,
});

const 甲 = (): 模式 => 模式条("m", [], ["甲"]);

/** 最后一次调用的「池子大小」 */
const 末池 = (): number => 调用记录[调用记录.length - 1][0];
/** 最后一次是否单参形式（池子大小类调用都是单参） */
const 末是单参 = (): boolean => 调用记录[调用记录.length - 1][1] === undefined;
/** 「取词」调用的次数：双参且下界为 0（单参标点调用下界是 8 或 13） */
const 取词数 = (): number => 调用记录.filter(([下, 上]) => 下 === 0 && 上 !== undefined).length;

describe("随机句：提前返回", () => {
  it("语料为空返回空串，且**不调用随机**", () => {
    喂();
    expect(随机句(模式条("m", [], []))).toBe("");
    expect(调用记录).toEqual([]);
  });
});

describe("随机句：基础路径", () => {
  it("调用顺序：句数 → 长度 → 取词 → sgn1 → sgn2", () => {
    喂(1, 2);
    随机句(甲());
    expect(调用记录[0]).toEqual([1, 5]); // 句数上界 5
    expect(调用记录[1]).toEqual([1, 7]); // 长度上界 7
    // 长度 2 + 单字语料 → 取词两次
    expect(调用记录[2]).toEqual([0, 0]);
    expect(调用记录[3]).toEqual([0, 0]);
    expect(调用记录[4]).toEqual([4, undefined]); // sgn1 补位
    expect(调用记录[5]).toEqual([8, undefined]); // sgn2 覆盖末位
  });

  it("产物是「甲甲」+ sgn2 首项", () => {
    喂(1, 2, 0, 0, 0, 0);
    expect(随机句(甲())).toBe("甲甲" + CRLF);
  });

  it("长度 2 + 单字语料 → 取 2 个词", () => {
    喂(1, 2);
    随机句(甲());
    expect(取词数()).toBe(2);
  });

  it("取词上界是 length-1（闭区间，传 length 会取到 undefined）", () => {
    喂(1, 7);
    随机句(模式条("m", [], ["甲", "乙", "丙"]));
    const 取词 = 调用记录.filter(([下, 上]) => 下 === 0 && 上 !== undefined);
    expect(取词.length).toBeGreaterThan(0);
    for (const [, 上] of 取词) expect(上).toBe(2);
  });

  it("词数封顶 maxwordnum=4", () => {
    喂(1, 99);
    随机句(甲());
    expect(取词数()).toBe(4);
  });

  it("字长够了也停（不必等到 4 个词）", () => {
    喂(1, 2);
    随机句(甲());
    expect(取词数()).toBe(2);
  });
});

describe("随机句：单句配置", () => {
  it("句数、长度、词数都压到 1", () => {
    喂(1, 1);
    随机句(模式条("m", ["单句"], ["甲"]));
    expect(调用记录[0]).toEqual([1, 1]);
    expect(调用记录[1]).toEqual([1, 1]);
    expect(取词数()).toBe(1);
  });
});

describe("随机句：句内不拼接", () => {
  it("句数上界仍是 5，但长度压到 1", () => {
    喂(1, 1);
    随机句(模式条("m", ["句内不拼接"], ["甲"]));
    expect(调用记录[0]).toEqual([1, 5]);
    expect(调用记录[1]).toEqual([1, 1]);
  });

  it("只取 1 个词", () => {
    喂(1, 1);
    随机句(模式条("m", ["句内不拼接"], ["甲"]));
    expect(取词数()).toBe(1);
  });
});

describe("随机句：无标点", () => {
  it("词之间用空格分隔，不出现中文标点", () => {
    喂(1, 99);
    const r = 随机句(模式条("m", ["无标点"], ["甲"]));
    expect(r).not.toMatch(/[，。？！；、]/);
    expect(r).toContain(" ");
  });

  it("**不调用任何标点池**（sgn1 / sgn2 / sgn3 都不调）", () => {
    喂(1, 99);
    随机句(模式条("m", ["无标点"], ["甲"]));
    const 标点调用 = 调用记录.filter(([下, 上]) => 上 === undefined && [4, 8, 13].includes(下));
    expect(标点调用).toEqual([]);
  });

  it("语料是空串时兜底给一个空格（不是空串）", () => {
    // 原版行为：result 为空白 → 给 " "。不要改。
    喂(1, 99);
    expect(随机句(模式条("m", ["无标点"], [""]))).toBe(" ");
  });
});

describe("随机句：标点池的选择", () => {
  it("默认用 sgn2（8 项）", () => {
    喂(1, 2, 0, 0, 0, 0);
    expect(随机句(甲())).toBe("甲甲" + CRLF); // sgn2[0] 就是 CRLF
    expect(末池()).toBe(8);
    expect(末是单参()).toBe(true);
  });

  it("乱打标点用 sgn3（13 项）", () => {
    喂(1, 2, 0, 0, 0, 0);
    随机句(模式条("m", ["乱打标点"], ["甲"]));
    expect(末池()).toBe(13);
    expect(末是单参()).toBe(true);
  });

  it("sgn2 下标 4 是「？」，7 是「——」", () => {
    喂(1, 2, 0, 0, 0, 4);
    expect(随机句(甲())).toBe("甲甲？");
    喂(1, 2, 0, 0, 0, 7);
    expect(随机句(甲())).toBe("甲甲——");
  });

  it("sgn3 下标 12 是「！！！」", () => {
    喂(1, 2, 0, 0, 0, 12);
    expect(随机句(模式条("m", ["乱打标点"], ["甲"]))).toBe("甲甲！！！");
  });

  it("sgn1 的 4 项先补位、随即被覆盖（所以一次补标点吃两个随机数）", () => {
    // sgn1 = [",", "，", "；", "、"]
    喂(1, 2, 0, 0, 1, 0);
    const r = 随机句(甲());
    expect(r).toBe("甲甲" + CRLF); // sgn1[1]="，" 被 sgn2[0]=CRLF 覆盖
    expect(调用记录.some(([下, 上]) => 下 === 4 && 上 === undefined)).toBe(true);
  });
});

describe("随机句：语料本身以标点结尾时不再补", () => {
  it("「甲，」结尾属于 sgn1 → 原样返回", () => {
    喂(1, 2);
    expect(随机句(模式条("m", [], ["甲，"]))).toBe("甲，");
  });

  it("「甲。」结尾属于 sgn2 → 原样返回", () => {
    喂(1, 2);
    expect(随机句(模式条("m", [], ["甲。"]))).toBe("甲。");
  });

  it("已有标点时**不调用**标点池", () => {
    喂(1, 2);
    随机句(模式条("m", [], ["甲，"]));
    expect(调用记录.filter(([下, 上]) => 上 === undefined && [4, 8, 13].includes(下))).toEqual([]);
  });

  it("「甲，」长度已够就停（长度比较的是拼接后的总长）", () => {
    // thislen=2，「甲，」长 2 → 拼一次就 2 < 2 为假 → 只取 1 个词
    喂(1, 2);
    expect(随机句(模式条("m", [], ["甲，"]))).toBe("甲，");
    expect(取词数()).toBe(1);
  });

  it("长度 3 时「甲，」要拼两次", () => {
    喂(1, 3);
    expect(随机句(模式条("m", [], ["甲，"]))).toBe("甲，甲，");
    expect(取词数()).toBe(2);
  });
});

describe("混沌句", () => {
  it("语料全空时不崩，只输出标点", () => {
    喂(1, 0);
    expect(typeof 混沌句(空语料())).toBe("string");
  });

  it("句数上界 6", () => {
    喂(1);
    混沌句({ ...空语料(), chaosXwb: ["甲"] });
    expect(调用记录[0]).toEqual([1, 6]);
  });

  it("长度上界 11（注意下界是 0，与随机句不同）", () => {
    喂(1);
    混沌句(空语料());
    expect(调用记录[1]).toEqual([0, 11]);
  });

  it("名词库阈值是 NextInt(0,100) > 80", () => {
    // 回落 0 → 不成立 → 走 chaosXwb
    喂(1, 1);
    expect(混沌句({ ...空语料(), chaosWord: [["名"]], chaosXwb: ["小"] })).not.toContain("名");
    // 81 → 成立 → 走 chaosWord
    喂(1, 1, 81);
    expect(混沌句({ ...空语料(), chaosWord: [["名"]], chaosXwb: ["小"] })).toContain("名");
  });

  it("概率调用是 NextInt(0, 100)", () => {
    喂(1, 1);
    混沌句({ ...空语料(), chaosXwb: ["甲"] });
    expect(调用记录[2]).toEqual([0, 100]);
  });

  it("每句末尾无条件补一个 sgn 标点", () => {
    // 长度 0 → 不取词 → 直接补标点
    喂(1, 0);
    混沌句(空语料());
    expect(末池()).toBe(13);
    expect(末是单参()).toBe(true);
  });

  it("每句词数封顶 5", () => {
    喂(1, 11);
    混沌句({ ...空语料(), chaosXwb: ["甲"] });
    // 长度 11 + 单字语料：wordnum < 5 封顶，所以取 5 个词。
    // 概率调用 NextInt(0, 100) 不算取词（上界是 100）。
    // 取词调用的形状是 NextInt(0, chaosXwb.length-1) = NextInt(0, 0)；
    // 要排除 NextInt(0,11)（长度）和 NextInt(0,100)（名词库概率）。
    const 取词 = 调用记录.filter(([下, 上]) => 下 === 0 && 上 === 0);
    expect(取词.length).toBe(5);
  });
});

describe("情绪括弧", () => {
  it("情绪词为空返回空串且**不抽随机**", () => {
    喂();
    expect(情绪括弧(空语料())).toBe("");
    expect(调用记录).toEqual([]);
  });

  it("概率调用是 NextInt(0, 100)", () => {
    喂(67, 0);
    情绪括弧({ ...空语料(), chaosMotion: ["悲"] });
    expect(调用记录[0]).toEqual([0, 100]);
  });

  it("> 66 输出带圆括号", () => {
    喂(67, 0);
    expect(情绪括弧({ ...空语料(), chaosMotion: ["悲"] })).toBe("(悲)");
  });

  it("正好 66 不输出（严格大于）", () => {
    喂(66);
    expect(情绪括弧({ ...空语料(), chaosMotion: ["悲"] })).toBe("");
  });

  it("不成立时**只调一次**随机（不再抽情绪词下标）", () => {
    喂(66);
    情绪括弧({ ...空语料(), chaosMotion: ["悲"] });
    expect(调用记录.length).toBe(1);
  });
});

describe("小万邦句", () => {
  it("语料为空返回空串且不抽随机", () => {
    喂();
    expect(小万邦句(空语料())).toBe("");
    expect(调用记录).toEqual([]);
  });

  it("句数、每句词数的上界都是 5", () => {
    喂(1, 1);
    小万邦句({ ...空语料(), chaosXwb: ["甲"] });
    expect(调用记录[0]).toEqual([1, 5]);
    expect(调用记录[1]).toEqual([1, 5]);
  });

  it("句间用「，」，句末取「。？!」之一", () => {
    // snum=3、每句 1 词 → 中间两个「，」，句末 NextInt(3)
    喂(3, 1, 0, 1, 0, 1, 0, 2);
    expect(小万邦句({ ...空语料(), chaosXwb: ["甲"] })).toBe("甲，甲，甲!");
  });

  it("句末标点用单参 NextInt(3)", () => {
    喂(1, 1);
    小万邦句({ ...空语料(), chaosXwb: ["甲"] });
    expect(末池()).toBe(3);
    expect(末是单参()).toBe(true);
  });

  it("取词是单参 NextInt(length)（与小万邦句外层的双参不同）", () => {
    喂(1, 1);
    小万邦句({ ...空语料(), chaosXwb: ["甲", "乙"] });
    const 取词 = 调用记录.filter(([下, 上]) => 下 === 2 && 上 === undefined);
    expect(取词.length).toBeGreaterThan(0);
  });

  it("单句累加长度超过 15 就提前断", () => {
    const 长 = "一二三四五六七八九十"; // 10 字
    // snum=1、wnum=5：拼满两个 10 字词就 20 > 15 → break
    喂(1, 5);
    const r = 小万邦句({ ...空语料(), chaosXwb: [长] });
    expect(r.slice(0, -1)).toBe(长 + 长);
  });
});

describe("西医句", () => {
  it("固定句式", () => {
    // 三段各 1 条 → 索引取 0
    喂(1, 0, 1, 0, 1, 0);
    const r = 西医句({
      ...空语料(),
      xyDisease: ["感冒"],
      xyDrugs: ["阿司匹林"],
      xyTreatment: ["血常规"],
    });
    expect(r).toBe("查了下血常规，怀疑你得了感冒，建议吃阿司匹林，祝你早日康复！");
  });

  it("三段的条数都是 NextInt(1,4)", () => {
    // 每类 2 条语料 → 索引调用是单参 NextInt(2)，下界不会是 1；
    // 这样「下界 = 1 的双参调用」就只剩三段条数。
    喂(1, 0, 1, 0, 1, 0);
    西医句({
      ...空语料(),
      xyDisease: ["a", "b"],
      xyDrugs: ["c", "d"],
      xyTreatment: ["e", "f"],
    });
    expect(调用记录.filter(([下, 上]) => 下 === 1 && 上 !== undefined).map(([, 上]) => 上)).toEqual([
      4, 4, 4,
    ]);
  });

  it("语料为空时句子里出现 undefined（原版行为，不要改）", () => {
    // 原版没做空判断。这里钉住现状，避免将来「顺手修」时无人察觉。
    // 这不是好行为，但复刻类代码以「与原版一致」优先。
    喂(1, 0, 1, 0, 1, 0);
    expect(西医句(空语料())).toContain("undefined");
  });
});

describe("喷人句", () => {
  it("语料为空返回空串且不抽随机", () => {
    喂();
    expect(喷人句(空语料())).toBe("");
    expect(调用记录).toEqual([]);
  });

  it("句数是 NextInt(2,10)", () => {
    喂(2);
    喷人句({ ...空语料(), penlist: ["骂"] });
    expect(调用记录[0]).toEqual([2, 10]);
  });

  it("多句用换行连接", () => {
    喂(3);
    expect(喷人句({ ...空语料(), penlist: ["骂"] })).toBe("骂\n骂\n骂");
  });

  it("每句都 trim", () => {
    喂(2);
    expect(喷人句({ ...空语料(), penlist: ["  骂  "] })).toBe("骂\n骂");
  });

  it("取词是单参 NextInt(length)", () => {
    喂(2);
    喷人句({ ...空语料(), penlist: ["骂"] });
    expect(末池()).toBe(1);
    expect(末是单参()).toBe(true);
  });
});

describe("生成：分发", () => {
  const 表 = new Map<string, 模式>([
    ["混沌", 模式条("混沌", [], [])],
    ["小万邦", 模式条("小万邦", [], [])],
    ["本草", 模式条("本草", [], [])],
    ["西医", 模式条("西医", [], [])],
    ["喷人", 模式条("喷人", [], [])],
    ["宋词", 模式条("宋词", [], ["月"])],
  ]);

  it("未知模式抛错并带模式名", () => {
    expect(() => 生成("不存在", 表, 空语料())).toThrow(/未知模式/);
    expect(() => 生成("不存在", 表, 空语料())).toThrow(/不存在/);
  });

  it("混沌 = 混沌句 + 情绪括弧", () => {
    // 混沌句最少产物是一个标点，后面再接情绪括弧
    喂(1, 0, 0, 99, 0);
    expect(生成("混沌", 表, { ...空语料(), chaosMotion: ["悲"] })).toBe(CRLF + "(悲)");
  });

  it("小万邦 走小万邦句", () => {
    // snum=1、wnum=1、取词 0、句末标点 0 → 「。？」
    喂(1, 1, 0, 0);
    expect(生成("小万邦", 表, { ...空语料(), chaosXwb: ["甲"] })).toBe("甲。");
  });

  it("本草 是随机一行原样返回（不加标点）", () => {
    喂(0);
    expect(生成("本草", 表, { ...空语料(), bencao: ["甘草"] })).toBe("甘草");
    expect(调用记录[0][0]).toBe(1); // bencao.length
    expect(调用记录[0][1]).toBeUndefined(); // 单参形式
  });

  it("本草语料为空返回空串且不抽随机", () => {
    喂();
    expect(生成("本草", 表, 空语料())).toBe("");
    expect(调用记录).toEqual([]);
  });

  it("喷人 走喷人句", () => {
    喂(2);
    expect(生成("喷人", 表, { ...空语料(), penlist: ["骂"] })).toBe("骂\n骂");
  });

  it("中医/宋词等未特判的模式走随机句", () => {
    // 这里用模式表里存在的「宋词」，语料给「月」
    喂(1, 2, 0, 0, 0, 0);
    expect(生成("宋词", 表, 空语料())).toBe("月月" + CRLF);
  });
});

describe("不变量：任何配置 × 任何语料都不抛错", () => {
  const 配置们 = [
    [] as string[],
    ["单句"],
    ["句内不拼接"],
    ["无标点"],
    ["乱打标点"],
    ["单句", "无标点"],
    ["句内不拼接", "乱打标点"],
    ["单句", "句内不拼接", "无标点", "乱打标点"],
  ];
  const 语料们 = [
    [] as string[],
    [""],
    ["甲"],
    ["甲", "乙", "丙"],
    ["甲，"],
    ["甲。"],
    ["a b c"],
  ];

  it("全部组合都返回字符串", () => {
    for (const 配置 of 配置们) {
      for (const sentences of 语料们) {
        const 标签 = `${JSON.stringify(配置)} / ${JSON.stringify(sentences)}`;
        let r: string | undefined;
        try {
          r = 随机句(模式条("m", 配置, sentences));
        } catch (e) {
          throw new Error(`${标签} 抛错：${String(e)}`);
        }
        expect(typeof r, 标签).toBe("string");
      }
    }
  });

  it("循环一定终止（随机回落 0 也不会卡死）", () => {
    // 队列一直回落 0。若循环终止条件依赖「抽到某特定值」就会死循环。
    // 能跑完这条本身就说明终止只依赖 wordnum 与长度比较。
    for (const 配置 of 配置们) {
      随机句(模式条("m", 配置, ["甲", "乙"]));
      expect(调用记录.length).toBeGreaterThan(0);
    }
  });

  it("有语料时产物一定非空", () => {
    for (const 配置 of 配置们) {
      const r = 随机句(模式条("m", 配置, ["甲"]));
      expect(r.length, JSON.stringify(配置)).toBeGreaterThan(0);
    }
  });
});

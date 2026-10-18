/**
 * `nlp` 模块（谐音）的测试。
 *
 * 参考实现是 `ModNLP` + `ViterbiModel.cs`。这里测两类东西：
 *
 *  1. **纯函数**：`单字拼音` 的变形规则（i→y、u→w、v→w）和 `拼音首字母串`
 *     的取首字母规则。这两条决定了「喂进去的字串对不对」，错一位后面全错，
 *     而且结果仍然是一句看似正常的中文——最难发现。
 *
 *  2. **ViterbiModel 的边界**：空串、纯符号、未训练。这几个分支一旦抛错，
 *     整个 nlp 能力就挂了；而正常路径要训练数据才有意义，不适合单测。
 *
 * 训练数据的完整往返（拼音 → 汉字）不在这里测：它依赖 40MB 级别的模型文件，
 * 且 `@kugua/random` 在转移/发射时乘随机扰动，同一输入不保证同一输出。
 */

import { describe, expect, it, vi } from "vitest";
import { ViterbiModel } from "../src/viterbi.js";

vi.mock("@kugua/random", () => ({
  NextInt: (max?: number) => Math.floor(Math.random() * (max ?? 1)),
}));

const { 初始化拼音表, 单字拼音, 拼音首字母串 } = await import("../src/index.js");

// 拼音表是数据文件，测试前加载一次
初始化拼音表();

describe("nlp 单字拼音", () => {
  it("常用汉字取到完整拼音（带声调数字与多音逗号，原样返回）", () => {
    // 数据来自 pinyin_unicode.txt（按 Unicode 码位索引），格式是
    // 「ni3,」这种带声调数字的写法，多音字用逗号分隔。这里不裁剪——
    // 只有首字母会被用到，裁剪反而会改变与原实现的差异。
    expect(单字拼音("你").startsWith("ni")).toBe(true);
    expect(单字拼音("好").startsWith("hao")).toBe(true);
    // 首字母就是我们真正关心的
    expect(单字拼音("你")[0]).toBe("n");
    expect(单字拼音("好")[0]).toBe("h");
  });

  it("小写字母按 i→y、u→w、v→w 变形（复刻 ModNLP）", () => {
    // 这是刻意的：原实现用这三个变形模拟拼音输入法的键位
    expect(单字拼音("i")).toBe("y");
    expect(单字拼音("u")).toBe("w");
    expect(单字拼音("v")).toBe("w");
    expect(单字拼音("a")).toBe("a");
  });

  it("大写字母先转小写再变形", () => {
    expect(单字拼音("I")).toBe("y");
    expect(单字拼音("U")).toBe("w");
    expect(单字拼音("V")).toBe("w");
    expect(单字拼音("A")).toBe("a");
  });

  it("非汉字非字母返回空串（数字、标点、emoji）", () => {
    expect(单字拼音("1")).toBe("");
    expect(单字拼音("，")).toBe("");
    expect(单字拼音("😀")).toBe("");
    expect(单字拼音(" ")).toBe("");
  });
});

describe("nlp 拼音首字母串", () => {
  it("汉字取拼音首字母", () => {
    expect(拼音首字母串("你好")).toBe("nh");
  });

  it("非汉语字符原样保留（标点、数字、空格）", () => {
    // 这些字符要留在串里，Viterbi 才能知道哪里断句
    expect(拼音首字母串("你好，世界")).toBe("nh，sj");
    expect(拼音首字母串("abc")).toBe("abc");
    expect(拼音首字母串("1 2")).toBe("1 2");
  });

  it("空串返回空串", () => {
    expect(拼音首字母串("")).toBe("");
  });

  it("全是非汉语字符时原样返回", () => {
    expect(拼音首字母串("！！")).toBe("！！");
  });
});

describe("nlp ViterbiModel 边界", () => {
  const 模型 = new ViterbiModel({ 单字拼音: (c) => 单字拼音(c) });

  it("空串返回空串，不抛错", () => {
    expect(模型.GetSamePinyinSentnse("")).toBe("");
  });

  it("纯空白返回空串", () => {
    expect(模型.GetSamePinyinSentnse("   ")).toBe("");
  });

  it("未训练时输入非字母，原样返回（不打挂）", () => {
    // 没 LoadModel 就没有状态；此时不该抛错，只该把非字母部分原样带出
    expect(模型.GetSamePinyinSentnse("123")).toBe("123");
    expect(模型.GetSamePinyinSentnse("，。")).toBe("，。");
  });

  it("非字母部分原样保留、字母部分被替换", () => {
    // 未训练 → 字母段推不出字，结果里字母段为空；标点仍在原位
    const 结果 = 模型.GetSamePinyinSentnse("a，b");
    expect(结果).toContain("，");
  });

  it("LoadModel 指向不存在的文件返回 false，不抛错", () => {
    const 空模型 = new ViterbiModel({ 单字拼音: (c) => 单字拼音(c) });
    expect(空模型.LoadModel("D:/definitely/not/here.txt")).toBe(false);
  });
});

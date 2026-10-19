/**
 * translate 模块的纯函数测试。
 *
 * ## 为什么这个模块值得测
 *
 * 它整条链路是「抓 Google 网页 → 正则抠出译文 → 解码实体」。
 * 三个环节全都**失败得静默**：
 *
 * - `翻译单次` 拿不到 200 就 `return ""`
 * - `解析译文` 找不到容器就 `return null`
 * - 最终 `翻译文本` 拿空串当「没译出来」，回退成原文
 *
 * 所以上游一改版，用户看到的是「翻译结果和原文一模一样」，
 * 而不是报错。没有测试的话，这类退化只能靠人肉发现。
 *
 * 这里把**当前实际行为**连同它的边界都钉住——包括几个看起来
 * 奇怪但确实存在的接缝（见各用例注释）。
 */

import { describe, expect, it } from "vitest";
import { 切块, 解析译文, 解码HTML实体, 语言显示名 } from "../src/parse.js";

describe("解码HTML实体", () => {
  it("六个常见实体都能解开", () => {
    expect(解码HTML实体("a &amp; b")).toBe("a & b");
    expect(解码HTML实体("&lt;div&gt;")).toBe("<div>");
    expect(解码HTML实体("&quot;hi&quot;")).toBe('"hi"');
    expect(解码HTML实体("it&#39;s")).toBe("it's");
    expect(解码HTML实体("a&nbsp;b")).toBe("a b");
  });

  it("多个实体一次全解", () => {
    expect(解码HTML实体("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;")).toBe(
      '<a href="x">&</a>',
    );
  });

  it("普通文本原样返回", () => {
    expect(解码HTML实体("你好，world")).toBe("你好，world");
  });

  it("只认列表里那几个，其余实体不解", () => {
    // 这是当前行为，不是缺陷：Google 的 result-container 里基本只出现这几个。
    // 但如果哪天出现了 &#x4F60;（十六进制），会原样漏出来——
    // 这条断言是为了那时候有人能立刻看到。
    expect(解码HTML实体("&#x4F60;")).toBe("&#x4F60;");
    expect(解码HTML实体("&copy;")).toBe("&copy;");
  });

  it("空串返回空串", () => {
    expect(解码HTML实体("")).toBe("");
  });

  it("按替换链顺序解，会连锁命中（&amp;lt; 最终变 <）", () => {
    // 不是「一层一层解」，而是**链式 replace 相互影响**：
    // 第 1 步 &amp; → & 把 "&amp;lt;" 变成 "&lt;"，
    // 第 2 步 &lt; → < 再把它变成 "<"。
    //
    // 浏览器解析 HTML 实体是**一次扫描**，不会连锁；
    // 所以这里与浏览器行为**不同**。实际影响很小（译文里几乎不会
    // 出现双重转义），但如果哪天要严格对齐，改法是在一次扫描里
    // 用正则 + 查表替换，而不是链式 replace。钉住当前行为。
    expect(解码HTML实体("&amp;lt;")).toBe("<");
    // &amp;amp; → 第一步把开头的 &amp; 换成 & → 得到 "&amp;"，
    // 而 &amp; 这条 replace 已经跑过了，不会再命中一次 → 停在 "&amp;"。
    expect(解码HTML实体("&amp;amp;")).toBe("&amp;");
  });
});

describe("解析译文", () => {
  /** 造一段 Google 移动版翻译页的结构（简化） */
  const 页面 = (内容: string) =>
    `<html><body><div class="tlid-result"><div class="result-container">${内容}</div></div></body></html>`;

  it("抠出 result-container 的内容", () => {
    expect(解析译文(页面("Hello, world"))).toBe("Hello, world");
  });

  it("内容里有中文也照抠", () => {
    expect(解析译文(页面("你好，世界"))).toBe("你好，世界");
  });

  it("内容里有 HTML 实体时原样返回，交给解码那一步", () => {
    // 两步分开是刻意的：解析管「抠出来」，解码管「还原」。
    // 合在一起就测不出到底哪一步坏了。
    expect(解析译文(页面("a &amp; b"))).toBe("a &amp; b");
  });

  it("找不到容器返回 null 而不是空串", () => {
    // null 和 "" 必须能区分：
    // - null：上游改版了，容器没了
    // - ""：容器在但里面是空的（可能原文就是空）
    // 调用方目前都当空处理，但将来要加告警时只能靠这个区分。
    expect(解析译文("<html><body>没有那个 div</body></html>")).toBeNull();
  });

  it("空字符串返回 null", () => {
    expect(解析译文("")).toBeNull();
  });

  it("内容为空时返回空串而不是 null", () => {
    expect(解析译文(页面(""))).toBe("");
  });

  it("只取第一个 result-container", () => {
    const 两个 =
      '<div class="result-container">第一</div><div class="result-container">第二</div>';
    expect(解析译文(两个)).toBe("第一");
  });

  it("内容里嵌套 div 时会在第一个 </div> 处截断", () => {
    // 这是当前正则的已知局限（非贪婪匹配到最近的 </div>）。
    // Google 的容器里一般不带嵌套 div，所以现实中没出过问题。
    // 但如果哪天译文里带回了 HTML，这里会截断——钉住是为了变化时可见。
    const 嵌套 = '<div class="result-container">a<div>b</div>c</div>';
    expect(解析译文(嵌套)).toBe("a<div>b");
  });

  it("class 前面有别的不带引号的属性时能认", () => {
    // 正则里的 `[^"]*?` 明确排除了引号，所以 `id="x"` 这种会匹配失败。
    // Google 实际的移动版页面里 result-container 是第一个属性，所以能用。
    expect(解析译文("<div data-x=1 class=\"result-container\">ok</div>")).toBe("ok");
  });

  it("class 前面带引号的属性就抠不到（已知局限）", () => {
    // 这是当前正则的硬限制。真要修就改成解析属性而不是正则，
    // 但那样代码量会翻几倍——Google 页面结构一日不变，先不动。
    // 钉住它，是为了将来页面改版时能立刻看出是这里的问题。
    expect(解析译文('<div id="x" class="result-container">ok</div>')).toBeNull();
  });

  it("跨行内容能抠到", () => {
    expect(解析译文('<div class="result-container">第一行\n第二行</div>')).toBe("第一行\n第二行");
  });
});

describe("语言显示名", () => {
  it("去掉「语」结尾", () => {
    expect(语言显示名("日语")).toBe("日");
    expect(语言显示名("法语")).toBe("法");
  });

  it("不带「语」的原样返回", () => {
    expect(语言显示名("中")).toBe("中");
    expect(语言显示名("zh-CN")).toBe("zh-CN");
  });

  it("只去掉最后一个「语」，中间的不动", () => {
    // 语言表里有「巴布亚皮钦语」这种，取完就是「巴布亚皮钦」。
    expect(语言显示名("巴布亚皮钦语")).toBe("巴布亚皮钦");
  });

  it("单个「语」字会变成空串", () => {
    // 边界：名就叫「语」时结果是 ""，拼进「译X」就成了「译」。
    // 语言表里没有这种名字，但函数本身不设防——钉住当前行为。
    expect(语言显示名("语")).toBe("");
  });

  it("空串返回空串", () => {
    expect(语言显示名("")).toBe("");
  });
});

describe("切块", () => {
  it("单行短文本就是一块", () => {
    expect(切块("你好")).toEqual([{ 行: "你好", 块: ["你好"] }]);
  });

  it("按行切开", () => {
    expect(切块("第一行\n第二行")).toEqual([
      { 行: "第一行", 块: ["第一行"] },
      { 行: "第二行", 块: ["第二行"] },
    ]);
  });

  it("\\r\\n 也认", () => {
    expect(切块("甲\r\n乙").map((x) => x.行)).toEqual(["甲", "乙"]);
  });

  it("空行被丢掉（不是保留成空块）", () => {
    // 这是当前行为。注意它意味着**原文的空行结构会丢**——
    // 译文里不会有空行分隔。要改的话得连着 翻译文本 的拼接口径一起改。
    expect(切块("甲\n\n乙").map((x) => x.行)).toEqual(["甲", "乙"]);
    expect(切块("\n\n\n").length).toBe(0);
  });

  it("每行两端空白被 trim 掉", () => {
    expect(切块("  甲  \n\t乙\t").map((x) => x.行)).toEqual(["甲", "乙"]);
  });

  it("超长行按 100 字符切", () => {
    const 长 = "a".repeat(250);
    const { 块 } = 切块(长)[0];
    expect(块.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(块.join("")).toBe(长);
  });

  it("恰好 100 字符时只有一块", () => {
    expect(切块("a".repeat(100))[0].块.length).toBe(1);
  });

  it("101 字符切成两块", () => {
    expect(切块("a".repeat(101))[0].块.map((b) => b.length)).toEqual([100, 1]);
  });

  it("每块长度可调", () => {
    expect(切块("abcdef", 2)[0].块).toEqual(["ab", "cd", "ef"]);
  });

  it("中文按字符数切，不是按字节", () => {
    // 100 个汉字切一块，不能因为 UTF-8 是三字节就切成 33 个字。
    const 中文 = "好".repeat(150);
    expect(切块(中文)[0].块.map((b) => b.length)).toEqual([100, 50]);
  });

  it("空串得到空数组", () => {
    expect(切块("")).toEqual([]);
  });

  it("每行都是自己的块组，不会跨行合并", () => {
    const r = 切块("甲".repeat(150) + "\n乙");
    expect(r.length).toBe(2);
    expect(r[0].块.length).toBe(2);
    expect(r[1].块).toEqual(["乙"]);
  });
});

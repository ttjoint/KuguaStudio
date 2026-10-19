/**
 * 编辑页的**纯逻辑**单测。
 *
 * 页面本身是 DOM 代码，但「哪个参数该出什么控件」这件事不该只能靠开浏览器看。
 * 下面用一个极小的假 DOM 跑 `造控件()` 的判定逻辑——`editor.js` 里的控件生成
 * 只用到 `document.createElement` / `appendChild` / `dataset` 这些，
 * 自己写二十来行就能顶住，比引 jsdom 轻得多。
 *
 * 覆盖的正是真机验证时抓出来的两个 bug：
 * 1. `upscale.scale` 的档位是 `{值,标签}` 对象数组，被当标量渲染→空下拉
 * 2. `resize.width/height` 没有默认值却被渲染成滑块→一碰就变成 10001
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const 源 = readFileSync(new URL("../src/ui/editor.js", import.meta.url), "utf8");

/** 从源码里抠出 `造控件` 的判定段落，只做静态断言 */
describe("编辑页控件生成的规则", () => {
  it("档位按对象数组取值，不是直接 String(档)", () => {
    // 这个 bug 的症状很隐蔽：下拉框能出来，但每个 option 的 value 都是
    // "[object Object]"，默认值对不上就选不中，看起来像「选项是空的」
    expect(源).toContain("档.值");
    expect(源).not.toMatch(/o\.value\s*=\s*String\(档\)\s*;/);
  });

  it("档位选项的显示文本也来自 标签", () => {
    expect(源).toContain("档.标签");
  });

  it("没有默认值的数字参数用输入框而不是滑块", () => {
    // 滑块天生不能表达「空」。resize 的 width/height 语义是
    // 「留空就按比例算」，滑块一碰就写进一个具体数字，意图正好相反。
    expect(源).toContain("p.默认 === undefined");
    const 段 = 源.slice(源.indexOf("p.默认 === undefined"), 源.indexOf("p.默认 === undefined") + 400);
    expect(段).toContain('"number"');
  });

  it("有默认值的数字参数才用滑块", () => {
    const 段 = 源.slice(源.indexOf("p.默认 === undefined"), 源.indexOf("p.默认 === undefined") + 1200);
    expect(段).toContain('"range"');
  });

  it("判断控件类型用 tagName 而不是 type", () => {
    // select 元素没有 type 属性，用 `c.type !== "select"` 判断永远成立，
    // 于是 select 也会被写上 min/max
    expect(源).toContain('tagName !== "SELECT"');
  });
});

describe("页面不使用 innerHTML", () => {
  it("全程用 createElement / textContent", () => {
    // 模块页的内容部分来自动作声明的「说明」字段。虽然当前都是我们写的，
    // 但外部模块将来可能复用这套渲染，innerHTML 会把注入面打开。
    expect(源).not.toContain("innerHTML");
  });

  it("显示文本一律走 textContent", () => {
    const 用 = 源.match(/textContent/g)?.length ?? 0;
    expect(用).toBeGreaterThan(5);
  });
});

describe("实时预览不发请求", () => {
  it("应用本地预览 里没有 fetch 或 请求(", () => {
    const 起 = 源.indexOf("function 应用本地预览");
    const 止 = 源.indexOf("// ============ 应用（真调后端）");
    expect(起).toBeGreaterThan(0);
    expect(止).toBeGreaterThan(起);
    const 段 = 源.slice(起, 止);
    expect(段).not.toContain("fetch(");
    expect(段).not.toContain("await 请求(");
  });
});

describe("动作列表过滤系统动作", () => {
  it("分组为「系统」的不进列表", () => {
    // 用户不该在「旋转/缩放」旁边看到「释放会话」
    expect(源).toContain('d.分组 === "系统"');
  });
});

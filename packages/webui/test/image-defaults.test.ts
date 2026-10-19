/**
 * 聊天框的图片指令默认值，必须和模块的声明表一致。
 *
 * ## 这条测试防的是什么
 *
 * 图片动作的默认值只有一份真相：`packages/modules/image/src/actions.ts`
 * 的 `动作声明表`。但聊天框的路由器是**同步纯函数**——它得在
 * `if (/^旋转/.test(文本)) return 需图("image.rotate", { degrees: ? })`
 * 里立刻给出结果，没法 await 一个模块请求去拿声明表。
 *
 * 所以有一份由声明表**生成**的常量（`image-defaults.ts`）。
 * 生成物最大的风险是**忘了重新生成**：改了声明表、跑测试、全绿，
 * 因为测试读的就是那份旧常量。
 *
 * 这里直接比对两边：生成物 vs 当前声明表。不一致就红，并提示重新生成。
 */

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { 图片动作默认值 } from "../src/renderer/image-defaults.js";

const 路由源 = readFileSync(new URL("../src/renderer/parts/04-router.ts", import.meta.url), "utf8");

let 动作声明表: {
  动作: string;
  参数?: { 键: string; 默认?: unknown; 界面默认?: unknown }[];
}[];

beforeAll(async () => {
  // 声明表在模块的构建产物里。没构建过就跳过一整块，
  // 但**不能**改成「读失败就当作通过」——那样等于测试不存在。
  const 路径 = "../../modules/image/dist/actions.js";
  动作声明表 = (await import(路径)).动作声明表;
});

/** 与生成脚本完全一致的取值规则 */
function 应有默认值(): Record<string, Record<string, unknown>> {
  const 表: Record<string, Record<string, unknown>> = {};
  for (const d of 动作声明表) {
    const 项: Record<string, unknown> = {};
    for (const p of d.参数 ?? []) {
      const 值 = p.界面默认 !== undefined ? p.界面默认 : p.默认;
      if (值 !== undefined) 项[p.键] = 值;
    }
    if (Object.keys(项).length) 表[d.动作] = 项;
  }
  return 表;
}

describe("image-defaults.ts 与声明表一致", () => {
  it("动作集合完全相同", () => {
    const 生成 = Object.keys(图片动作默认值).sort();
    const 应有 = Object.keys(应有默认值()).sort();
    expect(生成).toEqual(应有);
  });

  it("每个动作的每个参数默认值都相同", () => {
    // 逐项断言而不是整对象比：整对象比失败时的 diff 太长，
    // 而且看不出到底是哪个动作的哪个参数搬错了
    const 应有 = 应有默认值();
    for (const 动作 of Object.keys(应有)) {
      for (const 键 of Object.keys(应有[动作])) {
        expect(
          图片动作默认值[动作]?.[键],
          `${动作}.${键} 与声明表不一致——请跑 npm run gen:image-defaults`,
        ).toEqual(应有[动作][键]);
      }
    }
  });

  it("生成物没多出声明表里没有的参数", () => {
    const 应有 = 应有默认值();
    for (const 动作 of Object.keys(图片动作默认值)) {
      for (const 键 of Object.keys(图片动作默认值[动作])) {
        expect(应有[动作]?.[键], `${动作}.${键} 在声明表里不存在`).not.toBeUndefined();
      }
    }
  });
});

describe("几个关键的默认值", () => {
  it("rotate 取界面默认 90，不是协议默认 0", () => {
    // 这是「界面默认 vs 协议默认」这组区分存在的理由。
    // 聊天框里输入「旋转」不带度数，用户要的是转 90 度，
    // 不是「转 0 度」这个什么都没做的操作。
    expect(图片动作默认值.rotate.degrees).toBe(90);
  });

  it("colorSample 的 size 是 80", () => {
    expect(图片动作默认值.colorSample.size).toBe(80);
  });

  it("grid 的 scale 是 2", () => {
    expect(图片动作默认值.grid.scale).toBe(2);
  });

  it("randomPixel 的 size 是 100", () => {
    expect(图片动作默认值.randomPixel.size).toBe(100);
  });
});

describe("路由器不再硬编码图片默认值", () => {
  const 源 = 路由源;

  it("图默认 从生成常量取值", () => {
    const 纯 = readFileSync(new URL("../src/renderer/image-command-defaults.ts", import.meta.url), "utf8");
    expect(纯).toContain("图片动作默认值[动作]");
  });

  it("rotate 的度数不再写字面量 90", () => {
    // 只查 image.* 那些行，别误伤别的模块
    const 命中 = 源.split(/\r?\n/).filter((l) => l.includes("image.rotate"));
    expect(命中.length).toBeGreaterThan(0);
    for (const 行 of 命中) expect(行).not.toMatch(/:\s*90\b/);
  });

  it("upscale / grid / randomPixel / colorSample 都走了 图默认", () => {
    for (const 片段 of ['图默认("upscale", "scale")', '图默认("grid", "scale")', '图默认("randomPixel", "size")', '图默认("colorSample", "size")']) {
      expect(源).toContain(片段);
    }
  });
});

describe("图默认() 的取值", () => {
  // 路由器本体依赖 DOM（顶层 import 了 02-chat-core 等），Node 里 import 不进来。
  // 所以真正的取值逻辑抽到 image-command-defaults.ts，这里测它。
  it("取到声明表里的值", async () => {
    const { 图默认 } = await import("../src/renderer/image-command-defaults.js");
    expect(图默认("rotate", "degrees")).toBe(90);
    expect(图默认("grid", "scale")).toBe(2);
    expect(图默认("colorSample", "size")).toBe(80);
    expect(图默认("colorSample", "color")).toBe("#000000");
    expect(图默认("randomPixel", "size")).toBe(100);
    expect(图默认("mirror", "mode")).toBe(1);
    expect(图默认("upscale", "scale")).toBe(4);
  });

  it("声明表里没有的键返回兜底值，不返回 undefined", async () => {
    // 返回 undefined 会让调用方拿到 { degrees: undefined }，
    // 序列化成 JSON 时这个键直接消失，模块看到的是「没传」而不是「传了 0」
    const { 图默认 } = await import("../src/renderer/image-command-defaults.js");
    expect(图默认("rotate", "不存在")).toBe(0);
    expect(图默认("不存在", "x", 7)).toBe(7);
  });

  it("类型原样保留（别把 false 变 0）", async () => {
    // cut.percent 默认 false。如果实现里写成 `值 || 兜底`，
    // false 会被当成假值换成兜底值，语义就反了
    const { 图默认 } = await import("../src/renderer/image-command-defaults.js");
    expect(图默认("cut", "percent", true)).toBe(false);
  });

  it("字符串默认值不被当成数字", async () => {
    const { 图默认 } = await import("../src/renderer/image-command-defaults.js");
    expect(typeof 图默认("colorSample", "color")).toBe("string");
  });
});

describe("路由器接的是共享函数", () => {
  it("从 image-command-defaults 导入", () => {
    expect(路由源).toContain(`from "../image-command-defaults"`);
  });

  it("自己不再定义一份", () => {
    expect(路由源).not.toMatch(/const 图默认s*=/);
  });
});

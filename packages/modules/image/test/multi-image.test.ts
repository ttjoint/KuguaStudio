/**
 * 多图参数的路径 ↔ base64 转换。
 *
 * 这条链路断得不声不响：`Buffer.from("D:\\x\\a.png", "base64")` 不抛异常，
 * 返回一堆垃圾字节，ImageMagick 照样能把垃圾当图处理完，最后给用户一张
 * 尺寸离谱的图——两张 200x150 纵向拼接本该 200x300，实际得到 600x400。
 *
 * 所以这里既测纯函数，也测注册层真的接上了（第 3 步的教训：只测纯函数时，
 * 把端点里的调用删掉测试照样全绿）。
 */

import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { 补多图 } from "../dist/index.js";

let 目录: string;
let 图路径: string;
let 图base64: string;

beforeAll(() => {
  目录 = mkdtempSync(join(tmpdir(), "kugua-multi-"));
  图路径 = join(目录, "a.png");
  // 内容是什么不重要，只要能被读出来
  图base64 = Buffer.from("不是真图，只是字节").toString("base64");
  writeFileSync(图路径, Buffer.from(图base64, "base64"));
});

describe("补多图", () => {
  const 声明 = { 参数: [{ 键: "images", 类型: "images" }] };

  it("路径被读成 base64", () => {
    const 出 = 补多图(声明, { images: [图路径] }) as { images: string[] };
    expect(出.images[0]).toBe(图base64);
  });

  it("多张都转", () => {
    const 出 = 补多图(声明, { images: [图路径, 图路径] }) as { images: string[] };
    expect(出.images).toHaveLength(2);
    expect(出.images).toEqual([图base64, 图base64]);
  });

  it("已经是 base64 的原样保留", () => {
    // 聊天框一直传 base64，这条路不能坏
    const 出 = 补多图(声明, { images: [图base64] }) as { images: string[] };
    expect(出.images[0]).toBe(图base64);
  });

  it("不存在的路径原样保留（让下游报它自己的错）", () => {
    const 假 = join(目录, "没有这个文件.png");
    const 出 = 补多图(声明, { images: [假] }) as { images: string[] };
    expect(出.images[0]).toBe(假);
  });

  it("非路径非 base64 的字符串也没被乱读", () => {
    const 出 = 补多图(声明, { images: ["hello world"] }) as { images: string[] };
    expect(出.images[0]).toBe("hello world");
  });

  it("没有 images 参数的动作不碰 params", () => {
    const 原 = { base64: "abc", degrees: 90 };
    expect(补多图({ 参数: [{ 键: "degrees", 类型: "number" }] }, 原)).toBe(原);
  });

  it("params 不是对象时原样返回", () => {
    expect(补多图(声明, null)).toBe(null);
    expect(补多图(声明, "x")).toBe("x");
    expect(补多图(undefined, {})).toEqual({});
  });

  it("空的 images 数组不触发转换", () => {
    const 原 = { images: [] };
    expect(补多图(声明, 原)).toBe(原);
  });

  it("不改原对象", () => {
    const 原 = { images: [图路径], 别的: 1 };
    补多图(声明, 原);
    // 原地改会让调用方拿到被换过的参数，重试时就变成「base64 又被当路径」
    expect(原.images[0]).toBe(图路径);
  });

  it("别的参数一起透传", () => {
    const 出 = 补多图(
      { 参数: [{ 键: "images", 类型: "images" }, { 键: "row", 类型: "number" }] },
      { images: [图路径], row: 3, session: "abc" },
    ) as Record<string, unknown>;
    expect(出.row).toBe(3);
    expect(出.session).toBe("abc");
  });
});

describe("接线：注册层真的调了 补多图", () => {
  it("图片动作 里调用了 补多图", () => {
    // 只测纯函数时，把 index.ts 里这一行删掉，上面 10 条照样全绿——
    // 而线上表现就是「拼接出来的图尺寸离谱」。
    const 源 = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(源).toMatch(/干活\(补多图\(/);
  });

  it("补多图 只在多图参数上动作", () => {
    const 源 = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const 段 = 源.slice(源.indexOf("function 补多图"), 源.indexOf("function 落会话"));
    expect(段).toContain('p.类型 === "images"');
  });

  it("落会话 会把帧也写盘并给出 frames 路径数组", () => {
    const 源 = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const 段 = 源.slice(源.indexOf("function 落会话"), 源.indexOf("function 落会话") + 2200);
    expect(段).toContain("出.frames = 帧路径");
    // base64 的 images 必须原样保留：聊天框和外接方都在用它
    expect(段).toContain("...结果");
  });
});

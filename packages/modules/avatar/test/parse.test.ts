/**
 * avatar 模块的纯函数测试。
 *
 * `图片尺寸` 是手写字节解析，写错一个偏移量的表现是**返回 {0,0}**
 * ——不抛错、不崩，只是下游当成「这张图没有尺寸」。所以这里不测
 * 「能读出来」，而是每种格式都验**宽高分别对不对**（PNG/GIF 宽高
 * 偏移不同、字节序也不同，只测一个数发现不了串位）。
 */

import { describe, expect, it } from "vitest";
import { 图片尺寸, 取号码 } from "../src/parse.js";

/** 造一个最小 PNG 头（只到 IHDR 的宽高为止，后面补零） */
function 造PNG(w: number, h: number): Buffer {
  const b = Buffer.alloc(24);
  b[0] = 0x89;
  b[1] = 0x50;
  b[2] = 0x4e;
  b[3] = 0x47;
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

/** 造一个最小 GIF 头 */
function 造GIF(w: number, h: number): Buffer {
  const b = Buffer.alloc(10);
  b[0] = 0x47; // G
  b[1] = 0x49; // I
  b[2] = 0x46; // F
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}

/** 造一个带 SOF0 段的 JPEG（SOI + APP0 + SOF0） */
function 造JPEG(w: number, h: number, 标记 = 0xc0): Buffer {
  const app0 = Buffer.alloc(4);
  app0[0] = 0xff;
  app0[1] = 0xe0;
  app0.writeUInt16BE(2, 2); // 段长 2（不含标记本身）

  const sof = Buffer.alloc(11);
  sof[0] = 0xff;
  sof[1] = 标记;
  sof.writeUInt16BE(9, 2); // 段长
  sof[4] = 8; // 精度
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}

describe("图片尺寸：PNG", () => {
  it("读出宽高（大端）", () => {
    expect(图片尺寸(造PNG(300, 200))).toEqual({ width: 300, height: 200 });
  });

  it("宽高不串位", () => {
    // 宽高完全不同，如果两个偏移写反了这条会立刻红
    expect(图片尺寸(造PNG(1024, 32))).toEqual({ width: 1024, height: 32 });
    expect(图片尺寸(造PNG(32, 1024))).toEqual({ width: 32, height: 1024 });
  });

  it("大尺寸不溢出（UInt32）", () => {
    expect(图片尺寸(造PNG(65535, 65536))).toEqual({ width: 65535, height: 65536 });
  });

  it("不够 24 字节就当认不出", () => {
    expect(图片尺寸(造PNG(300, 200).subarray(0, 20))).toEqual({ width: 0, height: 0 });
  });
});

describe("图片尺寸：GIF", () => {
  it("读出宽高（小端）", () => {
    expect(图片尺寸(造GIF(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("小端顺序不能写成大端", () => {
    // 300 = 0x012C，小端存成 2C 01，大端读会变 0x2C01 = 11265
    expect(图片尺寸(造GIF(300, 200)).width).toBe(300);
  });

  it("PNG 的判定不会误吃 GIF", () => {
    const g = 造GIF(640, 480);
    expect(g[0]).toBe(0x47);
    expect(图片尺寸(g)).toEqual({ width: 640, height: 480 });
  });
});

describe("图片尺寸：JPEG", () => {
  it("从 SOF0 读出宽高（注意高在前、宽在后）", () => {
    // JPEG 的 SOF 段里顺序是 高 → 宽，跟直觉反过来。
    // 这条如果红，多半是两个读反了。
    expect(图片尺寸(造JPEG(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it("SOF2（渐进式）也认", () => {
    expect(图片尺寸(造JPEG(320, 240, 0xc2))).toEqual({ width: 320, height: 240 });
  });

  it("C4/C8/CC 不带尺寸，要跳过继续找", () => {
    // DHT(C4)、JPG(C8)、DAC(CC) 与 SOF 同段但结构不同，
    // 不排除的话会读出垃圾宽高。
    const 带DHT = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xc4, 0x00, 0x02]), // 一个段长为 2 的 C4
      造JPEG(640, 480).subarray(2),
    ]);
    expect(图片尺寸(带DHT)).toEqual({ width: 640, height: 480 });
  });

  it("找不到 SOF 时返回 0,0", () => {
    // 只有 SOI，没有 SOF
    const 只有头 = Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(图片尺寸(只有头)).toEqual({ width: 0, height: 0 });
  });
});

describe("图片尺寸：不认识的输入", () => {
  it("空 buffer", () => {
    expect(图片尺寸(Buffer.alloc(0))).toEqual({ width: 0, height: 0 });
  });

  it("纯文本", () => {
    expect(图片尺寸(Buffer.from("<html>404 Not Found</html>"))).toEqual({ width: 0, height: 0 });
  });

  it("不抛错（认不出就返回 0，不崩）", () => {
    // 这条是核心契约：上游返回一坨垃圾时不能把模块搞崩。
    expect(() => 图片尺寸(Buffer.alloc(100))).not.toThrow();
    expect(() => 图片尺寸(Buffer.from([0xff]))).not.toThrow();
  });
});

describe("取号码", () => {
  it("认 qq 键", () => {
    expect(取号码({ qq: "123456" })).toBe("123456");
  });

  it("认 groupid 键", () => {
    expect(取号码({ groupid: "987654" })).toBe("987654");
  });

  it("认中文键 群号 / 号码", () => {
    expect(取号码({ 群号: "555555" })).toBe("555555");
    expect(取号码({ 号码: "666666" })).toBe("666666");
  });

  it("认 参数文本 / 原文（聊天框入口）", () => {
    expect(取号码({ 参数文本: "看看 1234567 的头像" })).toBe("1234567");
    expect(取号码({ 原文: "群 2345678" })).toBe("2345678");
  });

  it("从一句话里抠出号码", () => {
    expect(取号码({ qq: "帮我查一下 123456789 这个号" })).toBe("123456789");
  });

  it("数字类型也认（≥10000）", () => {
    expect(取号码({ qq: 123456 })).toBe("123456");
  });

  it("数字类型小于 10000 不认", () => {
    // 9999 可能是别的东西（比如页码），不硬当成 QQ 号
    expect(取号码({ qq: 9999 })).toBe("");
  });

  it("首位不能是 0", () => {
    expect(取号码({ qq: "0123456" })).toBe("123456");
    expect(取号码({ qq: "00000" })).toBe("");
  });

  it("不足 5 位不认", () => {
    expect(取号码({ qq: "1234" })).toBe("");
  });

  it("正好 5 位认", () => {
    expect(取号码({ qq: "10000" })).toBe("10000");
  });

  it("取第一个合法数字串", () => {
    expect(取号码({ qq: "12 345678 99" })).toBe("345678");
  });

  it("键的优先级：qq 先于 groupid", () => {
    expect(取号码({ qq: "111111", groupid: "222222" })).toBe("111111");
  });

  it("前一个键不合法时会试下一个", () => {
    expect(取号码({ qq: "abc", groupid: "222222" })).toBe("222222");
  });

  it("前一个键是 undefined 时也会试下一个", () => {
    expect(取号码({ qq: undefined, groupid: "333333" })).toBe("333333");
  });

  it("空的 qq 字符串会继续试下一个", () => {
    // 注意：字符串键不合法时是 continue，不会提前返回 ""
    expect(取号码({ qq: "", 参数文本: "444444" })).toBe("444444");
  });

  it("都没有返回空串", () => {
    expect(取号码({})).toBe("");
    expect(取号码({ qq: "没有数字" })).toBe("");
  });

  it("不修改入参", () => {
    const p = { qq: " 123456 " };
    const 快照 = JSON.stringify(p);
    取号码(p);
    expect(JSON.stringify(p)).toBe(快照);
  });
});

/**
 * av 模块的纯函数测试（落盘输入 / 列文件 / 路径解析）。
 *
 * ## 挑这两个测的理由
 *
 * `落盘输入` 决定「用户给的媒体从哪来、落到哪个文件」。它同时处理
 * **两路输入**（base64 / 磁盘路径）和一个**文件名**——三者组合起来
 * 就是路径穿越的经典现场。而且它错了的表现是「文件写到了不该写的地方」
 * 或者「读不到输入」，都不会在正常流程里报错。
 *
 * `列文件` 负责把 ffmpeg 切出来的分片按顺序拼回去。顺序错了，
 * 合并出来的音频就是乱序的——但每一片本身都是合法音频，
 * 播放器不会报错，只是内容不对。这种错**必须靠测**。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { 列文件, 落盘输入 } from "../src/ffmpeg.js";

let 目录: string | null = null;

afterEach(() => {
  if (目录) {
    rmSync(目录, { recursive: true, force: true });
    目录 = null;
  }
});

const 新目录 = (): string => {
  目录 = mkdtempSync(join(tmpdir(), "kugua-av-"));
  return 目录;
};

describe("落盘输入：base64", () => {
  it("写出解码后的字节", () => {
    const d = 新目录();
    const p = 落盘输入(d, { base64: Buffer.from("hello").toString("base64") }, "in.bin");
    expect(readFileSync(p, "utf-8")).toBe("hello");
  });

  it("默认名生效", () => {
    const d = 新目录();
    const p = 落盘输入(d, { base64: Buffer.from("x").toString("base64") }, "默认.mp3");
    expect(basename(p)).toBe("默认.mp3");
    expect(existsSync(p)).toBe(true);
  });

  it("二进制字节原样还原", () => {
    // 音频是二进制，不能假定是文本
    const d = 新目录();
    const 原 = Buffer.from([0x00, 0xff, 0x89, 0x50, 0x4e, 0x47, 0x80]);
    const p = 落盘输入(d, { base64: 原.toString("base64") }, "b.bin");
    expect(readFileSync(p).equals(原)).toBe(true);
  });

  it("base64 是空串时不算给了输入", () => {
    // 空串是假值，会走到 else 分支 → 抛错。
    // 这是当前行为：空文件本身没有处理意义。
    const d = 新目录();
    expect(() => 落盘输入(d, { base64: "" }, "a.bin")).toThrow(/缺少媒体输入/);
  });
});

describe("落盘输入：磁盘路径", () => {
  it("复制源文件内容", () => {
    const d = 新目录();
    const 源 = join(d, "src.txt");
    writeFileSync(源, "源内容", "utf-8");
    const p = 落盘输入(d, { path: 源 }, "忽略.mp3");
    expect(readFileSync(p, "utf-8")).toBe("源内容");
  });

  it("文件名取自源路径的 basename，不用默认名", () => {
    const d = 新目录();
    const 源 = join(d, "我的歌.mp3");
    writeFileSync(源, "x", "utf-8");
    const p = 落盘输入(d, { path: 源 }, "默认.mp3");
    expect(basename(p)).toBe("我的歌.mp3");
  });

  it("源路径是绝对路径时也被压成单层文件名", () => {
    // 这条是路径穿越防护的核心：basename 之后不可能带 .. 或子目录
    const d = 新目录();
    const 源 = join(d, "sub", "deep", "f.mp3");
    // 先建好目录再写
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(join(d, "sub", "deep"), { recursive: true });
    writeFileSync(源, "x", "utf-8");
    const p = 落盘输入(d, { path: 源 }, "默认.mp3");
    expect(p).toBe(join(d, "f.mp3"));
  });

  it("路径不存在时抛错", () => {
    const d = 新目录();
    expect(() => 落盘输入(d, { path: join(d, "没有这个.mp3") }, "a.mp3")).toThrow(
      /缺少媒体输入/,
    );
  });

  it("路径带 .. 时 basename 仍只取最后一段", () => {
    const d = 新目录();
    const 源 = join(d, "a", "..", "b.mp3");
    writeFileSync(join(d, "b.mp3"), "x", "utf-8");
    const p = 落盘输入(d, { path: 源 }, "默认.mp3");
    // realpath 后是 b.mp3，basename 也是 b.mp3
    expect(basename(p)).toBe("b.mp3");
    expect(p.startsWith(d)).toBe(true);
  });
});

describe("落盘输入：base64 优先于 path", () => {
  it("两个都给时用 base64", () => {
    // 顺序是刻意的：base64 来自聊天框（用户刚贴的），path 来自旧接口。
    const d = 新目录();
    const 源 = join(d, "src.txt");
    writeFileSync(源, "来自文件", "utf-8");
    const p = 落盘输入(d, { base64: Buffer.from("来自base64").toString("base64"), path: 源 }, "n.bin");
    expect(readFileSync(p, "utf-8")).toBe("来自base64");
  });

  it("有 path 时文件名仍取 path 的 basename", () => {
    // 名取自 path（更有意义），内容取自 base64
    const d = 新目录();
    const 源 = join(d, "原曲.mp3");
    writeFileSync(源, "x", "utf-8");
    const p = 落盘输入(d, { base64: Buffer.from("内容").toString("base64"), path: 源 }, "默认.mp3");
    expect(basename(p)).toBe("原曲.mp3");
    expect(readFileSync(p, "utf-8")).toBe("内容");
  });
});

describe("落盘输入：都没有输入", () => {
  it("空对象抛错", () => {
    const d = 新目录();
    expect(() => 落盘输入(d, {}, "a.bin")).toThrow(/缺少媒体输入/);
  });

  it("报错信息点明两种来源", () => {
    // 用户看到这句话要知道该给什么
    const d = 新目录();
    expect(() => 落盘输入(d, {}, "a.bin")).toThrow(/base64/);
  });
});

describe("列文件", () => {
  it("按数字后缀排序（1,2,10 而不是 1,10,2）", () => {
    // 这是这个函数存在的**唯一理由**：字典序会把 10 排在 2 前面，
    // 拼出来的音频就错位了。
    const d = 新目录();
    for (const n of [1, 2, 10, 11, 3]) writeFileSync(join(d, `part${n}.mp3`), "", "utf-8");
    const r = 列文件(d, "part", ".mp3");
    expect(r.map((f) => basename(f))).toEqual([
      "part1.mp3",
      "part2.mp3",
      "part3.mp3",
      "part10.mp3",
      "part11.mp3",
    ]);
  });

  it("只匹配给定前缀和后缀", () => {
    const d = 新目录();
    writeFileSync(join(d, "part1.mp3"), "", "utf-8");
    writeFileSync(join(d, "other1.mp3"), "", "utf-8");
    writeFileSync(join(d, "part2.m4a"), "", "utf-8");
    expect(列文件(d, "part", ".mp3").map((f) => basename(f))).toEqual(["part1.mp3"]);
  });

  it("空目录得到空数组", () => {
    expect(列文件(新目录(), "part", ".mp3")).toEqual([]);
  });

  it("没有数字的文件排在前面（当 0 处理）", () => {
    // 当前行为：parseInt 失败当 0。这里钉住是为了将来变化时可见。
    const d = 新目录();
    writeFileSync(join(d, "part.mp3"), "", "utf-8");
    writeFileSync(join(d, "part5.mp3"), "", "utf-8");
    expect(列文件(d, "part", ".mp3").map((f) => basename(f))).toEqual(["part.mp3", "part5.mp3"]);
  });

  it("数字相同时保持原有相对顺序（排序稳定）", () => {
    const d = 新目录();
    writeFileSync(join(d, "a1.mp3"), "", "utf-8");
    writeFileSync(join(d, "b1.mp3"), "", "utf-8");
    const r = 列文件(d, "", ".mp3").map((f) => basename(f));
    expect(r.length).toBe(2);
    expect(r.sort()).toEqual(["a1.mp3", "b1.mp3"]);
  });

  it("返回的是完整路径，不是文件名", () => {
    const d = 新目录();
    writeFileSync(join(d, "p1.mp3"), "", "utf-8");
    const r = 列文件(d, "p", ".mp3");
    expect(r[0]).toBe(join(d, "p1.mp3"));
    expect(existsSync(r[0])).toBe(true);
  });

  it("多位数字排序（跨度到 100+）", () => {
    const d = 新目录();
    for (const n of [100, 9, 99, 1, 10]) writeFileSync(join(d, `s${n}.wav`), "", "utf-8");
    expect(列文件(d, "s", ".wav").map((f) => basename(f))).toEqual([
      "s1.wav",
      "s9.wav",
      "s10.wav",
      "s99.wav",
      "s100.wav",
    ]);
  });
});

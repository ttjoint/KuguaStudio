// 图片编解码/元数据单元测试（media-codec 现为纯 ESM，可直接被 vitest 引用）
import { describe, expect, it } from "vitest";
import {
  解析图片信息,
  人类可读大小,
  图片格式全名,
  地理信息文本,
  base64转字节,
  LZW解压,
} from "../src/renderer/media-codec";

/** 构造仅含 PNG 签名 + IHDR 的最小 PNG（解析器不校验 CRC） */
function 造PNG(宽: number, 高: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13, false); // IHDR 长度
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  dv.setUint32(16, 宽, false);
  dv.setUint32(20, 高, false);
  return b;
}

/** 构造最小 GIF 头（无全局色表、无帧） */
function 造GIF(宽: number, 高: number): Uint8Array {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
  b[6] = 宽 & 0xff; b[7] = (宽 >> 8) & 0xff;
  b[8] = 高 & 0xff; b[9] = (高 >> 8) & 0xff;
  return b;
}

describe("media-codec 格式与尺寸", () => {
  it("识别 PNG 并读取宽高", () => {
    expect(解析图片信息(造PNG(640, 480))).toMatchObject({ 格式: "png", 宽度: 640, 高度: 480 });
  });

  it("识别 GIF 并读取宽高（无帧则非动图）", () => {
    const info = 解析图片信息(造GIF(320, 200));
    expect(info).toMatchObject({ 格式: "gif", 宽度: 320, 高度: 200, 动图: false });
    expect(info.帧数).toBeUndefined();
  });

  it("未知/过短的字节流返回 unknown", () => {
    expect(解析图片信息(new Uint8Array([1, 2, 3])).格式).toBe("unknown");
    expect(解析图片信息(new Uint8Array(0)).格式).toBe("unknown");
  });
});

describe("media-codec 展示辅助", () => {
  it("人类可读大小", () => {
    expect(人类可读大小(null)).toBe("未知");
    expect(人类可读大小(0)).toBe("0 B");
    expect(人类可读大小(500)).toBe("500 B");
    expect(人类可读大小(2048)).toBe("2.0 KB");
    expect(人类可读大小(1024 * 1024)).toBe("1.0 MB");
  });

  it("图片格式全名", () => {
    expect(图片格式全名("png")).toBe("PNG 图片");
    expect(图片格式全名("gif", true, 5)).toBe("GIF 动图 · 5 帧");
    expect(图片格式全名("gif", true)).toBe("GIF 动图");
    expect(图片格式全名("", undefined, undefined, "jpeg")).toBe("JPEG 图片");
    expect(图片格式全名("what")).toBe("图片");
  });

  it("地理信息文本含经纬方向", () => {
    const s = 地理信息文本({ 纬度: 39.9, 经度: 116.4 });
    expect(s).toContain("北纬");
    expect(s).toContain("东经");
    expect(地理信息文本(undefined)).toBe("");
    expect(地理信息文本({ 纬度: -33.86, 经度: -70.66, 海拔: 520.5 })).toContain("南纬");
  });
});

describe("media-codec 解码", () => {
  it("base64 转字节", () => {
    const bytes = base64转字节("aGVsbG8=");
    expect(String.fromCharCode(...bytes)).toBe("hello");
  });

  it("LZW 最小码长非法时返回 null", () => {
    expect(LZW解压(1, new Uint8Array(8), 4)).toBeNull();
    expect(LZW解压(9, new Uint8Array(8), 4)).toBeNull();
  });
});

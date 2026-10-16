/**
 * 苦瓜工作室 图片编解码/元数据（纯函数，独立于 DOM，便于 vitest 测试）
 *
 * 供预览弹窗使用：解析 PNG/JPEG/GIF/WebP/BMP 尺寸与 GIF 帧、JPEG/PNG EXIF 地理信息，
 * 以及 GIF 帧解码（用于暂停/进度拖拽）。
 *
 * 原为 UMD 脚本（media-codec.cjs，挂 window.KuguaMedia）；现改为标准 ES 模块，
 * 由 `parts/03-preview.ts` 直接 import，随 index.js 一起打包，不再单独引入脚本。
 */

export interface 地理信息 {
  纬度: number;
  经度: number;
  海拔?: number;
}

export interface 图片信息 {
  格式: string;
  宽度?: number;
  高度?: number;
  动图?: boolean;
  帧数?: number;
  地理?: 地理信息;
}

export interface GIF补丁 {
  左: number;
  顶: number;
  宽: number;
  高: number;
  延迟毫秒: number;
  处置方式: number;
  像素: Uint8ClampedArray;
}

export interface GIF解码结果 {
  宽: number;
  高: number;
  循环次数: number;
  帧: GIF补丁[];
}

/** 对外暴露的编解码能力集合 */
export interface 媒体编解码 {
  解析图片信息: (b: Uint8Array) => 图片信息;
  解码GIF: (b: Uint8Array) => GIF解码结果 | null;
  人类可读大小: (n: number | null | undefined) => string;
  图片格式全名: (格式: string, 动图?: boolean, 帧数?: number, extHint?: string) => string;
  地理信息文本: (g?: 地理信息) => string;
  base64转字节: (b64: string) => Uint8Array;
}

/** Node 环境回退（浏览器走 atob；Node 16+ 亦有 atob，此处仅兜底） */
declare const Buffer: { from(数据: string, 编码: string): Uint8Array } | undefined;

const 探测 = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

function 匹配(b: Uint8Array, off: number, arr: number[]): boolean {
  if (off + arr.length > b.length) return false;
  for (let i = 0; i < arr.length; i++) if (b[off + i] !== arr[i]) return false;
  return true;
}
function u16be(b: Uint8Array, o: number): number { return ((b[o] << 8) | b[o + 1]) >>> 0; }
function u16le(b: Uint8Array, o: number): number { return (b[o] | (b[o + 1] << 8)) >>> 0; }
function u32be(b: Uint8Array, o: number): number { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function u32le(b: Uint8Array, o: number): number { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function s32le(b: Uint8Array, o: number): number { const v = u32le(b, o); return v >= 0x80000000 ? v - 0x100000000 : v; }
function ascii(b: Uint8Array, o: number, n: number): string { let s = ""; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; }

function 探测格式(b: Uint8Array): string {
  if (!b || b.length < 4) return "unknown";
  if (匹配(b, 0, 探测.png)) return "png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "ico";
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return "tiff";
  if (ascii(b, 4, 4) === "ftyp") { const brand = ascii(b, 8, 4); if (brand === "avif" || brand === "avis") return "avif"; }
  if (b[0] === 0x3c) { const head = ascii(b, 0, Math.min(256, b.length)).toLowerCase(); if (head.indexOf("<svg") >= 0) return "svg"; }
  return "unknown";
}

// ---------- EXIF/TIFF 地理 ----------
type TIFF值 = string | number[][] | number;

function 解析TIFF地理(b: Uint8Array, tiff: number, len: number): 地理信息 | null {
  function safe(off: number): boolean { return tiff + off < len; }
  function u16(o: number): number { return (b[tiff + o] === 0x49) ? u16le(b, tiff + o) : u16be(b, tiff + o); }
  function u32(o: number): number { return (b[tiff + o] === 0x49) ? u32le(b, tiff + o) : u32be(b, tiff + o); }
  if (len - tiff < 8) return null;
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  function u16at(o: number): number { return little ? u16le(b, tiff + o) : u16be(b, tiff + o); }
  function u32at(o: number): number { return little ? u32le(b, tiff + o) : u32be(b, tiff + o); }
  function 有(u: number, v: number, w: number): boolean { return tiff + u + v + w <= len; }
  const ifd0 = u32at(4);
  if (ifd0 <= 0) return null;
  const count = u16at(ifd0);
  let gps = 0;
  for (let i = 0; i < count && i < 200; i++) {
    const e = ifd0 + 2 + i * 12;
    if (!有(e, 11, 0)) break;
    const tag = u16at(e);
    if (tag === 0x8825) gps = u32at(e + 8);
  }
  if (!gps) return null;
  const gpsCount = u16at(gps);
  const 值: Record<number, TIFF值> = {};
  for (let j = 0; j < gpsCount && j < 60; j++) {
    const ge = gps + 2 + j * 12;
    if (!有(ge, 11, 0)) break;
    const t = u16at(ge);
    const ty = u16at(ge + 2);
    const cn = u32at(ge + 4);
    const raw = ge + 8;
    if (t === 1 || t === 3) {
      // ASCII ref
      let s = "";
      for (let k = 0; k < Math.min(cn, 4) && 有(raw, k, 0); k++) s += String.fromCharCode(b[tiff + raw + k]);
      if (cn > 4) {
        const off = u32at(raw);
        for (let m = 0; m < Math.min(cn, 8) && 有(off, m, 0); m++) s += String.fromCharCode(b[tiff + off + m]);
      }
      值[t] = s.trim();
    } else if (ty === 5) {
      const off2 = u32at(raw);
      const arr: number[][] = [];
      for (let q = 0; q < cn; q++) {
        if (!有(off2, q * 8 + 7, 0)) break;
        arr.push([u32at(off2 + q * 8), u32at(off2 + q * 8 + 4)]);
      }
      值[t] = arr;
    } else if (ty === 1 && t === 5) {
      值[t] = b[tiff + raw];
    }
  }
  function 有理坐标(list: TIFF值 | undefined): number | null {
    if (!Array.isArray(list) || list.length === 0) return null;
    let v = 0;
    for (let i = 0; i < Math.min(list.length, 3); i++) {
      const n = list[i][0], d = list[i][1];
      if (!d) return null;
      let part = n / d;
      if (i === 1) part /= 60;
      else if (i === 2) part /= 3600;
      v += part;
    }
    return v;
  }
  let lat = 有理坐标(值[2]);
  let lon = 有理坐标(值[4]);
  if (lat === null || lon === null) return null;
  const 纬参考 = 值[1];
  const 经参考 = 值[3];
  if (typeof 纬参考 === "string" && 纬参考.toUpperCase() === "S") lat = -lat;
  if (typeof 经参考 === "string" && 经参考.toUpperCase() === "W") lon = -lon;
  const geo: 地理信息 = { 纬度: lat, 经度: lon };
  const 海拔值 = 值[6];
  if (Array.isArray(海拔值) && 海拔值[0]) {
    let alt = 海拔值[0][0] / (海拔值[0][1] || 1);
    if (值[5] === 1) alt = -alt;
    geo.海拔 = alt;
  }
  return geo;
}

// ---------- 各格式解析 ----------
function 解析PNG(b: Uint8Array): 图片信息 {
  const info: 图片信息 = { 格式: "png" };
  if (b.length >= 24 && ascii(b, 12, 4) === "IHDR") {
    info.宽度 = u32be(b, 16); info.高度 = u32be(b, 20);
  }
  let pos = 8;
  while (pos + 8 <= b.length) {
    const size = u32be(b, pos);
    const type = ascii(b, pos + 4, 4);
    const data = pos + 8;
    if (size > 1 << 24 || data + size > b.length) break;
    if (type === "acTL") {
      info.动图 = true;
      info.帧数 = u32be(b, data);
    }
    pos = data + size + 4; // skip crc
  }
  return info;
}

function 解析JPEG(b: Uint8Array): 图片信息 {
  const info: 图片信息 = { 格式: "jpeg" };
  let pos = 2;
  while (pos + 9 < b.length) {
    if (b[pos] !== 0xff) { pos++; continue; }
    const marker = b[pos + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    const segLen = u16be(b, pos + 2);
    if (segLen < 2 || pos + 2 + segLen > b.length) break;
    const 数据起点 = pos + 4;
    const isSOF = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSOF && !info.宽度) {
      info.高度 = u16be(b, 数据起点 + 1);
      info.宽度 = u16be(b, 数据起点 + 3);
    }
    if (marker === 0xe1 && segLen >= 14 && ascii(b, 数据起点, 6) === "Exif\u0000\u0000") {
      info.地理 = 解析TIFF地理(b, 数据起点 + 6, b.length) ?? undefined;
    }
    pos += 2 + segLen;
  }
  return info;
}

// GIF 描述符结构上并不像上面那样线性，改用独立轻量遍历函数
function 解析GIF元数据(b: Uint8Array): 图片信息 {
  const info: 图片信息 = { 格式: "gif" };
  if (b.length < 13) return info;
  info.宽度 = u16le(b, 6); info.高度 = u16le(b, 8);
  const packed = b[10];
  let pos = 13;
  if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1));
  let frames = 0;
  while (pos < b.length) {
    const blk = b[pos];
    if (blk === 0x3b) break;
    if (blk === 0x2c) {
      frames++;
      let p = pos + 10;
      if (p < b.length && (b[pos + 9] & 0x80)) p += 3 * (1 << ((b[pos + 9] & 0x07) + 1));
      if (p < b.length) {
        // 跳过 LZW 最小码长 + 分块
        p++;
        while (p < b.length) { const n = b[p]; p++; if (n === 0) break; p += n; }
        pos = p;
      } else pos += 10;
      continue;
    }
    if (blk === 0x21) {
      let q = pos + 2; // 标签后
      while (q < b.length) { const sz = b[q]; q++; if (sz === 0) break; q += sz; }
      pos = q;
      continue;
    }
    pos++;
  }
  info.动图 = frames > 1;
  if (frames > 0) info.帧数 = frames;
  return info;
}

function 解析WebP(b: Uint8Array): 图片信息 {
  const info: 图片信息 = { 格式: "webp" };
  let pos = 12;
  let animFrames = 0;
  let isAnim = false;
  while (pos + 8 <= b.length) {
    const four = ascii(b, pos, 4);
    const size = u32le(b, pos + 4);
    const data = pos + 8;
    if (data + size > b.length) break;
    if (four === "VP8X") {
      if (size >= 10) {
        isAnim = (b[data] & 0x02) !== 0;
        info.宽度 = 1 + (b[data + 4] | (b[data + 5] << 8) | (b[data + 6] << 16));
        info.高度 = 1 + (b[data + 7] | (b[data + 8] << 8) | (b[data + 9] << 16));
      }
    } else if (four === "ANMF") {
      animFrames++;
    } else if (four === "VP8L" && size >= 5 && b[data] === 0x2f) {
      const w1 = b[data + 1] | ((b[data + 2] & 0x3f) << 8);
      const h1 = ((b[data + 2] & 0xc0) >> 6) | (b[data + 3] << 2) | ((b[data + 4] & 0x0f) << 10);
      info.宽度 = w1 + 1; info.高度 = h1 + 1;
    } else if (four === "VP8 " && size >= 10 && b[data + 3] === 0x9d && b[data + 4] === 0x01 && b[data + 5] === 0x2a) {
      info.宽度 = (b[data + 6] | (b[data + 7] << 8)) & 0x3fff;
      info.高度 = (b[data + 8] | (b[data + 9] << 8)) & 0x3fff;
    }
    pos = data + size + (size & 1);
  }
  if (isAnim) { info.动图 = true; info.帧数 = animFrames || undefined; }
  return info;
}

export function 解析图片信息(b: Uint8Array): 图片信息 {
  if (!b || b.length < 4) return { 格式: "unknown" };
  const fmt = 探测格式(b);
  let info: 图片信息 = { 格式: fmt };
  if (fmt === "png") info = 解析PNG(b);
  else if (fmt === "jpeg") info = 解析JPEG(b);
  else if (fmt === "gif") info = 解析GIF元数据(b);
  else if (fmt === "webp") info = 解析WebP(b);
  else if (fmt === "bmp") {
    if (b.length >= 26) { info.宽度 = s32le(b, 18); info.高度 = Math.abs(s32le(b, 22)); }
  }
  return info;
}

// ---------- GIF LZW 解码 ----------
function 读子块(b: Uint8Array, pos: number): { data: number[]; next: number } {
  const out: number[] = [];
  while (pos < b.length) {
    const n = b[pos++];
    if (n === 0) break;
    for (let i = 0; i < n && pos < b.length; i++) out.push(b[pos++]);
  }
  return { data: out, next: pos };
}

export function LZW解压(minCodeSize: number, data: Uint8Array, expected: number): Uint8Array | null {
  if (minCodeSize < 2 || minCodeSize > 8) return null;
  const out = new Uint8Array(expected);
  let o = 0;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = clear + 2;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let bitBuf = 0, bitN = 0, bi = 0;
  function 读码(): number {
    while (bitN < codeSize && bi < data.length) {
      bitBuf |= data[bi++] << bitN;
      bitN += 8;
    }
    if (bitN < codeSize) return -1;
    const v = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>>= codeSize;
    bitN -= codeSize;
    return v;
  }
  let prev = -1;
  const stack: number[] = [];
  while (o < expected) {
    const code = 读码();
    if (code < 0) break;
    if (code === clear) { codeSize = minCodeSize + 1; next = clear + 2; prev = -1; continue; }
    if (code === eoi) break;
    if (prev < 0) { out[o++] = code & 0xff; prev = code; continue; }
    stack.length = 0;
    let cur = code;
    let 首 = -1;
    if (cur === next) {
      if (prev < clear) 首 = prev; else 首 = suffix[prev];
      stack.push(首);
      cur = prev;
    }
    while (cur >= clear) {
      if (cur > 4095 || (cur >= next && cur !== code)) { cur = -1; break; }
      stack.push(suffix[cur]);
      cur = prefix[cur];
    }
    if (cur < 0) break;
    stack.push(cur);
    首 = 首 < 0 ? cur : 首;
    for (let k = stack.length - 1; k >= 0 && o < expected; k--) out[o++] = stack[k];
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = 首;
      next++;
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  return o === expected ? out : o > 0 ? out.subarray(0, o) : null;
}

function 反交织(px: Uint8Array, w: number, h: number): Uint8Array {
  if (!w || !h) return px;
  const out = new Uint8Array(px.length);
  let row = 0, i = 0;
  const passes = [[0, 8], [4, 8], [2, 4], [1, 2]];
  for (let p = 0; p < passes.length; p++) {
    for (let y = passes[p][0]; y < h; y += passes[p][1]) {
      for (let x = 0; x < w; x++) out[row * w + x] = px[i++];
      row++;
    }
  }
  return out;
}

export function 解码GIF(bytes: Uint8Array): GIF解码结果 | null {
  if (!bytes || bytes.length < 13 || (ascii(bytes, 0, 3) !== "GIF" && 探测格式(bytes) !== "gif")) return null;
  const 宽 = u16le(bytes, 6), 高 = u16le(bytes, 8);
  if (!宽 || !高) return null;
  const packed = bytes[10];
  let 全局表: Uint8Array | null = null;
  let pos = 13;
  if (packed & 0x80) {
    const gsz = 3 * (1 << ((packed & 0x07) + 1));
    全局表 = bytes.slice(13, 13 + gsz);
    pos = 13 + gsz;
  }
  let 循环次数 = 0;
  const 帧: GIF补丁[] = [];
  let 处置 = 0, 延迟 = 0, 透明 = -1;
  while (pos < bytes.length) {
    const blk = bytes[pos];
    if (blk === 0x3b) break;
    if (blk === 0x2c) {
      if (pos + 10 > bytes.length) break;
      const 左 = u16le(bytes, pos + 1), 顶 = u16le(bytes, pos + 3);
      const fw = u16le(bytes, pos + 5), fh = u16le(bytes, pos + 7);
      if (!fw || !fh) { pos += 10; continue; }
      const pk = bytes[pos + 9];
      let 表 = 全局表;
      let p = pos + 10;
      if (pk & 0x80) {
        const lsz = 3 * (1 << ((pk & 0x07) + 1));
        表 = bytes.slice(p, p + lsz);
        p += lsz;
      }
      const 交织 = (pk & 0x40) !== 0;
      if (p >= bytes.length) break;
      const minCode = bytes[p];
      p++;
      const 块 = 读子块(bytes, p);
      const pix = LZW解压(minCode, Uint8Array.from(块.data), fw * fh);
      pos = 块.next;
      if (!pix) continue;
      const rows = 交织 ? 反交织(pix, fw, fh) : pix;
      const rgba = new Uint8ClampedArray(fw * fh * 4);
      for (let i = 0; i < fw * fh; i++) {
        const idx = rows[i];
        const o4 = i * 4;
        if (idx === 透明) {
          rgba[o4] = rgba[o4 + 1] = rgba[o4 + 2] = rgba[o4 + 3] = 0;
        } else if (表 && idx * 3 + 2 < 表.length) {
          rgba[o4] = 表[idx * 3]; rgba[o4 + 1] = 表[idx * 3 + 1]; rgba[o4 + 2] = 表[idx * 3 + 2]; rgba[o4 + 3] = 255;
        } else {
          const g = idx * 16 + 8;
          rgba[o4] = rgba[o4 + 1] = rgba[o4 + 2] = Math.min(255, g); rgba[o4 + 3] = 255;
        }
      }
      帧.push({ 左, 顶, 宽: fw, 高: fh, 延迟毫秒: 延迟 > 0 ? 延迟 * 10 : 100, 处置方式: 处置, 像素: rgba });
      处置 = 0; 延迟 = 0; 透明 = -1;
      continue;
    }
    if (blk === 0x21) {
      const label = bytes[pos + 1];
      const q = pos + 2;
      if (label === 0xf9) {
        const sz0 = q < bytes.length ? bytes[q] : 0;
        if (q + 1 + sz0 <= bytes.length) {
          const flags = bytes[q + 1];
          处置 = (flags >> 2) & 7;
          延迟 = u16le(bytes, q + 2);
          透明 = (flags & 1) ? bytes[q + 4] : -1;
        }
      } else if (label === 0xff && q < bytes.length) {
        // Application Extension（NETSCAPE 循环次数）
        const asz = bytes[q];
        const appName = ascii(bytes, q + 1, Math.min(asz, 20));
        const sub = 读子块(bytes, q + 1 + asz);
        if (appName === "NETSCAPE2.0" && sub.data.length >= 3) {
          循环次数 = sub.data[1] | (sub.data[2] << 8);
        }
        pos = sub.next;
        continue;
      }
      // 跳过扩展子块
      let skip = q;
      while (skip < bytes.length) { const nn = bytes[skip]; skip++; if (nn === 0) break; skip += nn; }
      pos = skip;
      continue;
    }
    pos++;
  }
  if (帧.length === 0) return null;
  return { 宽, 高, 循环次数, 帧 };
}

// ---------- 展示辅助 ----------
export function 人类可读大小(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "未知";
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  for (let i = 0; i < units.length; i++) {
    v /= 1024;
    if (v < 1024 || i === units.length - 1) return v.toFixed(v >= 100 ? 0 : 1) + " " + units[i];
  }
  return n + " B";
}

export function 图片格式全名(fmt: string, 动图?: boolean, 帧数?: number, extHint?: string): string {
  const map: Record<string, string> = {
    png: "PNG 图片", jpeg: "JPEG 图片", gif: "GIF 图片", webp: "WebP 图片",
    bmp: "BMP 位图", svg: "SVG 矢量图", ico: "ICO 图标", tiff: "TIFF 图片", avif: "AVIF 图片",
  };
  let base = map[fmt] || map[(extHint || "").toLowerCase()] || "图片";
  if (动图) base = base.replace(/图片$/, "") + (帧数 ? "动图 · " + 帧数 + " 帧" : "动图");
  return base;
}

export function 地理信息文本(g?: 地理信息): string {
  if (!g || g.纬度 === undefined || g.经度 === undefined) return "";
  function 度(x: number): string {
    const d = Math.abs(x);
    const deg = Math.floor(d);
    const min = Math.floor((d - deg) * 60);
    const sec = ((d - deg) * 60 - min) * 60;
    return deg + "°" + min + "′" + sec.toFixed(2) + "″";
  }
  let s = (g.纬度 >= 0 ? "北纬 " : "南纬 ") + 度(g.纬度) + "，";
  s += (g.经度 >= 0 ? "东经 " : "西经 ") + 度(g.经度);
  if (g.海拔 !== undefined) s += "，海拔 " + g.海拔.toFixed(1) + " m";
  return s;
}

export function base64转字节(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(b64, "base64"));
  throw new Error("当前环境不支持 base64 解码");
}

/** 编解码能力集合（供 03-preview 统一引用） */
export const 媒体编解码实现: 媒体编解码 = {
  解析图片信息,
  解码GIF,
  人类可读大小,
  图片格式全名,
  地理信息文本,
  base64转字节,
};

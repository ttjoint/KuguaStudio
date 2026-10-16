/**
 * GIF 处理（ImageMagick 版）
 *
 * 复刻参考项目 `ImageHandlerGif.cs` / 现有 Python 引擎的 GIF 系列操作：
 *   gifSprite / gifUnzip / gifUnzipGrid / gifRemoveFrame / gifZip / gifShuffle / webpToGif / gifSpeed
 *
 * 关键：ImageMagick 与 Magick.NET 同引擎，可精确控制逐帧 delay / coalesce / dispose。
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextInt, NextDouble } from "@kugua/random";
import { 运行Magick, 图片尺寸, 成结果 } from "./magick.js";

export interface 图片结果 {
  base64: string;
  format: string;
  width: number;
  height: number;
  images?: string[];
  message?: string;
}

/** 临时目录包裹（结束清理） */
async function 用临时目录<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "kugua-gif-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 帧数（GIF/WebP 多帧） */
export async function 帧数(buf: Buffer): Promise<number> {
  const 出 = await 运行Magick(["identify", "-format", "%n\n", "-"], buf);
  const 首行 = 出
    .toString()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)[0];
  const n = parseInt(首行 ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** 每帧延时（1/100 秒） */
export async function 帧延时(buf: Buffer): Promise<number[]> {
  const 出 = await 运行Magick(["identify", "-format", "%T\n", "-"], buf);
  const 列表 = 出
    .toString()
    .split(/\r?\n/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return 列表.length > 0 ? 列表 : [10];
}

/** 拆帧（coalesce 后逐帧 PNG） */
export async function 拆帧(buf: Buffer): Promise<Buffer[]> {
  return 用临时目录(async (dir) => {
    const 输入 = join(dir, "in.gif");
    writeFileSync(输入, buf);
    await 运行Magick([输入, "-coalesce", join(dir, "f-%d.png")]);
    return readdirSync(dir)
      .filter((f) => /^f-\d+\.png$/.test(f))
      .sort((a, b) => Number(a.slice(2, -4)) - Number(b.slice(2, -4)))
      .map((f) => readFileSync(join(dir, f)));
  });
}

/** 把帧合成为 GIF（可指定逐帧延时，1/100 秒） */
export async function 合帧为GIF(frames: Buffer[], delays: number[]): Promise<Buffer> {
  return 用临时目录(async (dir) => {
    const 文件 = frames.map((b, i) => {
      const f = join(dir, `f${i}.png`);
      writeFileSync(f, b);
      return f;
    });
    const 参数: string[] = [];
    文件.forEach((f, i) => {
      参数.push("-delay", String(Math.max(1, Math.round(delays[i] ?? 10))), f);
    });
    参数.push("-loop", "0", "gif:-");
    return 运行Magick(参数);
  });
}

/** 默认延时把帧集合包成结果（含 images 与合并 GIF） */
async function 多帧结果(frames: Buffer[], delays: number[], 信息: string, 格式 = "gif"): Promise<图片结果> {
  const { width, height } = 图片尺寸(frames[0]);
  const gif = await 合帧为GIF(frames, delays);
  return {
    base64: gif.toString("base64"),
    format: 格式,
    width,
    height,
    images: frames.map((f) => f.toString("base64")),
    message: 信息,
  };
}

/** 缩放帧到指定尺寸（强制） */
export async function 缩放帧(f: Buffer, w: number, h: number): Promise<Buffer> {
  return 运行Magick(["-", "-resize", `${w}x${h}!`, "png:-"], f);
}

/** 拼接两帧（横/纵） */
export async function 拼接两帧(a: Buffer, b: Buffer, horizontal: boolean): Promise<Buffer> {
  return 用临时目录(async (dir) => {
    const fa = join(dir, "a.png");
    const fb = join(dir, "b.png");
    writeFileSync(fa, a);
    writeFileSync(fb, b);
    return 运行Magick([fa, fb, horizontal ? "+append" : "-append", "png:-"]);
  });
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a: number, b: number): number {
  return a && b ? Math.abs(a * b) / gcd(a, b) : 0;
}

/** 拼接多图（横/纵），复刻 combineImage（含尺寸归一与多帧 LCM） */
export async function combine(images: string[], horizontal: boolean): Promise<图片结果> {
  const 输入 = images.map((b) => Buffer.from(b, "base64"));
  if (输入.length < 2) throw new Error("竖拼/横拼需要两张（或多张）图片");
  const 集合: Buffer[][] = [];
  for (const b of 输入) 集合.push(await 拆帧(b));
  let 当前帧 = 集合[0];
  for (let k = 1; k < 集合.length; k++) {
    const 另一 = 集合[k];
    const full = lcm(当前帧.length, 另一.length);
    const 尺寸 = (arr: Buffer[]): { w: number; h: number } => {
      let w = 0;
      let h = 0;
      for (const f of arr) {
        const s = 图片尺寸(f);
        if (s.width > w) w = s.width;
        if (s.height > h) h = s.height;
      }
      return { w, h };
    };
    const s1 = 尺寸(当前帧);
    const s2 = 尺寸(另一);
    let r1 = 1;
    let r2 = 1;
    if (horizontal) {
      if (s1.h > s2.h) r2 = s1.h / s2.h;
      else if (s1.h < s2.h) r1 = s2.h / s1.h;
    } else {
      if (s1.w > s2.w) r2 = s1.w / s2.w;
      else if (s1.w < s2.w) r1 = s2.w / s1.w;
    }
    const n1w = Math.round(s1.w * r1);
    const n1h = Math.round(s1.h * r1);
    const n2w = Math.round(s2.w * r2);
    const n2h = Math.round(s2.h * r2);
    const 新帧: Buffer[] = [];
    for (let i = 0; i < full; i++) {
      const f1 = await 缩放帧(当前帧[i % 当前帧.length], n1w, n1h);
      const f2 = await 缩放帧(另一[i % 另一.length], n2w, n2h);
      新帧.push(await 拼接两帧(f1, f2, horizontal));
    }
    当前帧 = 新帧;
  }
  if (当前帧.length === 1) return 成结果(当前帧[0]);
  return 多帧结果(当前帧, 当前帧.map(() => 5), `一共${当前帧.length}帧`, "gif");
}

/** 抖动动画（复刻 ImgShake） */
export async function shake(buf: Buffer, degree: number): Promise<图片结果> {
  const frames = await 拆帧(buf);
  const delays = await 帧延时(buf);
  const { width: w, height: h } = 图片尺寸(frames[0]);
  const newW = Math.floor(w * (1 + degree / 5.0));
  const newH = Math.floor(h * (1 + degree / 5.0));
  const 出帧: Buffer[] = [];
  const 出延: number[] = [];
  const 次数 = frames.length === 1 ? 10 : frames.length;
  for (let i = 0; i < 次数; i++) {
    const base = frames[i % frames.length];
    const dx = Math.floor((newW * ((NextDouble() - 0.5) * degree)) / 10);
    const dy = Math.floor((newH * ((NextDouble() - 0.5) * degree)) / 10);
    const x = Math.floor(newW / 2 - w / 2 + dx);
    const y = Math.floor(newH / 2 - h / 2 + dy);
    const canvas = await 运行Magick(
      ["-size", `${newW}x${newH}`, "xc:none", "-", "-geometry", `+${x}+${y}`, "-composite", "png:-"],
      base,
    );
    出帧.push(canvas);
    出延.push(frames.length === 1 ? 5 : (delays[i] ?? 10));
  }
  return 多帧结果(出帧, 出延, `一共${出帧.length}帧`, "gif");
}

/** 滚动环形动画（复刻 ImgRoll） */
export async function rollImg(buf: Buffer, degreeDeg: number): Promise<图片结果> {
  const frames = await 拆帧(buf);
  const delays = await 帧延时(buf);
  const { width: w, height: h } = 图片尺寸(frames[0]);
  const degree = (degreeDeg * Math.PI) / 180;
  let frameCount = frames.length === 1 ? 10 : frames.length;
  const dx = Math.trunc((w * Math.cos(degree)) / frameCount);
  const dy = Math.trunc((-h * Math.sin(degree)) / frameCount);
  if (dx !== 0 && dy !== 0) {
    const lcmx = lcm(Math.abs(dx), w) / w;
    const lcmy = lcm(Math.abs(dy), h) / h;
    frameCount *= lcm(lcmx, lcmy);
  }
  const 出帧: Buffer[] = [];
  const 出延: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const base = frames[i % frames.length];
    const x = ((((i * dx) % w) + w) % w);
    const y = ((((i * dy) % h) + h) % h);
    const canvas = await 运行Magick(["-", "-roll", `+${x}+${y}`, "png:-"], base);
    出帧.push(canvas);
    出延.push(delays[i % frames.length] ?? 10);
  }
  return 多帧结果(出帧, 出延, `一共${出帧.length}帧`, "gif");
}

/** 弹性压扁回弹（复刻 ToElasticBounceGif） */
export async function touchBall(buf: Buffer): Promise<图片结果> {
  const frames = await 拆帧(buf);
  const { width: w, height: h } = 图片尺寸(frames[0]);
  const scaleX = [1.0, 1.08, 1.18, 1.25, 1.2, 1.1, 0.95, 0.98, 1.0, 1.0];
  const scaleY = [1.0, 0.88, 0.7, 0.58, 0.7, 0.92, 1.15, 1.08, 1.02, 1.0];
  const delay = [10, 8, 7, 8, 7, 6, 8, 8, 10, 10];
  const frameNum = lcm(frames.length, 10);
  const 出帧: Buffer[] = [];
  const 出延: number[] = [];
  for (let i = 0; i < frameNum; i++) {
    const base = frames[i % frames.length];
    const nw = Math.max(1, Math.round(w * scaleX[i % 10]));
    const nh = Math.max(1, Math.round(h * scaleY[i % 10]));
    const canvas = await 运行Magick(
      ["-", "-resize", `${nw}x${nh}!`, "-background", "none", "-gravity", "center", "-extent", `${w}x${h}`, "png:-"],
      base,
    );
    出帧.push(canvas);
    出延.push(delay[i % 10]);
  }
  return 多帧结果(出帧, 出延, `一共${出帧.length}帧`, "gif");
}

/* ============ 各操作 ============ */

/** 拆帧平铺成序列图（列优先：findex = col*rows + row） */
export async function gifSprite(buf: Buffer, col: number): Promise<图片结果> {
  const frames = await 拆帧(buf);
  let cols = Math.max(1, Math.floor(col));
  if (cols === 1) cols = Math.max(1, frames.length);
  const rows = Math.ceil(frames.length / cols);
  const { width: fw, height: fh } = 图片尺寸(frames[0]);
  const W = fw * cols;
  const H = fh * rows;
  const 出 = await 用临时目录(async (dir) => {
    const 文件 = frames.map((b, i) => {
      const f = join(dir, `f${i}.png`);
      writeFileSync(f, b);
      return f;
    });
    const 参数 = ["-size", `${W}x${H}`, "xc:none"];
    for (let row = 0; row < rows; row++) {
      for (let c = 0; c < cols; c++) {
        const idx = c * rows + row;
        if (idx >= frames.length) continue;
        参数.push(文件[idx], "-geometry", `+${c * fw}+${row * fh}`, "-composite");
      }
    }
    参数.push("png:-");
    return 运行Magick(参数);
  });
  const r = 成结果(出);
  return { ...r, message: `一共${frames.length}帧` };
}

/** 拆帧为一组 PNG */
export async function gifUnzip(buf: Buffer): Promise<图片结果> {
  const frames = await 拆帧(buf);
  const delays = frames.map(() => 100);
  const r = await 多帧结果(frames, delays, `一共${frames.length}张`, "gif");
  return r;
}

/** 拆成 col×row 碎片（取首帧） */
export async function gifUnzipGrid(buf: Buffer, col: number, row: number): Promise<图片结果> {
  const frames = await 拆帧(buf);
  const base = frames[0];
  const { width: w, height: h } = 图片尺寸(base);
  const c = Math.max(1, Math.floor(col));
  const r0 = Math.max(1, Math.floor(row));
  const cw = Math.floor(w / c);
  const ch = Math.floor(h / r0);
  const tiles = await 用临时目录(async (dir) => {
    const 输入 = join(dir, "in.png");
    writeFileSync(输入, base);
    await 运行Magick([输入, "-crop", `${cw}x${ch}`, "+repage", "+adjoin", join(dir, "t-%d.png")]);
    return readdirSync(dir)
      .filter((f) => /^t-\d+\.png$/.test(f))
      .sort((a, b) => Number(a.slice(2, -4)) - Number(b.slice(2, -4)))
      .map((f) => readFileSync(join(dir, f)));
  });
  return 多帧结果(tiles, tiles.map(() => 100), `一共${tiles.length}张`, "gif");
}

/** 删帧：从 beginFrame 起删掉 count 帧（复刻 removeGifFrame） */
export async function gifRemoveFrame(buf: Buffer, begin: number, count: number): Promise<图片结果> {
  const frames = await 拆帧(buf);
  const delays = await 帧延时(buf);
  const n = frames.length;
  let b = Math.floor(begin);
  let c = Math.floor(count);
  if (b < 0) b = n - (Math.abs(b) % n);
  if (c === 0) c = 1;
  else if (c < 0) {
    c = Math.abs(c) % n;
    b = b - c;
  }
  const 删: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i + 1 >= b) {
      删.push(i);
      if (删.length > c) break;
    }
  }
  let 新帧 = frames.filter((_, i) => !删.includes(i));
  let 新延时 = delays.filter((_, i) => !删.includes(i));
  if (新帧.length === 0) {
    新帧 = [frames[0]];
    新延时 = [100];
  }
  if (新帧.length === 1) {
    const r = 成结果(新帧[0]);
    return { ...r, message: "剩余1帧" };
  }
  return 多帧结果(新帧, 新延时, `剩余${新帧.length}帧`, "gif");
}

/** 合成 GIF：多图（或单图按 row×col 拆帧） */
export async function gifZip(
  images: string[],
  row: number,
  col: number,
  sprite: boolean,
): Promise<图片结果> {
  const 输入 = images.map((b) => Buffer.from(b, "base64"));
  if (输入.length >= 2 || (输入.length === 1 && sprite)) {
    const 帧集: Buffer[] = [];
    for (const b of 输入) {
      const fs = await 拆帧(b);
      for (const f of fs) {
        const { width: fw, height: fh } = 图片尺寸(f);
        let 出: Buffer;
        if (fh < fw) {
          const tw = Math.round((fw / fh) * 400);
          出 = await 运行Magick(["-", "-resize", `${tw}x400!`, "png:-"], f);
        } else {
          const th = Math.round((fh / fw) * 400);
          出 = await 运行Magick(["-", "-resize", `400x${th}!`, "png:-"], f);
        }
        帧集.push(出);
      }
    }
    return 多帧结果(帧集, 帧集.map(() => 5), `一共${帧集.length}帧`, "gif");
  }
  if (输入.length === 0) throw new Error("缺少输入图片");
  const 帧集 = await 用临时目录(async (dir) => {
    const 输入文件 = join(dir, "in.png");
    writeFileSync(输入文件, 输入[0]);
    const { width: w, height: h } = 图片尺寸(输入[0]);
    const c = Math.max(1, Math.floor(col));
    const r0 = Math.max(1, Math.floor(row));
    const cw = Math.floor(w / c);
    const ch = Math.floor(h / r0);
    await 运行Magick([输入文件, "-crop", `${cw}x${ch}`, "+repage", "+adjoin", join(dir, "t-%d.png")]);
    return readdirSync(dir)
      .filter((f) => /^t-\d+\.png$/.test(f))
      .sort((a, b) => Number(a.slice(2, -4)) - Number(b.slice(2, -4)))
      .map((f) => readFileSync(join(dir, f)));
  });
  return 多帧结果(帧集, 帧集.map(() => 5), `一共${帧集.length}帧`, "gif");
}

/** 乱序：打乱帧顺序（延时跟随） */
export async function gifShuffle(buf: Buffer): Promise<图片结果> {
  const frames = await 拆帧(buf);
  const delays = await 帧延时(buf);
  const n = frames.length;
  const idx = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = NextInt(i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const 新帧 = idx.map((i) => frames[i]);
  const 新延时 = idx.map((i) => delays[i] ?? 10);
  if (新帧.length === 1) {
    return 成结果(新帧[0]);
  }
  return 多帧结果(新帧, 新延时, `一共${新帧.length}帧`, "gif");
}

/** WebP → GIF（多帧）或 PNG（单帧） */
export async function webpToGif(buf: Buffer): Promise<图片结果> {
  const n = await 帧数(buf);
  if (n <= 1) {
    const 出 = await 运行Magick(["-", "png:-"], buf);
    return 成结果(出);
  }
  const 出 = await 运行Magick(["-", "-coalesce", "gif:-"], buf);
  return 成结果(出, "gif");
}

/** 倍速：调整 GIF 速率（负数倒放），复刻 ImgSetGifSpeed */
export async function gifSpeed(buf: Buffer, speed: number): Promise<图片结果> {
  let frames = await 拆帧(buf);
  let delays = await 帧延时(buf);
  if (frames.length <= 1) return 成结果(frames[0]);
  if (Math.abs(speed) <= 0.001) return 成结果(frames[0]);

  if (speed < 0) {
    frames = [...frames].reverse();
    delays = [...delays].reverse();
  }
  const sp = Math.abs(speed);
  const originalSum = delays.reduce((a, b) => a + b, 0);
  const targetSum = Math.floor(originalSum / sp);
  const needsRemoval = delays.some((d) => d / sp < 2);

  if (needsRemoval) {
    const targetCount = Math.max(2, Math.round(frames.length / sp));
    const step = Math.ceil(frames.length / targetCount);
    const 新帧: Buffer[] = [];
    for (let i = 0; i < frames.length; i += step) 新帧.push(frames[i]);
    frames = 新帧;
    const per = Math.max(2, Math.floor(targetSum / frames.length));
    delays = frames.map(() => per);
  } else {
    delays = delays.map((d) => Math.max(2, Math.floor(d / sp)));
  }
  return 多帧结果(frames, delays, `一共${frames.length}帧`, "gif");
}
